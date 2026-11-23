import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistedState, uid } from '@/core/utils/persisted'
import { todayDay, type IsoDay } from '@/core/utils/dates'
import type { Habit } from './domain'

interface HabitsData {
  version: 1
  habits: Habit[]
  /** Giorni in cui ogni abitudine è stata rispettata. */
  log: Record<string, IsoDay[]>
}

export type HabitDraft = Pick<Habit, 'name' | 'emoji' | 'color' | 'weekdays'>

export const useHabitsStore = defineStore('habits', () => {
  const { state, saveFailed } = persistedState<HabitsData>('gp.habits.v1', () => ({ version: 1, habits: [], log: {} }))

  const habits = computed(() => state.value.habits.filter((h) => !h.archived))
  const archived = computed(() => state.value.habits.filter((h) => h.archived))
  const byId = (id: string) => state.value.habits.find((h) => h.id === id)

  /** Insiemi per lookup veloce, ricalcolati solo quando cambia il registro. */
  const doneSets = computed(() => {
    const out = new Map<string, Set<IsoDay>>()
    for (const [id, days] of Object.entries(state.value.log)) out.set(id, new Set(days))
    return out
  })
  const doneSet = (id: string) => doneSets.value.get(id) ?? new Set<IsoDay>()
  const isDone = (id: string, d: IsoDay) => doneSet(id).has(d)

  function add(d: HabitDraft) {
    state.value.habits.push({ ...d, id: uid(), createdAt: todayDay() })
  }
  function update(id: string, d: HabitDraft) {
    const h = byId(id)
    if (h) Object.assign(h, d)
  }
  function remove(id: string) {
    state.value.habits = state.value.habits.filter((h) => h.id !== id)
    delete state.value.log[id]
  }
  function setArchived(id: string, archived: boolean) {
    const h = byId(id)
    if (h) h.archived = archived
  }
  function toggle(id: string, d: IsoDay) {
    const list = state.value.log[id] ?? (state.value.log[id] = [])
    const i = list.indexOf(d)
    if (i >= 0) list.splice(i, 1)
    else list.push(d)
    // Un'abitudine segnata prima della sua creazione sposta indietro l'inizio (recupero di giorni passati).
    const h = byId(id)
    if (h && i < 0 && d < h.createdAt) h.createdAt = d
  }

  return { state, saveFailed, habits, archived, byId, doneSet, isDone, add, update, remove, setArchived, toggle }
})
