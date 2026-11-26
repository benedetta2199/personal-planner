/**
 * Conferma con il dialog dell'app (al posto di window.confirm).
 *   if (!(await confirmDialog({ title: 'Eliminare il conto?', message: '…', danger: true }))) return
 * Il dialog è disegnato una sola volta da <UiConfirmHost> in App.vue.
 */
import { shallowRef } from 'vue'

export interface ConfirmOptions {
  title: string
  /** Testo del messaggio; le righe vuote separano i paragrafi. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Azione distruttiva: pulsante rosso con il cestino. */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export const pendingConfirm = shallowRef<Pending | null>(null)

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // Una richiesta ancora aperta si considera annullata.
  pendingConfirm.value?.resolve(false)
  return new Promise((resolve) => {
    pendingConfirm.value = { ...options, resolve }
  })
}

export function settleConfirm(ok: boolean) {
  const p = pendingConfirm.value
  if (!p) return
  pendingConfirm.value = null
  p.resolve(ok)
}
