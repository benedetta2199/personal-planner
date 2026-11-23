import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handlePayrollSave } from '../../server/payrollSync.js'

/** POST /api/finance/payroll — salva il cedolino confermato nel foglio annuale e il PDF nella cartella Drive. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handlePayrollSave({
    method: req.method ?? 'GET',
    authorization: req.headers.authorization,
    env: process.env,
    body: req.body,
  })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}
