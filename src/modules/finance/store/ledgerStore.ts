import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { readJson, writeJson } from '@/core/utils/storage'
import {
  appEntryId,
  applyPreset,
  addDays,
  chargeDates,
  planEntryId,
  dedupeCategoryColors,
  defaultLedger,
  pickCategoryColor,
  subKey,
  isLedgerState,
  norm,
  seedCategories,
  uid,
  type AccountConfig,
  type CategoryConfig,
  type CategoryKind,
  type CloudConfig,
  type ExpenseType,
  type InvestmentPlan,
  type PlanFrequency,
  type FinanceDataset,
  type InvestmentConfig,
  type LedgerState,
  type Operation,
} from '../domain'

const KEY = 'gp.finance.ledger.v1'

/** Confronto profondo indipendente dall'ordine delle chiavi; i campi undefined sono ignorati. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

/** Dati di una voce dal form (importi in centesimi). */
export type EntryDraft =
  | { kind: 'expense'; expenseType: ExpenseType; date: string; account: string; category: string; subcategory: string; description: string; amount: number; currency: string }
  | { kind: 'income'; date: string; account: string; category: string; subcategory: string; description: string; amount: number; currency: string }
  | { kind: 'transfer'; date: string; account: string; toAccount: string; category: string; subcategory: string; description: string; amount: number; currency: string }

export class LedgerError extends Error {}

/**
 * Configurazione di conti/categorie e voci manuali, salvate in questo browser.
 * Ogni modifica viene persistita subito in localStorage.
 */
export const useLedgerStore = defineStore('finance-ledger', () => {
  const loaded = readJson<LedgerState>(KEY)
  const state = ref<LedgerState>(isLedgerState(loaded) ? loaded : defaultLedger())
  state.value.investments ??= {}
  applyPreset(state.value)
  dedupeCategoryColors(state.value.config.categories)
  // Registri creati prima del salvataggio sul foglio: tutte le voci locali vanno caricate.
  if (!state.value.outbox) state.value.outbox = Object.fromEntries(state.value.entries.map((e) => [e.id, 'upsert' as const]))
  const saveFailed = ref(false)
  watch(state, (s) => (saveFailed.value = !writeJson(KEY, s)), { deep: true })

  // Ogni modifica a conti/categorie/investimenti aggiorna la data della configurazione.
  let applyingRemote = false
  watch(
    () => [state.value.config, state.value.investments, state.value.plans],
    () => {
      if (!applyingRemote) state.value.updatedAt = new Date().toISOString()
    },
    { deep: true },
  )

  const outbox = () => (state.value.outbox ??= {})

  // ---- Voci ----------------------------------------------------------------
  function toOperation(d: EntryDraft, id: string, row: number): Operation {
    const base = {
      id,
      date: d.date,
      account: d.account.trim(),
      category: d.category.trim(),
      subcategory: d.subcategory.trim(),
      description: d.description.trim(),
      amount: d.amount,
      currency: d.currency,
      extra: {},
      source: { sheet: 'Manuale' as const, row },
    }
    if (d.kind === 'expense') return { ...base, kind: 'expense', expenseType: d.expenseType }
    if (d.kind === 'income') return { ...base, kind: 'income' }
    return { ...base, category: '', subcategory: '', kind: 'transfer', toAccount: d.toAccount.trim(), toCurrency: d.currency, toAmount: d.amount }
  }

  function validate(d: EntryDraft) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new LedgerError('Data non valida.')
    if (!Number.isInteger(d.amount) || d.amount <= 0) throw new LedgerError("L'importo deve essere maggiore di zero.")
    if (!d.account.trim()) throw new LedgerError('Scegli un conto.')
    if (d.kind === 'transfer') {
      if (!d.toAccount.trim()) throw new LedgerError('Scegli il conto di destinazione.')
      if (norm(d.toAccount) === norm(d.account)) throw new LedgerError('Origine e destinazione devono essere diverse.')
    } else if (!d.category.trim()) throw new LedgerError('Scegli una categoria.')
  }

  /** Registra categoria/sotto-categoria digitate nel form se non esistono ancora. */
  function ensureCategory(kind: CategoryKind, category: string, sub: string, expenseType?: ExpenseType) {
    const name = category.trim()
    if (!name) return
    let cat = findCategory(kind, name)
    if (!cat) {
      cat = { id: uid(), name, kind, color: nextColor(kind), aliases: [], subcategories: [], defaultExpenseType: expenseType }
      state.value.config.categories.push(cat)
    }
    const s = sub.trim()
    if (s && !cat.subcategories.some((x) => norm(x.name) === norm(s) || x.aliases.some((a) => norm(a) === norm(s)))) {
      cat.subcategories.push({ id: uid(), name: s, aliases: [] })
    }
  }

  function addEntry(d: EntryDraft, id = `m-${uid()}`): Operation {
    validate(d)
    const op = toOperation(d, id, state.value.entries.length + 1)
    state.value.entries.push(op)
    outbox()[op.id] = 'upsert'
    if (d.kind !== 'transfer') ensureCategory(d.kind, d.category, d.subcategory, d.kind === 'expense' ? d.expenseType : undefined)
    return op
  }

  function updateEntry(id: string, d: EntryDraft) {
    validate(d)
    const key = appEntryId(id)
    if (!key) throw new LedgerError('Voce non trovata: solo le voci inserite dall’app sono modificabili.')
    const i = state.value.entries.findIndex((e) => e.id === key)
    // Voce già salvata sul foglio: la copia locale ne prende il posto finché non è salvata.
    if (i < 0) state.value.entries.push(toOperation(d, key, state.value.entries.length + 1))
    else state.value.entries[i] = toOperation(d, key, state.value.entries[i].source.row)
    outbox()[key] = 'upsert'
    if (d.kind !== 'transfer') ensureCategory(d.kind, d.category, d.subcategory, d.kind === 'expense' ? d.expenseType : undefined)
  }

  function removeEntry(id: string) {
    const key = appEntryId(id) ?? id
    state.value.entries = state.value.entries.filter((e) => e.id !== key)
    if (appEntryId(key)) outbox()[key] = 'delete'
  }
  /** Voce creata dall'app (in locale o già salvata sul foglio): modificabile. */
  const isManual = (id: string) => appEntryId(id) !== null

  // ---- Allineamento con il foglio Google -------------------------------------
  const pendingCount = () => Object.keys(state.value.outbox ?? {}).length

  /** Modifiche da inviare: voci da inserire/aggiornare e ID da eliminare. */
  function pendingChanges() {
    const box = { ...(state.value.outbox ?? {}) }
    const byId = new Map(state.value.entries.map((e) => [e.id, e]))
    const upserts = Object.entries(box).filter(([, a]) => a === 'upsert').map(([id]) => byId.get(id)).filter((e): e is Operation => !!e)
    const deletes = Object.entries(box).filter(([, a]) => a === 'delete').map(([id]) => id)
    return { box, upserts, deletes }
  }

  /** Dopo un invio riuscito: toglie dalla coda solo ciò che non è cambiato nel frattempo. */
  function markSent(box: Record<string, 'upsert' | 'delete'>) {
    const current = outbox()
    for (const [id, action] of Object.entries(box)) if (current[id] === action) delete current[id]
  }

  /**
   * Dopo aver riletto il foglio: le voci locali già salvate (non più in coda) vengono
   * rimosse, perché ora arrivano dal foglio, che resta la fonte di verità.
   */
  function pruneSaved(sheetOps: Operation[]) {
    const box = state.value.outbox ?? {}
    const inSheet = new Set(sheetOps.map((o) => appEntryId(o.id)).filter(Boolean))
    state.value.entries = state.value.entries.filter((e) => box[e.id] || !inSheet.has(e.id))
    // Eliminazioni confermate: la riga non c'è più.
    for (const [id, a] of Object.entries(box)) if (a === 'delete' && !inSheet.has(id)) delete box[id]
  }

  function cloudConfig(): CloudConfig {
    const s = state.value
    return { config: s.config, investments: s.investments ?? {}, plans: s.plans ?? [], removedPlans: s.removedPlans ?? [], preset: s.preset, seeded: s.seeded }
  }

  // ---- Piani di accumulo (PAC) --------------------------------------------------
  type PlanDraft = { key: string; amount: number; frequency: PlanFrequency; account: string; startDate: string }

  function validatePlan(p: PlanDraft) {
    if (!p.key) throw new LedgerError("Scegli l'ETF del piano.")
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new LedgerError("L'importo deve essere maggiore di zero.")
    if (!p.account.trim()) throw new LedgerError('Scegli il conto da cui addebitare.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) throw new LedgerError('Data di inizio non valida.')
  }

  function addPlan(p: PlanDraft): InvestmentPlan {
    validatePlan(p)
    const plan: InvestmentPlan = { id: uid().replace(/[^\w]/g, ''), ...p, account: p.account.trim(), generatedUntil: addDays(p.startDate, -1), active: true }
    ;(state.value.plans ??= []).push(plan)
    return plan
  }

  function updatePlan(id: string, p: PlanDraft) {
    validatePlan(p)
    const plan = state.value.plans?.find((x) => x.id === id)
    if (!plan) return
    const dayBefore = addDays(p.startDate, -1)
    if (p.startDate < plan.startDate) {
      // Inizio anticipato: si generano gli addebiti mancanti (quelli già presenti hanno lo stesso ID e non si duplicano).
      plan.generatedUntil = dayBefore
    } else if (dayBefore > plan.generatedUntil) {
      // Inizio posticipato: le voci già create restano, si riparte dalla nuova data.
      plan.generatedUntil = dayBefore
    }
    Object.assign(plan, { ...p, account: p.account.trim() })
  }

  function setPlanActive(id: string, active: boolean, today: string) {
    const plan = state.value.plans?.find((x) => x.id === id)
    if (!plan) return
    plan.active = active
    // Riattivando non si recuperano gli addebiti del periodo di pausa.
    if (active && plan.generatedUntil < addDays(today, -1)) plan.generatedUntil = addDays(today, -1)
  }

  function removePlan(id: string) {
    state.value.plans = (state.value.plans ?? []).filter((x) => x.id !== id)
    const removed = (state.value.removedPlans ??= [])
    if (!removed.includes(id)) removed.push(id)
  }

  /**
   * Crea le voci dei PAC scadute fino a oggi (incluso). Ogni addebito ha un ID stabile
   * (piano + data): se esiste già, in locale o sul foglio, non viene ricreato.
   * Restituisce il numero di voci create.
   */
  function runPlans(today: string, existingIds: Set<string>, nameOf: (key: string) => string, currencyOf: (account: string) => string): number {
    let created = 0
    for (const plan of state.value.plans ?? []) {
      if (!plan.active) continue
      const [category, subcategory = ''] = plan.key.split('␟')
      for (const date of chargeDates(plan.frequency, plan.generatedUntil, today)) {
        if (date < plan.startDate) continue
        const id = planEntryId(plan.id, date)
        if (existingIds.has(id) || state.value.entries.some((e) => e.id === id)) continue
        addEntry(
          { kind: 'expense', expenseType: 'investment', date, account: plan.account, category, subcategory, description: `PAC ${nameOf(plan.key)}`, amount: plan.amount, currency: currencyOf(plan.account) },
          id,
        )
        created++
      }
      if (today > plan.generatedUntil) plan.generatedUntil = today
    }
    return created
  }

  /** Esegue modifiche arrivate dal foglio senza segnarle come modifiche locali. */
  function withoutLocalChange(fn: () => void) {
    applyingRemote = true
    fn()
    // Il watcher della configurazione è asincrono: si riattiva dopo il suo giro.
    queueMicrotask(() => setTimeout(() => (applyingRemote = false)))
  }

  function applyCloudConfig(remote: CloudConfig, updatedAt: string) {
    withoutLocalChange(() => {
      const removed = new Set([...(remote.removedPlans ?? []), ...(state.value.removedPlans ?? [])])
      state.value.config = remote.config
      state.value.investments = remote.investments ?? {}
      state.value.plans = (remote.plans ?? []).filter((p) => !removed.has(p.id))
      state.value.removedPlans = [...removed]
      state.value.preset = remote.preset
      state.value.seeded = remote.seeded
      state.value.updatedAt = updatedAt
      state.value.configSyncedAt = updatedAt
    })
  }

  /**
   * Modifiche sia locali sia sul foglio dall'ultimo allineamento: conti, categorie e investimenti
   * seguono la versione più recente, mentre i PAC vengono uniti (nessun piano va perso; quelli
   * eliminati su un dispositivo restano eliminati). Restituisce la nuova data da salvare sul foglio.
   */
  function mergeCloudConfig(remote: CloudConfig, remoteUpdatedAt: string): string {
    const local = state.value
    const localWins = !!local.updatedAt && local.updatedAt > remoteUpdatedAt
    const removed = new Set([...(remote.removedPlans ?? []), ...(local.removedPlans ?? [])])
    const merged = new Map<string, InvestmentPlan>()
    for (const p of remote.plans ?? []) merged.set(p.id, p)
    for (const p of local.plans ?? []) {
      const other = merged.get(p.id)
      if (!other) merged.set(p.id, p)
      else {
        const winner = localWins ? p : other
        // Gli addebiti hanno ID stabili: si riparte dal giorno più avanzato già coperto.
        merged.set(p.id, { ...winner, generatedUntil: p.generatedUntil > other.generatedUntil ? p.generatedUntil : other.generatedUntil })
      }
    }
    const at = new Date().toISOString()
    withoutLocalChange(() => {
      if (!localWins) {
        local.config = remote.config
        local.investments = remote.investments ?? {}
        local.preset = remote.preset
        local.seeded = remote.seeded || local.seeded
      }
      local.plans = [...merged.values()].filter((p) => !removed.has(p.id))
      local.removedPlans = [...removed]
      local.updatedAt = at
    })
    return at
  }

  function markConfigSynced(updatedAt: string) {
    state.value.configSyncedAt = updatedAt
  }

  // ---- Conti ---------------------------------------------------------------
  function accountNameTaken(name: string, exceptId?: string) {
    const n = norm(name)
    return state.value.config.accounts.some((a) => a.id !== exceptId && (norm(a.name) === n || a.aliases.some((x) => norm(x) === n)))
  }

  function addAccount(a: Omit<AccountConfig, 'id' | 'aliases'> & { aliases?: string[] }) {
    const name = a.name.trim()
    if (!name) throw new LedgerError('Il nome del conto è obbligatorio.')
    if (accountNameTaken(name)) throw new LedgerError(`Esiste già un conto chiamato «${name}».`)
    state.value.config.accounts.push({ ...a, name, aliases: a.aliases ?? [], id: uid() })
  }

  function updateAccount(id: string, patch: Partial<Omit<AccountConfig, 'id'>>) {
    const acc = state.value.config.accounts.find((a) => a.id === id)
    if (!acc) return
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new LedgerError('Il nome del conto è obbligatorio.')
      if (accountNameTaken(name, id)) throw new LedgerError(`Esiste già un conto chiamato «${name}».`)
      if (name !== acc.name) {
        const old = acc.name
        // Il vecchio nome resta alias: le righe del foglio continuano a corrispondere.
        acc.aliases = [...new Set([...acc.aliases.filter((x) => norm(x) !== norm(name)), old])]
        for (const e of state.value.entries) {
          if (e.account === old) e.account = name
          if (e.kind === 'transfer' && e.toAccount === old) e.toAccount = name
        }
        acc.name = name
      }
    }
    if (patch.type) acc.type = patch.type
    if (patch.currency) acc.currency = patch.currency
    if (patch.cardTheme) acc.cardTheme = patch.cardTheme
    if (patch.showCard !== undefined) acc.showCard = patch.showCard
    if (patch.openingBalance !== undefined) acc.openingBalance = patch.openingBalance
    if (patch.openingDate !== undefined) acc.openingDate = patch.openingDate
    if (patch.aliases) acc.aliases = patch.aliases.map((x) => x.trim()).filter(Boolean)
  }

  function removeAccount(id: string) {
    state.value.config.accounts = state.value.config.accounts.filter((a) => a.id !== id)
    if (state.value.config.defaultAccountId === id) delete state.value.config.defaultAccountId
  }

  /** Conto proposto per le nuove voci; `null` toglie la preferenza. */
  function setDefaultAccount(id: string | null) {
    if (id && state.value.config.accounts.some((a) => a.id === id)) state.value.config.defaultAccountId = id
    else delete state.value.config.defaultAccountId
  }
  /** Nome del conto predefinito, se configurato. */
  const defaultAccountName = () => state.value.config.accounts.find((a) => a.id === state.value.config.defaultAccountId)?.name ?? null

  function moveAccount(id: string, delta: -1 | 1) {
    const list = state.value.config.accounts
    const i = list.findIndex((a) => a.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
  }

  // ---- Categorie -----------------------------------------------------------
  function findCategory(kind: CategoryKind, name: string): CategoryConfig | undefined {
    const n = norm(name)
    return state.value.config.categories.find((c) => c.kind === kind && (norm(c.name) === n || c.aliases.some((a) => norm(a) === n)))
  }

  const nextColor = (kind: CategoryKind) => pickCategoryColor(state.value.config.categories, kind)

  function addCategory(
    kind: CategoryKind,
    name: string,
    opts: { color?: string; icon?: string; defaultExpenseType?: ExpenseType; subcategories?: string[] } | string = {},
  ): CategoryConfig {
    const o = typeof opts === 'string' ? { color: opts } : opts
    const n = name.trim()
    if (!n) throw new LedgerError('Il nome della categoria è obbligatorio.')
    if (findCategory(kind, n)) throw new LedgerError(`La categoria «${n}» esiste già.`)
    const subs = [...new Map((o.subcategories ?? []).map((s) => s.trim()).filter(Boolean).map((s) => [norm(s), s])).values()]
    const cat: CategoryConfig = {
      id: uid(),
      name: n,
      kind,
      color: o.color ?? nextColor(kind),
      aliases: [],
      subcategories: subs.map((s) => ({ id: uid(), name: s, aliases: [] })),
      ...(o.icon ? { icon: o.icon } : {}),
      ...(kind === 'expense' && o.defaultExpenseType ? { defaultExpenseType: o.defaultExpenseType } : {}),
    }
    state.value.config.categories.push(cat)
    return state.value.config.categories[state.value.config.categories.length - 1]
  }

  function updateCategory(id: string, patch: { name?: string; color?: string; defaultExpenseType?: ExpenseType; icon?: string }) {
    const cat = state.value.config.categories.find((c) => c.id === id)
    if (!cat) return
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new LedgerError('Il nome della categoria è obbligatorio.')
      const clash = findCategory(cat.kind, name)
      if (clash && clash.id !== id) throw new LedgerError(`La categoria «${name}» esiste già.`)
      if (name !== cat.name) {
        const old = cat.name
        cat.aliases = [...new Set([...cat.aliases.filter((x) => norm(x) !== norm(name)), old])]
        for (const e of state.value.entries) if (e.category === old && kindOf(e) === cat.kind) e.category = name
        const inv = state.value.investments ?? {}
        for (const key of Object.keys(inv)) {
          const [c, sub = ''] = key.split('␟')
          if (c === old) moveInvestment(key, subKey(name, sub))
        }
        cat.name = name
      }
    }
    if (patch.color) cat.color = patch.color
    if (patch.defaultExpenseType) cat.defaultExpenseType = patch.defaultExpenseType
    if (patch.icon) cat.icon = patch.icon
  }

  function removeCategory(id: string) {
    state.value.config.categories = state.value.config.categories.filter((c) => c.id !== id)
  }

  function addSubcategory(categoryId: string, name: string) {
    const cat = state.value.config.categories.find((c) => c.id === categoryId)
    const n = name.trim()
    if (!cat) return
    if (!n) throw new LedgerError('Il nome della sotto-categoria è obbligatorio.')
    if (cat.subcategories.some((s) => norm(s.name) === norm(n))) throw new LedgerError(`«${n}» esiste già in ${cat.name}.`)
    cat.subcategories.push({ id: uid(), name: n, aliases: [] })
  }

  function renameSubcategory(categoryId: string, subId: string, name: string) {
    const cat = state.value.config.categories.find((c) => c.id === categoryId)
    const sub = cat?.subcategories.find((s) => s.id === subId)
    const n = name.trim()
    if (!cat || !sub) return
    if (!n) throw new LedgerError('Il nome della sotto-categoria è obbligatorio.')
    if (cat.subcategories.some((s) => s.id !== subId && norm(s.name) === norm(n))) throw new LedgerError(`«${n}» esiste già in ${cat.name}.`)
    if (n === sub.name) return
    const old = sub.name
    sub.aliases = [...new Set([...sub.aliases.filter((x) => norm(x) !== norm(n)), old])]
    for (const e of state.value.entries) if (e.category === cat.name && e.subcategory === old) e.subcategory = n
    moveInvestment(subKey(cat.name, old), subKey(cat.name, n))
    sub.name = n
  }

  function removeSubcategory(categoryId: string, subId: string) {
    const cat = state.value.config.categories.find((c) => c.id === categoryId)
    if (cat) cat.subcategories = cat.subcategories.filter((s) => s.id !== subId)
  }

  // ---- Investimenti --------------------------------------------------------
  /** Salva (sostituendo) i dati dello strumento collegato alla posizione. */
  function setInvestment(key: string, cfg: InvestmentConfig) {
    const inv = (state.value.investments ??= {})
    const next = { ...cfg, ticker: cfg.ticker.trim().toUpperCase(), isin: cfg.isin?.trim().toUpperCase() || undefined, updatedAt: cfg.updatedAt ?? new Date().toISOString() }
    // Dati identici (es. riletti dal foglio a ogni apertura): nessuna modifica, così la configurazione
    // locale non risulta «più recente» e non sovrascrive quella salvata da altri dispositivi.
    const prev = inv[key]
    if (prev && sameJson(cfg.updatedAt ? prev : { ...prev, updatedAt: undefined }, cfg.updatedAt ? next : { ...next, updatedAt: undefined })) return
    inv[key] = next
  }

  function removeInvestment(key: string) {
    if (state.value.investments) delete state.value.investments[key]
  }

  function moveInvestment(from: string, to: string) {
    const inv = state.value.investments
    if (!inv?.[from] || from === to) return
    inv[to] = inv[from]
    delete inv[from]
  }

  /** Ridistribuisce i colori: ogni categoria una tinta diversa, nell'ordine della palette. */
  function recolorCategories() {
    for (const kind of ['expense', 'income'] as const) {
      const used: CategoryConfig[] = []
      for (const c of state.value.config.categories.filter((x) => x.kind === kind)) {
        c.color = pickCategoryColor(used, kind)
        used.push(c)
      }
    }
  }

  /** Quante voci manuali usano un conto o una categoria (per le conferme). */
  function usage(kind: 'account' | 'category', name: string): number {
    return state.value.entries.filter((e) => (kind === 'account' ? e.account === name || (e.kind === 'transfer' && e.toAccount === name) : e.category === name)).length
  }

  // ---- Import / backup ------------------------------------------------------
  function seedFrom(ds: FinanceDataset): number {
    const { categories, added } = seedCategories(state.value.config, ds)
    state.value.config.categories = categories
    state.value.seeded = true
    return added
  }

  function exportJson(): string {
    return JSON.stringify(state.value, null, 2)
  }

  function importJson(text: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new LedgerError('Il file non è un JSON valido.')
    }
    if (!isLedgerState(parsed)) throw new LedgerError('Il file non è un backup del registro finanze.')
    parsed.investments ??= {}
    // Il backup ripristinato va salvato anche sul foglio.
    parsed.outbox = { ...(parsed.outbox ?? {}), ...Object.fromEntries(parsed.entries.map((e) => [e.id, 'upsert' as const])) }
    // Il ripristino deve prevalere sul foglio: si conserva l'ultimo allineamento noto.
    parsed.configSyncedAt = state.value.configSyncedAt
    state.value = parsed
    state.value.updatedAt = new Date().toISOString()
  }

  function reset() {
    state.value = { ...defaultLedger(), outbox: {}, removedPlans: (state.value.plans ?? []).map((p) => p.id), configSyncedAt: state.value.configSyncedAt, updatedAt: new Date().toISOString() }
  }

  return {
    state, saveFailed,
    addEntry, updateEntry, removeEntry, isManual,
    pendingCount, pendingChanges, markSent, pruneSaved, cloudConfig, applyCloudConfig, mergeCloudConfig, markConfigSynced,
    addPlan, updatePlan, setPlanActive, removePlan, runPlans,
    addAccount, updateAccount, removeAccount, moveAccount, setDefaultAccount, defaultAccountName, nextColor,
    setInvestment, removeInvestment, recolorCategories,
    findCategory, addCategory, updateCategory, removeCategory, addSubcategory, renameSubcategory, removeSubcategory, usage,
    seedFrom, exportJson, importJson, reset,
  }
})

const kindOf = (op: Operation): CategoryKind | 'transfer' => (op.kind === 'income' ? 'income' : op.kind === 'expense' ? 'expense' : 'transfer')
