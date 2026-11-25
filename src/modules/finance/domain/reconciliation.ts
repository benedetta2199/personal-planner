/**
 * Riconciliazione tra gli estratti conto scaricati dalle app (Revolut, Trade Republic,
 * Satispay) e i movimenti del foglio Google del bilancio.
 *
 * Porting della logica del notebook «Finanze (build_csv+check)», con queste differenze:
 *  - il confronto avviene con i movimenti già sincronizzati (nessun CSV intermedio);
 *  - le differenze non vengono «assorbite» in silenzio (tolleranza sui centesimi, date
 *    sfasate): sono mostrate come tali, così si possono correggere sul foglio;
 *  - un trasferimento è confrontato da entrambi i lati (uscita dal conto di origine,
 *    entrata nel conto di destinazione) e solo entro pochi giorni, mai a qualsiasi data.
 */
import { normalizeKey, parseAmount, parseCurrency, parseDate } from './parsers.js'
import type { ExpenseType, Operation } from './types.js'

export type StatementProvider = 'revolut' | 'revolut-savings' | 'trade-republic' | 'satispay'
export type StatementKind = 'income' | 'expense' | 'transfer'
export type Direction = 'in' | 'out'

export interface StatementRow {
  id: string
  /** Riga del file (1-based); per gli interessi aggregati, la prima riga del mese. */
  row: number
  provider: StatementProvider
  date: string
  kind: StatementKind
  /** Entrata o uscita per il conto dell'estratto. */
  direction: Direction
  expenseType?: ExpenseType
  /** Conto come rilevato dall'estratto (es. «Revolut», «Revolut Deposito»), poi associato a un conto dell'app. */
  account: string
  /** Importo positivo in centesimi, già al netto di commissioni e tasse. */
  amount: number
  currency: string
  description: string
  status: string
  /** Interessi del mese sommati in una sola riga (come nel foglio). */
  interest?: boolean
}

export interface FileIssue {
  severity: 'error' | 'warning'
  row?: number
  code: string
  message: string
}

export type ReconciliationStatus =
  | 'matched'
  | 'matched_group'
  | 'date_mismatch'
  | 'amount_mismatch'
  | 'duplicate'
  | 'missing_in_general'
  | 'missing_in_statement'

/** Un movimento del foglio visto da uno dei conti coinvolti. */
export interface LedgerSide {
  op: Operation
  account: string
  direction: Direction
  amount: number
  currency: string
}

export interface ReconciliationItem {
  key: string
  status: ReconciliationStatus
  statements: StatementRow[]
  sides: LedgerSide[]
  /** Estratto − foglio, in centesimi. */
  amountDifference?: number
  /** Giorni tra la data dell'estratto e quella del foglio (estratto − foglio). */
  dateDifference?: number
}

// ---------------------------------------------------------------------------
// Lettura degli estratti
// ---------------------------------------------------------------------------

const HEADER_ALIASES = {
  date: ['giorno', 'data', 'date', 'datetime'],
  description: ['descrizione', 'description', 'nome', 'name'],
  amount: ['importo', 'amount', 'valore'],
  currency: ['valuta', 'currency', 'divisa'],
  id: ['id', 'rowid', 'idoperazione', 'transactionid', 'idtransaction'],
  kind: ['tipo', 'type'],
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

const text = (value: unknown) => String(value ?? '').trim()

const MONTHS: Record<string, number> = {
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

/** Date ISO, seriali, gg/mm/aaaa e «30 apr 2026» / «30 Apr 2026». */
export function statementDate(value: unknown): string | null {
  const parsed = parseDate(value)
  if (parsed) return parsed
  const raw = text(value)
  if (/^\d+(?:\.\d+)?$/.test(raw)) return parseDate(Number(raw))
  const match = /^(\d{1,2})\s+([a-zà-ÿ]+)\.?\s+(\d{4})/i.exec(raw)
  if (!match) return null
  const month = MONTHS[match[2].toLocaleLowerCase('it')]
  return month ? parseDate(`${match[3]}-${month}-${match[1]}`) : null
}

/** Importo anche con simboli di valuta corrotti dalla codifica (es. «200,07â‚¬» di Revolut). */
function statementAmount(value: unknown): number | null {
  const direct = parseAmount(value)
  if (direct !== null) return direct
  const cleaned = text(value).replace(/[^\d,.()+-]/g, '')
  return cleaned ? parseAmount(cleaned) : null
}

const SKIPPED_STATUS = /revert|annullat|rifiutat|fallit|declin|cancel|failed|stornat/i
const PENDING_STATUS = /pending|in sospeso|in attesa/i
/** Trasferimenti di Revolut verso/da salvadanai e conti deposito. */
const REVOLUT_POCKET = /\b(a|da|to|from)\s+(eur\s+)?conto\b|conto deposito|conto vacanze|salvadanaio|pocket|vault/i

function cell(row: unknown[], header: unknown[], ...names: string[]): unknown {
  const index = header.findIndex((c) => names.includes(normalizeKey(c)))
  return index >= 0 ? row[index] : undefined
}

export const DEFAULT_ACCOUNT: Record<StatementProvider, string> = {
  revolut: 'Revolut',
  'revolut-savings': 'Revolut Deposito',
  'trade-republic': 'Trade Republic',
  satispay: 'Satispay',
}
const REVOLUT_SAVINGS_ACCOUNT = 'Revolut Deposito'

interface RawStatement {
  row: number
  date: string
  signed: number
  kind: StatementKind
  expenseType?: ExpenseType
  account: string
  currency: string
  description: string
  status: string
  id: string
  interest?: boolean
}

/** Riconosce il formato dalle intestazioni (e, per l'estratto dei depositi Revolut, dal nome del file). */
export function detectProvider(rows: unknown[][], fileName = ''): StatementProvider | null {
  const header = rows.find((row) => row.some((c) => text(c)))
  if (!header) return null
  const h = new Set(header.map(normalizeKey))
  if (h.has('transactionid') && h.has('accounttype')) return 'trade-republic'
  if (h.has('datadicompletamento') && h.has('prodotto')) return 'revolut'
  if (h.has('entrate') && h.has('uscite') && (h.has('saldo') || normalizeKey(fileName).includes('revolut'))) return 'revolut-savings'
  if (h.has('disponibilitadopolatransazione') || (h.has('stato') && h.has('nome') && h.has('importo'))) return 'satispay'
  return null
}

/**
 * Legge le righe di un estratto. Come nel notebook:
 *  - Revolut: solo operazioni completate; data di inizio (quella dell'acquisto); del prodotto
 *    «Deposito» si tengono solo gli interessi, sommati per mese;
 *  - Trade Republic: solo conto DEFAULT, senza Saveback; importo = amount + fee + tax;
 *    interessi sommati per mese;
 *  - Satispay: solo operazioni approvate;
 *  - estratto depositi Revolut: depositi/prelievi e interessi sommati per mese.
 */
export function parseStatementRows(rows: unknown[][], provider: StatementProvider, fileName: string): { records: StatementRow[]; issues: FileIssue[] } {
  const issues: FileIssue[] = []
  const headerIndex = rows.findIndex((row) => row.some((c) => text(c)))
  if (headerIndex < 0) return { records: [], issues: [{ severity: 'error', code: 'empty_file', message: 'Il file non contiene righe.' }] }
  const header = rows[headerIndex]
  if (detectProvider([header], fileName) !== provider) {
    return { records: [], issues: [{ severity: 'error', code: 'unsupported_format', message: `Formato ${provider} non riconosciuto nel file «${fileName}».` }] }
  }
  const map = headerMap(header)
  const get = (row: unknown[], field: HeaderKey) => (map[field] === undefined ? undefined : row[map[field]!])

  const raws: RawStatement[] = []
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index]
    if (!row?.some((c) => text(c))) continue
    const rowNumber = index + 1
    const parsed = readRow(provider, row, header, get)
    if (parsed === 'skip') continue
    if (!parsed) {
      issues.push({ severity: 'error', row: rowNumber, code: 'invalid_statement_row', message: 'Data o importo non validi: riga esclusa.' })
      continue
    }
    if (PENDING_STATUS.test(parsed.status)) {
      issues.push({ severity: 'warning', row: rowNumber, code: 'pending_transaction', message: 'Operazione ancora in sospeso: il confronto potrebbe cambiare.' })
    }
    raws.push({ ...parsed, row: rowNumber })
  }

  const records: StatementRow[] = []
  const seen = new Set<string>()
  const interests = new Map<string, RawStatement[]>()
  for (const r of raws) {
    if (r.interest) {
      const key = `${r.account}|${r.currency}|${r.date.slice(0, 7)}`
      interests.set(key, [...(interests.get(key) ?? []), r])
      continue
    }
    const fingerprint = `${r.date}|${normalizeKey(r.account)}|${r.signed}|${r.currency}|${normalizeKey(r.description)}`
    const id = r.id || `${provider}-${r.row}-${fingerprint}`
    if (r.id && seen.has(r.id)) {
      issues.push({ severity: 'warning', row: r.row, code: 'duplicate_statement_row', message: 'Operazione ripetuta nello stesso estratto: ignorata.' })
      continue
    }
    seen.add(id)
    records.push(toRecord(provider, r, id))
  }
  // Interessi: una riga al mese, alla data dell'ultimo accredito (come nel foglio).
  for (const [key, group] of interests) {
    const total = group.reduce((s, r) => s + r.signed, 0)
    if (total === 0) continue
    const last = group.reduce((a, b) => (b.date > a.date ? b : a))
    const month = last.date.slice(0, 7)
    records.push(
      toRecord(
        provider,
        { ...last, row: group[0].row, signed: total, kind: 'income', description: `Interessi ${last.account} ${month} (${group.length} accrediti)` },
        `${provider}-interessi-${normalizeKey(key)}`,
        true,
      ),
    )
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
  return { records, issues }
}

function toRecord(provider: StatementProvider, r: RawStatement, id: string, interest = false): StatementRow {
  return {
    id,
    row: r.row,
    provider,
    date: r.date,
    kind: r.kind,
    direction: r.signed < 0 ? 'out' : 'in',
    expenseType: r.expenseType,
    account: r.account,
    amount: Math.abs(r.signed),
    currency: r.currency,
    description: r.description,
    status: r.status,
    ...(interest ? { interest: true } : {}),
  }
}

type Getter = (row: unknown[], field: HeaderKey) => unknown
type ParsedRow = Omit<RawStatement, 'row'>

function readRow(provider: StatementProvider, row: unknown[], header: unknown[], get: Getter): ParsedRow | null | 'skip' {
  const status = text(cell(row, header, 'state', 'stato'))
  if (status && SKIPPED_STATUS.test(status)) return 'skip'
  const description = text(get(row, 'description'))

  if (provider === 'revolut') {
    const date = statementDate(cell(row, header, 'datadiinizio') ?? cell(row, header, 'datadicompletamento'))
    const amount = statementAmount(get(row, 'amount'))
    if (amount === 0) return 'skip' // es. «Closing transaction»
    if (!date || amount === null) return null
    const type = normalizeKey(get(row, 'kind'))
    const isInterest = type.includes('interess') || type.includes('interest')
    // La commissione è un'uscita in più; sugli interessi («netti») è la ritenuta, già esclusa dall'importo.
    const fee = isInterest ? 0 : Math.abs(statementAmount(cell(row, header, 'costo')) ?? 0)
    const signed = amount - fee
    const product = normalizeKey(cell(row, header, 'prodotto'))
    const currency = parseCurrency(get(row, 'currency')) ?? 'EUR'
    if (product && product !== 'attuale' && product !== 'current') {
      // Salvadanai/conti deposito: i movimenti compaiono già sul conto principale; si tengono gli interessi.
      if (!isInterest) return 'skip'
      return { date, signed, kind: 'income', account: REVOLUT_SAVINGS_ACCOUNT, currency, description, status, id: '', interest: true }
    }
    let kind: StatementKind
    if (type.includes('ricarica') || type.includes('topup') || type.includes('cambiavaluta') || type.includes('exchange') || REVOLUT_POCKET.test(description)) kind = 'transfer'
    else if (isInterest) kind = 'income'
    else if (type.includes('rimborso') || type.includes('refund')) kind = 'income'
    else kind = signed < 0 ? 'expense' : 'income'
    const id = text(get(row, 'id'))
    return { date, signed, kind, account: DEFAULT_ACCOUNT.revolut, currency, description, status, id, interest: isInterest }
  }

  if (provider === 'revolut-savings') {
    const date = statementDate(get(row, 'date'))
    const incoming = Math.abs(statementAmount(cell(row, header, 'entrate')) ?? 0)
    const outgoing = Math.abs(statementAmount(cell(row, header, 'uscite')) ?? 0)
    const signed = incoming - outgoing
    if (signed === 0) return 'skip'
    if (!date) return null
    const isInterest = /interess|interest/i.test(description)
    return {
      date,
      signed,
      kind: isInterest ? 'income' : 'transfer',
      account: REVOLUT_SAVINGS_ACCOUNT,
      currency: 'EUR',
      description,
      status: 'COMPLETATO',
      id: '',
      interest: isInterest,
    }
  }

  if (provider === 'trade-republic') {
    const accountType = normalizeKey(cell(row, header, 'accounttype'))
    if (accountType && accountType !== 'default') return 'skip'
    const type = normalizeKey(get(row, 'kind'))
    if (type.includes('saveback')) return 'skip'
    // «date» è la data locale; «datetime» è in UTC e può cadere il giorno prima.
    const date = statementDate(cell(row, header, 'date') || get(row, 'date'))
    const amount = statementAmount(get(row, 'amount'))
    if (amount === 0) return 'skip'
    if (!date || amount === null) return null
    const signed = amount + (statementAmount(cell(row, header, 'fee')) ?? 0) + (statementAmount(cell(row, header, 'tax')) ?? 0)
    const name = text(cell(row, header, 'name'))
    const fullDescription = description || name
    const currency = parseCurrency(get(row, 'currency')) ?? 'EUR'
    const id = text(get(row, 'id'))
    const base = { date, signed, account: DEFAULT_ACCOUNT['trade-republic'], currency, description: fullDescription, status, id }
    if (type.includes('interest')) return { ...base, kind: 'income', interest: true }
    if (type === 'buy') return { ...base, kind: 'expense', expenseType: 'investment', description: name || fullDescription }
    if (type === 'sell' || type.includes('dividend')) return { ...base, kind: 'income', description: name || fullDescription }
    if (type.includes('transfer')) return { ...base, kind: 'transfer' }
    return { ...base, kind: signed < 0 ? 'expense' : 'income' }
  }

  // Satispay
  const date = statementDate(get(row, 'date'))
  const amount = statementAmount(get(row, 'amount'))
  if (amount === 0) return 'skip'
  if (!date || amount === null) return null
  const name = text(cell(row, header, 'nome'))
  const desc = text(cell(row, header, 'descrizione'))
  const type = normalizeKey(get(row, 'kind'))
  const kind: StatementKind =
    type.includes('ricarica') || type.includes('prelievo') || type.includes('trasferiment') || isSatispayTopUp(`${name} ${desc}`, amount)
      ? 'transfer'
      : amount < 0
        ? 'expense'
        : 'income'
  return {
    date,
    signed: amount,
    kind,
    account: DEFAULT_ACCOUNT.satispay,
    currency: parseCurrency(get(row, 'currency')) ?? 'EUR',
    description: [name, desc && desc !== name ? desc : ''].filter(Boolean).join(' · '),
    status,
    id: text(get(row, 'id')),
  }
}

/** Ricarica di Satispay dal conto bancario: entrata con «Ricarica Satispay» nella descrizione. */
function isSatispayTopUp(description: string, signed: number): boolean {
  return signed > 0 && /ricarica\s+satispay/i.test(description)
}

// ---------------------------------------------------------------------------
// Associazione dei conti
// ---------------------------------------------------------------------------

const accountWords = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Propone il conto dell'app per un conto rilevato nell'estratto: prima per nome o alias,
 * poi per parole chiave (es. «Revolut Deposito» → un conto con «deposito» o «vacanze»).
 */
export function suggestAccount(label: string, accounts: { name: string; aliases?: string[] }[]): string {
  const key = normalizeKey(label)
  const byName = accounts.find((a) => [a.name, ...(a.aliases ?? [])].some((n) => normalizeKey(n) === key))
  if (byName) return byName.name
  const words = accountWords(label)
  const has = (a: { name: string; aliases?: string[] }, re: RegExp) => [a.name, ...(a.aliases ?? [])].some((n) => re.test(accountWords(n)))
  if (/deposito|savings/.test(words)) {
    const brand = words.split(/\s+/)[0]
    const pocket = accounts.find((a) => has(a, /deposit|vacanz|risparm|salvadanai|pocket|vault/) && has(a, new RegExp(brand)))
      ?? accounts.find((a) => has(a, /deposit|vacanz|risparm|salvadanai/))
    return pocket?.name ?? ''
  }
  const compact = key.replace(/\s/g, '')
  const partial = accounts.find((a) => {
    const n = normalizeKey(a.name)
    return n.length >= 4 && (compact.includes(n) || n.includes(compact)) && !has(a, /deposit|vacanz|risparm/)
  })
  return partial?.name ?? ''
}

// ---------------------------------------------------------------------------
// Confronto
// ---------------------------------------------------------------------------

/** Finestra (giorni) per le date sfasate: come nel notebook. */
export const NEAR_DAYS = 3
/** Differenza d'importo sempre considerata «stessa operazione» (commissioni, arrotondamenti). */
const SMALL_DIFF = 50
const MAX_GROUP = 5
const MAX_GROUP_CANDIDATES = 14

const norm = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('it')

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

export function descriptionsMatch(a: string, b: string): boolean {
  const left = normalizeKey(a)
  const right = normalizeKey(b)
  if (!left || !right) return false
  if (left === right || (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left)))) return true
  const tokens = (s: string) => new Set(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  const at = tokens(a)
  const bt = tokens(b)
  if (!at.size || !bt.size) return false
  const overlap = [...at].filter((t) => bt.has(t)).length
  return overlap / Math.min(at.size, bt.size) >= 0.5
}

/** Movimenti del foglio scomposti per conto: un trasferimento ha un lato in uscita e uno in entrata. */
export function ledgerSides(operations: Operation[]): LedgerSide[] {
  const sides: LedgerSide[] = []
  for (const op of operations) {
    if (op.kind === 'transfer') {
      sides.push({ op, account: op.account, direction: 'out', amount: op.amount, currency: op.currency })
      if (op.toAccount) sides.push({ op, account: op.toAccount, direction: 'in', amount: op.toAmount || op.amount, currency: op.toCurrency || op.currency })
    } else {
      sides.push({ op, account: op.account, direction: op.kind === 'income' ? 'in' : 'out', amount: op.amount, currency: op.currency })
    }
  }
  return sides
}

const signedAmount = (s: StatementRow) => (s.direction === 'out' ? -s.amount : s.amount)
const sideKey = (s: LedgerSide) => `${s.op.id}|${s.direction}`
export const statementKey = (s: StatementRow) => `${s.provider}|${s.id}`
export const itemKey = (item: Pick<ReconciliationItem, 'statements' | 'sides'>) =>
  item.statements.length ? item.statements.map(statementKey).join('+') : item.sides.map((s) => `ledger|${sideKey(s)}`).join('+')

/** Primo sottoinsieme (2..MAX_GROUP elementi) con somma esattamente uguale a `target`. */
function subsetSum<T>(items: T[], amountOf: (x: T) => number, target: number): T[] | null {
  const pool = items.slice(0, MAX_GROUP_CANDIDATES)
  const pick: T[] = []
  const search = (start: number, left: number): boolean => {
    if (left === 0 && pick.length >= 2) return true
    if (left <= 0 || pick.length >= MAX_GROUP) return false
    for (let i = start; i < pool.length; i++) {
      pick.push(pool[i])
      if (search(i + 1, left - amountOf(pool[i]))) return true
      pick.pop()
    }
    return false
  }
  return search(0, target) ? [...pick] : null
}

/**
 * Confronta le righe degli estratti (con `account` già associato al conto dell'app)
 * con i movimenti del foglio. Per ogni conto vengono considerati solo i movimenti nel
 * periodo coperto dall'estratto. Con `since` le righe dell'estratto precedenti a quella data
 * (di solito il primo movimento del foglio) vengono ignorate.
 *
 * Ordine dei controlli (dal più al meno sicuro):
 *  1. stessa data, stesso importo e verso → corrisponde
 *  2. stesso importo, data sfasata di al più NEAR_DAYS giorni → data diversa
 *  3. una riga dell'estratto = somma di più movimenti del foglio (o viceversa) → corrisponde (gruppo)
 *  4. data vicina e importo quasi uguale (o stessa descrizione) → importo diverso
 *  5. il resto: manca nel foglio / manca nell'estratto
 */
export function reconcileStatements(operations: Operation[], statements: StatementRow[], options: { since?: string } = {}): ReconciliationItem[] {
  const results: ReconciliationItem[] = []
  const byAccount = new Map<string, StatementRow[]>()
  const seen = new Set<string>()
  for (const s of statements) {
    // Come nel notebook: le operazioni precedenti al primo movimento del foglio non si confrontano.
    if (options.since && s.date < options.since) continue
    const key = statementKey(s)
    if (seen.has(key)) {
      results.push({ key: `${key}|duplicate`, status: 'duplicate', statements: [s], sides: [] })
      continue
    }
    seen.add(key)
    const account = norm(s.account)
    byAccount.set(account, [...(byAccount.get(account) ?? []), s])
  }

  const allSides = ledgerSides(operations)
  for (const [account, rows] of byAccount) {
    const from = rows.reduce((m, s) => (s.date < m ? s.date : m), rows[0].date)
    const to = rows.reduce((m, s) => (s.date > m ? s.date : m), rows[0].date)
    // Periodo dell'estratto, allargato per le date sfasate.
    const sides = allSides.filter((s) => norm(s.account) === account && daysBetween(from, s.op.date) <= NEAR_DAYS && daysBetween(s.op.date, to) <= NEAR_DAYS)
    results.push(...reconcileAccount(rows, sides, from, to))
  }

  const order: Record<ReconciliationStatus, number> = { amount_mismatch: 0, missing_in_general: 1, missing_in_statement: 2, date_mismatch: 3, duplicate: 4, matched_group: 5, matched: 6 }
  const dateOf = (i: ReconciliationItem) => i.statements[0]?.date ?? i.sides[0]?.op.date ?? ''
  return results.sort((a, b) => order[a.status] - order[b.status] || dateOf(a).localeCompare(dateOf(b)))
}

function reconcileAccount(rows: StatementRow[], sides: LedgerSide[], from: string, to: string): ReconciliationItem[] {
  const out: ReconciliationItem[] = []
  const usedS = new Set<StatementRow>()
  const usedL = new Set<string>()
  const freeSides = () => sides.filter((l) => !usedL.has(sideKey(l)))
  const freeRows = () => rows.filter((s) => !usedS.has(s))
  const compatible = (s: StatementRow, l: LedgerSide) => s.direction === l.direction && s.currency === l.currency
  const push = (status: ReconciliationStatus, st: StatementRow[], ls: LedgerSide[], extra: Partial<ReconciliationItem> = {}) => {
    st.forEach((s) => usedS.add(s))
    ls.forEach((l) => usedL.add(sideKey(l)))
    const item = { status, statements: st, sides: ls, ...extra } as ReconciliationItem
    item.key = itemKey(item)
    out.push(item)
  }
  /** Tra più candidati preferisce la data più vicina, poi la descrizione simile. */
  const best = (s: StatementRow, list: LedgerSide[]) =>
    [...list].sort(
      (a, b) =>
        Math.abs(daysBetween(s.date, a.op.date)) - Math.abs(daysBetween(s.date, b.op.date)) ||
        Number(descriptionsMatch(s.description, b.op.description)) - Number(descriptionsMatch(s.description, a.op.description)),
    )[0]

  // 1. Corrispondenze esatte
  for (const s of rows) {
    const hit = best(s, freeSides().filter((l) => compatible(s, l) && l.op.date === s.date && l.amount === s.amount))
    if (hit) push('matched', [s], [hit])
  }
  // 2. Stesso importo, data sfasata
  for (const s of freeRows()) {
    const hit = best(s, freeSides().filter((l) => compatible(s, l) && l.amount === s.amount && Math.abs(daysBetween(s.date, l.op.date)) <= NEAR_DAYS))
    if (hit) push('date_mismatch', [s], [hit], { dateDifference: daysBetween(s.date, hit.op.date) })
  }
  // Nei gruppi la data può essere sfasata (come nel notebook, ±NEAR_DAYS): si riporta lo scarto maggiore.
  const groupShift = (shifts: number[]) => {
    const max = shifts.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0)
    return max ? { dateDifference: max } : {}
  }
  // 3a. Una riga dell'estratto divisa in più voci nel foglio (es. spesa divisa tra categorie)
  for (const s of freeRows()) {
    const near = freeSides()
      .filter((l) => compatible(s, l) && l.amount < s.amount && Math.abs(daysBetween(s.date, l.op.date)) <= NEAR_DAYS)
      .sort((a, b) => Math.abs(daysBetween(s.date, a.op.date)) - Math.abs(daysBetween(s.date, b.op.date)))
    const group = subsetSum(near, (l) => l.amount, s.amount)
    if (group) push('matched_group', [s], group, groupShift(group.map((l) => daysBetween(s.date, l.op.date))))
  }
  // 3b. Più righe dell'estratto registrate come una sola voce (es. più caffè in un'unica spesa)
  for (const l of freeSides()) {
    const near = freeRows()
      .filter((s) => compatible(s, l) && s.amount < l.amount && Math.abs(daysBetween(s.date, l.op.date)) <= NEAR_DAYS)
      .sort((a, b) => Math.abs(daysBetween(a.date, l.op.date)) - Math.abs(daysBetween(b.date, l.op.date)))
    const group = subsetSum(near, (s) => s.amount, l.amount)
    if (group) push('matched_group', group, [l], groupShift(group.map((s) => daysBetween(s.date, l.op.date))))
  }
  // 4. Importo diverso: data vicina e differenza piccola, oppure stessa descrizione
  for (const s of freeRows()) {
    const candidates = freeSides().filter((l) => {
      if (!compatible(s, l) || Math.abs(daysBetween(s.date, l.op.date)) > 1) return false
      const diff = Math.abs(l.amount - s.amount)
      return diff <= SMALL_DIFF || (descriptionsMatch(s.description, l.op.description) && diff <= Math.max(s.amount, l.amount) / 2)
    })
    const hit = candidates.sort((a, b) => Math.abs(a.amount - s.amount) - Math.abs(b.amount - s.amount))[0]
    if (hit) push('amount_mismatch', [s], [hit], { amountDifference: s.amount - hit.amount, dateDifference: daysBetween(s.date, hit.op.date) })
  }
  // 5. Rimasti
  for (const s of freeRows()) push('missing_in_general', [s], [])
  for (const l of freeSides()) if (l.op.date >= from && l.op.date <= to) push('missing_in_statement', [], [l])
  return out
}

// ---------------------------------------------------------------------------
// Proposte per le voci mancanti
// ---------------------------------------------------------------------------

export interface EntrySuggestion {
  kind: StatementKind
  expenseType?: ExpenseType
  account: string
  toAccount: string
  category: string
  subcategory: string
  description: string
  date: string
  amount: number
}

/**
 * Voce da aggiungere al foglio per una riga dell'estratto mancante. Categoria, tipologia e
 * (per i trasferimenti) l'altro conto vengono copiati dal movimento passato più recente con
 * descrizione simile, se esiste.
 *
 * Eccezione: una ricarica di Satispay è sempre un trasferimento dal conto bancario
 * (`bankAccount`, di default «Conto») a Satispay, senza descrizione.
 */
export function suggestEntry(s: StatementRow, operations: Operation[], options: { bankAccount?: string } = {}): EntrySuggestion {
  if (s.provider === 'satispay' && isSatispayTopUp(s.description, signedAmount(s))) {
    return { kind: 'transfer', account: options.bankAccount || 'Conto', toAccount: s.account, category: '', subcategory: '', description: '', date: s.date, amount: s.amount }
  }
  const similar = [...operations]
    .reverse()
    .find((op) => descriptionsMatch(s.description, op.description) && (op.kind === 'transfer' ? s.kind === 'transfer' : op.kind === (s.direction === 'in' ? 'income' : 'expense') || s.kind === 'transfer'))
  const kind: StatementKind = similar?.kind ?? s.kind
  const base: EntrySuggestion = {
    kind,
    account: s.account,
    toAccount: '',
    category: '',
    subcategory: '',
    description: s.description,
    date: s.date,
    amount: s.amount,
  }
  if (kind === 'transfer') {
    const other = similar?.kind === 'transfer' ? (s.direction === 'in' ? similar.account : similar.toAccount) : ''
    return s.direction === 'in' ? { ...base, account: other, toAccount: s.account } : { ...base, toAccount: other }
  }
  return {
    ...base,
    category: similar && similar.kind !== 'transfer' ? similar.category : '',
    subcategory: similar && similar.kind !== 'transfer' ? similar.subcategory : '',
    expenseType: kind === 'expense' ? (similar?.kind === 'expense' ? similar.expenseType : s.expenseType ?? 'additional') : undefined,
  }
}
