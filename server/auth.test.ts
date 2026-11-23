import { describe, expect, it } from 'vitest'
import { handleAuthCheck } from './auth'

const env = { APP_ACCESS_TOKEN: 'segreto' }

describe('handleAuthCheck', () => {
  it('accetta il token corretto', async () => {
    expect(await handleAuthCheck({ method: 'POST', authorization: 'Bearer segreto', env })).toEqual({ status: 200, body: { ok: true } })
  })
  it('rifiuta un token errato o mancante', async () => {
    expect((await handleAuthCheck({ method: 'POST', authorization: 'Bearer altro', env })).status).toBe(401)
    expect((await handleAuthCheck({ method: 'POST', env })).status).toBe(401)
  })
  it('segnala il token non configurato', async () => {
    expect((await handleAuthCheck({ method: 'POST', authorization: 'Bearer x', env: {} })).status).toBe(503)
  })
  it('accetta solo POST', async () => {
    expect((await handleAuthCheck({ method: 'GET', authorization: 'Bearer segreto', env })).status).toBe(405)
  })
})
