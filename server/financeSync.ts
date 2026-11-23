import { timingSafeEqual } from 'node:crypto'
import { credentialsFromEnv, fetchSheets, googleId, SheetsError, type FetchedSheets } from './googleSheets.js'
import { appsScriptFromEnv } from './appsScript.js'
import { importFinanceSheets } from '../src/modules/finance/domain/importer.js'
import { ALL_SHEETS } from '../src/modules/finance/domain/schema.js'
import type { RawSheets, SyncResponse } from '../src/modules/finance/domain/types.js'

export interface SyncRequest {
  method: string
  authorization?: string
  env: Record<string, string | undefined>
}

export interface SyncResult {
  status: number
  body: SyncResponse
}

const fail = (status: number, code: string, message: string): SyncResult => ({ status, body: { ok: false, code, message } })

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Logica dell'endpoint di sincronizzazione, indipendente dal runtime
 * (usata dalla funzione Vercel e dal dev server di Vite).
 */
export async function handleFinanceSync(req: SyncRequest): Promise<SyncResult> {
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Metodo non consentito.')

  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  if (expected) {
    const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
    if (!provided || !safeEqual(provided, expected)) {
      return fail(401, 'unauthorized', 'Token di accesso mancante o non valido.')
    }
  }

  try {
    // Con il ponte Apps Script GOOGLE_SHEET_ID è facoltativo: vale il foglio a cui è collegato lo script.
    const bridge = appsScriptFromEnv(req.env)
    const { title, values } = bridge
      ? await bridge.call<FetchedSheets>('read', { spreadsheetId: googleId(req.env.GOOGLE_SHEET_ID) || undefined, sheets: ALL_SHEETS })
      : await fetchSheets(credentialsFromEnv(req.env), ALL_SHEETS)
    const result = importFinanceSheets(values as RawSheets, { baseCurrency: req.env.BASE_CURRENCY })
    return {
      status: 200,
      body: { ok: true, fetchedAt: new Date().toISOString(), spreadsheetTitle: title, ...result },
    }
  } catch (e) {
    if (e instanceof SheetsError) return fail(e.status, e.code, e.message)
    console.error('[finance-sync]', e)
    return fail(500, 'internal', 'Errore interno durante la sincronizzazione.')
  }
}
