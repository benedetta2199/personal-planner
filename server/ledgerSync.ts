import { timingSafeEqual } from 'node:crypto'
import { appsScriptFromEnv, type AppsScriptClient } from './appsScript.js'
import { googleId, SheetsError, type FetchedSheets } from './googleSheets.js'
import { importFinanceSheets } from '../src/modules/finance/domain/importer.js'
import { normalizeKey } from '../src/modules/finance/domain/parsers.js'
import { ALL_SHEETS, SHEET_SCHEMAS } from '../src/modules/finance/domain/schema.js'
import type { ExpenseType, Operation, RawSheets, SheetName } from '../src/modules/finance/domain/types.js'

/**
 * Scrittura sul Google Sheet del bilancio (tramite il ponte Apps Script):
 *  - voci inserite dall'app → righe in Entrate / Uscite / Transazioni, riconosciute dalla colonna «ID»;
 *  - configurazione dell'app (conti, categorie, icone…) → scheda nascosta «_planner».
 *
 *   POST /api/finance/ledger  { action: 'push', ops }        inserisce o aggiorna le voci
 *                             { action: 'delete', ids }      elimina le righe con quegli ID
 *                             { action: 'row.replace', tab, row, expectedId, op }
 *                                 sostituisce una riga scritta a mano nel foglio (senza ID dell'app):
 *                                 da quel momento la riga ha l'ID «m-…» ed è gestita dall'app
 *                             { action: 'row.delete', tab, row, expectedId }
 *                                 elimina una riga scritta a mano nel foglio
 *
 * Le righe senza ID dell'app sono individuate da scheda + numero di riga; prima di toccarle
 * il server rilegge il foglio e controlla che lì ci sia ancora la stessa voce (stesso ID
 * calcolato dall'importer), così una riga spostata o modificata nel frattempo non viene mai
 * sovrascritta o eliminata per errore.
 *                             { action: 'config.get' }       legge la configurazione salvata
 *                             { action: 'config.put', config, updatedAt }
 */

/** Versione minima di docs/apps-script/Code.gs richiesta (date e schede nascoste). */
export const MIN_SCRIPT_VERSION = 2
export const CONFIG_TAB = '_planner'
const CHUNK = 40000

const TAB_OF: Record<Operation['kind'], SheetName> = { income: 'Entrate', expense: 'Uscite', transfer: 'Transazioni' }
const OP_TABS: SheetName[] = ['Entrate', 'Uscite', 'Transazioni']
const TYPE_LABEL: Record<ExpenseType, string> = { necessary: 'Necessaria', additional: 'Aggiuntiva', investment: 'Investimento' }

type Cell = string | number | { $date: string }

export type LedgerBody =
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: true; config: unknown; updatedAt: string | null }
  | { ok: true; saved: true }
  | { ok: false; code: string; message: string }

export interface LedgerRequest {
  method: string
  authorization?: string
  env: Record<string, string | undefined>
  body: unknown
  fetchImpl?: typeof fetch
}

const fail = (status: number, code: string, message: string) => ({ status, body: { ok: false as const, code, message } })

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ---- Validazione ------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Accetta solo voci create dall'app (ID «m-…») con campi coerenti. */
export function validateOp(input: unknown): Operation | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  const id = str(r.id, 64)
  if (!/^m-[\w-]{4,40}$/.test(id)) return null
  if (!ISO.test(str(r.date))) return null
  if (!['income', 'expense', 'transfer'].includes(String(r.kind))) return null
  if (typeof r.amount !== 'number' || !Number.isInteger(r.amount) || r.amount <= 0) return null
  const base = {
    id,
    date: str(r.date),
    account: str(r.account, 120),
    category: str(r.category, 120),
    subcategory: str(r.subcategory, 120),
    description: str(r.description, 500),
    amount: r.amount,
    currency: str(r.currency, 3).toUpperCase() || 'EUR',
    extra: {},
    source: { sheet: 'Manuale' as const, row: 0 },
  }
  if (!base.account) return null
  if (r.kind === 'expense') {
    const t = r.expenseType
    if (t !== 'necessary' && t !== 'additional' && t !== 'investment') return null
    return { ...base, kind: 'expense', expenseType: t }
  }
  if (r.kind === 'income') return { ...base, kind: 'income' }
  const toAccount = str(r.toAccount, 120)
  const toAmount = typeof r.toAmount === 'number' && Number.isInteger(r.toAmount) && r.toAmount > 0 ? r.toAmount : base.amount
  if (!toAccount) return null
  return { ...base, kind: 'transfer', toAccount, toCurrency: str(r.toCurrency, 3).toUpperCase() || base.currency, toAmount }
}

// ---- Mappatura colonne ----------------------------------------------------------

/** Intestazioni di una scheda nuova: le colonne obbligatorie dello schema + ID. */
export function defaultHeaders(tab: SheetName): string[] {
  const fields = SHEET_SCHEMAS[tab].filter((f) => f.requiredColumn || f.key === 'id')
  return fields.map((f) => f.label)
}

/** Indice di colonna per ogni campo dello schema riconosciuto nell'intestazione. */
export function columnMap(tab: SheetName, headers: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  headers.forEach((h, i) => {
    const k = normalizeKey(h)
    if (!k) return
    const field = SHEET_SCHEMAS[tab].find((f) => normalizeKey(f.label) === k || f.aliases.includes(k))
    if (field && !map.has(field.key)) map.set(field.key, i)
  })
  return map
}

function fieldValue(op: Operation, key: string): Cell | undefined {
  switch (key) {
    case 'date': return { $date: op.date }
    case 'account': return op.account
    case 'category': return op.category
    case 'subcategory': return op.subcategory
    case 'description': return op.description
    case 'amount': return op.amount / 100
    case 'currency': return op.currency
    case 'id': return op.id
    case 'expenseType': return op.kind === 'expense' ? TYPE_LABEL[op.expenseType] : undefined
    case 'toAccount': return op.kind === 'transfer' ? op.toAccount : undefined
    case 'toCurrency': return op.kind === 'transfer' && op.toCurrency !== op.currency ? op.toCurrency : undefined
    case 'toAmount': return op.kind === 'transfer' && op.toAmount !== op.amount ? op.toAmount / 100 : undefined
    default: return undefined
  }
}

/** Riga per la voce: parte dalla riga esistente e sovrascrive solo le colonne note. */
export function buildOpRow(width: number, columns: Map<string, number>, op: Operation, existing?: unknown[]): Cell[] {
  const row: Cell[] = Array.from({ length: width }, (_, i) => {
    const v = existing?.[i]
    return typeof v === 'number' || typeof v === 'string' ? v : ''
  })
  for (const [key, i] of columns) {
    const v = fieldValue(op, key)
    if (v !== undefined) row[i] = v
    else if (key === 'toCurrency' || key === 'toAmount') row[i] = ''
  }
  return row
}

// ---- Accesso alle schede ----------------------------------------------------------

interface Tab {
  name: SheetName
  headers: string[]
  columns: Map<string, number>
  rows: unknown[][]
}

class LedgerSheet {
  private cache = new Map<SheetName, Tab>()

  constructor(
    private readonly bridge: AppsScriptClient,
    private readonly spreadsheetId: string | undefined,
    private readonly baseCurrency?: string,
  ) {}

  private get target() {
    return { spreadsheetId: this.spreadsheetId }
  }

  async checkScript() {
    const { version } = await this.bridge.call<{ version?: number }>('ping')
    if ((version ?? 1) < MIN_SCRIPT_VERSION) {
      throw new SheetsError(
        'script_outdated',
        'Lo script Google è di una versione precedente: incolla di nuovo docs/apps-script/Code.gs e pubblica una «Nuova versione» del deployment.',
        409,
      )
    }
  }

  /** Legge (creandola se serve) una scheda delle operazioni e garantisce la colonna ID. */
  async tab(name: SheetName): Promise<Tab> {
    const cached = this.cache.get(name)
    if (cached) return cached
    const { rows } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, tab: name, create: true, headers: defaultHeaders(name) })
    let headers = (rows[0] ?? []).map((h) => (h === null || h === undefined ? '' : String(h)))
    let columns = columnMap(name, headers)
    if (!columns.has('id')) {
      headers = [...headers, 'ID']
      await this.bridge.call('range.put', { ...this.target, tab: name, row: 1, col: headers.length, values: [['ID']] })
      columns = columnMap(name, headers)
    }
    const tab = { name, headers, columns, rows }
    this.cache.set(name, tab)
    return tab
  }

  /** Numero di riga (1-based) con quell'ID, o -1. */
  static find(tab: Tab, id: string): number {
    const col = tab.columns.get('id')!
    const i = tab.rows.findIndex((r, n) => n > 0 && String(r[col] ?? '').trim() === id)
    return i > 0 ? i + 1 : -1
  }

  async push(ops: Operation[]) {
    const tabs = new Map<SheetName, Tab>()
    for (const name of OP_TABS) tabs.set(name, await this.tab(name))
    let inserted = 0
    let updated = 0
    const appends = new Map<SheetName, Cell[][]>()
    const deletes = new Map<SheetName, number[]>()

    for (const op of ops) {
      const target = tabs.get(TAB_OF[op.kind])!
      const width = target.headers.length
      const rowNumber = LedgerSheet.find(target, op.id)
      // La voce può aver cambiato tipo: si toglie dalla scheda precedente.
      for (const other of OP_TABS) {
        if (other === target.name) continue
        const n = LedgerSheet.find(tabs.get(other)!, op.id)
        if (n > 0) deletes.set(other, [...(deletes.get(other) ?? []), n])
      }
      if (rowNumber > 0) {
        const row = buildOpRow(width, target.columns, op, target.rows[rowNumber - 1])
        await this.bridge.call('range.put', { ...this.target, tab: target.name, row: rowNumber, col: 1, values: [row] })
        target.rows[rowNumber - 1] = row
        updated++
      } else {
        appends.set(target.name, [...(appends.get(target.name) ?? []), buildOpRow(width, target.columns, op)])
        inserted++
      }
    }
    for (const [name, values] of appends) await this.bridge.call('rows.append', { ...this.target, tab: name, values })
    await this.deleteRows(deletes)
    return { inserted, updated }
  }

  /**
   * Controlla che alla riga `row` della scheda ci sia ancora la voce che l'app ha letto.
   * Il foglio viene riletto e importato come nella sincronizzazione, così l'ID coincide.
   */
  private async locate(name: SheetName, row: number, expectedId: string): Promise<void> {
    const { values } = await this.bridge.call<FetchedSheets>('read', { ...this.target, sheets: ALL_SHEETS })
    const { dataset } = importFinanceSheets(values as RawSheets, { baseCurrency: this.baseCurrency })
    const op = dataset.operations.find((o) => o.source.sheet === name && o.source.row === row)
    if (!op || op.id !== expectedId) {
      throw new SheetsError('row_changed', `La riga ${row} della scheda «${name}» è cambiata dall'ultima sincronizzazione: aggiorna i dati e riprova.`, 409)
    }
  }

  /** Sostituisce una riga del foglio con la voce `op` (che ha un ID dell'app). */
  async replaceRow(name: SheetName, row: number, expectedId: string, op: Operation) {
    await this.locate(name, row, expectedId)
    const source = await this.tab(name)
    const targetName = TAB_OF[op.kind]
    if (targetName === name) {
      const values = buildOpRow(source.headers.length, source.columns, op, source.rows[row - 1])
      await this.bridge.call('range.put', { ...this.target, tab: name, row, col: 1, values: [values] })
      this.cache.clear()
      return { inserted: 0, updated: 1 }
    }
    // Tipo cambiato (es. da uscita a trasferimento): la voce passa all'altra scheda.
    const target = await this.tab(targetName)
    await this.bridge.call('rows.append', { ...this.target, tab: targetName, values: [buildOpRow(target.headers.length, target.columns, op)] })
    await this.deleteRows(new Map([[name, [row]]]))
    return { inserted: 1, updated: 0 }
  }

  async deleteRow(name: SheetName, row: number, expectedId: string) {
    await this.locate(name, row, expectedId)
    return this.deleteRows(new Map([[name, [row]]]))
  }

  async remove(ids: string[]) {
    const deletes = new Map<SheetName, number[]>()
    for (const name of OP_TABS) {
      const tab = await this.tab(name)
      for (const id of ids) {
        const n = LedgerSheet.find(tab, id)
        if (n > 0) deletes.set(name, [...(deletes.get(name) ?? []), n])
      }
    }
    return this.deleteRows(deletes)
  }

  /** Elimina dal basso verso l'alto, così i numeri di riga restano validi. */
  private async deleteRows(deletes: Map<SheetName, number[]>) {
    let count = 0
    for (const [tab, rows] of deletes) {
      for (const row of [...new Set(rows)].sort((a, b) => b - a)) {
        await this.bridge.call('row.delete', { ...this.target, tab, row })
        count++
      }
    }
    this.cache.clear()
    return count
  }

  async getConfig(): Promise<{ config: unknown; updatedAt: string | null }> {
    const { rows } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, tab: CONFIG_TAB, create: true, hidden: true })
    const meta = rows[0]?.[0]
    if (typeof meta !== 'string' || !meta.startsWith('{')) return { config: null, updatedAt: null }
    try {
      const { updatedAt, chunks } = JSON.parse(meta) as { updatedAt: string; chunks: number }
      const json = rows.slice(1, 1 + chunks).map((r) => String(r[0] ?? '')).join('')
      return { config: JSON.parse(json), updatedAt }
    } catch {
      throw new SheetsError('config_corrupted', `La scheda «${CONFIG_TAB}» del foglio non è leggibile.`, 502)
    }
  }

  async putConfig(config: unknown, updatedAt: string) {
    const json = JSON.stringify(config)
    const chunks: string[] = []
    for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK))
    await this.bridge.call('table.read', { ...this.target, tab: CONFIG_TAB, create: true, hidden: true })
    const values = [[JSON.stringify({ updatedAt, chunks: chunks.length, note: 'Configurazione di Personal Planner: non modificare.' })], ...chunks.map((c) => [c])]
    await this.bridge.call('range.put', { ...this.target, tab: CONFIG_TAB, row: 1, col: 1, values, text: true })
  }
}

// ---- Endpoint ---------------------------------------------------------------

export async function handleLedger(req: LedgerRequest): Promise<{ status: number; body: LedgerBody }> {
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  if (!expected) return fail(503, 'token_not_configured', 'Configura APP_ACCESS_TOKEN per salvare i dati sul foglio Google.')
  const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!provided || !safeEqual(provided, expected)) return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  try {
    const bridge = appsScriptFromEnv(req.env, req.fetchImpl)
    if (!bridge) return fail(503, 'bridge_required', 'Per salvare sul foglio Google configura il ponte Apps Script (APPS_SCRIPT_URL e APPS_SCRIPT_SECRET).')
    const sheet = new LedgerSheet(bridge, googleId(req.env.GOOGLE_SHEET_ID) || undefined, req.env.BASE_CURRENCY)

    switch (body.action) {
      case 'push': {
        const raw = Array.isArray(body.ops) ? body.ops : []
        if (raw.length > 2000) return fail(413, 'too_many', 'Troppe voci in una sola richiesta.')
        const ops = raw.map(validateOp)
        const bad = ops.findIndex((o) => !o)
        if (bad >= 0) return fail(400, 'invalid_op', `Voce ${bad + 1} non valida.`)
        await sheet.checkScript()
        const r = await sheet.push(ops as Operation[])
        return { status: 200, body: { ok: true, ...r, deleted: 0 } }
      }
      case 'delete': {
        const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => str(x, 64)).filter((x) => /^m-[\w-]{4,40}$/.test(x))
        await sheet.checkScript()
        return { status: 200, body: { ok: true, inserted: 0, updated: 0, deleted: await sheet.remove(ids) } }
      }
      case 'row.replace':
      case 'row.delete': {
        const tab = OP_TABS.find((t) => t === body.tab)
        const row = typeof body.row === 'number' && Number.isInteger(body.row) && body.row > 1 ? body.row : 0
        const expectedId = str(body.expectedId, 120)
        if (!tab || !row || !expectedId) return fail(400, 'invalid_row', 'Riga del foglio non valida.')
        await sheet.checkScript()
        if (body.action === 'row.delete') {
          return { status: 200, body: { ok: true, inserted: 0, updated: 0, deleted: await sheet.deleteRow(tab, row, expectedId) } }
        }
        const op = validateOp(body.op)
        if (!op) return fail(400, 'invalid_op', 'Voce non valida.')
        const r = await sheet.replaceRow(tab, row, expectedId, op)
        return { status: 200, body: { ok: true, ...r, deleted: 0 } }
      }
      case 'config.get': {
        await sheet.checkScript()
        return { status: 200, body: { ok: true, ...(await sheet.getConfig()) } }
      }
      case 'config.put': {
        const updatedAt = str(body.updatedAt, 40)
        if (!body.config || typeof body.config !== 'object' || Number.isNaN(Date.parse(updatedAt))) return fail(400, 'invalid_config', 'Configurazione non valida.')
        if (JSON.stringify(body.config).length > 1_500_000) return fail(413, 'config_too_large', 'Configurazione troppo grande.')
        await sheet.checkScript()
        await sheet.putConfig(body.config, updatedAt)
        return { status: 200, body: { ok: true, saved: true } }
      }
      default:
        return fail(400, 'invalid_action', 'Azione non valida.')
    }
  } catch (e) {
    if (e instanceof SheetsError) return fail(e.status, e.code, e.message)
    console.error('[ledger]', e)
    return fail(500, 'internal', 'Errore interno durante il salvataggio sul foglio.')
  }
}
