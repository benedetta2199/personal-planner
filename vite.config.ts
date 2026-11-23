/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * In sviluppo espone le stesse funzioni serverless di Vercel (`/api/*`)
 * dentro il dev server di Vite, leggendo le variabili da `.env.local`.
 * In produzione le serve Vercel dalla cartella `api/`.
 */
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/auth/check', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        try {
          const mod = await server.ssrLoadModule('/server/auth.ts')
          const result = await mod.handleAuthCheck({ method: req.method ?? 'GET', authorization: req.headers.authorization, env })
          res.statusCode = result.status
          res.end(JSON.stringify(result.body))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, code: 'internal', message: (e as Error).message }))
        }
      })
      server.middlewares.use('/api/finance/sync', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/server/financeSync.ts')
          const result = await mod.handleFinanceSync({ method: req.method ?? 'GET', authorization: req.headers.authorization, env })
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(result.body))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'internal', message: (e as Error).message }))
        }
      })
      server.middlewares.use('/api/finance/quotes', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/server/quotes.ts')
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          const result = await mod.handleQuotes({ method: req.method ?? 'GET', authorization: req.headers.authorization, query, env })
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(result.body))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'internal', message: (e as Error).message }))
        }
      })
      server.middlewares.use('/api/finance/investments', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        let raw = ''
        try {
          for await (const chunk of req) {
            raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
            if (raw.length > 16 * 1024) return send(413, { ok: false, code: 'payload_too_large', message: 'Richiesta troppo grande.' })
          }
        } catch {
          return send(400, { ok: false, code: 'invalid_request', message: 'Impossibile leggere la richiesta.' })
        }
        let body: unknown = null
        try {
          body = raw ? JSON.parse(raw) : null
        } catch {
          return send(400, { ok: false, code: 'invalid_request', message: 'Richiesta non valida.' })
        }
        try {
          const mod = await server.ssrLoadModule('/server/investmentSheets.ts')
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          const result = await mod.handleInvestments({ method: req.method ?? 'GET', authorization: req.headers.authorization, env, query, body })
          send(result.status, result.body)
        } catch (e) {
          send(500, { ok: false, code: 'internal', message: (e as Error).message })
        }
      })
      server.middlewares.use('/api/finance/ledger', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        let raw = ''
        try {
          for await (const chunk of req) {
            raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
            if (raw.length > 4 * 1024 * 1024) return send(413, { ok: false, code: 'payload_too_large', message: 'Richiesta troppo grande.' })
          }
          const body = raw ? JSON.parse(raw) : null
          const mod = await server.ssrLoadModule('/server/ledgerSync.ts')
          const result = await mod.handleLedger({ method: req.method ?? 'GET', authorization: req.headers.authorization, env, body })
          send(result.status, result.body)
        } catch (e) {
          send(500, { ok: false, code: 'internal', message: (e as Error).message })
        }
      })
      server.middlewares.use('/api/planner/sync', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        let raw = ''
        try {
          for await (const chunk of req) {
            raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
            if (raw.length > 4 * 1024 * 1024) return send(413, { ok: false, code: 'payload_too_large', message: 'Richiesta troppo grande.' })
          }
          const body = raw ? JSON.parse(raw) : null
          const mod = await server.ssrLoadModule('/server/plannerSync.ts')
          const result = await mod.handlePlannerSync({ method: req.method ?? 'GET', authorization: req.headers.authorization, env, body })
          send(result.status, result.body)
        } catch (e) {
          send(500, { ok: false, code: 'internal', message: (e as Error).message })
        }
      })
      server.middlewares.use('/api/finance/payroll', async (req, res) => {
        let raw = ''
        let oversized = false
        try {
          for await (const chunk of req) {
            if (oversized) continue
            raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
            // Dati del cedolino + PDF in base64 (max 3 MB → ~4 MB codificati).
            if (Buffer.byteLength(raw, 'utf8') > 5 * 1024 * 1024) {
              oversized = true
              raw = ''
            }
          }
        } catch (error) {
          console.error('[payroll-api] Failed to read request body.', error)
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'invalid_request', message: 'Impossibile leggere la richiesta.' }))
          return
        }
        if (oversized) {
          res.statusCode = 413
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'payload_too_large', message: 'Richiesta troppo grande: il PDF del cedolino deve essere al massimo di 3 MB.' }))
          return
        }
        let body: unknown = null
        try {
          body = raw ? JSON.parse(raw) : null
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'invalid_request', message: 'Richiesta non valida.' }))
          return
        }
        let handler: typeof import('./server/payrollSync').handlePayrollSave
        try {
          const mod = await server.ssrLoadModule('/server/payrollSync.ts')
          if (typeof mod.handlePayrollSave !== 'function') {
            throw new Error('Payroll save handler export is unavailable.')
          }
          handler = mod.handlePayrollSave
        } catch (error) {
          console.error('[payroll-api] Failed to load the save handler.', error)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, code: 'internal', message: 'Servizio di salvataggio non disponibile.' }))
          return
        }
        const result = await handler({ method: req.method ?? 'GET', authorization: req.headers.authorization, env, body })
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(result.body))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), devApi(env)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('chart.js') || id.includes('vue-chartjs')) return 'charts'
            if (/reka-ui|@internationalized|@floating-ui|@tanstack|@vueuse/.test(id)) return 'ui'
            if (id.includes('node_modules')) return 'vendor'
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    },
  }
})
