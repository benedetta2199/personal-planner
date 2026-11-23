import { describe, expect, it } from 'vitest'
import { applyLedger, applyPreset, defaultLedger, norm, seedCategories, type LedgerState } from '../ledger'
import { computeAccountBalances } from '../calculations'
import { dailyTotals, shiftMonth } from '../periods'
import type { FinanceDataset, Operation } from '../types'

const op = (p: Partial<Operation> & Pick<Operation, 'kind'>): Operation =>
  ({
    id: Math.random().toString(36),
    date: '2026-11-03',
    account: 'Conti',
    category: '🍱 Cibo',
    subcategory: '⭕ Spesa',
    description: '',
    amount: 1000,
    currency: 'EUR',
    extra: {},
    source: { sheet: 'Uscite', row: 2 },
    ...(p.kind === 'expense' ? { expenseType: 'necessary' } : {}),
    ...p,
  }) as Operation

const raw: FinanceDataset = {
  baseCurrency: 'EUR',
  rates: {},
  accounts: [{ name: 'Conti', type: 'liquidity', currency: 'EUR', openingBalance: 50000, declared: true }],
  operations: [
    op({ kind: 'expense', amount: 2500 }),
    op({ kind: 'income', date: '2026-11-01', account: 'Paypal', category: '💵 Stipendio', subcategory: '', amount: 10000 }),
  ],
}

describe('applyLedger', () => {
  it('maps sheet account aliases to the configured name and keeps balances', () => {
    const ds = applyLedger(raw, defaultLedger())
    expect(ds.operations.map((o) => o.account)).toEqual(['PayPal', 'Conto'])
    const conto = computeAccountBalances(ds).find((b) => b.account.name === 'Conto')!
    expect(conto.balance).toBe(50000 - 2500)
    expect(ds.accounts.some((a) => a.name === 'Conti')).toBe(false)
  })

  it('adds manual entries and resolves renamed categories through aliases', () => {
    const state = defaultLedger()
    state.config.categories = seedCategories({ ...state.config, categories: [] }, raw).categories
    const cibo = state.config.categories.find((c) => c.name === '🍱 Cibo')!
    cibo.aliases.push(cibo.name)
    cibo.name = 'Cibo'
    state.entries.push(op({ kind: 'expense', id: 'm-1', category: 'Cibo', account: 'Revolut', source: { sheet: 'Manuale', row: 1 } }))
    const ds = applyLedger(raw, state)
    const expenses = ds.operations.filter((o) => o.kind === 'expense')
    expect(expenses).toHaveLength(2)
    expect(expenses.every((o) => o.category === 'Cibo')).toBe(true)
  })

  it('works without synced data', () => {
    const ds = applyLedger(null, defaultLedger())
    expect(ds.operations).toEqual([])
    expect(ds.accounts.map((a) => a.name)).toEqual(['Conto', 'Revolut', 'Trade Republic', 'Satispay', 'PayPal'])
  })
})

describe('preset categories', () => {
  it('maps sheet names with emoji and ⭕/➕ markers onto the preset', () => {
    expect(norm('🍱 Cibo')).toBe('cibo')
    expect(norm('⭕  Servizi')).toBe('servizi')
    const sheet: FinanceDataset = {
      ...raw,
      operations: [
        op({ kind: 'expense', category: '👬🏻 Divertimento', subcategory: '➕ Bevute' }),
        op({ kind: 'expense', category: '🎁 Regali', subcategory: '⭕ Amici' }),
        op({ kind: 'income', category: '🎁 Regalo', subcategory: '' }),
        op({ kind: 'expense', category: '📈 Investimenti ETF', subcategory: 'MSCI World', expenseType: 'investment' } as Partial<Operation> & { kind: 'expense' }),
        op({ kind: 'income', category: '📈 Investimenti ETF', subcategory: 'Euro Gov Bond 10-15y' }),
      ],
    }
    const ds = applyLedger(sheet, defaultLedger())
    expect(ds.operations.map((o) => `${o.kind}:${o.category}›${o.subcategory}`)).toEqual([
      'expense:Divertimenti›Bevute',
      'expense:Regali›Amici',
      'income:Regalo›',
      'expense:Investimenti›MSCI World',
      'income:Investimenti›Euro Gov Bond 10-15y',
    ])
    // Il preset copre il foglio: si aggiunge solo l'ETF venduto come sotto-categoria d'entrata.
    expect(seedCategories(defaultLedger().config, sheet).added).toBe(1)
  })

  it('migrates an older saved state once, keeping investment links', () => {
    const old = { ...defaultLedger(), preset: undefined, config: { accounts: [], categories: [] }, investments: { '📈 Investimenti ETF␟MSCI World': { ticker: 'SWDA.MI', units: null } } } as LedgerState
    expect(applyPreset(old)).toBe(true)
    expect(old.config.categories.filter((c) => c.kind === 'expense').map((c) => c.name)).toContain('Spese personali')
    expect(Object.keys(old.investments!)).toEqual(['Investimenti␟MSCI World'])
    expect(applyPreset(old)).toBe(false)
  })
})

describe('seedCategories', () => {
  it('creates categories per kind with their subcategories once', () => {
    const first = seedCategories({ accounts: [], categories: [] }, raw)
    expect(first.categories.map((c) => [c.kind, c.name])).toEqual([
      ['expense', '🍱 Cibo'],
      ['income', '💵 Stipendio'],
    ])
    expect(first.categories[0].subcategories.map((s) => s.name)).toEqual(['⭕ Spesa'])
    expect(first.categories[0].defaultExpenseType).toBe('necessary')
    const again = seedCategories({ accounts: [], categories: first.categories }, raw)
    expect(again.added).toBe(0)
  })
})

describe('periods', () => {
  it('shifts months across years and sums daily totals', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    const days = dailyTotals(raw, raw.operations, '2026-11', ['necessary'])
    expect(days).toHaveLength(30)
    expect(days[2]).toBe(2500)
  })
})

describe('saldo iniziale a una data', () => {
  it('fa valere al conto esattamente l importo indicato a inizio giornata', () => {
    const state = defaultLedger()
    const conto = state.config.accounts.find((a) => a.name === 'Conto')!
    conto.openingBalance = 100000
    conto.openingDate = '2026-11-05'
    const sheet: FinanceDataset = {
      ...raw,
      operations: [
        op({ kind: 'expense', date: '2026-11-02', amount: 3000 }),
        op({ kind: 'income', date: '2026-11-04', category: 'Stipendio', subcategory: '', amount: 20000 }),
        op({ kind: 'expense', date: '2026-11-05', amount: 1500 }),
        op({ kind: 'expense', date: '2026-11-10', amount: 500 }),
      ],
    }
    const ds = applyLedger(sheet, state)
    const at = (asOf: string) => computeAccountBalances(ds, { asOf }).find((b) => b.account.name === 'Conto')!.balance
    expect(at('2026-11-04')).toBe(100000)
    expect(at('2026-11-05')).toBe(100000 - 1500)
    expect(computeAccountBalances(ds).find((b) => b.account.name === 'Conto')!.balance).toBe(100000 - 1500 - 500)
  })
})

describe('voci dell app salvate sul foglio', () => {
  it('la copia locale modificata prevale su quella del foglio; le eliminate spariscono subito', () => {
    const state = defaultLedger()
    const sheetCopy = op({ kind: 'expense', id: 'Uscite:m-abc123', amount: 1000, description: 'dal foglio' })
    const other = op({ kind: 'expense', id: 'Uscite:m-zzz999', description: 'da eliminare' })
    state.entries = [op({ kind: 'expense', id: 'm-abc123', amount: 4000, description: 'modificata' })]
    state.outbox = { 'm-abc123': 'upsert', 'm-zzz999': 'delete' }
    const ds = applyLedger({ ...raw, operations: [sheetCopy, other] }, state)
    expect(ds.operations.map((o) => o.description)).toEqual(['modificata'])
  })
})
