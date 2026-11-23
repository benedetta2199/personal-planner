<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { baseOptions, useChartTheme } from '@/core/charts/useChartTheme'
import { formatMoney, formatMoneyCompact, formatMonth } from '@/core/utils/format'
import { accountSwatch } from '../presentation'
import type { Account, BalancePoint } from '../domain'

const props = defineProps<{ points: BalancePoint[]; accounts: Account[]; currency: string; height?: number }>()
const theme = useChartTheme()

const visible = computed(() => {
  const keys = new Set(Object.keys(props.points[0]?.byAccount ?? {}))
  return props.accounts.filter((a) => keys.has(a.name))
})

const data = computed(() => ({
  labels: props.points.map((p) => formatMonth(p.month)),
  datasets: visible.value.map((a) => {
    const color = theme.value.color(accountSwatch(props.accounts, a.name))
    return {
      label: a.name,
      data: props.points.map((p) => (p.byAccount[a.name] ?? 0) / 100),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBorderWidth: 2,
      pointHoverBorderColor: theme.value.surface,
      tension: 0.25,
    }
  }),
}))

const options = computed(() => {
  const base = baseOptions(theme.value, (v) => formatMoneyCompact(v, props.currency))
  return {
    ...base,
    plugins: {
      ...base.plugins,
      legend: { ...base.plugins.legend, display: visible.value.length > 1 },
      tooltip: {
        ...base.plugins.tooltip,
        itemSort: (a: { parsed: { y: number | null } }, b: { parsed: { y: number | null } }) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0),
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            ` ${ctx.dataset.label}: ${formatMoney(Math.round((ctx.parsed.y ?? 0) * 100), props.currency)}`,
        },
      },
    },
  }
})
</script>

<template>
  <div class="at" :style="{ height: `${height ?? 300}px` }">
    <Line :data="data" :options="options" role="img" aria-label="Andamento del saldo dei singoli conti" />
  </div>
</template>

<style scoped>
.at { position: relative; }
</style>
