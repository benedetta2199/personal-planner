import { normalizeKey, parseAmount, parseDecimal } from './parsers.js'
import type { IncomeOperation, Operation } from './types.js'

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
  /**
   * Tutte le voci lette dal cedolino, con gli stessi nomi di colonna del
   * dataset storico (es. "Contributo_IVS_Trattenuta"). Valori in euro/ore,
   * come nel CSV generato dal notebook "Busta_paga (build_csv)".
   */
  details: Record<string, number>
  sourceHash: string
}

export interface PayrollExtraction {
  record: PayrollRecord
  warnings: string[]
}

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

/** Ordine delle colonne del dataset storico (COLONNE_ORDINE del notebook). */
export const PAYROLL_COLUMNS = [
  'Mese', 'Anno', 'Tipo_Busta', 'Busta_Aggiuntiva',
  'Paga_Base', 'Contingenza', 'Terzo_Elemento', 'Totale_Retribuzione_Base',
  'Paga_Oraria', 'Ore_Lavorate', 'Compenso', 'Ore_Sottratte', 'Compenso_Sottratto',
  'Retribuzione_Variabile',
  'Contributo_Fondo_EST',
  'Contributo_IVS_Base', 'Contributo_IVS_Percentuale', 'Contributo_IVS_Trattenuta',
  'Contributo_CIGS_Base', 'Contributo_CIGS_Percentuale', 'Contributo_CIGS_Trattenuta',
  'Ente_Bilat_Commercio_Base', 'Ente_Bilat_Commercio_Percentuale', 'Ente_Bilat_Commercio_Trattenute',
  'Ente_Bilat_Commercio_Azienda_Percentuale', 'Ente_Bilat_Commercio_Azienda_Competenze',
  'IRPEF_Imponibile_Base', 'IRPEF_Lorda_Base', 'IRPEF_Pagata',
  'Detrazioni_LavDip_Base', 'Imponibile_rinnovi_Base', 'Imposta_sostitutiva_Trattenuta',
  'Ferie_Maturate', 'Ferie_Godute', 'Ferie_Restanti',
  'Permessi_Maturati', 'Permessi_Goduti', 'Permessi_Restanti',
  'Totale_Competenze', 'Totale_Trattenute', 'Netto_Busta',
  'Progressivo_Imp_INPS', 'Progressivo_Imp_IRPEF', 'Progressivo_IRPEF_Pagata',
  'Ore_Festivita_Godute',
  'Contr_aggiuntivi_FONTE_Personale_Base', 'Contr_aggiuntivi_FONTE_Personale_Percentuale',
  'Contr_aggiuntivi_FONTE_Personale',
  'Contr_aggiuntivi_FONTE_Azienda_Percentuale', 'Contr_aggiuntivi_FONTE_Azienda',
  'TFR_trasferito_FONTE', 'Ctr_prev_compl_deducib',
  'Ore_Ferie_Godute', 'Compenso_Ferie_Godute',
  'Paga_Oraria_Mensilita_Aggiuntiva', 'Ore_Mensilita_Aggiuntiva', 'Importo_Mensilita_Aggiuntiva',
  'Imponibile_TassAut', 'IRPEF_Lorda_TassAut', 'Ritenute_IRPEF_TassAut',
] as const

/** Colonne numeriche (tutte tranne quelle di periodo/tipo). */
export const PAYROLL_DETAIL_COLUMNS: readonly string[] = PAYROLL_COLUMNS.slice(4)

/** Campi principali del record ↔ colonna del dataset da cui vengono letti. */
export const CORE_FIELD_COLUMNS = {
  basePay: 'Paga_Base',
  grossPay: 'Totale_Competenze',
  totalDeductions: 'Totale_Trattenute',
  netPay: 'Netto_Busta',
  hoursWorked: 'Ore_Lavorate',
  inpsTaxable: 'Contributo_IVS_Base',
  irpefTaxable: 'IRPEF_Imponibile_Base',
  irpefPaid: 'IRPEF_Pagata',
  vacationRemaining: 'Ferie_Restanti',
  permitsRemaining: 'Permessi_Restanti',
} as const

/** Etichette generiche, usate solo se il layout Zucchetti non viene riconosciuto. */
const FALLBACK_ALIASES: Record<keyof typeof CORE_FIELD_COLUMNS, readonly string[]> = {
  basePay: ['pagabase'],
  grossPay: ['totalecompetenze', 'competenzecomplessive'],
  totalDeductions: ['totaletrattenute', 'trattenutetotali'],
  netPay: ['nettobusta', 'nettoinbusta', 'nettoapagare', 'nettodapagare', 'nettodelmese', 'nettomese'],
  hoursWorked: ['orelavorate'],
  inpsTaxable: ['imponibileinps'],
  irpefTaxable: ['imponibileirpef'],
  irpefPaid: ['irpefpagata', 'ritenuteirpef'],
  vacationRemaining: ['ferierestanti', 'residuoferie'],
  permitsRemaining: ['permessirestanti', 'residuopermessi'],
}

function findLabeledValue(lines: string[], aliases: readonly string[], isMoney: boolean): number | null {
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

const MONEY_FIELDS = new Set(['basePay', 'grossPay', 'totalDeductions', 'netPay', 'inpsTaxable', 'irpefTaxable', 'irpefPaid'])

// Numero nel formato del cedolino: "1.257,46000", "10,61756", "116,80".
const N = '(\\d[\\d.,]*)'

/** Converte un numero in formato italiano (es. "1.257,46") in number (port di clean_num). */
export function cleanNum(text: string | undefined | null): number | null {
  if (text === undefined || text === null) return null
  let clean = String(text).trim().replace(/[^\d,.-]/g, '')
  if (!clean) return null
  if (clean.includes(',') && clean.includes('.')) clean = clean.replace(/\./g, '').replace(',', '.')
  else if (clean.includes(',')) clean = clean.replace(',', '.')
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

type Details = Record<string, number>

/** Applica un pattern e assegna i gruppi catturati alle colonne indicate (null = gruppo ignorato). */
function grab(text: string, pattern: RegExp, columns: (string | null)[], d: Details): RegExpExecArray | null {
  const match = pattern.exec(text)
  if (!match) return null
  columns.forEach((column, index) => {
    if (!column) return
    const value = cleanNum(match[index + 1])
    if (value !== null) d[column] = value
  })
  return match
}

function extractPeriod(text: string): { year: number | null; month: number | null } {
  const match = new RegExp(`(${MONTH_NAMES.join('|')})\\s+(\\d{4})`, 'i').exec(text)
  if (!match) return { year: null, month: null }
  const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === match[1].toLowerCase()) + 1
  return { year: Number(match[2]), month }
}

/** Periodo dal nome file (es. "03-26 Cognome Nome.pdf"), usato se il testo non lo riporta. */
function periodFromFileName(fileName: string): { year: number | null; month: number | null } {
  const match = /(?:^|[^0-9])(\d{1,2})[-_](\d{2}|\d{4})(?:[^0-9]|$)/.exec(fileName)
  if (!match) return { year: null, month: null }
  const month = Number(match[1])
  let year = Number(match[2])
  if (year < 100) year += 2000
  return { year, month: month >= 1 && month <= 12 ? month : null }
}

function extractRetribuzione(text: string, d: Details) {
  // Le 3 etichette stanno su una riga, i valori sulla successiva (a volte
  // preceduti da caratteri spuri come "I I").
  grab(text, new RegExp(`PAGA BASE\\s+CONTING\\.\\s+3'ELEMEN\\.[^\\d]*?${N}\\s+${N}\\s+${N}`), ['Paga_Base', 'Contingenza', 'Terzo_Elemento'], d)
  // Il TOTALE segue la data del prossimo scatto (es. "4-2029").
  grab(text, new RegExp(`PROSSIMO\\s*SCATTO[\\s\\S]*?\\d{1,2}-\\d{4}\\s+${N}`), ['Totale_Retribuzione_Base'], d)
}

function extractBlocco1(text: string, d: Details) {
  grab(text, new RegExp(`Z00001\\s*Retribuzione\\s+${N}\\s+${N}\\s*ORE\\s+${N}`), ['Paga_Oraria', 'Ore_Lavorate', 'Compenso'], d)
  grab(text, new RegExp(`Z00250\\s*Ferie godute\\s+${N}\\s+${N}\\s*ORE\\s+${N}`), [null, 'Ore_Ferie_Godute', 'Compenso_Ferie_Godute'], d)
  grab(text, new RegExp(`ZP0100\\s*-?\\s*Festivita'?\\s*godute\\s+${N}\\s*ORE`, 'i'), ['Ore_Festivita_Godute'], d)
  grab(text, new RegExp(`Z02001\\s*Assenza assunti/dimessi\\s+${N}\\s+${N}\\s*ORE\\s+${N}`), [null, 'Ore_Sottratte', 'Compenso_Sottratto'], d)
  grab(text, new RegExp(`000777.*?Retribuzione Variabile.*?${N}`), ['Retribuzione_Variabile'], d)
}

/** Tredicesima/quattordicesima: riconosciute dalla voce "13ma/14ma Mensilita'". */
function extractMensilitaAggiuntiva(text: string, d: Details): string {
  const match = grab(
    text,
    new RegExp(`(1[34])ma\\s*Mensilita'?\\s+${N}\\s+${N}\\s*ORE\\s+${N}`, 'i'),
    [null, 'Paga_Oraria_Mensilita_Aggiuntiva', 'Ore_Mensilita_Aggiuntiva', 'Importo_Mensilita_Aggiuntiva'],
    d,
  )
  if (!match) return 'Normale'
  return match[1] === '13' ? 'Tredicesima' : 'Quattordicesima'
}

function extractBlocco2(text: string, d: Details) {
  grab(text, new RegExp(`Z31000\\s*Contributo Fondo EST\\s+${N}`), ['Contributo_Fondo_EST'], d)
  grab(text, new RegExp(`Z00000\\s*Contributo IVS\\s+${N}\\s+${N}\\s*%\\s+${N}`), ['Contributo_IVS_Base', 'Contributo_IVS_Percentuale', 'Contributo_IVS_Trattenuta'], d)
  grab(text, new RegExp(`Z00071\\s*Contributo CIGS\\s+${N}\\s+${N}\\s*%\\s+${N}`), ['Contributo_CIGS_Base', 'Contributo_CIGS_Percentuale', 'Contributo_CIGS_Trattenuta'], d)
  grab(
    text,
    new RegExp(`Z20000\\s*Contr\\.?\\s*base\\s*FONTE\\s*su\\s*retr\\.?\\s*TFR\\s+${N}\\s+${N}\\s*%\\s+${N}`, 'i'),
    ['Contr_aggiuntivi_FONTE_Personale_Base', 'Contr_aggiuntivi_FONTE_Personale_Percentuale', 'Contr_aggiuntivi_FONTE_Personale'],
    d,
  )
  // Quota azienda: solo percentuale e importo tra parentesi.
  grab(
    text,
    new RegExp(`Z20000\\s*Contr\\.?\\s*base\\s*FONTE\\s*su\\s*retr\\.?\\s*TFR\\s*C/Ditta\\s+${N}\\s*%\\s*\\(\\s*${N}\\s*\\)`, 'i'),
    ['Contr_aggiuntivi_FONTE_Azienda_Percentuale', 'Contr_aggiuntivi_FONTE_Azienda'],
    d,
  )
  grab(text, new RegExp(`ENTE\\s*BILAT\\.?\\s*COMMERCIO\\s+${N}\\s+${N}\\s*%\\s+${N}`, 'i'), ['Ente_Bilat_Commercio_Base', 'Ente_Bilat_Commercio_Percentuale', 'Ente_Bilat_Commercio_Trattenute'], d)
  grab(
    text,
    new RegExp(`ENTE\\s*BILAT\\.?\\s*COMMERCIO\\s*C/Ditta\\s+${N}\\s*%\\s*\\(\\s*${N}\\s*\\)`, 'i'),
    ['Ente_Bilat_Commercio_Azienda_Percentuale', 'Ente_Bilat_Commercio_Azienda_Competenze'],
    d,
  )
}

function extractTfr(text: string, d: Details) {
  grab(text, new RegExp(`Z20008\\s*T\\.?F\\.?R\\.?\\s*trasferito\\s*FONTE\\s*${N}`, 'i'), ['TFR_trasferito_FONTE'], d)
}

function extractBlocco3(text: string, d: Details) {
  const patterns: [string, RegExp][] = [
    ['IRPEF_Imponibile_Base', new RegExp(`F02000.*?Imponibile IRPEF\\s+${N}`, 'i')],
    ['IRPEF_Lorda_Base', new RegExp(`F02010.*?IRPEF lorda\\s+${N}`, 'i')],
    ['IRPEF_Pagata', new RegExp(`F03020.*?Ritenute IRPEF\\s+${N}`, 'i')],
    ['Detrazioni_LavDip_Base', new RegExp(`F02500.*?Detrazioni lav\\.dip\\.\\s+${N}`, 'i')],
    ['Imponibile_rinnovi_Base', new RegExp(`F03320.*?Imponibile rinnovi.*?\\s+${N}\\s*$`, 'im')],
    ['Imposta_sostitutiva_Trattenuta', new RegExp(`F03325.*?Imposta sostitutiva.*?\\s+${N}\\s*$`, 'im')],
    ['Ctr_prev_compl_deducib', new RegExp(`F01998\\s*Ctr\\.?prev\\.?compl\\.?deducib\\.?\\s+${N}`, 'i')],
    // Tassazione separata, tipica di 13esima/14esima.
    ['Imponibile_TassAut', new RegExp(`F06000.*?Imponibile\\s+Tass\\.aut\\.\\s+${N}`, 'i')],
    ['IRPEF_Lorda_TassAut', new RegExp(`F06010.*?IRPEF lorda\\s+Tass\\.aut\\.\\s+${N}`, 'i')],
    ['Ritenute_IRPEF_TassAut', new RegExp(`F06020.*?Ritenute IRPEF\\s+Tass\\.aut\\.\\s+${N}`, 'i')],
  ]
  for (const [column, pattern] of patterns) grab(text, pattern, [column], d)
}

/** Righe "Ferie 86,5 56,0 30,5 ORE": 3 valori = maturato/goduto/saldo, 2 valori = maturato/saldo. */
function extractRatei(text: string, label: string, columns: [string, string, string], d: Details) {
  const match = new RegExp(`${label}\\s+${N}(?:[ \\t]+${N})?(?:[ \\t]+${N})?`).exec(text)
  if (!match) return
  const values = match.slice(1, 4).filter((v): v is string => Boolean(v)).map((v) => cleanNum(v) ?? 0)
  if (values.length === 2) [d[columns[0]], d[columns[1]], d[columns[2]]] = [values[0], 0, values[1]]
  else if (values.length === 3) [d[columns[0]], d[columns[1]], d[columns[2]]] = values
}

function extractTotali(text: string, d: Details) {
  // "TOTALEsCOMPETENZE 2.000,00": la "s" è uno spazio reso male dal PDF.
  grab(text, new RegExp(`TOTALE\\s*s?\\s*COMPETENZE\\s+${N}`), ['Totale_Competenze'], d)
  grab(text, new RegExp(`TOTALE\\s*s?\\s*TRATTENUTE\\s+${N}`), ['Totale_Trattenute'], d)
  if (d.Totale_Competenze === undefined || d.Totale_Trattenute === undefined) {
    // Layout alternativo (pdfplumber): i due valori precedono "Residuo AP Maturato Goduto Saldo".
    grab(text, new RegExp(`${N}\\s+${N}\\s*Residuo AP\\s*Maturato\\s*Goduto\\s*Saldo`), ['Totale_Trattenute', 'Totale_Competenze'], d)
  }
  if (!grab(text, new RegExp(`NETTO\\s*s?\\s*DEL\\s*s?\\s*MESE\\s+${N}\\s*€`), ['Netto_Busta'], d)) {
    grab(text, new RegExp(`${N}\\s*€`), ['Netto_Busta'], d)
  }
}

function extractProgressivi(text: string, d: Details) {
  grab(
    text,
    new RegExp(`Imp\\.\\s*INPS\\s+Imp\\.\\s*IRPEF\\s+IRPEF pagata\\s+${N}\\s+${N}\\s+${N}`, 'i'),
    ['Progressivo_Imp_INPS', 'Progressivo_Imp_IRPEF', 'Progressivo_IRPEF_Pagata'],
    d,
  )
}

/** Port di estrai_dati_pdf del notebook: tutte le voci del cedolino Zucchetti. */
export function extractPayrollDetails(text: string): { year: number | null; month: number | null; type: string; details: Details } {
  const d: Details = {}
  const { year, month } = extractPeriod(text)
  extractRetribuzione(text, d)
  extractBlocco1(text, d)
  const type = extractMensilitaAggiuntiva(text, d)
  extractBlocco2(text, d)
  extractTfr(text, d)
  extractBlocco3(text, d)
  extractRatei(text, 'Ferie', ['Ferie_Maturate', 'Ferie_Godute', 'Ferie_Restanti'], d)
  extractRatei(text, 'Perm\\.Ex-Fs', ['Permessi_Maturati', 'Permessi_Goduti', 'Permessi_Restanti'], d)
  extractTotali(text, d)
  extractProgressivi(text, d)
  return { year, month, type, details: d }
}

export function extractPayrollRecord(fileName: string, lines: string[], sourceHash: string): PayrollExtraction {
  const text = lines.map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
  const extracted = extractPayrollDetails(text)
  const fromName = periodFromFileName(fileName)
  const year = extracted.year ?? fromName.year
  const month = extracted.month ?? fromName.month

  const normalizedSource = normalizeKey(fileName)
  let type = extracted.type
  if (type === 'Normale') {
    if (normalizedSource.includes('14esima') || normalizedSource.includes('quattordicesima')) type = 'Quattordicesima'
    else if (normalizedSource.includes('13esima') || normalizedSource.includes('tredicesima')) type = 'Tredicesima'
  }

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
    details: extracted.details,
    sourceHash,
  }

  for (const [field, column] of Object.entries(CORE_FIELD_COLUMNS) as [keyof typeof CORE_FIELD_COLUMNS, string][]) {
    const value = extracted.details[column]
    const isMoney = MONEY_FIELDS.has(field)
    record[field] = value !== undefined
      ? (isMoney ? Math.round(value * 100) : value)
      : findLabeledValue(lines, FALLBACK_ALIASES[field], isMoney)
  }

  const warnings: string[] = []
  if (!lines.length) warnings.push('Il PDF non contiene testo estraibile. I PDF scannerizzati non sono ancora supportati.')
  if (!year || !month) warnings.push('Mese/anno non identificati con certezza: verifica il periodo prima di salvare.')
  if (record.netPay === null) warnings.push('Netto in busta non riconosciuto: inseriscilo o correggilo nella revisione.')
  if (lines.length && Object.keys(extracted.details).length < 5) {
    warnings.push('Poche voci riconosciute: il cedolino potrebbe avere un layout diverso da quello Zucchetti atteso.')
  }
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

// ---- Confronto con lo stipendio registrato nel foglio ---------------------------

export interface SalaryMatch {
  /**
   * match: un'entrata "Stipendio" ha lo stesso importo del netto;
   * mismatch: c'è un'entrata "Stipendio" nel periodo ma con importo diverso;
   * missing: nessuna entrata "Stipendio" nel periodo; unknown: periodo o netto mancanti.
   */
  status: 'match' | 'mismatch' | 'missing' | 'unknown'
  /** Entrata usata per il confronto (la più plausibile). */
  operation: IncomeOperation | null
  /** Importo registrato − netto in busta, in centesimi. */
  difference: number | null
  /** Tutte le entrate "Stipendio" del periodo considerato. */
  candidates: IncomeOperation[]
  /** Periodo considerato (YYYY-MM-DD, estremi inclusi). */
  from: string | null
  to: string | null
}

const isoDay = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** È un'entrata di stipendio? (categoria "Stipendio", anche con emoji, es. "💵 Stipendio"). */
export function isSalaryOperation(operation: Operation): operation is IncomeOperation {
  return operation.kind === 'income' && normalizeKey(operation.category).includes('stipendio')
}

/**
 * Confronta il netto in busta con le entrate "Stipendio" del foglio.
 * Lo stipendio di un mese viene di solito accreditato nel mese successivo
 * (es. cedolino di marzo → bonifico di aprile), quindi si cerca dal primo giorno
 * del mese del cedolino all'ultimo del mese seguente, preferendo il mese seguente.
 */
export function compareNetWithSalary(record: Pick<PayrollRecord, 'year' | 'month' | 'netPay'>, operations: readonly Operation[]): SalaryMatch {
  const empty: SalaryMatch = { status: 'unknown', operation: null, difference: null, candidates: [], from: null, to: null }
  if (!record.year || !record.month || record.netPay === null) return empty
  const nextYear = record.month === 12 ? record.year + 1 : record.year
  const nextMonth = record.month === 12 ? 1 : record.month + 1
  const from = isoDay(record.year, record.month, 1)
  const to = isoDay(nextYear, nextMonth, 31)
  const nextPrefix = isoDay(nextYear, nextMonth, 1).slice(0, 7)
  const candidates = operations
    .filter(isSalaryOperation)
    .filter((operation) => operation.date.slice(0, 10) >= from && operation.date.slice(0, 10) <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!candidates.length) return { ...empty, status: 'missing', from, to }

  const netPay = record.netPay
  const exact = candidates.find((operation) => Math.abs(operation.amount - netPay) <= 1)
  // Senza corrispondenza esatta: entrata del mese seguente più vicina al netto, altrimenti la più vicina in assoluto.
  const closest = (list: IncomeOperation[]) => [...list].sort((a, b) => Math.abs(a.amount - netPay) - Math.abs(b.amount - netPay))[0]
  const nextMonthOps = candidates.filter((operation) => operation.date.startsWith(nextPrefix))
  const operation = exact ?? closest(nextMonthOps.length ? nextMonthOps : candidates)
  return {
    status: exact ? 'match' : 'mismatch',
    operation,
    difference: operation.amount - netPay,
    candidates,
    from,
    to,
  }
}
