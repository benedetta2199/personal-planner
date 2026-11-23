import { describe, expect, it } from 'vitest'
import { fixedDates, horizonOf, nextDue, occurrencesOf, previewDates, recurrenceLabel, type Commitment, type Completion } from '../recurrence'
import { buildIcs, rrule } from '../ics'

const make = (over: Partial<Commitment>): Commitment => ({
  id: 'c1',
  title: 'Test',
  category: 'casa',
  start: '2026-01-15',
  repeat: { unit: 'month', every: 1 },
  mode: 'fixed',
  remindDays: 7,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('fixedDates', () => {
  it('mesi: il 31 resta il 31 quando possibile', () => {
    const c = make({ start: '2026-01-31' })
    expect(fixedDates(c, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })

  it('anni ogni 2: revisione auto', () => {
    const c = make({ start: '2025-03-10', repeat: { unit: 'year', every: 2 } })
    expect(fixedDates(c, '2024-01-01', '2031-12-31')).toEqual(['2025-03-10', '2027-03-10', '2029-03-10', '2031-03-10'])
  })

  it('29 febbraio negli anni non bisestili diventa il 28', () => {
    const c = make({ start: '2028-02-29', repeat: { unit: 'year', every: 1 } })
    expect(fixedDates(c, '2028-01-01', '2030-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
  })

  it('settimane con giorni scelti', () => {
    const c = make({ start: '2026-11-23', repeat: { unit: 'week', every: 1, weekdays: [1, 3, 5] } }) // lunedì
    expect(fixedDates(c, '2026-11-20', '2026-11-30')).toEqual(['2026-11-23', '2026-11-25', '2026-11-27', '2026-11-30'])
  })

  it('ogni 2 settimane', () => {
    const c = make({ start: '2026-11-04', repeat: { unit: 'week', every: 2 } }) // mercoledì
    expect(fixedDates(c, '2026-11-01', '2026-12-31')).toEqual(['2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30'])
  })

  it('giorni con intervallo e intervallo che parte a metà serie', () => {
    const c = make({ start: '2026-01-01', repeat: { unit: 'day', every: 3 } })
    expect(fixedDates(c, '2026-01-05', '2026-01-12')).toEqual(['2026-01-07', '2026-01-10'])
  })

  it('una volta e data di fine', () => {
    expect(fixedDates(make({ repeat: { unit: 'none', every: 1 } }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15'])
    expect(fixedDates(make({ until: '2026-03-20' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })
})

describe('stato delle scadenze', () => {
  it('una scadenza mancata resta in ritardo finché non arriva la successiva', () => {
    const c = make({ start: '2025-03-10', repeat: { unit: 'year', every: 2 } })
    const occ = occurrencesOf(c, [], '2025-01-01', '2027-12-31', '2026-11-23')
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      ['2025-03-10', 'overdue'],
      ['2027-03-10', 'upcoming'],
    ])
    expect(nextDue(c, [], '2026-11-23')).toBe('2025-03-10')
  })

  it('un\'attività giornaliera saltata ieri non è in ritardo', () => {
    const c = make({ start: '2026-11-01', repeat: { unit: 'day', every: 1 } })
    const occ = occurrencesOf(c, [], '2026-11-22', '2026-11-24', '2026-11-23')
    expect(occ.map((o) => o.status)).toEqual(['missed', 'today', 'soon'])
  })

  it('completamento e preavviso', () => {
    const c = make({ start: '2026-10-15', remindDays: 30 })
    const done: Completion[] = [{ commitmentId: 'c1', due: '2026-10-15', doneOn: '2026-10-16' }]
    const occ = occurrencesOf(c, done, '2026-10-01', '2027-01-31', '2026-11-23')
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      ['2026-10-15', 'done'],
      ['2026-11-15', 'overdue'],
      ['2026-12-15', 'soon'],
      ['2027-01-15', 'upcoming'],
    ])
  })

  it('dal completamento: la prossima scadenza si conta dal giorno in cui è stato fatto', () => {
    const c = make({ start: '2026-05-01', repeat: { unit: 'month', every: 6 }, mode: 'afterDone', remindDays: 14 })
    expect(nextDue(c, [], '2026-04-01')).toBe('2026-05-01')
    const done: Completion[] = [{ commitmentId: 'c1', due: '2026-05-01', doneOn: '2026-05-20' }]
    expect(nextDue(c, done, '2026-06-01')).toBe('2026-11-20')
    const occ = occurrencesOf(c, done, '2026-01-01', '2027-12-31', '2026-11-10')
    expect(occ.map((o) => [o.date, o.status, o.projected])).toEqual([
      ['2026-05-01', 'done', false],
      ['2026-11-20', 'soon', false],
      ['2027-05-20', 'upcoming', true],
      ['2027-11-20', 'upcoming', true],
    ])
  })

  it('una volta: completato non ha più scadenze, lontano nel futuro sì', () => {
    const c = make({ start: '2029-06-01', repeat: { unit: 'none', every: 1 } })
    expect(nextDue(c, [], '2026-11-23')).toBe('2029-06-01')
    expect(nextDue(c, [{ commitmentId: 'c1', due: '2029-06-01', doneOn: '2026-12-01' }], '2026-12-02')).toBeNull()
  })

  it('in pausa: nessuna scadenza futura né in ritardo', () => {
    const c = make({ start: '2026-01-15', paused: true })
    const occ = occurrencesOf(c, [], '2026-11-01', '2026-12-31', '2026-11-23')
    expect(occ.map((o) => o.status)).toEqual(['missed'])
  })
})

describe('etichette e anteprima', () => {
  it('descrive la cadenza', () => {
    expect(recurrenceLabel({ unit: 'year', every: 2 })).toBe('Ogni 2 anni')
    expect(recurrenceLabel({ unit: 'month', every: 6 })).toBe('Ogni 6 mesi')
    expect(recurrenceLabel({ unit: 'week', every: 1, weekdays: [1, 3] })).toBe('Ogni settimana · lun, mer')
  })

  it('orizzonte dei task', () => {
    expect(horizonOf({ unit: 'day', every: 1 })).toBe('daily')
    expect(horizonOf({ unit: 'week', every: 1 })).toBe('weekly')
    expect(horizonOf({ unit: 'month', every: 6 })).toBe('monthly')
    expect(horizonOf({ unit: 'year', every: 2 })).toBe('yearly')
  })

  it('anteprima delle prossime date', () => {
    expect(previewDates({ start: '2026-01-31', repeat: { unit: 'month', every: 1 }, mode: 'fixed' }, 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
})

describe('esportazione .ics', () => {
  it('regola di ricorrenza', () => {
    expect(rrule(make({ repeat: { unit: 'year', every: 2 } }))).toBe('FREQ=YEARLY;INTERVAL=2')
    expect(rrule(make({ repeat: { unit: 'week', every: 1, weekdays: [1, 5] } }))).toBe('FREQ=WEEKLY;BYDAY=MO,FR')
    expect(rrule(make({ start: '2026-01-31' }))).toBe('FREQ=MONTHLY;BYMONTHDAY=-1')
  })

  it('calendario con promemoria', () => {
    const ics = buildIcs([make({ title: 'Revisione, auto', repeat: { unit: 'year', every: 2 }, remindDays: 30 })], [], '2026-11-23', new Date('2026-11-23T10:00:00Z'))
    expect(ics).toContain('DTSTART;VALUE=DATE:20260115')
    expect(ics).toContain('RRULE:FREQ=YEARLY;INTERVAL=2')
    expect(ics).toContain('TRIGGER:-P30D')
    expect(ics).toContain('Revisione\\, auto')
  })
})
