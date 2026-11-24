import { describe, it, expect } from 'vitest'
import { streak, bestStreak, completionRate, isDueOn, periodLabel, frequencyLabel } from './domain'
const base = { id: 'h', name: 'x', emoji: '', color: '', weekdays: [1,2,3,4,5,6,7], createdAt: '2026-08-01' }
describe('mensile', () => {
  const h = { ...base, frequency: 'month' as const, target: 2 }
  const done = new Set(['2026-08-03', '2026-08-20', '2026-09-10', '2026-09-11', '2026-10-05', '2026-11-02'])
  it('due finché non raggiunto', () => {
    expect(isDueOn(h, done, '2026-11-24')).toBe(true)
    expect(isDueOn(h, done, '2026-09-24')).toBe(false)
    expect(periodLabel(h, done, '2026-11-24')).toBe('1/2 nel mese')
    expect(frequencyLabel(h)).toBe('2 volte al mese')
  })
  it('serie: novembre in corso non rompe, ottobre mancato sì', () => {
    expect(streak(h, done, '2026-11-24')).toBe(0)
    expect(streak(h, done, '2026-10-15')).toBe(2)
    expect(bestStreak(h, done, '2026-11-24')).toBe(2)
  })
  it('costanza: ottobre mancato, novembre in corso escluso', () => {
    expect(completionRate(h, done, '2026-11-24')).toBe(0)
  })
})
describe('mezzo mese', () => {
  const h = { ...base, frequency: 'halfmonth' as const, target: 1 }
  const done = new Set(['2026-11-03', '2026-11-16', '2026-10-20'])
  it('periodi 1-15 e 16-fine', () => {
    expect(isDueOn(h, done, '2026-11-24')).toBe(false)
    expect(periodLabel(h, done, '2026-11-10')).toBe('1/1 nella quindicina')
    expect(streak(h, done, '2026-11-24')).toBe(3)
    expect(completionRate(h, done, '2026-11-24')).toBe(1)
  })
})
describe('settimanale invariata', () => {
  const h = { ...base, weekdays: [1, 3] }
  it('serie', () => { expect(streak(h, new Set(['2026-11-23', '2026-11-18']), '2026-11-24')).toBe(2) })
})
