import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLedgerStore } from './ledgerStore'

const name = () => 'MSCI World'
const eur = () => 'EUR'

describe('PAC: generazione delle voci', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('crea gli addebiti scaduti una sola volta e non ricrea quelli eliminati', () => {
    const ledger = useLedgerStore()
    ledger.state.entries = []
    ledger.addPlan({ key: 'Investimenti␟MSCI World', amount: 5000, frequency: 'monthly', account: 'Trade Republic', startDate: '2026-09-01' })

    expect(ledger.runPlans('2026-11-23', new Set(), name, eur)).toBe(3) // 2 set, 2 ott, 2 nov
    const pac = ledger.state.entries.filter((e) => e.id.startsWith('m-pac-'))
    expect(pac.map((e) => e.date)).toEqual(['2026-09-02', '2026-10-02', '2026-11-02'])
    expect(pac[0]).toMatchObject({ kind: 'expense', expenseType: 'investment', category: 'Investimenti', subcategory: 'MSCI World', amount: 5000, account: 'Trade Republic' })

    // Rieseguire non duplica.
    expect(ledger.runPlans('2026-11-23', new Set(), name, eur)).toBe(0)
    // Una voce eliminata a mano non torna.
    ledger.removeEntry(pac[1].id)
    expect(ledger.runPlans('2026-11-30', new Set(), name, eur)).toBe(0)
    // Il mese dopo arriva il nuovo addebito (2 gennaio 2027 è sabato → lunedì 4).
    expect(ledger.runPlans('2027-01-05', new Set(), name, eur)).toBe(2)
    expect(ledger.state.entries.filter((e) => e.id.startsWith('m-pac-')).map((e) => e.date).slice(-2)).toEqual(['2026-12-02', '2027-01-04'])
  })

  it('non crea addebiti già presenti sul foglio e salta i piani in pausa', () => {
    const ledger = useLedgerStore()
    ledger.state.entries = []
    const plan = ledger.addPlan({ key: 'Investimenti␟VWCE', amount: 2500, frequency: 'biweekly', account: 'Conto', startDate: '2026-11-01' })
    const onSheet = new Set([`m-pac-${plan.id}-20261102`])
    expect(ledger.runPlans('2026-11-23', onSheet, name, eur)).toBe(1) // solo il 18
    ledger.setPlanActive(plan.id, false, '2026-11-23')
    expect(ledger.runPlans('2026-12-31', new Set(), name, eur)).toBe(0)
  })
})

describe('PAC: allineamento con il foglio', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('unisce i PAC quando sia il foglio sia il browser hanno modifiche', () => {
    const ledger = useLedgerStore()
    const local = ledger.addPlan({ key: 'Investimenti␟VWCE', amount: 5000, frequency: 'monthly', account: 'Conto', startDate: '2026-11-01' })
    ledger.state.updatedAt = '2026-11-20T10:00:00.000Z'
    const remote = { ...ledger.cloudConfig(), plans: [{ ...local, id: 'altro', key: 'Investimenti␟MSCI' }] }
    ledger.mergeCloudConfig(remote, '2026-11-21T10:00:00.000Z')
    expect(ledger.state.plans!.map((p) => p.id).sort()).toEqual([local.id, 'altro'].sort())
  })

  it('non fa ricomparire un PAC eliminato in locale', () => {
    const ledger = useLedgerStore()
    const plan = ledger.addPlan({ key: 'Investimenti␟VWCE', amount: 5000, frequency: 'monthly', account: 'Conto', startDate: '2026-11-01' })
    const remote = { ...ledger.cloudConfig(), plans: [plan] }
    ledger.removePlan(plan.id)
    ledger.mergeCloudConfig(remote, '2099-01-01T00:00:00.000Z')
    expect(ledger.state.plans).toEqual([])
    ledger.applyCloudConfig(remote, '2099-01-02T00:00:00.000Z')
    expect(ledger.state.plans).toEqual([])
  })
})
