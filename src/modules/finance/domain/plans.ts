/**
 * Piani di accumulo (PAC) su ETF: importo fisso addebitato a cadenza regolare, senza commissioni.
 *
 * Cadenze:
 *  - settimanale  → ogni lunedì
 *  - quindicinale → il 2 e il 18 del mese
 *  - mensile      → il 2 del mese
 * Se la data cade di sabato o domenica, l'addebito slitta al lunedì successivo.
 */
import type { Cents, IsoDate } from './types.js'

export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly'

export const PLAN_FREQUENCY_LABEL: Record<PlanFrequency, { label: string; hint: string }> = {
  weekly: { label: 'Settimanale', hint: 'ogni lunedì' },
  biweekly: { label: 'Quindicinale', hint: 'il 2 e il 18 del mese' },
  monthly: { label: 'Mensile', hint: 'il 2 del mese' },
}

/** Addebiti all'anno, per stimare l'equivalente mensile. */
const PER_YEAR: Record<PlanFrequency, number> = { weekly: 52, biweekly: 24, monthly: 12 }

export interface InvestmentPlan {
  id: string
  /** Posizione (categoria␟sotto-categoria) dell'ETF. */
  key: string
  /** Importo per addebito, in centesimi. */
  amount: Cents
  frequency: PlanFrequency
  /** Conto da cui viene addebitato. */
  account: string
  /** Primo giorno da cui il piano può addebitare. */
  startDate: IsoDate
  /** Ultimo giorno già coperto dalle voci generate (le date successive sono da generare). */
  generatedUntil: IsoDate
  active: boolean
}

const DAY = 86400000
const parse = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (d: IsoDate, n: number): IsoDate => iso(parse(d) + n * DAY)

/** Sabato e domenica → lunedì successivo. */
export function toBusinessDay(d: IsoDate): IsoDate {
  const wd = new Date(parse(d)).getUTCDay()
  return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d
}

/** Date «nominali» del calendario (prima dello slittamento) comprese tra from e to, incluse. */
function nominalDates(frequency: PlanFrequency, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  if (frequency === 'weekly') {
    const wd = new Date(parse(from)).getUTCDay()
    for (let d = addDays(from, (8 - wd) % 7); d <= to; d = addDays(d, 7)) out.push(d)
    return out
  }
  const days = frequency === 'biweekly' ? [2, 18] : [2]
  let [y, m] = from.split('-').map(Number)
  for (;;) {
    for (const day of days) {
      const d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (d > to) return out
      if (d >= from) out.push(d)
    }
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
}

/**
 * Date di addebito effettive (già spostate al lunedì se nel weekend) con after < data ≤ until.
 * Si parte qualche giorno prima di `after` per includere le date nominali del weekend
 * che slittano dentro l'intervallo.
 */
export function chargeDates(frequency: PlanFrequency, after: IsoDate, until: IsoDate): IsoDate[] {
  if (until <= after) return []
  const out = new Set<IsoDate>()
  for (const n of nominalDates(frequency, addDays(after, -3), until)) {
    const d = toBusinessDay(n)
    if (d > after && d <= until) out.add(d)
  }
  return [...out].sort()
}

/** Prossimi `count` addebiti a partire da `from` (incluso). */
export function upcomingCharges(plan: Pick<InvestmentPlan, 'frequency' | 'startDate'>, from: IsoDate, count = 4): IsoDate[] {
  const start = plan.startDate > from ? plan.startDate : from
  return chargeDates(plan.frequency, addDays(start, -1), addDays(start, 400)).slice(0, count)
}

/** Equivalente mensile dell'importo del piano. */
export const monthlyEquivalent = (plan: Pick<InvestmentPlan, 'amount' | 'frequency'>): Cents => Math.round((plan.amount * PER_YEAR[plan.frequency]) / 12)

/** ID stabile della voce generata: lo stesso addebito non viene mai duplicato, nemmeno da due dispositivi. */
export const planEntryId = (planId: string, date: IsoDate) => `m-pac-${planId}-${date.replace(/-/g, '')}`
