import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleAuthCheck } from '../../server/auth.js'

/** POST /api/auth/check — verifica il token di accesso inserito nella pagina di login. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleAuthCheck({ method: req.method ?? 'GET', authorization: req.headers.authorization, env: process.env })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
