import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  appEntryId,
  applyFilters,
  applyLedger,
  computeAccountBalances,
  computeBalanceSeries,
  computeFlowSummary,
  computeMonthlyFlows,
  computeNetWorth,
  defaultFilters,
  diffDatasets,
  importFinanceSheets,
  monthOf,
  monthRange,
  resolvePeriod,
  splitSubKey,
  subKey,
  type FinanceDataset,
  type FinanceFilters,
  type ImportIssue,
  type SheetStats,
  type CloudConfig,
  type SyncDiff,
} from '../domain'
import { fetchFinanceSync, FinanceApiError } from '../data/financeApi'
import { deleteEntries, getRemoteConfig, pushEntries, putRemoteConfig } from '../data/ledgerApi'
import { buildDemoSheets } from '../data/demo'
import { readJson, removeKey, writeJson } from '@/core/utils/storage'
import { todayIso } from '@/core/utils/format'
import { useLedgerStore } from './ledgerStore'
import { useAuthStore } from '@/app/auth/authStore'

export type DataSource = 'sheets' | 'demo'

interface CachedState {
  version: 1
  dataset: FinanceDataset
  issues: ImportIssue[]
  stats: SheetStats[]
  source: DataSource
  lastSyncAt: string
  spreadsheetTitle?: string
}

const CACHE_KEY = 'gp.finance.cache.v1'
const FILTERS_KEY = 'gp.finance.filters.v1'

/** Errori per cui ha senso proporre i dati demo (backend non configurato/raggiungibile). */
export const BACKEND_MISSING = new Set(['not_configured', 'unavailable', 'network'])

/** Stato del salvataggio sul foglio Google delle modifiche fatte nell'app. */
export interface CloudStatus {
  state: 'idle' | 'saving' | 'saved' | 'error' | 'needs-token'
  message?: string
  at?: string
}

export const useFinanceStore = defineStore('finance', () => {
  // ---- Stato --------------------------------------------------------------
  /** Dati così come arrivano dal foglio (o dalla demo), salvati in cache. */
  const rawDataset = shallowRef<FinanceDataset | null>(null)
  const ledger = useLedgerStore()
  /** Dati effettivi: foglio + configurazione locale + voci manuali. */
  const dataset = computed<FinanceDataset>(() => applyLedger(rawDataset.value, ledger.state))
  const issues = shallowRef<ImportIssue[]>([])
  const stats = shallowRef<SheetStats[]>([])
  const source = ref<DataSource | null>(null)
  const spreadsheetTitle = ref<string>()
  const lastSyncAt = ref<string | null>(null)
  const lastDiff = ref<SyncDiff | null>(null)
  const syncing = ref(false)
  const error = ref<{ code: string; message: string } | null>(null)
  /** Token del login, condiviso con tutta l'app. */
  const auth = useAuthStore()
  const accessToken = computed(() => auth.token)
  const initialized = ref(false)

  const filters = ref<FinanceFilters>({ ...defaultFilters(), ...(readJson<Partial<FinanceFilters>>(FILTERS_KEY) ?? {}) })
  watch(filters, (f) => writeJson(FILTERS_KEY, f), { deep: true })

  // ---- Azioni -------------------------------------------------------------
  function persist() {
    if (!rawDataset.value || !source.value || !lastSyncAt.value) return
    const cached: CachedState = {
      version: 1,
      dataset: rawDataset.value,
      issues: issues.value,
      stats: stats.value,
      source: source.value,
      lastSyncAt: lastSyncAt.value,
      spreadsheetTitle: spreadsheetTitle.value,
    }
    writeJson(CACHE_KEY, cached)
  }

  function apply(next: { dataset: FinanceDataset; issues: ImportIssue[]; stats: SheetStats[] }, src: DataSource, at: string, title?: string) {
    // Il diff ha senso solo tra import della stessa sorgente.
    lastDiff.value = diffDatasets(source.value === src ? rawDataset.value : null, next.dataset)
    rawDataset.value = next.dataset
    issues.value = next.issues
    stats.value = next.stats
    source.value = src
    lastSyncAt.value = at
    spreadsheetTitle.value = title
    pruneFilters()
    persist()
    autoSeed()
  }

  /** Al primo sync dal foglio, importa le sue categorie nella configurazione locale. */
  function autoSeed() {
    if (source.value === 'sheets' && rawDataset.value && !ledger.state.seeded) ledger.seedFrom(dataset.value)
  }

  /** Rimuove dai filtri valori che non esistono più nel dataset. */
  function pruneFilters() {
    const ds = dataset.value
    if (!ds) return
    const f = filters.value
    const accounts = new Set(ds.accounts.map((a) => a.name))
    const cats = new Set(ds.operations.map((o) => o.category))
    const subs = new Set(ds.operations.map((o) => subKey(o.category, o.subcategory)))
    const curs = new Set(ds.operations.map((o) => o.currency))
    f.accounts = f.accounts.filter((a) => accounts.has(a))
    f.categories = f.categories.filter((c) => cats.has(c))
    f.subcategories = f.subcategories.filter((s) => subs.has(s))
    f.currencies = f.currencies.filter((c) => curs.has(c))
  }

  // ---- Salvataggio sul foglio ---------------------------------------------
  const cloud = ref<CloudStatus>({ state: 'idle' })

  /**
   * Allinea la configurazione (la più recente vince) e invia le voci in coda.
   * Gli errori non bloccano la lettura del foglio: restano in `cloud` e la coda
   * viene ritentata alla sincronizzazione successiva.
   */
  async function flushToSheet(): Promise<void> {
    const token = accessToken.value
    if (!token) {
      cloud.value = { state: 'needs-token', message: 'Accedi con il token per salvare i dati sul foglio Google.' }
      return
    }
    cloud.value = { state: 'saving' }
    try {
      // 1) Configurazione: conti, categorie, icone, saldi iniziali, investimenti.
      // Si confronta ciascun lato con l'ultimo allineamento (non solo gli orari): così un dispositivo
      // rimasto indietro non sovrascrive il foglio, e le modifiche fatte altrove non si perdono.
      const remote = await getRemoteConfig(token)
      const local = ledger.state
      const remoteChanged = !!remote.config && !!remote.updatedAt && remote.updatedAt !== local.configSyncedAt
      const localChanged = !!local.updatedAt && local.updatedAt !== local.configSyncedAt
      if (remoteChanged && !localChanged) {
        ledger.applyCloudConfig(remote.config as CloudConfig, remote.updatedAt!)
      } else if (remoteChanged && localChanged) {
        const at = ledger.mergeCloudConfig(remote.config as CloudConfig, remote.updatedAt!)
        await putRemoteConfig(ledger.cloudConfig(), at, token)
        ledger.markConfigSynced(at)
      } else if (localChanged || !remote.updatedAt) {
        const at = local.updatedAt ?? new Date().toISOString()
        if (!local.updatedAt) local.updatedAt = at
        await putRemoteConfig(ledger.cloudConfig(), at, token)
        ledger.markConfigSynced(at)
      }
      // 2) Voci inserite, modificate o eliminate nell'app.
      const { box, upserts, deletes } = ledger.pendingChanges()
      if (upserts.length) await pushEntries(upserts, token)
      if (deletes.length) await deleteEntries(deletes, token)
      ledger.markSent(box)
      cloud.value = { state: 'saved', at: new Date().toISOString() }
    } catch (e) {
      const err = e instanceof FinanceApiError ? e : new FinanceApiError('unknown', (e as Error).message)
      cloud.value = { state: err.code === 'unauthorized' ? 'needs-token' : 'error', message: err.message }
    }
  }

  async function sync(): Promise<boolean> {
    if (syncing.value) return false
    syncing.value = true
    error.value = null
    try {
      await flushToSheet()
      const res = await fetchFinanceSync(accessToken.value || undefined)
      apply(res, 'sheets', res.fetchedAt, res.spreadsheetTitle)
      if (cloud.value.state === 'saved') ledger.pruneSaved(res.dataset.operations)
      runPlans()
      return true
    } catch (e) {
      error.value = e instanceof FinanceApiError ? { code: e.code, message: e.message } : { code: 'unknown', message: (e as Error).message }
      return false
    } finally {
      syncing.value = false
      // Modifiche fatte durante la sincronizzazione: si salvano subito dopo.
      // Solo dopo un salvataggio riuscito, per non riprovare all'infinito in caso di errore.
      if (cloud.value.state === 'saved' && hasUnsaved()) scheduleAutosave()
    }
  }

  // Dopo ogni modifica (voce, conto, categoria…) si salva da soli sul foglio.
  let autoTimer: ReturnType<typeof setTimeout> | undefined
  const hasUnsaved = () => !!ledger.pendingCount() || ledger.state.updatedAt !== ledger.state.configSyncedAt
  function scheduleAutosave() {
    if (source.value !== 'sheets') return
    clearTimeout(autoTimer)
    autoTimer = setTimeout(async () => {
      // Sincronizzazione in corso: si riprova al termine (vedi `sync`).
      if (syncing.value) return
      // Niente da salvare (es. la coda si è appena svuotata): nessuna richiesta.
      if (!hasUnsaved()) return
      await sync()
    }, 2000)
  }
  watch(() => [ledger.pendingCount(), ledger.state.updatedAt], scheduleAutosave)

  /**
   * Crea le voci dei piani di accumulo scadute fino a oggi. Gli addebiti già presenti
   * (in locale o letti dal foglio) hanno lo stesso ID e non vengono ricreati.
   */
  function runPlans(): number {
    if (source.value === 'demo') return 0
    const existing = new Set((rawDataset.value?.operations ?? []).map((o) => appEntryId(o.id)).filter((x): x is string => !!x))
    const ds = dataset.value
    const nameOf = (key: string) => {
      const { category, subcategory } = splitSubKey(key)
      return (subcategory || category).replace(/^\p{Extended_Pictographic}️?\s*/u, '')
    }
    const currencyOf = (account: string) => ds.accounts.find((a) => a.name === account)?.currency ?? 'EUR'
    return ledger.runPlans(todayIso(), existing, nameOf, currencyOf)
  }

  function loadDemo() {
    const result = importFinanceSheets(buildDemoSheets(), { baseCurrency: 'EUR' })
    apply(result, 'demo', new Date().toISOString(), 'Dati dimostrativi')
  }

  function clearData() {
    rawDataset.value = null
    issues.value = []
    stats.value = []
    source.value = null
    lastSyncAt.value = null
    lastDiff.value = null
    removeKey(CACHE_KEY)
  }

  function resetFilters() {
    filters.value = defaultFilters()
  }

  /** Avvio: mostra subito la cache, poi aggiorna da Google Sheets. */
  async function init() {
    if (initialized.value) return
    initialized.value = true
    const cached = readJson<CachedState>(CACHE_KEY)
    if (cached?.version === 1 && cached.dataset) {
      rawDataset.value = cached.dataset
      issues.value = cached.issues
      stats.value = cached.stats
      source.value = cached.source
      lastSyncAt.value = cached.lastSyncAt
      spreadsheetTitle.value = cached.spreadsheetTitle
    }
    if (source.value === 'demo') return
    const ok = await sync()
    autoSeed()
    if (!ok && !rawDataset.value && error.value && BACKEND_MISSING.has(error.value.code)) loadDemo()
  }

  // ---- Derivati (tutti i calcoli passano dal dominio) ----------------------
  const today = ref(todayIso())
  const range = computed(() => resolvePeriod(filters.value, today.value))
  const operations = computed(() => dataset.value?.operations ?? [])
  const filteredOperations = computed(() => (dataset.value ? applyFilters(operations.value, filters.value, today.value) : []))
  const flowSummary = computed(() => (dataset.value ? computeFlowSummary(dataset.value, filteredOperations.value) : null))

  /** I saldi seguono solo la data finale del periodo e il filtro conti. */
  const balanceAsOf = computed(() => (range.value.to && range.value.to < today.value ? range.value.to : undefined))
  const balances = computed(() =>
    dataset.value ? computeAccountBalances(dataset.value, { asOf: balanceAsOf.value, useMarketValue: !balanceAsOf.value }) : [],
  )
  const netWorth = computed(() =>
    dataset.value ? computeNetWorth(dataset.value, balances.value, { asOf: balanceAsOf.value, accounts: filters.value.accounts }) : null,
  )

  const months = computed(() => {
    const ops = operations.value
    if (!ops.length) return []
    const from = monthOf(range.value.from ?? ops[0].date)
    const lastOp = ops[ops.length - 1].date
    const to = monthOf(range.value.to ?? (lastOp > today.value ? lastOp : today.value))
    return monthRange(from, to)
  })
  const monthlyFlows = computed(() => (dataset.value ? computeMonthlyFlows(dataset.value, filteredOperations.value, months.value) : []))
  const balanceSeries = computed(() => (dataset.value ? computeBalanceSeries(dataset.value, months.value, filters.value.accounts) : []))

  // ---- Opzioni per i filtri ----------------------------------------------
  const accountNames = computed(() => dataset.value?.accounts.map((a) => a.name) ?? [])
  const categories = computed(() => [...new Set(operations.value.map((o) => o.category))].sort((a, b) => a.localeCompare(b, 'it')))
  const subcategoryKeys = computed(() => {
    const keys = new Set<string>()
    for (const o of operations.value) if (o.subcategory) keys.add(subKey(o.category, o.subcategory))
    return [...keys]
      .map((k) => ({ key: k, ...splitSubKey(k) }))
      .sort((a, b) => a.category.localeCompare(b.category, 'it') || a.subcategory.localeCompare(b.subcategory, 'it'))
  })
  const currencies = computed(() => {
    const set = new Set<string>()
    operations.value.forEach((o) => {
      set.add(o.currency)
      if (o.kind === 'transfer') set.add(o.toCurrency)
    })
    return [...set].sort()
  })

  const errorCount = computed(() => issues.value.filter((i) => i.severity === 'error').length)
  const warningCount = computed(() => issues.value.filter((i) => i.severity === 'warning').length)
  const baseCurrency = computed(() => dataset.value?.baseCurrency ?? 'EUR')
  /** Errore da mostrare in evidenza: in modalità demo l'assenza del backend è già spiegata. */
  const blockingError = computed(() =>
    error.value && !(source.value === 'demo' && BACKEND_MISSING.has(error.value.code)) && error.value.code !== 'not_configured' ? error.value : null,
  )

  return {
    // stato
    dataset, rawDataset, issues, stats, source, spreadsheetTitle, lastSyncAt, lastDiff, syncing, error, accessToken, filters, today, cloud,
    // azioni
    init, sync, loadDemo, clearData, resetFilters, runPlans,
    // derivati
    range, operations, filteredOperations, flowSummary, balanceAsOf, balances, netWorth, months, monthlyFlows, balanceSeries,
    accountNames, categories, subcategoryKeys, currencies, errorCount, warningCount, baseCurrency, blockingError,
  }
})
