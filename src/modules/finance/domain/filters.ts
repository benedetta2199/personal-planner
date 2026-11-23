import { flowTypeOf } from './calculations.js'
import type { FlowType, IsoDate, Operation } from './types.js'

export type PeriodPreset = 'month' | '3m' | '6m' | '12m' | 'ytd' | 'lastYear' | 'all' | 'year' | 'specificMonth' | 'custom'

export interface FinanceFilters {
  period: PeriodPreset
  year: number | null
  month: number | null
  from: IsoDate | ''
  to: IsoDate | ''
  accounts: string[]
  categories: string[]
  /** Chiavi composte `categoria␟sotto-categoria` (vedi `subKey`). */
  subcategories: string[]
  flowTypes: FlowType[]
  currencies: string[]
  search: string
}

export const defaultFilters = (): FinanceFilters => ({
  period: '12m',
  year: null,
  month: null,
  from: '',
  to: '',
  accounts: [],
  categories: [],
  subcategories: [],
  flowTypes: [],
  currencies: [],
  search: '',
})

export const subKey = (category: string, subcategory: string) => `${category}␟${subcategory}`
export const splitSubKey = (key: string) => {
  const [category, subcategory = ''] = key.split('␟')
  return { category, subcategory }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Traduce il preset in un intervallo esplicito di date. */
export function resolvePeriod(f: Pick<FinanceFilters, 'period' | 'year' | 'month' | 'from' | 'to'>, today: IsoDate): { from?: IsoDate; to?: IsoDate } {
  const [y, m] = today.split('-').map(Number)
  const startOfMonthsAgo = (n: number) => iso(new Date(Date.UTC(y, m - 1 - n, 1)))
  switch (f.period) {
    case 'month': return { from: startOfMonthsAgo(0), to: today }
    case '3m': return { from: startOfMonthsAgo(2), to: today }
    case '6m': return { from: startOfMonthsAgo(5), to: today }
    case '12m': return { from: startOfMonthsAgo(11), to: today }
    case 'ytd': return { from: `${y}-01-01`, to: today }
    case 'lastYear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'all': return {}
    case 'year': {
      if (!f.year || f.year < 1900 || f.year > 2200) return {}
      return { from: `${f.year}-01-01`, to: f.year === y ? today : `${f.year}-12-31` }
    }
    case 'specificMonth': {
      if (!f.year || f.year < 1900 || f.year > 2200 || !f.month || f.month < 1 || f.month > 12) return {}
      const month = String(f.month).padStart(2, '0')
      const lastDay = new Date(Date.UTC(f.year, f.month, 0)).getUTCDate()
      const monthEnd = `${f.year}-${month}-${String(lastDay).padStart(2, '0')}`
      return { from: `${f.year}-${month}-01`, to: f.year === y && f.month === m ? today : monthEnd }
    }
    case 'custom': return { from: f.from || undefined, to: f.to || undefined }
  }
}

export function matchesFilters(op: Operation, f: FinanceFilters, range: { from?: IsoDate; to?: IsoDate }): boolean {
  if (range.from && op.date < range.from) return false
  if (range.to && op.date > range.to) return false
  if (f.accounts.length) {
    const inAccount = f.accounts.includes(op.account) || (op.kind === 'transfer' && f.accounts.includes(op.toAccount))
    if (!inAccount) return false
  }
  if (f.categories.length && !f.categories.includes(op.category)) return false
  if (f.subcategories.length && !f.subcategories.includes(subKey(op.category, op.subcategory))) return false
  if (f.flowTypes.length && !f.flowTypes.includes(flowTypeOf(op))) return false
  if (f.currencies.length) {
    const inCurrency = f.currencies.includes(op.currency) || (op.kind === 'transfer' && f.currencies.includes(op.toCurrency))
    if (!inCurrency) return false
  }
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay = [op.description, op.category, op.subcategory, op.account, op.kind === 'transfer' ? op.toAccount : '', ...Object.values(op.extra)]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function applyFilters(ops: Operation[], f: FinanceFilters, today: IsoDate): Operation[] {
  const range = resolvePeriod(f, today)
  return ops.filter((op) => matchesFilters(op, f, range))
}

export function activeFilterCount(f: FinanceFilters): number {
  return [f.accounts, f.categories, f.subcategories, f.flowTypes, f.currencies].filter((a) => a.length).length + (f.search ? 1 : 0)
}
