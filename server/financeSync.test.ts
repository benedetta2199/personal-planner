import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleFinanceSync } from './financeSync'
import { credentialsFromEnv } from './googleSheets'

vi.mock('google-auth-library', () => ({
  JWT: class {
    async getAccessToken() {
      return { token: 'test-token' }
    }
  },
}))

const env = {
  GOOGLE_SHEET_ID: 'sheet123',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@test.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
  BASE_CURRENCY: 'EUR',
}

afterEach(() => vi.unstubAllGlobals())

describe('handleFinanceSync', () => {
  it('rifiuta metodi diversi da GET', async () => {
    const r = await handleFinanceSync({ method: 'POST', env })
    expect(r.status).toBe(405)
  })

  it('richiede il token quando APP_ACCESS_TOKEN è impostato', async () => {
    const r = await handleFinanceSync({ method: 'GET', env: { ...env, APP_ACCESS_TOKEN: 'segreto' } })
    expect(r.status).toBe(401)
    const wrong = await handleFinanceSync({ method: 'GET', authorization: 'Bearer altro', env: { ...env, APP_ACCESS_TOKEN: 'segreto' } })
    expect(wrong.status).toBe(401)
  })

  it('segnala integrazione non configurata', async () => {
    const r = await handleFinanceSync({ method: 'GET', env: {} })
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ ok: false, code: 'not_configured' })
  })

  it('converte i "\\n" letterali della chiave privata', () => {
    expect(credentialsFromEnv(env).privateKey).toContain('\nabc\n')
  })

  it('legge i fogli esistenti (case-insensitive) e restituisce il dataset validato', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('values:batchGet')) {
        const ranges = new URL(url).searchParams.getAll('ranges')
        expect(ranges).toEqual(["'entrate'", "'Uscite'"])
        return Response.json({
          valueRanges: [
            { values: [['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta'], [46027, 'Banca', 'Lavoro', '', 'Stipendio', 2000, 'EUR']] },
            { values: [['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'Tipologia'], [46028, 'Banca', 'Casa', 'Affitto', 'Affitto', 700, 'EUR', 'Necessaria']] },
          ],
        })
      }
      return Response.json({ properties: { title: 'Le mie finanze' }, sheets: [{ properties: { title: 'entrate' } }, { properties: { title: 'Uscite' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await handleFinanceSync({ method: 'GET', authorization: 'Bearer segreto', env: { ...env, APP_ACCESS_TOKEN: 'segreto' } })
    expect(r.status).toBe(200)
    if (!r.body.ok) throw new Error('expected ok')
    expect(r.body.spreadsheetTitle).toBe('Le mie finanze')
    expect(r.body.dataset.operations).toHaveLength(2)
    expect(r.body.dataset.operations[0].date).toBe('2026-01-05')
    expect(r.body.issues.some((i) => i.code === 'missing_sheet' && i.sheet === 'Transazioni')).toBe(true)
  })

  it('traduce un 403 di Google in un messaggio comprensibile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    const r = await handleFinanceSync({ method: 'GET', env })
    expect(r.body).toMatchObject({ ok: false, code: 'forbidden' })
  })
})
