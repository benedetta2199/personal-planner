import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./payrollSheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./payrollSheets.js')>()
  return { ...actual, savePayroll: vi.fn(), checkPayroll: vi.fn() }
})

import { handlePayrollSave } from './payrollSync.js'
import { checkPayroll, PayrollDuplicateError, savePayroll } from './payrollSheets.js'

const record = {
  recordKey: 'ignored-client-key',
  year: 2026,
  month: 3,
  type: 'Normale',
  basePay: 180000,
  grossPay: 210000,
  totalDeductions: 30000,
  netPay: 180000,
  hoursWorked: 160,
  inpsTaxable: 210000,
  irpefTaxable: 190000,
  irpefPaid: 28000,
  vacationRemaining: 64,
  permitsRemaining: 24,
  sourceHash: 'a'.repeat(64),
}

const baseRequest = {
  method: 'POST',
  authorization: 'Bearer secret-token',
  env: { APP_ACCESS_TOKEN: 'secret-token' },
  body: { record },
}

describe('payroll save endpoint', () => {
  beforeEach(() => {
    vi.mocked(savePayroll).mockReset()
    vi.mocked(checkPayroll).mockReset()
  })

  it('requires the configured access token before validating or writing', async () => {
    const result = await handlePayrollSave({ ...baseRequest, authorization: 'Bearer wrong-token' })

    expect(result).toMatchObject({ status: 401, body: { ok: false, code: 'unauthorized' } })
    expect(savePayroll).not.toHaveBeenCalled()
  })

  it('rejects records without a positive net amount', async () => {
    const result = await handlePayrollSave({
      ...baseRequest,
      body: { record: { ...record, netPay: 0 } },
    })

    expect(result).toMatchObject({ status: 400, body: { ok: false, code: 'invalid_record' } })
    expect(savePayroll).not.toHaveBeenCalled()
  })

  it('rejects a PDF that does not match the confirmed record', async () => {
    const result = await handlePayrollSave({
      ...baseRequest,
      body: { record, pdf: { fileName: 'x.pdf', base64: Buffer.from('%PDF-1.7 other').toString('base64') } },
    })

    expect(result).toMatchObject({ status: 400, body: { ok: false, code: 'invalid_pdf' } })
    expect(savePayroll).not.toHaveBeenCalled()
  })

  it('recomputes the idempotency key and saves the record without a PDF', async () => {
    vi.mocked(savePayroll).mockResolvedValue({ action: 'inserted', sheetUrl: 'https://sheet', pdf: 'skipped', pdfUrl: null })

    const result = await handlePayrollSave({
      ...baseRequest,
      body: { record },
    })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, action: 'inserted', recordKey: '2026-03-normale' },
    })
    expect(savePayroll).toHaveBeenCalledWith(
      baseRequest.env,
      expect.objectContaining({ recordKey: '2026-03-normale', sourceHash: record.sourceHash }),
      null,
      { overwrite: false },
    )
  })

  it('checks whether the payslip is already in the sheet without saving', async () => {
    const existing = { row: 4, match: 'period' as const, mese: 'Marzo', anno: 2026, tipo: 'Normale', netPay: 852.52, savedAt: null }
    vi.mocked(checkPayroll).mockResolvedValue({ exists: true, existing, sheetUrl: 'https://sheet' })

    const result = await handlePayrollSave({ ...baseRequest, body: { record, mode: 'check' } })

    expect(result).toMatchObject({ status: 200, body: { ok: true, mode: 'check', exists: true, existing } })
    expect(savePayroll).not.toHaveBeenCalled()
  })

  it('returns 409 with the existing row when the payslip is already saved, and passes overwrite through', async () => {
    const existing = { row: 4, match: 'period' as const, mese: 'Marzo', anno: 2026, tipo: 'Normale', netPay: 852.52, savedAt: null }
    vi.mocked(savePayroll).mockRejectedValueOnce(new PayrollDuplicateError(existing, 'https://sheet'))

    const rejected = await handlePayrollSave({ ...baseRequest, body: { record } })
    expect(rejected).toMatchObject({ status: 409, body: { ok: false, code: 'already_saved', existing, sheetUrl: 'https://sheet' } })

    vi.mocked(savePayroll).mockResolvedValueOnce({ action: 'updated', sheetUrl: 'https://sheet', pdf: 'skipped', pdfUrl: null })
    const updated = await handlePayrollSave({ ...baseRequest, body: { record, overwrite: true } })
    expect(updated).toMatchObject({ status: 200, body: { ok: true, action: 'updated' } })
    expect(vi.mocked(savePayroll).mock.calls[1][3]).toEqual({ overwrite: true })
  })
})
