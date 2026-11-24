import { addDaysTo, endOfMonth, isoWeekday, startOfMonth, type IsoDay } from '@/core/utils/dates'

/**
 * Cadenza di un'abitudine:
 *  - `week`      → nei giorni della settimana scelti (es. tutti i giorni, solo feriali);
 *  - `month`     → `target` volte nel mese, in giorni a scelta;
 *  - `halfmonth` → `target` volte in ogni metà del mese (1–15 e 16–fine mese).
 */
export type HabitFrequency = 'week' | 'month' | 'halfmonth'

export interface Habit {
  id: string
  name: string
  emoji: string
  /** Variabile CSS del colore. */
  color: string
  /** Giorni previsti, lunedì = 1 … domenica = 7 (solo per la cadenza settimanale). */
  weekdays: number[]
  /** Assente nei dati delle versioni precedenti: vale `week`. */
  frequency?: HabitFrequency
  /** Volte da fare in ogni periodo (cadenze `month` e `halfmonth`). */
  target?: number
  createdAt: IsoDay
  archived?: boolean
}

export const HABIT_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8']
export const HABIT_EMOJIS = ['💧', '🏃', '🧘', '📖', '🥗', '😴', '🦷', '💊', '✍️', '🎸', '🚶', '🧹', '🌿', '📵', '🙏', '💪']
const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']

export const frequencyOf = (h: Pick<Habit, 'frequency'>): HabitFrequency => h.frequency ?? 'week'
export const isPeriodic = (h: Pick<Habit, 'frequency'>) => frequencyOf(h) !== 'week'
export const targetOf = (h: Pick<Habit, 'target'>) => Math.max(1, Math.floor(h.target ?? 1))

/** Solo cadenza settimanale: il giorno è tra quelli previsti. Le abitudini a periodo si possono fare in qualunque giorno. */
export const isScheduled = (h: Habit, d: IsoDay) => isPeriodic(h) || h.weekdays.includes(isoWeekday(d))

/** Periodo (inclusivo) che contiene `d`: il giorno stesso, il mese o la metà del mese. */
export function periodOf(h: Habit, d: IsoDay): [IsoDay, IsoDay] {
  switch (frequencyOf(h)) {
    case 'month':
      return [startOfMonth(d), endOfMonth(d)]
    case 'halfmonth':
      return Number(d.slice(8, 10)) <= 15 ? [startOfMonth(d), `${d.slice(0, 7)}-15`] : [`${d.slice(0, 7)}-16`, endOfMonth(d)]
    default:
      return [d, d]
  }
}
const previousPeriod = (h: Habit, p: [IsoDay, IsoDay]) => periodOf(h, addDaysTo(p[0], -1))

function countIn(done: Set<IsoDay>, from: IsoDay, to: IsoDay): number {
  let n = 0
  for (const d of done) if (d >= from && d <= to) n++
  return n
}
const periodMet = (h: Habit, done: Set<IsoDay>, p: [IsoDay, IsoDay]) => countIn(done, p[0], p[1]) >= targetOf(h)

/**
 * L'abitudine va proposta nel giorno `d` (liste «di oggi»): per la cadenza settimanale se il giorno è previsto,
 * per quelle a periodo finché l'obiettivo del periodo non è raggiunto (o se è già segnata quel giorno).
 */
export function isDueOn(h: Habit, done: Set<IsoDay>, d: IsoDay): boolean {
  if (!isPeriodic(h)) return h.weekdays.includes(isoWeekday(d))
  return done.has(d) || !periodMet(h, done, periodOf(h, d))
}

/** Avanzamento nel periodo di `d`, es. «2/4 nel mese» (null per la cadenza settimanale). */
export function periodLabel(h: Habit, done: Set<IsoDay>, d: IsoDay): string | null {
  if (!isPeriodic(h)) return null
  const [a, b] = periodOf(h, d)
  return `${countIn(done, a, b)}/${targetOf(h)} ${frequencyOf(h) === 'month' ? 'nel mese' : 'nella quindicina'}`
}

/** Il periodo di `d` ha già raggiunto l'obiettivo (sempre falso per la cadenza settimanale). */
export const periodDone = (h: Habit, done: Set<IsoDay>, d: IsoDay) => isPeriodic(h) && periodMet(h, done, periodOf(h, d))

/** Descrizione della cadenza: «Ogni giorno», «lun, mer, ven», «3 volte al mese», «2 volte ogni mezzo mese». */
export function frequencyLabel(h: Habit): string {
  const f = frequencyOf(h)
  if (f === 'week') return h.weekdays.length === 7 ? 'Ogni giorno' : [...h.weekdays].sort().map((d) => WEEKDAYS[d - 1]).join(', ')
  const t = targetOf(h)
  return `${t === 1 ? '1 volta' : `${t} volte`} ${f === 'month' ? 'al mese' : 'ogni mezzo mese'}`
}

/** Unità della serie: giorni per le abitudini settimanali, mesi o quindicine per quelle a periodo. */
export function streakUnit(h: Habit, n: number): string {
  switch (frequencyOf(h)) {
    case 'month':
      return n === 1 ? 'mese' : 'mesi'
    case 'halfmonth':
      return n === 1 ? 'quindicina' : 'quindicine'
    default:
      return n === 1 ? 'giorno' : 'giorni'
  }
}

/**
 * Serie di giorni consecutivi rispettati (contando solo i giorni previsti), o di periodi consecutivi
 * con l'obiettivo raggiunto. Il giorno/periodo in corso non ancora completato non «rompe» la serie.
 */
export function streak(h: Habit, done: Set<IsoDay>, today: IsoDay): number {
  if (isPeriodic(h)) {
    let p = periodOf(h, today)
    if (!periodMet(h, done, p)) p = previousPeriod(h, p)
    let n = 0
    for (let i = 0; i < 1000 && p[1] >= h.createdAt && periodMet(h, done, p); i++, p = previousPeriod(h, p)) n++
    return n
  }
  let n = 0
  let d = isScheduled(h, today) && !done.has(today) ? addDaysTo(today, -1) : today
  for (let i = 0; i < 3660 && d >= h.createdAt; i++, d = addDaysTo(d, -1)) {
    if (!isScheduled(h, d)) continue
    if (!done.has(d)) break
    n++
  }
  return n
}

/**
 * Percentuale rispettata negli ultimi `days` giorni: giorni previsti (oggi escluso se non ancora fatto)
 * o periodi che toccano la finestra (quello in corso conta solo se già completato).
 */
export function completionRate(h: Habit, done: Set<IsoDay>, today: IsoDay, days = 30): number | null {
  let planned = 0
  let hit = 0
  if (isPeriodic(h)) {
    const from = addDaysTo(today, -(days - 1))
    let p = periodOf(h, today)
    if (periodMet(h, done, p)) {
      planned++
      hit++
    }
    for (p = previousPeriod(h, p); p[1] >= from && p[1] >= h.createdAt; p = previousPeriod(h, p)) {
      planned++
      if (periodMet(h, done, p)) hit++
    }
    return planned ? hit / planned : null
  }
  for (let i = 0; i < days; i++) {
    const d = addDaysTo(today, -i)
    if (d < h.createdAt) break
    if (!isScheduled(h, d)) continue
    if (d === today && !done.has(d)) continue
    planned++
    if (done.has(d)) hit++
  }
  return planned ? hit / planned : null
}

export function bestStreak(h: Habit, done: Set<IsoDay>, today: IsoDay): number {
  let best = 0
  let cur = 0
  if (isPeriodic(h)) {
    const now = periodOf(h, today)
    for (let p = periodOf(h, h.createdAt); p[0] <= now[0]; p = periodOf(h, addDaysTo(p[1], 1))) {
      if (periodMet(h, done, p)) best = Math.max(best, ++cur)
      else if (p[0] !== now[0]) cur = 0
    }
    return best
  }
  for (let d = h.createdAt; d <= today; d = addDaysTo(d, 1)) {
    if (!isScheduled(h, d)) continue
    if (done.has(d)) best = Math.max(best, ++cur)
    else if (d !== today) cur = 0
  }
  return best
}
