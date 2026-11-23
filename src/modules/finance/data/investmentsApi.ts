import type { InvestmentConfig } from '../domain'
import { FinanceApiError } from './financeApi'

const ENDPOINT = '/api/finance/investments'
const TIMEOUT_MS = 30_000

export interface StoredInstrument {
  key: string
  category: string
  subcategory: string
  instrument: InvestmentConfig
}

type Fail = { ok: false; code: string; message: string }

async function call<T>(url: string, init: RequestInit, accessToken?: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new FinanceApiError(aborted ? 'timeout' : 'network', aborted ? 'Il Google Sheet degli investimenti non ha risposto in tempo.' : 'Impossibile contattare il server.')
  } finally {
    clearTimeout(timer)
  }
  let body: (T & { ok: true }) | Fail | null = null
  try {
    body = (await res.json()) as (T & { ok: true }) | Fail
  } catch {
    /* risposta non JSON */
  }
  if (!body) throw new FinanceApiError('unavailable', `Endpoint investimenti non raggiungibile (HTTP ${res.status}).`, res.status)
  if (!body.ok) throw new FinanceApiError(body.code, body.message, res.status)
  return body
}

export const listInstruments = (token?: string) => call<{ instruments: StoredInstrument[] }>(ENDPOINT, { method: 'GET' }, token)

export const saveInstrument = (item: StoredInstrument, token?: string) =>
  call<{ action: string; key: string }>(ENDPOINT, { method: 'PUT', body: JSON.stringify({ item }) }, token)

export const deleteInstrument = (key: string, token?: string) =>
  call<{ action: string }>(`${ENDPOINT}?${new URLSearchParams({ key })}`, { method: 'DELETE' }, token)
