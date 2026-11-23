<script setup lang="ts">
/**
 * Andamento del portafoglio in stile app di brokeraggio: una sola linea pulita,
 * senza assi né griglia, colorata in base al rendimento del periodo. Il valore
 * puntato viene emesso (`hover`) così il riepilogo in alto lo mostra al posto del totale.
 */
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { useChartTheme } from '@/core/charts/useChartTheme'
import type { PortfolioPoint } from '../domain'

const props = defineProps<{ points: PortfolioPoint[]; positive: boolean }>()
const emit = defineEmits<{ hover: [index: number | null] }>()
const theme = useChartTheme()

const data = computed(() => {
  const t = theme.value
  const color = t.color(props.positive ? '--positive' : '--negative')
  const start = props.points[0]?.value ?? 0
  return {
    labels: props.points.map((p) => p.date),
    datasets: [
      {
        label: 'Valore',
        data: props.points.map((p) => p.value / 100),
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: t.surface,
        pointHoverBorderWidth: 2,
        tension: 0.25,
        fill: {
          target: { value: start / 100 },
          above: `${color}14`,
          below: `${color}14`,
        },
      },
      {
        // Linea di riferimento puntinata: valore all'inizio del periodo.
        label: 'Inizio periodo',
        data: props.points.map(() => start / 100),
        borderColor: t.color('--axis'),
        borderWidth: 1.5,
        borderDash: [2, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  }
})

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  interaction: { mode: 'index' as const, intersect: false },
  layout: { padding: { top: 8, bottom: 4 } },
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false, grace: '8%' } },
  onHover: (_: unknown, elements: { index: number }[]) => emit('hover', elements[0]?.index ?? null),
}))
</script>

<template>
  <div class="pc" @mouseleave="emit('hover', null)" @touchend="emit('hover', null)">
    <Line :data="data" :options="options" role="img" aria-label="Andamento del valore del portafoglio nel periodo selezionato" />
  </div>
</template>

<style scoped>
.pc { position: relative; height: 260px; cursor: crosshair; }
@media (max-width: 760px) { .pc { height: 200px; } }
</style>
