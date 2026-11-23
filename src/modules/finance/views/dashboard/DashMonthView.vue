<script setup lang="ts">
import { computed, ref } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiStat from '@/core/ui/UiStat.vue'
import { formatMoney, formatMonth, formatPercent, todayIso } from '@/core/utils/format'
import { computeFlowSummary, cumulative, dailyTotals, daysInMonth, opsInMonth, shiftMonth } from '../../domain'
import { useFinanceStore } from '../../store/financeStore'
import MonthSwitcher from '../../components/MonthSwitcher.vue'
import SpendingPaceChart from '../../components/SpendingPaceChart.vue'
import CategoryCompare from '../../components/CategoryCompare.vue'
import CategoryDonut from '../../components/CategoryDonut.vue'

const store = useFinanceStore()
const today = todayIso()
const month = ref(today.slice(0, 7))
const cur = computed(() => store.baseCurrency)
const m = (v: number, sign = false) => formatMoney(v, cur.value, { sign })
const SPEND = ['necessary', 'additional'] as const

const ops = computed(() => opsInMonth(store.operations, month.value))
const prevMonth = computed(() => shiftMonth(month.value, -1))
const prevOps = computed(() => opsInMonth(store.operations, prevMonth.value))
const s = computed(() => computeFlowSummary(store.dataset, ops.value))
const p = computed(() => computeFlowSummary(store.dataset, prevOps.value))

/** Media dei 6 mesi precedenti (solo mesi con movimenti). */
const AVG_N = 6
const history = computed(() =>
  Array.from({ length: AVG_N }, (_, i) => shiftMonth(month.value, -(i + 1)))
    .map((mo) => ({ mo, ops: opsInMonth(store.operations, mo) }))
    .filter((h) => h.ops.length),
)
const avgSummary = computed(() => {
  const n = history.value.length || 1
  const sums = history.value.map((h) => computeFlowSummary(store.dataset, h.ops))
  const avg = (k: 'income' | 'expenses' | 'savings' | 'invested') => Math.round(sums.reduce((a, x) => a + x[k], 0) / n)
  return { income: avg('income'), expenses: avg('expenses'), savings: avg('savings'), invested: avg('invested') }
})

const elapsed = computed(() => {
  const cm = today.slice(0, 7)
  return month.value < cm ? daysInMonth(month.value) : month.value > cm ? 0 : Number(today.slice(8, 10))
})
const pace = computed(() => {
  const n = daysInMonth(month.value)
  const cur = cumulative(dailyTotals(store.dataset, ops.value, month.value, [...SPEND]))
  const prev = cumulative(dailyTotals(store.dataset, prevOps.value, prevMonth.value, [...SPEND]))
  const avg = new Array(n).fill(0)
  for (const h of history.value) {
    const c = cumulative(dailyTotals(store.dataset, h.ops, h.mo, [...SPEND]))
    for (let i = 0; i < n; i++) avg[i] += c[Math.min(i, c.length - 1)] / history.value.length
  }
  return { cur, prev: prev.slice(0, n), avg: avg.map(Math.round) }
})

const vs = (now: number, ref: number) => (ref ? (now - ref) / Math.abs(ref) : null)
const hint = (now: number, ref: number, label: string) => {
  const d = vs(now, ref)
  return d === null ? `${label}: —` : `${d > 0 ? '+' : ''}${formatPercent(d, 0)} rispetto a ${label}`
}
const projected = computed(() => (elapsed.value && elapsed.value < daysInMonth(month.value) ? Math.round((s.value.expenses / elapsed.value) * daysInMonth(month.value)) : null))
</script>

<template>
  <div class="stack">
    <div class="row"><MonthSwitcher v-model="month" /></div>

    <div class="grid grid-kpi">
      <UiStat emphasis label="Risparmio del mese" :tone="s.savings >= 0 ? 'pos' : 'neg'" :value="m(s.savings, true)" :hint="`Tasso ${formatPercent(s.savingsRate, 0)} · media ${m(avgSummary.savings)}`" />
      <UiStat label="Entrate" :value="m(s.income)" swatch="--flow-income" :hint="hint(s.income, p.income, formatMonth(prevMonth, 'long'))" />
      <UiStat label="Uscite" :value="m(s.expenses)" swatch="--flow-necessary" :hint="hint(s.expenses, avgSummary.expenses, 'media 6 mesi')" />
      <UiStat label="Proiezione uscite a fine mese" :value="projected === null ? '—' : m(projected)" :hint="projected === null ? 'Disponibile per il mese in corso' : `Al ritmo attuale (${elapsed} giorni)`" />
    </div>

    <UiCard title="Ritmo di spesa" subtitle="Uscite cumulate giorno per giorno, investimenti esclusi">
      <SpendingPaceChart
        :current="pace.cur"
        :previous="pace.prev"
        :average="pace.avg"
        :elapsed="elapsed"
        :currency="cur"
        :labels="{ current: formatMonth(month, 'long'), previous: formatMonth(prevMonth, 'long'), average: `Media ${history.length} mesi` }"
      />
    </UiCard>

    <div class="grid grid-2">
      <UiCard title="Categorie a confronto" :subtitle="`${formatMonth(month, 'long')} rispetto a ${formatMonth(prevMonth, 'long')}`">
        <CategoryCompare :dataset="store.dataset" :current="ops" :previous="prevOps" :current-label="formatMonth(month)" :previous-label="formatMonth(prevMonth)" />
      </UiCard>
      <UiCard title="Composizione del mese">
        <CategoryDonut :dataset="store.dataset" :operations="ops" :size="210" compact />
      </UiCard>
    </div>
  </div>
</template>
