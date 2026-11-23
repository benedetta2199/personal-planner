import { describe, expect, it } from 'vitest'
import { extractPayrollRecord, payrollRecordToSheetRow } from '../payroll.js'

describe('payroll extraction', () => {
  it('extracts a monthly record from Italian labels and keeps amounts in cents', () => {
    const result = extractPayrollRecord(
      'Busta paga marzo 2026.pdf',
      [
        'Paga base 1.500,00',
        'Totale competenze 2.100,00',
        'Totale trattenute 300,00',
        'Netto a pagare 1.800,00',
        'Ore lavorate 160,0',
      ],
      'a'.repeat(64),
    )

    expect(result.record).toMatchObject({
      recordKey: '2026-03-normale',
      year: 2026,
      month: 3,
      basePay: 150000,
      grossPay: 210000,
      totalDeductions: 30000,
      netPay: 180000,
      hoursWorked: 160,
    })
    expect(result.warnings).toEqual([])
  })

  it('formats the confirmed record into a sheet row with euro values', () => {
    const { record } = extractPayrollRecord('13esima 12-2026.pdf', ['Netto in busta 1.250,00'], 'b'.repeat(64))

    expect(record.type).toBe('Tredicesima')
    expect(payrollRecordToSheetRow(record).slice(0, 8)).toEqual([
      '2026-12-tredicesima', 2026, 12, 'Tredicesima', '', '', '', 1250,
    ])
  })
})
