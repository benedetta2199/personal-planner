import type { PayrollRecord } from '../domain/payroll'

export interface PayrollSaveResult {
  action: 'inserted' | 'updated'
  recordKey: string
  sheetUrl: string | null
  pdf: 'uploaded' | 'existing' | 'skipped'
  pdfUrl: string | null
}

export class PayrollApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
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

/** Salva il record nel foglio annuale e, se fornito, carica il PDF nella cartella Drive. */
export async function savePayrollRecord(record: PayrollRecord, accessToken: string, file?: File | null): Promise<PayrollSaveResult> {
  const pdf = file && file.size <= MAX_PAYROLL_PDF_BYTES ? { fileName: file.name, base64: await toBase64(file) } : undefined
  let response: Response
  try {
    response = await fetch('/api/finance/payroll', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ record, pdf }),
    })
  } catch {
    throw new PayrollApiError('network', 'Impossibile raggiungere il servizio di salvataggio dei cedolini.')
  }

  let body: Partial<PayrollSaveResult> & { ok?: boolean; code?: string; message?: string }
  try {
    body = await response.json()
  } catch {
    throw new PayrollApiError('unavailable', `Servizio di salvataggio non raggiungibile (HTTP ${response.status}).`, response.status)
  }
  if (!response.ok || !body.ok || (body.action !== 'inserted' && body.action !== 'updated') || !body.recordKey) {
    throw new PayrollApiError(body.code ?? 'save_failed', body.message ?? 'Il cedolino non è stato salvato.', response.status)
  }
  return {
    action: body.action,
    recordKey: body.recordKey,
    sheetUrl: body.sheetUrl ?? null,
    pdf: body.pdf ?? 'skipped',
    pdfUrl: body.pdfUrl ?? null,
  }
}
