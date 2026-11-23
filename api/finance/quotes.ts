import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleQuotes } from '../../server/quotes.js'

/** GET /api/finance/quotes — quotazioni giornaliere e ricerca ticker. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) query.set(k, Array.isArray(v) ? v.join(',') : String(v))
  const result = await handleQuotes({ method: req.method ?? 'GET', authorization: req.headers.authorization, query, env: process.env })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
