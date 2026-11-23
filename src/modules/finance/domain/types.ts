/**
 * Modello dati del modulo Finanze.
 *
 * Convenzioni:
 * - Tutti gli importi sono interi in unità minori (centesimi) per evitare errori
 *   di arrotondamento nelle somme. La conversione in unità avviene solo in UI.
 * - Gli importi delle operazioni sono sempre positivi: il segno è dato dal tipo
 *   di operazione (vedi `calculations.ts`, unico punto in cui vive la logica).
 * - Le date sono stringhe ISO `YYYY-MM-DD` (nessun fuso orario).
 */

export type CurrencyCode = string
export type Cents = number
export type IsoDate = string

export type AccountType = 'liquidity' | 'investment'

export interface Account {
  name: string
  type: AccountType
  currency: CurrencyCode
  /** Saldo iniziale nella valuta del conto. */
  openingBalance: Cents
  /** Valore di mercato attuale (solo conti di investimento, facoltativo). */
  marketValue?: Cents
  /** Etichetta libera dal foglio Conti (es. "Carta", "Broker"). */
  label?: string
  /** true se definito nel foglio Conti, false se dedotto dalle operazioni. */
  declared: boolean
}

export type OperationKind = 'income' | 'expense' | 'transfer'
export type ExpenseType = 'necessary' | 'additional' | 'investment'

/** Classificazione finanziaria univoca di ogni operazione. */
export type FlowType = 'income' | 'necessary' | 'additional' | 'investment' | 'transfer'

export const FLOW_TYPES: readonly FlowType[] = ['income', 'necessary', 'additional', 'investment', 'transfer']

export type SheetName = 'Entrate' | 'Uscite' | 'Transazioni' | 'Conti' | 'Valute'

export interface SourceRef {
  /** `Manuale` = voce inserita dall'app (vedi `ledger.ts`). */
  sheet: SheetName | 'Manuale'
  /** Numero di riga come appare in Google Sheets (1-based). */
  row: number
}

interface OperationBase {
  id: string
  date: IsoDate
  account: string
  category: string
  subcategory: string
  description: string
  amount: Cents
  currency: CurrencyCode
  /** Colonne aggiuntive non mappate, conservate così come sono. */
  extra: Record<string, string>
  source: SourceRef
}

export interface IncomeOperation extends OperationBase {
  kind: 'income'
  incomeSource?: string
  recurrence?: string
}

export interface ExpenseOperation extends OperationBase {
  kind: 'expense'
  expenseType: ExpenseType
}

export interface TransferOperation extends OperationBase {
  kind: 'transfer'
  toAccount: string
  toCurrency: CurrencyCode
  /** Importo accreditato sul conto di destinazione, in `toCurrency`. */
  toAmount: Cents
}

export type Operation = IncomeOperation | ExpenseOperation | TransferOperation

/** Tassi di cambio: 1 unità di valuta = `rate` unità di valuta base. */
export type ExchangeRates = Record<CurrencyCode, number>

export interface FinanceDataset {
  baseCurrency: CurrencyCode
  rates: ExchangeRates
  accounts: Account[]
  operations: Operation[]
}

export type IssueSeverity = 'error' | 'warning'

export interface ImportIssue {
  severity: IssueSeverity
  sheet: SheetName
  row?: number
  column?: string
  code: string
  message: string
}

export interface SheetStats {
  sheet: SheetName
  present: boolean
  rowsRead: number
  imported: number
  skipped: number
  duplicates: number
}

export interface ImportResult {
  dataset: FinanceDataset
  issues: ImportIssue[]
  stats: SheetStats[]
}

/** Contenuto grezzo dei fogli: righe di celle, prima riga = intestazione. */
export type RawSheets = Partial<Record<SheetName, unknown[][]>>

/** Risposta dell'endpoint `/api/finance/sync`. */
export type SyncResponse =
  | ({ ok: true; fetchedAt: string; spreadsheetTitle?: string } & ImportResult)
  | { ok: false; code: string; message: string }
