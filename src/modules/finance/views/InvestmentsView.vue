<script setup lang="ts">
/**
 * Portafoglio in stile app di brokeraggio: valore grande in alto, rendimento del
 * periodo, grafico pulito con selettore del periodo e lista compatta delle posizioni.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import { formatDate, formatDateTime, formatMoney, formatPercent, todayIso } from '@/core/utils/format'
import { INSTRUMENT_LABEL, computeLots, norm, splitSubKey, type InvestmentConfig, type Lot, type Operation, type PortfolioPoint, type Position } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { useInvestmentStore } from '../store/investmentStore'
import PortfolioChart from '../components/PortfolioChart.vue'
import DonutChart, { type DonutSegment } from '../components/DonutChart.vue'
import InstrumentDialog from '../components/InstrumentDialog.vue'
import PurchaseDialog from '../components/PurchaseDialog.vue'
import PlansPanel from '../components/PlansPanel.vue'
import EntryDialog from '../components/EntryDialog.vue'
import ValueAdjustDialog from '../components/ValueAdjustDialog.vue'
import { categoryColor, plainName, subcategoryColor } from '../presentation'

const finance = useFinanceStore()
const ledger = useLedgerStore()
const inv = useInvestmentStore()
const cur = computed(() => finance.baseCurrency)
const m = (v: number) => formatMoney(v, cur.value)
/** Importo con segno e freccia: il colore non è mai l'unica codifica. */
const signed = (v: number | null) => (v === null ? '—' : v > 0 ? `▲ +${m(v)}` : v < 0 ? `▼ −${m(-v)}` : m(0))
const pctFmt = new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Percentuale con segno e sempre due decimali; le variazioni che si arrotondano a zero non hanno segno («0,00%», non «-0%»). */
const pct = (v: number | null) => {
  if (v === null) return '—'
  if (Math.abs(v) < 0.00005) return pctFmt.format(0)
  return `${v > 0 ? '+' : '−'}${pctFmt.format(Math.abs(v))}`
}
const tone = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'pos' : 'neg')

onMounted(async () => {
  await inv.loadInstruments()
  await inv.refresh()
})
watch(() => inv.symbols.join(','), () => inv.refresh())

const s = computed(() => inv.summary)
const open = computed(() => inv.positions.filter((p) => !p.closed))
const closed = computed(() => inv.positions.filter((p) => p.closed))
const unlinked = computed(() => open.value.filter((p) => p.status === 'needs-data'))
const failed = computed(() => open.value.filter((p) => p.status === 'error'))
const priceDate = computed(() => open.value.find((p) => p.priceDate)?.priceDate ?? null)
const showClosed = ref(false)

// ---- Periodo del grafico -----------------------------------------------------
type Range = '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'MAX'
const RANGES: { value: Range; label: string; days?: number; caption: string }[] = [
  { value: '1W', label: '1S', days: 7, caption: 'nell’ultima settimana' },
  { value: '1M', label: '1M', days: 30, caption: 'nell’ultimo mese' },
  { value: '3M', label: '3M', days: 91, caption: 'negli ultimi 3 mesi' },
  { value: '6M', label: '6M', days: 182, caption: 'negli ultimi 6 mesi' },
  { value: 'YTD', label: 'YTD', caption: 'da inizio anno' },
  { value: '1Y', label: '1A', days: 365, caption: 'nell’ultimo anno' },
  { value: 'MAX', label: 'Max', caption: 'da sempre' },
]
const range = ref<Range>('MAX')
const rangeMeta = computed(() => RANGES.find((r) => r.value === range.value)!)

function cutoff(r: (typeof RANGES)[number]): string | null {
  const today = todayIso()
  if (r.value === 'MAX') return null
  if (r.value === 'YTD') return `${today.slice(0, 4)}-01-01`
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (r.days ?? 0))
  return d.toISOString().slice(0, 10)
}

const points = computed<PortfolioPoint[]>(() => {
  const from = cutoff(rangeMeta.value)
  const all = inv.series
  if (!from) return all
  // Includo l'ultimo punto prima del taglio come base del periodo.
  const startIdx = all.findIndex((p) => p.date >= from)
  if (startIdx < 0) return all.slice(-1)
  return all.slice(Math.max(0, startIdx - 1))
})

/**
 * Rendimento nel periodo al netto dei versamenti: variazione del guadagno
 * (valore − investito) tra inizio e fine, in % sul capitale esposto.
 */
function performance(pts: PortfolioPoint[], endIndex = pts.length - 1) {
  const end = pts[endIndex]
  if (!end) return { abs: null, pct: null }
  if (range.value === 'MAX' || pts.length < 2) {
    const abs = end.value - end.invested
    return { abs, pct: end.invested > 0 ? abs / end.invested : null }
  }
  const start = pts[0]
  const abs = end.value - end.invested - (start.value - start.invested)
  const base = start.value + Math.max(0, end.invested - start.invested)
  return { abs, pct: base > 0 ? abs / base : null }
}

const hover = ref<number | null>(null)
watch(range, () => (hover.value = null))
const hoverPoint = computed(() => (hover.value === null ? null : points.value[hover.value] ?? null))
const period = computed(() => performance(points.value))
const shown = computed(() => (hoverPoint.value ? performance(points.value, hover.value!) : period.value))
const shownValue = computed(() => hoverPoint.value?.value ?? s.value.value)
const periodPositive = computed(() => (period.value.abs ?? 0) >= 0)

// ---- Posizioni ----------------------------------------------------------------
type PerfMode = 'total' | 'today'
type SortMode = 'value' | 'perf' | 'name'
const perfMode = ref<PerfMode>('total')
const sortMode = ref<SortMode>('value')
const expanded = ref<string | null>(null)

const perfOf = (p: Position) => (perfMode.value === 'today' ? { abs: p.dayChange, pct: p.dayChangePct } : { abs: p.unrealized, pct: p.unrealizedPct })

const list = computed(() => {
  const rows = [...open.value]
  if (sortMode.value === 'name') rows.sort((a, b) => plainName(a.name).localeCompare(plainName(b.name), 'it'))
  else if (sortMode.value === 'perf') rows.sort((a, b) => (perfOf(b).pct ?? -Infinity) - (perfOf(a).pct ?? -Infinity))
  else rows.sort((a, b) => b.value - a.value)
  return rows
})

const colorOf = (p: Position) => subcategoryColor(ledger.state.config, p.category, p.name === p.category ? '' : p.name, 'expense')
const initials = (p: Position) => {
  const name = plainName(p.name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim()
  const words = name.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}
const weight = (p: Position) => (s.value.value > 0 ? p.value / s.value.value : 0)

const movers = computed(() =>
  open.value
    .filter((p) => p.dayChange)
    .sort((a, b) => Math.abs(b.dayChange!) - Math.abs(a.dayChange!))
    .slice(0, 4),
)

const segments = computed<DonutSegment[]>(() => {
  const byCat = new Map<string, Position[]>()
  for (const p of open.value) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p])
  return [...byCat.entries()]
    .map(([cat, ps]) => ({
      key: cat,
      label: cat,
      value: ps.reduce((a, p) => a + p.value, 0),
      color: categoryColor(ledger.state.config, cat, 'expense'),
      children: [...ps].sort((a, b) => b.value - a.value).map((p) => ({ key: p.key, label: plainName(p.name), value: p.value, color: colorOf(p) })),
    }))
    .sort((a, b) => b.value - a.value)
})

// ---- Acquisto / vendita (con commissione per azioni e obbligazioni) -----------
const purchaseOpen = ref(false)
const purchaseKey = ref<string | null>(null)
const tradeMode = ref<'buy' | 'sell' | 'saveback'>('buy')
function buy(p: Position | null = null) {
  tradeMode.value = 'buy'
  purchaseKey.value = p?.key ?? null
  purchaseOpen.value = true
}
function saveback(p: Position | null = null) {
  tradeMode.value = 'saveback'
  purchaseKey.value = p?.key ?? null
  purchaseOpen.value = true
}
function sell(p: Position | null = null) {
  tradeMode.value = 'sell'
  purchaseKey.value = p?.key ?? null
  purchaseOpen.value = true
}

// ---- Acquisti di un investimento: rendimento di ogni singolo addebito ---------
const lotsKey = ref<string>('')
const lotsItems = computed<ComboOption[]>(() =>
  [...open.value, ...closed.value].map((p) => ({ value: p.key, label: plainName(p.name), hint: `${INSTRUMENT_LABEL[p.type]}${p.closed ? ' · chiusa' : ''}` })),
)
watch(
  () => inv.positions.map((p) => p.key).join('|'),
  () => {
    if (!inv.positions.some((p) => p.key === lotsKey.value)) lotsKey.value = open.value[0]?.key ?? inv.positions[0]?.key ?? ''
  },
  { immediate: true },
)
const lotsPosition = computed(() => inv.positions.find((p) => p.key === lotsKey.value) ?? null)
const lotsGroup = computed(() => inv.groups.find((g) => g.key === lotsKey.value) ?? null)
const lots = computed(() => {
  const p = lotsPosition.value
  const g = lotsGroup.value
  if (!p || !g) return []
  return computeLots(g, p, p.ticker ? inv.quotes[p.ticker] : undefined).reverse()
})
const lotSales = computed(() => (lotsGroup.value?.events ?? []).filter((e) => e.kind === 'sell').slice().reverse())
async function showLots(p: Position) {
  lotsKey.value = p.key
  await nextTick()
  document.getElementById('iv-lots')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const shareText = (r: number) => (r >= 0.999 ? '' : r <= 0.001 ? 'venduto' : `${formatPercent(r, 0)} posseduto`)

// ---- Nuovo investimento -------------------------------------------------------
/** Categoria di uscita usata per gli investimenti (tipologia «Investimento»). */
const investmentCategory = computed(
  () => ledger.state.config.categories.find((c) => c.kind === 'expense' && c.defaultExpenseType === 'investment')?.name ?? null,
)
const creatingNew = ref(false)
function newInvestment() {
  // Al primo investimento la categoria viene creata da sola.
  if (!investmentCategory.value) ledger.addCategory('expense', 'Investimenti', { defaultExpenseType: 'investment', icon: '📈' })
  editing.value = null
  creatingNew.value = true
  dialog.value = true
}
/** Dopo aver creato lo strumento si propone subito il primo acquisto. */
function onInstrumentSaved(key: string) {
  inv.refresh()
  if (!creatingNew.value) return
  creatingNew.value = false
  tradeMode.value = 'buy'
  purchaseKey.value = key
  purchaseOpen.value = true
}

/** Strumento configurato ma ancora senza acquisti: posizione vuota, acquistabile. */
function emptyPosition(key: string, cfg: InvestmentConfig): Position {
  const { category, subcategory } = splitSubKey(key)
  const today = todayIso()
  return {
    key, category, name: subcategory || category, type: cfg.type ?? 'etf', ticker: cfg.ticker || null, isin: cfg.isin || null,
    quoteName: cfg.name ?? null, status: 'pending', buys: 0, sells: 0, invested: 0, withdrawn: 0, saveback: 0, costBasis: 0, realized: 0,
    units: null, unitsManual: false, adjustment: 0, price: null, priceIsPct: cfg.type === 'bond', priceDate: null, accrued: null,
    maturity: cfg.maturity ?? null, matured: false, value: 0, unrealized: null, unrealizedPct: null, dayChange: null,
    dayChangePct: null, firstDate: today, lastDate: today, closed: false,
  }
}
/** Posizioni acquistabili: quelle esistenti più gli strumenti appena configurati. */
const buyable = computed(() => {
  const known = new Set(inv.positions.map((p) => p.key))
  const extra = Object.entries(ledger.state.investments ?? {})
    .filter(([key]) => !known.has(key))
    .map(([key, cfg]) => emptyPosition(key, cfg))
  return [...inv.positions, ...extra]
})

// ---- Piani di accumulo: pannello riutilizzato anche nella pagina vuota ----------
const plansPanel = ref<InstanceType<typeof PlansPanel> | null>(null)
function newPlan(p: Position) {
  plansPanel.value?.newPlan(p.key)
}

// ---- Acquisto cliccato: si apre la voce per vederla o modificarla ------------------
const entryOpen = ref(false)
const entryOp = ref<Operation | null>(null)
function openLot(l: Lot) {
  const op = l.opId ? finance.dataset.operations.find((o) => o.id === l.opId) : undefined
  if (!op) return
  entryOp.value = op
  entryOpen.value = true
}
const lotEditable = (l: Lot) => !!l.opId && ledger.isManual(l.opId)

// ---- Quanto hai investito / speso davvero --------------------------------------------
/** Commissioni pagate per la posizione (voci «Commissioni › nome posizione»). */
function feesOf(p: Position): number {
  const name = norm(splitSubKey(p.key).subcategory || p.category)
  return finance.dataset.operations
    .filter((o) => o.kind === 'expense' && norm(o.category) === 'commissioni' && norm(o.subcategory) === name)
    .reduce((a, o) => a + o.amount, 0)
}
/** Denaro uscito di tasca: acquisti (saveback esclusi) più commissioni. */
const spentOf = (p: Position) => p.invested - p.saveback + feesOf(p)

const dialog = ref(false)
const editing = ref<Position | null>(null)
function link(p: Position) {
  creatingNew.value = false
  editing.value = p
  dialog.value = true
}
/** Allineamento manuale del valore a quello del broker. */
const adjustOpen = ref(false)
const adjusting = ref<Position | null>(null)
function adjust(p: Position) {
  adjusting.value = p
  adjustOpen.value = true
}
const unitsText = (u: number | null) => (u === null ? '—' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: u < 1 ? 6 : 4 }).format(u))
const priceText = (p: Position) =>
  p.price === null
    ? '—'
    : p.priceIsPct
      ? `${p.price.toLocaleString('it-IT', { maximumFractionDigits: 2 })} %`
      : new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur.value, maximumFractionDigits: p.price < 1 ? 6 : 2 }).format(p.price)
</script>

<template>
  <div class="iv">
    <UiEmpty v-if="!inv.positions.length" title="Nessun investimento nel bilancio" icon="trend">
      Aggiungi un investimento (ETF, azione o obbligazione) cercandolo per ISIN, poi registra il primo acquisto.
      Compaiono qui anche le uscite di tipologia «Investimento» del foglio.
      <template #actions>
        <UiButton variant="primary" icon="plus" @click="newInvestment">Nuovo investimento</UiButton>
        <UiButton v-if="buyable.length" icon="plus" @click="buy()">Registra un acquisto</UiButton>
      </template>
    </UiEmpty>
    <div v-if="!inv.positions.length" class="iv__emptyplans">
      <PlansPanel ref="plansPanel" :positions="buyable" @new-investment="newInvestment" />
    </div>

    <template v-else>
      <div class="iv__grid">
        <div class="iv__main">
          <!-- Valore e grafico ------------------------------------------------>
          <section class="panel port" aria-labelledby="iv-value">
            <div class="port__head">
              <div>
                <p id="iv-value" class="port__label">Portafoglio</p>
                <p class="port__value big-num num">{{ m(shownValue) }}</p>
                <p class="port__perf num" :class="tone(shown.abs)">
                  {{ signed(shown.abs) }} <span class="port__pct">({{ pct(shown.pct) }})</span>
                  <span class="port__when">{{ hoverPoint ? formatDate(hoverPoint.date) : rangeMeta.caption }}</span>
                </p>
              </div>
              <div class="port__actions">
                <UiButton size="sm" variant="ghost" icon="refresh" :loading="inv.loading" :disabled="!inv.symbols.length" @click="inv.refresh(true)">Aggiorna</UiButton>
                <UiButton size="sm" variant="ghost" icon="plus" @click="newInvestment">Nuovo investimento</UiButton>
                <UiButton size="sm" icon="arrowUpRight" :disabled="!open.length" @click="sell()">Vendi</UiButton>
                <UiButton size="sm" icon="plus" @click="saveback()">Saveback</UiButton>
                <UiButton size="sm" variant="primary" icon="plus" @click="buy()">Acquista</UiButton>
              </div>
            </div>

            <PortfolioChart v-if="points.length > 1" :points="points" :positive="periodPositive" @hover="hover = $event" />
            <p v-else class="muted small port__nochart">Dati insufficienti per il grafico in questo periodo.</p>

            <div class="ranges" role="radiogroup" aria-label="Periodo del grafico">
              <button
                v-for="r in RANGES"
                :key="r.value"
                type="button"
                role="radio"
                class="ranges__opt"
                :class="{ 'ranges__opt--on': range === r.value }"
                :aria-checked="range === r.value"
                @click="range = r.value"
              >
                {{ r.label }}
              </button>
            </div>

            <dl class="kpis">
              <div>
                <dt>Investito</dt>
                <dd class="num">{{ m(s.costBasis) }}</dd>
              </div>
              <div>
                <dt>Rendimento</dt>
                <dd class="num" :class="tone(s.unrealized)">{{ signed(s.unrealized) }} <small>{{ pct(s.unrealizedPct) }}</small></dd>
              </div>
              <div>
                <dt>Oggi</dt>
                <dd class="num" :class="tone(s.dayChange)">{{ signed(s.dayChange) }} <small v-if="s.dayChangePct !== null">{{ pct(s.dayChangePct) }}</small></dd>
              </div>
              <div>
                <dt>Realizzato</dt>
                <dd class="num" :class="tone(s.realized)">{{ signed(s.realized) }}</dd>
              </div>
            </dl>
            <p class="muted small port__meta">
              <template v-if="inv.loading">Aggiornamento quotazioni…</template>
              <template v-else-if="inv.fetchedAt">Quotazioni aggiornate {{ formatDateTime(inv.fetchedAt) }}<template v-if="priceDate"> · prezzi del {{ formatDate(priceDate) }}</template></template>
              <template v-else-if="inv.symbols.length">Quotazioni non ancora scaricate</template>
              <template v-else>Collega un ticker alle posizioni per seguirne l'andamento giornaliero</template>
              <template v-if="s.atCost"> · {{ m(s.atCost) }} senza ticker valutati al prezzo di acquisto</template>
            </p>
          </section>

          <UiAlert v-if="inv.error" tone="critical" title="Quotazioni non disponibili">
            {{ inv.error.message }}<span v-if="inv.fetchedAt"> Stai vedendo gli ultimi prezzi salvati.</span>
          </UiAlert>
          <UiAlert v-if="failed.length" tone="warning" title="Alcuni ticker non sono stati trovati">
            {{ failed.map((p) => `${plainName(p.name)} (${p.ticker}): ${p.error}`).join(' · ') }}
          </UiAlert>
          <UiAlert v-if="unlinked.length" tone="info" title="Completa i dati per il tracking giornaliero">
            {{ unlinked.length }} posizioni senza dati dello strumento (ETF, azione o obbligazione): {{ unlinked.map((p) => plainName(p.name)).join(', ') }}.
            <template #actions><UiButton size="sm" variant="primary" @click="link(unlinked[0])">Configura «{{ plainName(unlinked[0].name) }}»</UiButton></template>
          </UiAlert>
          <UiAlert v-if="inv.sheet.state === 'local' || inv.sheet.state === 'error'" :tone="inv.sheet.state === 'error' ? 'warning' : 'info'" title="Archivio investimenti">
            {{ inv.sheet.message }}
          </UiAlert>

          <!-- Posizioni -------------------------------------------------------->
          <section class="panel" aria-labelledby="iv-pos">
            <header class="panel__head">
              <h2 id="iv-pos" class="panel__title">Investimenti <span class="muted small">{{ open.length }}</span></h2>
              <div class="pos__tools">
                <UiSegmented v-model="perfMode" label="Rendimento mostrato" :options="[{ value: 'total', label: 'Dall’acquisto' }, { value: 'today', label: 'Oggi' }]" />
                <label class="pos__sort">
                  <span class="sr-only">Ordina per</span>
                  <select v-model="sortMode" class="input input--sm">
                    <option value="value">Valore</option>
                    <option value="perf">Rendimento</option>
                    <option value="name">Nome</option>
                  </select>
                </label>
              </div>
            </header>

            <ul class="pos">
              <li v-for="p in list" :key="p.key" class="pos__item" :class="{ 'pos__item--open': expanded === p.key }" :style="{ '--c': colorOf(p) }">
                <button type="button" class="pos__row" :aria-expanded="expanded === p.key" @click="expanded = expanded === p.key ? null : p.key">
                  <span class="pos__avatar" aria-hidden="true">{{ initials(p) }}</span>
                  <span class="pos__id">
                    <strong>{{ plainName(p.name) }}</strong>
                    <span class="pos__sub">
                      Investiti {{ m(p.closed ? p.invested : p.costBasis) }}<template v-if="p.saveback"> · {{ m(p.saveback) }} saveback</template> · {{ INSTRUMENT_LABEL[p.type] }}
                      <template v-if="p.status === 'needs-data'"> · <em class="pos__warn">da configurare</em></template>
                    </span>
                  </span>
                  <span class="pos__val">
                    <strong class="num" :class="tone(p.unrealized)">{{ m(p.value) }}<span v-if="p.adjustment" class="pos__adj" title="Valore allineato a mano">✎</span></strong>
                    <span class="num" :class="tone(perfOf(p).abs)">
                      <template v-if="perfOf(p).pct !== null">{{ perfOf(p).abs! >= 0 ? '▲' : '▼' }} {{ formatPercent(Math.abs(perfOf(p).pct!), 2) }}</template>
                      <template v-else>{{ perfMode === 'today' ? '—' : 'al costo' }}</template>
                    </span>
                  </span>
                  <UiIcon name="chevron" :size="16" class="pos__chev" />
                </button>
                <div v-if="expanded === p.key" class="pos__detail">
                  <dl>
                    <div><dt>Peso</dt><dd class="num">{{ formatPercent(weight(p), 1) }}</dd></div>
                    <div><dt>Prezzo</dt><dd class="num">{{ priceText(p) }}</dd></div>
                    <div><dt>Quote</dt><dd class="num">{{ unitsText(p.units) }}<span v-if="p.unitsManual" class="muted" title="Inserite a mano"> ✎</span></dd></div>
                    <div><dt>Investito</dt><dd class="num">{{ m(p.costBasis) }}</dd></div>
                    <div><dt>Speso di tasca tua</dt><dd class="num">{{ m(spentOf(p)) }}</dd></div>
                    <div v-if="p.saveback"><dt>Da saveback</dt><dd class="num pos">{{ m(p.saveback) }}</dd></div>
                    <div v-if="feesOf(p)"><dt>Commissioni</dt><dd class="num">{{ m(feesOf(p)) }}</dd></div>
                    <div><dt>Rendimento</dt><dd class="num" :class="tone(p.unrealized)">{{ signed(p.unrealized) }}</dd></div>
                    <div><dt>Oggi</dt><dd class="num" :class="tone(p.dayChange)">{{ signed(p.dayChange) }}</dd></div>
                    <div v-if="p.adjustment"><dt>Correzione manuale</dt><dd class="num">{{ signed(p.adjustment) }}</dd></div>
                    <div v-if="p.accrued"><dt>Rateo cedola</dt><dd class="num">{{ m(p.accrued) }}</dd></div>
                    <div v-if="p.maturity"><dt>Scadenza</dt><dd>{{ formatDate(p.maturity) }}</dd></div>
                    <div><dt>Operazioni</dt><dd>{{ p.buys }} acquisti<template v-if="p.sells"> · {{ p.sells }} vendite</template></dd></div>
                    <div><dt>Dal</dt><dd>{{ formatDate(p.firstDate) }}</dd></div>
                  </dl>
                  <div class="pos__btns">
                    <UiButton size="sm" variant="primary" icon="plus" @click="buy(p)">Acquista</UiButton>
                    <UiButton size="sm" icon="arrowUpRight" @click="sell(p)">Vendi</UiButton>
                    <UiButton size="sm" variant="ghost" icon="list" @click="showLots(p)">Vedi acquisti</UiButton>
                    <UiButton v-if="p.status !== 'needs-data'" size="sm" variant="ghost" icon="edit" @click="adjust(p)">Allinea valore</UiButton>
                    <UiButton v-if="p.type === 'etf' && !p.closed" size="sm" variant="ghost" icon="repeat" @click="newPlan(p)">PAC</UiButton>
                    <UiButton size="sm" :variant="p.status === 'needs-data' ? 'brand' : 'secondary'" :icon="p.status === 'needs-data' ? 'plus' : 'edit'" @click="link(p)">
                      {{ p.status === 'needs-data' ? 'Configura strumento' : `Modifica dati${p.ticker ? ` (${p.ticker})` : ''}` }}
                    </UiButton>
                  </div>
                </div>
              </li>
            </ul>

            <template v-if="closed.length">
              <UiButton variant="ghost" size="sm" class="pos__toggle" @click="showClosed = !showClosed">
                {{ showClosed ? 'Nascondi' : 'Mostra' }} posizioni chiuse ({{ closed.length }})
              </UiButton>
              <ul v-if="showClosed" class="pos pos--closed">
                <li v-for="p in closed" :key="p.key" class="pos__item" :style="{ '--c': colorOf(p) }">
                  <div class="pos__row">
                    <span class="pos__avatar" aria-hidden="true">{{ initials(p) }}</span>
                    <span class="pos__id">
                      <strong>{{ plainName(p.name) }}</strong>
                      <span class="pos__sub">Chiusa · investiti {{ m(p.invested) }}</span>
                    </span>
                    <span class="pos__val">
                      <strong class="num" :class="tone(p.realized)">{{ signed(p.realized) }}</strong>
                      <span class="muted">realizzato</span>
                    </span>
                  </div>
                </li>
              </ul>
            </template>
            <p class="muted small pos__note">
              ETF e azioni: le quote sono stimate dagli importi del bilancio e dal prezzo di chiusura del giorno di ogni acquisto (commissioni escluse);
              inserisci le quote reali dal broker per un valore esatto. Obbligazioni: valore = prezzo (verso 100 alla scadenza) × nominale + rateo di cedola lordo.
            </p>
          </section>

          <!-- Acquisti di un investimento ------------------------------------>
          <section id="iv-lots" class="panel lots" aria-labelledby="iv-lots-title">
            <header class="panel__head">
              <h2 id="iv-lots-title" class="panel__title">Acquisti per investimento</h2>
              <div class="lots__pick">
                <UiCombobox v-model="lotsKey" :options="lotsItems" label="Investimento da analizzare" placeholder="Scegli un investimento" />
              </div>
            </header>

            <template v-if="lotsPosition">
              <dl class="lots__sum">
                <div><dt>Investito</dt><dd class="num">{{ m(lotsPosition.closed ? lotsPosition.invested : lotsPosition.costBasis) }}</dd></div>
                <div><dt>Valore</dt><dd class="num">{{ lotsPosition.closed ? '—' : m(lotsPosition.value) }}</dd></div>
                <div>
                  <dt>Dall'acquisto</dt>
                  <dd class="num" :class="tone(lotsPosition.unrealized)">{{ signed(lotsPosition.unrealized) }} <small>{{ pct(lotsPosition.unrealizedPct) }}</small></dd>
                </div>
                <div>
                  <dt>Oggi</dt>
                  <dd class="num" :class="tone(lotsPosition.dayChange)">{{ signed(lotsPosition.dayChange) }} <small>{{ pct(lotsPosition.dayChangePct) }}</small></dd>
                </div>
              </dl>

              <div class="lots__scroll">
                <table class="lots__table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th class="r">Addebito</th>
                      <th class="r hide-sm">Quote · prezzo</th>
                      <th class="r hide-sm">Valore</th>
                      <th class="r">Dall'acquisto</th>
                      <th class="r">Oggi</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(l, i) in lots"
                      :key="`${l.date}-${i}`"
                      class="lots__row"
                      :class="{ 'lots__row--sold': l.remaining <= 0.001, 'lots__row--click': !!l.opId }"
                      :tabindex="l.opId ? 0 : undefined"
                      :title="l.opId ? (lotEditable(l) ? 'Modifica questo acquisto' : 'Dettaglio dell\'acquisto (si modifica nel foglio Google)') : undefined"
                      @click="openLot(l)"
                      @keydown.enter="openLot(l)"
                    >
                      <td>
                        <UiIcon v-if="l.opId" :name="lotEditable(l) ? 'edit' : 'info'" :size="13" class="lots__ico" />
                        {{ formatDate(l.date) }}
                        <span v-if="l.saveback" class="lots__badge lots__badge--sb">saveback</span>
                        <span v-if="shareText(l.remaining)" class="lots__badge">{{ shareText(l.remaining) }}</span>
                      </td>
                      <td class="r num">{{ m(l.amount) }}</td>
                      <td class="r num hide-sm">
                        <template v-if="l.units !== null && l.buyPrice !== null">{{ unitsText(l.units) }} · {{ priceText({ ...lotsPosition, price: l.buyPrice, priceIsPct: false }) }}</template>
                        <span v-else class="muted">—</span>
                      </td>
                      <td class="r num hide-sm">{{ l.value === null ? '—' : m(l.value) }}</td>
                      <td class="r num" :class="tone(l.gain)">
                        <template v-if="l.gain !== null && l.remaining > 0.001">{{ signed(l.gain) }}<small>{{ pct(l.gainPct) }}</small></template>
                        <span v-else class="muted">—</span>
                      </td>
                      <td class="r num" :class="tone(l.dayChange)">
                        <template v-if="l.dayChange !== null && l.remaining > 0.001">{{ signed(l.dayChange) }}<small>{{ pct(l.dayChangePct) }}</small></template>
                        <span v-else class="muted">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="lotSales.length" class="lots__sales">
                <p class="lots__label">Vendite</p>
                <ul>
                  <li v-for="(e, i) in lotSales" :key="`s-${i}`"><span>{{ formatDate(e.date) }}</span><strong class="num pos">+{{ m(e.amount) }}</strong></li>
                </ul>
              </div>
              <p class="muted small lots__note">
                Clicca su un acquisto per vederlo o modificarlo.
                <template v-if="lotsPosition.type === 'bond' || !lotsPosition.ticker">
                  Senza quotazione per singolo acquisto, valore e variazioni della posizione sono ripartiti in proporzione all'importo investito.
                </template>
                <template v-else>
                  Quote di ogni acquisto stimate dal prezzo di chiusura di quel giorno; le vendite riducono tutti gli acquisti in proporzione.
                </template>
                Le commissioni sono registrate a parte, nella categoria «Commissioni».
              </p>
            </template>
            <p v-else class="muted small">Nessun investimento da analizzare.</p>
          </section>
        </div>

        <!-- Colonna laterale ---------------------------------------------------->
        <aside class="iv__side">
          <PlansPanel ref="plansPanel" :positions="buyable" @new-investment="newInvestment" />
          <section class="panel" aria-labelledby="iv-today">
            <header class="panel__head">
              <h2 id="iv-today" class="panel__title">Oggi</h2>
              <span class="num" :class="tone(s.dayChange)">{{ pct(s.dayChangePct) }}</span>
            </header>
            <ul v-if="movers.length" class="movers">
              <li v-for="p in movers" :key="p.key" :style="{ '--c': colorOf(p) }">
                <span class="pos__avatar pos__avatar--sm" aria-hidden="true">{{ initials(p) }}</span>
                <span class="movers__name">{{ plainName(p.name) }}</span>
                <span class="num" :class="tone(p.dayChange)">{{ p.dayChange! > 0 ? '▲' : '▼' }} {{ formatPercent(Math.abs(p.dayChangePct ?? 0), 2) }}</span>
              </li>
            </ul>
            <p v-else class="muted small">Nessuna variazione giornaliera disponibile.</p>
          </section>
          <section class="panel" aria-labelledby="iv-alloc">
            <header class="panel__head">
              <h2 id="iv-alloc" class="panel__title">Allocazione</h2>
            </header>
            <DonutChart :segments="segments" center-title="Valore" :format="m" :size="220" />
          </section>
        </aside>
      </div>
    </template>

    <EntryDialog :open="entryOpen" :operation="entryOp" @close="entryOpen = false" />
    <ValueAdjustDialog :open="adjustOpen" :position="adjusting" @close="adjustOpen = false" />
    <PurchaseDialog :open="purchaseOpen" :mode="tradeMode" :positions="tradeMode === 'sell' ? inv.positions : buyable" :position-key="purchaseKey" @close="purchaseOpen = false" />
    <InstrumentDialog
      :open="dialog"
      :category="creatingNew ? investmentCategory ?? 'Investimenti' : editing ? splitSubKey(editing.key).category : ''"
      :subcategory="creatingNew ? null : editing ? splitSubKey(editing.key).subcategory : ''"
      @close="dialog = false"
      @saved="onInstrumentSaved"
    />
  </div>
</template>

<style scoped>
.iv { display: flex; flex-direction: column; gap: 18px; }
.iv__grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.iv__main, .iv__side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* Riepilogo + grafico */
.port { padding: 24px 26px 18px; }
.port__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.port__actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pos__btns { display: flex; gap: 8px; flex-wrap: wrap; }
.port__label { color: var(--text-secondary); font-size: 0.92rem; }
.port__value { font-size: clamp(2.2rem, 4.6vw, 3.4rem); margin-top: 4px; }
.port__perf { margin-top: 6px; font-size: 0.98rem; font-weight: 500; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.port__pct { font-weight: 500; }
.port__when { color: var(--text-muted); font-weight: 400; font-size: 0.88rem; }
.port__nochart { padding: 60px 0; text-align: center; }
.port__meta { margin-top: 12px; }

.ranges { display: flex; justify-content: space-between; gap: 4px; margin-top: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.ranges__opt {
  flex: 1; max-width: 64px; padding: 7px 0; border: 0; border-radius: 999px; background: transparent;
  color: var(--text-secondary); font: inherit; font-size: 0.84rem; font-weight: 600; cursor: pointer;
}
.ranges__opt:hover { background: var(--surface-2); color: var(--text-primary); }
.ranges__opt--on, .ranges__opt--on:hover { background: var(--ink); color: #fff; }

.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; }
.kpis div { min-width: 0; }
.kpis dt { font-size: 0.78rem; color: var(--text-muted); }
.kpis dd { margin: 2px 0 0; font-size: 0.98rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpis small { font-size: 0.78rem; }

/* Lista posizioni */
.pos__tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.input--sm { padding: 6px 10px; font-size: 0.85rem; }
.pos { list-style: none; margin: 0; padding: 0; }
.pos__item + .pos__item { border-top: 1px solid var(--border); }
.pos__row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 14px;
  width: 100%; padding: 12px 6px; border: 0; background: transparent; font: inherit; color: inherit; text-align: left;
}
button.pos__row { cursor: pointer; border-radius: 14px; }
button.pos__row:hover { background: var(--surface-2); }
.pos--closed .pos__row { grid-template-columns: auto minmax(0, 1fr) auto; opacity: 0.8; }
.pos__avatar {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%;
  background: color-mix(in srgb, var(--c) 16%, var(--surface)); color: color-mix(in srgb, var(--c) 75%, #000);
  font-size: 0.82rem; font-weight: 700; letter-spacing: 0.02em; flex-shrink: 0;
}
.pos__avatar--sm { width: 30px; height: 30px; font-size: 0.68rem; }
.pos__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pos__id strong { color: var(--text-primary); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos__sub { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pos__warn { font-style: normal; color: var(--accent); }
.pos__val { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 0.84rem; white-space: nowrap; }
.pos__val strong { font-size: 0.98rem; font-weight: 550; }
.pos__adj { margin-left: 4px; font-size: 0.8em; color: var(--text-muted); font-weight: 400; }
.pos__chev { color: var(--text-muted); transition: transform 0.15s ease; }
.pos__item--open .pos__chev { transform: rotate(180deg); }
.pos__detail { padding: 4px 6px 16px 62px; }
.pos__detail dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px 16px; margin: 0 0 12px; }
.pos__detail dt { font-size: 0.75rem; color: var(--text-muted); }
.pos__detail dd { margin: 2px 0 0; font-size: 0.9rem; }
.pos__toggle { margin-top: 8px; }
.pos__note { margin-top: 12px; }

/* Acquisti per investimento */
.lots { scroll-margin-top: 16px; }
.lots__pick { width: min(320px, 100%); }
.lots__sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
.lots__sum div { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); min-width: 0; }
.lots__sum dt { font-size: 0.75rem; color: var(--text-muted); }
.lots__sum dd { margin: 2px 0 0; font-size: 0.98rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lots__sum small { font-size: 0.76rem; }
.lots__scroll { overflow-x: auto; }
.lots__table th, .lots__table td { padding: 9px 8px; border-bottom: 1px solid var(--border); font-size: 0.86rem; text-align: left; vertical-align: middle; }
.lots__table th { color: var(--text-muted); font-weight: 400; font-size: 0.76rem; white-space: nowrap; }
.lots__table .r { text-align: right; white-space: nowrap; }
.lots__table td.r small { display: block; font-size: 0.74rem; }
.lots__row--sold td { color: var(--text-muted); }
.lots__row--click { cursor: pointer; }
.lots__row--click:hover td, .lots__row--click:focus-visible td { background: var(--surface-2); }
.lots__row--click:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.lots__ico { color: var(--text-muted); vertical-align: -2px; margin-right: 4px; }
.lots__badge--sb { background: var(--good-soft); color: var(--positive); }
.iv__emptyplans { max-width: 520px; margin: 0 auto; width: 100%; }
.lots__badge { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; background: var(--warning-soft); color: var(--status-warning); font-size: 0.7rem; }
.lots__sales { margin-top: 12px; }
.lots__label { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px; }
.lots__sales ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.lots__sales li { display: flex; gap: 8px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); font-size: 0.82rem; }
.lots__note { margin-top: 12px; }


/* Colonna laterale */
.movers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.movers li { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
.movers__name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 1100px) {
  .iv__grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .lots__sum { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hide-sm { display: none; }
  .port { padding: 20px 16px 16px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pos__row { gap: 10px; grid-template-columns: auto minmax(0, 1fr) auto; }
  .pos__chev { display: none; }
  .pos__detail { padding-left: 6px; }
}
</style>
