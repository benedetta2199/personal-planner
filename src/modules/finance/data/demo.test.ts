import { describe, expect, it } from 'vitest'
import { buildDemoSheets } from './demo'
import { computeAccountBalances, computeNetWorth, importFinanceSheets } from '../domain'

describe('dati demo', () => {
  const r = importFinanceSheets(buildDemoSheets(new Date(2026, 10, 21)), { baseCurrency: 'EUR' })
  it('passano dall importatore con esattamente le 2 righe errate previste', () => {
    expect(r.issues.map((i) => i.code).sort()).toEqual(['duplicate', 'invalid_date'])
    expect(r.dataset.operations.length).toBeGreaterThan(300)
  })
  it('non producono saldi negativi sui conti di liquidità', () => {
    const balances = computeAccountBalances(r.dataset)
    for (const b of balances) expect(b.balance, b.account.name).toBeGreaterThan(0)
    expect(computeNetWorth(r.dataset, balances).netWorth).toBeGreaterThan(0)
  })
})
