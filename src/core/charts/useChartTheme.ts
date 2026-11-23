import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Filler, Legend, Tooltip)

export interface ChartTheme {
  text: string
  textSecondary: string
  muted: string
  grid: string
  axis: string
  surface: string
  /** Risolve una variabile CSS (es. `--series-1`) nel colore effettivo. */
  color: (cssVar: string) => string
}

function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    text: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    muted: v('--text-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    surface: v('--surface'),
    color: (cssVar) => {
      // Segue le catene var(--a) → var(--b)
      let value = v(cssVar)
      const m = /^var\((--[\w-]+)\)$/.exec(value)
      if (m) value = v(m[1])
      return value || '#888'
    },
  }
}

/** Tema reattivo dei grafici: si aggiorna quando cambia lo schema chiaro/scuro. */
export function useChartTheme() {
  const theme = ref<ChartTheme>(readTheme())
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => (theme.value = readTheme())
  onMounted(() => mq.addEventListener('change', update))
  onBeforeUnmount(() => mq.removeEventListener('change', update))
  return theme
}

/** Opzioni comuni: griglia leggera, un solo asse Y, tooltip a indice. */
export function baseOptions(t: ChartTheme, formatY: (v: number) => string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        position: 'top' as const,
        align: 'start' as const,
        labels: { color: t.textSecondary, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, padding: 14 },
      },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.textSecondary,
        borderColor: t.axis,
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t.axis },
        ticks: { color: t.muted, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.muted, callback: (v: string | number) => formatY(Number(v)), maxTicksLimit: 6 },
      },
    },
  }
}
