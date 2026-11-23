import { describe, expect, it } from 'vitest'
import { DATA_TAB, cell, handlePlannerSync, overwriteBlock } from './plannerSync.js'

const env = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy-test/exec',
  APPS_SCRIPT_SECRET: 's',
  APP_ACCESS_TOKEN: 'app',
  GOOGLE_SHEET_ID: 'bilancio-id-0000000000',
  PLANNER_SHEET_ID: 'https://docs.google.com/spreadsheets/d/planner-id-1234567890/edit#gid=0',
}

/** Finto foglio dietro al ponte Apps Script. */
function fakeBook(version = 2) {
  const tabs: Record<string, unknown[][]> = {}
  const hidden = new Set<string>()
  const calls: string[] = []
  const books = new Set<string>()
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body)) as Record<string, any>
    calls.push(r.action)
    if (r.action !== 'ping') books.add(r.spreadsheetId)
    const ok = (b: object = {}) => new Response(JSON.stringify({ ok: true, ...b }))
    const tab = r.tab as string
    switch (r.action) {
      case 'ping':
        return ok({ version })
      case 'table.read': {
        if (!tabs[tab] && r.create) {
          tabs[tab] = []
          if (r.hidden) hidden.add(tab)
        }
        // Come lo script: righe vuote in fondo e celle vuote in coda vengono tolte.
        const rows = tabs[tab].map((row) => {
          const c = [...row]
          while (c.length && (c[c.length - 1] === '' || c[c.length - 1] == null)) c.pop()
          return c
        })
        while (rows.length && !rows[rows.length - 1].length) rows.pop()
        return ok({ tab, rows })
      }
      case 'range.put':
        r.values.forEach((row: unknown[], i: number) => {
          const target = (tabs[tab][r.row - 1 + i] ??= [])
          row.forEach((v, j) => (target[r.col - 1 + j] = v))
        })
        return ok()
    }
    return ok()
  }) as typeof fetch
  return { tabs, hidden, calls, books, fetchImpl }
}

const call = (book: ReturnType<typeof fakeBook>, body: unknown, token = 'app') =>
  handlePlannerSync({ method: 'POST', authorization: `Bearer ${token}`, env, body, fetchImpl: book.fetchImpl })

const visible = (rows: unknown[][]) => rows.map((r) => r.filter((c) => c !== '')).filter((r) => r.length)

const agenda = (updatedAt: string, titles: string[]) => ({
  updatedAt,
  data: { version: 1, commitments: titles.map((t) => ({ id: t, title: t })), completions: [] },
  tables: { Scadenze: [['Impegno', 'Prossima scadenza'], ...titles.map((t) => [t, { $date: '2026-12-01' }])] },
})

describe('handlePlannerSync', () => {
  it('richiede il token di accesso', async () => {
    const book = fakeBook()
    expect((await call(book, { modules: {} }, 'sbagliato')).status).toBe(401)
    expect((await handlePlannerSync({ method: 'POST', env: { ...env, APP_ACCESS_TOKEN: '' }, body: {} })).status).toBe(503)
    expect(book.calls).toEqual([])
  })

  it('scrive solo sul foglio del planner, mai su quello del bilancio', async () => {
    const book = fakeBook()
    await call(book, { modules: { agenda: agenda('2026-11-23T10:00:00.000Z', ['Bollo']) } })
    expect([...book.books]).toEqual(['planner-id-1234567890'])

    const missing = fakeBook()
    const res = await handlePlannerSync({ method: 'POST', authorization: 'Bearer app', env: { ...env, PLANNER_SHEET_ID: '' }, body: { modules: {} }, fetchImpl: missing.fetchImpl })
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ ok: false, code: 'planner_sheet_missing' })
    expect(missing.calls).toEqual([])
  })

  it('salva copia completa e schede leggibili, e le rilegge', async () => {
    const book = fakeBook()
    const res = await call(book, { modules: { agenda: agenda('2026-11-23T10:00:00.000Z', ['Revisione auto', 'Bollo']) } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, saved: ['agenda'] })
    expect(book.hidden.has(DATA_TAB)).toBe(true)
    expect(book.tabs.Scadenze).toEqual([['Impegno', 'Prossima scadenza'], ['Revisione auto', { $date: '2026-12-01' }], ['Bollo', { $date: '2026-12-01' }]])

    const read = await call(book, { modules: {} })
    expect(read.body).toMatchObject({ ok: true, saved: [], modules: { agenda: { updatedAt: '2026-11-23T10:00:00.000Z' } } })
    if (read.body.ok) expect((read.body.modules.agenda.data.commitments as unknown[]).length).toBe(2)
  })

  it('non sovrascrive una versione più recente, modulo per modulo', async () => {
    const book = fakeBook()
    await call(book, { modules: { agenda: agenda('2026-11-23T12:00:00.000Z', ['Nuovo']) } })
    const res = await call(book, {
      modules: {
        agenda: agenda('2026-11-23T09:00:00.000Z', ['Vecchio']),
        journal: { updatedAt: '2026-11-23T09:00:00.000Z', data: { version: 1, entries: {} }, tables: { Diario: [['Data']] } },
      },
    })
    expect(res.body).toMatchObject({ ok: true, saved: ['journal'] })
    if (res.body.ok) expect(res.body.modules.agenda.updatedAt).toBe('2026-11-23T12:00:00.000Z')
    expect(visible(book.tabs.Scadenze)).toEqual([['Impegno', 'Prossima scadenza'], ['Nuovo', { $date: '2026-12-01' }]])
  })

  it('svuota le righe in più quando la tabella si accorcia', async () => {
    const book = fakeBook()
    await call(book, { modules: { agenda: agenda('2026-11-23T10:00:00.000Z', ['A', 'B', 'C']) } })
    await call(book, { modules: { agenda: agenda('2026-11-23T11:00:00.000Z', ['A']) } })
    expect(visible(book.tabs.Scadenze)).toEqual([['Impegno', 'Prossima scadenza'], ['A', { $date: '2026-12-01' }]])
  })

  it('divide i dati grandi in più celle e li ricompone', async () => {
    const book = fakeBook()
    const text = 'x'.repeat(95000)
    await call(book, { modules: { journal: { updatedAt: '2026-11-23T10:00:00.000Z', data: { version: 1, entries: { '2026-11-23': { text } } } } } })
    expect(book.tabs[DATA_TAB].length).toBeGreaterThan(3)
    const read = await call(book, { modules: {} })
    if (read.body.ok) expect((read.body.modules.journal.data.entries as Record<string, { text: string }>)['2026-11-23'].text).toBe(text)
  })

  it('rifiuta moduli o schede non previsti', async () => {
    const book = fakeBook()
    expect((await call(book, { modules: { finanze: { updatedAt: '2026-11-23T10:00:00.000Z', data: {} } } })).status).toBe(400)
    expect((await call(book, { modules: { agenda: { ...agenda('2026-11-23T10:00:00.000Z', []), tables: { Uscite: [] } } } })).status).toBe(400)
    expect((await call(book, { modules: { agenda: { ...agenda('ieri', []) } } })).status).toBe(400)
    expect(book.calls).toEqual([])
  })

  it('chiede di aggiornare uno script troppo vecchio', async () => {
    const res = await call(fakeBook(1), { modules: {} })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, code: 'script_outdated' })
  })
})

describe('celle', () => {
  it('rende letterali i testi che sembrano formule', () => {
    expect(cell('=IMPORTXML("x")')).toBe(`'=IMPORTXML("x")`)
    expect(cell('- punto elenco')).toBe(`'- punto elenco`)
    expect(cell('normale')).toBe('normale')
    expect(cell(3)).toBe(3)
    expect(cell({ $date: '2026-01-02' })).toEqual({ $date: '2026-01-02' })
    expect(cell({ $date: 'domani' })).toBeNull()
    expect(cell({})).toBeNull()
  })

  it('copre con celle vuote la tabella precedente più grande', () => {
    expect(overwriteBlock([['a']], [['x', 'y'], ['z']])).toEqual([['a', ''], ['', '']])
  })
})
