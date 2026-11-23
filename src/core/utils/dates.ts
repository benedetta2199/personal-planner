/**
 * Utilità per date ISO «aaaa-mm-gg» senza fuso orario: i calcoli avvengono in UTC,
 * così l'ora legale non sposta mai i giorni.
 */
export type IsoDay = string

const DAY_MS = 86400000
const LOCALE = 'it-IT'

export const parseDay = (d: IsoDay): number => Date.parse(`${d}T00:00:00Z`)
export const toDay = (t: number): IsoDay => new Date(t).toISOString().slice(0, 10)

export function todayDay(): IsoDay {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addDaysTo = (d: IsoDay, n: number): IsoDay => toDay(parseDay(d) + n * DAY_MS)
export const daysBetween = (from: IsoDay, to: IsoDay): number => Math.round((parseDay(to) - parseDay(from)) / DAY_MS)

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Aggiunge mesi mantenendo il giorno; se il mese è più corto si usa l'ultimo giorno (31 gen + 1 mese → 28/29 feb). */
export function addMonthsTo(d: IsoDay, n: number, day?: number): IsoDay {
  const [y, m, dd] = d.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  const want = day ?? dd
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(want, daysInMonth(ny, nm))).padStart(2, '0')}`
}

/** Giorno della settimana con lunedì = 1 … domenica = 7. */
export function isoWeekday(d: IsoDay): number {
  const wd = new Date(parseDay(d)).getUTCDay()
  return wd === 0 ? 7 : wd
}

export const startOfWeek = (d: IsoDay): IsoDay => addDaysTo(d, 1 - isoWeekday(d))
export const startOfMonth = (d: IsoDay): IsoDay => `${d.slice(0, 7)}-01`
export function endOfMonth(d: IsoDay): IsoDay {
  const [y, m] = d.split('-').map(Number)
  return `${d.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`
}
export const startOfYear = (d: IsoDay): IsoDay => `${d.slice(0, 4)}-01-01`
export const endOfYear = (d: IsoDay): IsoDay => `${d.slice(0, 4)}-12-31`

/** Elenco dei giorni da `from` a `to`, inclusi. */
export function dayRange(from: IsoDay, to: IsoDay): IsoDay[] {
  const out: IsoDay[] = []
  for (let d = from; d <= to; d = addDaysTo(d, 1)) out.push(d)
  return out
}

/** Le 6 settimane (lun→dom) che coprono il mese di `d`, per la griglia del calendario. */
export function monthGrid(d: IsoDay): IsoDay[][] {
  const first = startOfWeek(startOfMonth(d))
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDaysTo(first, w * 7 + i)))
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: 'UTC' })
  return (d: IsoDay) => f.format(new Date(parseDay(d)))
}

export const fmtLongDay = (d: IsoDay) => cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' })(d))
export const fmtShortDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDayMonth = fmt({ day: 'numeric', month: 'short' })
export const fmtFullDate = fmt({ day: 'numeric', month: 'long', year: 'numeric' })
export const fmtMonthYear = (d: IsoDay) => cap(fmt({ month: 'long', year: 'numeric' })(d))
export const fmtWeekdayShort = fmt({ weekday: 'short' })
export const WEEKDAY_LETTERS = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

/** «oggi», «domani», «tra 5 giorni», «3 giorni fa». */
export function relativeDays(d: IsoDay, today: IsoDay = todayDay()): string {
  const n = daysBetween(today, d)
  if (n === 0) return 'oggi'
  if (n === 1) return 'domani'
  if (n === -1) return 'ieri'
  if (n > 0) {
    if (n < 60) return `tra ${n} giorni`
    const months = Math.round(n / 30.4)
    return months < 24 ? `tra ${months} mesi` : `tra ${Math.round(n / 365)} anni`
  }
  const a = -n
  if (a < 60) return `${a} giorni fa`
  const months = Math.round(a / 30.4)
  return months < 24 ? `${months} mesi fa` : `${Math.round(a / 365)} anni fa`
}
