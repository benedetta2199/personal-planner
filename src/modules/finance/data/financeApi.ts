import type { SyncResponse } from '../domain'

export class FinanceApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
  }
}

const ENDPOINT = '/api/finance/sync'
const TIMEOUT_MS = 30_000

/** Chiama l'API serverless di sincronizzazione. Nessuna credenziale Google transita dal client. */
export async function fetchFinanceSync(accessToken?: string): Promise<Extract<SyncResponse, { ok: true }>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      signal: controller.signal,
    })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new FinanceApiError(aborted ? 'timeout' : 'network', aborted ? 'Il server non ha risposto in tempo.' : 'Impossibile contattare il server. Controlla la connessione.')
  } finally {
    clearTimeout(timer)
  }

  let body: SyncResponse | null = null
  try {
    body = (await res.json()) as SyncResponse
  } catch {
    // Risposta non JSON: tipicamente l'API non è disponibile (es. `vite preview` senza backend).
  }
  if (!body) {
    throw new FinanceApiError('unavailable', `Endpoint /api/finance/sync non raggiungibile (HTTP ${res.status}). In locale usa "npm run dev" o "vercel dev".`, res.status)
  }
  if (!body.ok) throw new FinanceApiError(body.code, body.message, res.status)
  return body
}
