import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { persistedState, uid } from '@/core/utils/persisted'
import { addDaysTo, todayDay, type IsoDay } from '@/core/utils/dates'
import { nextDue, occurrencesOf, type Commitment, type Completion, type Occurrence } from '../domain/recurrence'
import { buildIcs } from '../domain/ics'
import type { CommitmentTemplate } from '../domain/catalog'

interface AgendaData {
  version: 1
  commitments: Commitment[]
  completions: Completion[]
}

export type CommitmentDraft = Omit<Commitment, 'id' | 'createdAt'>

const empty = (): AgendaData => ({ version: 1, commitments: [], completions: [] })

export const useAgendaStore = defineStore('agenda', () => {
  const { state, saveFailed } = persistedState<AgendaData>('gp.agenda.v1', empty)

  /** Data di oggi, aggiornata quando la scheda torna visibile (es. il giorno dopo). */
  const today = ref(todayDay())
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (today.value = todayDay()))

  const commitments = computed(() => [...state.value.commitments].sort((a, b) => a.title.localeCompare(b.title, 'it')))
  const byId = (id: string) => state.value.commitments.find((c) => c.id === id)

  function add(draft: CommitmentDraft): Commitment {
    const c: Commitment = { ...draft, id: uid(), createdAt: new Date().toISOString() }
    state.value.commitments.push(c)
    return c
  }
  function update(id: string, draft: Partial<CommitmentDraft>) {
    const c = byId(id)
    if (c) Object.assign(c, draft)
  }
  function remove(id: string) {
    state.value.commitments = state.value.commitments.filter((c) => c.id !== id)
    state.value.completions = state.value.completions.filter((x) => x.commitmentId !== id)
  }
  function togglePause(id: string) {
    const c = byId(id)
    if (c) c.paused = !c.paused
  }

  function isDone(id: string, due: IsoDay) {
    return state.value.completions.some((x) => x.commitmentId === id && x.due === due)
  }
  function complete(id: string, due: IsoDay, doneOn: IsoDay = today.value) {
    if (!isDone(id, due)) state.value.completions.push({ commitmentId: id, due, doneOn })
  }
  function uncomplete(id: string, due: IsoDay) {
    state.value.completions = state.value.completions.filter((x) => !(x.commitmentId === id && x.due === due))
  }
  function toggle(o: Pick<Occurrence, 'commitment' | 'date'>) {
    if (isDone(o.commitment.id, o.date)) uncomplete(o.commitment.id, o.date)
    else complete(o.commitment.id, o.date)
  }

  /** Occorrenze di tutti gli impegni tra due date, ordinate per data. */
  function occurrences(from: IsoDay, to: IsoDay): Occurrence[] {
    const list = state.value.commitments.flatMap((c) => occurrencesOf(c, state.value.completions, from, to, today.value))
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.commitment.title.localeCompare(b.commitment.title, 'it'))
  }

  /** Scadenze in ritardo (al massimo una per impegno). */
  const overdue = computed(() => {
    const out: Occurrence[] = []
    for (const c of state.value.commitments) {
      if (c.paused) continue
      const d = nextDue(c, state.value.completions, today.value)
      if (d && d < today.value) out.push(...occurrencesOf(c, state.value.completions, d, d, today.value).filter((o) => o.status === 'overdue'))
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  })

  /** Scadenze entro il loro periodo di preavviso (oltre a oggi). */
  const upcoming = computed(() => {
    const maxRemind = Math.max(7, ...state.value.commitments.map((c) => c.remindDays))
    return occurrences(addDaysTo(today.value, 1), addDaysTo(today.value, maxRemind)).filter((o) => o.status === 'soon' && !o.projected)
  })

  const nextDueOf = (c: Commitment) => nextDue(c, state.value.completions, today.value)
  const lastDoneOf = (id: string) =>
    state.value.completions.filter((x) => x.commitmentId === id).reduce<Completion | null>((best, x) => (!best || x.doneOn > best.doneOn ? x : best), null)

  function exportIcs(): string {
    return buildIcs(state.value.commitments, state.value.completions, today.value)
  }

  /** Finestra di inserimento/modifica, condivisa da tutte le viste dell'agenda. */
  const editor = reactive<{ open: boolean; commitment: Commitment | null; template: CommitmentTemplate | null; date: IsoDay | null }>({ open: false, commitment: null, template: null, date: null })
  function openEditor(opts: { commitment?: Commitment | null; template?: CommitmentTemplate | null; date?: IsoDay | null } = {}) {
    editor.commitment = opts.commitment ?? null
    editor.template = opts.template ?? null
    editor.date = opts.date ?? null
    editor.open = true
  }
  const closeEditor = () => (editor.open = false)

  return {
    state,
    saveFailed,
    today,
    commitments,
    byId,
    add,
    update,
    remove,
    togglePause,
    isDone,
    complete,
    uncomplete,
    toggle,
    occurrences,
    overdue,
    upcoming,
    nextDueOf,
    lastDoneOf,
    exportIcs,
    editor,
    openEditor,
    closeEditor,
  }
})
