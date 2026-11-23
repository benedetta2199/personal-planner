<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { baseOptions, useChartTheme } from '@/core/charts/useChartTheme'
import { formatMoney, formatMoneyCompact, formatPercent } from '@/core/utils/format'
import { computeCategoryBreakdown, type FinanceDataset, type FlowType, type Operation } from '../domain'
import { FLOW_META } from '../presentation'

const props = defineProps<{ dataset: FinanceDataset; operations: Operation[]; maxBars?: number }>()
const theme = useChartTheme()

type Mode = 'expenses' | 'income' | 'investment'
const mode = ref<Mode>('expenses')
const drill = ref<string | null>(null)
watch(mode, () => (drill.value = null))

const MODE_TYPES: Record<Mode, FlowType[]> = {
  expenses: ['necessary', 'additional'],
  income: ['income'],
  investment: ['investment'],
}
const MODE_SWATCH: Record<Mode, string> = {
  expenses: '--flow-necessary',
  income: FLOW_META.income.swatch,
  investment: FLOW_META.investment.swatch,
}

const breakdown = computed(() => computeCategoryBreakdown(props.dataset, props.operations, MODE_TYPES[mode.value]))
const total = computed(() => breakdown.value.reduce((s, c) => s + c.total, 0))

const rows = computed(() => {
  if (drill.value) {
    const cat = breakdown.value.find((c) => c.name === drill.value)
    return (cat?.subcategories ?? []).map((s) => ({ name: s.name, total: s.total, count: s.count, parentTotal: cat!.total }))
  }
  return breakdown.value.map((c) => ({ name: c.name, total: c.total, count: c.count, parentTotal: total.value }))
})

const limit = computed(() => props.maxBars ?? 10)
const chartRows = computed(() => {
  const r = rows.value
  if (r.length <= limit.value) return r
  const head = r.slice(0, limit.value - 1)
  const rest = r.slice(limit.value - 1)
  return [...head, { name: `Altre (${rest.length})`, total: rest.reduce((s, x) => s + x.total, 0), count: rest.reduce((s, x) => s + x.count, 0), parentTotal: r[0].parentTotal }]
})

/** Valore per riga e tipo di flusso (per impilare necessarie/aggiuntive nelle spese). */
function valuesFor(type: FlowType): number[] {
  const cats = computeCategoryBreakdown(props.dataset, props.operations, [type])
  const lookup = new Map<string, number>()
  if (drill.value) cats.find((c) => c.name === drill.value)?.subcategories.forEach((s) => lookup.set(s.name, s.total))
  else cats.forEach((c) => lookup.set(c.name, c.total))
  const named = new Set(chartRows.value.map((r) => r.name))
  const otherTotal = [...lookup.entries()].filter(([n]) => !named.has(n)).reduce((s, [, v]) => s + v, 0)
  return chartRows.value.map((r) => (lookup.get(r.name) ?? (r.name.startsWith('Altre (') ? otherTotal : 0)) / 100)
}

const data = computed(() => {
  const common = { borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 18, borderColor: theme.value.surface, borderWidth: { right: 2 } }
  const types = mode.value === 'expenses' ? (['necessary', 'additional'] as const) : null
  return {
    labels: chartRows.value.map((r) => r.name),
    datasets: types
      ? types.map((t) => ({ ...common, label: FLOW_META[t].label, stack: 's', data: valuesFor(t), backgroundColor: theme.value.color(FLOW_META[t].swatch) }))
      : [{ ...common, label: 'Totale', data: chartRows.value.map((r) => r.total / 100), backgroundColor: theme.value.color(MODE_SWATCH[mode.value]) }],
  }
})

const options = computed(() => {
  const base = baseOptions(theme.value, (v) => formatMoneyCompact(v, props.dataset.baseCurrency))
  return {
    ...base,
    indexAxis: 'y' as const,
    interaction: { mode: 'nearest' as const, intersect: false, axis: 'y' as const },
    onClick: (_: unknown, els: { index: number }[]) => {
      if (drill.value || !els.length) return
      const name = chartRows.value[els[0].index]?.name
      if (name && breakdown.value.some((c) => c.name === name)) drill.value = name
    },
    onHover: (e: { native: Event | null }, els: unknown[]) => {
      const t = e.native?.target as HTMLElement | undefined
      if (t) t.style.cursor = !drill.value && els.length ? 'pointer' : 'default'
    },
    scales: {
      x: { ...base.scales.y, stacked: true, grid: { color: theme.value.grid }, ticks: { ...base.scales.y.ticks, maxTicksLimit: 5 } },
      y: { ...base.scales.x, stacked: true, ticks: { color: theme.value.textSecondary, autoSkip: false } },
    },
    plugins: {
      ...base.plugins,
      legend: { ...base.plugins.legend, display: mode.value === 'expenses' },
      tooltip: {
        ...base.plugins.tooltip,
        mode: 'index' as const,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { x: number | null } }) =>
            ` ${ctx.dataset.label}: ${formatMoney(Math.round((ctx.parsed.x ?? 0) * 100), props.dataset.baseCurrency)}`,
          footer: (items: { dataIndex: number }[]) => {
            const r = chartRows.value[items[0]?.dataIndex ?? -1]
            return r ? `Totale ${formatMoney(r.total, props.dataset.baseCurrency)} · ${formatPercent(r.parentTotal ? r.total / r.parentTotal : 0)} · ${r.count} op.` : ''
          },
        },
      },
    },
  }
})

const chartHeight = computed(() => Math.max(140, chartRows.value.length * 30 + 40))
</script>

<template>
  <div class="cb">
    <div class="cb__bar">
      <UiSegmented
        v-model="mode"
        label="Tipo di ripartizione"
        :options="[
          { value: 'expenses', label: 'Spese' },
          { value: 'income', label: 'Entrate' },
          { value: 'investment', label: 'Investimenti' },
        ]"
      />
      <div v-if="drill" class="row">
        <span class="small"><span class="muted">Categoria:</span> <strong>{{ drill }}</strong></span>
        <UiButton size="sm" variant="ghost" icon="close" @click="drill = null">Tutte</UiButton>
      </div>
      <span v-else class="muted small">Tocca una barra per le sotto-categorie</span>
    </div>
    <p v-if="!rows.length" class="muted small cb__empty">Nessun movimento per i filtri selezionati.</p>
    <div v-else class="cb__chart" :style="{ height: `${chartHeight}px` }">
      <Bar :data="data" :options="options" role="img" :aria-label="`Ripartizione per ${drill ? 'sotto-categoria di ' + drill : 'categoria'}`" />
    </div>
    <p v-if="mode === 'investment' && rows.length" class="muted small">
      Include solo le uscite di tipo Investimento; i trasferimenti verso conti di investimento sono nella scheda Conti.
    </p>
  </div>
</template>

<style scoped>
.cb__bar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
.cb__chart { position: relative; }
.cb__empty { padding: var(--space-5) 0; text-align: center; }
</style>
