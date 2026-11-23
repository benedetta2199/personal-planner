import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { readJson, writeJson } from '@/core/utils/storage'
import { todayIso } from '@/core/utils/format'
import { buildResolver, computePortfolioSeries, computePositions, groupInvestmentOps, splitSubKey, subKey, summarizePortfolio, type InvestmentConfig, type QuoteSeries } from '../domain'
import { fetchQuotes } from '../data/quotesApi'
import { deleteInstrument, listInstruments, saveInstrument } from '../data/investmentsApi'
import { FinanceApiError } from '../data/financeApi'
import { useFinanceStore } from './financeStore'
import { useLedgerStore } from './ledgerStore'

const KEY = 'gp.finance.quotes.v1'
/** Le quotazioni si aggiornano da sole se più vecchie di così (o di un altro giorno). */
const MAX_AGE_MS = 60 * 60 * 1000

interface QuotesCache {
  fetchedAt: string
  from: string
  base: string
  quotes: Record<string, QuoteSeries>
  errors: Record<string, string>
}

export const useInvestmentStore = defineStore('finance-investments', () => {
  const finance = useFinanceStore()
  const ledger = useLedgerStore()

  const cache = shallowRef<QuotesCache | null>(readJson<QuotesCache>(KEY))
  const loading = ref(false)
  const error = ref<{ code: string; message: string } | null>(null)

  const groups = computed(() => groupInvestmentOps(finance.dataset))
  const configs = computed(() => ledger.state.investments ?? {})
  const symbols = computed(() => {
    const keys = new Set(groups.value.map((g) => g.key))
    return [...new Set(Object.entries(configs.value).filter(([k, c]) => keys.has(k) && c.ticker).map(([, c]) => c.ticker))].sort()
  })
  const from = computed(() => groups.value.reduce((m, g) => (g.events[0].date < m ? g.events[0].date : m), todayIso()))

  const quotes = computed(() => cache.value?.quotes ?? {})
  const errors = computed(() => cache.value?.errors ?? {})
  const positions = computed(() => computePositions(groups.value, configs.value, quotes.value, errors.value))
  const summary = computed(() => summarizePortfolio(positions.value))
  const series = computed(() => computePortfolioSeries(groups.value, configs.value, quotes.value, todayIso()))
  const fetchedAt = computed(() => cache.value?.fetchedAt ?? null)

  function isStale(): boolean {
    const c = cache.value
    if (!symbols.value.length) return false
    if (!c || c.base !== finance.baseCurrency || c.from > from.value) return true
    if (symbols.value.some((s) => !(s in c.quotes) && !(s in c.errors))) return true
    if (c.fetchedAt.slice(0, 10) !== new Date().toISOString().slice(0, 10)) return true
    return Date.now() - new Date(c.fetchedAt).getTime() > MAX_AGE_MS
  }

  async function refresh(force = false): Promise<void> {
    if (loading.value || !symbols.value.length) return
    if (!force && !isStale()) return
    loading.value = true
    error.value = null
    try {
      const res = await fetchQuotes(symbols.value, from.value, finance.baseCurrency, finance.accessToken || undefined)
      cache.value = { fetchedAt: res.fetchedAt, from: from.value, base: res.baseCurrency, quotes: res.quotes, errors: res.errors }
      writeJson(KEY, cache.value)
    } catch (e) {
      error.value = e instanceof FinanceApiError ? { code: e.code, message: e.message } : { code: 'unknown', message: (e as Error).message }
    } finally {
      loading.value = false
    }
  }

  // ---- Archivio strumenti sul Google Sheet dedicato --------------------------
  /** synced = allineato al foglio; local = salvato solo in questo browser. */
  const sheet = ref<{ state: 'unknown' | 'synced' | 'local' | 'error'; message?: string }>({ state: 'unknown' })
  const NOT_CONFIGURED = new Set(['not_configured', 'token_not_configured', 'unavailable'])

  function noteSheetError(e: unknown) {
    const code = e instanceof FinanceApiError ? e.code : 'unknown'
    const message = (e as Error).message
    sheet.value = NOT_CONFIGURED.has(code)
      ? { state: 'local', message: 'Google Sheet degli investimenti non configurato (INVESTMENTS_SHEET_ID): i dati restano solo in questo browser.' }
      : { state: 'error', message }
  }

  /** Scarica gli strumenti dal foglio: i dati del foglio prevalgono su quelli locali. */
  async function loadInstruments() {
    try {
      const { instruments } = await listInstruments(finance.accessToken || undefined)
      const r = buildResolver(ledger.state.config)
      for (const it of instruments) {
        const cat = r.category(it.category, 'expense')
        const key = subKey(cat, r.subcategory(cat, it.subcategory))
        ledger.setInvestment(key, it.instrument)
      }
      sheet.value = { state: 'synced' }
    } catch (e) {
      noteSheetError(e)
    }
  }

  /** Salva subito in locale, poi sul foglio. Restituisce true se il foglio è aggiornato. */
  async function saveInstrumentData(key: string, cfg: InvestmentConfig): Promise<boolean> {
    ledger.setInvestment(key, cfg)
    const { category, subcategory } = splitSubKey(key)
    try {
      await saveInstrument({ key, category, subcategory, instrument: ledger.state.investments![key] }, finance.accessToken || undefined)
      sheet.value = { state: 'synced' }
      return true
    } catch (e) {
      noteSheetError(e)
      return false
    }
  }

  async function removeInstrumentData(key: string): Promise<boolean> {
    ledger.removeInvestment(key)
    try {
      await deleteInstrument(key, finance.accessToken || undefined)
      sheet.value = { state: 'synced' }
      return true
    } catch (e) {
      noteSheetError(e)
      return false
    }
  }

  return { sheet, loadInstruments, saveInstrumentData, removeInstrumentData, loading, error, groups, symbols, positions, summary, series, quotes, fetchedAt, refresh, isStale }
})
