import {
  cellText,
  hash53,
  isBlank,
  normalizeKey,
  parseAccountType,
  parseAmount,
  parseCurrency,
  parseDate,
  parseDecimal,
  parseExpenseType,
} from './parsers.js'
import { OPERATION_SHEETS, SHEET_SCHEMAS } from './schema.js'
import { convert } from './money.js'
import type {
  Account,
  CurrencyCode,
  ExchangeRates,
  ImportIssue,
  ImportResult,
  Operation,
  RawSheets,
  SheetName,
  SheetStats,
} from './types.js'

export const UNCATEGORIZED = 'Senza categoria'

interface MappedRow {
  rowNumber: number
  fields: Record<string, unknown>
  extra: Record<string, string>
}

interface MappedSheet {
  rows: MappedRow[]
  missingColumns: string[]
}

/** Associa le colonne del foglio ai campi dello schema tramite gli alias. */
function mapSheet(sheet: SheetName, raw: unknown[][]): MappedSheet {
  const schema = SHEET_SCHEMAS[sheet]
  const headerIndex = raw.findIndex((r) => Array.isArray(r) && r.some((c) => !isBlank(c)))
  if (headerIndex < 0) {
    return { rows: [], missingColumns: schema.filter((f) => f.requiredColumn).map((f) => f.label) }
  }
  const header = raw[headerIndex]
  const columnMap: Array<{ key: string; extra: boolean; label: string }> = header.map((h) => {
    const norm = normalizeKey(h)
    const field = schema.find((f) => f.aliases.includes(norm))
    return field ? { key: field.key, extra: false, label: field.label } : { key: cellText(h), extra: true, label: cellText(h) }
  })
  const present = new Set(columnMap.filter((c) => !c.extra).map((c) => c.key))
  const missingColumns = schema.filter((f) => f.requiredColumn && !present.has(f.key)).map((f) => f.label)

  const rows: MappedRow[] = []
  for (let i = headerIndex + 1; i < raw.length; i++) {
    const cells = raw[i] ?? []
    if (!cells.some((c) => !isBlank(c))) continue
    const fields: Record<string, unknown> = {}
    const extra: Record<string, string> = {}
    columnMap.forEach((col, idx) => {
      const value = cells[idx]
      if (col.extra) {
        if (col.key && !isBlank(value)) extra[col.key] = cellText(value)
      } else if (fields[col.key] === undefined || isBlank(fields[col.key])) {
        fields[col.key] = value
      }
    })
    rows.push({ rowNumber: i + 1, fields, extra })
  }
  return { rows, missingColumns }
}

const cleanName = (value: unknown) => cellText(value).replace(/\s+/g, ' ')

/** Registro dei nomi dei conti: confronto case-insensitive, nome canonico = prima occorrenza. */
class AccountNames {
  private map = new Map<string, string>()
  canonical(name: string): string {
    const key = name.toLowerCase()
    const found = this.map.get(key)
    if (found) return found
    this.map.set(key, name)
    return name
  }
}

export interface ImportOptions {
  baseCurrency?: CurrencyCode
}

/**
 * Trasforma i fogli grezzi in un dataset validato.
 * Funzione pura: nessun I/O, usata sia dall'API serverless sia dal client (dati demo).
 */
export function importFinanceSheets(raw: RawSheets, options: ImportOptions = {}): ImportResult {
  const baseCurrency = parseCurrency(options.baseCurrency) ?? 'EUR'
  const issues: ImportIssue[] = []
  const stats: SheetStats[] = []
  const names = new AccountNames()

  const issue = (i: ImportIssue) => issues.push(i)
  const newStats = (sheet: SheetName, present: boolean): SheetStats => {
    const s = { sheet, present, rowsRead: 0, imported: 0, skipped: 0, duplicates: 0 }
    stats.push(s)
    return s
  }

  // ---- Valute -----------------------------------------------------------
  const rates: ExchangeRates = { [baseCurrency]: 1 }
  const ratesStats = newStats('Valute', !!raw.Valute)
  if (raw.Valute) {
    const { rows, missingColumns } = mapSheet('Valute', raw.Valute)
    if (missingColumns.length) {
      issue({ severity: 'error', sheet: 'Valute', code: 'missing_columns', message: `Colonne mancanti: ${missingColumns.join(', ')}. Foglio ignorato.` })
    } else {
      for (const r of rows) {
        ratesStats.rowsRead++
        const cur = parseCurrency(r.fields.currency)
        const rate = parseDecimal(r.fields.rate)
        if (!cur || rate === null || rate <= 0) {
          ratesStats.skipped++
          issue({ severity: 'error', sheet: 'Valute', row: r.rowNumber, code: 'invalid_rate', message: 'Valuta o tasso non validi.' })
          continue
        }
        if (cur === baseCurrency && rate !== 1) {
          issue({ severity: 'warning', sheet: 'Valute', row: r.rowNumber, code: 'base_rate', message: `${cur} è la valuta base: il tasso è sempre 1.` })
          ratesStats.skipped++
          continue
        }
        rates[cur] = rate
        ratesStats.imported++
      }
    }
  }

  // ---- Conti ------------------------------------------------------------
  const declared = new Map<string, Account>()
  const accountsStats = newStats('Conti', !!raw.Conti)
  if (raw.Conti) {
    const { rows, missingColumns } = mapSheet('Conti', raw.Conti)
    if (missingColumns.length) {
      issue({ severity: 'error', sheet: 'Conti', code: 'missing_columns', message: `Colonne mancanti: ${missingColumns.join(', ')}. Foglio ignorato.` })
    } else {
      for (const r of rows) {
        accountsStats.rowsRead++
        const name = cleanName(r.fields.name)
        if (!name) {
          accountsStats.skipped++
          issue({ severity: 'error', sheet: 'Conti', row: r.rowNumber, column: 'Conto', code: 'required', message: 'Nome del conto mancante.' })
          continue
        }
        const canonical = names.canonical(name)
        if (declared.has(canonical)) {
          accountsStats.duplicates++
          issue({ severity: 'warning', sheet: 'Conti', row: r.rowNumber, code: 'duplicate_account', message: `Il conto "${canonical}" è già definito: riga ignorata.` })
          continue
        }
        const currencyRaw = r.fields.currency
        const currency = parseCurrency(currencyRaw)
        if (!isBlank(currencyRaw) && !currency) {
          issue({ severity: 'warning', sheet: 'Conti', row: r.rowNumber, column: 'Valuta', code: 'invalid_currency', message: `Valuta "${cellText(currencyRaw)}" non valida: uso ${baseCurrency}.` })
        }
        const opening = isBlank(r.fields.openingBalance) ? 0 : parseAmount(r.fields.openingBalance)
        if (opening === null) {
          issue({ severity: 'warning', sheet: 'Conti', row: r.rowNumber, column: 'Saldo iniziale', code: 'invalid_amount', message: 'Saldo iniziale non valido: uso 0.' })
        }
        const type = parseAccountType(r.fields.type) ?? 'liquidity'
        const market = isBlank(r.fields.marketValue) ? undefined : parseAmount(r.fields.marketValue) ?? undefined
        if (market !== undefined && type !== 'investment') {
          issue({ severity: 'warning', sheet: 'Conti', row: r.rowNumber, column: 'Valore di mercato', code: 'market_value_liquidity', message: 'Il valore di mercato è considerato solo per i conti di investimento.' })
        }
        declared.set(canonical, {
          name: canonical,
          type,
          currency: currency ?? baseCurrency,
          openingBalance: opening ?? 0,
          marketValue: type === 'investment' ? market : undefined,
          label: cellText(r.fields.type) || undefined,
          declared: true,
        })
        accountsStats.imported++
      }
    }
  }

  // ---- Operazioni -------------------------------------------------------
  const operations: Operation[] = []
  const seenIds = new Map<string, number>()

  for (const sheet of OPERATION_SHEETS) {
    const sheetStats = newStats(sheet, !!raw[sheet])
    if (!raw[sheet]) {
      issue({ severity: 'warning', sheet, code: 'missing_sheet', message: `Foglio "${sheet}" non trovato nel documento.` })
      continue
    }
    const { rows, missingColumns } = mapSheet(sheet, raw[sheet]!)
    if (missingColumns.length) {
      issue({ severity: 'error', sheet, code: 'missing_columns', message: `Colonne obbligatorie mancanti: ${missingColumns.join(', ')}. Foglio ignorato.` })
      sheetStats.rowsRead = rows.length
      sheetStats.skipped = rows.length
      continue
    }

    for (const r of rows) {
      sheetStats.rowsRead++
      const f = r.fields
      const rowIssues: ImportIssue[] = []
      const err = (column: string, code: string, message: string) =>
        rowIssues.push({ severity: 'error', sheet, row: r.rowNumber, column, code, message })
      const warn = (column: string, code: string, message: string) =>
        issue({ severity: 'warning', sheet, row: r.rowNumber, column, code, message })

      const date = parseDate(f.date)
      if (!date) err('Giorno', isBlank(f.date) ? 'required' : 'invalid_date', isBlank(f.date) ? 'Data mancante.' : `Data "${cellText(f.date)}" non valida.`)

      const accountRaw = cleanName(f.account)
      if (!accountRaw) err('Conto', 'required', 'Conto mancante.')
      const account = accountRaw ? names.canonical(accountRaw) : ''

      let amount = parseAmount(f.amount)
      if (amount === null) err('Importo', isBlank(f.amount) ? 'required' : 'invalid_amount', isBlank(f.amount) ? 'Importo mancante.' : `Importo "${cellText(f.amount)}" non valido.`)
      else if (amount === 0) err('Importo', 'zero_amount', 'Importo pari a zero.')
      else if (amount < 0) {
        if (sheet === 'Uscite') amount = -amount // convenzione comune: uscite scritte in negativo
        else err('Importo', 'negative_amount', 'Importo negativo non ammesso in questo foglio.')
      }

      let currency = parseCurrency(f.currency)
      if (!currency) {
        if (isBlank(f.currency)) {
          currency = declared.get(account)?.currency ?? baseCurrency
          warn('Valuta', 'default_currency', `Valuta mancante: uso ${currency}.`)
        } else err('Valuta', 'invalid_currency', `Valuta "${cellText(f.currency)}" non riconosciuta.`)
      }

      let category = cleanName(f.category)
      const subcategory = cleanName(f.subcategory)
      if (!category && sheet !== 'Transazioni') {
        category = UNCATEGORIZED
        warn('Categoria', 'missing_category', `Categoria mancante: classificata come "${UNCATEGORIZED}".`)
      }
      const description = cellText(f.description)

      const base = {
        date: date ?? '',
        account,
        category,
        subcategory,
        description,
        amount: amount ?? 0,
        currency: currency ?? baseCurrency,
        extra: r.extra,
        source: { sheet, row: r.rowNumber },
      }

      let op: Operation | null = null
      if (sheet === 'Entrate') {
        op = {
          ...base,
          id: '',
          kind: 'income',
          incomeSource: cellText(f.incomeSource) || undefined,
          recurrence: cellText(f.recurrence) || undefined,
        }
      } else if (sheet === 'Uscite') {
        let expenseType = parseExpenseType(f.expenseType)
        if (!expenseType) {
          if (isBlank(f.expenseType)) {
            expenseType = 'additional'
            warn('Tipologia', 'default_expense_type', 'Tipologia mancante: classificata come Aggiuntiva.')
          } else err('Tipologia', 'invalid_expense_type', `Tipologia "${cellText(f.expenseType)}" non valida (ammessi: Necessaria, Aggiuntiva, Investimento).`)
        }
        op = { ...base, id: '', kind: 'expense', expenseType: expenseType ?? 'additional' }
      } else {
        const toRaw = cleanName(f.toAccount)
        const toAccount = toRaw ? names.canonical(toRaw) : ''
        if (!toAccount) err('Conto destinazione', 'required', 'Conto di destinazione mancante.')
        else if (toAccount === account) err('Conto destinazione', 'same_account', 'Conto di origine e destinazione coincidono.')

        let toCurrency = isBlank(f.toCurrency) ? null : parseCurrency(f.toCurrency)
        if (!isBlank(f.toCurrency) && !toCurrency) err('Valuta destinazione', 'invalid_currency', `Valuta "${cellText(f.toCurrency)}" non riconosciuta.`)
        toCurrency ??= declared.get(toAccount)?.currency ?? currency ?? baseCurrency

        let toAmount = isBlank(f.toAmount) ? null : parseAmount(f.toAmount)
        if (!isBlank(f.toAmount) && (toAmount === null || toAmount <= 0)) {
          err('Importo convertito', 'invalid_amount', 'Importo convertito non valido.')
        }
        if (toAmount === null && amount !== null && currency) {
          if (toCurrency === currency) toAmount = amount
          else {
            toAmount = convert(amount, currency, toCurrency, rates)
            if (toAmount === null) err('Importo convertito', 'missing_conversion', `Serve l'importo convertito o un tasso ${currency}/${toCurrency} nel foglio Valute.`)
            else warn('Importo convertito', 'estimated_conversion', `Importo convertito stimato con i tassi del foglio Valute.`)
          }
        }
        op = {
          ...base,
          category: category || 'Trasferimento',
          id: '',
          kind: 'transfer',
          toAccount,
          toCurrency,
          toAmount: toAmount ?? 0,
        }
      }

      if (rowIssues.length) {
        issues.push(...rowIssues)
        sheetStats.skipped++
        continue
      }

      // ---- Identità e duplicati ----
      const explicitId = cellText(f.id)
      let id: string
      if (explicitId) {
        id = `${sheet}:${explicitId}`
      } else {
        const fingerprint = [
          sheet, op.date, op.account.toLowerCase(), op.amount, op.currency,
          op.category.toLowerCase(), op.subcategory.toLowerCase(), op.description.toLowerCase(),
          op.kind === 'transfer' ? op.toAccount.toLowerCase() : '',
          op.kind === 'expense' ? op.expenseType : '',
        ].join('|')
        id = `${sheet[0]}-${hash53(fingerprint)}`
      }
      const firstRow = seenIds.get(id)
      if (firstRow !== undefined) {
        sheetStats.duplicates++
        sheetStats.skipped++
        issue({
          severity: explicitId ? 'error' : 'warning',
          sheet,
          row: r.rowNumber,
          code: 'duplicate',
          message: explicitId
            ? `ID "${explicitId}" già usato alla riga ${firstRow}: riga ignorata.`
            : `Possibile duplicato della riga ${firstRow} (stessi dati): riga ignorata. Se è un'operazione distinta, aggiungi una colonna ID o differenzia la descrizione.`,
        })
        continue
      }
      seenIds.set(id, r.rowNumber)
      op.id = id
      operations.push(op)
      sheetStats.imported++
    }
  }

  // ---- Conti dedotti dalle operazioni ------------------------------------
  const accounts = new Map(declared)
  const ensure = (name: string, currency: CurrencyCode) => {
    if (!name || accounts.has(name)) return
    accounts.set(name, { name, type: parseAccountType(name) === 'investment' ? 'investment' : 'liquidity', currency, openingBalance: 0, declared: false })
  }
  operations.sort((a, b) => a.date.localeCompare(b.date) || a.source.sheet.localeCompare(b.source.sheet) || a.source.row - b.source.row)
  for (const op of operations) {
    ensure(op.account, op.currency)
    if (op.kind === 'transfer') ensure(op.toAccount, op.toCurrency)
  }

  // Valute senza tasso → gli aggregati in valuta base non possono includerle.
  const usedCurrencies = new Set<CurrencyCode>()
  operations.forEach((op) => {
    usedCurrencies.add(op.currency)
    if (op.kind === 'transfer') usedCurrencies.add(op.toCurrency)
  })
  accounts.forEach((a) => usedCurrencies.add(a.currency))
  for (const cur of usedCurrencies) {
    if (rates[cur] === undefined) {
      issue({ severity: 'warning', sheet: 'Valute', code: 'missing_rate', message: `Nessun tasso per ${cur}: i movimenti in ${cur} sono esclusi dai totali in ${baseCurrency}. Aggiungilo al foglio Valute.` })
    }
  }

  return {
    dataset: { baseCurrency, rates, accounts: [...accounts.values()], operations },
    issues,
    stats,
  }
}
