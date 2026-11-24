import type { IsoDay } from '@/core/utils/dates'

export interface Milestone {
  id: string
  title: string
  due?: IsoDay | null
  done: boolean
}

export type GoalStatus = 'active' | 'paused' | 'done'

export interface Goal {
  id: string
  title: string
  area: string
  /** Perché è importante: la motivazione da rileggere. */
  why?: string
  /** Dettagli liberi: cosa significa raggiungerlo, appunti, risorse. */
  description?: string
  /** Collegamento a una pagina esterna (documento, corso, iscrizione…). Solo http/https. */
  link?: string
  targetDate?: IsoDay | null
  milestones: Milestone[]
  /** Avanzamento manuale (0–100) quando non ci sono tappe. */
  manualProgress: number
  status: GoalStatus
  createdAt: string
  completedAt?: string | null
}

export interface GoalArea {
  id: string
  label: string
  emoji: string
  color: string
}

export const GOAL_AREAS: GoalArea[] = [
  { id: 'salute', label: 'Salute e forma', emoji: '💪', color: '--series-1' },
  { id: 'carriera', label: 'Carriera', emoji: '🚀', color: '--series-3' },
  { id: 'finanze', label: 'Finanze', emoji: '💰', color: '--series-6' },
  { id: 'relazioni', label: 'Relazioni', emoji: '❤️', color: '--series-7' },
  { id: 'crescita', label: 'Crescita personale', emoji: '📚', color: '--series-2' },
  { id: 'casa', label: 'Casa', emoji: '🏡', color: '--series-5' },
  { id: 'svago', label: 'Viaggi e svago', emoji: '✈️', color: '--series-8' },
  { id: 'altro', label: 'Altro', emoji: '⭐', color: '--series-other' },
]
export const areaOf = (id: string): GoalArea => GOAL_AREAS.find((a) => a.id === id) ?? GOAL_AREAS[GOAL_AREAS.length - 1]

/**
 * Indirizzo web normalizzato e sicuro da usare in un link: aggiunge «https://» se manca
 * e accetta solo http/https (niente `javascript:` o simili). Null se non valido.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Testo breve per mostrare un link: dominio senza «www.» più l'eventuale percorso. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

/** Avanzamento 0–1: dalle tappe completate se ci sono, altrimenti dal valore manuale. */
export function goalProgress(g: Goal): number {
  if (g.status === 'done') return 1
  if (g.milestones.length) return g.milestones.filter((m) => m.done).length / g.milestones.length
  return Math.min(100, Math.max(0, g.manualProgress)) / 100
}

/** Prossima tappa da fare (prima per data, poi in ordine di inserimento). */
export function nextMilestone(g: Goal): Milestone | null {
  const open = g.milestones.filter((m) => !m.done)
  const dated = open.filter((m) => m.due).sort((a, b) => a.due!.localeCompare(b.due!))
  return dated[0] ?? open[0] ?? null
}
