import { describe, expect, it } from 'vitest'
import { chargeDates, monthlyEquivalent, planEntryId, toBusinessDay, upcomingCharges } from '../plans'

describe('PAC: date di addebito', () => {
  it('sabato e domenica slittano al lunedì', () => {
    expect(toBusinessDay('2026-05-02')).toBe('2026-05-04') // sabato
    expect(toBusinessDay('2026-08-02')).toBe('2026-08-03') // domenica
    expect(toBusinessDay('2026-06-02')).toBe('2026-06-02') // martedì
  })

  it('mensile: il 2 di ogni mese, spostato se cade nel weekend', () => {
    expect(chargeDates('monthly', '2026-04-30', '2026-08-31')).toEqual(['2026-05-04', '2026-06-02', '2026-07-02', '2026-08-03'])
  })

  it('quindicinale: il 2 e il 18', () => {
    // 18 aprile 2026 è sabato → lunedì 20; 2 maggio è sabato → lunedì 4.
    expect(chargeDates('biweekly', '2026-04-01', '2026-05-31')).toEqual(['2026-04-02', '2026-04-20', '2026-05-04', '2026-05-18'])
  })

  it('settimanale: ogni lunedì', () => {
    expect(chargeDates('weekly', '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  })

  it('include una data nominale del weekend che slitta dentro l intervallo', () => {
    // 2 maggio 2026 (sabato) → 4 maggio: compreso anche partendo dal 3.
    expect(chargeDates('monthly', '2026-05-03', '2026-05-10')).toEqual(['2026-05-04'])
    // …ed escluso se l'intervallo è già passato oltre.
    expect(chargeDates('monthly', '2026-05-04', '2026-05-31')).toEqual([])
  })

  it('prossimi addebiti, equivalente mensile e ID stabile', () => {
    expect(upcomingCharges({ frequency: 'monthly', startDate: '2026-11-23' }, '2026-11-23', 2)).toEqual(['2026-12-02', '2027-01-04'])
    expect(monthlyEquivalent({ amount: 2500, frequency: 'weekly' })).toBe(10833)
    expect(monthlyEquivalent({ amount: 5000, frequency: 'biweekly' })).toBe(10000)
    expect(planEntryId('abc123', '2026-12-02')).toBe('m-pac-abc123-20261202')
  })
})
