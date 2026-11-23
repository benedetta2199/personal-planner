import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleInvestments } from '../../server/investmentSheets.js'

/** GET/PUT/DELETE /api/finance/investments — strumenti di investimento sul Google Sheet dedicato. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) query.set(k, Array.isArray(v) ? v.join(',') : String(v))
  const result = await handleInvestments({ method: req.method ?? 'GET', authorization: req.headers.authorization, env: process.env, query, body: req.body })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
