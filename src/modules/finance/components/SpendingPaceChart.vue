<script setup lang="ts">
/** Spesa cumulata giorno per giorno: mese scelto vs mese precedente vs media. */
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { baseOptions, useChartTheme } from '@/core/charts/useChartTheme'
import { formatMoney, formatMoneyCompact } from '@/core/utils/format'

const props = defineProps<{
  current: number[]
  previous: number[]
  average: number[]
  /** Giorni del mese corrente già trascorsi (le serie si fermano qui). */
  elapsed: number
  currency: string
  labels: { current: string; previous: string; average: string }
}>()
const theme = useChartTheme()

const days = computed(() => Math.max(props.current.length, props.previous.length, props.average.length))
const data = computed(() => {
  const t = theme.value
  const line = (label: string, values: (number | null)[], color: string, dash?: number[]) => ({
    label,
    data: values,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: dash,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: t.surface,
    tension: 0.25,
    spanGaps: false,
  })
  return {
    labels: Array.from({ length: days.value }, (_, i) => String(i + 1)),
    datasets: [
      line(props.labels.current, props.current.map((v, i) => (i < props.elapsed ? v / 100 : null)), t.color('--series-2')),
      line(props.labels.previous, props.previous.map((v) => v / 100), t.color('--series-4'), [5, 4]),
      line(props.labels.average, props.average.map((v) => v / 100), t.color('--series-other'), [2, 3]),
    ],
  }
})

const options = computed(() => {
  const base = baseOptions(theme.value, (v) => formatMoneyCompact(v, props.currency))
  return {
    ...base,
    scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 10 } } },
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          title: (items: { label: string }[]) => `Giorno ${items[0]?.label ?? ''}`,
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            ctx.parsed.y === null ? '' : ` ${ctx.dataset.label}: ${formatMoney(Math.round(ctx.parsed.y * 100), props.currency)}`,
        },
      },
    },
  }
})
</script>

<template>
  <div class="pace">
    <Line :data="data" :options="options" role="img" :aria-label="`Spesa cumulata: ${labels.current} contro ${labels.previous} e ${labels.average}`" />
  </div>
</template>

<style scoped>
.pace { position: relative; height: 280px; }
</style>
