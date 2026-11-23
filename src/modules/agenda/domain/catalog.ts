import type { Recurrence, ScheduleMode } from './recurrence.js'

export interface AgendaCategory {
  id: string
  label: string
  emoji: string
  /** Variabile CSS del colore. */
  color: string
}

export const CATEGORIES: AgendaCategory[] = [
  { id: 'auto', label: 'Auto e mezzi', emoji: '🚗', color: '--series-8' },
  { id: 'casa', label: 'Casa', emoji: '🏠', color: '--series-1' },
  { id: 'salute', label: 'Salute', emoji: '🩺', color: '--series-7' },
  { id: 'finanze', label: 'Bollette e finanze', emoji: '💶', color: '--series-6' },
  { id: 'lavoro', label: 'Lavoro', emoji: '💼', color: '--series-3' },
  { id: 'personale', label: 'Personale', emoji: '🌱', color: '--series-2' },
  { id: 'documenti', label: 'Documenti', emoji: '📄', color: '--series-5' },
  { id: 'altro', label: 'Altro', emoji: '📌', color: '--series-other' },
]

export const categoryOf = (id: string): AgendaCategory => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]

/** Modelli pronti per le scadenze più comuni: si scelgono e poi si imposta la data. */
export interface CommitmentTemplate {
  title: string
  category: string
  repeat: Recurrence
  mode: ScheduleMode
  remindDays: number
  notes?: string
}

export const TEMPLATES: CommitmentTemplate[] = [
  { title: 'Revisione auto', category: 'auto', repeat: { unit: 'year', every: 2 }, mode: 'fixed', remindDays: 30, notes: 'La prima dopo 4 anni dall\'immatricolazione, poi ogni 2 anni entro il mese di scadenza.' },
  { title: 'Tagliando auto', category: 'auto', repeat: { unit: 'year', every: 1 }, mode: 'afterDone', remindDays: 30 },
  { title: 'Bollo auto', category: 'auto', repeat: { unit: 'year', every: 1 }, mode: 'fixed', remindDays: 15 },
  { title: 'Assicurazione auto', category: 'auto', repeat: { unit: 'year', every: 1 }, mode: 'fixed', remindDays: 30 },
  { title: 'Cambio gomme invernali', category: 'auto', repeat: { unit: 'year', every: 1 }, mode: 'fixed', remindDays: 21, notes: 'Obbligo di pneumatici invernali dal 15 novembre al 15 aprile.' },
  { title: 'Cambio gomme estive', category: 'auto', repeat: { unit: 'year', every: 1 }, mode: 'fixed', remindDays: 21 },
  { title: 'Pulizia filtri condizionatore', category: 'casa', repeat: { unit: 'month', every: 6 }, mode: 'afterDone', remindDays: 14 },
  { title: 'Manutenzione caldaia', category: 'casa', repeat: { unit: 'year', every: 1 }, mode: 'fixed', remindDays: 30 },
  { title: 'Pulizia filtro cappa', category: 'casa', repeat: { unit: 'month', every: 3 }, mode: 'afterDone', remindDays: 7 },
  { title: 'Batterie rilevatore di fumo', category: 'casa', repeat: { unit: 'year', every: 1 }, mode: 'afterDone', remindDays: 14 },
  { title: 'Decalcificare macchina del caffè', category: 'casa', repeat: { unit: 'month', every: 2 }, mode: 'afterDone', remindDays: 3 },
  { title: 'Visita dal dentista', category: 'salute', repeat: { unit: 'month', every: 6 }, mode: 'afterDone', remindDays: 30 },
  { title: 'Cambio spazzolino', category: 'salute', repeat: { unit: 'month', every: 3 }, mode: 'afterDone', remindDays: 3 },
  { title: 'Analisi del sangue', category: 'salute', repeat: { unit: 'year', every: 1 }, mode: 'afterDone', remindDays: 30 },
  { title: 'Pagamento affitto', category: 'finanze', repeat: { unit: 'month', every: 1 }, mode: 'fixed', remindDays: 3 },
  { title: 'Rinnovo carta d\'identità', category: 'documenti', repeat: { unit: 'none', every: 1 }, mode: 'fixed', remindDays: 90 },
]

export const REMIND_OPTIONS = [0, 1, 3, 7, 14, 30, 60, 90]
export const remindLabel = (n: number) => (n === 0 ? 'Nessun preavviso' : n === 1 ? '1 giorno prima' : `${n} giorni prima`)
