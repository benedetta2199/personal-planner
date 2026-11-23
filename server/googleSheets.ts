import { JWT } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface SheetsCredentials {
  sheetId: string
  clientEmail: string
  privateKey: string
}

export class SheetsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message)
  }
}

/**
 * ID di un file o di una cartella Google: accetta anche l'URL completo incollato dal browser
 * (…/spreadsheets/d/<ID>/edit, …/drive/folders/<ID>, …?id=<ID>). Restituisce '' se vuoto.
 */
export function googleId(value: string | undefined): string {
  const v = (value ?? '').trim().replace(/^["']|["']$/g, '')
  if (!v) return ''
  const m = /\/d\/([\w-]{10,})/.exec(v) ?? /\/folders\/([\w-]{10,})/.exec(v) ?? /[?&]id=([\w-]{10,})/.exec(v)
  return m ? m[1] : v
}

/** Legge e valida le credenziali dalle variabili d'ambiente (solo server). */
function credentialsFromEnvKey(env: Record<string, string | undefined>, sheetIdKey: string): SheetsCredentials {
  const sheetId = googleId(env[sheetIdKey])
  const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  // Su Vercel la chiave viene spesso salvata con "\n" letterali.
  const privateKey = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/^"|"$/g, '')
  const missing = [
    !sheetId && sheetIdKey,
    !clientEmail && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !privateKey && 'GOOGLE_PRIVATE_KEY',
  ].filter(Boolean)
  if (missing.length) {
    throw new SheetsError('not_configured', `Integrazione Google Sheets non configurata: mancano ${missing.join(', ')}.`, 503)
  }
  return { sheetId: sheetId!, clientEmail: clientEmail!, privateKey: privateKey! }
}

export const credentialsFromEnv = (env: Record<string, string | undefined>) => credentialsFromEnvKey(env, 'GOOGLE_SHEET_ID')
export const investmentCredentialsFromEnv = (env: Record<string, string | undefined>) => credentialsFromEnvKey(env, 'INVESTMENTS_SHEET_ID')

async function getJson<T>(client: JWT, url: string): Promise<T> {
  let token: string | null | undefined
  try {
    token = (await client.getAccessToken()).token
  } catch (e) {
    throw new SheetsError('auth_failed', `Autenticazione Google fallita: ${(e as Error).message}`, 502)
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 403) throw new SheetsError('forbidden', 'Accesso negato al foglio: condividilo (Lettore) con l\'email del service account.', 502)
    if (res.status === 404) throw new SheetsError('sheet_not_found', 'Documento Google Sheets non trovato: controlla GOOGLE_SHEET_ID.', 502)
    throw new SheetsError('sheets_api', `Errore API Google Sheets (${res.status}): ${body.slice(0, 300)}`, 502)
  }
  return (await res.json()) as T
}

export interface FetchedSheets {
  title: string
  values: Record<string, unknown[][]>
}

/**
 * Scarica i fogli richiesti (se esistono) con una sola chiamata batchGet.
 * Le date sono richieste come numeri seriali: formato non ambiguo,
 * indipendente dalle impostazioni locali del foglio.
 */
export async function fetchSheets(creds: SheetsCredentials, wanted: string[]): Promise<FetchedSheets> {
  const client = new JWT({ email: creds.clientEmail, key: creds.privateKey, scopes: SCOPES })
  const id = encodeURIComponent(creds.sheetId)

  const meta = await getJson<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    client,
    `${API}/${id}?fields=properties.title,sheets.properties.title`,
  )
  // Confronto case-insensitive tra i nomi dei fogli attesi e quelli presenti.
  const existing = new Map(meta.sheets.map((s) => [s.properties.title.trim().toLowerCase(), s.properties.title]))
  const ranges = wanted.map((w) => [w, existing.get(w.toLowerCase())] as const).filter(([, actual]) => actual)

  const values: Record<string, unknown[][]> = {}
  if (ranges.length) {
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', majorDimension: 'ROWS' })
    ranges.forEach(([, actual]) => params.append('ranges', `'${actual!.replace(/'/g, "''")}'`))
    const data = await getJson<{ valueRanges: { values?: unknown[][] }[] }>(client, `${API}/${id}/values:batchGet?${params}`)
    ranges.forEach(([name], i) => {
      values[name] = data.valueRanges[i]?.values ?? []
    })
  }
  return { title: meta.properties.title, values }
}
