import { timingSafeEqual } from 'node:crypto'
import { appsScriptFromEnv, type AppsScriptClient } from './appsScript.js'
import { googleId, SheetsError } from './googleSheets.js'

/**
 * Salvataggio dei moduli Agenda, Obiettivi, Abitudini e Diario su un Google Sheet dedicato
 * (PLANNER_SHEET_ID, separato dal foglio del bilancio), tramite il ponte Apps Script.
 *
 *  - Copia completa dei dati (JSON) nella scheda nascosta «_planner_moduli»: è quella da cui
 *    l'app rilegge, con un orario di modifica per modulo («vince il più recente», modulo per modulo).
 *  - Schede leggibili (Scadenze, Obiettivi, Abitudini, Diario…) riscritte dall'app a ogni salvataggio:
 *    servono per consultare i dati dal foglio, le modifiche fatte lì non vengono rilette.
 *
 *   POST /api/planner/sync  { modules: { agenda: { updatedAt, data, tables }, … } }
 *   → { ok, modules: { <id>: { updatedAt, data } }, saved: [<id>…] }
 *   Con `modules` vuoto legge soltanto.
 */

export const MIN_SCRIPT_VERSION = 2
export const DATA_TAB = '_planner_moduli'
const CHUNK = 40000
const MAX_CELL = 49000

/** Moduli accettati e schede leggibili che ciascuno può scrivere. */
export const MODULE_TABS: Record<string, string[]> = {
  agenda: ['Scadenze', 'Scadenze completate'],
  goals: ['Obiettivi', 'Obiettivi - tappe'],
  habits: ['Abitudini', 'Abitudini - registro'],
  journal: ['Diario'],
}

export type Cell = string | number | { $date: string }

export interface StoredModule {
  updatedAt: string
  data: Record<string, unknown>
}

interface IncomingModule extends StoredModule {
  tables: Record<string, Cell[][]>
}

export type PlannerBody =
  | { ok: true; modules: Record<string, StoredModule>; saved: string[] }
  | { ok: false; code: string; message: string }

export interface PlannerRequest {
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isTimestamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ---- Validazione ------------------------------------------------------------

/** Testo sicuro per Fogli: niente formule (=, +, -, @ iniziali vengono resi letterali). */
export function cell(v: unknown): Cell | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.slice(0, MAX_CELL)
    return /^[=+\-@]/.test(s) ? `'${s}` : s
  }
  if (isObject(v) && typeof v.$date === 'string' && ISO_DAY.test(v.$date)) return { $date: v.$date }
  if (v === null || v === undefined || typeof v === 'boolean') return v ? 'Sì' : v === false ? 'No' : ''
  return null
}

function validateTables(id: string, raw: unknown): Record<string, Cell[][]> | null {
  if (raw === undefined) return {}
  if (!isObject(raw)) return null
  const out: Record<string, Cell[][]> = {}
  for (const [tab, rows] of Object.entries(raw)) {
    if (!MODULE_TABS[id].includes(tab) || !Array.isArray(rows) || rows.length > 20000) return null
    const clean: Cell[][] = []
    for (const r of rows) {
      if (!Array.isArray(r) || r.length > 40) return null
      const row = r.map(cell)
      if (row.some((c) => c === null)) return null
      clean.push(row as Cell[])
    }
    out[tab] = clean
  }
  return out
}

export function validateModules(raw: unknown): Record<string, IncomingModule> | null {
  if (raw === undefined) return {}
  if (!isObject(raw)) return null
  const out: Record<string, IncomingModule> = {}
  for (const [id, m] of Object.entries(raw)) {
    if (!(id in MODULE_TABS) || !isObject(m) || !isTimestamp(m.updatedAt) || !isObject(m.data)) return null
    const tables = validateTables(id, m.tables)
    if (!tables) return null
    out[id] = { updatedAt: m.updatedAt, data: m.data, tables }
  }
  return out
}

/** Una nuova versione sostituisce quella salvata solo se non è più vecchia. */
export const isNewer = (incoming: string, stored: StoredModule | undefined) => !stored || Date.parse(incoming) >= Date.parse(stored.updatedAt)

/** Valori da scrivere: la nuova tabella, più celle vuote dove la precedente era più grande. */
export function overwriteBlock(rows: Cell[][], previous: unknown[][]): Cell[][] {
  const width = Math.max(1, ...rows.map((r) => r.length), ...previous.map((r) => r.length))
  const height = Math.max(1, rows.length, previous.length)
  return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[i]?.[j] ?? ''))
}

// ---- Foglio -----------------------------------------------------------------

class PlannerSheet {
  constructor(
    private readonly bridge: AppsScriptClient,
    private readonly spreadsheetId: string,
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

  async readStore(): Promise<Record<string, StoredModule>> {
    const { rows } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, tab: DATA_TAB, create: true, hidden: true })
    const meta = rows[0]?.[0]
    if (typeof meta !== 'string' || !meta.startsWith('{')) return {}
    try {
      const { chunks } = JSON.parse(meta) as { chunks: number }
      const parsed = JSON.parse(rows.slice(1, 1 + chunks).map((r) => String(r[0] ?? '')).join('')) as { modules?: unknown }
      const out: Record<string, StoredModule> = {}
      if (isObject(parsed.modules)) {
        for (const [id, m] of Object.entries(parsed.modules)) {
          if (id in MODULE_TABS && isObject(m) && isTimestamp(m.updatedAt) && isObject(m.data)) out[id] = { updatedAt: m.updatedAt, data: m.data }
        }
      }
      return out
    } catch {
      throw new SheetsError('data_corrupted', `La scheda «${DATA_TAB}» del foglio non è leggibile.`, 502)
    }
  }

  async writeStore(modules: Record<string, StoredModule>) {
    const json = JSON.stringify({ modules })
    const chunks: string[] = []
    for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK))
    const { rows: previous } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, tab: DATA_TAB, create: true, hidden: true })
    const meta = JSON.stringify({ format: 1, chunks: chunks.length, savedAt: new Date().toISOString(), note: 'Dati di Personal Planner (Agenda, Obiettivi, Abitudini, Diario): non modificare.' })
    const values = overwriteBlock([[meta], ...chunks.map((c) => [c])], previous).map((r) => [r[0]])
    await this.bridge.call('range.put', { ...this.target, tab: DATA_TAB, row: 1, col: 1, values, text: true })
  }

  async writeTable(tab: string, rows: Cell[][]) {
    const { rows: previous } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, tab, create: true })
    await this.bridge.call('range.put', { ...this.target, tab, row: 1, col: 1, values: overwriteBlock(rows, previous) })
  }
}

// ---- Endpoint ---------------------------------------------------------------

export async function handlePlannerSync(req: PlannerRequest): Promise<{ status: number; body: PlannerBody }> {
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  if (!expected) return fail(503, 'token_not_configured', 'Configura APP_ACCESS_TOKEN per salvare i dati sul foglio Google.')
  const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!provided || !safeEqual(provided, expected)) return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')

  const body = isObject(req.body) ? req.body : {}
  const incoming = validateModules(body.modules)
  if (!incoming) return fail(400, 'invalid_modules', 'Dati da salvare non validi.')

  try {
    const bridge = appsScriptFromEnv(req.env, req.fetchImpl)
    if (!bridge) return fail(503, 'bridge_required', 'Per salvare sul foglio Google configura il ponte Apps Script (APPS_SCRIPT_URL e APPS_SCRIPT_SECRET).')
    // Foglio dedicato al planner: mai quello del bilancio.
    const plannerSheetId = googleId(req.env.PLANNER_SHEET_ID)
    if (!plannerSheetId) return fail(503, 'planner_sheet_missing', "Configura PLANNER_SHEET_ID con l'indirizzo del Google Sheet in cui salvare Agenda, Obiettivi, Abitudini e Diario.")
    const sheet = new PlannerSheet(bridge, plannerSheetId)
    await sheet.checkScript()

    const stored = await sheet.readStore()
    const saved = Object.keys(incoming).filter((id) => isNewer(incoming[id].updatedAt, stored[id]))
    if (saved.length) {
      for (const id of saved) stored[id] = { updatedAt: incoming[id].updatedAt, data: incoming[id].data }
      // Prima la copia completa (è quella che conta), poi le schede leggibili.
      await sheet.writeStore(stored)
      for (const id of saved) {
        for (const [tab, rows] of Object.entries(incoming[id].tables)) await sheet.writeTable(tab, rows)
      }
    }
    return { status: 200, body: { ok: true, modules: stored, saved } }
  } catch (e) {
    if (e instanceof SheetsError) return fail(e.status, e.code, e.message)
    console.error('[planner-sync]', e)
    return fail(500, 'internal', 'Errore interno durante il salvataggio sul foglio.')
  }
}
