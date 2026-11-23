/**
 * Esportazione in formato iCalendar (.ics) per importare gli impegni in Google Calendar,
 * Apple Calendar o Outlook. Gli impegni a calendario fisso diventano eventi ricorrenti (RRULE);
 * quelli «dal completamento» diventano un singolo evento alla prossima scadenza.
 */
import { addDaysTo, type IsoDay } from '../../../core/utils/dates.js'
import { categoryOf } from './catalog.js'
import { nextDue, type Commitment, type Completion } from './recurrence.js'

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const compact = (d: IsoDay) => d.replace(/-/g, '')

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Righe più lunghe di 75 ottetti spezzate come richiesto dallo standard. */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ` ${rest.slice(74)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

export function rrule(c: Commitment): string | null {
  const r = c.repeat
  if (r.unit === 'none') return null
  const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[r.unit]
  const parts = [`FREQ=${freq}`]
  if (r.every > 1) parts.push(`INTERVAL=${r.every}`)
  if (r.unit === 'week' && r.weekdays?.length) parts.push(`BYDAY=${r.weekdays.map((d) => BYDAY[d - 1]).join(',')}`)
  // Il 31 del mese: «ultimo giorno del mese», come fa l'app.
  if (r.unit === 'month' && c.start.endsWith('-31')) parts.push('BYMONTHDAY=-1')
  if (c.until) parts.push(`UNTIL=${compact(c.until)}`)
  return parts.join(';')
}

export function buildIcs(commitments: Commitment[], completions: Completion[], today: IsoDay, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Growth Planner//Agenda//IT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Scadenze personali']
  for (const c of commitments) {
    if (c.paused) continue
    const fixed = c.mode === 'fixed' || c.repeat.unit === 'none'
    const start = fixed ? c.start : nextDue(c, completions, today)
    if (!start) continue
    const cat = categoryOf(c.category)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${c.id}${fixed ? '' : `-${compact(start)}`}@growth-planner`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${compact(addDaysTo(start, 1))}`,
      `SUMMARY:${escapeText(`${cat.emoji} ${c.title}`)}`,
      `CATEGORIES:${escapeText(cat.label)}`,
    )
    const rule = fixed ? rrule(c) : null
    if (rule) lines.push(`RRULE:${rule}`)
    if (c.notes) lines.push(`DESCRIPTION:${escapeText(c.notes)}`)
    if (c.remindDays > 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(c.title)}`, `TRIGGER:-P${c.remindDays}D`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
