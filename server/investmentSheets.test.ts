import { describe, expect, it } from 'vitest'
import { HEADERS, handleInvestments, instrumentToRow, rowToInstrument } from './investmentSheets'

const env = {
  INVESTMENTS_SHEET_ID: 'inv-sheet',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  GOOGLE_PRIVATE_KEY: 'test-key',
  APP_ACCESS_TOKEN: 'secret',
}

/** Finto Google Sheets in memoria: una scheda «Strumenti». */
function fakeSheets(initial: unknown[][] = []) {
  let rows = initial.map((r) => [...r])
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.replace('https://sheets.googleapis.com/v4/spreadsheets/inv-sheet', '')}`)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (url.includes('?fields=sheets')) return json({ sheets: [{ properties: { title: 'Strumenti', sheetId: 7 } }] })
    if (url.includes(':batchUpdate')) {
      const del = body.requests[0].deleteDimension
      if (del) rows.splice(del.range.startIndex, 1)
      return json({})
    }
    if (url.includes(':append')) {
      rows.push(body.values[0])
      return json({})
    }
    if (method === 'PUT') {
      const m = /!A(\d+):/.exec(url)
      const n = m ? Number(m[1]) : 1
      rows[n - 1] = body.values[0]
      return json({})
    }
    return json({ values: rows })
  }) as typeof fetch
  return { fetchImpl, calls, rows: () => rows }
}

const req = (method: string, sheets: ReturnType<typeof fakeSheets>, extra: { body?: unknown; key?: string; token?: string } = {}) => ({
  method,
  authorization: `Bearer ${extra.token ?? 'secret'}`,
  env,
  query: new URLSearchParams(extra.key ? { key: extra.key } : {}),
  body: extra.body ?? null,
  fetchImpl: sheets.fetchImpl,
  getToken: async () => 'google-token',
})

const bond = {
  key: 'Investimenti␟Austria 2027',
  category: 'Investimenti',
  subcategory: 'Austria 2027',
  instrument: { type: 'bond', ticker: '', units: null, isin: 'AT0000A1ZGE4', coupon: 2.55, couponFrequency: 1, maturity: '2027-04-20', buyPrice: 100.95 },
}

describe('investments Google Sheet', () => {
  it('round-trips an instrument through a sheet row', () => {
    const row = instrumentToRow({ ...bond, instrument: { ...bond.instrument, type: 'bond' } } as never)
    expect(row[3]).toBe('Obbligazione')
    const back = rowToInstrument(row)!
    expect(back.instrument).toMatchObject({ type: 'bond', isin: 'AT0000A1ZGE4', coupon: 2.55, couponFrequency: 1, maturity: '2027-04-20' })
  })

  it('creates headers, inserts, then updates the same key instead of duplicating', async () => {
    const s = fakeSheets()
    const first = await handleInvestments(req('PUT', s, { body: { item: bond } }))
    expect(first.body).toMatchObject({ ok: true, action: 'inserted' })
    expect(s.rows()[0]).toEqual(HEADERS)
    const second = await handleInvestments(req('PUT', s, { body: { item: { ...bond, instrument: { ...bond.instrument, coupon: 3 } } } }))
    expect(second.body).toMatchObject({ ok: true, action: 'updated' })
    expect(s.rows().length).toBe(2)
    const list = await handleInvestments(req('GET', s))
    const body = list.body as { instruments: { instrument: { coupon: number } }[] }
    expect(body.instruments[0].instrument.coupon).toBe(3)
  })

  it('deletes a row by key', async () => {
    const s = fakeSheets()
    await handleInvestments(req('PUT', s, { body: { item: bond } }))
    const res = await handleInvestments(req('DELETE', s, { key: bond.key }))
    expect(res.body).toMatchObject({ ok: true, action: 'deleted' })
    expect(s.rows().length).toBe(1)
  })

  it('rejects incomplete instruments and bad tokens', async () => {
    const s = fakeSheets()
    const bad = await handleInvestments(req('PUT', s, { body: { item: { ...bond, instrument: { type: 'bond', ticker: '', units: null } } } }))
    expect(bad.status).toBe(400)
    const etfNoTicker = await handleInvestments(req('PUT', s, { body: { item: { ...bond, instrument: { type: 'etf', ticker: '', units: null } } } }))
    expect(etfNoTicker.status).toBe(400)
    expect((await handleInvestments(req('GET', s, { token: 'nope' }))).status).toBe(401)
  })

  it('keeps the manual value correction', () => {
    const row = instrumentToRow({ ...bond, instrument: { ...bond.instrument, type: 'bond', adjustment: -3.2, adjustmentFrom: '2026-11-24' } } as never)
    expect(rowToInstrument(row)!.instrument).toMatchObject({ adjustment: -3.2, adjustmentFrom: '2026-11-24' })
  })

  it('adds the new columns to a sheet from a previous version', async () => {
    const legacy = HEADERS.slice(0, 14)
    const s = fakeSheets([legacy, instrumentToRow(bond as never).slice(0, 14)])
    const list = await handleInvestments(req('GET', s))
    expect(list.body).toMatchObject({ ok: true })
    expect(s.rows()[0]).toEqual(HEADERS)
    expect((list.body as { instruments: { instrument: { adjustment: unknown } }[] }).instruments[0].instrument.adjustment).toBeNull()
  })

  it('reports a missing sheet configuration', async () => {
    const s = fakeSheets()
    const res = await handleInvestments({ ...req('GET', s), env: { APP_ACCESS_TOKEN: 'secret' } })
    expect(res.body).toMatchObject({ ok: false, code: 'not_configured' })
  })
})
