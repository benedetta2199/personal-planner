import { describe, expect, it } from 'vitest'
import { parseStatementRows, reconcileStatements, suggestAccount, suggestEntry, type StatementRow } from '../reconciliation.js'
import type { Operation } from '../types.js'

const REVOLUT_HEADER = ['Tipo', 'Prodotto', 'Data di inizio', 'Data di completamento', 'Descrizione', 'Importo', 'Costo', 'Valuta', 'State', 'Saldo']

let n = 0
function op(partial: Partial<Operation> & Pick<Operation, 'kind' | 'date' | 'amount'>): Operation {
  n++
  const base = { id: `U-${n}`, account: 'Revolut', category: 'Cibo', subcategory: '', description: '', currency: 'EUR', extra: {}, source: { sheet: 'Uscite' as const, row: n + 1 } }
  if (partial.kind === 'transfer') return { ...base, toAccount: 'Conto', toCurrency: 'EUR', toAmount: partial.amount, ...partial } as Operation
  if (partial.kind === 'expense') return { ...base, expenseType: 'necessary', ...partial } as Operation
  return { ...base, ...partial } as Operation
}

function row(partial: Partial<StatementRow> & Pick<StatementRow, 'date' | 'amount'>): StatementRow {
  n++
  return { id: `s${n}`, row: n, provider: 'revolut', kind: 'expense', direction: 'out', account: 'Revolut', currency: 'EUR', description: '', status: 'COMPLETATO', ...partial }
}

describe('lettura degli estratti', () => {
  it('Revolut: data di inizio, solo completate, commissioni incluse, righe a zero ignorate', () => {
    const { records, issues } = parseStatementRows(
      [
        REVOLUT_HEADER,
        ['Pagamento con carta', 'Attuale', '2026-01-03 17:22:14', '2026-01-04 9:07:08', 'Conad', '-5.87', '0.10', 'EUR', 'COMPLETATO', '7'],
        ['Pagamento con carta', 'Attuale', '2026-01-05 10:00', '2026-01-05 10:00', 'Annullato', '-9', '0', 'EUR', 'REVERTED', '7'],
        ['Pagamento', 'Deposito', '2026-01-06', '2026-01-06', 'Closing transaction', '0', '0', 'EUR', 'COMPLETATO', '0'],
        ['Pagamento', 'Attuale', '2026-01-07', '2026-01-07', 'A EUR Conto vacanze', '-52.10', '0', 'EUR', 'COMPLETATO', '0'],
        ['Ricarica', 'Attuale', '2026-01-09', '2026-01-09', 'Ricarica di *0034', '200', '0', 'EUR', 'COMPLETATO', '200'],
      ],
      'revolut',
      'Revolut_spese_2026.csv',
    )
    expect(issues).toEqual([])
    expect(records.map((r) => [r.date, r.kind, r.direction, r.amount])).toEqual([
      ['2026-01-03', 'expense', 'out', 597],
      ['2026-01-07', 'transfer', 'out', 5210],
      ['2026-01-09', 'transfer', 'in', 20000],
    ])
  })

  it('Revolut: interessi dei salvadanai sommati per mese sul conto «Revolut Deposito»', () => {
    const { records } = parseStatementRows(
      [
        REVOLUT_HEADER,
        ['Interessi', 'Deposito', '2026-04-20', '2026-04-20', 'Interessi netti', '0.01', '0', 'EUR', 'COMPLETATO', '1'],
        ['Interessi', 'Deposito', '2026-04-21', '2026-04-21', 'Interessi netti', '0.02', '0', 'EUR', 'COMPLETATO', '1'],
        ['Interessi', 'Deposito', '2026-05-01', '2026-05-01', 'Interessi netti', '0.04', '0', 'EUR', 'COMPLETATO', '1'],
        ['Pagamento', 'Deposito', '2026-04-22', '2026-04-22', 'From Conto deposito', '200', '0', 'EUR', 'COMPLETATO', '1'],
      ],
      'revolut',
      'r.csv',
    )
    expect(records.map((r) => [r.account, r.date, r.amount, r.kind])).toEqual([
      ['Revolut Deposito', '2026-04-21', 3, 'income'],
      ['Revolut Deposito', '2026-05-01', 4, 'income'],
    ])
  })

  it('estratto depositi Revolut: importi con «€» corrotto e date «30 Apr 2026»', () => {
    const { records, issues } = parseStatementRows(
      [
        ['Data', 'Descrizione', 'Tasso di interesse lordo guadagnato', 'Entrate', 'Uscite', 'Saldo'],
        ['30 Apr 2026', 'Deposito sul conto "Conto vacanze"', '', '200,07â‚¬', '', '200,07â‚¬'],
        ['1 mag 2026', 'Interessi netti pagati', '2.00%', '0,01â‚¬', '', '200,08â‚¬'],
      ],
      'revolut-savings',
      'Revolut_deposito_2026.csv',
    )
    expect(issues).toEqual([])
    expect(records.map((r) => [r.date, r.kind, r.amount])).toEqual([
      ['2026-04-30', 'transfer', 20007],
      ['2026-05-01', 'income', 1],
    ])
  })

  it('Trade Republic: solo DEFAULT, niente Saveback, importo netto di fee e tasse', () => {
    const header = ['datetime', 'date', 'account_type', 'category', 'type', 'name', 'amount', 'fee', 'tax', 'currency', 'description', 'transaction_id']
    const { records } = parseStatementRows(
      [
        header,
        ['', '2026-05-02', 'DEFAULT', 'TRADING', 'BUY', 'MSCI World', '-100', '-1', '', 'EUR', 'Buy MSCI World', 't1'],
        ['', '2026-05-03', 'DEFAULT', 'TRADING', 'BENEFITS_SAVEBACK', 'MSCI World', '-2', '', '', 'EUR', 'Saveback', 't2'],
        ['', '2026-05-04', 'SAVINGS', 'CASH', 'CARD_TRANSACTION', '', '-3', '', '', 'EUR', 'x', 't3'],
        ['', '2026-05-31', 'DEFAULT', 'CASH', 'INTEREST_PAYMENT', '', '1.50', '', '-0.39', 'EUR', 'Interessi', 't4'],
      ],
      'trade-republic',
      'TradeRepublic_2026.csv',
    )
    expect(records.map((r) => [r.kind, r.expenseType, r.amount, r.description])).toEqual([
      ['expense', 'investment', 10100, 'MSCI World'],
      ['income', undefined, 111, 'Interessi Trade Republic 2026-05 (1 accrediti)'],
    ])
  })

  it('Satispay: solo operazioni approvate', () => {
    const { records } = parseStatementRows(
      [
        ['Data', 'Nome', 'Descrizione', 'Importo', 'Tipo', 'Stato', 'Disponibilità', 'Disponibilità dopo la transazione'],
        ['2026-03-01', 'Bar', '', '-1,50', 'Pagamento', '✅ Approvato', '20', '18,50'],
        ['2026-03-02', 'Bar', '', '-2', 'Pagamento', '❌ Annullato', '20', '18'],
      ],
      'satispay',
      'Satispay.xlsx',
    )
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ amount: 150, account: 'Satispay', direction: 'out' })
  })

  it('rifiuta un file di un altro formato', () => {
    const { records, issues } = parseStatementRows([['Data', 'Importo']], 'revolut', 'x.csv')
    expect(records).toEqual([])
    expect(issues[0].code).toBe('unsupported_format')
  })
})

describe('associazione dei conti', () => {
  const accounts = [{ name: 'Conto' }, { name: 'Revolut' }, { name: 'Revolut conto deposito' }, { name: 'Trade Republic', aliases: ['TradeRepublic'] }, { name: 'Satispay' }]
  it('usa nome, alias e parole chiave', () => {
    expect(suggestAccount('Revolut', accounts)).toBe('Revolut')
    expect(suggestAccount('Revolut Deposito', accounts)).toBe('Revolut conto deposito')
    expect(suggestAccount('Trade Republic', accounts)).toBe('Trade Republic')
    expect(suggestAccount('Satispay', [{ name: 'Satyspay', aliases: ['Satispay'] }])).toBe('Satyspay')
    expect(suggestAccount('Paypal', accounts)).toBe('')
  })
})

describe('confronto con il foglio', () => {
  it('corrispondenza, voce mancante nel foglio e voce mancante nell estratto', () => {
    const ops = [op({ kind: 'expense', date: '2026-03-01', amount: 290, description: 'Pedaggio' }), op({ kind: 'expense', date: '2026-03-02', amount: 1200, description: 'Pranzo' })]
    const rows = [row({ date: '2026-03-01', amount: 290, description: 'Autostrade' }), row({ date: '2026-03-02', amount: 4500, description: 'Benzina' })]
    const result = reconcileStatements(ops, rows)
    expect(result.map((i) => i.status).sort()).toEqual(['matched', 'missing_in_general', 'missing_in_statement'])
  })

  it('segnala importo diverso e data sfasata invece di accettarli in silenzio', () => {
    const ops = [op({ kind: 'expense', date: '2026-03-01', amount: 500, description: 'Caffetteria' }), op({ kind: 'expense', date: '2026-03-05', amount: 2000, description: 'Cena' })]
    const rows = [row({ date: '2026-03-01', amount: 550, description: 'Caffetteria' }), row({ date: '2026-03-07', amount: 2000, description: 'Ristorante' })]
    const byStatus = Object.fromEntries(reconcileStatements(ops, rows).map((i) => [i.status, i]))
    expect(byStatus.amount_mismatch).toMatchObject({ amountDifference: 50 })
    expect(byStatus.date_mismatch).toMatchObject({ dateDifference: 2 })
  })

  it('riconosce divisioni e somme', () => {
    const ops = [
      op({ kind: 'expense', date: '2026-03-01', amount: 3000, category: 'Cibo' }),
      op({ kind: 'expense', date: '2026-03-01', amount: 1000, category: 'Casa' }),
      op({ kind: 'expense', date: '2026-03-10', amount: 450, description: 'Caffè settimana' }),
    ]
    const rows = [
      row({ date: '2026-03-01', amount: 4000, description: 'Esselunga' }),
      row({ date: '2026-03-10', amount: 150 }),
      row({ date: '2026-03-10', amount: 300 }),
    ]
    const result = reconcileStatements(ops, rows)
    expect(result.map((i) => [i.status, i.statements.length, i.sides.length])).toEqual([
      ['matched_group', 1, 2],
      ['matched_group', 2, 1],
    ])
  })

  it('un trasferimento corrisponde sia all uscita sia all entrata, sui due conti', () => {
    const ops = [op({ kind: 'transfer', date: '2026-01-07', amount: 5210, account: 'Revolut', toAccount: 'Revolut Deposito' } as Partial<Operation> & Pick<Operation, 'kind' | 'date' | 'amount'>)]
    const rows = [row({ date: '2026-01-07', amount: 5210, kind: 'transfer' }), row({ date: '2026-01-07', amount: 5210, kind: 'transfer', direction: 'in', account: 'Revolut Deposito' })]
    expect(reconcileStatements(ops, rows).map((i) => [i.status, i.sides[0]?.direction])).toEqual([
      ['matched', 'out'],
      ['matched', 'in'],
    ])
  })

  it('non abbina entrate e uscite né movimenti di altri conti o fuori periodo', () => {
    const ops = [
      op({ kind: 'income', date: '2026-03-01', amount: 500 }),
      op({ kind: 'expense', date: '2026-03-01', amount: 500, account: 'Satispay' }),
      op({ kind: 'expense', date: '2025-01-01', amount: 999 }),
    ]
    const result = reconcileStatements(ops, [row({ date: '2026-03-01', amount: 500 })])
    expect(result.map((i) => i.status)).toEqual(['missing_in_general', 'missing_in_statement'])
    expect(result[1].sides[0].op.kind).toBe('income')
  })

  it('propone categoria e tipologia dal movimento simile più recente', () => {
    const ops = [
      op({ kind: 'expense', date: '2026-01-01', amount: 100, description: 'Conad', category: 'Cibo', subcategory: 'Spesa', expenseType: 'necessary' } as Partial<Operation> & Pick<Operation, 'kind' | 'date' | 'amount'>),
      op({ kind: 'transfer', date: '2026-01-02', amount: 100, description: 'A EUR Conto vacanze', account: 'Revolut', toAccount: 'Vacanze' } as Partial<Operation> & Pick<Operation, 'kind' | 'date' | 'amount'>),
    ]
    expect(suggestEntry(row({ date: '2026-02-01', amount: 587, description: 'CONAD SUPERSTORE' }), ops)).toMatchObject({ kind: 'expense', category: 'Cibo', subcategory: 'Spesa', expenseType: 'necessary', amount: 587 })
    expect(suggestEntry(row({ date: '2026-02-01', amount: 200, kind: 'transfer', description: 'A EUR Conto vacanze' }), ops)).toMatchObject({ kind: 'transfer', account: 'Revolut', toAccount: 'Vacanze' })
    expect(suggestEntry(row({ date: '2026-02-01', amount: 200, description: 'Mai visto' }), ops)).toMatchObject({ kind: 'expense', category: '', expenseType: 'additional' })
  })
})
