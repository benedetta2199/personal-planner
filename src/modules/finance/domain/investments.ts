/**
 * Posizioni di investimento ricavate dal bilancio.
 *
 * - Acquisto = uscita di tipologia «Investimento»; la posizione è identificata
 *   da categoria␟sotto-categoria (es. «📈 Investimenti ETF␟MSCI World»).
 * - Vendita  = entrata con la stessa categoria/sotto-categoria di una posizione.
 * - Il foglio registra importi, non quote: con un ticker collegato le quote
 *   si stimano dividendo ogni acquisto per la chiusura di quel giorno. Le
 *   vendite riducono quote e costo in proporzione (costo medio).
 * - Senza ticker la posizione è valutata al costo.
 */
import { toBase } from './calculations.js'
import { subKey } from './filters.js'
import type { Cents, FinanceDataset, IsoDate, Operation } from './types.js'
import type { InstrumentType, InvestmentConfig } from './ledger.js'

export interface QuoteSeries {
  symbol: string
  name: string
  /** Valuta originale del titolo (prima della conversione). */
  currency: string
  /** Ultimo prezzo, in valuta base. */
  price: number
  /** Chiusura del giorno di borsa precedente, in valuta base. */
  previousClose: number | null
  /** Data (YYYY-MM-DD) dell'ultimo prezzo. */
  priceDate: string
  /** Chiusure giornaliere [data, prezzo in valuta base], in ordine crescente. */
  history: [string, number][]
}

export interface SymbolMatch {
  symbol: string
  name: string
  exchange: string
  type: string
  /** Quotazione trovata direttamente cercando l'ISIN (non tramite il nome del fondo). */
  isinMatch?: boolean
  /** Borsa che quota in euro (Milano, Xetra, Amsterdam, Parigi…). */
  eur?: boolean
}

/** Prezzo alla data (o all'ultima chiusura precedente; prima dello storico, la prima disponibile). */
export function valueAt(history: [string, number][], date: string): number | null {
  if (!history.length) return null
  if (date < history[0][0]) return history[0][1]
  let lo = 0
  let hi = history.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (history[mid][0] <= date) lo = mid
    else hi = mid - 1
  }
  return history[lo][1]
}

interface PositionEvent {
  date: IsoDate
  kind: 'buy' | 'sell'
  amount: Cents // valuta base
  /** Voce da cui nasce l'evento (per aprirla e modificarla). */
  opId?: string
  /** Acquisto pagato da un saveback (non è denaro uscito di tasca). */
  saveback?: boolean
}

/**
 * Saveback: acquisto senza commissioni pagato dal broker (non da te). Si registra con due voci
 * sullo stesso conto — un'entrata «Saveback» e un'uscita «Investimento» sulla posizione — così il
 * saldo del conto non cambia, l'investimento cresce e il premio conta come entrata.
 * Le voci hanno ID «m-sb-…» (anche quando rilette dal foglio: «Uscite:m-sb-…»).
 */
export const isSavebackId = (id: string | undefined) => !!id && /(^|:)m-sb-/.test(id)

export interface PositionGroup {
  key: string
  category: string
  name: string
  events: PositionEvent[]
}

// ---------------------------------------------------------------------------
// Acquisti con commissione
// ---------------------------------------------------------------------------

/** Commissione per operazione, in centesimi: ETF gratuiti, azioni e obbligazioni 1 €. */
export const TRANSACTION_FEE_CENTS: Record<InstrumentType, number> = { etf: 0, stock: 100, bond: 100 }

/**
 * Divide l'importo addebitato sul conto tra capitale investito e commissione.
 * Es. 10 € su un'azione → 9 € sull'azione + 1 € di commissione; 10 € su un ETF → 10 € sull'ETF.
 */
export function splitPurchase(totalCents: number, type: InstrumentType, feeCents: number = TRANSACTION_FEE_CENTS[type]): { invested: number; fee: number } | null {
  if (!Number.isInteger(totalCents) || !Number.isInteger(feeCents) || feeCents < 0 || totalCents <= feeCents) return null
  return { invested: totalCents - feeCents, fee: feeCents }
}

/** Raggruppa acquisti e vendite per posizione. */
export function groupInvestmentOps(ds: FinanceDataset, ops: Operation[] = ds.operations): PositionGroup[] {
  const buys = ops.filter((o) => o.kind === 'expense' && o.expenseType === 'investment')
  const keys = new Set(buys.map((o) => subKey(o.category, o.subcategory)))
  const groups = new Map<string, PositionGroup>()
  for (const o of ops) {
    const key = subKey(o.category, o.subcategory)
    const isBuy = o.kind === 'expense' && o.expenseType === 'investment'
    const isSell = o.kind === 'income' && keys.has(key)
    if (!isBuy && !isSell) continue
    const amount = toBase(ds, o.amount, o.currency)
    if (amount === null) continue
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, category: o.category, name: o.subcategory || o.category, events: [] }))
    g.events.push({ date: o.date, kind: isBuy ? 'buy' : 'sell', amount, opId: o.id, saveback: isBuy && isSavebackId(o.id) })
  }
  for (const g of groups.values()) g.events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'buy' ? -1 : 1))
  return [...groups.values()]
}

/** Gli importi sono in centesimi, i prezzi in unità di valuta. */
const CENTS = 100

interface ReplayState {
  units: number
  cost: number
  realized: number
}

/** Rigioca gli eventi fino a `until` (inclusa). Con `price` null la posizione è al costo. */
function replay(events: PositionEvent[], price: ((d: IsoDate) => number | null) | null, until?: IsoDate): ReplayState {
  const s: ReplayState = { units: 0, cost: 0, realized: 0 }
  for (const e of events) {
    if (until && e.date > until) break
    const p = price?.(e.date) ?? null
    if (e.kind === 'buy') {
      s.cost += e.amount
      if (p) s.units += e.amount / CENTS / p
      continue
    }
    // Vendita: quota della posizione liquidata.
    let frac = p && s.units > 0 ? Math.min(1, e.amount / CENTS / p / s.units) : s.cost > 0 ? Math.min(1, e.amount / s.cost) : 0
    if (frac > 0.97) frac = 1 // "vendita 100%": gli scostamenti di prezzo non lasciano residui
    const basisOut = s.cost * frac
    s.realized += e.amount - basisOut
    s.cost -= basisOut
    s.units *= 1 - frac
  }
  return s
}

// ---------------------------------------------------------------------------
// Obbligazioni: valutazione autonoma (senza bisogno di quotazioni)
// ---------------------------------------------------------------------------

const DAY_MS = 86400000
const dayNum = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`) / DAY_MS
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

/** Date di stacco cedola che racchiudono `date` (calcolate a ritroso dalla scadenza). */
export function couponPeriod(maturity: IsoDate, frequency: number, date: IsoDate): { prev: IsoDate; next: IsoDate } {
  const step = 12 / frequency
  let next = maturity
  for (let k = 1; k <= 2400; k++) {
    const prev = addMonths(maturity, -step * k)
    if (prev <= date) return { prev, next }
    next = prev
  }
  return { prev: date, next }
}

/** Rateo di cedola maturato (in unità di valuta) su `nominal` alla data. */
export function accruedInterest(nominal: number, couponPct: number, frequency: number, maturity: IsoDate, date: IsoDate): number {
  if (!couponPct || date >= maturity) return 0
  const { prev, next } = couponPeriod(maturity, frequency, date)
  const frac = (dayNum(date) - dayNum(prev)) / Math.max(1, dayNum(next) - dayNum(prev))
  return nominal * (couponPct / 100 / frequency) * frac
}

interface BondModel {
  /** Valore (centesimi) della parte posseduta, dato il costo residuo a quella data. */
  valueAt: (date: IsoDate, costAtDate: number) => number
  pricePctAt: (date: IsoDate) => number
  accruedAt: (date: IsoDate, costAtDate: number) => number
}

/**
 * Modello obbligazione: valore = corso secco × nominale + rateo.
 * Corso secco: quotazione se disponibile, altrimenti si muove linearmente dal
 * prezzo d'acquisto a 100 alla scadenza (pull-to-par). Alla scadenza vale il nominale.
 */
function bondModel(cfg: InvestmentConfig, firstBuy: IsoDate, costNow: number, quote?: QuoteSeries): BondModel | null {
  if (!cfg.maturity || !cfg.couponFrequency || cfg.coupon === null || cfg.coupon === undefined) return null
  const buy = cfg.buyPrice ?? 100
  const maturity = cfg.maturity
  const coupon = cfg.coupon
  const frequency = cfg.couponFrequency
  // Nominale posseduto oggi (centesimi); se non indicato, si ricava dal costo.
  const nominalNow = cfg.nominal ? cfg.nominal * CENTS : costNow / (buy / 100)
  const nominalAt = (costAtDate: number) => (costNow > 0 ? (nominalNow * costAtDate) / costNow : 0)
  const pricePctAt = (date: IsoDate) => {
    if (quote) return valueAt(quote.history, date) ?? quote.price
    if (date >= maturity) return 100
    const span = dayNum(maturity) - dayNum(firstBuy)
    const t = span > 0 ? Math.min(1, Math.max(0, (dayNum(date) - dayNum(firstBuy)) / span)) : 1
    return buy + (100 - buy) * t
  }
  const accruedAt = (date: IsoDate, costAtDate: number) => accruedInterest(nominalAt(costAtDate), coupon, frequency, maturity, date)
  return {
    pricePctAt,
    accruedAt,
    valueAt: (date, costAtDate) => {
      const n = nominalAt(costAtDate)
      if (date >= maturity) return n
      return (n * pricePctAt(date)) / 100 + accruedAt(date, costAtDate)
    },
  }
}

// ---------------------------------------------------------------------------
// Posizioni
// ---------------------------------------------------------------------------

export interface Position {
  key: string
  category: string
  name: string
  type: InstrumentType
  ticker: string | null
  isin: string | null
  quoteName: string | null
  /** tracked = valutata ogni giorno; needs-data = mancano i dati dello strumento. */
  status: 'tracked' | 'needs-data' | 'error' | 'pending'
  error?: string
  buys: number
  sells: number
  /** Totale acquistato (lordo). */
  invested: Cents
  /** Totale incassato dalle vendite. */
  withdrawn: Cents
  /** Costo della parte ancora posseduta. */
  costBasis: Cents
  realized: Cents
  units: number | null
  unitsManual: boolean
  /** Prezzo unitario (ETF/azioni) o corso in % del nominale (obbligazioni). */
  price: number | null
  priceIsPct: boolean
  priceDate: string | null
  /** Obbligazioni: rateo di cedola maturato (centesimi). */
  accrued: Cents | null
  maturity: string | null
  matured: boolean
  value: Cents
  unrealized: Cents | null
  unrealizedPct: number | null
  dayChange: Cents | null
  dayChangePct: number | null
  /** Parte dell'investito arrivata da saveback (non pagata di tasca). */
  saveback: Cents
  firstDate: IsoDate
  lastDate: IsoDate
  closed: boolean
}

const prevDay = (d: IsoDate) => isoOf(dayNum(d) - 1)

export function computePositions(
  groups: PositionGroup[],
  configs: Record<string, InvestmentConfig>,
  quotes: Record<string, QuoteSeries>,
  errors: Record<string, string> = {},
  today: IsoDate = new Date().toISOString().slice(0, 10),
): Position[] {
  return groups
    .map((g): Position => {
      const cfg = configs[g.key]
      const type: InstrumentType = cfg?.type ?? 'etf'
      const ticker = cfg?.ticker || null
      const q = ticker ? quotes[ticker] : undefined
      const common = {
        key: g.key,
        category: g.category,
        name: g.name,
        type,
        ticker,
        isin: cfg?.isin || null,
        quoteName: q?.name ?? cfg?.name ?? null,
        error: ticker ? errors[ticker] : undefined,
        buys: g.events.filter((e) => e.kind === 'buy').length,
        sells: g.events.filter((e) => e.kind === 'sell').length,
        invested: g.events.filter((e) => e.kind === 'buy').reduce((a, e) => a + e.amount, 0),
        withdrawn: g.events.filter((e) => e.kind === 'sell').reduce((a, e) => a + e.amount, 0),
        saveback: g.events.filter((e) => e.kind === 'buy' && e.saveback).reduce((a, e) => a + e.amount, 0),
        firstDate: g.events[0].date,
        lastDate: g.events[g.events.length - 1].date,
      }

      // ---- Obbligazione --------------------------------------------------
      if (type === 'bond') {
        const r = replay(g.events, null)
        const closed = r.cost < 1
        const model = cfg && !closed ? bondModel(cfg, g.events[0].date, r.cost, q) : null
        const base = { ...common, costBasis: Math.round(r.cost), realized: Math.round(r.realized), units: null, unitsManual: false, priceIsPct: true, maturity: cfg?.maturity ?? null }
        if (!model) {
          return { ...base, status: closed ? 'tracked' : 'needs-data', price: null, priceDate: null, accrued: null, matured: false, value: Math.round(r.cost), unrealized: null, unrealizedPct: null, dayChange: null, dayChangePct: null, closed }
        }
        const value = model.valueAt(today, r.cost)
        const costYesterday = replay(g.events, null, prevDay(today)).cost
        const yesterday = model.valueAt(prevDay(today), costYesterday)
        // Variazione solo se ieri si possedeva la stessa quantità (altrimenti è un nuovo acquisto).
        const dayChange = Math.abs(costYesterday - r.cost) < 1 ? value - yesterday : null
        return {
          ...base,
          status: 'tracked',
          price: model.pricePctAt(today),
          priceDate: q?.priceDate ?? today,
          accrued: Math.round(model.accruedAt(today, r.cost)),
          matured: today >= cfg!.maturity!,
          value: Math.round(value),
          unrealized: Math.round(value - r.cost),
          unrealizedPct: r.cost > 0 ? (value - r.cost) / r.cost : null,
          dayChange: dayChange === null ? null : Math.round(dayChange),
          dayChangePct: dayChange !== null && yesterday > 0 ? dayChange / yesterday : null,
          closed: false,
        }
      }

      // ---- ETF / azione --------------------------------------------------
      const priceAt = q ? (d: IsoDate) => valueAt(q.history, d) ?? q.price : null
      const r = replay(g.events, priceAt)
      const closed = r.cost < 1 && r.units < 1e-9
      const unitsManual = cfg?.units !== null && cfg?.units !== undefined && !closed
      const units = q ? (unitsManual ? cfg!.units! : r.units) : null
      const value = q && units !== null ? units * q.price * CENTS : r.cost
      const status: Position['status'] = !ticker ? 'needs-data' : q ? 'tracked' : errors[ticker] ? 'error' : 'pending'
      const prev = q?.previousClose ?? null
      const dayChange = q && units !== null && prev !== null ? units * (q.price - prev) * CENTS : null
      return {
        ...common,
        status,
        costBasis: Math.round(r.cost),
        realized: Math.round(r.realized),
        units,
        unitsManual,
        price: q?.price ?? null,
        priceIsPct: false,
        priceDate: q?.priceDate ?? null,
        accrued: null,
        maturity: null,
        matured: false,
        value: Math.round(value),
        unrealized: q ? Math.round(value - r.cost) : null,
        unrealizedPct: q && r.cost > 0 ? (value - r.cost) / r.cost : null,
        dayChange: dayChange === null ? null : Math.round(dayChange),
        dayChangePct: dayChange !== null && prev ? q!.price / prev - 1 : null,
        closed,
      }
    })
    .sort((a, b) => Number(a.closed) - Number(b.closed) || b.value - a.value)
}

// ---------------------------------------------------------------------------
// Dettaglio per singolo acquisto
// ---------------------------------------------------------------------------

export interface Lot {
  date: IsoDate
  /** Voce dell'acquisto (per aprirla e modificarla). */
  opId?: string
  saveback: boolean
  /** Importo investito con quell'acquisto (centesimi, commissione esclusa). */
  amount: Cents
  /** Parte ancora posseduta dopo le vendite (0–1). */
  remaining: number
  /** Costo della parte ancora posseduta. */
  cost: Cents
  /** Quote acquistate e ancora possedute (solo con quotazioni). */
  units: number | null
  /** Prezzo unitario del giorno dell'acquisto (solo con quotazioni). */
  buyPrice: number | null
  value: Cents | null
  gain: Cents | null
  gainPct: number | null
  dayChange: Cents | null
  dayChangePct: number | null
}

/**
 * Ripercorre acquisti e vendite tenendo separato ogni acquisto («lotto»).
 * Le vendite riducono tutti i lotti in proporzione, come nel calcolo della posizione.
 * - ETF/azioni con quotazione: quote = importo / prezzo del giorno; valore = quote × prezzo attuale.
 * - Obbligazioni o posizioni senza quotazione: valore e variazioni della posizione ripartiti sul costo.
 */
export function computeLots(group: PositionGroup, position: Position, quote?: QuoteSeries): Lot[] {
  const priced = position.type !== 'bond' && !!quote
  const priceAt = (d: IsoDate) => (quote ? valueAt(quote.history, d) ?? quote.price : null)
  const lots: { date: IsoDate; amount: number; cost: number; units: number; buyPrice: number | null; opId?: string; saveback: boolean }[] = []
  for (const e of group.events) {
    if (e.kind === 'buy') {
      const p = priced ? priceAt(e.date) : null
      lots.push({ date: e.date, amount: e.amount, cost: e.amount, units: p ? e.amount / CENTS / p : 0, buyPrice: p, opId: e.opId, saveback: !!e.saveback })
      continue
    }
    const units = lots.reduce((a, l) => a + l.units, 0)
    const cost = lots.reduce((a, l) => a + l.cost, 0)
    const p = priced ? priceAt(e.date) : null
    let frac = p && units > 0 ? Math.min(1, e.amount / CENTS / p / units) : cost > 0 ? Math.min(1, e.amount / cost) : 0
    if (frac > 0.97) frac = 1
    for (const l of lots) {
      l.cost *= 1 - frac
      l.units *= 1 - frac
    }
  }

  // Quote inserite a mano: si riproporzionano i lotti stimati.
  const estimated = lots.reduce((a, l) => a + l.units, 0)
  const scale = priced && position.unitsManual && position.units !== null && estimated > 0 ? position.units / estimated : 1
  const totalCost = lots.reduce((a, l) => a + l.cost, 0)
  const prev = quote?.previousClose ?? null

  return lots.map((l) => {
    const remaining = l.amount > 0 ? l.cost / l.amount : 0
    const base = { date: l.date, amount: l.amount, remaining, cost: Math.round(l.cost), opId: l.opId, saveback: l.saveback }
    if (priced && quote) {
      const units = l.units * scale
      const value = units * quote.price * CENTS
      const gain = value - l.cost
      // Comprato oggi (o dopo l'ultima chiusura): la variazione del giorno è quella dall'acquisto.
      const boughtToday = l.date >= quote.priceDate
      const dayChange = boughtToday ? gain : prev !== null ? units * (quote.price - prev) * CENTS : null
      return {
        ...base,
        units,
        buyPrice: l.buyPrice,
        value: Math.round(value),
        gain: Math.round(gain),
        gainPct: l.cost > 0 ? gain / l.cost : null,
        dayChange: dayChange === null ? null : Math.round(dayChange),
        dayChangePct: boughtToday ? (l.cost > 0 ? gain / l.cost : null) : prev ? quote.price / prev - 1 : null,
      }
    }
    // Senza prezzo per lotto: quota della posizione in proporzione al costo.
    const share = totalCost > 0 ? l.cost / totalCost : 0
    const tracked = position.unrealized !== null
    const value = tracked ? position.value * share : null
    const gain = value !== null ? value - l.cost : null
    return {
      ...base,
      units: null,
      buyPrice: null,
      value: value === null ? null : Math.round(value),
      gain: gain === null ? null : Math.round(gain),
      gainPct: gain !== null && l.cost > 0 ? gain / l.cost : null,
      dayChange: position.dayChange === null ? null : Math.round(position.dayChange * share),
      dayChangePct: position.dayChangePct,
    }
  })
}

/** Vendita: dall'importo accreditato sul conto si ricava quanto viene venduto (accreditato + commissione). */
export function splitSale(creditedCents: number, feeCents: number): { gross: number; fee: number } | null {
  if (!Number.isInteger(creditedCents) || !Number.isInteger(feeCents) || creditedCents <= 0 || feeCents < 0) return null
  return { gross: creditedCents + feeCents, fee: feeCents }
}

export interface PortfolioSummary {
  value: Cents
  costBasis: Cents
  unrealized: Cents
  unrealizedPct: number | null
  realized: Cents
  dayChange: Cents
  dayChangePct: number | null
  /** Valore delle posizioni senza dati di tracking (valutate al costo). */
  atCost: Cents
}

export function summarizePortfolio(positions: Position[]): PortfolioSummary {
  const open = positions.filter((p) => !p.closed)
  const value = open.reduce((a, p) => a + p.value, 0)
  const costBasis = open.reduce((a, p) => a + p.costBasis, 0)
  const tracked = open.filter((p) => p.unrealized !== null)
  const trackedCost = tracked.reduce((a, p) => a + p.costBasis, 0)
  const unrealized = tracked.reduce((a, p) => a + (p.unrealized ?? 0), 0)
  const dayChange = open.reduce((a, p) => a + (p.dayChange ?? 0), 0)
  const valueYesterday = value - dayChange
  return {
    value,
    costBasis,
    unrealized,
    unrealizedPct: trackedCost > 0 ? unrealized / trackedCost : null,
    realized: positions.reduce((a, p) => a + p.realized, 0),
    dayChange,
    dayChangePct: valueYesterday > 0 && dayChange ? dayChange / valueYesterday : null,
    atCost: open.filter((p) => p.unrealized === null).reduce((a, p) => a + p.value, 0),
  }
}

export interface PortfolioPoint {
  date: IsoDate
  value: Cents
  invested: Cents
}

/** Valore del portafoglio e capitale investito giorno per giorno dal primo acquisto. */
export function computePortfolioSeries(
  groups: PositionGroup[],
  configs: Record<string, InvestmentConfig>,
  quotes: Record<string, QuoteSeries>,
  today: IsoDate,
): PortfolioPoint[] {
  if (!groups.length) return []
  const first = groups.reduce((m, g) => (g.events[0].date < m ? g.events[0].date : m), today)
  const dates = new Set<string>([first, today])
  for (const q of Object.values(quotes)) for (const [d] of q.history) if (d >= first && d <= today) dates.add(d)
  // Senza storici di borsa (es. solo obbligazioni) si campiona ogni settimana.
  if (dates.size < 3) for (let n = dayNum(first); n < dayNum(today); n += 7) dates.add(isoOf(n))
  const sorted = [...dates].sort()

  const prepared = groups.map((g) => {
    const cfg = configs[g.key]
    const q = cfg?.ticker ? quotes[cfg.ticker] : undefined
    if ((cfg?.type ?? 'etf') === 'bond') {
      const costNow = replay(g.events, null).cost
      return { g, bond: cfg ? bondModel(cfg, g.events[0].date, costNow, q) : null, priceAt: null, q: undefined, scale: 1 }
    }
    const priceAt = q ? (d: IsoDate) => valueAt(q.history, d) ?? q.price : null
    // Quote inserite a mano: si riscala la stima storica per farla combaciare.
    const est = priceAt ? replay(g.events, priceAt).units : 0
    const scale = q && cfg?.units !== null && cfg?.units !== undefined && est > 0 ? cfg.units / est : 1
    return { g, bond: null, priceAt, q, scale }
  })

  return sorted.map((date) => {
    let value = 0
    let invested = 0
    for (const { g, bond, priceAt, q, scale } of prepared) {
      if (g.events[0].date > date) continue
      const r = replay(g.events, priceAt, date)
      invested += r.cost
      if (bond) value += bond.valueAt(date, r.cost)
      else if (q) value += r.units * scale * (date === today ? q.price : valueAt(q.history, date) ?? q.price) * CENTS
      else value += r.cost
    }
    return { date, value: Math.round(value), invested: Math.round(invested) }
  })
}
