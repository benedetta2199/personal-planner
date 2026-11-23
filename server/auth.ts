import { timingSafeEqual } from 'node:crypto'

export interface AuthRequest {
  method: string
  authorization?: string
  env: Record<string, string | undefined>
}

export type AuthBody = { ok: true } | { ok: false; code: string; message: string }

const fail = (status: number, code: string, message: string) => ({ status, body: { ok: false, code, message } as AuthBody })

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Verifica il token di accesso (APP_ACCESS_TOKEN) usato per il login dell'app. */
export async function handleAuthCheck(req: AuthRequest): Promise<{ status: number; body: AuthBody }> {
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Metodo non consentito.')
  const expected = req.env.APP_ACCESS_TOKEN?.trim()
  if (!expected) return fail(503, 'token_not_configured', 'Configura APP_ACCESS_TOKEN sul server per poter accedere.')
  const provided = req.authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!provided || !safeEqual(provided, expected)) return fail(401, 'unauthorized', 'Token di accesso non valido.')
  return { status: 200, body: { ok: true } }
}
