/**
 * Regole di calcolo finanziario — UNICO punto in cui sono definite.
 *
 * Classificazione:
 *  - Entrata                → +importo sul conto. Conta come entrata.
 *  - Uscita Necessaria      → −importo sul conto. Conta come spesa (consumo).
 *  - Uscita Aggiuntiva      → −importo sul conto. Conta come spesa (consumo).
 *  - Uscita Investimento    → −importo sul conto. NON è consumo: è capitale
 *                             allocato a un asset esterno, che resta nel
 *                             patrimonio al valore di carico.
 *  - Trasferimento          → −importo sul conto origine, +importo convertito
 *                             sul conto destinazione. Mai entrata né spesa.
 *                             Se va da liquidità a un conto investimento conta
 *                             come capitale investito (e viceversa come disinvestimento).
 *
 * Patrimonio = liquidità (saldi conti liquidità)
 *            + investimenti (saldi conti investimento — o valore di mercato se
 *              dichiarato — + investimenti esterni al costo).
 * Nessun movimento viene contato due volte: ogni operazione ha un solo FlowType.
 */
import { convert } from './money.js'
import type {
  Account,
  AccountType,
  Cents,
  CurrencyCode,
  FinanceDataset,
  FlowType,
  IsoDate,
  Operation,
} from './types.js'

export function flowTypeOf(op: Operation): FlowType {
  if (op.kind === 'income') return 'income'
  if (op.kind === 'transfer') return 'transfer'
  return op.expenseType
}

export interface AccountEffect {
  account: string
  amount: Cents // con segno
  currency: CurrencyCode
}

/** Effetto di un'operazione sui saldi dei conti. */
export function accountEffects(op: Operation): AccountEffect[] {
  switch (op.kind) {
    case 'income':
      return [{ account: op.account, amount: op.amount, currency: op.currency }]
    case 'expense':
      return [{ account: op.account, amount: -op.amount, currency: op.currency }]
    case 'transfer':
      return [
        { account: op.account, amount: -op.amount, currency: op.currency },
        { account: op.toAccount, amount: op.toAmount, currency: op.toCurrency },
      ]
  }
}

/** Accumulatore in valuta base che tiene traccia delle valute non convertibili. */
export class BaseTotal {
  value: Cents = 0
  readonly missing = new Set<CurrencyCode>()
  constructor(private readonly ds: Pick<FinanceDataset, 'baseCurrency' | 'rates'>) {}
  add(amount: Cents, currency: CurrencyCode): void {
    const v = convert(amount, currency, this.ds.baseCurrency, this.ds.rates)
    if (v === null) this.missing.add(currency)
    else this.value += v
  }
}

export const toBase = (ds: Pick<FinanceDataset, 'baseCurrency' | 'rates'>, amount: Cents, currency: CurrencyCode): Cents | null =>
  convert(amount, currency, ds.baseCurrency, ds.rates)

export function accountIndex(ds: FinanceDataset): Map<string, Account> {
  return new Map(ds.accounts.map((a) => [a.name, a]))
}

const typeOf = (idx: Map<string, Account>, name: string): AccountType => idx.get(name)?.type ?? 'liquidity'

// ---------------------------------------------------------------------------
// Flussi (rispettano tutti i filtri)
// ---------------------------------------------------------------------------

export interface FlowSummary {
  income: Cents
  necessary: Cents
  additional: Cents
  /** Spese di consumo: necessarie + aggiuntive. */
  expenses: Cents
  /** Capitale investito netto nel periodo. */
  invested: Cents
  investedViaExpenses: Cents
  investedViaTransfers: Cents
  /** Volume dei trasferimenti (informativo, non entra nei totali). */
  transferVolume: Cents
  /** Entrate − spese di consumo. */
  savings: Cents
  /** Entrate − spese − investimenti: variazione della liquidità. */
  netCashflow: Cents
  savingsRate: number | null
  operationCount: number
  missingRates: CurrencyCode[]
}

export function computeFlowSummary(ds: FinanceDataset, ops: Operation[]): FlowSummary {
  const idx = accountIndex(ds)
  const t = {
    income: new BaseTotal(ds),
    necessary: new BaseTotal(ds),
    additional: new BaseTotal(ds),
    invExp: new BaseTotal(ds),
    invTr: new BaseTotal(ds),
    transfers: new BaseTotal(ds),
  }
  for (const op of ops) {
    switch (flowTypeOf(op)) {
      case 'income': t.income.add(op.amount, op.currency); break
      case 'necessary': t.necessary.add(op.amount, op.currency); break
      case 'additional': t.additional.add(op.amount, op.currency); break
      case 'investment': t.invExp.add(op.amount, op.currency); break
      case 'transfer': {
        const tr = op as Extract<Operation, { kind: 'transfer' }>
        t.transfers.add(tr.amount, tr.currency)
        const from = typeOf(idx, tr.account)
        const to = typeOf(idx, tr.toAccount)
        if (from === 'liquidity' && to === 'investment') t.invTr.add(tr.amount, tr.currency)
        else if (from === 'investment' && to === 'liquidity') t.invTr.add(-tr.toAmount, tr.toCurrency)
        break
      }
    }
  }
  const expenses = t.necessary.value + t.additional.value
  const invested = t.invExp.value + t.invTr.value
  const savings = t.income.value - expenses
  const missing = new Set<CurrencyCode>()
  Object.values(t).forEach((b) => b.missing.forEach((c) => missing.add(c)))
  return {
    income: t.income.value,
    necessary: t.necessary.value,
    additional: t.additional.value,
    expenses,
    invested,
    investedViaExpenses: t.invExp.value,
    investedViaTransfers: t.invTr.value,
    transferVolume: t.transfers.value,
    savings,
    netCashflow: savings - invested,
    savingsRate: t.income.value > 0 ? savings / t.income.value : null,
    operationCount: ops.length,
    missingRates: [...missing],
  }
}

// ---------------------------------------------------------------------------
// Saldi e patrimonio (rispettano solo data finale e filtro conti)
// ---------------------------------------------------------------------------

export interface AccountBalance {
  account: Account
  /** Saldo contabile nella valuta del conto. */
  balance: Cents
  balanceBase: Cents | null
  /** Valore considerato nel patrimonio (mercato se disponibile e pertinente). */
  valueBase: Cents | null
  usesMarketValue: boolean
  operationCount: number
  lastDate: IsoDate | null
}

export interface BalanceOptions {
  /** Considera solo le operazioni fino a questa data (inclusa). */
  asOf?: IsoDate
  /** Usa il valore di mercato dichiarato per i conti di investimento. */
  useMarketValue?: boolean
}

export function computeAccountBalances(ds: FinanceDataset, options: BalanceOptions = {}): AccountBalance[] {
  const { asOf, useMarketValue = !asOf } = options
  const state = new Map<string, { balance: Cents; count: number; last: IsoDate | null }>()
  for (const a of ds.accounts) state.set(a.name, { balance: a.openingBalance, count: 0, last: null })
  const idx = accountIndex(ds)

  for (const op of ds.operations) {
    if (asOf && op.date > asOf) continue
    for (const e of accountEffects(op)) {
      const s = state.get(e.account)
      const acc = idx.get(e.account)
      if (!s || !acc) continue
      const converted = convert(e.amount, e.currency, acc.currency, ds.rates)
      // Senza tasso l'effetto non può essere riportato sul saldo: viene ignorato
      // (l'importatore ha già segnalato il tasso mancante).
      if (converted !== null) s.balance += converted
      s.count++
      s.last = op.date
    }
  }

  return ds.accounts.map((account) => {
    const s = state.get(account.name)!
    const balanceBase = toBase(ds, s.balance, account.currency)
    const market = useMarketValue && account.type === 'investment' && account.marketValue !== undefined
    const valueBase = market ? toBase(ds, account.marketValue!, account.currency) : balanceBase
    return { account, balance: s.balance, balanceBase, valueBase, usesMarketValue: market, operationCount: s.count, lastDate: s.last }
  })
}

export interface NetWorth {
  liquidity: Cents
  investmentAccounts: Cents
  /** Uscite "Investimento" cumulate, al costo. */
  externalInvestments: Cents
  investments: Cents
  netWorth: Cents
  /** Somma dei saldi contabili (senza valore di mercato). */
  investmentBookValue: Cents
  unrealizedGain: Cents
  missingRates: CurrencyCode[]
}

export function computeNetWorth(ds: FinanceDataset, balances: AccountBalance[], options: BalanceOptions & { accounts?: string[] } = {}): NetWorth {
  const selected = options.accounts?.length ? new Set(options.accounts) : null
  const missing = new Set<CurrencyCode>()
  let liquidity = 0
  let invAccounts = 0
  let invBook = 0
  for (const b of balances) {
    if (selected && !selected.has(b.account.name)) continue
    if (b.valueBase === null || b.balanceBase === null) {
      missing.add(b.account.currency)
      continue
    }
    if (b.account.type === 'liquidity') liquidity += b.valueBase
    else {
      invAccounts += b.valueBase
      invBook += b.balanceBase
    }
  }
  const external = new BaseTotal(ds)
  for (const op of ds.operations) {
    if (op.kind !== 'expense' || op.expenseType !== 'investment') continue
    if (options.asOf && op.date > options.asOf) continue
    if (selected && !selected.has(op.account)) continue
    external.add(op.amount, op.currency)
  }
  external.missing.forEach((c) => missing.add(c))
  const investments = invAccounts + external.value
  return {
    liquidity,
    investmentAccounts: invAccounts,
    externalInvestments: external.value,
    investments,
    netWorth: liquidity + investments,
    investmentBookValue: invBook + external.value,
    unrealizedGain: invAccounts - invBook,
    missingRates: [...missing],
  }
}

// ---------------------------------------------------------------------------
// Serie temporali
// ---------------------------------------------------------------------------

export type MonthKey = string // YYYY-MM

export const monthOf = (date: IsoDate): MonthKey => date.slice(0, 7)

export function monthRange(from: MonthKey, to: MonthKey, maxMonths = 240): MonthKey[] {
  const out: MonthKey[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while ((y < ty || (y === ty && m <= tm)) && out.length < maxMonths) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

export const monthEnd = (month: MonthKey): IsoDate => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(d).padStart(2, '0')}`
}

export interface MonthlyFlow {
  month: MonthKey
  income: Cents
  necessary: Cents
  additional: Cents
  invested: Cents
  savings: Cents
}

export function computeMonthlyFlows(ds: FinanceDataset, ops: Operation[], months: MonthKey[]): MonthlyFlow[] {
  const groups = new Map<MonthKey, Operation[]>(months.map((m) => [m, []]))
  for (const op of ops) groups.get(monthOf(op.date))?.push(op)
  return months.map((month) => {
    const s = computeFlowSummary(ds, groups.get(month)!)
    return { month, income: s.income, necessary: s.necessary, additional: s.additional, invested: s.invested, savings: s.savings }
  })
}

export interface BalancePoint {
  month: MonthKey
  liquidity: Cents
  investments: Cents
  byAccount: Record<string, Cents | null>
}

/**
 * Saldo di fine mese per conto (in valuta base, ai tassi correnti) e
 * scomposizione del patrimonio tra liquidità e investimenti (valore di carico).
 */
export function computeBalanceSeries(ds: FinanceDataset, months: MonthKey[], accounts?: string[]): BalancePoint[] {
  const selected = accounts?.length ? new Set(accounts) : null
  const idx = accountIndex(ds)
  const balances = new Map<string, Cents>(ds.accounts.map((a) => [a.name, a.openingBalance]))
  let external = 0
  let i = 0
  const ops = ds.operations
  const points: BalancePoint[] = []
  for (const month of months) {
    const end = monthEnd(month)
    while (i < ops.length && ops[i].date <= end) {
      const op = ops[i++]
      for (const e of accountEffects(op)) {
        const acc = idx.get(e.account)
        if (!acc) continue
        const v = convert(e.amount, e.currency, acc.currency, ds.rates)
        if (v !== null) balances.set(e.account, (balances.get(e.account) ?? 0) + v)
      }
      if (op.kind === 'expense' && op.expenseType === 'investment' && (!selected || selected.has(op.account))) {
        external += toBase(ds, op.amount, op.currency) ?? 0
      }
    }
    const byAccount: Record<string, Cents | null> = {}
    let liquidity = 0
    let investments = external
    for (const acc of ds.accounts) {
      if (selected && !selected.has(acc.name)) continue
      const v = toBase(ds, balances.get(acc.name) ?? 0, acc.currency)
      byAccount[acc.name] = v
      if (v === null) continue
      if (acc.type === 'liquidity') liquidity += v
      else investments += v
    }
    points.push({ month, liquidity, investments, byAccount })
  }
  return points
}

// ---------------------------------------------------------------------------
// Categorie
// ---------------------------------------------------------------------------

export interface SubcategoryTotal {
  name: string
  total: Cents
  count: number
}

export interface CategoryTotal {
  name: string
  total: Cents
  count: number
  subcategories: SubcategoryTotal[]
}

export const NO_SUBCATEGORY = '—'

/** Totali per categoria/sotto-categoria (in valuta base) per i tipi di flusso indicati. */
export function computeCategoryBreakdown(ds: FinanceDataset, ops: Operation[], flowTypes: FlowType[]): CategoryTotal[] {
  const wanted = new Set(flowTypes)
  const cats = new Map<string, { total: Cents; count: number; subs: Map<string, SubcategoryTotal> }>()
  for (const op of ops) {
    if (!wanted.has(flowTypeOf(op))) continue
    const v = toBase(ds, op.amount, op.currency)
    if (v === null) continue
    let c = cats.get(op.category)
    if (!c) cats.set(op.category, (c = { total: 0, count: 0, subs: new Map() }))
    c.total += v
    c.count++
    const subName = op.subcategory || NO_SUBCATEGORY
    let s = c.subs.get(subName)
    if (!s) c.subs.set(subName, (s = { name: subName, total: 0, count: 0 }))
    s.total += v
    s.count++
  }
  return [...cats.entries()]
    .map(([name, c]) => ({ name, total: c.total, count: c.count, subcategories: [...c.subs.values()].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total)
}
