import { addDaysTo, isoWeekday, type IsoDay } from '@/core/utils/dates'

export interface Habit {
  id: string
  name: string
  emoji: string
  /** Variabile CSS del colore. */
  color: string
  /** Giorni previsti, lunedì = 1 … domenica = 7. */
  weekdays: number[]
  createdAt: IsoDay
  archived?: boolean
}

export const HABIT_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8']
export const HABIT_EMOJIS = ['💧', '🏃', '🧘', '📖', '🥗', '😴', '🦷', '💊', '✍️', '🎸', '🚶', '🧹', '🌿', '📵', '🙏', '💪']

export const isScheduled = (h: Habit, d: IsoDay) => h.weekdays.includes(isoWeekday(d))

/**
 * Serie di giorni consecutivi rispettati (contando solo i giorni previsti).
 * Se oggi non è ancora segnato, la serie parte da ieri: non si «rompe» prima di sera.
 */
export function streak(h: Habit, done: Set<IsoDay>, today: IsoDay): number {
  let n = 0
  let d = isScheduled(h, today) && !done.has(today) ? addDaysTo(today, -1) : today
  for (let i = 0; i < 3660 && d >= h.createdAt; i++, d = addDaysTo(d, -1)) {
    if (!isScheduled(h, d)) continue
    if (!done.has(d)) break
    n++
  }
  return n
}

/** Percentuale di giorni previsti rispettati negli ultimi `days` giorni (oggi escluso se non ancora fatto). */
export function completionRate(h: Habit, done: Set<IsoDay>, today: IsoDay, days = 30): number | null {
  let planned = 0
  let hit = 0
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
  for (let d = h.createdAt; d <= today; d = addDaysTo(d, 1)) {
    if (!isScheduled(h, d)) continue
    if (done.has(d)) best = Math.max(best, ++cur)
    else if (d !== today) cur = 0
  }
  return best
}
