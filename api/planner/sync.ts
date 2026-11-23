import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handlePlannerSync } from '../../server/plannerSync.js'

/** POST /api/planner/sync — salva e rilegge Agenda, Obiettivi, Abitudini e Diario sul foglio Google. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handlePlannerSync({ method: req.method ?? 'GET', authorization: req.headers.authorization, env: process.env, body: req.body })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
