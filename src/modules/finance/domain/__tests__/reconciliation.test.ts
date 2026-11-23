import { describe, expect, it } from 'vitest'
import { parseLedgerRows, parseStatementRows, reconcileStatements } from '../reconciliation.js'

describe('local file reconciliation', () => {
  it('normalizza il file generale, riconosce row_id e pulisce le emoji delle categorie', () => {
    const result = parseLedgerRows([
      ['Giorno', 'Tipo', 'Tipo_spesa', 'Conto', 'Conto_dest', 'Categoria', 'Sotto-categoria', 'Importo', 'Valuta', 'Descrizione', 'row_id'],
      ['2026-03-01 10:00', 'Spesa', 'Desiderio', 'Revolut', '', '🚖 Trasporti', '⭕ Autostrada', '2.90', 'EUR', 'Pedaggio', 'r-1'],
    ])

    expect(result.issues).toHaveLength(0)
    expect(result.records[0]).toMatchObject({
      id: 'r-1',
      kind: 'expense',
      expenseType: 'additional',
      category: 'Trasporti',
      subcategory: 'Autostrada',
    })
    expect(result.categories).toEqual([{ name: 'Trasporti', subcategories: ['Autostrada'] }])
  })

  it('legge un estratto Revolut con date/valori canonici e segnala righe non valide', () => {
    const result = parseStatementRows(
      [
        ['Tipo', 'Prodotto', 'Data di inizio', 'Data di completamento', 'Descrizione', 'Importo', 'Costo', 'Valuta', 'State', 'Saldo'],
        ['Pagamento con carta', 'Attuale', '2026-03-01 10:00', '2026-03-01 10:01', 'Pedaggio', '-2.90', '0', 'EUR', 'COMPLETATO', '10'],
        ['Pagamento', 'Attuale', '', '', 'Riga senza data', '2', '0', 'EUR', 'COMPLETATO', '12'],
      ],
      'revolut',
      'Revolut_spese_2026.csv',
    )

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ date: '2026-03-01', kind: 'expense', amount: 290, account: 'Revolut' })
    expect(result.issues).toMatchObject([{ code: 'invalid_statement_row', severity: 'error' }])
  })

  it('riconosce una corrispondenza e un addebito mancante nel file generale', () => {
    const ledger = parseLedgerRows([
      ['Giorno', 'Tipo', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'row_id'],
      ['2026-03-01', 'Spesa', 'Revolut', 'Trasporti', 'Autostrada', 'Pedaggio', '2.90', 'EUR', 'l-1'],
      ['2026-03-01', 'Spesa', 'Revolut', 'Cibo', 'Pranzo', 'Pranzo', '12', 'EUR', 'l-2'],
    ])
    const statement = parseStatementRows(
      [
        ['Tipo', 'Prodotto', 'Data di inizio', 'Data di completamento', 'Descrizione', 'Importo', 'Costo', 'Valuta', 'State', 'Saldo'],
        ['Pagamento con carta', 'Attuale', '2026-03-01', '2026-03-01', 'Pedaggio', '-2.90', '0', 'EUR', 'COMPLETATO', '10'],
      ],
      'revolut',
      'Revolut.csv',
    )

    const result = reconcileStatements(ledger.records, statement.records)
    expect(result.map((item) => item.status)).toEqual(['matched', 'missing_in_statement'])
  })

  it('segnala un importo diverso invece di considerarlo una corrispondenza', () => {
    const ledger = parseLedgerRows([
      ['Giorno', 'Tipo', 'Conto', 'Descrizione', 'Importo', 'Valuta'],
      ['2026-03-01', 'Spesa', 'Satispay', 'Caffetteria', '5', 'EUR'],
    ])
    const statement = parseStatementRows(
      [
        ['Data', 'Nome', 'Descrizione', 'Importo', 'Tipo', 'Stato', 'Disponibilità', 'Disponibilità dopo la transazione'],
        ['2026-03-01', 'Caffetteria', 'Caffetteria', '-5,50', 'Pagamento', 'Completato', '20', '14,50'],
      ],
      'satispay',
      'Satispay.xlsx',
    )

    expect(reconcileStatements(ledger.records, statement.records)[0]).toMatchObject({
      status: 'amount_mismatch',
      amountDifference: 50,
    })
  })
})
