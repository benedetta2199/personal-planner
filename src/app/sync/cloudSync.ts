/**
 * Salvataggio automatico di Agenda, Obiettivi, Abitudini e Diario su un Google Sheet dedicato
 * (PLANNER_SHEET_ID sul server, separato dal foglio del bilancio).
 *
 * Ogni modulo ha un orario di ultima modifica: dopo ogni cambiamento il modulo viene inviato
 * (dopo qualche secondo di pausa); all'avvio e quando la scheda torna visibile si rilegge il foglio
 * e si applicano le versioni più recenti salvate da altri dispositivi. In caso di modifiche
 * contemporanee vince la più recente, modulo per modulo. Usa lo stesso token del modulo Finanze.
 */
import { defineStore, storeToRefs } from 'pinia'
import { ref, watch, type Ref } from 'vue'
import { readJson, writeJson } from '@/core/utils/storage'
import { todayDay } from '@/core/utils/dates'
import { useAgendaStore } from '@/modules/agenda/store/agendaStore'
import { useGoalsStore } from '@/modules/goals/store'
import { useHabitsStore } from '@/modules/habits/store'
import { useJournalStore } from '@/modules/journal/store'
import { agendaTables, goalsTables, habitsTables, journalTables, type Tables } from './plannerTables'

const META_KEY = 'gp.planner.sync.v1'
const TOKEN_KEY = 'gp.accessToken'
const DEBOUNCE_MS = 2500
const TIMEOUT_MS = 90_000
/** Errori di configurazione: inutile riprovare a ogni modifica finché non si ricarica la pagina. */
const PERMANENT = new Set(['token_not_configured', 'bridge_required', 'not_configured', 'script_outdated', 'planner_sheet_missing'])

export interface CloudSyncStatus {
  state: 'idle' | 'saving' | 'saved' | 'error' | 'needs-token' | 'off'
  message?: string
  at?: string
}

interface ModuleMeta {
  /** Ultima modifica nota (locale o applicata dal foglio); null = mai modificato. */
  updatedAt: string | null
  /** Versione che il foglio ha confermato. */
  syncedAt: string | null
}

interface SyncedModule {
  id: string
  state: Ref<object>
  isEmpty: (data: object) => boolean
  /** Dati arrivati dal foglio nella forma attesa dallo store, o null se non validi. */
  normalize: (raw: Record<string, unknown>) => object | null
  tables: (data: object) => Tables
}

type Remote = Record<string, { updatedAt: string; data: Record<string, unknown> }>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

class SyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function post(body: unknown, token: string): Promise<{ modules: Remote; saved: string[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('/api/planner/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new SyncError(aborted ? 'timeout' : 'network', aborted ? 'Il foglio Google non ha risposto in tempo.' : 'Impossibile contattare il server.')
  } finally {
    clearTimeout(timer)
  }
  const data = (await res.json().catch(() => null)) as { ok: boolean; code?: string; message?: string; modules?: Remote; saved?: string[] } | null
  if (!data) throw new SyncError('unavailable', `Servizio di salvataggio non raggiungibile (HTTP ${res.status}).`)
  if (!data.ok) throw new SyncError(data.code ?? 'unknown', data.message ?? 'Errore sconosciuto.')
  return { modules: data.modules ?? {}, saved: data.saved ?? [] }
}

export const useCloudSync = defineStore('cloudSync', () => {
  const status = ref<CloudSyncStatus>({ state: 'idle' })
  const meta = ref<Record<string, ModuleMeta>>(readJson<Record<string, ModuleMeta>>(META_KEY) ?? {})
  const saveMeta = () => writeJson(META_KEY, meta.value)

  let modules: SyncedModule[] = []
  let started = false
  let running = false
  let again = false
  let applying = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const isDirty = (m: SyncedModule) => {
    const x = meta.value[m.id]
    return !!x?.updatedAt && x.updatedAt !== x.syncedAt
  }
  const pendingCount = () => modules.filter(isDirty).length

  function schedule(delay = DEBOUNCE_MS) {
    if (status.value.state === 'off') return
    clearTimeout(timer)
    timer = setTimeout(() => void sync(), delay)
  }

  async function sync(): Promise<void> {
    if (!started || status.value.state === 'off') return
    if (running) {
      again = true
      return
    }
    const token = (readJson<string>(TOKEN_KEY) ?? '').trim()
    if (!token) {
      status.value = { state: 'needs-token', message: 'Inserisci il token di accesso (in Finanze › Importazione) per salvare i dati sul foglio Google.' }
      return
    }
    running = true
    status.value = { state: 'saving' }
    try {
      const payload: Record<string, { updatedAt: string; data: object; tables: Tables }> = {}
      for (const m of modules.filter(isDirty)) {
        const data = clone(m.state.value)
        payload[m.id] = { updatedAt: meta.value[m.id].updatedAt!, data, tables: m.tables(data) }
      }
      const res = await post({ modules: payload }, token)

      for (const m of modules) {
        const remote = res.modules[m.id]
        const local = meta.value[m.id] ?? { updatedAt: null, syncedAt: null }
        if (!remote) continue
        if (remote.updatedAt === local.updatedAt) {
          local.syncedAt = remote.updatedAt
        } else if (!local.updatedAt || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt)) {
          const data = m.normalize(remote.data)
          if (!data) continue
          applying = true
          try {
            m.state.value = data
          } finally {
            applying = false
          }
          local.updatedAt = local.syncedAt = remote.updatedAt
        }
        // Altrimenti la copia locale è più recente (modificata durante l'invio): resta da inviare.
        meta.value[m.id] = local
      }
      saveMeta()
      status.value = { state: 'saved', at: new Date().toISOString() }
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError('unknown', (e as Error).message)
      status.value = {
        state: err.code === 'unauthorized' ? 'needs-token' : PERMANENT.has(err.code) ? 'off' : 'error',
        message: err.message,
      }
    } finally {
      running = false
    }
    if (again || (status.value.state === 'saved' && pendingCount())) {
      again = false
      schedule(500)
    }
  }

  /** Collega gli store e avvia la sincronizzazione (una volta sola, dall'App). */
  function start() {
    if (started) return
    started = true
    const agenda = useAgendaStore()
    const goals = useGoalsStore()
    const habits = useHabitsStore()
    const journal = useJournalStore()

    modules = [
      {
        id: 'agenda',
        state: storeToRefs(agenda).state as Ref<object>,
        isEmpty: (d) => !(d as typeof agenda.state).commitments.length && !(d as typeof agenda.state).completions.length,
        normalize: (r) => (Array.isArray(r.commitments) && Array.isArray(r.completions) ? { version: 1, commitments: r.commitments, completions: r.completions } : null),
        tables: (d) => agendaTables(d as typeof agenda.state, todayDay()),
      },
      {
        id: 'goals',
        state: storeToRefs(goals).state as Ref<object>,
        isEmpty: (d) => !(d as typeof goals.state).goals.length,
        normalize: (r) => (Array.isArray(r.goals) ? { version: 1, goals: r.goals } : null),
        tables: (d) => goalsTables(d as typeof goals.state),
      },
      {
        id: 'habits',
        state: storeToRefs(habits).state as Ref<object>,
        isEmpty: (d) => !(d as typeof habits.state).habits.length,
        normalize: (r) => (Array.isArray(r.habits) && isObj(r.log) ? { version: 1, habits: r.habits, log: r.log } : null),
        tables: (d) => habitsTables(d as typeof habits.state, todayDay()),
      },
      {
        id: 'journal',
        state: storeToRefs(journal).state as Ref<object>,
        isEmpty: (d) => !Object.keys((d as typeof journal.state).entries).length,
        normalize: (r) => (isObj(r.entries) ? { version: 1, entries: r.entries } : null),
        tables: (d) => journalTables(d as typeof journal.state),
      },
    ]

    const now = new Date().toISOString()
    for (const m of modules) {
      // Dati creati prima di questa funzione: da inviare. Modulo vuoto: vince il foglio.
      meta.value[m.id] ??= { updatedAt: m.isEmpty(m.state.value) ? null : now, syncedAt: null }
      watch(
        m.state,
        () => {
          if (applying) return
          meta.value[m.id] = { ...meta.value[m.id], updatedAt: new Date().toISOString() }
          saveMeta()
          schedule()
        },
        { deep: true, flush: 'sync' },
      )
    }
    saveMeta()

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') schedule(300)
      })
      window.addEventListener('online', () => schedule(300))
    }
    void sync()
  }

  /** Riprova subito (es. dopo aver inserito il token). */
  function retry() {
    if (status.value.state === 'off') status.value = { state: 'idle' }
    clearTimeout(timer)
    void sync()
  }

  return { status, start, sync, retry, pendingCount }
})
