import { describe, expect, it } from 'vitest'
import { handleLedger } from './ledgerSync.js'
import { importFinanceSheets } from '../src/modules/finance/domain/importer.js'
import { appEntryId } from '../src/modules/finance/domain/ledger.js'
import type { RawSheets } from '../src/modules/finance/domain/types.js'

const env = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy-test/exec',
  APPS_SCRIPT_SECRET: 's',
  APP_ACCESS_TOKEN: 'app',
}

/** Finto foglio dietro al ponte Apps Script (versione configurabile). */
function fakeBook(initial: Record<string, unknown[][]> = {}, version = 2) {
  const tabs: Record<string, unknown[][]> = JSON.parse(JSON.stringify(initial))
  const hidden = new Set<string>()
  // Come lo script: le date {$date} diventano seriali di Fogli quando vengono rilette.
  const toCell = (v: unknown) => {
    if (v && typeof v === 'object' && '$date' in v) {
      const [y, m, d] = String((v as { $date: string }).$date).split('-').map(Number)
      return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000
    }
    return v
  }
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body)) as Record<string, any>
    const ok = (b: object = {}) => new Response(JSON.stringify({ ok: true, ...b }))
    const tab = r.tab as string
    switch (r.action) {
      case 'ping':
        return ok({ version })
      case 'read':
        return ok({ title: 'Bilancio', values: Object.fromEntries((r.sheets as string[]).filter((n) => tabs[n]).map((n) => [n, tabs[n]])) })
      case 'table.read': {
        if (!tabs[tab] && r.create) {
          tabs[tab] = []
          if (r.hidden) hidden.add(tab)
        }
        if (!tabs[tab].length && r.headers) tabs[tab] = [r.headers]
        return ok({ tab, rows: tabs[tab] })
      }
      case 'range.put':
        r.values.forEach((row: unknown[], i: number) => {
          const target = (tabs[tab][r.row - 1 + i] ??= [])
          row.forEach((v, j) => (target[r.col - 1 + j] = toCell(v)))
        })
        return ok()
      case 'rows.append':
        for (const row of r.values) tabs[tab].push(row.map(toCell))
        return ok()
      case 'row.delete':
        tabs[tab].splice(r.row - 1, 1)
        return ok()
    }
    return ok()
  }) as typeof fetch
  return { tabs, hidden, fetchImpl }
}

const call = (book: ReturnType<typeof fakeBook>, body: unknown, token = 'app') =>
  handleLedger({ method: 'POST', authorization: `Bearer ${token}`, env, body, fetchImpl: book.fetchImpl })

const expense = {
  id: 'm-abc123',
  kind: 'expense',
  expenseType: 'additional',
  date: '2026-11-20',
  account: 'Revolut',
  category: '🍱 Cibo',
  subcategory: 'Asporto',
  description: 'Sushi',
  amount: 2350,
  currency: 'EUR',
}

describe('salvataggio delle voci sul foglio', () => {
  it('richiede il token', async () => {
    const r = await call(fakeBook(), { action: 'push', ops: [expense] }, 'nope')
    expect(r.status).toBe(401)
  })

  it('chiede di aggiornare uno script vecchio', async () => {
    const r = await call(fakeBook({}, 1), { action: 'push', ops: [expense] })
    expect(r.body).toMatchObject({ ok: false, code: 'script_outdated' })
  })

  it('aggiunge la riga nelle colonne esistenti, aggiunge «ID» e la rilegge come voce dell app', async () => {
    const book = fakeBook({
      Uscite: [['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'Tipologia', 'Note extra'], [46000, 'Conto', 'Casa', '', 'Affitto', 700, 'EUR', 'Necessaria', 'x']],
    })
    const r = await call(book, { action: 'push', ops: [expense] })
    expect(r.body).toMatchObject({ ok: true, inserted: 1, updated: 0 })
    expect(book.tabs.Uscite[0].at(-1)).toBe('ID')
    expect(book.tabs.Uscite[1][8]).toBe('x') // colonne non gestite intatte
    // Il foglio riletto dall'importer restituisce la stessa voce.
    const ds = importFinanceSheets(book.tabs as RawSheets, { baseCurrency: 'EUR' }).dataset
    const sushi = ds.operations.find((o) => o.description === 'Sushi')!
    expect(appEntryId(sushi.id)).toBe('m-abc123')
    expect(sushi).toMatchObject({ date: '2026-11-20', amount: 2350, kind: 'expense', expenseType: 'additional', account: 'Revolut' })
  })

  it('aggiorna la stessa riga e la sposta di scheda se cambia tipo', async () => {
    const book = fakeBook()
    await call(book, { action: 'push', ops: [expense] })
    await call(book, { action: 'push', ops: [{ ...expense, amount: 3000 }] })
    expect(book.tabs.Uscite).toHaveLength(2)
    expect(book.tabs.Uscite[1]).toContain(30)

    await call(book, { action: 'push', ops: [{ ...expense, kind: 'income', expenseType: undefined, category: 'Rimborso' }] })
    expect(book.tabs.Uscite).toHaveLength(1)
    expect(book.tabs.Entrate).toHaveLength(2)
  })

  it('elimina per ID', async () => {
    const book = fakeBook()
    await call(book, { action: 'push', ops: [expense, { ...expense, id: 'm-def456' }] })
    const r = await call(book, { action: 'delete', ids: ['m-abc123'] })
    expect(r.body).toMatchObject({ ok: true, deleted: 1 })
    expect(book.tabs.Uscite).toHaveLength(2)
  })

  it('rifiuta voci non create dall app', async () => {
    const r = await call(fakeBook(), { action: 'push', ops: [{ ...expense, id: 'Uscite:abc' }] })
    expect(r.status).toBe(400)
  })
})

describe('righe scritte a mano nel foglio', () => {
  const sheet = () =>
    fakeBook({
      Uscite: [
        ['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'Tipologia', 'Note extra'],
        [46000, 'Revolut', 'Cibo', 'Spesa', 'Conad', 5.87, 'EUR', 'Necessaria', 'nota'],
        [46001, 'Revolut', 'Cibo', 'Asporto', 'Pizza', 12, 'EUR', 'Aggiuntiva', ''],
      ],
    })
  const idOf = (book: ReturnType<typeof fakeBook>, description: string) => {
    const op = importFinanceSheets(book.tabs as RawSheets, { baseCurrency: 'EUR' }).dataset.operations.find((o) => o.description === description)!
    return { id: op.id, row: op.source.row }
  }

  it('corregge la riga, conserva le colonne non gestite e la rende una voce dell app', async () => {
    const book = sheet()
    const { id, row } = idOf(book, 'Conad')
    const r = await call(book, { action: 'row.replace', tab: 'Uscite', row, expectedId: id, op: { ...expense, id: 'm-fix001', date: '2025-12-09', description: 'Conad', amount: 597, category: 'Cibo', subcategory: 'Spesa', expenseType: 'necessary' } })
    expect(r.body).toMatchObject({ ok: true, updated: 1 })
    expect(book.tabs.Uscite).toHaveLength(3)
    expect(book.tabs.Uscite[1][8]).toBe('nota')
    const conad = importFinanceSheets(book.tabs as RawSheets, { baseCurrency: 'EUR' }).dataset.operations.find((o) => o.description === 'Conad')!
    expect(appEntryId(conad.id)).toBe('m-fix001')
    expect(conad).toMatchObject({ amount: 597, date: '2025-12-09' })
  })

  it('sposta la riga nell altra scheda se cambia tipo', async () => {
    const book = sheet()
    const { id, row } = idOf(book, 'Pizza')
    await call(book, { action: 'row.replace', tab: 'Uscite', row, expectedId: id, op: { ...expense, id: 'm-fix002', kind: 'income', expenseType: undefined, category: 'Rimborso' } })
    expect(book.tabs.Uscite).toHaveLength(2)
    expect(book.tabs.Entrate).toHaveLength(2)
  })

  it('elimina la riga indicata', async () => {
    const book = sheet()
    const { id, row } = idOf(book, 'Conad')
    const r = await call(book, { action: 'row.delete', tab: 'Uscite', row, expectedId: id })
    expect(r.body).toMatchObject({ ok: true, deleted: 1 })
    expect(book.tabs.Uscite.map((x) => x[4])).toEqual(['Descrizione', 'Pizza'])
  })

  it('non tocca nulla se la riga è cambiata dopo l ultima lettura', async () => {
    const book = sheet()
    const { id } = idOf(book, 'Conad')
    // La riga 2 adesso contiene un'altra voce (es. riga inserita sopra nel frattempo).
    const r = await call(book, { action: 'row.delete', tab: 'Uscite', row: 3, expectedId: id })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ ok: false, code: 'row_changed' })
    expect(book.tabs.Uscite).toHaveLength(3)
  })

  it('rifiuta l intestazione e schede non valide', async () => {
    const book = sheet()
    expect((await call(book, { action: 'row.delete', tab: 'Uscite', row: 1, expectedId: 'x' })).status).toBe(400)
    expect((await call(book, { action: 'row.delete', tab: '_planner', row: 2, expectedId: 'x' })).status).toBe(400)
  })
})

describe('configurazione sul foglio', () => {
  it('salva e rilegge la configurazione in una scheda nascosta, anche se grande', async () => {
    const book = fakeBook()
    const config = { config: { accounts: [], categories: [{ name: 'x'.repeat(90000) }] }, investments: {}, seeded: true }
    expect((await call(book, { action: 'config.get' })).body).toMatchObject({ ok: true, config: null, updatedAt: null })
    await call(book, { action: 'config.put', config, updatedAt: '2026-11-22T10:00:00.000Z' })
    expect(book.hidden.has('_planner')).toBe(true)
    expect(book.tabs._planner.length).toBeGreaterThan(2)
    const r = await call(book, { action: 'config.get' })
    expect(r.body).toEqual({ ok: true, config, updatedAt: '2026-11-22T10:00:00.000Z' })
  })
})
