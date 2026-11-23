import { timingSafeEqual } from 'node:crypto'
import { SheetsError } from './googleSheets.js'
import { DriveError } from './googleDrive.js'
import { decodePayrollPdf, savePayroll, PayrollSheetError, validatePayrollRecord, type PayrollSaveOutcome } from './payrollSheets.js'

export interface PayrollSaveRequest {
  method: string
  authorization?: string
  env: Record<string, string | undefined>
  body: unknown
}

export type PayrollSaveBody =
  | ({ ok: true; recordKey: string } & PayrollSaveOutcome)
  | { ok: false; code: string; message: string }

export interface PayrollSaveResponse {
  status: number
  body: PayrollSaveBody
}

const fail = (status: number, code: string, message: string): PayrollSaveResponse => ({
  status,
  body: { ok: false, code, message },
})

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function handlePayrollSave(request: PayrollSaveRequest): Promise<PayrollSaveResponse> {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expectedToken = request.env.APP_ACCESS_TOKEN?.trim()
  if (!expectedToken) return fail(503, 'token_not_configured', 'Configura APP_ACCESS_TOKEN prima di abilitare il salvataggio dei cedolini.')
  const providedToken = request.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')
  }

  const body = request.body && typeof request.body === 'object' ? (request.body as { record?: unknown; pdf?: unknown }) : {}
  const record = validatePayrollRecord(body.record)
  if (!record || record.netPay === null || record.netPay <= 0) {
    return fail(400, 'invalid_record', 'Cedolino non valido: servono periodo, tipo busta e netto in busta positivo.')
  }
  // Il PDF è facoltativo, ma se presente deve essere integro e corrispondere al record.
  const pdf = body.pdf === undefined || body.pdf === null ? null : decodePayrollPdf(body.pdf, record.sourceHash)
  if (body.pdf && !pdf) {
    return fail(400, 'invalid_pdf', 'PDF non valido: deve essere un PDF di massimo 3 MB e corrispondere al cedolino letto.')
  }

  try {
    const outcome = await savePayroll(request.env, record, pdf)
    return { status: 200, body: { ok: true, recordKey: record.recordKey, ...outcome } }
  } catch (error) {
    if (error instanceof PayrollSheetError || error instanceof DriveError || error instanceof SheetsError) {
      return fail(error.status, error.code, error.message)
    }
    console.error('[payroll-save]', error)
    return fail(500, 'internal', 'Errore interno durante il salvataggio del cedolino.')
  }
}
