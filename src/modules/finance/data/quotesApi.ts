import type { QuoteSeries, SymbolMatch } from '../domain'
import { FinanceApiError } from './financeApi'

const ENDPOINT = '/api/finance/quotes'
const TIMEOUT_MS = 30_000

type Ok<T> = { ok: true } & T
type Fail = { ok: false; code: string; message: string }

async function call<T>(params: URLSearchParams, accessToken?: string): Promise<Ok<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal: controller.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new FinanceApiError(aborted ? 'timeout' : 'network', aborted ? 'Il servizio quotazioni non ha risposto in tempo.' : 'Impossibile contattare il server delle quotazioni.')
  } finally {
    clearTimeout(timer)
  }
  let body: Ok<T> | Fail | null = null
  try {
    body = (await res.json()) as Ok<T> | Fail
  } catch {
    /* risposta non JSON */
  }
  if (!body) throw new FinanceApiError('unavailable', `Endpoint quotazioni non raggiungibile (HTTP ${res.status}). In locale usa "npm run dev".`, res.status)
  if (!body.ok) throw new FinanceApiError(body.code, body.message, res.status)
  return body
}

export interface QuotesResult {
  fetchedAt: string
  baseCurrency: string
  quotes: Record<string, QuoteSeries>
  errors: Record<string, string>
}

export function fetchQuotes(symbols: string[], from: string, base: string, accessToken?: string) {
  return call<QuotesResult>(new URLSearchParams({ symbols: symbols.join(','), from, base }), accessToken)
}

export async function searchSymbols(q: string, accessToken?: string): Promise<SymbolMatch[]> {
  return (await call<{ results: SymbolMatch[] }>(new URLSearchParams({ q }), accessToken)).results
}
