/**
 * Accesso all'app: il token APP_ACCESS_TOKEN viene chiesto una sola volta nella pagina di login,
 * verificato dal server e salvato in localStorage. Tutte le chiamate all'API lo leggono da qui.
 * Il logout elimina il token da localStorage (i dati salvati nel browser restano).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { readJson, removeKey, writeJson } from '@/core/utils/storage'

export const TOKEN_KEY = 'gp.accessToken'
const TIMEOUT_MS = 20_000

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function verify(token: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('/api/auth/check', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new AuthError(aborted ? 'timeout' : 'network', aborted ? 'Il server non ha risposto in tempo.' : 'Impossibile contattare il server.')
  } finally {
    clearTimeout(timer)
  }
  const data = (await res.json().catch(() => null)) as { ok: boolean; code?: string; message?: string } | null
  if (!data) throw new AuthError('unavailable', `Servizio di accesso non raggiungibile (HTTP ${res.status}).`)
  if (!data.ok) throw new AuthError(data.code ?? 'unknown', data.message ?? 'Accesso non riuscito.')
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>((readJson<string>(TOKEN_KEY) ?? '').trim())
  const isAuthenticated = computed(() => !!token.value)

  /** Verifica il token sul server e, se valido, lo salva per le sessioni successive. */
  async function login(input: string): Promise<void> {
    const value = input.trim()
    if (!value) throw new AuthError('empty', 'Inserisci il token di accesso.')
    await verify(value)
    token.value = value
    writeJson(TOKEN_KEY, value)
  }

  function logout() {
    token.value = ''
    removeKey(TOKEN_KEY)
  }

  return { token, isAuthenticated, login, logout }
})
