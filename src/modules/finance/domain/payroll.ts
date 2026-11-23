import { normalizeKey, parseAmount, parseDecimal } from './parsers.js'

export interface PayrollRecord {
  recordKey: string
  year: number | null
  month: number | null
  type: string
  basePay: number | null
  grossPay: number | null
  totalDeductions: number | null
  netPay: number | null
  hoursWorked: number | null
  inpsTaxable: number | null
  irpefTaxable: number | null
  irpefPaid: number | null
  vacationRemaining: number | null
  permitsRemaining: number | null
  sourceHash: string
}

export interface PayrollExtraction {
  record: PayrollRecord
  warnings: string[]
}

const MONTHS: Record<string, number> = {
  gennaio: 1, gen: 1, january: 1, jan: 1,
  febbraio: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  aprile: 4, apr: 4, april: 4,
  maggio: 5, mag: 5, may: 5,
  giugno: 6, giu: 6, june: 6, jun: 6,
  luglio: 7, lug: 7, july: 7, jul: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  settembre: 9, set: 9, sep: 9, september: 9,
  ottobre: 10, ott: 10, october: 10, oct: 10,
  novembre: 11, nov: 11, november: 11,
  dicembre: 12, dic: 12, december: 12, dec: 12,
}

const AMOUNT_FIELDS = {
  basePay: ['pagabase'],
  grossPay: ['totalecompetenze', 'competenzecomplessive', 'totaleretribuzionebase'],
  totalDeductions: ['totaletrattenute', 'trattenutetotali'],
  netPay: ['nettobusta', 'nettoapagare', 'nettodapagare', 'nettomese', 'netto'],
  hoursWorked: ['orelavorate'],
  inpsTaxable: ['imponibileinps', 'contributoivsbase'],
  irpefTaxable: ['irpefimponibilebase', 'imponibileirpef'],
  irpefPaid: ['irpefpagata', 'ritenuteirpef'],
  vacationRemaining: ['ferierestanti', 'residuoferie'],
  permitsRemaining: ['permessirestanti', 'residuopermessi'],
} as const

type AmountField = keyof typeof AMOUNT_FIELDS

function findFieldValue(lines: string[], aliases: readonly string[], isMoney: boolean): number | null {
  for (const line of lines) {
    const normalized = normalizeKey(line)
    if (!aliases.some((alias) => normalized.includes(alias))) continue
    const numbers = line.match(/-?\d[\d.,]*/g) ?? []
    for (let index = numbers.length - 1; index >= 0; index--) {
      const parsed = parseDecimal(numbers[index])
      if (parsed !== null) return isMoney ? parseAmount(numbers[index]) : parsed
    }
  }
  return null
}

function findPeriod(fileName: string, lines: string[]): { year: number | null; month: number | null } {
  const filePeriod = /(?:^|[^0-9])(\d{1,2})[-_](\d{2}|\d{4})(?:[^0-9]|$)/.exec(fileName)
  let year = filePeriod ? Number(filePeriod[2]) : null
  if (year !== null && year < 100) year += 2000
  const combined = normalizeKey(`${fileName} ${lines.join(' ')}`)
  let month = filePeriod ? Number(filePeriod[1]) : null
  if (!month || month > 12) {
    month = null
    for (const [name, number] of Object.entries(MONTHS)) {
      if (combined.includes(normalizeKey(name))) {
        month = number
        break
      }
    }
  }
  if (!year) {
    const match = /\b(20\d{2})\b/.exec(`${fileName} ${lines.join(' ')}`)
    year = match ? Number(match[1]) : null
  }
  return { year, month }
}

export function extractPayrollRecord(fileName: string, lines: string[], sourceHash: string): PayrollExtraction {
  const { year, month } = findPeriod(fileName, lines)
  const normalizedSource = normalizeKey(fileName)
  const type = normalizedSource.includes('14esima') || normalizedSource.includes('quattordicesima')
    ? 'Quattordicesima'
    : normalizedSource.includes('13esima') || normalizedSource.includes('tredicesima')
      ? 'Tredicesima'
      : 'Normale'
  const keyPeriod = year && month ? `${year}-${String(month).padStart(2, '0')}` : 'periodo-da-verificare'
  const record: PayrollRecord = {
    recordKey: `${keyPeriod}-${normalizeKey(type)}`,
    year,
    month,
    type,
    basePay: null,
    grossPay: null,
    totalDeductions: null,
    netPay: null,
    hoursWorked: null,
    inpsTaxable: null,
    irpefTaxable: null,
    irpefPaid: null,
    vacationRemaining: null,
    permitsRemaining: null,
    sourceHash,
  }

  for (const field of Object.keys(AMOUNT_FIELDS) as AmountField[]) {
    const isMoney = !['hoursWorked', 'vacationRemaining', 'permitsRemaining'].includes(field)
    record[field] = findFieldValue(lines, AMOUNT_FIELDS[field], isMoney)
  }

  const warnings: string[] = []
  if (!year || !month) warnings.push('Mese/anno non identificati con certezza: verifica il periodo prima di salvare.')
  if (record.netPay === null) warnings.push('Netto in busta non riconosciuto: inseriscilo o correggilo nella revisione.')
  if (!lines.length) warnings.push('Il PDF non contiene testo estraibile. I PDF scannerizzati non sono ancora supportati.')
  return { record, warnings }
}

export function payrollRecordToSheetRow(record: PayrollRecord): (string | number)[] {
  const euros = (cents: number | null) => cents === null ? '' : cents / 100
  return [
    record.recordKey,
    record.year ?? '',
    record.month ?? '',
    record.type,
    euros(record.basePay),
    euros(record.grossPay),
    euros(record.totalDeductions),
    euros(record.netPay),
    record.hoursWorked ?? '',
    euros(record.inpsTaxable),
    euros(record.irpefTaxable),
    euros(record.irpefPaid),
    record.vacationRemaining ?? '',
    record.permitsRemaining ?? '',
    record.sourceHash,
    new Date().toISOString(),
  ]
}
