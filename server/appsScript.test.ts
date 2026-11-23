import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appsScriptFromEnv } from './appsScript.js'
import { handleFinanceSync } from './financeSync.js'
import { handleInvestments } from './investmentSheets.js'
import { savePayroll } from './payrollSheets.js'

const URL_OK = 'https://script.google.com/macros/s/AKfy-abc_123/exec'
const bridgeEnv = { APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_SECRET: 'bridge-secret' }
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })

type Handler = (req: Record<string, unknown>) => Record<string, unknown>
/** Finto script: registra le azioni ricevute e risponde con l'handler indicato. */
function fakeScript(handlers: Record<string, Handler>) {
  const calls: Record<string, unknown>[] = []
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push(req)
    if (req.secret !== 'bridge-secret') return json({ ok: false, code: 'unauthorized', message: 'no' })
    const h = handlers[String(req.action)]
    return json(h ? { ok: true, ...h(req) } : { ok: true })
  })
  return { fetchImpl, calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('Apps Script bridge', () => {
  it('is used only with a valid /exec URL and secret', () => {
    expect(appsScriptFromEnv({})).toBeNull()
    expect(() => appsScriptFromEnv({ ...bridgeEnv, APPS_SCRIPT_URL: 'https://example.com/exec' })).toThrow(/APPS_SCRIPT_URL/)
    expect(appsScriptFromEnv(bridgeEnv)).not.toBeNull()
  })

  it('reports a wrong secret clearly', async () => {
    const script = fakeScript({})
    const client = appsScriptFromEnv({ ...bridgeEnv, APPS_SCRIPT_SECRET: 'wrong' }, script.fetchImpl as typeof fetch)!
    await expect(client.call('ping')).rejects.toMatchObject({ code: 'apps_script_unauthorized', status: 401 })
  })

  it('syncs the budget without service account credentials', async () => {
    const script = fakeScript({
      read: () => ({
        title: 'Bilancio',
        values: { Uscite: [['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'Tipologia'], [46000, 'Conto', 'Cibo', 'Spesa', 'Coop', 42.5, 'EUR', 'Necessaria']] },
      }),
    })
    vi.stubGlobal('fetch', script.fetchImpl)

    const res = await handleFinanceSync({ method: 'GET', env: { ...bridgeEnv, BASE_CURRENCY: 'EUR' } })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, spreadsheetTitle: 'Bilancio' })
    expect(script.calls[0]).toMatchObject({ action: 'read' })
    expect(script.calls[0]).not.toHaveProperty('spreadsheetId')
  })

  it('stores instruments in the «Strumenti» tab through the script', async () => {
    const script = fakeScript({ 'table.read': (r) => ({ tab: 'Strumenti', rows: [r.headers] }) })
    const res = await handleInvestments({
      method: 'PUT',
      authorization: 'Bearer app',
      env: { ...bridgeEnv, APP_ACCESS_TOKEN: 'app', INVESTMENTS_SHEET_ID: 'inv' },
      query: new URLSearchParams(),
      body: { item: { key: 'ETF␟MSCI World', category: 'ETF', subcategory: 'MSCI World', instrument: { type: 'etf', ticker: 'SWDA.MI' } } },
      fetchImpl: script.fetchImpl as typeof fetch,
    })

    expect(res).toMatchObject({ status: 200, body: { ok: true, action: 'inserted' } })
    expect(script.calls[1]).toMatchObject({ action: 'rows.append', tab: 'Strumenti' })
    expect(script.calls[0]).toMatchObject({ action: 'table.read', spreadsheetId: 'inv', tab: 'Strumenti', create: true })
  })

  it('archives a payslip: year folder, busta_paga_YEAR sheet, PDF folder and row', async () => {
    const pdf = Buffer.from('%PDF-1.7 bridge')
    const hash = createHash('sha256').update(pdf).digest('hex')
    const script = fakeScript({
      'drive.ensure': (r) => ({ id: `id-${r.name}`, name: r.name, url: `https://drive/${r.name}`, created: true }),
      'drive.findByHash': () => ({ file: null }),
      'drive.upload': (r) => ({ file: { id: 'pdf', name: r.name, url: 'https://drive/pdf', created: true } }),
      'table.read': () => ({ tab: 'Foglio1', rows: [] }),
    })
    vi.stubGlobal('fetch', script.fetchImpl)

    const outcome = await savePayroll(
      { ...bridgeEnv, GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root' },
      {
        recordKey: '2026-04-normale', year: 2026, month: 4, type: 'Normale', basePay: null, grossPay: 200000, totalDeductions: 32440,
        netPay: 167560, hoursWorked: 168, inpsTaxable: null, irpefTaxable: null, irpefPaid: null, vacationRemaining: null, permitsRemaining: null, sourceHash: hash,
      },
      { fileName: '04-26.pdf', data: new Uint8Array(pdf) },
    )

    expect(outcome).toEqual({ action: 'inserted', sheetUrl: 'https://drive/busta_paga_2026', pdf: 'uploaded', pdfUrl: 'https://drive/pdf' })
    const actions = script.calls.map((c) => `${c.action}${c.name ? `:${c.name}` : ''}`)
    expect(actions).toEqual([
      'drive.ensure:2026',
      'drive.ensure:busta_paga_2026',
      'drive.ensure:busta_paga',
      'drive.findByHash',
      'drive.upload:04-26.pdf',
      'table.read',
      'range.put',
      'rows.append',
    ])
    const appended = script.calls.at(-1)!.values as unknown[][]
    expect(appended[0].slice(0, 3)).toEqual(['Aprile', 2026, 'Normale'])
  })
})

describe('ID Google da URL', () => {
  it('estrae l ID da URL di fogli e cartelle, lascia invariati gli ID', async () => {
    const { googleId } = await import('./googleSheets.js')
    expect(googleId('https://docs.google.com/spreadsheets/d/1AbC-dEf_ghIJ123456789/edit?gid=0#gid=0')).toBe('1AbC-dEf_ghIJ123456789')
    expect(googleId('https://drive.google.com/drive/u/0/folders/1XyZ_abcDEF0123456789')).toBe('1XyZ_abcDEF0123456789')
    expect(googleId('"1AbC-dEf_ghIJ123456789"')).toBe('1AbC-dEf_ghIJ123456789')
    expect(googleId('  ')).toBe('')
  })
})
