<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { baseOptions, useChartTheme } from '@/core/charts/useChartTheme'
import { formatMoney, formatMoneyCompact, formatMonth } from '@/core/utils/format'
import { FLOW_META } from '../presentation'
import type { MonthlyFlow } from '../domain'

const props = defineProps<{ flows: MonthlyFlow[]; currency: string }>()
const theme = useChartTheme()
const view = ref<'chart' | 'table'>('chart')

const series = [
  { key: 'income', stack: 'in', meta: FLOW_META.income },
  { key: 'necessary', stack: 'out', meta: FLOW_META.necessary },
  { key: 'additional', stack: 'out', meta: FLOW_META.additional },
  { key: 'invested', stack: 'out', meta: FLOW_META.investment },
] as const

const data = computed(() => ({
  labels: props.flows.map((f) => formatMonth(f.month)),
  datasets: series.map((s) => ({
    label: s.meta.label,
    stack: s.stack,
    data: props.flows.map((f) => f[s.key] / 100),
    backgroundColor: theme.value.color(s.meta.swatch),
    borderColor: theme.value.surface,
    borderWidth: { top: 2 },
    borderSkipped: 'start' as const,
    borderRadius: 4,
    maxBarThickness: 26,
    categoryPercentage: 0.7,
    barPercentage: 0.9,
  })),
}))

const options = computed(() => {
  const base = baseOptions(theme.value, (v) => formatMoneyCompact(v, props.currency))
  return {
    ...base,
    scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } },
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            ` ${ctx.dataset.label}: ${formatMoney(Math.round((ctx.parsed.y ?? 0) * 100), props.currency)}`,
          footer: (items: { dataIndex: number }[]) => {
            const f = props.flows[items[0]?.dataIndex ?? -1]
            return f ? `Risparmio: ${formatMoney(f.savings, props.currency)}` : ''
          },
        },
      },
    },
  }
})
</script>

<template>
  <div class="cf">
    <div class="cf__bar">
      <p class="muted small">Entrate a sinistra; a destra spese e capitale investito impilati.</p>
      <UiSegmented v-model="view" label="Vista" :options="[{ value: 'chart', label: 'Grafico' }, { value: 'table', label: 'Tabella' }]" />
    </div>
    <div v-if="view === 'chart'" class="cf__chart">
      <Bar :data="data" :options="options" aria-label="Flussi mensili: entrate, uscite necessarie, aggiuntive e investimenti" role="img" />
    </div>
    <div v-else class="cf__table">
      <table>
        <thead>
          <tr>
            <th>Mese</th>
            <th v-for="s in series" :key="s.key" class="r">{{ s.meta.label }}</th>
            <th class="r">Risparmio</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in flows" :key="f.month">
            <td>{{ formatMonth(f.month, 'long') }}</td>
            <td v-for="s in series" :key="s.key" class="r num">{{ formatMoney(f[s.key], currency) }}</td>
            <td class="r num" :class="f.savings >= 0 ? 'pos' : 'neg'">{{ formatMoney(f.savings, currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cf__bar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-2); }
.cf__chart { position: relative; height: 300px; }
.cf__table { overflow-x: auto; max-height: 320px; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 0.85rem; white-space: nowrap; }
th { text-align: left; color: var(--text-muted); font-weight: 500; position: sticky; top: 0; background: var(--surface); }
.r { text-align: right; }
</style>
