import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./payrollSheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./payrollSheets.js')>()
  return { ...actual, savePayroll: vi.fn() }
})

import { handlePayrollSave } from './payrollSync.js'
import { savePayroll } from './payrollSheets.js'

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
  beforeEach(() => vi.mocked(savePayroll).mockReset())

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
    )
  })
})
