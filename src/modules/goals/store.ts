import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistedState, uid } from '@/core/utils/persisted'
import type { IsoDay } from '@/core/utils/dates'
import type { Goal, GoalStatus, Milestone } from './domain'

interface GoalsData {
  version: 1
  goals: Goal[]
}

export type GoalDraft = Pick<Goal, 'title' | 'area' | 'why' | 'description' | 'link' | 'targetDate' | 'manualProgress'> & { milestones: Omit<Milestone, 'id'>[] | Milestone[] }

export const useGoalsStore = defineStore('goals', () => {
  const { state, saveFailed } = persistedState<GoalsData>('gp.goals.v1', () => ({ version: 1, goals: [] }))
  const goals = computed(() => state.value.goals)
  const byId = (id: string) => state.value.goals.find((g) => g.id === id)

  const withIds = (ms: GoalDraft['milestones']): Milestone[] => ms.map((m) => ({ ...m, id: 'id' in m && m.id ? m.id : uid() }))

  function add(d: GoalDraft): Goal {
    const g: Goal = { ...d, milestones: withIds(d.milestones), id: uid(), status: 'active', createdAt: new Date().toISOString(), completedAt: null }
    state.value.goals.push(g)
    return g
  }
  function update(id: string, d: GoalDraft) {
    const g = byId(id)
    if (g) Object.assign(g, { ...d, milestones: withIds(d.milestones) })
  }
  function remove(id: string) {
    state.value.goals = state.value.goals.filter((g) => g.id !== id)
  }
  function setStatus(id: string, status: GoalStatus) {
    const g = byId(id)
    if (!g) return
    g.status = status
    g.completedAt = status === 'done' ? new Date().toISOString() : null
  }
  function toggleMilestone(goalId: string, milestoneId: string) {
    const m = byId(goalId)?.milestones.find((x) => x.id === milestoneId)
    if (m) m.done = !m.done
  }
  function addMilestone(goalId: string, title: string, due: IsoDay | null = null) {
    byId(goalId)?.milestones.push({ id: uid(), title, due, done: false })
  }

  /** Scadenze di obiettivi e tappe (non completati) tra due date, per il calendario. */
  function datedItems(from: IsoDay, to: IsoDay) {
    const out: { date: IsoDay; title: string; goal: Goal; kind: 'goal' | 'milestone'; done: boolean }[] = []
    for (const g of state.value.goals) {
      if (g.status === 'paused') continue
      if (g.targetDate && g.targetDate >= from && g.targetDate <= to) out.push({ date: g.targetDate, title: g.title, goal: g, kind: 'goal', done: g.status === 'done' })
      for (const m of g.milestones) if (m.due && m.due >= from && m.due <= to) out.push({ date: m.due, title: m.title, goal: g, kind: 'milestone', done: m.done })
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }

  return { state, saveFailed, goals, byId, add, update, remove, setStatus, toggleMilestone, addMilestone, datedItems }
})
