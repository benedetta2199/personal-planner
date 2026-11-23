<script setup lang="ts">
import { computed, ref } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiStat from '@/core/ui/UiStat.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatMoney, formatPercent, todayIso } from '@/core/utils/format'
import { computeFlowSummary, computeMonthlyFlows, monthRange, opsInYear, yearsOf } from '../../domain'
import { useFinanceStore } from '../../store/financeStore'
import CashflowChart from '../../components/CashflowChart.vue'
import CategoryDonut from '../../components/CategoryDonut.vue'
import CategoryCompare from '../../components/CategoryCompare.vue'

const store = useFinanceStore()
const today = todayIso()
const years = computed(() => yearsOf(store.operations, today))
const year = ref(String(years.value[0]))
const y = computed(() => Number(year.value))
const cur = computed(() => store.baseCurrency)
const m = (v: number, sign = false) => formatMoney(v, cur.value, { sign })

const ops = computed(() => opsInYear(store.operations, y.value))
const prevOps = computed(() => opsInYear(store.operations, y.value - 1))
const s = computed(() => computeFlowSummary(store.dataset, ops.value))
const p = computed(() => computeFlowSummary(store.dataset, prevOps.value))

/** Mesi dell'anno fino al mese corrente (per l'anno in corso). */
const months = computed(() => {
  const last = y.value === Number(today.slice(0, 4)) ? today.slice(0, 7) : `${y.value}-12`
  return monthRange(`${y.value}-01`, last)
})
const flows = computed(() => computeMonthlyFlows(store.dataset, ops.value, months.value))
const activeMonths = computed(() => Math.max(1, flows.value.filter((f) => f.income || f.necessary || f.additional || f.invested).length))

const delta = (now: number, before: number) => (before ? `${now >= before ? '+' : ''}${formatPercent((now - before) / Math.abs(before), 0)} sul ${y.value - 1}` : `Nessun dato ${y.value - 1}`)

const best = computed(() => [...flows.value].sort((a, b) => b.savings - a.savings)[0])
const worst = computed(() => [...flows.value].sort((a, b) => b.necessary + b.additional - (a.necessary + a.additional))[0])
const monthName = (mo: string) => {
  const [yy, mm] = mo.split('-').map(Number)
  return new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(yy, mm - 1, 1)))
}
</script>

<template>
  <div class="stack">
    <div class="row">
      <UiSegmented v-model="year" label="Anno" :options="years.map((v) => ({ value: String(v), label: String(v) }))" />
    </div>

    <div class="grid grid-kpi">
      <UiStat emphasis :label="`Risparmio ${y}`" :tone="s.savings >= 0 ? 'pos' : 'neg'" :value="m(s.savings, true)" :hint="`Tasso di risparmio ${formatPercent(s.savingsRate, 0)}`" />
      <UiStat label="Entrate" :value="m(s.income)" swatch="--flow-income" :hint="delta(s.income, p.income)" />
      <UiStat label="Uscite" :value="m(s.expenses)" swatch="--flow-necessary" :hint="`Media mensile ${m(Math.round(s.expenses / activeMonths))}`" />
      <UiStat label="Capitale investito" :value="m(s.invested)" swatch="--flow-investment" :hint="delta(s.invested, p.invested)" />
    </div>

    <UiCard :title="`Mese per mese · ${y}`" subtitle="Entrate, uscite e investimenti">
      <CashflowChart :flows="flows" :currency="cur" />
    </UiCard>

    <div class="grid grid-3 highlights">
      <div class="panel hl">
        <span class="muted small">Mese migliore</span>
        <strong>{{ best ? monthName(best.month) : '—' }}</strong>
        <span v-if="best" class="pos num">{{ m(best.savings, true) }} risparmiati</span>
      </div>
      <div class="panel hl">
        <span class="muted small">Mese più costoso</span>
        <strong>{{ worst ? monthName(worst.month) : '—' }}</strong>
        <span v-if="worst" class="num">{{ m(worst.necessary + worst.additional) }} di uscite</span>
      </div>
      <div class="panel hl">
        <span class="muted small">Uscite: necessarie / desideri</span>
        <strong class="num">{{ formatPercent(s.expenses ? s.necessary / s.expenses : null, 0) }} / {{ formatPercent(s.expenses ? s.additional / s.expenses : null, 0) }}</strong>
        <span class="num muted">{{ m(s.necessary) }} · {{ m(s.additional) }}</span>
      </div>
    </div>

    <div class="grid grid-2">
      <UiCard :title="`Categorie ${y}`" subtitle="Tocca una categoria per le sotto-categorie">
        <CategoryDonut :dataset="store.dataset" :operations="ops" :size="210" compact />
      </UiCard>
      <UiCard title="Rispetto all'anno precedente" :subtitle="`Uscite ${y} vs ${y - 1}`">
        <CategoryCompare :dataset="store.dataset" :current="ops" :previous="prevOps" :current-label="String(y)" :previous-label="String(y - 1)" :limit="12" />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; gap: 4px; }
.hl strong { font-size: 1.4rem; font-weight: 500; text-transform: capitalize; letter-spacing: -0.02em; }
</style>
