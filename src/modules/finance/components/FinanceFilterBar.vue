<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import UiMultiSelect, { type SelectOption } from '@/core/ui/UiMultiSelect.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { useFinanceStore } from '../store/financeStore'
import { FLOW_META, accountSwatch } from '../presentation'
import { FLOW_TYPES, activeFilterCount, type PeriodPreset } from '../domain'
import { formatDate, formatMonth } from '@/core/utils/format'

withDefaults(defineProps<{ showSearch?: boolean }>(), { showSearch: false })

const store = useFinanceStore()
const { filters, range } = storeToRefs(store)
const expanded = ref(false)

const periods: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: 'Globale · tutto lo storico' },
  { value: 'year', label: 'Anno specifico' },
  { value: 'specificMonth', label: 'Mese specifico' },
  { value: 'month', label: 'Mese corrente' },
  { value: '3m', label: 'Ultimi 3 mesi' },
  { value: '6m', label: 'Ultimi 6 mesi' },
  { value: '12m', label: 'Ultimi 12 mesi' },
  { value: 'ytd', label: "Da inizio anno" },
  { value: 'lastYear', label: 'Anno scorso' },
  { value: 'custom', label: 'Personalizzato…' },
]

const yearOptions = computed(() => {
  const years = new Set(store.operations.map((operation) => Number(operation.date.slice(0, 4))))
  if (filters.value.year) years.add(filters.value.year)
  if (!years.size) years.add(Number(store.today.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
})
const selectedYear = computed({
  get: () => filters.value.year ?? yearOptions.value[0] ?? Number(store.today.slice(0, 4)),
  set: (year: number) => (filters.value.year = year),
})
const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(2026, index, 1)),
}))

function latestMonth(year: number): number | undefined {
  const months = store.operations
    .filter((operation) => Number(operation.date.slice(0, 4)) === year)
    .map((operation) => Number(operation.date.slice(5, 7)))
  return months.length ? months.reduce((latest, month) => Math.max(latest, month), 0) : undefined
}

watch(
  [() => filters.value.period, () => store.dataset, () => yearOptions.value.join(',')],
  ([period]) => {
    if (!store.dataset || (period !== 'year' && period !== 'specificMonth')) return
    if (!filters.value.year) filters.value.year = yearOptions.value[0] ?? Number(store.today.slice(0, 4))
    if (period === 'specificMonth' && !filters.value.month) {
      filters.value.month = latestMonth(filters.value.year!) ?? Number(store.today.slice(5, 7))
    }
  },
  { immediate: true },
)

const accountOptions = computed<SelectOption[]>(() =>
  (store.dataset?.accounts ?? []).map((a) => ({
    value: a.name,
    label: a.name,
    group: a.type === 'investment' ? 'Investimenti' : 'Liquidità',
    swatch: accountSwatch(store.dataset!.accounts, a.name),
  })),
)
const categoryOptions = computed<SelectOption[]>(() => store.categories.map((c) => ({ value: c, label: c })))
const subcategoryOptions = computed<SelectOption[]>(() =>
  store.subcategoryKeys
    .filter((s) => !filters.value.categories.length || filters.value.categories.includes(s.category))
    .map((s) => ({ value: s.key, label: s.subcategory, group: s.category })),
)
const flowOptions = computed<SelectOption[]>(() => FLOW_TYPES.map((t) => ({ value: t, label: FLOW_META[t].label, swatch: FLOW_META[t].swatch })))
const currencyOptions = computed<SelectOption[]>(() => store.currencies.map((c) => ({ value: c, label: c })))

const flowTypes = computed({
  get: () => filters.value.flowTypes as string[],
  set: (v: string[]) => (filters.value.flowTypes = v as typeof filters.value.flowTypes),
})

const activeCount = computed(() => activeFilterCount(filters.value))
const rangeLabel = computed(() => {
  if (filters.value.period === 'all') return 'Tutto lo storico'
  if (filters.value.period === 'year' && filters.value.year) return `Anno ${filters.value.year}`
  if (filters.value.period === 'specificMonth' && filters.value.year && filters.value.month) {
    return formatMonth(`${filters.value.year}-${String(filters.value.month).padStart(2, '0')}`, 'long')
  }
  const { from, to } = range.value
  if (!from && !to) return 'Tutto lo storico'
  return `${from ? formatDate(from) : 'inizio'} → ${to ? formatDate(to) : 'oggi'}`
})

function onPeriodChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value as PeriodPreset
  if (value === 'custom' && !filters.value.from) {
    filters.value.from = range.value.from ?? ''
    filters.value.to = range.value.to ?? ''
  }
  filters.value.period = value
  if ((value === 'year' || value === 'specificMonth') && !filters.value.year) {
    filters.value.year = yearOptions.value[0] ?? Number(store.today.slice(0, 4))
  }
  if (value === 'specificMonth' && !filters.value.month) {
    filters.value.month = latestMonth(filters.value.year ?? selectedYear.value) ?? Number(store.today.slice(5, 7))
  }
}
</script>

<template>
  <div class="fb" role="search" aria-label="Filtri finanze">
    <div class="fb__main">
      <label class="fb__field fb__period">
        <span class="fb__label">Vista temporale</span>
        <select class="input" :value="filters.period" @change="onPeriodChange">
          <optgroup label="Riepilogo">
            <option v-for="p in periods.slice(0, 3)" :key="p.value" :value="p.value">{{ p.label }}</option>
          </optgroup>
          <optgroup label="Periodi rapidi">
            <option v-for="p in periods.slice(3)" :key="p.value" :value="p.value">{{ p.label }}</option>
          </optgroup>
        </select>
      </label>
      <label v-if="filters.period === 'year' || filters.period === 'specificMonth'" class="fb__field fb__year">
        <span class="fb__label">Anno</span>
        <select v-model.number="selectedYear" class="input" aria-label="Seleziona anno">
          <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}</option>
        </select>
      </label>
      <label v-if="filters.period === 'specificMonth'" class="fb__field fb__month">
        <span class="fb__label">Mese</span>
        <select v-model.number="filters.month" class="input" aria-label="Seleziona mese">
          <option v-for="month in monthOptions" :key="month.value" :value="month.value">{{ month.label }}</option>
        </select>
      </label>
      <template v-if="filters.period === 'custom'">
        <label class="fb__field">
          <span class="fb__label">Dal</span>
          <input v-model="filters.from" class="input" type="date" :max="filters.to || undefined" />
        </label>
        <label class="fb__field">
          <span class="fb__label">Al</span>
          <input v-model="filters.to" class="input" type="date" :min="filters.from || undefined" />
        </label>
      </template>
      <label v-if="showSearch" class="fb__field fb__search">
        <span class="fb__label">Cerca</span>
        <span class="fb__search-wrap">
          <UiIcon name="search" :size="15" class="fb__search-icon" />
          <input v-model.trim="filters.search" class="input" type="search" placeholder="Descrizione, categoria, conto…" />
        </span>
      </label>
      <button type="button" class="fb__toggle input" :aria-expanded="expanded" @click="expanded = !expanded">
        <UiIcon name="filter" :size="15" />
        Filtri<span v-if="activeCount" class="fb__count">{{ activeCount }}</span>
      </button>
    </div>

    <div class="fb__more" :class="{ 'fb__more--open': expanded }">
      <UiMultiSelect v-model="filters.accounts" label="Conto" :options="accountOptions" placeholder="Tutti i conti" />
      <UiMultiSelect v-model="flowTypes" label="Tipologia" :options="flowOptions" placeholder="Tutte" />
      <UiMultiSelect v-model="filters.categories" label="Categoria" :options="categoryOptions" placeholder="Tutte" />
      <UiMultiSelect v-model="filters.subcategories" label="Sotto-categoria" :options="subcategoryOptions" placeholder="Tutte" />
      <UiMultiSelect v-model="filters.currencies" label="Valuta" :options="currencyOptions" placeholder="Tutte" />
      <div class="fb__reset">
        <UiButton variant="ghost" size="sm" icon="close" :disabled="!activeCount && filters.period === '12m'" @click="store.resetFilters()">Reimposta</UiButton>
      </div>
    </div>
    <p class="fb__range muted small">{{ rangeLabel }}</p>
  </div>
</template>

<style scoped>
.fb {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.fb__main { display: flex; gap: var(--space-3); align-items: flex-end; flex-wrap: wrap; }
.fb__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.fb__label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
.fb__period select { min-width: 170px; }
.fb__year select { min-width: 96px; }
.fb__month select { min-width: 140px; }
.fb__search { flex: 1; min-width: 200px; }
.fb__search-wrap { position: relative; display: flex; }
.fb__search-wrap .input { width: 100%; padding-left: 30px; }
.fb__search-icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
.fb__toggle { display: none; align-items: center; gap: 6px; cursor: pointer; }
.fb__count {
  background: var(--accent);
  color: var(--on-accent);
  border-radius: 999px;
  font-size: 0.72rem;
  padding: 0 6px;
  line-height: 1.5;
}
.fb__more {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  gap: var(--space-3);
  align-items: end;
}
.fb__reset { display: flex; align-items: flex-end; height: 100%; }
.fb__range { margin-top: -4px; }

@media (max-width: 1100px) {
  .fb__more { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .fb__toggle { display: inline-flex; }
  .fb__more { display: none; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fb__more--open { display: grid; }
  .fb__period { flex: 1; }
  .fb__period select { min-width: 0; width: 100%; }
  .fb__search { order: 5; flex-basis: 100%; }
}
@media (max-width: 420px) {
  .fb__more { grid-template-columns: minmax(0, 1fr); }
}
</style>
