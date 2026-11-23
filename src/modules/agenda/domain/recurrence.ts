/**
 * Impegni e scadenze ricorrenti (revisione auto, filtri del condizionatore, bollette…).
 *
 * Due modi di calcolare le date:
 *  - `fixed`     → calendario fisso a partire dalla prima scadenza (es. bollo auto ogni gennaio);
 *  - `afterDone` → la scadenza successiva si conta dal giorno in cui l'hai fatto davvero
 *                  (es. filtri ogni 6 mesi: se li cambi in ritardo, la prossima volta slitta).
 *
 * Una scadenza mancata diventa «in ritardo» solo finché non arriva la successiva:
 * un'attività giornaliera saltata ieri non resta in sospeso, una revisione dimenticata sì.
 */
import { addDaysTo, addMonthsTo, daysBetween, isoWeekday, parseDay, startOfWeek, type IsoDay } from '../../../core/utils/dates.js'

export type RepeatUnit = 'none' | 'day' | 'week' | 'month' | 'year'
export type ScheduleMode = 'fixed' | 'afterDone'

export interface Recurrence {
  unit: RepeatUnit
  /** Ogni quante unità (≥ 1). */
  every: number
  /** Solo per `week`: giorni della settimana, lunedì = 1 … domenica = 7. Vuoto = giorno della prima scadenza. */
  weekdays?: number[]
}

export interface Commitment {
  id: string
  title: string
  category: string
  notes?: string
  /** Prima scadenza (o prossima, se si inserisce un impegno già in corso). */
  start: IsoDay
  repeat: Recurrence
  mode: ScheduleMode
  /** Giorni di preavviso: da quando l'impegno compare tra quelli «in arrivo». */
  remindDays: number
  /** Ultima data possibile (facoltativa). */
  until?: IsoDay | null
  paused?: boolean
  createdAt: string
}

export interface Completion {
  commitmentId: string
  /** Scadenza a cui si riferisce. */
  due: IsoDay
  /** Giorno in cui è stato fatto. */
  doneOn: IsoDay
}

export type OccurrenceStatus = 'done' | 'overdue' | 'today' | 'soon' | 'upcoming' | 'missed'

export interface Occurrence {
  commitment: Commitment
  date: IsoDay
  status: OccurrenceStatus
  completion: Completion | null
  /** Data stimata (modalità `afterDone`, oltre la prossima scadenza). */
  projected: boolean
}

export const UNIT_LABEL: Record<Exclude<RepeatUnit, 'none'>, [string, string]> = {
  day: ['giorno', 'giorni'],
  week: ['settimana', 'settimane'],
  month: ['mese', 'mesi'],
  year: ['anno', 'anni'],
}

const WEEKDAY_NAMES = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']

export function recurrenceLabel(r: Recurrence, start?: IsoDay): string {
  if (r.unit === 'none') return 'Una volta'
  const n = Math.max(1, r.every)
  const special: Record<string, string> = { 'day:1': 'Ogni giorno', 'week:1': 'Ogni settimana', 'week:2': 'Ogni 2 settimane', 'month:1': 'Ogni mese', 'month:3': 'Ogni 3 mesi', 'month:6': 'Ogni 6 mesi', 'year:1': 'Ogni anno' }
  let base = special[`${r.unit}:${n}`] ?? `Ogni ${n} ${UNIT_LABEL[r.unit][n === 1 ? 0 : 1]}`
  if (r.unit === 'week') {
    const days = weekdaysOf(r, start)
    if (days.length === 7) base = n === 1 ? 'Ogni giorno' : base
    else if (days.length) base += ` · ${days.map((d) => WEEKDAY_NAMES[d - 1]).join(', ')}`
  }
  return base
}

/** Cadenza «orizzonte» di un impegno, per filtrare i task: giornalieri, settimanali, mensili, annuali. */
export type Horizon = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export function horizonOf(r: Recurrence): Horizon {
  switch (r.unit) {
    case 'none':
      return 'once'
    case 'day':
      return r.every < 7 ? 'daily' : r.every < 28 ? 'weekly' : 'monthly'
    case 'week':
      return (r.weekdays?.length ?? 0) === 7 && r.every === 1 ? 'daily' : r.every < 4 ? 'weekly' : 'monthly'
    case 'month':
      return r.every < 12 ? 'monthly' : 'yearly'
    case 'year':
      return 'yearly'
  }
}
export const HORIZON_LABEL: Record<Horizon, string> = { once: 'Una tantum', daily: 'Giornalieri', weekly: 'Settimanali', monthly: 'Mensili', yearly: 'Annuali' }

function weekdaysOf(r: Recurrence, start?: IsoDay): number[] {
  const set = r.weekdays?.length ? r.weekdays : start ? [isoWeekday(start)] : []
  return [...new Set(set)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
}

/** Data dopo `from` aggiungendo `k` passi della ricorrenza (giorni della settimana ignorati). */
export function stepFrom(from: IsoDay, r: Recurrence, k = 1): IsoDay {
  const n = Math.max(1, r.every) * k
  switch (r.unit) {
    case 'day':
      return addDaysTo(from, n)
    case 'week':
      return addDaysTo(from, n * 7)
    case 'month':
      return addMonthsTo(from, n)
    case 'year':
      return addMonthsTo(from, n * 12)
    default:
      return from
  }
}

/** Date del calendario fisso comprese tra `from` e `to` (inclusi). */
export function fixedDates(c: Pick<Commitment, 'start' | 'repeat' | 'until'>, from: IsoDay, to: IsoDay): IsoDay[] {
  const { start, repeat: r } = c
  const last = c.until && c.until < to ? c.until : to
  const lo = from > start ? from : start
  if (lo > last) return []
  const every = Math.max(1, r.every)
  const out: IsoDay[] = []

  if (r.unit === 'none') return start >= lo && start <= last ? [start] : []

  if (r.unit === 'day') {
    const k0 = Math.max(0, Math.ceil(daysBetween(start, lo) / every))
    for (let d = addDaysTo(start, k0 * every); d <= last; d = addDaysTo(d, every)) out.push(d)
    return out
  }

  if (r.unit === 'week') {
    const days = weekdaysOf(r, start)
    const w0 = startOfWeek(start)
    const k0 = Math.max(0, Math.floor(daysBetween(w0, startOfWeek(lo)) / 7 / every))
    for (let k = k0; ; k++) {
      const week = addDaysTo(w0, k * every * 7)
      if (week > last) break
      for (const wd of days) {
        const d = addDaysTo(week, wd - 1)
        if (d >= lo && d <= last) out.push(d)
      }
    }
    return out
  }

  // Mesi e anni: sempre calcolati dalla prima scadenza, così il 31 non «scivola» al 28.
  const months = r.unit === 'year' ? every * 12 : every
  const day = Number(start.slice(8, 10))
  const monthsBetween = (Number(lo.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(lo.slice(5, 7)) - Number(start.slice(5, 7))
  for (let k = Math.max(0, Math.floor(monthsBetween / months) - 1); ; k++) {
    const d = addMonthsTo(start, k * months, day)
    if (d > last) break
    if (d >= lo) out.push(d)
  }
  return out
}

/** Ultimo completamento (per data di esecuzione). */
function lastDone(list: Completion[]): Completion | null {
  let best: Completion | null = null
  for (const c of list) if (!best || c.doneOn > best.doneOn || (c.doneOn === best.doneOn && c.due > best.due)) best = c
  return best
}

/** Prossima scadenza da fare (anche se già passata), o null se l'impegno è concluso. */
export function nextDue(c: Commitment, completions: Completion[], today: IsoDay): IsoDay | null {
  const mine = completions.filter((x) => x.commitmentId === c.id)
  if (c.mode === 'afterDone' && c.repeat.unit !== 'none') {
    const last = lastDone(mine)
    const d = last ? stepFrom(last.doneOn, c.repeat) : c.start
    return c.until && d > c.until ? null : d
  }
  const done = new Set(mine.map((x) => x.due))
  if (c.repeat.unit === 'none') return done.has(c.start) ? null : c.start
  const overdue = overdueDate(c, done, today)
  if (overdue) return overdue
  // Prima data da oggi non ancora fatta (si cerca su un orizzonte ampio).
  for (let from = today, i = 0; i < 12; i++) {
    const to = addMonthsTo(from, 12 * Math.max(1, c.repeat.unit === 'year' ? c.repeat.every : 1))
    const next = fixedDates(c, from, to).find((d) => !done.has(d))
    if (next) return next
    if (c.until && to >= c.until) return null
    from = addDaysTo(to, 1)
  }
  return null
}

/** Scadenza fissa mancata e ancora «valida»: l'ultima prima di oggi, se nel frattempo non è arrivata la successiva. */
function overdueDate(c: Commitment, done: Set<IsoDay>, today: IsoDay): IsoDay | null {
  if (c.start >= today) return null
  const prev = previousFixed(c, today)
  if (!prev || done.has(prev)) return null
  // Se oggi stesso è una scadenza, quella di prima è superata.
  if (fixedDates(c, today, today).length) return null
  return prev
}

/** Ultima data del calendario fisso strettamente prima di `today`. */
function previousFixed(c: Commitment, today: IsoDay): IsoDay | null {
  const yesterday = addDaysTo(today, -1)
  // Finestra di ricerca proporzionata alla cadenza.
  const span = c.repeat.unit === 'none' ? null : stepFrom(yesterday, c.repeat, -1)
  const from = span && span > c.start ? addDaysTo(span, -7) : c.start
  const list = fixedDates(c, from, yesterday)
  return list.length ? list[list.length - 1] : null
}

function statusOf(date: IsoDay, done: boolean, today: IsoDay, remindDays: number, isOverdue: boolean): OccurrenceStatus {
  if (done) return 'done'
  if (date === today) return 'today'
  if (date < today) return isOverdue ? 'overdue' : 'missed'
  return daysBetween(today, date) <= remindDays ? 'soon' : 'upcoming'
}

/** Tutte le occorrenze di un impegno tra `from` e `to`, con il loro stato. */
export function occurrencesOf(c: Commitment, completions: Completion[], from: IsoDay, to: IsoDay, today: IsoDay): Occurrence[] {
  const mine = completions.filter((x) => x.commitmentId === c.id)
  const byDue = new Map(mine.map((x) => [x.due, x]))
  const out: Occurrence[] = []

  if (c.mode === 'afterDone' && c.repeat.unit !== 'none') {
    for (const comp of mine) if (comp.due >= from && comp.due <= to) out.push({ commitment: c, date: comp.due, status: 'done', completion: comp, projected: false })
    if (c.paused) return out
    const next = nextDue(c, completions, today)
    if (!next) return out
    for (let k = 0, d = next; d <= to && k < 2000; k++, d = stepFrom(next, c.repeat, k)) {
      if (c.until && d > c.until) break
      if (d < from || byDue.has(d)) continue
      out.push({ commitment: c, date: d, status: statusOf(d, false, today, c.remindDays, k === 0), completion: null, projected: k > 0 })
    }
    return out
  }

  const overdue = c.paused ? null : overdueDate(c, new Set(byDue.keys()), today)
  for (const d of fixedDates(c, from, to)) {
    const comp = byDue.get(d) ?? null
    if (c.paused && !comp && d >= today) continue
    out.push({ commitment: c, date: d, status: statusOf(d, !!comp, today, c.remindDays, d === overdue), completion: comp, projected: false })
  }
  return out
}

/** Prime `n` scadenze a partire da oggi (per l'anteprima nel modulo di inserimento). */
export function previewDates(c: Pick<Commitment, 'start' | 'repeat' | 'mode'>, n: number): IsoDay[] {
  if (c.repeat.unit === 'none') return [c.start]
  if (c.mode === 'afterDone') return Array.from({ length: n }, (_, k) => stepFrom(c.start, c.repeat, k))
  const out: IsoDay[] = []
  let from = c.start
  for (let i = 0; i < 10 && out.length < n; i++) {
    const to = addMonthsTo(from, 12 * Math.max(1, c.repeat.unit === 'year' ? c.repeat.every : 1))
    out.push(...fixedDates({ ...c, until: null }, from, to))
    from = addDaysTo(to, 1)
  }
  return out.slice(0, n)
}

export const isValidDay = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDay(d))
