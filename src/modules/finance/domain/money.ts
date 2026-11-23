import type { Cents, CurrencyCode, ExchangeRates } from './types.js'

/**
 * Converte un importo tra valute usando i tassi verso la valuta base.
 * Restituisce `null` se manca un tasso: il chiamante decide come segnalarlo,
 * non si inventano mai valori.
 */
export function convert(amount: Cents, from: CurrencyCode, to: CurrencyCode, rates: ExchangeRates): Cents | null {
  if (from === to) return amount
  const rFrom = rates[from]
  const rTo = rates[to]
  if (rFrom === undefined || rTo === undefined || rTo === 0) return null
  return Math.round((amount * rFrom) / rTo)
}

export const sumCents = (values: Iterable<Cents>): Cents => {
  let total = 0
  for (const v of values) total += v
  return total
}

export const toUnits = (cents: Cents): number => cents / 100
