import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleLedger } from '../../server/ledgerSync.js'

/** POST /api/finance/ledger — salva voci e configurazione dell'app sul foglio Google del bilancio. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleLedger({ method: req.method ?? 'GET', authorization: req.headers.authorization, env: process.env, body: req.body })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
