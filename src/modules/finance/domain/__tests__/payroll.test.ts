import { describe, expect, it } from 'vitest'
import { cleanNum, compareNetWithSalary, extractPayrollRecord, payrollRecordToSheetRow } from '../payroll.js'
import type { Operation } from '../types.js'

const income = (date: string, amount: number, category = '💵 Stipendio'): Operation => ({
  id: `${date}-${amount}`, kind: 'income', date, account: 'Conti', category, subcategory: '', description: '',
  amount, currency: 'EUR', extra: {}, source: { sheet: 'Entrate', row: 2 },
})

/** Testo di un cedolino Zucchetti come lo ricostruisce pdfjs (righe ordinate dall'alto). */
const APRIL = `
PERIODOsDIsRETRIBUZIONE
Specializ : JUNIOR TECHNOLOGY EXPERT Aprile 2026
PAGA BASE CONTING. 3'ELEMEN.
I I 1.257,46000 524,22000 2,07000
RETRIBUZIONE
PROSSIMO SCATTO TOTALE
4-2029 1.783,75000
VOCIsVARIABILIsDELsMESE IMPORTOsBASE RIFERIMENTO TRATTENUTE COMPETENZE
* * Z00001 Retribuzione 10,61756 168,00000 ORE 1.783,75
* * 000777 - Retribuzione Variabile 216,25
ZP0100 - Festivita' godute 8,00000 ORE
Z20006 Quota iscrizione FONTE 3,62
Z20008 T.F.R. trasferito FONTE 148,15 100,00000 % ( 148,15 )
* Z31000 Contributo Fondo EST 2,00
* Z00000 Contributo IVS 2.000,00 5,84000 % 116,80
* Z00071 Contributo CIGS 2.000,00 0,30000 % 6,01
Z20000 Contr. base FONTE su retr.TFR 2.000,00 0,55000 % 11,00
* Z20000 Contr. base FONTE su retr.TFR C/Ditta 1,05000 % ( 21,00 )
004354 ENTE BILAT.COMMERCIO 1.781,68 0,05000 % 0,89
* 004354 ENTE BILAT.COMMERCIO C/Ditta 0,10000 % ( 1,78 )
* F01998 Ctr.prev.compl.deducib. 47,50
F02000 Imponibile IRPEF 1.735,64
F02010 IRPEF lorda 399,20
F02500 Detrazioni lav.dip. 221,46
F03020 Ritenute IRPEF 177,74
F03320 Imponibile rinnovi L.199/25 c.7 126,71
F03325 Imposta sostitutiva L.199/25 c.7 6,34
PROGRESSIVI
Imp. INPS Imp. IRPEF IRPEF pagata
3.048,00 2.651,52 302,69
RATEI TOTALEsCOMPETENZE 2.000,00
Residuo AP Maturato Goduto Saldo
TOTALEsTRATTENUTE 324,40
Ferie 28,83333 28,83333 ORE
Perm.Ex-Fs 5,33333 5,33333 ORE
NETTOsDELsMESE
1.675,60 €
`.trim().split('\n')

const FOURTEENTH = `
Specializ : JUNIOR TECHNOLOGY EXPERT Giugno 2026
* * 000777 - Retribuzione Variabile 72,08
* * Z50022 14ma Mensilita' 10,61756 56,00000 ORE 594,58
F02000 Imponibile IRPEF 63,99
F06000 Imponibile Tass.aut. 515,81
F06010 IRPEF lorda Tass.aut. 118,64
F06020 Ritenute IRPEF Tass.aut. 118,64
RATEI TOTALEsCOMPETENZE 666,66
TOTALEsTRATTENUTE 180,10
Ferie 86,50000 56,00000 30,50000 ORE
NETTOsDELsMESE
486,56 €
`.trim().split('\n')

describe('payroll extraction', () => {
  it('parses Italian numbers like the notebook clean_num', () => {
    expect(cleanNum('1.257,46000')).toBe(1257.46)
    expect(cleanNum('10,61756')).toBe(10.61756)
    expect(cleanNum('')).toBeNull()
  })

  it('extracts every voice of a Zucchetti payslip with the dataset column names', () => {
    const { record, warnings } = extractPayrollRecord('04-26 Cognome Nome.pdf', APRIL, 'a'.repeat(64))

    expect(warnings).toEqual([])
    expect(record).toMatchObject({
      recordKey: '2026-04-normale',
      year: 2026,
      month: 4,
      type: 'Normale',
      basePay: 125746,
      grossPay: 200000,
      totalDeductions: 32440,
      netPay: 167560,
      hoursWorked: 168,
      inpsTaxable: 200000,
      irpefTaxable: 173564,
      irpefPaid: 17774,
      vacationRemaining: 28.83333,
      permitsRemaining: 5.33333,
    })
    expect(record.details).toEqual({
      Paga_Base: 1257.46, Contingenza: 524.22, Terzo_Elemento: 2.07, Totale_Retribuzione_Base: 1783.75,
      Paga_Oraria: 10.61756, Ore_Lavorate: 168, Compenso: 1783.75,
      Retribuzione_Variabile: 216.25, Ore_Festivita_Godute: 8,
      Contributo_Fondo_EST: 2,
      Contributo_IVS_Base: 2000, Contributo_IVS_Percentuale: 5.84, Contributo_IVS_Trattenuta: 116.8,
      Contributo_CIGS_Base: 2000, Contributo_CIGS_Percentuale: 0.3, Contributo_CIGS_Trattenuta: 6.01,
      Contr_aggiuntivi_FONTE_Personale_Base: 2000, Contr_aggiuntivi_FONTE_Personale_Percentuale: 0.55, Contr_aggiuntivi_FONTE_Personale: 11,
      Contr_aggiuntivi_FONTE_Azienda_Percentuale: 1.05, Contr_aggiuntivi_FONTE_Azienda: 21,
      Ente_Bilat_Commercio_Base: 1781.68, Ente_Bilat_Commercio_Percentuale: 0.05, Ente_Bilat_Commercio_Trattenute: 0.89,
      Ente_Bilat_Commercio_Azienda_Percentuale: 0.1, Ente_Bilat_Commercio_Azienda_Competenze: 1.78,
      TFR_trasferito_FONTE: 148.15, Ctr_prev_compl_deducib: 47.5,
      IRPEF_Imponibile_Base: 1735.64, IRPEF_Lorda_Base: 399.2, IRPEF_Pagata: 177.74, Detrazioni_LavDip_Base: 221.46,
      Imponibile_rinnovi_Base: 126.71, Imposta_sostitutiva_Trattenuta: 6.34,
      Ferie_Maturate: 28.83333, Ferie_Godute: 0, Ferie_Restanti: 28.83333,
      Permessi_Maturati: 5.33333, Permessi_Goduti: 0, Permessi_Restanti: 5.33333,
      Totale_Competenze: 2000, Totale_Trattenute: 324.4, Netto_Busta: 1675.6,
      Progressivo_Imp_INPS: 3048, Progressivo_Imp_IRPEF: 2651.52, Progressivo_IRPEF_Pagata: 302.69,
    })
  })

  it('recognises a 14th-month payslip from its voices, not just the file name', () => {
    const { record } = extractPayrollRecord('busta.pdf', FOURTEENTH, 'c'.repeat(64))

    expect(record).toMatchObject({ recordKey: '2026-06-quattordicesima', type: 'Quattordicesima', netPay: 48656 })
    expect(record.details).toMatchObject({
      Paga_Oraria_Mensilita_Aggiuntiva: 10.61756,
      Ore_Mensilita_Aggiuntiva: 56,
      Importo_Mensilita_Aggiuntiva: 594.58,
      Imponibile_TassAut: 515.81,
      IRPEF_Lorda_TassAut: 118.64,
      Ritenute_IRPEF_TassAut: 118.64,
      Ferie_Maturate: 86.5,
      Ferie_Godute: 56,
      Ferie_Restanti: 30.5,
    })
  })

  it('falls back to generic labels for other layouts', () => {
    const result = extractPayrollRecord(
      'Busta paga 03-2026.pdf',
      ['Paga base 1.500,00', 'Totale competenze 2.100,00', 'Totale trattenute 300,00', 'Netto a pagare 1.800,00', 'Ore lavorate 160,0'],
      'a'.repeat(64),
    )

    expect(result.record).toMatchObject({
      recordKey: '2026-03-normale',
      basePay: 150000,
      grossPay: 210000,
      totalDeductions: 30000,
      netPay: 180000,
      hoursWorked: 160,
    })
  })

  it('formats the confirmed record into a sheet row with euro values', () => {
    const { record } = extractPayrollRecord('13esima 12-2026.pdf', ['Netto in busta 1.250,00'], 'b'.repeat(64))

    expect(record.type).toBe('Tredicesima')
    expect(payrollRecordToSheetRow(record).slice(0, 8)).toEqual([
      '2026-12-tredicesima', 2026, 12, 'Tredicesima', '', '', '', 1250,
    ])
  })
})

describe('net pay vs salary in the sheet', () => {
  const operations: Operation[] = [
    income('2026-03-09 13:30:29', 104724),
    income('2026-04-10 18:57:19', 85252),
    income('2026-05-07 13:36:28', 167560),
    income('2026-05-20', 5000, 'Regalo'),
  ]

  it('finds the salary paid the following month with the same amount', () => {
    const result = compareNetWithSalary({ year: 2026, month: 3, netPay: 85252 }, operations)
    expect(result).toMatchObject({ status: 'match', difference: 0, from: '2026-03-01', to: '2026-04-31' })
    expect(result.operation?.date).toBe('2026-04-10 18:57:19')
    expect(result.candidates).toHaveLength(2)
  })

  it('reports the difference when the amount does not match, preferring the next month', () => {
    const result = compareNetWithSalary({ year: 2026, month: 4, netPay: 167000 }, operations)
    expect(result).toMatchObject({ status: 'mismatch', difference: 560 })
    expect(result.operation?.date).toBe('2026-05-07 13:36:28')
  })

  it('ignores non-salary income and reports a missing salary', () => {
    expect(compareNetWithSalary({ year: 2026, month: 6, netPay: 100000 }, operations).status).toBe('missing')
    expect(compareNetWithSalary({ year: 2026, month: null, netPay: 100000 }, operations).status).toBe('unknown')
  })
})
