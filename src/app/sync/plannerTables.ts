/**
 * Tabelle leggibili scritte sul foglio Google per ogni modulo del planner.
 * Sono solo una vista dei dati: l'app rilegge dalla copia completa nella scheda nascosta.
 */
import type { IsoDay } from '@/core/utils/dates'
import { nextDue, recurrenceLabel, type Commitment, type Completion } from '@/modules/agenda/domain/recurrence'
import { categoryOf } from '@/modules/agenda/domain/catalog'
import { areaOf, goalProgress, nextMilestone, type Goal } from '@/modules/goals/domain'
import { bestStreak, completionRate, streak, type Habit } from '@/modules/habits/domain'
import { MOODS, type JournalEntry } from '@/modules/journal/store'

export type Cell = string | number | { $date: string }
export type Tables = Record<string, Cell[][]>

const day = (d: IsoDay | null | undefined): Cell => (d ? { $date: d } : '')
const yesNo = (v: boolean | undefined) => (v ? 'Sì' : 'No')
const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const GOAL_STATUS: Record<Goal['status'], string> = { active: 'Attivo', paused: 'In pausa', done: 'Raggiunto' }

export function agendaTables(data: { commitments: Commitment[]; completions: Completion[] }, today: IsoDay): Tables {
  const titles = new Map(data.commitments.map((c) => [c.id, c.title]))
  const lastDone = new Map<string, IsoDay>()
  for (const x of data.completions) if ((lastDone.get(x.commitmentId) ?? '') < x.doneOn) lastDone.set(x.commitmentId, x.doneOn)

  const commitments = [...data.commitments]
    .map((c) => ({ c, next: c.paused ? null : nextDue(c, data.completions, today) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.c.title.localeCompare(b.c.title, 'it'))

  return {
    Scadenze: [
      ['Impegno', 'Categoria', 'Prossima scadenza', 'Cadenza', 'Calcolo', 'Preavviso (giorni)', 'Ultima volta', 'Fine ripetizione', 'In pausa', 'Note', 'ID'],
      ...commitments.map(({ c, next }) => [
        c.title,
        categoryOf(c.category).label,
        day(next),
        recurrenceLabel(c.repeat, c.start),
        c.repeat.unit === 'none' ? '' : c.mode === 'afterDone' ? 'Dal completamento' : 'Date fisse',
        c.remindDays,
        day(lastDone.get(c.id)),
        day(c.until),
        yesNo(c.paused),
        c.notes ?? '',
        c.id,
      ]),
    ],
    'Scadenze completate': [
      ['Scadenza', 'Impegno', 'Fatto il'],
      ...[...data.completions]
        .sort((a, b) => b.doneOn.localeCompare(a.doneOn) || b.due.localeCompare(a.due))
        .map((x) => [day(x.due), titles.get(x.commitmentId) ?? '(impegno eliminato)', day(x.doneOn)]),
    ],
  }
}

export function goalsTables(data: { goals: Goal[] }): Tables {
  const goals = [...data.goals].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
  return {
    Obiettivi: [
      ['Obiettivo', 'Area', 'Stato', 'Scadenza', 'Avanzamento %', 'Tappe fatte', 'Prossima tappa', 'Data prossima tappa', 'Perché', 'ID'],
      ...goals.map((g) => {
        const next = nextMilestone(g)
        return [
          g.title,
          areaOf(g.area).label,
          GOAL_STATUS[g.status] ?? g.status,
          day(g.targetDate),
          Math.round(goalProgress(g) * 100),
          g.milestones.length ? `${g.milestones.filter((m) => m.done).length}/${g.milestones.length}` : '',
          next?.title ?? '',
          day(next?.due),
          g.why ?? '',
          g.id,
        ]
      }),
    ],
    'Obiettivi - tappe': [
      ['Obiettivo', 'Tappa', 'Scadenza', 'Completata'],
      ...goals.flatMap((g) => g.milestones.map((m) => [g.title, m.title, day(m.due), yesNo(m.done)])),
    ],
  }
}

export function habitsTables(data: { habits: Habit[]; log: Record<string, IsoDay[]> }, today: IsoDay): Tables {
  const names = new Map(data.habits.map((h) => [h.id, `${h.emoji} ${h.name}`]))
  const log = Object.entries(data.log).flatMap(([id, days]) => days.map((d) => [d, names.get(id) ?? '(abitudine eliminata)'] as const))
  return {
    Abitudini: [
      ['Abitudine', 'Giorni', 'Dal', 'Serie attuale', 'Serie migliore', '% ultimi 30 giorni', 'Archiviata', 'ID'],
      ...data.habits.map((h) => {
        const done = new Set(data.log[h.id] ?? [])
        const rate = completionRate(h, done, today)
        return [
          `${h.emoji} ${h.name}`,
          h.weekdays.length === 7 ? 'Ogni giorno' : [...h.weekdays].sort().map((d) => WEEKDAYS[d - 1]).join(', '),
          day(h.createdAt),
          streak(h, done, today),
          bestStreak(h, done, today),
          rate === null ? '' : Math.round(rate * 100),
          yesNo(h.archived),
          h.id,
        ]
      }),
    ],
    'Abitudini - registro': [
      ['Data', 'Abitudine'],
      ...log.sort((a, b) => b[0].localeCompare(a[0]) || a[1].localeCompare(b[1], 'it')).map(([d, name]) => [day(d), name]),
    ],
  }
}

export function journalTables(data: { entries: Record<IsoDay, JournalEntry> }): Tables {
  const entries = Object.values(data.entries).sort((a, b) => b.date.localeCompare(a.date))
  return {
    Diario: [
      ['Data', 'Umore', 'Testo', 'Gratitudine', 'Tag'],
      ...entries.map((e) => {
        const mood = MOODS.find((m) => m.value === e.mood)
        return [
          day(e.date),
          mood ? `${mood.emoji} ${mood.label}` : '',
          e.text,
          e.gratitude.filter((g) => g.trim()).join('\n'),
          e.tags.join(', '),
        ]
      }),
    ],
  }
}
