import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleFinanceSync } from '../../server/financeSync.js'

/** GET /api/finance/sync — legge Google Sheets e restituisce il dataset validato. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleFinanceSync({
    method: req.method ?? 'GET',
    authorization: req.headers.authorization,
    env: process.env,
  })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
