import type { Cents } from '@/modules/finance/domain'

const LOCALE = 'it-IT'
const moneyFormatters = new Map<string, Intl.NumberFormat>()
const compactFormatters = new Map<string, Intl.NumberFormat>()

function moneyFormatter(currency: string): Intl.NumberFormat {
  let f = moneyFormatters.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    moneyFormatters.set(currency, f)
  }
  return f
}

export function formatMoney(cents: Cents | null | undefined, currency: string, opts: { sign?: boolean } = {}): string {
  if (cents === null || cents === undefined) return '—'
  const s = moneyFormatter(currency).format(cents / 100)
  return opts.sign && cents > 0 ? `+${s}` : s
}

/** Formato compatto per assi dei grafici: 1,2k € */
export function formatMoneyCompact(units: number, currency: string): string {
  let f = compactFormatters.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
    } catch {
      f = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
    }
    compactFormatters.set(currency, f)
  }
  return f.format(units)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: digits }).format(value)
}

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function formatMonth(month: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(LOCALE, { month: style, year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
