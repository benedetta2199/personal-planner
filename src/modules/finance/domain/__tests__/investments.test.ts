import { describe, expect, it } from 'vitest'
import { accruedInterest, computePortfolioSeries, computePositions, couponPeriod, groupInvestmentOps, summarizeInvestmentMonth, summarizePortfolio, valueAt, type QuoteSeries } from '../investments'
import type { FinanceDataset, Operation } from '../types'

let n = 0
const op = (p: Partial<Operation> & Pick<Operation, 'kind'>): Operation =>
  ({
    id: `o${n++}`,
    date: '2026-05-04',
    account: 'TradeRepublic',
    category: '📈 Investimenti ETF',
    subcategory: 'MSCI World',
    description: 'PAC',
    amount: 10000,
    currency: 'EUR',
    extra: {},
    source: { sheet: 'Uscite', row: n },
    ...(p.kind === 'expense' ? { expenseType: 'investment' } : {}),
    ...p,
  }) as Operation

const ds = (operations: Operation[]): FinanceDataset => ({ baseCurrency: 'EUR', rates: {}, accounts: [], operations })

const quote: QuoteSeries = {
  symbol: 'SWDA.MI',
  name: 'iShares Core MSCI World',
  currency: 'EUR',
  price: 120,
  previousClose: 118,
  priceDate: '2026-06-10',
  history: [
    ['2026-05-04', 100],
    ['2026-05-05', 101],
    ['2026-06-02', 110],
    ['2026-06-09', 118],
    ['2026-06-10', 120],
  ],
}

describe('valueAt', () => {
  it('uses the last close on or before the date', () => {
    expect(valueAt(quote.history, '2026-05-20')).toBe(101)
    expect(valueAt(quote.history, '2026-06-02')).toBe(110)
    expect(valueAt(quote.history, '2026-01-01')).toBe(100)
  })
})

describe('positions', () => {
  const data = ds([
    op({ kind: 'expense', date: '2026-05-04', amount: 10000 }), // 100 € a 100 → 1 quota
    op({ kind: 'expense', date: '2026-06-02', amount: 11000 }), // 110 € a 110 → 1 quota
    op({ kind: 'expense', subcategory: 'Titoli di stato', category: '📈 Tasso fisso', amount: 10095 }),
    op({ kind: 'expense', expenseType: 'necessary', category: 'Cibo', subcategory: '' } as Partial<Operation> & { kind: 'expense' }),
  ])
  const groups = groupInvestmentOps(data)

  it('groups only investment expenses, by category and sub-category', () => {
    expect(groups.map((g) => g.name).sort()).toEqual(['MSCI World', 'Titoli di stato'])
  })

  it('estimates units from the close of each purchase day and values them today', () => {
    const [world, bond] = computePositions(groups, { '📈 Investimenti ETF␟MSCI World': { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote })
    expect(world.units).toBe(2)
    expect(world.costBasis).toBe(21000)
    expect(world.value).toBe(24000)
    expect(world.unrealized).toBe(3000)
    expect(world.dayChange).toBe(400) // 2 quote × (120 − 118) €
    expect(bond.status).toBe('needs-data')
    expect(bond.value).toBe(10095) // al costo
    const sum = summarizePortfolio([world, bond])
    expect(sum.value).toBe(34095)
    expect(sum.unrealized).toBe(3000)
    expect(sum.atCost).toBe(10095)
  })

  it('manual units override the estimate', () => {
    const [world] = computePositions(groups, { '📈 Investimenti ETF␟MSCI World': { ticker: 'SWDA.MI', units: 2.5 } }, { 'SWDA.MI': quote })
    expect(world.value).toBe(30000)
    expect(world.unitsManual).toBe(true)
  })

  it('closes a position on a full sale and books the realized result', () => {
    const sold = ds([
      op({ kind: 'expense', date: '2026-05-04', amount: 10000 }),
      op({ kind: 'income', date: '2026-06-09', amount: 11790, description: 'Vendita 100% quote' }),
    ])
    const [p] = computePositions(groupInvestmentOps(sold), { '📈 Investimenti ETF␟MSCI World': { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote })
    expect(p.closed).toBe(true)
    expect(p.costBasis).toBe(0)
    expect(p.realized).toBe(1790)
  })

  it('builds a daily series of value vs invested', () => {
    const series = computePortfolioSeries(groups, { '📈 Investimenti ETF␟MSCI World': { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote }, '2026-06-10')
    const last = series[series.length - 1]
    expect(series[0].date).toBe('2026-05-04')
    expect(last.invested).toBe(31095)
    expect(last.value).toBe(34095)
  })
})

describe('bonds (autonomous daily valuation)', () => {
  it('finds coupon periods backwards from maturity and accrues interest', () => {
    expect(couponPeriod('2027-04-20', 1, '2026-06-01')).toEqual({ prev: '2026-04-20', next: '2027-04-20' })
    expect(couponPeriod('2027-04-20', 2, '2026-12-01')).toEqual({ prev: '2026-10-20', next: '2027-04-20' })
    // 1000 € al 2,55% annuo, a metà periodo circa 12,75 €
    expect(accruedInterest(1000, 2.55, 1, '2027-04-20', '2026-10-19')).toBeCloseTo(12.75, 0)
    expect(accruedInterest(1000, 2.55, 1, '2027-04-20', '2027-05-01')).toBe(0)
  })

  it('values a bond by pull-to-par plus accrued coupon, with a daily change', () => {
    const data = ds([op({ kind: 'expense', category: 'Tasso fisso', subcategory: 'Austria 2027', date: '2026-05-18', amount: 1009500 })])
    const cfg = { type: 'bond' as const, ticker: '', units: null, isin: 'AT0000A1ZGE4', coupon: 2.55, couponFrequency: 1, maturity: '2027-04-20', buyPrice: 100.95, nominal: 10000 }
    const [p] = computePositions(groupInvestmentOps(data), { 'Tasso fisso␟Austria 2027': cfg }, {}, {}, '2026-11-22')
    expect(p.status).toBe('tracked')
    expect(p.priceIsPct).toBe(true)
    // Prezzo tra 100,95 e 100, rateo da aprile a novembre (~151 € su 10.000 nominali)
    expect(p.price!).toBeGreaterThan(100)
    expect(p.price! < 100.95).toBe(true)
    expect(p.accrued!).toBeGreaterThan(14000)
    expect(p.dayChange!).toBeGreaterThan(0) // il rateo cresce ogni giorno più di quanto scende il prezzo
    const [matured] = computePositions(groupInvestmentOps(data), { 'Tasso fisso␟Austria 2027': cfg }, {}, {}, '2027-05-01')
    expect(matured.value).toBe(1000000) // rimborso del nominale
    expect(matured.matured).toBe(true)
  })

  it('asks for data when the bond fields are missing', () => {
    const data = ds([op({ kind: 'expense', category: 'Tasso fisso', subcategory: 'X' })])
    const [p] = computePositions(groupInvestmentOps(data), { 'Tasso fisso␟X': { type: 'bond', ticker: '', units: null } }, {})
    expect(p.status).toBe('needs-data')
    expect(p.value).toBe(10000)
  })
})

describe('acquisto con commissione', () => {
  it('ETF senza commissione, azioni e obbligazioni con 1 €', async () => {
    const { splitPurchase } = await import('../investments')
    expect(splitPurchase(1000, 'etf')).toEqual({ invested: 1000, fee: 0 })
    expect(splitPurchase(1000, 'stock')).toEqual({ invested: 900, fee: 100 })
    expect(splitPurchase(1000, 'bond')).toEqual({ invested: 900, fee: 100 })
    expect(splitPurchase(1000, 'stock', 250)).toEqual({ invested: 750, fee: 250 })
    expect(splitPurchase(100, 'stock')).toBeNull() // importo non superiore alla commissione
  })
})

describe('dettaglio per acquisto (lotti)', () => {
  it('calcola quote, valore, rendimento dall acquisto e del giorno per ogni acquisto', async () => {
    const { computeLots } = await import('../investments')
    const data = ds([op({ kind: 'expense', date: '2026-05-04', amount: 10000 }), op({ kind: 'expense', date: '2026-06-02', amount: 11000 })])
    const [g] = groupInvestmentOps(data)
    const [p] = computePositions([g], { [g.key]: { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote })
    const lots = computeLots(g, p, quote)
    expect(lots).toHaveLength(2)
    // 100 € a 100 → 1 quota; 110 € a 110 → 1 quota; prezzo 120, chiusura precedente 118.
    expect(lots[0]).toMatchObject({ units: 1, buyPrice: 100, value: 12000, gain: 2000, dayChange: 200 })
    expect(lots[0].gainPct).toBeCloseTo(0.2)
    expect(lots[1]).toMatchObject({ units: 1, value: 12000, gain: 1000 })
    expect(lots[1].dayChangePct).toBeCloseTo(120 / 118 - 1)
    // La somma dei lotti coincide con la posizione.
    expect(lots.reduce((a, l) => a + (l.value ?? 0), 0)).toBe(p.value)
  })

  it('una vendita riduce tutti gli acquisti in proporzione', async () => {
    const { computeLots } = await import('../investments')
    const data = ds([
      op({ kind: 'expense', date: '2026-05-04', amount: 10000 }),
      op({ kind: 'expense', date: '2026-05-04', amount: 10000 }),
      op({ kind: 'income', date: '2026-06-10', amount: 12000 }), // vende 1 quota su 2
    ])
    const [g] = groupInvestmentOps(data)
    const [p] = computePositions([g], { [g.key]: { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote })
    const lots = computeLots(g, p, quote)
    expect(lots.map((l) => l.remaining)).toEqual([0.5, 0.5])
    expect(lots.map((l) => l.cost)).toEqual([5000, 5000])
  })

  it('vendita: accreditato + commissione = venduto', async () => {
    const { splitSale } = await import('../investments')
    expect(splitSale(900, 100)).toEqual({ gross: 1000, fee: 100 })
    expect(splitSale(1000, 0)).toEqual({ gross: 1000, fee: 0 })
    expect(splitSale(0, 100)).toBeNull()
  })
})

describe('saveback', () => {
  it('fa crescere la posizione senza contare come vendita né cambiare il saldo del conto', async () => {
    const { isSavebackId, computeLots } = await import('../investments')
    const { computeAccountBalances } = await import('../calculations')
    const data: FinanceDataset = {
      ...ds([
        op({ kind: 'expense', id: 'm-buy1', date: '2026-05-04', amount: 10000 }),
        // Saveback: entrata «Saveback» + acquisto della stessa cifra, stesso conto.
        op({ kind: 'income', id: 'm-sb-abc-in', date: '2026-05-05', category: 'Saveback', subcategory: 'MSCI World', amount: 500 }),
        op({ kind: 'expense', id: 'Uscite:m-sb-abc', date: '2026-05-05', amount: 500 }),
      ]),
      accounts: [{ name: 'TradeRepublic', type: 'liquidity', currency: 'EUR', openingBalance: 100000, declared: true }],
    }
    expect(isSavebackId('Uscite:m-sb-abc')).toBe(true)
    expect(isSavebackId('m-buy1')).toBe(false)

    const [g] = groupInvestmentOps(data)
    expect(g.events.map((e) => e.kind)).toEqual(['buy', 'buy']) // nessuna vendita
    const [p] = computePositions([g], { [g.key]: { ticker: 'SWDA.MI', units: null } }, { 'SWDA.MI': quote })
    expect(p).toMatchObject({ invested: 10500, saveback: 500 })
    expect(computeLots(g, p, quote).map((l) => l.saveback)).toEqual([false, true])

    // Il conto perde solo i 100 € pagati di tasca.
    const tr = computeAccountBalances(data).find((b) => b.account.name === 'TradeRepublic')!
    expect(tr.balance).toBe(100000 - 10000)
  })
})

describe('summarizeInvestmentMonth', () => {
  const groups = [
    {
      key: 'a',
      category: 'ETF',
      name: 'World',
      events: [
        { date: '2026-04-10', kind: 'buy' as const, amount: 10000 },
        { date: '2026-05-04', kind: 'buy' as const, amount: 5000 },
        { date: '2026-05-20', kind: 'buy' as const, amount: 1000, saveback: true },
      ],
    },
    { key: 'b', category: 'Azioni', name: 'ACME', events: [{ date: '2026-05-12', kind: 'sell' as const, amount: 3000 }] },
  ]
  const series = [
    { date: '2026-04-10', value: 10000, invested: 10000 },
    { date: '2026-04-30', value: 10500, invested: 10000 },
    { date: '2026-05-04', value: 15600, invested: 15000 },
    { date: '2026-05-29', value: 17100, invested: 16000 },
    { date: '2026-06-02', value: 17000, invested: 16000 },
  ]

  it('somma acquisti, vendite e saveback del mese per investimento', () => {
    const r = summarizeInvestmentMonth(groups, series, '2026-05')
    expect(r.bought).toBe(6000)
    expect(r.sold).toBe(3000)
    expect(r.saveback).toBe(1000)
    expect(r.rows.map((x) => [x.name, x.count])).toEqual([
      ['World', 2],
      ['ACME', 1],
    ])
  })

  it('calcola il rendimento di mercato al netto dei versamenti', () => {
    const r = summarizeInvestmentMonth(groups, series, '2026-05')
    // guadagno latente: 500 a fine aprile → 1100 a fine maggio
    expect(r.gain).toBe(600)
    expect(r.endValue).toBe(17100)
    expect(r.gainPct).toBeCloseTo(600 / (10500 + 6000))
    expect(r.points.map((p) => p.date)).toEqual(['2026-04-30', '2026-05-04', '2026-05-29'])
  })

  it('senza dati nel mese non inventa un rendimento', () => {
    const r = summarizeInvestmentMonth(groups, series, '2026-03')
    expect(r.rows).toEqual([])
    expect(r.gain).toBeNull()
    expect(r.endValue).toBeNull()
  })
})
