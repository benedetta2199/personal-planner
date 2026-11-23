import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('google-auth-library', () => {
  class Client {
    setCredentials() {}
    async getAccessToken() {
      return { token: 'google-token' }
    }
  }
  return { JWT: Client, OAuth2Client: Client }
})

import { buildRow, decodePayrollPdf, savePayroll } from './payrollSheets.js'

const env = {
  GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root-folder',
  GOOGLE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
}

const pdfBytes = Buffer.from('%PDF-1.7 test payslip')
const pdfHash = createHash('sha256').update(pdfBytes).digest('hex')

const record = {
  recordKey: '2026-03-normale',
  year: 2026,
  month: 3,
  type: 'Normale',
  basePay: 125746,
  grossPay: 189702,
  totalDeductions: 104450,
  netPay: 85252,
  hoursWorked: 168,
  inpsTaxable: 104800,
  irpefTaxable: 91588,
  irpefPaid: 12495,
  vacationRemaining: 14.41666,
  permitsRemaining: 2.66666,
  sourceHash: pdfHash,
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
type Call = [string | URL | Request, RequestInit | undefined]

/** Simula Drive + Sheets: cartelle/foglio esistenti o meno e contenuto della scheda. */
function mockGoogle(fetchMock: ReturnType<typeof vi.fn>, opts: { existing: boolean; values: unknown[][] }) {
  fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    if (url.startsWith('https://www.googleapis.com/upload/')) return json({ id: 'pdf-1', webViewLink: 'https://drive/pdf-1' })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      if (url.includes('appProperties')) return json({ files: [] })
      if (!opts.existing) return json({ files: [] })
      const name = /name = '([^']+)'/.exec(url)?.[1] ?? 'x'
      return json({ files: [{ id: `id-${name}`, name, webViewLink: `https://drive/${name}` }] })
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string }
      return json({ id: `id-${body.name}`, name: body.name, webViewLink: `https://drive/${body.name}` })
    }
    if (url.includes('fields=sheets.properties.title')) return json({ sheets: [{ properties: { title: 'Foglio1' } }] })
    if (url.includes('valueRenderOption=UNFORMATTED_VALUE')) return json({ values: opts.values })
    return json({ ok: true })
  })
}

describe('payroll archive on Google Drive', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('creates 2026/busta_paga_2026 and 2026/busta_paga, uploads the PDF and appends the row', async () => {
    mockGoogle(fetchMock, { existing: false, values: [] })

    const outcome = await savePayroll(env, record, { fileName: '03-26 Payslip.pdf', data: new Uint8Array(pdfBytes) })

    expect(outcome).toMatchObject({ action: 'inserted', pdf: 'uploaded', pdfUrl: 'https://drive/pdf-1', sheetUrl: 'https://drive/busta_paga_2026' })
    const calls = fetchMock.mock.calls as Call[]
    const created = calls
      .filter(([u, i]) => String(u).startsWith('https://www.googleapis.com/drive/v3/files?') && i?.method === 'POST')
      .map(([, i]) => JSON.parse(String(i?.body)))
    expect(created).toEqual([
      { name: '2026', mimeType: 'application/vnd.google-apps.folder', parents: ['root-folder'] },
      { name: 'busta_paga_2026', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['id-2026'] },
      { name: 'busta_paga', mimeType: 'application/vnd.google-apps.folder', parents: ['id-2026'] },
    ])
    const header = calls.find(([u, i]) => decodeURIComponent(String(u)).includes("'Foglio1'!A1:") && i?.method === 'PUT')
    expect(String(header?.[1]?.body)).toContain('"Netto_Busta"')
    const append = calls.find(([u]) => String(u).includes(':append'))
    const row = JSON.parse(String(append?.[1]?.body)).values[0]
    expect(row.slice(0, 4)).toEqual(['Marzo', 2026, 'Normale', 'False'])
    expect(row).toContain(852.52)
    expect(row).toContain('https://drive/pdf-1')
  })

  it('updates the matching month in an existing sheet, keeping columns the app does not manage', async () => {
    const headers = ['Mese', 'Anno', 'Tipo_Busta', 'Contingenza', 'Netto_Busta', 'Link_PDF', 'Impronta_PDF', 'Data_Salvataggio']
    mockGoogle(fetchMock, {
      existing: true,
      values: [headers, ['Febbraio', 2026, 'Normale', 524.22, 1600], ['Marzo', 2026, 'Normale', 524.22, 800]],
    })

    const outcome = await savePayroll(env, record, null)

    expect(outcome).toMatchObject({ action: 'updated', pdf: 'skipped' })
    const calls = fetchMock.mock.calls as Call[]
    const update = calls.find(([u, i]) => decodeURIComponent(String(u)).includes("'Foglio1'!A3:H3") && i?.method === 'PUT')
    const row = JSON.parse(String(update?.[1]?.body)).values[0]
    expect(row.slice(0, 5)).toEqual(['Marzo', 2026, 'Normale', 524.22, 852.52])
    expect(calls.some(([u]) => String(u).includes(':append'))).toBe(false)
    expect(calls.some(([u]) => String(u).startsWith('https://www.googleapis.com/upload/'))).toBe(false)
  })

  it('requires the Drive root folder', async () => {
    await expect(savePayroll({ ...env, GOOGLE_DRIVE_ROOT_FOLDER_ID: '' }, record, null)).rejects.toMatchObject({ code: 'not_configured' })
  })
})

describe('payroll PDF validation', () => {
  it('accepts only a real PDF matching the record hash', () => {
    const base64 = pdfBytes.toString('base64')
    expect(decodePayrollPdf({ fileName: 'a/b.pdf', base64 }, pdfHash)?.fileName).toBe('a b.pdf')
    expect(decodePayrollPdf({ fileName: 'x.pdf', base64 }, 'f'.repeat(64))).toBeNull()
    expect(decodePayrollPdf({ fileName: 'x.pdf', base64: Buffer.from('not a pdf').toString('base64') }, pdfHash)).toBeNull()
  })

  it('does not blank existing values when a field was not read', () => {
    const row = buildRow(['Mese', 'Anno', 'Paga_Base'], ['Marzo', 2026, 1257.46], {
      record: { ...record, basePay: null },
      pdfUrl: null,
      savedAt: 'now',
    })
    expect(row).toEqual(['Marzo', 2026, 1257.46])
  })
})
