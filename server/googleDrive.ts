import { JWT, OAuth2Client } from 'google-auth-library'

/**
 * Accesso a Google Drive + Sheets in scrittura, usato per archiviare i cedolini
 * (Drive: cartelle e PDF; Sheets: righe del foglio annuale).
 *
 * Due modalità di autenticazione:
 *  - OAuth con il TUO account Google (consigliata per account @gmail.com):
 *    GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN.
 *    I file creati appartengono a te e usano il tuo spazio Drive.
 *  - Service account (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY):
 *    funziona solo su un Drive condiviso (Google Workspace), perché i service
 *    account non hanno spazio di archiviazione proprio e non possono creare file
 *    nel "Il mio Drive" di un account personale.
 */

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'

export class DriveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message)
  }
}

export interface DriveFile {
  id: string
  name: string
  webViewLink?: string
  appProperties?: Record<string, string>
}

export type AuthMode = 'oauth' | 'service_account'

/** Restituisce un client autenticato in base alle variabili d'ambiente disponibili. */
export function driveAuthFromEnv(env: Record<string, string | undefined>): { mode: AuthMode; client: JWT | OAuth2Client } {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim()
  if (clientId && clientSecret && refreshToken) {
    const client = new OAuth2Client({ clientId, clientSecret })
    client.setCredentials({ refresh_token: refreshToken })
    return { mode: 'oauth', client }
  }
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/^"|"$/g, '')
  if (email && key) return { mode: 'service_account', client: new JWT({ email, key, scopes: DRIVE_SCOPES }) }
  throw new DriveError(
    'not_configured',
    'Accesso a Google Drive non configurato: imposta GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN.',
    503,
  )
}

export class GoogleDrive {
  private token: string | null = null

  constructor(
    private readonly auth: { mode: AuthMode; client: JWT | OAuth2Client },
  ) {}

  get mode() {
    return this.auth.mode
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token
    let token: string | null | undefined
    try {
      token = (await this.auth.client.getAccessToken()).token
    } catch (e) {
      const detail = (e as Error).message ?? ''
      const hint = /invalid_grant/i.test(detail)
        ? ' Il refresh token è scaduto o revocato: rigeneralo con `npm run google:auth` (e pubblica l’app OAuth "In produzione" per evitare la scadenza dopo 7 giorni).'
        : ''
      throw new DriveError('auth_failed', `Autenticazione Google non riuscita.${hint}`)
    }
    if (!token) throw new DriveError('auth_failed', 'Google non ha restituito un token valido.')
    this.token = token
    return token
  }

  /** Chiamata JSON autenticata con traduzione degli errori più comuni. */
  async request<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${await this.accessToken()}`)
    let response: Response
    try {
      response = await fetch(url, { ...init, headers })
    } catch {
      throw new DriveError('google_unavailable', 'Impossibile raggiungere i servizi Google.')
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (/storageQuotaExceeded|do not have storage quota/i.test(body)) {
        throw new DriveError(
          'drive_no_quota',
          'Il service account non ha spazio su Drive e non può creare file nel tuo Drive personale: configura le credenziali OAuth (GOOGLE_OAUTH_*).',
          403,
        )
      }
      if (response.status === 403) throw new DriveError('drive_forbidden', 'Accesso negato: condividi la cartella Drive (Editor) con l’account usato dall’app.', 403)
      if (response.status === 404) throw new DriveError('drive_not_found', 'Cartella o file Google non trovato: verifica GOOGLE_DRIVE_ROOT_FOLDER_ID.', 404)
      throw new DriveError('google_error', `Google ha rifiutato la richiesta (HTTP ${response.status}).`, 502)
    }
    return (await response.json()) as T
  }

  /** Cerca file non cestinati in una cartella (anche su Drive condivisi). */
  async list(query: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q: `${query} and trashed = false`,
      fields: 'files(id,name,webViewLink,appProperties)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '10',
    })
    const result = await this.request<{ files?: DriveFile[] }>(`${DRIVE_API}?${params}`)
    return result.files ?? []
  }

  async findChild(parentId: string, name: string, mimeType: string): Promise<DriveFile | null> {
    const files = await this.list(`'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and mimeType = '${mimeType}'`)
    return files[0] ?? null
  }

  /** Trova o crea un file Google "vuoto" (cartella o foglio) dentro `parentId`. */
  async ensureChild(parentId: string, name: string, mimeType: string): Promise<DriveFile & { created: boolean }> {
    const existing = await this.findChild(parentId, name, mimeType)
    if (existing) return { ...existing, created: false }
    const created = await this.request<DriveFile>(`${DRIVE_API}?supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    })
    return { ...created, created: true }
  }

  /** Carica un file binario (upload multipart) con proprietà applicative per la deduplica. */
  async upload(parentId: string, name: string, mimeType: string, data: Uint8Array, appProperties: Record<string, string>): Promise<DriveFile> {
    const boundary = `pp-${Math.random().toString(36).slice(2)}`
    const metadata = JSON.stringify({ name, parents: [parentId], appProperties })
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    )
    const tail = Buffer.from(`\r\n--${boundary}--`)
    const body = Buffer.concat([head, Buffer.from(data), tail])
    return this.request<DriveFile>(`${UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
  }
}

export function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Lettera di colonna A1 (1 → A, 27 → AA). */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
