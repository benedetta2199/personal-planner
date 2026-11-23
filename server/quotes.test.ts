import { describe, expect, it } from 'vitest'
import { handleQuotes } from './quotes'

const day = (iso: string) => Date.parse(`${iso}T08:00:00Z`) / 1000

function chart(symbol: string, currency: string, rows: [string, number][], price: number) {
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency, longName: `${symbol} name`, regularMarketPrice: price, regularMarketTime: day(rows[rows.length - 1][0]), gmtoffset: 3600 },
          timestamp: rows.map(([d]) => day(d)),
          indicators: { quote: [{ close: rows.map(([, v]) => v) }] },
        },
      ],
      error: null,
    },
  }
}

/** Finta Yahoo: risponde in base al simbolo richiesto nell'URL. */
function fakeFetch(map: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const key = Object.keys(map).find((k) => url.includes(`/chart/${encodeURIComponent(k)}?`) || (k.startsWith('search:') && url.includes('/search')))
    if (!key) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(map[key]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

const req = (q: Record<string, string>, fetchImpl: typeof fetch, env: Record<string, string> = {}) => ({
  method: 'GET',
  query: new URLSearchParams(q),
  env,
  fetchImpl,
})

describe('handleQuotes', () => {
  it('returns prices, previous close and history in base currency', async () => {
    const res = await handleQuotes(
      req(
        { symbols: 'swda.mi', from: '2026-06-01' },
        fakeFetch({ 'SWDA.MI': chart('SWDA.MI', 'EUR', [['2026-06-08', 118], ['2026-06-09', 119], ['2026-06-10', 121]], 121) }),
      ),
    )
    expect(res.status).toBe(200)
    const body = res.body as Extract<typeof res.body, { quotes: unknown }>
    const q = body.quotes['SWDA.MI']
    expect(q.price).toBe(121)
    expect(q.previousClose).toBe(119)
    expect(q.history.length).toBe(3)
  })

  it('converts foreign-currency listings with the FX series', async () => {
    const res = await handleQuotes(
      req(
        { symbols: 'IGLN.L', from: '2026-06-01', base: 'EUR' },
        fakeFetch({
          'IGLN.L': chart('IGLN.L', 'USD', [['2026-06-09', 50], ['2026-06-10', 52]], 52),
          'USDEUR=X': chart('USDEUR=X', 'EUR', [['2026-06-09', 0.9], ['2026-06-10', 0.92]], 0.92),
        }),
      ),
    )
    const body = res.body as Extract<typeof res.body, { quotes: unknown }>
    expect(body.quotes['IGLN.L'].price).toBeCloseTo(47.84, 2)
    expect(body.quotes['IGLN.L'].previousClose).toBeCloseTo(45, 2)
  })

  it('reports unknown tickers without failing the whole request', async () => {
    const res = await handleQuotes(req({ symbols: 'NOPE.MI' }, fakeFetch({})))
    const body = res.body as Extract<typeof res.body, { errors: unknown }>
    expect(res.status).toBe(200)
    expect(Object.keys(body.errors)).toEqual(['NOPE.MI'])
  })

  it('rejects invalid symbols and enforces the access token', async () => {
    expect((await handleQuotes(req({ symbols: 'bad symbol!' }, fakeFetch({})))).status).toBe(400)
    expect((await handleQuotes(req({ symbols: 'SWDA.MI' }, fakeFetch({}), { APP_ACCESS_TOKEN: 'secret' }))).status).toBe(401)
  })

  it('searches symbols', async () => {
    const res = await handleQuotes(
      req({ q: 'MSCI World' }, fakeFetch({ 'search:': { quotes: [{ symbol: 'SWDA.MI', longname: 'iShares Core MSCI World', exchDisp: 'Milan', quoteType: 'ETF', typeDisp: 'ETF' }] } })),
    )
    const body = res.body as Extract<typeof res.body, { results: unknown }>
    expect(body.results[0].symbol).toBe('SWDA.MI')
  })
})

describe('ricerca per ISIN', () => {
  it('aggiunge le altre quotazioni dello stesso fondo e mette prima quelle in euro', async () => {
    const { searchSymbols } = await import('./quotes')
    const fund = 'iShares Core MSCI World UCITS ETF USD (Acc)'
    const fetchImpl = (async (u: string | URL | Request) => {
      const q = new URL(String(u)).searchParams.get('q')
      const quotes =
        q === 'IE00B4L5Y983'
          ? [{ symbol: 'IWDA.L', longname: fund, exchange: 'LSE', exchDisp: 'London', quoteType: 'ETF' }]
          : [
              { symbol: 'IWDA.L', longname: fund, exchange: 'LSE', exchDisp: 'London', quoteType: 'ETF' },
              { symbol: 'SWDA.MI', longname: fund, exchange: 'MIL', exchDisp: 'Milan', quoteType: 'ETF' },
              { symbol: 'EUNL.DE', longname: fund, exchange: 'GER', exchDisp: 'XETRA', quoteType: 'ETF' },
              { symbol: 'XDWD.DE', longname: 'Xtrackers MSCI World', exchange: 'GER', exchDisp: 'XETRA', quoteType: 'ETF' },
            ]
      return new Response(JSON.stringify({ quotes }))
    }) as typeof fetch
    const r = await searchSymbols(fetchImpl, 'ie00b4l5y983')
    expect(r.map((x) => x.symbol)).toEqual(['SWDA.MI', 'EUNL.DE', 'IWDA.L'])
    expect(r[0]).toMatchObject({ eur: true })
    expect(r.find((x) => x.symbol === 'IWDA.L')).toMatchObject({ isinMatch: true, eur: false })
  })
})
