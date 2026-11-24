import type { Operation } from '../domain'
import { FinanceApiError } from './financeApi'

const TIMEOUT_MS = 60_000

async function call<T>(body: Record<string, unknown>, accessToken: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('/api/finance/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new FinanceApiError(aborted ? 'timeout' : 'network', aborted ? 'Il salvataggio sul foglio non ha risposto in tempo.' : 'Impossibile contattare il server.')
  } finally {
    clearTimeout(timer)
  }
  let data: ({ ok: true } & T) | { ok: false; code: string; message: string } | null = null
  try {
    data = await res.json()
  } catch {
    /* risposta non JSON */
  }
  if (!data) throw new FinanceApiError('unavailable', `Servizio di salvataggio non raggiungibile (HTTP ${res.status}).`, res.status)
  if (!data.ok) throw new FinanceApiError(data.code, data.message, res.status)
  return data
}

/** Strip dei campi non necessari al server. */
const wire = (op: Operation) => {
  const { extra: _extra, source: _source, ...rest } = op
  return rest
}

export const pushEntries = (ops: Operation[], token: string) => call<{ inserted: number; updated: number }>({ action: 'push', ops: ops.map(wire) }, token)
export const deleteEntries = (ids: string[], token: string) => call<{ deleted: number }>({ action: 'delete', ids }, token)
/** Riga scritta a mano nel foglio (senza ID dell'app), individuata da scheda + riga + ID letto dall'app. */
export interface SheetRowRef {
  tab: 'Entrate' | 'Uscite' | 'Transazioni'
  row: number
  expectedId: string
}
export const replaceSheetRow = (ref: SheetRowRef, op: Operation, token: string) => call<{ inserted: number; updated: number }>({ action: 'row.replace', ...ref, op: wire(op) }, token)
export const deleteSheetRow = (ref: SheetRowRef, token: string) => call<{ deleted: number }>({ action: 'row.delete', ...ref }, token)
export const getRemoteConfig = (token: string) => call<{ config: unknown; updatedAt: string | null }>({ action: 'config.get' }, token)
export const putRemoteConfig = (config: unknown, updatedAt: string, token: string) => call<{ saved: true }>({ action: 'config.put', config, updatedAt }, token)
