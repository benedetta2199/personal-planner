/** Utilità di periodo per le viste mensili/annuali (indipendenti dai filtri globali). */
import { flowTypeOf, monthEnd, toBase, type MonthKey } from './calculations.js'
import type { Cents, FinanceDataset, FlowType, IsoDate, Operation } from './types.js'

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const daysInMonth = (month: MonthKey): number => Number(monthEnd(month).slice(8, 10))

export function opsBetween(ops: Operation[], from: IsoDate, to: IsoDate): Operation[] {
  return ops.filter((o) => o.date >= from && o.date <= to)
}

export const opsInMonth = (ops: Operation[], month: MonthKey) => opsBetween(ops, `${month}-01`, monthEnd(month))
export const opsInYear = (ops: Operation[], year: number) => opsBetween(ops, `${year}-01-01`, `${year}-12-31`)

/** Totale giornaliero (valuta base) dei tipi di flusso indicati; indice 0 = giorno 1. */
export function dailyTotals(ds: FinanceDataset, ops: Operation[], month: MonthKey, types: FlowType[]): Cents[] {
  const out = new Array<Cents>(daysInMonth(month)).fill(0)
  const wanted = new Set(types)
  for (const op of ops) {
    if (!op.date.startsWith(month) || !wanted.has(flowTypeOf(op))) continue
    const v = toBase(ds, op.amount, op.currency)
    if (v !== null) out[Number(op.date.slice(8, 10)) - 1] += v
  }
  return out
}

export function cumulative(values: number[]): number[] {
  let acc = 0
  return values.map((v) => (acc += v))
}

/** Anni presenti nei movimenti (più l'anno corrente), dal più recente. */
export function yearsOf(ops: Operation[], today: IsoDate): number[] {
  const set = new Set<number>([Number(today.slice(0, 4))])
  for (const o of ops) set.add(Number(o.date.slice(0, 4)))
  return [...set].sort((a, b) => b - a)
}
