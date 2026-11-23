// Ottiene un refresh token OAuth per il TUO account Google, usato dall'app per
// creare cartelle/fogli e caricare i PDF dei cedolini nel tuo Google Drive.
//
// Uso:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run google:auth
// (oppure metti le due variabili in .env.local: lo script le legge da lì)
//
// Il client OAuth deve essere di tipo "App desktop" (Google Cloud Console →
// API e servizi → Credenziali). Il token stampato va in GOOGLE_OAUTH_REFRESH_TOKEN.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { OAuth2Client } from 'google-auth-library'

function loadEnvLocal() {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
loadEnvLocal()

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Imposta GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET (in .env.local o nell’ambiente).')
  process.exit(1)
}

const PORT = 53682
const redirectUri = `http://127.0.0.1:${PORT}/callback`
const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
const url = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
})

const server = createServer(async (req, res) => {
  const params = new URL(req.url ?? '/', redirectUri).searchParams
  if (!req.url?.startsWith('/callback')) return res.writeHead(404).end()
  const code = params.get('code')
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Autorizzazione negata: ${params.get('error') ?? 'nessun codice'}`)
    return
  }
  try {
    const { tokens } = await client.getToken(code)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Fatto! Puoi chiudere questa scheda e tornare al terminale.')
    if (!tokens.refresh_token) {
      console.error('\nGoogle non ha restituito un refresh token. Revoca l’accesso su https://myaccount.google.com/permissions e riprova.')
    } else {
      console.log('\nAggiungi questa riga a .env.local (e alle variabili d’ambiente su Vercel):\n')
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`)
    }
  } catch (e) {
    res.writeHead(500).end('Errore nello scambio del codice.')
    console.error(e)
  } finally {
    server.close()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('Apri questo indirizzo nel browser e accedi con il tuo account Google:\n')
  console.log(url)
})
