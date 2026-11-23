import { SheetsError } from './googleSheets.js'

/**
 * Client del "ponte" Apps Script (docs/apps-script/Code.gs): un'app web che gira
 * con il tuo account Google e legge/scrive Fogli e Drive per conto dell'app.
 * Attivo quando sono impostati APPS_SCRIPT_URL e APPS_SCRIPT_SECRET; in quel caso
 * ha la precedenza su service account e OAuth.
 */

export interface BridgeFile {
  id: string
  name: string
  url: string
  created: boolean
}

export class AppsScriptClient {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    let response: Response
    try {
      // Apps Script risponde con un redirect verso googleusercontent.com: fetch lo segue.
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action, secret: this.secret }),
        redirect: 'follow',
      })
    } catch {
      throw new SheetsError('google_unavailable', 'Impossibile raggiungere lo script Google (APPS_SCRIPT_URL).')
    }
    const text = await response.text().catch(() => '')
    let body: { ok?: boolean; code?: string; message?: string } & Record<string, unknown>
    try {
      body = JSON.parse(text)
    } catch {
      throw new SheetsError(
        'apps_script_unreachable',
        'Lo script Google non ha risposto correttamente: verifica che il deployment sia "App web" con accesso "Chiunque" e che APPS_SCRIPT_URL finisca con /exec.',
        502,
      )
    }
    if (!body.ok) {
      const code = body.code ?? 'apps_script_error'
      const status = code === 'unauthorized' ? 401 : code === 'not_found' ? 404 : code === 'not_configured' ? 503 : 502
      const message =
        code === 'unauthorized'
          ? 'APPS_SCRIPT_SECRET non coincide con la proprietà APP_SECRET dello script.'
          : `Script Google: ${body.message ?? 'errore sconosciuto'}`
      throw new SheetsError(code === 'unauthorized' ? 'apps_script_unauthorized' : code, message, status)
    }
    return body as T
  }
}

/** Restituisce il client se il ponte è configurato, altrimenti null. */
export function appsScriptFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): AppsScriptClient | null {
  const url = env.APPS_SCRIPT_URL?.trim()
  const secret = env.APPS_SCRIPT_SECRET?.trim()
  if (!url || !secret) return null
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    throw new SheetsError('not_configured', 'APPS_SCRIPT_URL non valido: deve essere https://script.google.com/macros/s/…/exec', 503)
  }
  return new AppsScriptClient(url, secret, fetchImpl)
}
