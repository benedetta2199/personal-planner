import { describe, expect, it } from 'vitest'
import {
  computeAccountBalances,
  computeBalanceSeries,
  computeCategoryBreakdown,
  computeFlowSummary,
  computeNetWorth,
  diffDatasets,
  importFinanceSheets,
  parseAmount,
  parseDate,
  parseDecimal,
  applyFilters,
  defaultFilters,
  monthRange,
  resolvePeriod,
} from '../index.js'
import type { RawSheets } from '../index.js'

const H = ['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta']

function sample(): RawSheets {
  return {
    Conti: [
      ['Conto', 'Tipo', 'Valuta', 'Saldo iniziale', 'Valore di mercato'],
      ['Banca', 'Conto corrente', 'EUR', 1000, ''],
      ['Broker', 'Investimento', 'EUR', 0, 2600],
      ['Revolut USD', 'Carta', 'USD', 0, ''],
    ],
    Valute: [['Valuta', 'Tasso'], ['USD', 0.9]],
    Entrate: [
      [...H, 'Fonte', 'Ricorrenza'],
      ['01/01/2026', 'Banca', 'Lavoro', 'Stipendio', 'Gennaio', 3000, 'EUR', 'ACME', 'Mensile'],
      ['01/02/2026', 'banca', 'Lavoro', 'Stipendio', 'Febbraio', '3.000,00', '€', 'ACME', 'Mensile'],
    ],
    Uscite: [
      [...H, 'Tipologia', 'Negozio'],
      ['2026-01-05', 'Banca', 'Casa', 'Affitto', 'Affitto gennaio', 800, 'EUR', 'Necessaria', ''],
      ['2026-01-10', 'Banca', 'Svago', 'Cinema', 'Film', '-20', 'EUR', 'aggiuntiva', 'UCI'],
      ['2026-01-10', 'Banca', 'Svago', 'Cinema', 'Film', '-20', 'EUR', 'aggiuntiva', 'UCI'], // duplicato
      ['2026-01-15', 'Banca', 'Investimenti', 'Immobile', 'Quota crowdfunding', 500, 'EUR', 'Investimento', ''],
      ['31/02/2026', 'Banca', 'Casa', 'Bollette', 'Data errata', 50, 'EUR', 'Necessaria', ''],
      ['2026-02-02', 'Banca', 'Casa', 'Bollette', 'Tipo errato', 50, 'EUR', 'Boh', ''],
    ],
    Transazioni: [
      [...H, 'Conto destinazione', 'Valuta destinazione', 'Importo convertito'],
      ['2026-01-20', 'Banca', '', '', 'PAC', 2500, 'EUR', 'Broker', '', ''],
      ['2026-02-03', 'Banca', '', '', 'Ricarica USD', 900, 'EUR', 'Revolut USD', 'USD', 1000],
      ['2026-02-04', 'Banca', '', '', 'Errore', 10, 'EUR', 'Banca', '', ''],
    ],
  }
}

describe('parsers', () => {
  it('parsa date in vari formati', () => {
    expect(parseDate('05/01/2026')).toBe('2026-01-05')
    expect(parseDate('2026-01-05T10:00')).toBe('2026-01-05')
    expect(parseDate(46027)).toBe('2026-01-05') // seriale Sheets
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('ieri')).toBeNull()
  })
  it('parsa importi in formato italiano e internazionale', () => {
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('1,234.56')).toBe(123456)
    expect(parseAmount('€ 12,5')).toBe(1250)
    expect(parseAmount('1.500')).toBe(150000)
    expect(parseAmount('(30)')).toBe(-3000)
    expect(parseAmount(19.99)).toBe(1999)
    expect(parseAmount('abc')).toBeNull()
    expect(parseDecimal('0,9234')).toBeCloseTo(0.9234)
  })
})

describe('importer', () => {
  const result = importFinanceSheets(sample(), { baseCurrency: 'EUR' })
  const { dataset, issues } = result

  it('importa le righe valide e scarta quelle errate', () => {
    expect(dataset.operations.filter((o) => o.kind === 'income')).toHaveLength(2)
    expect(dataset.operations.filter((o) => o.kind === 'expense')).toHaveLength(3)
    expect(dataset.operations.filter((o) => o.kind === 'transfer')).toHaveLength(2)
    expect(issues.some((i) => i.code === 'invalid_date' && i.row === 6)).toBe(true)
    expect(issues.some((i) => i.code === 'invalid_expense_type')).toBe(true)
    expect(issues.some((i) => i.code === 'same_account')).toBe(true)
  })

  it('rileva i duplicati', () => {
    expect(issues.filter((i) => i.code === 'duplicate')).toHaveLength(1)
    expect(result.stats.find((s) => s.sheet === 'Uscite')!.duplicates).toBe(1)
  })

  it('normalizza nomi conto, valute e uscite negative', () => {
    expect(new Set(dataset.operations.map((o) => o.account))).toEqual(new Set(['Banca']))
    expect(dataset.operations.every((o) => o.amount > 0)).toBe(true)
    expect(dataset.operations.find((o) => o.description === 'Febbraio')!.currency).toBe('EUR')
  })

  it('conserva le colonne aggiuntive', () => {
    expect(dataset.operations.find((o) => o.description === 'Film')!.extra).toEqual({ Negozio: 'UCI' })
  })

  it('segnala colonne obbligatorie mancanti', () => {
    const r = importFinanceSheets({ Entrate: [['Giorno', 'Importo'], ['2026-01-01', 1]] })
    expect(r.issues.some((i) => i.code === 'missing_columns' && i.sheet === 'Entrate')).toBe(true)
    expect(r.dataset.operations).toHaveLength(0)
  })

  it('è idempotente: reimportare non genera duplicati', () => {
    const again = importFinanceSheets(sample(), { baseCurrency: 'EUR' })
    expect(diffDatasets(dataset, again.dataset)).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 7 })
  })

  it('il diff riconosce aggiunte e modifiche tramite ID', () => {
    const withId = (amount: number, extraRow = false): RawSheets => ({
      Entrate: [
        [...H, 'ID'],
        ['2026-01-01', 'Banca', 'Lavoro', '', 'Stipendio', amount, 'EUR', 'S1'],
        ...(extraRow ? [['2026-02-01', 'Banca', 'Lavoro', '', 'Bonus', 100, 'EUR', 'S2']] : []),
      ],
    })
    const a = importFinanceSheets(withId(1000)).dataset
    const b = importFinanceSheets(withId(1100, true)).dataset
    expect(diffDatasets(a, b)).toEqual({ added: 1, updated: 1, removed: 0, unchanged: 0 })
  })
})

describe('calcoli finanziari', () => {
  const { dataset } = importFinanceSheets(sample(), { baseCurrency: 'EUR' })

  it('filtra il riepilogo per tutto lo storico, anno o mese specifico', () => {
    const filters = defaultFilters()
    expect(resolvePeriod({ ...filters, period: 'all' }, '2026-11-22')).toEqual({})
    expect(resolvePeriod({ ...filters, period: 'year', year: 2025 }, '2026-11-22')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    })
    expect(resolvePeriod({ ...filters, period: 'specificMonth', year: 2026, month: 2 }, '2026-11-22')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(resolvePeriod({ ...filters, period: 'specificMonth', year: 2026, month: 11 }, '2026-11-22')).toEqual({
      from: '2026-11-01',
      to: '2026-11-22',
    })
  })

  it('separa entrate, spese, investimenti e trasferimenti senza doppi conteggi', () => {
    const s = computeFlowSummary(dataset, dataset.operations)
    expect(s.income).toBe(600000)
    expect(s.necessary).toBe(80000)
    expect(s.additional).toBe(2000)
    expect(s.expenses).toBe(82000)
    // 500 uscita investimento + 2500 trasferimento verso broker; la ricarica USD (liquidità→liquidità) è neutra
    expect(s.invested).toBe(300000)
    expect(s.savings).toBe(600000 - 82000)
    expect(s.netCashflow).toBe(600000 - 82000 - 300000)
  })

  it('calcola i saldi dei conti nella loro valuta', () => {
    const b = computeAccountBalances(dataset, { useMarketValue: false })
    const by = Object.fromEntries(b.map((x) => [x.account.name, x]))
    // 1000 + 6000 − 800 − 20 − 500 − 2500 − 900
    expect(by['Banca'].balance).toBe(228000)
    expect(by['Broker'].balance).toBe(250000)
    expect(by['Revolut USD'].balance).toBe(100000)
    expect(by['Revolut USD'].balanceBase).toBe(90000)
  })

  it('distingue patrimonio, liquidità e investimenti (anche a valore di mercato)', () => {
    const b = computeAccountBalances(dataset)
    const nw = computeNetWorth(dataset, b)
    expect(nw.liquidity).toBe(228000 + 90000)
    expect(nw.investmentAccounts).toBe(260000) // valore di mercato
    expect(nw.externalInvestments).toBe(50000)
    expect(nw.investments).toBe(310000)
    expect(nw.netWorth).toBe(318000 + 310000)
    expect(nw.unrealizedGain).toBe(10000)
    // Il patrimonio è coerente con i flussi: apertura + risparmio + plusvalenza (al netto della conversione EUR→USD)
    const s = computeFlowSummary(dataset, dataset.operations)
    expect(nw.netWorth).toBe(100000 + s.savings + nw.unrealizedGain + (90000 - 90000))
  })

  it('rispetta la data di riferimento per i saldi storici', () => {
    const b = computeAccountBalances(dataset, { asOf: '2026-01-31' })
    expect(b.find((x) => x.account.name === 'Banca')!.balance).toBe(100000 + 300000 - 80000 - 2000 - 50000 - 250000)
    expect(b.find((x) => x.usesMarketValue)).toBeUndefined()
  })

  it('genera serie mensili coerenti', () => {
    const months = monthRange('2026-01', '2026-02')
    const series = computeBalanceSeries(dataset, months)
    expect(series).toHaveLength(2)
    expect(series[1].byAccount['Banca']).toBe(228000)
    expect(series[1].investments).toBe(250000 + 50000)
  })

  it('aggrega per categoria e sotto-categoria', () => {
    const cats = computeCategoryBreakdown(dataset, dataset.operations, ['necessary', 'additional'])
    expect(cats.map((c) => c.name)).toEqual(['Casa', 'Svago'])
    expect(cats[0].subcategories[0]).toMatchObject({ name: 'Affitto', total: 80000, count: 1 })
  })

  it('applica i filtri', () => {
    const f = { ...defaultFilters(), period: 'custom' as const, from: '2026-02-01', to: '2026-02-28', flowTypes: ['transfer' as const] }
    expect(applyFilters(dataset.operations, f, '2026-11-21').map((o) => o.description)).toEqual(['Ricarica USD'])
    const byAccount = { ...defaultFilters(), period: 'all' as const, accounts: ['Broker'] }
    expect(applyFilters(dataset.operations, byAccount, '2026-11-21')).toHaveLength(1)
  })
})
