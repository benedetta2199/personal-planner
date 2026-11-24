/**
 * Azione principale della pagina, eseguita dal pulsante «+» al centro della barra di navigazione su mobile.
 *
 * Ogni vista dichiara la propria con `usePrimaryAction(...)`; vale quella della vista più interna
 * (es. Obiettivi dentro il Planner). Un'azione può eseguire subito qualcosa (`run`) o aprire un
 * piccolo menu di scelte (`menu`). Senza azioni registrate il pulsante mostra il menu generale (App).
 */
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, shallowReactive, toValue, type MaybeRefOrGetter } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { IconName } from './icons'

export interface PrimaryMenuItem {
  label: string
  icon: IconName
  run: () => void
}

export interface PrimaryAction {
  /** Etichetta accessibile del pulsante (es. «Nuovo obiettivo»). */
  label: string
  run?: () => void
  menu?: PrimaryMenuItem[]
}

interface Entry {
  get: () => PrimaryAction | null
}

/**
 * Pila delle viste montate che hanno un'azione: la registrazione avviene durante il setup,
 * che per le viste annidate parte sempre dopo quello del contenitore → la più interna resta in cima.
 */
const stack = shallowReactive<Entry[]>([])

export const currentPrimaryAction = computed<PrimaryAction | null>(() => {
  for (let i = stack.length - 1; i >= 0; i--) {
    const a = stack[i].get()
    if (a) return a
  }
  return null
})

/** Registra l'azione «+» della vista corrente (anche dinamica: getter o ref; `null` = usa quella del contenitore). */
export function usePrimaryAction(action: MaybeRefOrGetter<PrimaryAction | null>) {
  if (!getCurrentInstance()) return
  const entry: Entry = { get: () => toValue(action) }
  stack.push(entry)
  onBeforeUnmount(() => {
    const i = stack.indexOf(entry)
    if (i >= 0) stack.splice(i, 1)
  })
}

/**
 * Apertura diretta del modulo di inserimento da un'altra pagina: `?nuovo=1` nell'indirizzo.
 * Esegue `open` una volta e toglie il parametro, così ricaricando la pagina non si riapre.
 */
export function useOpenFromQuery(open: () => void) {
  const route = useRoute()
  const router = useRouter()
  if (route.query.nuovo === undefined) return
  const rest = { ...route.query }
  delete rest.nuovo
  void router.replace({ query: rest })
  // Dopo il primo render, quando le finestre e i campi della vista esistono già.
  onMounted(open)
}
