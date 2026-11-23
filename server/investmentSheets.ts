import { timingSafeEqual } from 'node:crypto'
import { JWT } from 'google-auth-library'
import { googleId, investmentCredentialsFromEnv, SheetsError } from './googleSheets.js'
import { appsScriptFromEnv, type AppsScriptClient } from './appsScript.js'
import { ISIN_RE, validateInstrument, type InstrumentType, type InvestmentConfig } from '../src/modules/finance/domain/ledger.js'

/**
 * Archivio degli strumenti di investimento su un Google Sheet dedicato
 * (INVESTMENTS_SHEET_ID), scheda «Strumenti». Una riga per posizione.
 *
 *   GET    /api/finance/investments            → tutti gli strumenti
 *   PUT    /api/finance/investments            → { key, category, subcategory, instrument } (inserisce o aggiorna)
 *   DELETE /api/finance/investments?key=…      → elimina la riga
 */

const API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE = ['https://www.googleapis.com/auth/spreadsheets']
export const SHEET_NAME = 'Strumenti'
export const HEADERS = [
  'Chiave',
  'Categoria',
  'Sotto-categoria',
  'Tipo',
  'Nome',
  'ISIN',
  'Ticker',
  'Quote',
  'Nominale',
  'Prezzo acquisto (%)',
  'Cedola annua (%)',
  'Cedole per anno',
  'Scadenza',
  'Aggiornato',
]
const LAST_COL = String.fromCharCode('A'.charCodeAt(0) + HEADERS.length - 1)

const TYPE_TO_SHEET: Record<InstrumentType, string> = { etf: 'ETF', stock: 'Azione', bond: 'Obbligazione' }
const SHEET_TO_TYPE: Record<string, InstrumentType> = { etf: 'etf', azione: 'stock', obbligazione: 'bond', stock: 'stock', bond: 'bond' }

export interface StoredInstrument {
  key: string
  category: string
  subcategory: string
  instrument: InvestmentConfig
}

export type InvestmentsBody =
  | { ok: true; instruments: StoredInstrument[] }
  | { ok: true; action: 'inserted' | 'updated' | 'deleted' | 'missing'; key: string }
  | { ok: false; code: string; message: string }

export interface InvestmentsRequest {
  method: string
  authorization?: string
  env: Record<string, string | undefined>
  query: URLSearchParams
  body: unknown
  /** Iniettabili nei test. */
  fetchImpl?: typeof fetch
  getToken?: () => Promise<string>
}

const fail = (status: number, code: string, message: string) => ({ status, body: { ok: false as const, code, message } })

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ---- Conversione riga ⇄ strumento -------------------------------------------

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const cell = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : v)

export function instrumentToRow(s: StoredInstrument): (string | number)[] {
  const i = s.instrument
  return [
    s.key,
    s.category,
    s.subcategory,
    TYPE_TO_SHEET[i.type ?? 'etf'],
    cell(i.name),
    cell(i.isin),
    cell(i.ticker),
    cell(i.units),
    cell(i.nominal),
    cell(i.buyPrice),
    cell(i.coupon),
    cell(i.couponFrequency),
    cell(i.maturity),
    i.updatedAt ?? new Date().toISOString(),
  ]
}

export function rowToInstrument(row: unknown[]): StoredInstrument | null {
  const key = str(row[0])
  if (!key) return null
  const type = SHEET_TO_TYPE[str(row[3]).toLowerCase()] ?? 'etf'
  return {
    key,
    category: str(row[1]),
    subcategory: str(row[2]),
    instrument: {
      type,
      name: str(row[4]) || undefined,
      isin: str(row[5]).toUpperCase() || undefined,
      ticker: str(row[6]).toUpperCase(),
      units: num(row[7]),
      nominal: num(row[8]),
      buyPrice: num(row[9]),
      coupon: num(row[10]),
      couponFrequency: num(row[11]),
      maturity: str(row[12]) || null,
      updatedAt: str(row[13]) || undefined,
    },
  }
}

/** Valida il corpo di una richiesta PUT. */
export function parseStored(input: unknown): { value?: StoredInstrument; error?: string } {
  if (!input || typeof input !== 'object') return { error: 'Richiesta non valida.' }
  const raw = input as Record<string, unknown>
  const category = str(raw.category)
  const subcategory = str(raw.subcategory)
  const key = str(raw.key)
  if (!category || key !== `${category}␟${subcategory}`) return { error: 'Chiave della posizione non valida.' }
  const i = (raw.instrument ?? {}) as Record<string, unknown>
  const type = (['etf', 'stock', 'bond'] as const).find((t) => t === i.type) ?? 'etf'
  const instrument: InvestmentConfig = {
    type,
    ticker: str(i.ticker).toUpperCase().slice(0, 24),
    units: num(i.units),
    isin: str(i.isin).toUpperCase() || undefined,
    name: str(i.name).slice(0, 120) || undefined,
    nominal: num(i.nominal),
    buyPrice: num(i.buyPrice),
    coupon: num(i.coupon),
    couponFrequency: num(i.couponFrequency),
    maturity: str(i.maturity) || null,
    updatedAt: new Date().toISOString(),
  }
  if (instrument.ticker && !/^[A-Z0-9.^=\-]{1,24}$/.test(instrument.ticker)) return { error: 'Ticker non valido.' }
  if (instrument.isin && !ISIN_RE.test(instrument.isin)) return { error: 'ISIN non valido.' }
  const problems = validateInstrument(instrument)
  if (problems.length) return { error: problems.join(' ') }
  return { value: { key, category: category.slice(0, 120), subcategory: subcategory.slice(0, 120), instrument } }
}

// ---- Accesso al foglio ------------------------------------------------------

/** Operazioni minime sulla scheda «Strumenti» (REST con service account o ponte Apps Script). */
interface TableIO {
  /** Righe della scheda, creandola con le intestazioni se manca o è vuota. */
  read(): Promise<unknown[][]>
  putRow(rowNumber: number, values: (string | number)[]): Promise<void>
  append(values: (string | number)[]): Promise<void>
  deleteRow(rowNumber: number): Promise<void>
}

class RestTableIO implements TableIO {
  private tabId: number | null = null

  constructor(
    private readonly sheetId: string,
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let token: string
    try {
      token = await this.getToken()
    } catch {
      throw new SheetsError('auth_failed', 'Autenticazione Google non riuscita.')
    }
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init?.body) headers.set('Content-Type', 'application/json')
    let res: Response
    try {
      res = await this.fetchImpl(`${API}/${encodeURIComponent(this.sheetId)}${path}`, { ...init, headers })
    } catch {
      throw new SheetsError('google_unavailable', 'Impossibile raggiungere Google Sheets.')
    }
    if (!res.ok) {
      if (res.status === 403) throw new SheetsError('investments_forbidden', 'Condividi il foglio degli investimenti con il service account come Editor.', 403)
      if (res.status === 404) throw new SheetsError('investments_sheet_not_found', 'Google Sheet degli investimenti non trovato: verifica INVESTMENTS_SHEET_ID.', 404)
      throw new SheetsError('google_sheets_error', `Google Sheets ha rifiutato la richiesta (HTTP ${res.status}).`, 502)
    }
    return (await res.json()) as T
  }

  async read(): Promise<unknown[][]> {
    const meta = await this.request<{ sheets?: { properties: { title: string; sheetId: number } }[] }>('?fields=sheets.properties.title,sheets.properties.sheetId')
    let tab = meta.sheets?.find((s) => s.properties.title.trim().toLowerCase() === SHEET_NAME.toLowerCase())?.properties
    if (!tab) {
      const created = await this.request<{ replies?: { addSheet?: { properties: { title: string; sheetId: number } } }[] }>(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }),
      })
      tab = created.replies?.[0]?.addSheet?.properties
      if (!tab) throw new SheetsError('sheet_create_failed', `Impossibile creare la scheda «${SHEET_NAME}».`)
    }
    this.tabId = tab.sheetId
    const range = encodeURIComponent(`'${SHEET_NAME}'!A:${LAST_COL}`)
    const data = await this.request<{ values?: unknown[][] }>(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`)
    const rows = data.values ?? []
    if (!rows.length) {
      await this.putRow(1, HEADERS)
      return [HEADERS]
    }
    return rows
  }

  async putRow(n: number, values: (string | number)[]) {
    await this.request(`/values/${encodeURIComponent(`'${SHEET_NAME}'!A${n}:${LAST_COL}${n}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [values] }) })
  }

  async append(values: (string | number)[]) {
    await this.request(`/values/${encodeURIComponent(`'${SHEET_NAME}'!A:${LAST_COL}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: [values] }),
    })
  }

  async deleteRow(n: number) {
    if (this.tabId === null) await this.read()
    await this.request(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: this.tabId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }] }),
    })
  }
}

class BridgeTableIO implements TableIO {
  constructor(
    private readonly bridge: AppsScriptClient,
    private readonly spreadsheetId: string | undefined,
  ) {}

  private get target() {
    return { spreadsheetId: this.spreadsheetId, tab: SHEET_NAME }
  }

  async read() {
    const { rows } = await this.bridge.call<{ rows: unknown[][] }>('table.read', { ...this.target, create: true, headers: HEADERS })
    return rows
  }

  async putRow(row: number, values: (string | number)[]) {
    await this.bridge.call('range.put', { ...this.target, row, col: 1, values: [values] })
  }

  async append(values: (string | number)[]) {
    await this.bridge.call('rows.append', { ...this.target, values: [values] })
  }

  async deleteRow(row: number) {
    await this.bridge.call('row.delete', { ...this.target, row })
  }
}

class InstrumentTable {
  constructor(private readonly io: TableIO) {}

  /** Righe della scheda con intestazioni verificate. */
  private async rows(): Promise<unknown[][]> {
    const rows = await this.io.read()
    if (HEADERS.some((h, i) => str(rows[0]?.[i]) !== h)) {
      throw new SheetsError('sheet_schema_mismatch', `La scheda «${SHEET_NAME}» esiste ma ha intestazioni diverse da quelle attese.`, 409)
    }
    return rows
  }

  async list(): Promise<StoredInstrument[]> {
    const rows = await this.rows()
    return rows.slice(1).map(rowToInstrument).filter((x): x is StoredInstrument => !!x)
  }

  async upsert(item: StoredInstrument): Promise<'inserted' | 'updated'> {
    const rows = await this.rows()
    const idx = rows.findIndex((r, i) => i > 0 && str(r[0]) === item.key)
    if (idx > 0) {
      await this.io.putRow(idx + 1, instrumentToRow(item))
      return 'updated'
    }
    await this.io.append(instrumentToRow(item))
    return 'inserted'
  }

  async remove(key: string): Promise<'deleted' | 'missing'> {
    const rows = await this.rows()
    const idx = rows.findIndex((r, i) => i > 0 && str(r[0]) === key)
    if (idx <= 0) return 'missing'
    await this.io.deleteRow(idx + 1)
    return 'deleted'
  }
}

// ---- Endpoint ---------------------------------------------------------------

/**
 * Ponte Apps Script se configurato (INVESTMENTS_SHEET_ID facoltativo: senza, la
 * scheda «Strumenti» va nel foglio collegato allo script), altrimenti service account.
 */
function tableIO(req: InvestmentsRequest): TableIO {
  const bridge = appsScriptFromEnv(req.env, req.fetchImpl)
  if (bridge) return new BridgeTableIO(bridge, googleId(req.env.INVESTMENTS_SHEET_ID) || undefined)
  const creds = investmentCredentialsFromEnv(req.env)
  const getToken =
    req.getToken ??
    (async () => {
      const jwt = new JWT({ email: creds.clientEmail, key: creds.privateKey, scopes: SCOPE })
      const t = (await jwt.getAccessToken()).token
      if (!t) throw new Error('no token')
      return t
    })
  return new RestTableIO(creds.sheetId, getToken, req.fetchImpl ?? fetch)
}

export async function handleInvestments(req: InvestmentsRequest): Promise<{ status: number; body: InvestmentsBody }> {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  const writing = req.method !== 'GET'
  if (writing && !expected) return fail(503, 'token_not_configured', 'Configura APP_ACCESS_TOKEN per salvare gli investimenti sul Google Sheet.')
  if (expected) {
    const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
    if (!provided || !safeEqual(provided, expected)) return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')
  }

  try {
    const client = new InstrumentTable(tableIO(req))

    if (req.method === 'GET') return { status: 200, body: { ok: true, instruments: await client.list() } }
    if (req.method === 'DELETE') {
      const key = req.query.get('key') ?? ''
      if (!key) return fail(400, 'invalid_request', 'Chiave mancante.')
      return { status: 200, body: { ok: true, action: await client.remove(key), key } }
    }
    const parsed = parseStored(req.body && typeof req.body === 'object' ? (req.body as { item?: unknown }).item : null)
    if (!parsed.value) return fail(400, 'invalid_instrument', parsed.error ?? 'Strumento non valido.')
    return { status: 200, body: { ok: true, action: await client.upsert(parsed.value), key: parsed.value.key } }
  } catch (e) {
    if (e instanceof SheetsError) return fail(e.status, e.code, e.message)
    console.error('[investments]', e)
    return fail(500, 'internal', 'Errore interno nel salvataggio degli investimenti.')
  }
}
