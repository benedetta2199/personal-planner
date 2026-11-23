import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistedState } from '@/core/utils/persisted'
import type { IsoDay } from '@/core/utils/dates'

export type Mood = 1 | 2 | 3 | 4 | 5

export interface JournalEntry {
  date: IsoDay
  mood: Mood | null
  text: string
  /** Tre cose per cui essere grati. */
  gratitude: string[]
  tags: string[]
  updatedAt: string
}

export const MOODS: { value: Mood; emoji: string; label: string; color: string }[] = [
  { value: 1, emoji: '😞', label: 'Pessima', color: 'var(--status-critical)' },
  { value: 2, emoji: '😕', label: 'Così così', color: 'var(--series-4)' },
  { value: 3, emoji: '😐', label: 'Normale', color: 'var(--series-6)' },
  { value: 4, emoji: '🙂', label: 'Buona', color: 'var(--series-1)' },
  { value: 5, emoji: '😄', label: 'Ottima', color: 'var(--positive)' },
]

/** Spunti di scrittura: uno diverso ogni giorno. */
export const PROMPTS = [
  'Qual è stata la cosa migliore di oggi?',
  'Cosa ho imparato oggi?',
  'Cosa mi ha dato energia e cosa me l\'ha tolta?',
  'Che cosa farei diversamente, se potessi rifare la giornata?',
  'Per quale piccolo progresso posso essere fiero/a?',
  'Cosa mi preoccupa e cosa posso fare, concretamente, domani?',
  'Con chi ho passato del tempo di qualità?',
  'Qual è la priorità numero uno per domani?',
  'Cosa sto rimandando, e perché?',
  'In quale momento mi sono sentito/a davvero presente?',
]

export const WEEKLY_REVIEW = `## Revisione della settimana
**Cosa è andato bene**
-

**Cosa non ha funzionato**
-

**Cosa ho imparato**
-

**Le 3 priorità della prossima settimana**
1.
2.
3. `

export const isEmptyEntry = (e: JournalEntry) => !e.text.trim() && !e.mood && !e.gratitude.some((g) => g.trim()) && !e.tags.length

export const useJournalStore = defineStore('journal', () => {
  const { state, saveFailed } = persistedState<{ version: 1; entries: Record<IsoDay, JournalEntry> }>('gp.journal.v1', () => ({ version: 1, entries: {} }))

  const entries = computed(() => Object.values(state.value.entries).sort((a, b) => b.date.localeCompare(a.date)))
  const get = (d: IsoDay): JournalEntry | null => state.value.entries[d] ?? null
  const blank = (d: IsoDay): JournalEntry => ({ date: d, mood: null, text: '', gratitude: ['', '', ''], tags: [], updatedAt: new Date().toISOString() })

  function save(e: JournalEntry) {
    if (isEmptyEntry(e)) delete state.value.entries[e.date]
    else state.value.entries[e.date] = { ...e, gratitude: [...e.gratitude], tags: [...e.tags], updatedAt: new Date().toISOString() }
  }
  function remove(d: IsoDay) {
    delete state.value.entries[d]
  }

  const allTags = computed(() => [...new Set(entries.value.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b, 'it')))

  return { state, saveFailed, entries, get, blank, save, remove, allTags }
})
