<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatMoney, todayIso } from '@/core/utils/format'
import UiMultiSelect, { type SelectOption } from '@/core/ui/UiMultiSelect.vue'
import UiButton from '@/core/ui/UiButton.vue'
import {
  FLOW_TYPES, activeFilterCount, daysInMonth, defaultFilters, matchesFilters, splitSubKey, subKey, toBase,
  type FinanceDataset, type FinanceFilters, type FlowType, type Operation,
} from '../domain'
import { CARD_THEME_META, FLOW_META } from '../presentation'
import { useLedgerStore } from '../store/ledgerStore'
import { categoryIcon } from '../categoryIcons'
import TxRow from './TxRow.vue'
import MonthSwitcher from './MonthSwitcher.vue'

const props = defineProps<{ dataset: FinanceDataset; operations: Operation[] }>()
/** Mese mostrato: condiviso con la pagina, così si può cambiare anche da qui. */
const month = defineModel<string>('month', { required: true })
const emit = defineEmits<{ open: [op: Operation]; add: [date: string] }>()

const view = ref<'list' | 'calendar'>('calendar')
const kind = ref<'all' | 'expense' | 'income' | 'transfer'>('all')
/** Giorno scelto nel calendario: condiviso con la pagina, così il «+» crea la voce in quella data. */
const selectedDay = defineModel<string | null>('day', { default: null })
watch(month, () => (selectedDay.value = null))
watch(view, (v) => v === 'list' && (selectedDay.value = null))

const today = todayIso()
const cur = computed(() => props.dataset.baseCurrency)

// ---- Filtri (locali al pannello: non toccano i filtri globali delle altre pagine) ----
const showFilters = ref(false)
/** Su mobile i filtri si aprono in una finestra invece che in linea. */
const mobileMedia = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null
const isMobile = ref(mobileMedia?.matches ?? false)
const onMobileChange = (e: MediaQueryListEvent) => (isMobile.value = e.matches)
mobileMedia?.addEventListener('change', onMobileChange)
onBeforeUnmount(() => mobileMedia?.removeEventListener('change', onMobileChange))
const filters = ref<FinanceFilters>({ ...defaultFilters(), period: 'all' })
const filterCount = computed(() => activeFilterCount(filters.value))
function resetFilters() {
  filters.value = { ...defaultFilters(), period: 'all' }
}

const ledger = useLedgerStore()
const allOps = computed(() => props.dataset.operations)
const accountOptions = computed<SelectOption[]>(() =>
  props.dataset.accounts.map((a) => ({
    value: a.name,
    label: a.name,
    group: a.type === 'investment' ? 'Investimenti' : 'Liquidità',
    swatch: accountCardBg(a.name),
  })),
)
/** Colore del pallino: quello della carta del conto (come nel modulo di inserimento). */
function accountCardBg(name: string) {
  const cfg = ledger.state.config.accounts.find((a) => a.name === name)
  return cfg ? CARD_THEME_META[cfg.cardTheme].bg : 'var(--surface-2)'
}
const flowOptions: SelectOption[] = FLOW_TYPES.map((t) => ({ value: t, label: FLOW_META[t].label, swatch: FLOW_META[t].swatch }))
const categoryOptions = computed<SelectOption[]>(() => {
  /** Tipo della categoria (entrata/uscita) dedotto dai movimenti, per scegliere l'icona giusta. */
  const kinds = new Map<string, 'income' | 'expense'>()
  for (const o of allOps.value) if (o.category && !kinds.has(o.category) && o.kind !== 'transfer') kinds.set(o.category, o.kind)
  return [...new Set(allOps.value.map((o) => o.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map((c) => ({ value: c, label: c, emoji: categoryIcon(ledger.state.config, c, kinds.get(c)) }))
})
const subcategoryOptions = computed<SelectOption[]>(() => {
  const keys = new Set<string>()
  for (const o of allOps.value) if (o.subcategory) keys.add(subKey(o.category, o.subcategory))
  return [...keys]
    .map((k) => ({ key: k, ...splitSubKey(k) }))
    .filter((s) => !filters.value.categories.length || filters.value.categories.includes(s.category))
    .sort((a, b) => a.category.localeCompare(b.category, 'it') || a.subcategory.localeCompare(b.subcategory, 'it'))
    .map((s) => ({ value: s.key, label: s.subcategory, group: s.category }))
})
const currencyOptions = computed<SelectOption[]>(() => {
  const set = new Set<string>()
  for (const o of allOps.value) {
    set.add(o.currency)
    if (o.kind === 'transfer') set.add(o.toCurrency)
  }
  return [...set].sort().map((c) => ({ value: c, label: c }))
})
const flowTypes = computed({
  get: () => filters.value.flowTypes as string[],
  set: (v: string[]) => (filters.value.flowTypes = v as FlowType[]),
})
// Se cambiano le categorie scelte, scarta le sotto-categorie non più compatibili.
watch(
  () => filters.value.categories,
  (cats) => {
    if (cats.length) filters.value.subcategories = filters.value.subcategories.filter((k) => cats.includes(splitSubKey(k).category))
  },
)

const visible = computed(() =>
  props.operations.filter((o) => (kind.value === 'all' || o.kind === kind.value) && matchesFilters(o, filters.value, {})),
)

const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (iso === today) return 'Oggi'
  const s = dayFmt.format(new Date(Date.UTC(y, m - 1, d)))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const base = (op: Operation) => toBase(props.dataset, op.amount, op.currency) ?? 0
/** Effetto sul saldo: + entrate, − uscite, 0 trasferimenti. */
const signed = (op: Operation) => (op.kind === 'income' ? base(op) : op.kind === 'expense' ? -base(op) : 0)
const netText = (v: number) => (v > 0 ? `+${formatMoney(v, cur.value)}` : v < 0 ? `−${formatMoney(-v, cur.value)}` : '')

const groups = computed(() => {
  const map = new Map<string, Operation[]>()
  for (const op of [...visible.value].reverse()) {
    const list = map.get(op.date) ?? []
    list.push(op)
    map.set(op.date, list)
  }
  return [...map.entries()].map(([date, ops]) => ({ date, ops, net: ops.reduce((s, o) => s + signed(o), 0) }))
})

// ---- Calendario ----------------------------------------------------------
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
interface Cell { date: string; day: number; out: number; inc: number; count: number }
const cells = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const n = daysInMonth(month.value)
  const byDay = new Map<string, { out: number; inc: number; count: number }>()
  for (const op of visible.value) {
    const d = byDay.get(op.date) ?? { out: 0, inc: 0, count: 0 }
    if (op.kind === 'expense') d.out += base(op)
    if (op.kind === 'income') d.inc += base(op)
    d.count++
    byDay.set(op.date, d)
  }
  const out: (Cell | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= n; d++) {
    const date = `${month.value}-${String(d).padStart(2, '0')}`
    const v = byDay.get(date) ?? { out: 0, inc: 0, count: 0 }
    out.push({ date, day: d, ...v })
  }
  while (out.length % 7) out.push(null)
  return out
})
/** Saldo del mese per i movimenti visibili (entrate − uscite). */
const monthNet = computed(() => visible.value.reduce((s, o) => s + signed(o), 0))
const selectedOps = computed(() => (selectedDay.value ? visible.value.filter((o) => o.date === selectedDay.value).reverse() : []))
const selectedNet = computed(() => selectedOps.value.reduce((s, o) => s + signed(o), 0))
/** Importo nelle celle: sempre con due decimali e la virgola (es. 1.250,00 · 12,50). */
const compact = (cents: number) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(cents / 100)
</script>

<template>
  <div class="tp">
    <div class="tp__bar">
      <div class="tp__switch" role="radiogroup" aria-label="Visualizzazione">
        <button type="button" role="radio" :aria-checked="view === 'calendar'" :class="{ on: view === 'calendar' }" title="Calendario" @click="view = 'calendar'">
          <UiIcon name="calendar" :size="17" /><span>Calendario</span>
        </button>
        <button type="button" role="radio" :aria-checked="view === 'list'" :class="{ on: view === 'list' }" title="Elenco" @click="view = 'list'">
          <UiIcon name="list" :size="17" /><span>Elenco</span>
        </button>
      </div>
      <UiSegmented
        v-model="kind"
        label="Tipo di movimento"
        class="tp__kinds"
        :options="[
          { value: 'all', label: 'Tutti' },
          { value: 'expense', label: 'Uscite' },
          { value: 'income', label: 'Entrate' },
          { value: 'transfer', label: 'Trasferimenti' },
        ]"
      />
      <button
        type="button"
        class="tp__filterbtn"
        :class="{ on: showFilters || filterCount }"
        :aria-expanded="showFilters"
        aria-controls="tp-filters"
        aria-label="Filtro"
        title="Filtro"
        @click="showFilters = !showFilters"
      >
        <UiIcon name="sliders" :size="17" />
        <span v-if="filterCount" class="tp__count">{{ filterCount }}</span>
      </button>
    </div>
    <component
      :is="isMobile ? UiDialog : 'div'"
      v-if="showFilters || isMobile"
      v-bind="isMobile ? { open: showFilters, title: 'Filtra transazioni', width: 480 } : {}"
      @close="showFilters = false"
    >
    <div id="tp-filters" class="tp__filters" :class="{ 'tp__filters--sheet': isMobile }" role="search" aria-label="Filtra transazioni">
      <label class="tp__search">
        <span class="tp__label">Cerca</span>
        <span class="tp__search-wrap">
          <UiIcon name="search" :size="15" class="tp__search-icon" />
          <input v-model.trim="filters.search" class="input" type="search" placeholder="Descrizione, categoria, conto…" />
        </span>
      </label>
      <div class="tp__fgrid">
        <UiMultiSelect v-model="filters.accounts" label="Conto" :options="accountOptions" placeholder="Tutti i conti" />
        <UiMultiSelect v-model="flowTypes" label="Tipologia" :options="flowOptions" placeholder="Tutte" />
        <UiMultiSelect v-model="filters.categories" label="Categoria" :options="categoryOptions" placeholder="Tutte" />
        <UiMultiSelect v-model="filters.subcategories" label="Sotto-categoria" :options="subcategoryOptions" placeholder="Tutte" />
        <UiMultiSelect v-model="filters.currencies" label="Valuta" :options="currencyOptions" placeholder="Tutte" />
      </div>
      <div class="tp__factions">
        <span class="muted small">{{ visible.length }} di {{ operations.length }} movimenti</span>
        <UiButton variant="ghost" size="sm" icon="close" :disabled="!filterCount" @click="resetFilters">Reimposta</UiButton>
      </div>
      <UiButton v-if="isMobile" class="tp__apply" @click="showFilters = false">Mostra {{ visible.length }} movimenti</UiButton>
    </div>
    </component>
    <div class="tp__month">
      <MonthSwitcher v-model="month" class="tp__ms" />
      <span v-if="monthNet" class="tp__monthnet num" :class="monthNet > 0 ? 'pos' : 'neg'">{{ netText(monthNet) }}</span>
    </div>

    <!-- Elenco ---------------------------------------------------------->
    <div v-if="view === 'list'" class="tp__list">
      <p v-if="!groups.length" class="muted small tp__empty">{{ filterCount || kind !== 'all' ? 'Nessun movimento corrisponde ai filtri.' : 'Nessun movimento in questo mese.' }}</p>
      <section v-for="g in groups" :key="g.date" class="tp__day">
        <header class="tp__dayhead">
          <span>{{ dayLabel(g.date) }}</span>
          <span class="num" :class="g.net > 0 ? 'pos' : 'neg'">{{ netText(g.net) }}</span>
        </header>
        <ul>
          <li v-for="op in g.ops" :key="op.id"><TxRow :op="op" @open="emit('open', $event)" /></li>
        </ul>
      </section>
    </div>

    <!-- Calendario ------------------------------------------------------>
    <div v-else class="tp__cal">
      <div class="cal" role="grid" aria-label="Calendario del mese">
        <div v-for="w in WEEKDAYS" :key="w" class="cal__wd" role="columnheader">{{ w }}</div>
        <template v-for="(c, i) in cells" :key="c ? c.date : `e${i}`">
          <div v-if="!c" class="cal__cell cal__cell--empty" aria-hidden="true" />
          <button
            v-else
            type="button"
            role="gridcell"
            class="cal__cell"
            :class="{ 'cal__cell--today': c.date === today, 'cal__cell--on': c.date === selectedDay }"
            :aria-label="`${dayLabel(c.date)}: ${c.count} movimenti${c.inc ? ', entrate ' + formatMoney(c.inc, cur) : ''}${c.out ? ', uscite ' + formatMoney(c.out, cur) : ''}`"
            :aria-selected="c.date === selectedDay"
            @click="selectedDay = selectedDay === c.date ? null : c.date"
            @dblclick="emit('add', c.date)"
          >
            <span class="cal__num">{{ c.day }}</span>
            <span v-if="c.inc" class="cal__in num">+{{ compact(c.inc) }}</span>
            <span v-if="c.out" class="cal__out num">−{{ compact(c.out) }}</span>
            <span v-if="c.count && !c.out && !c.inc" class="cal__dot" aria-hidden="true" />
          </button>
        </template>
      </div>
      <p class="muted small cal__hint">
        <span class="pos">+ entrate</span> · <span class="neg">− uscite</span>. Tocca un giorno per vederne i movimenti: il pulsante + aggiungerà la voce in quella data (doppio clic per aggiungere subito).
      </p>
      <section v-if="selectedDay" class="tp__day tp__selected">
        <header class="tp__dayhead tp__dayhead--sel">
          <span><strong>{{ dayLabel(selectedDay) }}</strong> <span v-if="selectedNet" class="num" :class="selectedNet > 0 ? 'pos' : 'neg'">{{ netText(selectedNet) }}</span></span>
        </header>
        <p v-if="!selectedOps.length" class="muted small tp__none">Nessun movimento in questo giorno.</p>
        <ul>
          <li v-for="op in selectedOps" :key="op.id"><TxRow :op="op" @open="emit('open', $event)" /></li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 14px; }
.tp__bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.tp__kinds { margin-left: auto; }
/* Mese: selettore centrato con il saldo del mese accanto. */
.tp__month { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.tp .tp__ms { background: var(--surface-2); }
.tp__monthnet { font-size: 0.85rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); }
.tp__switch { display: inline-flex; background: var(--surface-2); border-radius: 999px; padding: 3px; }
.tp__switch button {
  display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
  padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; color: var(--text-secondary);
}
.tp__switch button.on { background: var(--ink); color: var(--brand); }
/* Pulsante filtri: solo icona, con il numero dei filtri attivi nell'angolo. */
.tp__filterbtn {
  position: relative; display: inline-grid; place-items: center; border: 0; cursor: pointer;
  width: 36px; height: 36px; border-radius: 999px;
  background: var(--surface-2); color: var(--text-secondary);
}
.tp__filterbtn:hover { color: var(--text-primary); }
.tp__filterbtn.on { background: var(--ink); color: var(--brand); }
.tp__count {
  position: absolute; top: -4px; right: -4px;
  background: var(--accent); color: var(--on-accent); border-radius: 999px; font-size: 0.72rem; padding: 0 6px; line-height: 1.5;
}
.tp__filters { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 18px; background: var(--surface-2); }
.tp__label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
.tp__search { display: flex; flex-direction: column; gap: 3px; }
.tp__search-wrap { position: relative; display: flex; }
.tp__search-wrap .input { width: 100%; padding-left: 30px; }
.tp__search-icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
.tp__fgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.tp__factions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
/* Nella finestra mobile: niente riquadro, controlli in colonna. */
.tp__filters--sheet { padding: 0; background: none; border-radius: 0; }
.tp__filters--sheet .tp__fgrid { grid-template-columns: minmax(0, 1fr); }
.tp__apply { width: 100%; justify-content: center; }
.tp__empty { padding: 28px 0; text-align: center; }
.tp__list { display: flex; flex-direction: column; gap: 14px; max-height: 640px; overflow-y: auto; padding-right: 4px; }
.tp__day ul { list-style: none; margin: 0; padding: 0; }
.tp__dayhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--text-muted); padding: 0 6px 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.tp__dayhead--sel { font-size: 0.92rem; color: var(--text-primary); padding-bottom: 10px; }
.tp__selected { margin-top: 6px; padding: 14px 10px 8px; border-radius: 18px; background: var(--surface-2); }
.tp__none { padding: 6px; }

.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.cal__wd { text-align: center; font-size: 0.75rem; color: var(--text-muted); padding-bottom: 2px; }
.cal__cell {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  min-height: 76px; padding: 7px 8px; border-radius: 14px; border: 1px solid transparent;
  background: var(--surface-2);
  font-size: 0.74rem; text-align: left; cursor: pointer; min-width: 0; overflow: hidden;
}
.cal__cell--empty { background: none; cursor: default; }
.cal__cell:hover { border-color: var(--border-strong); }
.cal__cell--today .cal__num { background: var(--ink); color: var(--brand); }
.cal__cell--on { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.cal__num { display: inline-grid; place-items: center; min-width: 22px; height: 22px; border-radius: 999px; font-size: 0.8rem; font-weight: 500; margin-bottom: 2px; }
.cal__in, .cal__out { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cal__in { color: var(--positive); }
.cal__out { color: var(--negative); }
.cal__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); margin-top: 4px; }
.cal__hint { margin-top: 6px; }
@media (max-width: 600px) {
  .tp__switch span { display: none; }
  .cal { gap: 3px; }
  .cal__cell { min-height: 56px; padding: 4px; border-radius: 10px; font-size: 0.62rem; }
}
/* Stesso breakpoint del layout mobile dell'app (App.vue). */
@media (max-width: 640px) {
  /* Riga 1: vista + icona filtri; riga 2: tipi di movimento a tutta larghezza. */
  .tp__filterbtn { margin-left: auto; }
  .tp__kinds { order: 3; flex-basis: 100%; margin-left: 0; display: flex; }
  .tp__kinds :deep(.seg__opt) { flex: 1; padding: 6px 8px; }
}
</style>
