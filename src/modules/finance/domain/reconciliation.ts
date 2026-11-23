import { normalizeKey, parseAmount, parseCurrency, parseDate, parseExpenseType } from './parsers.js'
import type { ExpenseType } from './types.js'

export type LedgerKind = 'income' | 'expense' | 'transfer'
export type StatementProvider = 'revolut' | 'revolut-savings' | 'trade-republic' | 'satispay'

export interface LedgerRow {
  id: string
  row: number
  date: string
  kind: LedgerKind
  expenseType?: ExpenseType
  account: string
  toAccount: string
  category: string
  subcategory: string
  amount: number
  currency: string
  description: string
}

export interface StatementRow {
  id: string
  row: number
  provider: StatementProvider
  date: string
  kind: LedgerKind
  expenseType?: ExpenseType
  account: string
  amount: number
  fee: number
  currency: string
  description: string
  status: string
}

export interface FileIssue {
  severity: 'error' | 'warning'
  row?: number
  code: string
  message: string
}

export interface CategoryOption {
  name: string
  subcategories: string[]
}

export type ReconciliationStatus =
  | 'matched'
  | 'amount_mismatch'
  | 'date_mismatch'
  | 'description_mismatch'
  | 'currency_mismatch'
  | 'duplicate'
  | 'missing_in_general'
  | 'missing_in_statement'

export interface ReconciliationItem {
  key: string
  status: ReconciliationStatus
  statement?: StatementRow
  ledger?: LedgerRow
  candidate?: LedgerRow
  amountDifference?: number
  dateDifference?: number
}

const HEADER_ALIASES = {
  date: ['giorno', 'data', 'date', 'datacompletamento', 'datetime', 'datainizio'],
  account: ['conto', 'account', 'accountname'],
  toAccount: ['contodest', 'contodestinazione', 'destinazione', 'versoconto'],
  category: ['categoria', 'category'],
  subcategory: ['sottocategoria', 'subcategory', 'sottocat'],
  description: ['descrizione', 'description', 'nome', 'name'],
  amount: ['importo', 'amount', 'valore'],
  currency: ['valuta', 'currency', 'divisa'],
  id: ['id', 'rowid', 'idoperazione', 'transactionid', 'idtransaction'],
  kind: ['tipo', 'type'],
  expenseType: ['tipospesa', 'tipologiadispesa', 'expensetype'],
} as const

type HeaderKey = keyof typeof HEADER_ALIASES

function headerMap(header: unknown[]): Partial<Record<HeaderKey, number>> {
  const mapped: Partial<Record<HeaderKey, number>> = {}
  header.forEach((value, index) => {
    const key = normalizeKey(value)
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [HeaderKey, readonly string[]][]) {
      const isProviderId = field === 'id' && key.startsWith('idcomunica')
      if (mapped[field] === undefined && (aliases.includes(key) || isProviderId)) mapped[field] = index
    }
  })
  return mapped
}

function value(row: unknown[], map: Partial<Record<HeaderKey, number>>, field: HeaderKey): unknown {
  const index = map[field]
  return index === undefined ? undefined : row[index]
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function dateValue(value: unknown): string | null {
  const parsed = parseDate(value)
  if (parsed) return parsed
  const raw = text(value)
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serialDate = parseDate(Number(raw))
    if (serialDate) return serialDate
  }
  const match = /^(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})$/i.exec(raw)
  if (!match) return null
  const months: Record<string, number> = {
    gennaio: 1, gen: 1, january: 1, jan: 1,
    febbraio: 2, feb: 2, february: 2,
    marzo: 3, mar: 3, march: 3,
    aprile: 4, apr: 4, april: 4,
    maggio: 5, mag: 5, may: 5,
    giugno: 6, giu: 6, june: 6, jun: 6,
    luglio: 7, lug: 7, july: 7, jul: 7,
    agosto: 8, ago: 8, august: 8, aug: 8,
    settembre: 9, set: 9, sep: 9, september: 9,
    ottobre: 10, ott: 10, october: 10, oct: 10,
    novembre: 11, nov: 11, november: 11,
    dicembre: 12, dic: 12, december: 12, dec: 12,
  }
  const month = months[match[2].toLocaleLowerCase('it')]
  if (!month) return null
  return parseDate(`${match[3]}-${month}-${match[1]}`)
}

function canonicalLabel(value: unknown): string {
  return text(value).replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ')
}

function kindValue(value: unknown, amount: number): LedgerKind {
  const key = normalizeKey(value)
  if (key.includes('trasfer') || key.includes('transfer') || key.includes('topup') || key.includes('ricarica')) return 'transfer'
  if (key.includes('spesa') || key.includes('expense') || key.includes('pagamento') || key.includes('payment')) return 'expense'
  if (key.includes('guadagno') || key.includes('entrata') || key.includes('income') || key.includes('rimborso') || key.includes('interest')) return 'income'
  return amount < 0 ? 'expense' : 'income'
}

function accountKey(value: string): string {
  const key = normalizeKey(value)
  if (key.includes('traderepublic') || key.includes('brokerrepublic')) return 'traderepublic'
  if (key.includes('revolut')) return 'revolut'
  if (key.includes('satispay')) return 'satispay'
  return key
}

function operationAccountMatches(ledger: LedgerRow, account: string): boolean {
  const target = accountKey(account)
  return accountKey(ledger.account) === target || (ledger.kind === 'transfer' && accountKey(ledger.toAccount) === target)
}

function amountForAccount(ledger: LedgerRow, account: string): { amount: number; currency: string } {
  if (ledger.kind === 'transfer' && accountKey(ledger.toAccount) === accountKey(account)) {
    return { amount: ledger.amount, currency: ledger.currency }
  }
  return { amount: ledger.amount, currency: ledger.currency }
}

export function parseLedgerRows(rows: unknown[][]): { records: LedgerRow[]; issues: FileIssue[]; categories: CategoryOption[] } {
  const issues: FileIssue[] = []
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell)))
  if (headerIndex < 0) return { records: [], issues: [{ severity: 'error', code: 'empty_file', message: 'Il file generale è vuoto.' }], categories: [] }

  const map = headerMap(rows[headerIndex])
  const required: HeaderKey[] = ['date', 'kind', 'account', 'amount']
  const missing = required.filter((field) => map[field] === undefined)
  if (missing.length) {
    return {
      records: [],
      issues: [{ severity: 'error', code: 'invalid_headers', message: `Nel file generale mancano le colonne: ${missing.join(', ')}.` }],
      categories: [],
    }
  }

  const records: LedgerRow[] = []
  const seen = new Set<string>()
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index]
    if (!row?.some((cell) => text(cell))) continue
    const rowNumber = index + 1
    const rawAmount = parseAmount(value(row, map, 'amount'))
    const date = dateValue(value(row, map, 'date'))
    const account = text(value(row, map, 'account'))
    const rawKind = text(value(row, map, 'kind'))
    if (rawAmount === null || !date || !account || !rawKind) {
      issues.push({ severity: 'error', row: rowNumber, code: 'invalid_row', message: 'Data, tipo, conto o importo mancanti/non validi.' })
      continue
    }
    const kind = kindValue(rawKind, rawAmount)
    const explicitId = text(value(row, map, 'id'))
    const category = canonicalLabel(value(row, map, 'category'))
    const subcategory = canonicalLabel(value(row, map, 'subcategory'))
    const description = text(value(row, map, 'description'))
    const currency = parseCurrency(value(row, map, 'currency')) ?? 'EUR'
    const toAccount = text(value(row, map, 'toAccount'))
    if (kind === 'transfer' && !toAccount) {
      issues.push({ severity: 'warning', row: rowNumber, code: 'transfer_destination_missing', message: 'Trasferimento senza conto di destinazione.' })
    }
    const id = explicitId || `${date}|${accountKey(account)}|${rawAmount}|${normalizeKey(description)}`
    if (seen.has(id)) {
      issues.push({ severity: 'warning', row: rowNumber, code: 'duplicate_ledger_row', message: 'Riga duplicata nel file generale.' })
      continue
    }
    seen.add(id)
    records.push({
      id,
      row: rowNumber,
      date,
      kind,
      expenseType: parseExpenseType(value(row, map, 'expenseType')) ?? undefined,
      account,
      toAccount,
      category,
      subcategory,
      amount: Math.abs(rawAmount),
      currency,
      description,
    })
  }

  const categories = extractCategoryOptions(records)
  return { records, issues, categories }
}

export function parseStatementRows(
  rows: unknown[][],
  provider: StatementProvider,
  fileName: string,
  accountOverride?: string,
): { records: StatementRow[]; issues: FileIssue[] } {
  const issues: FileIssue[] = []
  const headerIndex = rows.findIndex((row) => row.some((cell) => text(cell)))
  if (headerIndex < 0) return { records: [], issues: [{ severity: 'error', code: 'empty_file', message: 'Il file non contiene righe.' }] }
  const header = rows[headerIndex]
  const map = headerMap(header)
  const normalizedHeaders = new Set(header.map(normalizeKey))
  const hasRevolutSavings = normalizedHeaders.has('entrate') && normalizedHeaders.has('uscite')
  const hasProviderHeaders =
    (provider === 'revolut' && normalizedHeaders.has('datadicompletamento') && normalizedHeaders.has('prodotto')) ||
    (provider === 'revolut-savings' && hasRevolutSavings) ||
    (provider === 'trade-republic' && normalizedHeaders.has('transactionid') && normalizedHeaders.has('accounttype')) ||
    (provider === 'satispay' && normalizedHeaders.has('disponibilitadopolatransazione'))
  if (!hasProviderHeaders) {
    return { records: [], issues: [{ severity: 'error', code: 'unsupported_format', message: `Formato ${provider} non riconosciuto nel file "${fileName}".` }] }
  }

  const detectedAccount =
    accountOverride?.trim() ||
    (provider === 'trade-republic' ? 'Trade Republic' : provider.startsWith('revolut') ? 'Revolut' : 'Satispay')
  const records: StatementRow[] = []
  const seenIds = new Set<string>()
  const seenFingerprints = new Set<string>()

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index]
    if (!row?.some((cell) => text(cell))) continue
    const rowNumber = index + 1
    let rawAmount: number | null
    let rawDate: unknown
    let rawType: unknown
    let rawDescription: unknown
    let rawId: unknown
    let rawCurrency: unknown
    let rawStatus: unknown
    let fee = 0

    if (provider === 'revolut-savings') {
      rawDate = row[map.date ?? 0]
      const incoming = parseAmount(row[normalizedHeaders.has('entrate') ? header.findIndex((c) => normalizeKey(c) === 'entrate') : -1]) ?? 0
      const outgoing = parseAmount(row[normalizedHeaders.has('uscite') ? header.findIndex((c) => normalizeKey(c) === 'uscite') : -1]) ?? 0
      rawAmount = Math.abs(incoming || outgoing)
      rawType = incoming > 0 ? 'INTEREST_PAYMENT' : 'PAYMENT'
      rawDescription = value(row, map, 'description')
      rawCurrency = 'EUR'
      rawStatus = 'COMPLETATO'
      rawId = ''
    } else {
      rawDate = provider === 'revolut' ? row[header.findIndex((cell) => normalizeKey(cell) === 'datadicompletamento')] ?? value(row, map, 'date') : value(row, map, 'date')
      rawType = value(row, map, 'kind')
      rawDescription = value(row, map, 'description')
      rawCurrency = value(row, map, 'currency')
      rawStatus = row[header.findIndex((cell) => ['state', 'stato'].includes(normalizeKey(cell)))]
      rawId = value(row, map, 'id')
      const amountValue = value(row, map, 'amount')
      rawAmount = parseAmount(amountValue)
      if (provider === 'revolut') {
        const feeIndex = header.findIndex((cell) => normalizeKey(cell) === 'costo')
        fee = feeIndex >= 0 ? Math.abs(parseAmount(row[feeIndex]) ?? 0) : 0
      } else if (provider === 'trade-republic') {
        const feeIndex = header.findIndex((cell) => normalizeKey(cell) === 'fee')
        fee = feeIndex >= 0 ? Math.abs(parseAmount(row[feeIndex]) ?? 0) : 0
      }
    }

    const date = dateValue(rawDate)
    if (!date || rawAmount === null || rawAmount === 0) {
      issues.push({ severity: 'error', row: rowNumber, code: 'invalid_statement_row', message: 'Data o importo non validi: riga esclusa.' })
      continue
    }
    const amountSigned = parseAmount(
      provider === 'revolut-savings'
        ? (rawType === 'INTEREST_PAYMENT' ? rawAmount : -rawAmount)
        : value(row, map, 'amount'),
    )
    const typeKey = normalizeKey(rawType)
    const isInvestment = provider === 'trade-republic' && ['buy', 'sell', 'dividend', 'interestpayment'].includes(typeKey)
    const kind = kindValue(rawType, amountSigned ?? rawAmount)
    const currency = parseCurrency(rawCurrency) ?? 'EUR'
    const id = text(rawId)
    const description = text(rawDescription)
    const fingerprint = `${date}|${accountKey(detectedAccount)}|${Math.abs(rawAmount)}|${currency}|${normalizeKey(description)}`
    if ((id && seenIds.has(id)) || (!id && seenFingerprints.has(fingerprint))) {
      issues.push({ severity: 'warning', row: rowNumber, code: 'duplicate_statement_row', message: 'Possibile duplicato nello stesso estratto.' })
      continue
    }
    if (id) seenIds.add(id)
    seenFingerprints.add(fingerprint)
    const status = text(rawStatus)
    if (status && /pending|in sospeso/i.test(status)) {
      issues.push({ severity: 'warning', row: rowNumber, code: 'pending_transaction', message: 'Operazione ancora in sospeso: il confronto potrebbe cambiare.' })
    }
    records.push({
      id: id || `statement-${rowNumber}-${fingerprint}`,
      row: rowNumber,
      provider,
      date,
      kind,
      expenseType: isInvestment ? 'investment' : undefined,
      account: detectedAccount,
      amount: Math.abs(rawAmount),
      fee,
      currency,
      description,
      status,
    })
  }
  return { records, issues }
}

export function extractCategoryOptions(records: LedgerRow[]): CategoryOption[] {
  const categories = new Map<string, { name: string; subcategories: Map<string, string> }>()
  for (const record of records) {
    if (!record.category) continue
    const category = canonicalLabel(record.category)
    const key = normalizeKey(category)
    if (!key) continue
    const entry = categories.get(key) ?? { name: category, subcategories: new Map<string, string>() }
    categories.set(key, entry)
    if (record.subcategory) {
      const subcategory = canonicalLabel(record.subcategory)
      const subKey = normalizeKey(subcategory)
      if (subKey && !entry.subcategories.has(subKey)) entry.subcategories.set(subKey, subcategory)
    }
  }
  return [...categories.values()]
    .map(({ name, subcategories }) => ({
      name,
      subcategories: [...subcategories.values()].sort((a, b) => a.localeCompare(b, 'it')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

function descriptionsMatch(a: string, b: string): boolean {
  const left = normalizeKey(a)
  const right = normalizeKey(b)
  if (!left || !right) return false
  if (left === right || left.includes(right) || right.includes(left)) return true
  const aTokens = new Set(left.match(/[a-z0-9]{3,}/g) ?? [])
  const bTokens = new Set(right.match(/[a-z0-9]{3,}/g) ?? [])
  if (!aTokens.size || !bTokens.size) return false
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length
  return overlap / Math.max(aTokens.size, bTokens.size) >= 0.5
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

function amountMatches(statement: StatementRow, ledger: LedgerRow): boolean {
  const expected = amountForAccount(ledger, statement.account)
  return expected.amount === statement.amount && expected.currency === statement.currency
}

function ledgerKindMatches(statement: StatementRow, ledger: LedgerRow): boolean {
  if (ledger.kind === statement.kind) return true
  return ledger.kind === 'transfer' && statement.kind === 'transfer'
}

export function reconcileStatements(ledgerRows: LedgerRow[], statements: StatementRow[]): ReconciliationItem[] {
  const claimed = new Set<string>()
  const results: ReconciliationItem[] = []
  const seenStatement = new Set<string>()

  for (const statement of statements) {
    const statementKey = `${statement.provider}|${statement.id}`
    if (seenStatement.has(statementKey)) {
      results.push({ key: `${statementKey}|duplicate`, status: 'duplicate', statement })
      continue
    }
    seenStatement.add(statementKey)
    const candidates = ledgerRows.filter((ledger) => !claimed.has(ledger.id) && operationAccountMatches(ledger, statement.account) && ledgerKindMatches(statement, ledger))
    const exact = candidates.find((ledger) => ledger.date === statement.date && amountMatches(statement, ledger))
    if (exact) {
      claimed.add(exact.id)
      results.push({ key: statementKey, status: 'matched', statement, ledger: exact })
      continue
    }

    const sameDayAmount = candidates.find((ledger) => ledger.date === statement.date && amountMatches(statement, ledger))
    if (sameDayAmount) {
      claimed.add(sameDayAmount.id)
      results.push({
        key: statementKey,
        status: 'description_mismatch',
        statement,
        candidate: sameDayAmount,
        amountDifference: statement.amount - amountForAccount(sameDayAmount, statement.account).amount,
      })
      continue
    }

    const sameDayDescription = candidates.find((ledger) => ledger.date === statement.date && descriptionsMatch(statement.description, ledger.description))
    if (sameDayDescription) {
      claimed.add(sameDayDescription.id)
      const expected = amountForAccount(sameDayDescription, statement.account)
      if (expected.currency !== statement.currency) {
        results.push({
          key: statementKey,
          status: 'currency_mismatch',
          statement,
          candidate: sameDayDescription,
        })
        continue
      }
      results.push({
        key: statementKey,
        status: 'amount_mismatch',
        statement,
        candidate: sameDayDescription,
        amountDifference: statement.amount - amountForAccount(sameDayDescription, statement.account).amount,
      })
      continue
    }

    const nearby = candidates.find((ledger) => {
      const distance = Math.abs(daysBetween(statement.date, ledger.date))
      return distance <= 3 && amountMatches(statement, ledger) && descriptionsMatch(statement.description, ledger.description)
    })
    if (nearby) {
      claimed.add(nearby.id)
      results.push({
        key: statementKey,
        status: 'date_mismatch',
        statement,
        candidate: nearby,
        dateDifference: daysBetween(statement.date, nearby.date),
      })
      continue
    }
    results.push({ key: statementKey, status: 'missing_in_general', statement })
  }

  const coverage = new Map<string, { from: string; to: string }>()
  for (const statement of statements) {
    const key = accountKey(statement.account)
    const current = coverage.get(key)
    coverage.set(key, {
      from: current && current.from < statement.date ? current.from : statement.date,
      to: current && current.to > statement.date ? current.to : statement.date,
    })
  }
  for (const ledger of ledgerRows) {
    if (claimed.has(ledger.id)) continue
    const accounts = ledger.kind === 'transfer' ? [ledger.account, ledger.toAccount] : [ledger.account]
    const inCoverage = accounts.some((account) => {
      const range = coverage.get(accountKey(account))
      return range && ledger.date >= range.from && ledger.date <= range.to
    })
    if (inCoverage) results.push({ key: `ledger|${ledger.id}`, status: 'missing_in_statement', ledger })
  }
  return results
}
