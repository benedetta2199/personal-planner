/**
 * Registro locale: configurazione di conti e categorie + voci inserite a mano.
 *
 * Il foglio Google resta la sorgente principale (in sola lettura). Il registro
 * si applica *sopra* ai dati sincronizzati:
 *  - rinominare un conto o una categoria salva il vecchio nome come alias,
 *    così anche le righe del foglio vengono ricondotte al nuovo nome;
 *  - le voci manuali si aggiungono alle operazioni sincronizzate;
 *  - i conti configurati possono fissare tipo e saldo iniziale.
 */
import type { Account, AccountType, Cents, CurrencyCode, ExpenseType, FinanceDataset, IsoDate, Operation } from './types.js'
import { accountEffects } from './calculations.js'
import { convert } from './money.js'
import type { InvestmentPlan } from './plans.js'

export type CategoryKind = 'expense' | 'income'

export interface SubcategoryConfig {
  id: string
  name: string
  aliases: string[]
}

export interface CategoryConfig {
  id: string
  name: string
  kind: CategoryKind
  /** Colore esadecimale usato nei grafici. */
  color: string
  aliases: string[]
  subcategories: SubcategoryConfig[]
  /** Tipologia proposta di default per le nuove spese di questa categoria. */
  defaultExpenseType?: ExpenseType
  /** Icona scelta (chiave di CATEGORY_ICONS); se assente viene dedotta dal nome. */
  icon?: string
}

export const CARD_THEMES = ['forest', 'lime', 'graphite', 'coral', 'red', 'ocean', 'violet', 'sand'] as const
export type CardTheme = (typeof CARD_THEMES)[number]

export interface AccountConfig {
  id: string
  /** Nome canonico, mostrato ovunque nell'app. */
  name: string
  /** Altri nomi con cui il conto compare nel foglio (es. "Conti"). */
  aliases: string[]
  type: AccountType
  currency: CurrencyCode
  /** Se valorizzato sostituisce il saldo iniziale del foglio. */
  openingBalance: Cents | null
  /**
   * Data a cui si riferisce `openingBalance` (saldo a inizio giornata).
   * Assente = saldo prima del primo movimento.
   */
  openingDate?: IsoDate | null
  cardTheme: CardTheme
  /** Mostra il conto come carta nella dashboard. */
  showCard: boolean
}

export interface LedgerConfig {
  accounts: AccountConfig[]
  categories: CategoryConfig[]
  /** Conto proposto per le nuove voci (id del conto). */
  defaultAccountId?: string
}

export type InstrumentType = 'etf' | 'stock' | 'bond'

export const INSTRUMENT_LABEL: Record<InstrumentType, string> = { etf: 'ETF', stock: 'Azione', bond: 'Obbligazione' }

/**
 * Dati dello strumento finanziario collegato a una posizione
 * (categoria␟sotto-categoria). Salvati anche sul Google Sheet degli investimenti.
 */
export interface InvestmentConfig {
  /** Assente nelle configurazioni create prima della distinzione: vale 'etf'. */
  type?: InstrumentType
  /** Simbolo per le quotazioni giornaliere (obbligatorio per ETF e azioni). */
  ticker: string
  /** Quote/azioni possedute inserite a mano: sostituiscono la stima automatica. */
  units: number | null
  isin?: string
  /** Nome completo dello strumento. */
  name?: string
  // --- Obbligazioni ---
  /** Valore nominale posseduto, in unità di valuta (es. 1000 €). */
  nominal?: number | null
  /** Prezzo di acquisto in % del nominale (es. 99,5). */
  buyPrice?: number | null
  /** Cedola annua lorda, in % (es. 2,55). */
  coupon?: number | null
  /** Pagamenti di cedola all'anno: 1, 2, 4 o 12. */
  couponFrequency?: number | null
  /** Data di scadenza (rimborso del nominale). */
  maturity?: string | null
  updatedAt?: string
}

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

/** Verifica che ci siano i dati per il tracking automatico; restituisce i problemi trovati. */
export function validateInstrument(c: InvestmentConfig): string[] {
  const errors: string[] = []
  const type = c.type ?? 'etf'
  if (c.isin && !ISIN_RE.test(c.isin)) errors.push('Codice ISIN non valido (12 caratteri, es. IE00B4L5Y983).')
  if (c.units !== null && c.units !== undefined && (!Number.isFinite(c.units) || c.units < 0)) errors.push('Numero di quote non valido.')
  if (type !== 'bond') {
    if (!c.ticker) errors.push(`Per ${type === 'etf' ? "l'ETF" : "l'azione"} serve il ticker per scaricare il prezzo giornaliero.`)
    return errors
  }
  if (!c.isin) errors.push("Per l'obbligazione serve il codice ISIN.")
  if (c.coupon === null || c.coupon === undefined || !Number.isFinite(c.coupon) || c.coupon < 0 || c.coupon > 30) errors.push('Indica la cedola annua (es. 2,55 %; 0 per zero coupon).')
  if (!c.couponFrequency || ![1, 2, 4, 12].includes(c.couponFrequency)) errors.push('Indica ogni quanto viene pagata la cedola.')
  if (!c.maturity || !/^\d{4}-\d{2}-\d{2}$/.test(c.maturity)) errors.push('Indica la data di scadenza.')
  if (c.buyPrice !== null && c.buyPrice !== undefined && (!Number.isFinite(c.buyPrice) || c.buyPrice <= 0 || c.buyPrice > 300)) errors.push('Prezzo di acquisto non valido (in % del nominale, es. 99,5).')
  if (c.nominal !== null && c.nominal !== undefined && (!Number.isFinite(c.nominal) || c.nominal <= 0)) errors.push('Valore nominale non valido.')
  return errors
}

export interface LedgerState {
  version: 1
  config: LedgerConfig
  entries: Operation[]
  /** Chiave: `subKey(categoria, sotto-categoria)`. */
  investments?: Record<string, InvestmentConfig>
  /** true dopo il primo import automatico delle categorie dal foglio. */
  seeded: boolean
  /** Versione dell'elenco categorie predefinito applicato (vedi `PRESET_VERSION`). */
  preset?: number
  /** Piani di accumulo (PAC). */
  plans?: InvestmentPlan[]
  /** ID dei PAC eliminati: servono a non farli ricomparire unendo la configurazione di un altro dispositivo. */
  removedPlans?: string[]
  /** Modifiche alle voci non ancora salvate sul foglio Google (id voce → operazione). */
  outbox?: Record<string, 'upsert' | 'delete'>
  /** Ultima modifica della configurazione (conti, categorie, investimenti). */
  updatedAt?: string
  /** `updatedAt` dell'ultima configurazione allineata con il foglio. */
  configSyncedAt?: string
}

/** Configurazione salvata sul foglio (tutto tranne le voci). */
export interface CloudConfig {
  config: LedgerConfig
  investments: Record<string, InvestmentConfig>
  plans?: InvestmentPlan[]
  removedPlans?: string[]
  preset?: number
  seeded: boolean
}

/**
 * ID della voce creata dall'app, sia locale («m-…») sia riletta dal foglio
 * («Uscite:m-…», perché l'importer antepone il nome della scheda). null per le altre righe.
 */
export function appEntryId(id: string): string | null {
  const m = /^(?:(?:Entrate|Uscite|Transazioni):)?(m-[\w-]+)$/.exec(id)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Elenco categorie predefinito
// ---------------------------------------------------------------------------

export const PRESET_VERSION = 1

type PresetRow = [name: string, color: string, subs: string[], extra?: { aliases?: string[]; type?: ExpenseType }]

const EXPENSE_PRESET: PresetRow[] = [
  ['Divertimenti', '#e0457b', ['Cibo', 'Esperienze', 'Bevute'], { aliases: ['Divertimento'], type: 'additional' }],
  ['Trasporti', '#1f9fb0', ['Carburante', 'Mezzi pubblici', 'Parcheggio', 'Autostrada', 'Manutenzione'], { type: 'necessary' }],
  ['Viaggi', '#3d7bf2', ['Trasporti', 'Cibo', 'Alloggio', 'Souvenir', 'Musei', 'Esperienze', 'Altro'], { aliases: ['Viaggio'], type: 'additional' }],
  ['Regali', '#f26b3a', ['Amici', 'Famiglia', 'Me', 'Altro'], { aliases: ['Regalo'], type: 'additional' }],
  ['Spese personali', '#a0522d', ['Abbigliamento', 'Cura personale', 'Hobby', 'Sfizi'], { type: 'additional' }],
  ['Salute', '#6aae2a', ['Visite mediche', 'Medicine'], { type: 'necessary' }],
  ['Spese fisse', '#e0483e', ['Abbonamenti', 'Servizi'], { type: 'necessary' }],
  ['Cibo', '#d4920f', ['Asporto', 'Spesa'], { type: 'necessary' }],
  [
    'Investimenti',
    '#7b61ff',
    [
      'XEON Euro Overnight', 'Physical Gold USD', 'MSCI World', 'MSCI EM IMI', 'MSCI EMI Enhanced', 'S&P 500 InfoTech', 'Ai & Bigdata',
      'MSCI Semiconduttori', 'Bitcoin', 'Eurozone Gov Bond', 'Euro Gov Bond 10-15y', 'Clean energy', 'Uranium & nuclear',
    ],
    { aliases: ['Investimenti ETF'], type: 'investment' },
  ],
  ['Altro', '#0aa3a8', [], { type: 'additional' }],
]

const INCOME_PRESET: PresetRow[] = [
  ['Stipendio', '#6aae2a', ['Saltuario', '13-14esima']],
  ['Bonus', '#d4920f', []],
  ['Regalo', '#f26b3a', [], { aliases: ['Regali'] }],
  ['Rimborso', '#1f9fb0', [], { aliases: ['Rimborsi'] }],
  ['Investimenti', '#7b61ff', ['Interessi', 'Vendite'], { aliases: ['Investimenti ETF', 'Interessi', 'Rendita'] }],
  ['Altro', '#0aa3a8', []],
]

export function presetCategories(): CategoryConfig[] {
  const build = (kind: CategoryKind) => ([name, color, subs, extra]: PresetRow): CategoryConfig => ({
    id: uid(),
    name,
    kind,
    color,
    aliases: extra?.aliases ?? [],
    subcategories: subs.map((s) => ({ id: uid(), name: s, aliases: [] })),
    defaultExpenseType: kind === 'expense' ? extra?.type : undefined,
  })
  return [...EXPENSE_PRESET.map(build('expense')), ...INCOME_PRESET.map(build('income'))]
}

/**
 * Applica l'elenco predefinito (una sola volta per versione). I collegamenti
 * degli investimenti vengono ricondotti ai nuovi nomi.
 */
export function applyPreset(state: LedgerState): boolean {
  if ((state.preset ?? 0) >= PRESET_VERSION) return false
  const oldInvestments = state.investments ?? {}
  state.config.categories = presetCategories()
  const r = buildResolver(state.config)
  const moved: Record<string, InvestmentConfig> = {}
  for (const [key, cfg] of Object.entries(oldInvestments)) {
    const [cat, sub = ''] = key.split('␟')
    const c = r.category(cat, 'expense')
    moved[`${c}␟${r.subcategory(c, sub)}`] = cfg
  }
  state.investments = moved
  state.preset = PRESET_VERSION
  state.seeded = true
  return true
}

/** Palette validata (12 tinte, ordine fisso): ogni categoria riceve la prima libera. */
export const CATEGORY_COLORS = [
  '#e0483e', '#1f9fb0', '#d4920f', '#7b61ff', '#6aae2a', '#e0457b',
  '#3d7bf2', '#1d7a52', '#f26b3a', '#9c4fd6', '#a0522d', '#0aa3a8',
]

/** Primo colore della palette non ancora usato da altre categorie dello stesso tipo. */
export function pickCategoryColor(categories: Pick<CategoryConfig, 'color' | 'kind'>[], kind: CategoryKind): string {
  const used = new Set(categories.filter((c) => c.kind === kind).map((c) => c.color.toLowerCase()))
  return CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[categories.filter((c) => c.kind === kind).length % CATEGORY_COLORS.length]
}
export const OTHER_COLOR = '#a3a8a0'

export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 12)
  } catch {
    /* contesto non sicuro: si usa il fallback */
  }
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Chiave di confronto dei nomi: ignora maiuscole, spazi e simboli iniziali
 * (emoji e marcatori ⭕/➕ del foglio), così «🍱 Cibo › ⭕ Spesa» = «Cibo › Spesa».
 */
export const norm = (s: string) =>
  s
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('it')

const account = (name: string, cardTheme: CardTheme, aliases: string[] = [], type: AccountType = 'liquidity'): AccountConfig => ({
  id: uid(),
  name,
  aliases,
  type,
  currency: 'EUR',
  openingBalance: null,
  cardTheme,
  showCard: true,
})

export function defaultLedger(): LedgerState {
  return {
    version: 1,
    config: {
      accounts: [
        account('Conto', 'ocean', ['Conti', 'Conto corrente']),
        account('Revolut', 'graphite'),
        account('Trade Republic', 'lime', ['TradeRepublic']),
        account('Satispay', 'coral'),
        account('PayPal', 'ocean', ['Paypal']),
      ],
      categories: presetCategories(),
    },
    entries: [],
    investments: {},
    seeded: true,
    preset: PRESET_VERSION,
  }
}

/** Ripara colori duplicati (configurazioni create con la vecchia palette a 8 tinte). */
export function dedupeCategoryColors(categories: CategoryConfig[]): boolean {
  let changed = false
  for (const kind of ['expense', 'income'] as const) {
    const seen = new Set<string>()
    const list = categories.filter((c) => c.kind === kind)
    for (const c of list) {
      const key = c.color.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        continue
      }
      const free = CATEGORY_COLORS.find((x) => !seen.has(x))
      if (!free) break
      c.color = free
      seen.add(free)
      changed = true
    }
  }
  return changed
}

// ---------------------------------------------------------------------------
// Risoluzione dei nomi
// ---------------------------------------------------------------------------

export interface NameResolver {
  account: (name: string) => string
  /** Con `kind` cerca prima tra le categorie di quel tipo (uscite ed entrate possono avere alias incrociati). */
  category: (name: string, kind?: CategoryKind) => string
  subcategory: (category: string, sub: string) => string
  /** Configurazione della categoria (dopo la risoluzione del nome). */
  categoryConfig: (name: string, kind?: CategoryKind) => CategoryConfig | undefined
}

export function buildResolver(config: LedgerConfig): NameResolver {
  const accounts = new Map<string, string>()
  for (const a of config.accounts) for (const n of [a.name, ...a.aliases]) accounts.set(norm(n), a.name)

  const cats = new Map<string, string>()
  const catsByKind: Record<CategoryKind, Map<string, string>> = { expense: new Map(), income: new Map() }
  const byName = new Map<string, CategoryConfig[]>()
  const subs = new Map<string, Map<string, string>>()
  for (const c of config.categories) {
    for (const n of [c.name, ...c.aliases]) {
      if (!cats.has(norm(n))) cats.set(norm(n), c.name)
      catsByKind[c.kind].set(norm(n), c.name)
    }
    const list = byName.get(c.name) ?? []
    list.push(c)
    byName.set(c.name, list)
    const m = subs.get(c.name) ?? new Map<string, string>()
    for (const s of c.subcategories) for (const n of [s.name, ...s.aliases]) m.set(norm(n), s.name)
    subs.set(c.name, m)
  }

  return {
    account: (n) => (n ? accounts.get(norm(n)) ?? n : n),
    category: (n, kind) => (n ? (kind && catsByKind[kind].get(norm(n))) || cats.get(norm(n)) || n : n),
    subcategory: (c, s) => (s ? subs.get(c)?.get(norm(s)) ?? s : s),
    categoryConfig: (n, kind) => {
      const list = byName.get(n)
      if (!list) return undefined
      return (kind && list.find((c) => c.kind === kind)) || list[0]
    },
  }
}

function mapOperation(op: Operation, r: NameResolver): Operation {
  const kind = op.kind === 'income' ? 'income' : op.kind === 'expense' ? 'expense' : undefined
  const category = r.category(op.category, kind)
  const mapped = { ...op, account: r.account(op.account), category, subcategory: r.subcategory(category, op.subcategory) }
  if (mapped.kind === 'transfer') mapped.toAccount = r.account(mapped.toAccount)
  return mapped as Operation
}

/**
 * Unisce i dati sincronizzati con il registro locale.
 * Restituisce sempre un dataset valido, anche senza dati sincronizzati.
 */
export function applyLedger(raw: FinanceDataset | null, state: LedgerState): FinanceDataset {
  const r = buildResolver(state.config)
  const base: FinanceDataset = raw ?? { baseCurrency: 'EUR', rates: {}, accounts: [], operations: [] }

  // Le voci dell'app presenti in locale (modificate e non ancora salvate) o in attesa
  // di eliminazione prevalgono sulla copia letta dal foglio.
  const local = new Set(state.entries.map((e) => e.id))
  const deleted = new Set(Object.entries(state.outbox ?? {}).filter(([, a]) => a === 'delete').map(([id]) => id))
  const fromSheet = base.operations.filter((op) => {
    const id = appEntryId(op.id)
    return !id || (!local.has(id) && !deleted.has(id))
  })
  const operations = [...fromSheet.map((op) => mapOperation(op, r)), ...state.entries.map((op) => mapOperation(op, r))]
  operations.sort((a, b) => a.date.localeCompare(b.date) || a.source.row - b.source.row)

  // Conti del foglio ricondotti al nome canonico (più alias → un solo conto).
  const merged = new Map<string, Account>()
  for (const a of base.accounts) {
    const name = r.account(a.name)
    const prev = merged.get(name)
    if (!prev) merged.set(name, { ...a, name })
    else {
      prev.openingBalance += a.openingBalance
      if (a.marketValue !== undefined) prev.marketValue = (prev.marketValue ?? 0) + a.marketValue
      prev.declared = prev.declared || a.declared
    }
  }

  const accounts: Account[] = []
  for (const cfg of state.config.accounts) {
    const fromSheet = merged.get(cfg.name)
    merged.delete(cfg.name)
    accounts.push({
      name: cfg.name,
      type: cfg.type,
      currency: fromSheet?.currency ?? cfg.currency,
      openingBalance: cfg.openingBalance ?? fromSheet?.openingBalance ?? 0,
      marketValue: fromSheet?.marketValue,
      label: fromSheet?.label,
      declared: true,
    })
  }
  accounts.push(...merged.values())

  // Saldo iniziale a una data: il saldo di apertura viene ricalcolato in modo che,
  // a inizio di quel giorno, il conto valga esattamente l'importo indicato.
  for (const cfg of state.config.accounts) {
    if (cfg.openingBalance === null || !cfg.openingDate) continue
    const acc = accounts.find((a) => a.name === cfg.name)
    if (acc) acc.openingBalance = cfg.openingBalance - effectsBefore(operations, acc, cfg.openingDate, base.rates)
  }

  // Ogni conto citato dalle operazioni deve esistere.
  const known = new Set(accounts.map((a) => a.name))
  for (const op of operations) {
    for (const name of op.kind === 'transfer' ? [op.account, op.toAccount] : [op.account]) {
      if (name && !known.has(name)) {
        known.add(name)
        accounts.push({ name, type: 'liquidity', currency: op.currency, openingBalance: 0, declared: false })
      }
    }
  }

  return { baseCurrency: base.baseCurrency, rates: base.rates, accounts, operations }
}

/** Somma (in valuta del conto) dei movimenti del conto con data precedente a `date`. */
function effectsBefore(operations: Operation[], account: Account, date: IsoDate, rates: FinanceDataset['rates']): Cents {
  let total = 0
  for (const op of operations) {
    if (op.date >= date) continue
    for (const e of accountEffects(op)) {
      if (e.account !== account.name) continue
      total += convert(e.amount, e.currency, account.currency, rates) ?? 0
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Import delle categorie dai movimenti
// ---------------------------------------------------------------------------

/**
 * Aggiunge alla configurazione le categorie e sotto-categorie presenti nei
 * movimenti ma non ancora configurate. Non modifica quelle esistenti.
 */
export function seedCategories(config: LedgerConfig, ds: FinanceDataset): { categories: CategoryConfig[]; added: number } {
  const categories = config.categories.map((c) => ({ ...c, subcategories: [...c.subcategories] }))
  const find = (name: string, kind: CategoryKind) => {
    const n = norm(name)
    return categories.find((c) => c.kind === kind && (norm(c.name) === n || c.aliases.some((a) => norm(a) === n)))
  }
  const typeVotes = new Map<CategoryConfig, Record<ExpenseType, number>>()
  let added = 0

  for (const op of ds.operations) {
    if (op.kind === 'transfer' || !op.category.trim()) continue
    const kind: CategoryKind = op.kind === 'income' ? 'income' : 'expense'
    let cat = find(op.category, kind)
    if (!cat) {
      cat = {
        id: uid(),
        name: op.category.trim(),
        kind,
        color: pickCategoryColor(categories, kind),
        aliases: [],
        subcategories: [],
      }
      categories.push(cat)
      typeVotes.set(cat, { necessary: 0, additional: 0, investment: 0 })
      added++
    }
    const sub = op.subcategory.trim()
    if (sub && !cat.subcategories.some((s) => norm(s.name) === norm(sub) || s.aliases.some((a) => norm(a) === norm(sub)))) {
      cat.subcategories.push({ id: uid(), name: sub, aliases: [] })
      added++
    }
    const votes = typeVotes.get(cat)
    if (votes && op.kind === 'expense') votes[op.expenseType]++
  }

  for (const [cat, votes] of typeVotes) {
    if (cat.kind !== 'expense') continue
    const best = (Object.entries(votes) as [ExpenseType, number][]).sort((a, b) => b[1] - a[1])[0]
    if (best[1] > 0) cat.defaultExpenseType = best[0]
  }
  for (const c of categories) c.subcategories.sort((a, b) => a.name.localeCompare(b.name, 'it'))
  return { categories, added }
}

/** Validazione minima di un backup importato. */
export function isLedgerState(v: unknown): v is LedgerState {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<LedgerState>
  return s.version === 1 && !!s.config && Array.isArray(s.config.accounts) && Array.isArray(s.config.categories) && Array.isArray(s.entries)
}
