import { timingSafeEqual } from 'node:crypto'
import { valueAt, type QuoteSeries, type SymbolMatch } from '../src/modules/finance/domain/investments.js'

export type { QuoteSeries, SymbolMatch }

/**
 * Quotazioni giornaliere di ETF/azioni/crypto (fonte: Yahoo Finance, endpoint
 * pubblici "chart" e "search"). Il browser non può chiamarli direttamente
 * (CORS), quindi passano da qui. Prezzi e storico vengono restituiti già
 * convertiti nella valuta base.
 *
 *   GET /api/finance/quotes?symbols=SWDA.MI,BTC-EUR&from=2026-05-01
 *   GET /api/finance/quotes?q=MSCI%20World          (ricerca ticker)
 */

export type QuotesResponse =
  | { ok: true; fetchedAt: string; baseCurrency: string; quotes: Record<string, QuoteSeries>; errors: Record<string, string> }
  | { ok: true; results: SymbolMatch[] }
  | { ok: false; code: string; message: string }

export interface QuotesRequest {
  method: string
  authorization?: string
  query: URLSearchParams
  env: Record<string, string | undefined>
  /** Iniettabile nei test. */
  fetchImpl?: typeof fetch
}

const YAHOO = 'https://query1.finance.yahoo.com'

// ---- Ricerca (per ISIN o per nome) ------------------------------------------

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/
/** Borse che quotano in euro, nell'ordine in cui conviene proporle. */
const EUR_EXCHANGES = ['MIL', 'GER', 'AMS', 'PAR', 'FRA', 'STU', 'MUN', 'BER', 'DUS', 'HAM', 'VIE', 'BRU', 'MCE', 'LIS']
const EUR_SUFFIX = /\.(MI|DE|AS|PA|F|SG|MU|BE|DU|HM|VI|BR|MC|LS)$/

type YahooQuote = { symbol?: string; longname?: string; shortname?: string; exchDisp?: string; exchange?: string; typeDisp?: string; quoteType?: string }
interface Match {
  symbol: string
  name: string
  exchange: string
  type: string
  isinMatch?: boolean
  eur?: boolean
}

async function yahooSearch(fetchImpl: typeof fetch, q: string): Promise<YahooQuote[]> {
  const json = (await getJson(fetchImpl, `${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0`)) as { quotes?: YahooQuote[] }
  return (json.quotes ?? []).filter((x) => x.symbol && ['ETF', 'EQUITY', 'MUTUALFUND', 'CRYPTOCURRENCY', 'INDEX'].includes(x.quoteType ?? ''))
}

const toMatch = (x: YahooQuote, isinMatch = false): Match => {
  const exchange = x.exchange ?? ''
  return {
    symbol: x.symbol!,
    name: x.longname || x.shortname || x.symbol!,
    exchange: x.exchDisp || exchange,
    type: x.typeDisp || x.quoteType || '',
    isinMatch,
    eur: EUR_EXCHANGES.includes(exchange) || EUR_SUFFIX.test(x.symbol!),
  }
}

const rank = (m: Match) => {
  const i = EUR_EXCHANGES.findIndex((e) => m.exchange.toUpperCase().startsWith(e) || (e === 'MIL' && /\.MI$/.test(m.symbol)) || (e === 'GER' && /\.DE$/.test(m.symbol)))
  return (m.eur ? 0 : 100) + (i < 0 ? 50 : i) - (m.isinMatch ? 0.5 : 0)
}
const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Con un ISIN: trova lo strumento, poi cerca anche le altre quotazioni dello stesso fondo
 * (Yahoo spesso restituisce per l'ISIN una sola borsa, es. Londra in USD) e mette prima quelle in euro.
 */
export async function searchSymbols(fetchImpl: typeof fetch, q: string): Promise<Match[]> {
  const query = q.replace(/\s+/g, '').toUpperCase()
  if (!ISIN.test(query)) return (await yahooSearch(fetchImpl, q)).map((x) => toMatch(x)).sort((a, b) => rank(a) - rank(b))
  const direct = await yahooSearch(fetchImpl, query)
  const out = new Map<string, Match>(direct.map((x) => [x.symbol!, toMatch(x, true)]))
  const name = direct[0]?.longname || direct[0]?.shortname
  if (name) {
    const same = simplify(name)
    for (const x of await yahooSearch(fetchImpl, name).catch(() => [])) {
      if (!out.has(x.symbol!) && simplify(x.longname || x.shortname || '') === same) out.set(x.symbol!, toMatch(x))
    }
  }
  return [...out.values()].sort((a, b) => rank(a) - rank(b))
}
const UA = 'Mozilla/5.0 (compatible; GrowthPlanner/1.0)'
const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,24}$/
const MAX_SYMBOLS = 40

const fail = (status: number, code: string, message: string) => ({ status, body: { ok: false as const, code, message } })

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

interface ChartResult {
  meta: { currency?: string; symbol: string; longName?: string; shortName?: string; regularMarketPrice?: number; regularMarketTime?: number; gmtoffset?: number }
  timestamp?: number[]
  indicators: { quote: { close: (number | null)[] }[]; adjclose?: { adjclose: (number | null)[] }[] }
}

const isoAt = (unixSec: number, offsetSec: number) => new Date((unixSec + offsetSec) * 1000).toISOString().slice(0, 10)

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
  if (res.status === 404) throw new Error('Ticker non trovato.')
  if (!res.ok) throw new Error(`Fonte quotazioni non disponibile (HTTP ${res.status}).`)
  return res.json()
}

interface RawSeries { name: string; currency: string; price: number; priceDate: string; history: [string, number][] }

async function fetchChart(fetchImpl: typeof fetch, symbol: string, from: Date): Promise<RawSeries> {
  const p1 = Math.floor(from.getTime() / 1000)
  const p2 = Math.floor(Date.now() / 1000) + 86400
  const json = (await getJson(fetchImpl, `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`)) as {
    chart?: { result?: ChartResult[] | null; error?: { description?: string } | null }
  }
  const r = json.chart?.result?.[0]
  if (!r) throw new Error(json.chart?.error?.description || 'Ticker non trovato.')
  const off = r.meta.gmtoffset ?? 0
  const closes = r.indicators.quote[0]?.close ?? []
  const byDate = new Map<string, number>()
  ;(r.timestamp ?? []).forEach((t, i) => {
    const c = closes[i]
    if (typeof c === 'number' && Number.isFinite(c)) byDate.set(isoAt(t, off), c)
  })
  const history = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const price = r.meta.regularMarketPrice ?? history[history.length - 1]?.[1]
  if (price === undefined) throw new Error('Nessun prezzo disponibile.')
  const priceDate = r.meta.regularMarketTime ? isoAt(r.meta.regularMarketTime, off) : history[history.length - 1][0]
  return { name: r.meta.longName || r.meta.shortName || symbol, currency: r.meta.currency || 'EUR', price, priceDate, history }
}

/** Le quotazioni in pence (GBp/GBX) vanno riportate in sterline. */
function normalizeCurrency(s: RawSeries): RawSeries {
  if (s.currency === 'GBp' || s.currency === 'GBX') {
    return { ...s, currency: 'GBP', price: s.price / 100, history: s.history.map(([d, v]) => [d, v / 100]) }
  }
  return s
}

export async function handleQuotes(req: QuotesRequest): Promise<{ status: number; body: QuotesResponse }> {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  if (expected) {
    const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
    if (!provided || !safeEqual(provided, expected)) return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')
  }
  const fetchImpl = req.fetchImpl ?? fetch

  // ---- Ricerca ticker ----------------------------------------------------
  if (req.query.has('q')) {
    const q = (req.query.get('q') ?? '').trim()
    if (!q || q.length > 80) return fail(400, 'invalid_request', 'Testo di ricerca non valido.')
    try {
      return { status: 200, body: { ok: true, results: await searchSymbols(fetchImpl, q) } }
    } catch (e) {
      return fail(502, 'quotes_unavailable', (e as Error).message)
    }
  }

  // ---- Quotazioni --------------------------------------------------------
  const symbols = [...new Set((req.query.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!symbols.length) return fail(400, 'invalid_request', 'Nessun ticker richiesto.')
  if (symbols.length > MAX_SYMBOLS) return fail(400, 'invalid_request', `Massimo ${MAX_SYMBOLS} ticker per richiesta.`)
  const bad = symbols.find((s) => !SYMBOL_RE.test(s))
  if (bad) return fail(400, 'invalid_request', `Ticker non valido: ${bad}`)
  const fromParam = req.query.get('from') ?? ''
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? new Date(`${fromParam}T00:00:00Z`) : new Date(Date.now() - 365 * 86400000)
  from.setUTCDate(from.getUTCDate() - 7) // margine per avere una chiusura prima del primo acquisto
  const base = (req.query.get('base') || req.env.BASE_CURRENCY || 'EUR').toUpperCase()
  if (!/^[A-Z]{3}$/.test(base)) return fail(400, 'invalid_request', 'Valuta base non valida.')

  const raw = new Map<string, RawSeries>()
  const errors: Record<string, string> = {}
  await Promise.all(
    symbols.map(async (s) => {
      try {
        raw.set(s, normalizeCurrency(await fetchChart(fetchImpl, s, from)))
      } catch (e) {
        errors[s] = (e as Error).message
      }
    }),
  )

  // Cambi verso la valuta base per i titoli quotati in altre valute.
  const fx = new Map<string, RawSeries>()
  const foreign = [...new Set([...raw.values()].map((r) => r.currency).filter((c) => c !== base))]
  await Promise.all(
    foreign.map(async (c) => {
      try {
        fx.set(c, await fetchChart(fetchImpl, `${c}${base}=X`, from))
      } catch {
        /* gestito sotto: i titoli in quella valuta finiscono negli errori */
      }
    }),
  )

  const quotes: Record<string, QuoteSeries> = {}
  for (const [symbol, r] of raw) {
    const rate = r.currency === base ? null : fx.get(r.currency)
    if (r.currency !== base && !rate) {
      errors[symbol] = `Cambio ${r.currency}/${base} non disponibile.`
      continue
    }
    const conv = (date: string, v: number) => (rate ? v * (valueAt(rate.history, date) ?? rate.price) : v)
    const history = r.history.map(([d, v]) => [d, conv(d, v)] as [string, number])
    const prev = [...r.history].reverse().find(([d]) => d < r.priceDate)
    quotes[symbol] = {
      symbol,
      name: r.name,
      currency: r.currency,
      price: rate ? r.price * rate.price : r.price,
      previousClose: prev ? conv(prev[0], prev[1]) : null,
      priceDate: r.priceDate,
      history,
    }
  }
  return { status: 200, body: { ok: true, fetchedAt: new Date().toISOString(), baseCurrency: base, quotes, errors } }
}
