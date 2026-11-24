import type { PayrollRecord } from '../domain/payroll'

export interface PayrollSaveResult {
  action: 'inserted' | 'updated'
  recordKey: string
  sheetUrl: string | null
  pdf: 'uploaded' | 'existing' | 'skipped'
  pdfUrl: string | null
}

/** Riga già presente nel foglio per lo stesso cedolino. */
export interface PayrollExistingRow {
  row: number
  /** period: stesso anno/mese/tipo; pdf: stesso PDF salvato con un altro periodo. */
  match: 'period' | 'pdf'
  mese: string
  anno: number | null
  tipo: string
  /** Netto già registrato, in euro. */
  netPay: number | null
  savedAt: string | null
}

export interface PayrollCheckResult {
  exists: boolean
  existing: PayrollExistingRow | null
  sheetUrl: string | null
}

export class PayrollApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    /** Presente quando il salvataggio è rifiutato perché la riga esiste già (code "already_saved"). */
    public readonly existing?: PayrollExistingRow,
    public readonly sheetUrl?: string,
  ) {
    super(message)
  }
}

/** Limite lato server (le funzioni Vercel accettano richieste fino a ~4,5 MB). */
export const MAX_PAYROLL_PDF_BYTES = 3 * 1024 * 1024

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

type ApiBody = Partial<PayrollSaveResult & PayrollCheckResult> & {
  ok?: boolean
  code?: string
  message?: string
  existing?: PayrollExistingRow | null
}

async function callPayrollApi(payload: unknown, accessToken: string, failure: string): Promise<ApiBody> {
  let response: Response
  try {
    response = await fetch('/api/finance/payroll', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new PayrollApiError('network', 'Impossibile raggiungere il servizio dei cedolini.')
  }

  let body: ApiBody
  try {
    body = await response.json()
  } catch {
    throw new PayrollApiError('unavailable', `Servizio dei cedolini non raggiungibile (HTTP ${response.status}).`, response.status)
  }
  if (!response.ok || !body.ok) {
    throw new PayrollApiError(body.code ?? 'request_failed', body.message ?? failure, response.status, body.existing ?? undefined, body.sheetUrl ?? undefined)
  }
  return body
}

/** Verifica se il cedolino (stesso anno/mese/tipo o stesso PDF) è già nel foglio annuale. Non scrive nulla. */
export async function checkPayrollRecord(record: PayrollRecord, accessToken: string): Promise<PayrollCheckResult> {
  const body = await callPayrollApi({ record, mode: 'check' }, accessToken, 'Impossibile verificare il foglio dei cedolini.')
  return { exists: Boolean(body.exists), existing: body.existing ?? null, sheetUrl: body.sheetUrl ?? null }
}

/**
 * Salva il record nel foglio annuale e, se fornito, carica il PDF nella cartella Drive.
 * Se il cedolino è già nel foglio il server rifiuta (PayrollApiError "already_saved")
 * a meno che `overwrite` sia true.
 */
export async function savePayrollRecord(
  record: PayrollRecord,
  accessToken: string,
  file?: File | null,
  options: { overwrite?: boolean } = {},
): Promise<PayrollSaveResult> {
  const pdf = file && file.size <= MAX_PAYROLL_PDF_BYTES ? { fileName: file.name, base64: await toBase64(file) } : undefined
  const body = await callPayrollApi({ record, pdf, overwrite: options.overwrite === true }, accessToken, 'Il cedolino non è stato salvato.')
  if ((body.action !== 'inserted' && body.action !== 'updated') || !body.recordKey) {
    throw new PayrollApiError('save_failed', 'Il cedolino non è stato salvato.')
  }
  return {
    action: body.action,
    recordKey: body.recordKey,
    sheetUrl: body.sheetUrl ?? null,
    pdf: body.pdf ?? 'skipped',
    pdfUrl: body.pdfUrl ?? null,
  }
}
