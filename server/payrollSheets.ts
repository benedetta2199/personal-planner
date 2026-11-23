import { createHash } from 'node:crypto'
import { normalizeKey } from '../src/modules/finance/domain/parsers.js'
import type { PayrollRecord } from '../src/modules/finance/domain/payroll.js'
import {
  columnLetter,
  driveAuthFromEnv,
  DriveError,
  FOLDER_MIME,
  GoogleDrive,
  SHEETS_API,
  SPREADSHEET_MIME,
} from './googleDrive.js'
import { appsScriptFromEnv, type AppsScriptClient, type BridgeFile } from './appsScript.js'
import { googleId } from './googleSheets.js'

/**
 * Archivio cedolini su Google Drive, organizzato per anno:
 *
 *   <GOOGLE_DRIVE_ROOT_FOLDER_ID>/
 *     2026/
 *       busta_paga_2026          ← Google Sheet, una riga per cedolino
 *       busta_paga/              ← PDF originali
 *         03-26 Cognome Nome.pdf
 *
 * Cartelle e foglio vengono creati se mancano. Se il foglio esiste già con
 * intestazioni proprie (es. Mese, Anno, Tipo_Busta, Netto_Busta…), l'app scrive
 * solo nelle colonne che riconosce e lascia intatte le altre.
 */

export const PDF_FOLDER_NAME = 'busta_paga'
export const sheetFileName = (year: number) => `busta_paga_${year}`
export const MAX_PDF_BYTES = 3 * 1024 * 1024

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** Intestazioni usate quando il foglio è nuovo (stessi nomi del tuo file storico). */
export const DEFAULT_HEADERS = [
  'Mese',
  'Anno',
  'Tipo_Busta',
  'Busta_Aggiuntiva',
  'Paga_Base',
  'Ore_Lavorate',
  'Contributo_IVS_Base',
  'IRPEF_Imponibile_Base',
  'IRPEF_Pagata',
  'Ferie_Restanti',
  'Permessi_Restanti',
  'Totale_Competenze',
  'Totale_Trattenute',
  'Netto_Busta',
  'Link_PDF',
  'Impronta_PDF',
  'Data_Salvataggio',
]
/** Colonne tecniche aggiunte in coda a un foglio esistente se mancano. */
const APP_HEADERS = ['Link_PDF', 'Impronta_PDF', 'Data_Salvataggio']

export class PayrollSheetError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message)
  }
}

export interface PayrollPdf {
  fileName: string
  data: Uint8Array
}

export interface PayrollSaveOutcome {
  action: 'inserted' | 'updated'
  sheetUrl: string
  pdf: 'uploaded' | 'existing' | 'skipped'
  pdfUrl: string | null
}

type Cell = string | number
interface RowContext {
  record: PayrollRecord
  pdfUrl: string | null
  savedAt: string
}

const euros = (cents: number | null): Cell => (cents === null ? '' : cents / 100)
const num = (value: number | null): Cell => (value === null ? '' : value)

/** Colonna normalizzata → valore. Più alias puntano allo stesso dato. */
const COLUMN_VALUES: Record<string, (ctx: RowContext) => Cell | undefined> = {
  mese: ({ record }) => (record.month ? MONTH_NAMES[record.month - 1] : ''),
  anno: ({ record }) => record.year ?? '',
  tipobusta: ({ record }) => record.type,
  bustaaggiuntiva: ({ record }) => (record.type === 'Normale' ? 'False' : 'True'),
  pagabase: ({ record }) => euros(record.basePay),
  orelavorate: ({ record }) => num(record.hoursWorked),
  contributoivsbase: ({ record }) => euros(record.inpsTaxable),
  imponibileinps: ({ record }) => euros(record.inpsTaxable),
  irpefimponibilebase: ({ record }) => euros(record.irpefTaxable),
  imponibileirpef: ({ record }) => euros(record.irpefTaxable),
  irpefpagata: ({ record }) => euros(record.irpefPaid),
  ferierestanti: ({ record }) => num(record.vacationRemaining),
  ferieresidue: ({ record }) => num(record.vacationRemaining),
  permessirestanti: ({ record }) => num(record.permitsRemaining),
  permessiresidui: ({ record }) => num(record.permitsRemaining),
  totalecompetenze: ({ record }) => euros(record.grossPay),
  totaletrattenute: ({ record }) => euros(record.totalDeductions),
  nettobusta: ({ record }) => euros(record.netPay),
  nettoinbusta: ({ record }) => euros(record.netPay),
  linkpdf: ({ pdfUrl }) => pdfUrl ?? undefined,
  improntapdf: ({ record }) => record.sourceHash,
  datasalvataggio: ({ savedAt }) => savedAt,
}

export function validatePayrollRecord(input: unknown): PayrollRecord | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const year = raw.year
  const month = raw.month
  const type = typeof raw.type === 'string' ? raw.type.trim() : ''
  const sourceHash = typeof raw.sourceHash === 'string' ? raw.sourceHash : ''
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) return null
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) return null
  if (!['Normale', 'Tredicesima', 'Quattordicesima'].includes(type)) return null
  if (!/^[a-f0-9]{64}$/i.test(sourceHash)) return null

  const moneyFields = ['basePay', 'grossPay', 'totalDeductions', 'netPay', 'inpsTaxable', 'irpefTaxable', 'irpefPaid']
  const numberFields = ['hoursWorked', 'vacationRemaining', 'permitsRemaining']
  const values: Record<string, number | null> = {}
  for (const field of [...moneyFields, ...numberFields]) {
    const value = raw[field]
    if (value === null || value === undefined) {
      values[field] = null
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (moneyFields.includes(field) && !Number.isInteger(value))) return null
    values[field] = value
  }
  const key = `${year}-${String(month).padStart(2, '0')}-${type.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  return {
    recordKey: key,
    year: Number(year),
    month: Number(month),
    type,
    basePay: values.basePay,
    grossPay: values.grossPay,
    totalDeductions: values.totalDeductions,
    netPay: values.netPay,
    hoursWorked: values.hoursWorked,
    inpsTaxable: values.inpsTaxable,
    irpefTaxable: values.irpefTaxable,
    irpefPaid: values.irpefPaid,
    vacationRemaining: values.vacationRemaining,
    permitsRemaining: values.permitsRemaining,
    sourceHash,
  }
}

/**
 * Decodifica e verifica il PDF inviato dal browser: deve essere un vero PDF,
 * entro il limite di dimensione e con la stessa impronta SHA-256 del record.
 */
export function decodePayrollPdf(input: unknown, sourceHash: string): PayrollPdf | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const name = typeof raw.fileName === 'string' ? raw.fileName : ''
  const base64 = typeof raw.base64 === 'string' ? raw.base64 : ''
  if (!base64 || base64.length > Math.ceil((MAX_PDF_BYTES * 4) / 3) + 4) return null
  const data = Buffer.from(base64, 'base64')
  if (data.length === 0 || data.length > MAX_PDF_BYTES) return null
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return null
  if (createHash('sha256').update(data).digest('hex') !== sourceHash.toLowerCase()) return null
  const fileName = sanitizeFileName(name)
  return { fileName, data: new Uint8Array(data) }
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!base) return 'busta_paga.pdf'
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`
}

function sameCell(a: unknown, b: unknown): boolean {
  return normalizeKey(a) === normalizeKey(b)
}

/** La riga esistente descrive lo stesso cedolino (anno + mese + tipo)? */
function matchesRecord(row: unknown[], columns: Map<string, number>, record: PayrollRecord): boolean {
  const cell = (key: string) => {
    const i = columns.get(key)
    return i === undefined ? undefined : row[i]
  }
  if (Number(cell('anno')) !== record.year) return false
  const month = cell('mese')
  const monthMatches = Number(month) === record.month || sameCell(month, MONTH_NAMES[(record.month ?? 1) - 1])
  if (!monthMatches) return false
  if (columns.has('tipobusta')) return sameCell(cell('tipobusta') || 'Normale', record.type)
  return true
}

/** Costruisce la riga: parte da quella esistente e sovrascrive solo le colonne note. */
export function buildRow(headers: unknown[], existing: unknown[] | null, ctx: RowContext): Cell[] {
  const row: Cell[] = headers.map((_, i) => {
    const value = existing?.[i]
    return typeof value === 'number' || typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  })
  headers.forEach((header, i) => {
    const getter = COLUMN_VALUES[normalizeKey(header)]
    if (!getter) return
    const value = getter(ctx)
    // Un campo non letto dal PDF non cancella un valore già presente.
    if (value === undefined || (value === '' && existing && row[i] !== '')) return
    row[i] = value
  })
  return row
}

// ---- Accesso a Drive/Fogli ------------------------------------------------------

interface StoredFile {
  id: string
  url: string
}

/** Operazioni Drive/Fogli necessarie all'archivio (REST con OAuth o ponte Apps Script). */
interface PayrollStorage {
  ensure(parentId: string, name: string, kind: 'folder' | 'spreadsheet'): Promise<StoredFile>
  findPdf(folderId: string, hash: string): Promise<StoredFile | null>
  uploadPdf(folderId: string, pdf: PayrollPdf, hash: string): Promise<StoredFile>
  /** Prima scheda del foglio: nome e righe (valori non formattati). */
  readFirstTab(spreadsheetId: string): Promise<{ tab: string; rows: unknown[][] }>
  /** Scrive un blocco a partire da (row, col), 1-based. */
  put(spreadsheetId: string, tab: string, row: number, col: number, values: Cell[][]): Promise<void>
  append(spreadsheetId: string, tab: string, values: Cell[]): Promise<void>
}

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`

class RestStorage implements PayrollStorage {
  constructor(private readonly drive: GoogleDrive) {}

  async ensure(parentId: string, name: string, kind: 'folder' | 'spreadsheet') {
    const file = await this.drive.ensureChild(parentId, name, kind === 'folder' ? FOLDER_MIME : SPREADSHEET_MIME)
    const url = file.webViewLink ?? (kind === 'folder' ? `https://drive.google.com/drive/folders/${file.id}` : `https://docs.google.com/spreadsheets/d/${file.id}/edit`)
    return { id: file.id, url }
  }

  async findPdf(folderId: string, hash: string) {
    const [file] = await this.drive.list(`'${folderId}' in parents and appProperties has { key='sourceHash' and value='${hash}' }`)
    return file ? { id: file.id, url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view` } : null
  }

  async uploadPdf(folderId: string, pdf: PayrollPdf, hash: string) {
    const file = await this.drive.upload(folderId, pdf.fileName, 'application/pdf', pdf.data, { sourceHash: hash })
    return { id: file.id, url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view` }
  }

  async readFirstTab(spreadsheetId: string) {
    const id = encodeURIComponent(spreadsheetId)
    const meta = await this.drive.request<{ sheets?: { properties: { title: string } }[] }>(`${SHEETS_API}/${id}?fields=sheets.properties.title`)
    const tab = meta.sheets?.[0]?.properties.title
    if (!tab) throw new PayrollSheetError('sheet_empty', 'Il foglio dei cedolini non contiene schede.')
    const range = encodeURIComponent(`${quoteTab(tab)}!A:ZZ`)
    const data = await this.drive.request<{ values?: unknown[][] }>(`${SHEETS_API}/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`)
    return { tab, rows: data.values ?? [] }
  }

  async put(spreadsheetId: string, tab: string, row: number, col: number, values: Cell[][]) {
    const width = Math.max(1, ...values.map((r) => r.length))
    const a1 = `${columnLetter(col)}${row}:${columnLetter(col + width - 1)}${row + values.length - 1}`
    const range = encodeURIComponent(`${quoteTab(tab)}!${a1}`)
    await this.drive.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    })
  }

  async append(spreadsheetId: string, tab: string, values: Cell[]) {
    const range = encodeURIComponent(`${quoteTab(tab)}!A:${columnLetter(values.length)}`)
    await this.drive.request(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    })
  }
}

class BridgeStorage implements PayrollStorage {
  constructor(private readonly bridge: AppsScriptClient) {}

  async ensure(parentId: string, name: string, kind: 'folder' | 'spreadsheet') {
    return this.bridge.call<BridgeFile>('drive.ensure', { parentId, name, kind })
  }

  async findPdf(folderId: string, hash: string) {
    return (await this.bridge.call<{ file: BridgeFile | null }>('drive.findByHash', { folderId, hash })).file
  }

  async uploadPdf(folderId: string, pdf: PayrollPdf, hash: string) {
    const base64 = Buffer.from(pdf.data).toString('base64')
    return (await this.bridge.call<{ file: BridgeFile }>('drive.upload', { folderId, name: pdf.fileName, base64, hash, mimeType: 'application/pdf' })).file
  }

  async readFirstTab(spreadsheetId: string) {
    return this.bridge.call<{ tab: string; rows: unknown[][] }>('table.read', { spreadsheetId })
  }

  async put(spreadsheetId: string, tab: string, row: number, col: number, values: Cell[][]) {
    await this.bridge.call('range.put', { spreadsheetId, tab, row, col, values })
  }

  async append(spreadsheetId: string, tab: string, values: Cell[]) {
    await this.bridge.call('rows.append', { spreadsheetId, tab, values: [values] })
  }
}

/** Ponte Apps Script se configurato, altrimenti API Google con OAuth/service account. */
function storageFromEnv(env: Record<string, string | undefined>): PayrollStorage {
  const bridge = appsScriptFromEnv(env)
  return bridge ? new BridgeStorage(bridge) : new RestStorage(new GoogleDrive(driveAuthFromEnv(env)))
}

// ---- Logica dell'archivio ---------------------------------------------------------

async function upsertRow(storage: PayrollStorage, spreadsheetId: string, record: PayrollRecord, pdfUrl: string | null): Promise<'inserted' | 'updated'> {
  const { tab, rows } = await storage.readFirstTab(spreadsheetId)
  let headers = rows[0]?.map((h) => (h === null || h === undefined ? '' : String(h))) ?? []

  if (!headers.some((h) => h.trim())) {
    headers = [...DEFAULT_HEADERS]
    await storage.put(spreadsheetId, tab, 1, 1, [headers])
  } else {
    const known = new Set(headers.map(normalizeKey))
    if (!known.has('anno') || !known.has('mese')) {
      throw new PayrollSheetError('sheet_schema_mismatch', `La prima scheda del foglio deve avere le colonne "Anno" e "Mese" nella riga 1.`, 409)
    }
    const missing = APP_HEADERS.filter((h) => !known.has(normalizeKey(h)))
    if (missing.length) {
      const start = headers.length + 1
      headers = [...headers, ...missing]
      await storage.put(spreadsheetId, tab, 1, start, [missing])
    }
  }

  const columns = new Map(headers.map((h, i) => [normalizeKey(h), i] as const))
  const ctx: RowContext = { record, pdfUrl, savedAt: new Date().toISOString() }
  const index = rows.findIndex((row, i) => i > 0 && matchesRecord(row, columns, record))
  if (index >= 1) {
    await storage.put(spreadsheetId, tab, index + 1, 1, [buildRow(headers, rows[index], ctx)])
    return 'updated'
  }
  await storage.append(spreadsheetId, tab, buildRow(headers, null, ctx))
  return 'inserted'
}

async function storePdf(storage: PayrollStorage, yearFolderId: string, pdf: PayrollPdf, sourceHash: string): Promise<{ status: 'uploaded' | 'existing'; file: StoredFile }> {
  const folder = await storage.ensure(yearFolderId, PDF_FOLDER_NAME, 'folder')
  const existing = await storage.findPdf(folder.id, sourceHash)
  if (existing) return { status: 'existing', file: existing }
  return { status: 'uploaded', file: await storage.uploadPdf(folder.id, pdf, sourceHash) }
}

export async function savePayroll(env: Record<string, string | undefined>, record: PayrollRecord, pdf: PayrollPdf | null): Promise<PayrollSaveOutcome> {
  const rootId = googleId(env.GOOGLE_DRIVE_ROOT_FOLDER_ID)
  if (!rootId) throw new PayrollSheetError('not_configured', 'Configura GOOGLE_DRIVE_ROOT_FOLDER_ID: la cartella Drive che contiene le cartelle per anno (2026, 2027…).', 503)
  if (!record.year) throw new PayrollSheetError('invalid_record', 'Anno del cedolino mancante.', 400)

  const storage = storageFromEnv(env)
  const yearFolder = await storage.ensure(rootId, String(record.year), 'folder')
  const sheet = await storage.ensure(yearFolder.id, sheetFileName(record.year), 'spreadsheet')

  let pdfStatus: PayrollSaveOutcome['pdf'] = 'skipped'
  let pdfUrl: string | null = null
  if (pdf) {
    const stored = await storePdf(storage, yearFolder.id, pdf, record.sourceHash)
    pdfStatus = stored.status
    pdfUrl = stored.file.url
  }

  const action = await upsertRow(storage, sheet.id, record, pdfUrl)
  return { action, sheetUrl: sheet.url, pdf: pdfStatus, pdfUrl }
}

export { DriveError }
