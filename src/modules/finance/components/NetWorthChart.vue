<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { baseOptions, useChartTheme } from '@/core/charts/useChartTheme'
import { formatMoney, formatMoneyCompact, formatMonth } from '@/core/utils/format'
import type { BalancePoint } from '../domain'

const props = defineProps<{ points: BalancePoint[]; currency: string }>()
const theme = useChartTheme()

const withAlpha = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const data = computed(() => {
  const liq = theme.value.color('--series-1')
  const inv = theme.value.color('--flow-investment')
  return {
    labels: props.points.map((p) => formatMonth(p.month)),
    datasets: [
      {
        label: 'Liquidità',
        data: props.points.map((p) => p.liquidity / 100),
        borderColor: liq,
        backgroundColor: withAlpha(liq, 0.18),
        fill: 'origin',
        stack: 'nw',
      },
      {
        label: 'Investimenti (valore di carico)',
        data: props.points.map((p) => p.investments / 100),
        borderColor: inv,
        backgroundColor: withAlpha(inv, 0.22),
        fill: '-1',
        stack: 'nw',
      },
    ].map((d) => ({ ...d, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: theme.value.surface, tension: 0.25 })),
  }
})

const options = computed(() => {
  const base = baseOptions(theme.value, (v) => formatMoneyCompact(v, props.currency))
  return {
    ...base,
    scales: { x: base.scales.x, y: { ...base.scales.y, stacked: true } },
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            ` ${ctx.dataset.label}: ${formatMoney(Math.round((ctx.parsed.y ?? 0) * 100), props.currency)}`,
          footer: (items: { dataIndex: number }[]) => {
            const p = props.points[items[0]?.dataIndex ?? -1]
            return p ? `Patrimonio: ${formatMoney(p.liquidity + p.investments, props.currency)}` : ''
          },
        },
      },
    },
  }
})
</script>

<template>
  <div class="nw">
    <Line :data="data" :options="options" role="img" aria-label="Andamento del patrimonio: liquidità e investimenti" />
  </div>
</template>

<style scoped>
.nw { position: relative; height: 280px; }
</style>
