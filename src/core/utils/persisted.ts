import { ref, watch, type Ref } from 'vue'
import { readJson, writeJson } from './storage'

/**
 * Stato reattivo salvato in localStorage a ogni modifica.
 * `saveFailed` diventa true se il browser rifiuta il salvataggio (spazio pieno, modalità privata).
 */
export function persistedState<T extends object>(key: string, initial: () => T, migrate?: (raw: Partial<T>) => T): { state: Ref<T>; saveFailed: Ref<boolean> } {
  const raw = readJson<Partial<T>>(key)
  const state = ref(raw ? (migrate ? migrate(raw) : { ...initial(), ...raw }) : initial()) as Ref<T>
  const saveFailed = ref(false)
  watch(state, (v) => (saveFailed.value = !writeJson(key, v)), { deep: true })
  return { state, saveFailed }
}

export function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}
