<script setup lang="ts">
/**
 * Investimenti di un mese, in tre blocchi letti dall'alto in basso:
 * 1. com'è andato il mercato (rendimento del mese, al netto dei versamenti);
 * 2. l'andamento del valore del portafoglio nel mese (grafico, con valore puntato);
 * 3. dove sono andati i soldi versati o ritirati, investimento per investimento.
 */
import { computed, onMounted, ref, watch } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { summarizeInvestmentMonth } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { useInvestmentStore } from '../store/investmentStore'
import { plainName, subcategoryColor } from '../presentation'
import PortfolioChart from './PortfolioChart.vue'

const props = defineProps<{ month: string; monthName: string }>()

const finance = useFinanceStore()
const ledger = useLedgerStore()
const inv = useInvestmentStore()
/** Aggiorna le quotazioni solo se vecchie (la cache vale un'ora). */
onMounted(() => void inv.refresh())

const m = (v: number) => formatMoney(v, finance.baseCurrency)
const r = computed(() => summarizeInvestmentMonth(inv.groups, inv.series, props.month))
const tone = (v: number | null) => (!v ? '' : v > 0 ? 'pos' : 'neg')
const arrow = (v: number | null) => (!v ? '' : v > 0 ? '▲' : '▼')
const signedMoney = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${m(Math.abs(v))}`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatPercent(Math.abs(v), 2)}`
const colorOf = (category: string, name: string) => subcategoryColor(ledger.state.config, category, name === category ? '' : name, 'expense')
const hasAny = computed(() => r.value.rows.length > 0 || r.value.endValue !== null)

// ---- Grafico: il punto sotto il dito/mouse sostituisce il valore di fine mese --
const hover = ref<number | null>(null)
watch(() => props.month, () => (hover.value = null))
const showChart = computed(() => r.value.points.length >= 2)
const hoverPoint = computed(() => (hover.value === null ? null : r.value.points[hover.value] ?? null))
const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayLabel = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`))
const shownValue = computed(() => hoverPoint.value?.value ?? r.value.endValue)
const shownLabel = computed(() => (hoverPoint.value ? `Valore al ${dayLabel(hoverPoint.value.date)}` : 'Valore a fine mese'))
const firstLabel = computed(() => (r.value.points[0] ? dayLabel(r.value.points[0].date) : ''))
const lastLabel = computed(() => {
  const p = r.value.points.at(-1)
  return p ? dayLabel(p.date) : ''
})

// ---- Movimenti per investimento: barre in scala sull'importo maggiore ----------
const maxMove = computed(() => Math.max(1, ...r.value.rows.map((x) => x.bought + x.sold)))
const net = computed(() => r.value.bought - r.value.sold)
</script>

<template>
  <section class="panel mi" aria-labelledby="mv-inv">
    <header class="panel__head">
      <h2 id="mv-inv" class="panel__title"><span class="icon-chip"><UiIcon name="trend" /></span>Investimenti del mese</h2>
      <RouterLink :to="{ name: 'finance-investments' }" class="mi__go">Portafoglio <UiIcon name="arrowRight" :size="15" /></RouterLink>
    </header>

    <div v-if="!hasAny" class="mi__empty">
      <UiIcon name="trend" :size="22" />
      <p>Nessun investimento in {{ monthName }}.</p>
    </div>

    <template v-else>
      <!-- 1 · Rendimento e valore -->
      <div class="mi__hero">
        <div class="mi__perf" :class="r.gain ? (r.gain > 0 ? 'mi__perf--pos' : 'mi__perf--neg') : ''">
          <span class="mi__k">Rendimento di {{ monthName }}</span>
          <template v-if="r.gain !== null">
            <strong class="mi__big num" :class="tone(r.gain)"><span class="mi__arrow" aria-hidden="true">{{ arrow(r.gain) }}</span>{{ signedMoney(r.gain) }}</strong>
            <span v-if="r.gainPct !== null" class="pill" :class="r.gain > 0 ? 'pill--pos' : r.gain < 0 ? 'pill--neg' : ''">{{ signedPct(r.gainPct) }}</span>
          </template>
          <strong v-else class="mi__big muted">—</strong>
          <span class="mi__hint">Variazione di mercato, esclusi i versamenti</span>
        </div>
        <div class="mi__value">
          <span class="mi__k">{{ shownLabel }}</span>
          <strong class="mi__mid num">{{ shownValue !== null ? m(shownValue) : '—' }}</strong>
        </div>
      </div>

      <!-- 2 · Andamento nel mese -->
      <figure v-if="showChart" class="mi__chart">
        <PortfolioChart :points="r.points" :positive="(r.gain ?? 0) >= 0" class="mi__plot" @hover="hover = $event" />
        <figcaption class="mi__axis muted"><span>{{ firstLabel }}</span><span>{{ lastLabel }}</span></figcaption>
      </figure>

      <!-- 3 · Dove sono andati i soldi -->
      <details class="mi__flows">
        <summary class="mi__flowhead">
          <span class="mi__k"><UiIcon name="chevron" :size="15" class="mi__chev" />Versamenti<template v-if="r.rows.length"> · {{ r.rows.length }}</template></span>
          <span class="mi__sum num">
            <span>+{{ m(r.bought) }}</span>
            <template v-if="r.sold"> · <span class="muted">venduti {{ m(r.sold) }}</span></template>
          </span>
        </summary>
        <ul v-if="r.rows.length" class="mi__list">
          <li v-for="row in r.rows" :key="row.key" :style="{ '--c': colorOf(row.category, row.name) }">
            <div class="mi__line">
              <span class="mi__name"><span class="mi__dot" aria-hidden="true" />{{ plainName(row.name) }}</span>
              <span class="mi__amt num">
                <template v-if="row.bought">+{{ m(row.bought) }}</template>
                <template v-if="row.bought && row.sold"> · </template>
                <span v-if="row.sold" class="muted">−{{ m(row.sold) }}</span>
              </span>
            </div>
            <div class="mi__track" role="presentation">
              <span v-if="row.bought" class="mi__fill" :style="{ width: `${Math.max(3, (row.bought / maxMove) * 100)}%` }" />
              <span v-if="row.sold" class="mi__fill mi__fill--sold" :style="{ width: `${Math.max(3, (row.sold / maxMove) * 100)}%` }" />
            </div>
            <span class="mi__meta muted">
              {{ row.count }} {{ row.count === 1 ? 'operazione' : 'operazioni' }}<template v-if="row.saveback"> · {{ m(row.saveback) }} da saveback</template>
            </span>
          </li>
        </ul>
        <p v-else class="muted small">Nessun acquisto o vendita in {{ monthName }}: il valore cambia solo per il mercato.</p>
        <p v-if="r.rows.length && r.sold" class="mi__net small">
          Netto investito <strong class="num">{{ signedMoney(net) }}</strong>
        </p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.mi { display: flex; flex-direction: column; }
.mi__go { display: inline-flex; align-items: center; gap: 4px; font-size: 0.86rem; font-weight: 500; color: var(--accent); }
.mi__go:hover { text-decoration: none; color: var(--ink); }
.mi__k { font-size: 0.8rem; color: var(--text-secondary); }

.mi__empty { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 16px; background: var(--surface-2); color: var(--text-muted); }
.mi__empty p { color: var(--text-secondary); font-size: 0.9rem; }

/* 1 · Rendimento e valore */
.mi__hero { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 10px; }
.mi__perf, .mi__value { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 18px; background: var(--surface-2); min-width: 0; }
.mi__perf { flex-direction: row; flex-wrap: wrap; align-items: baseline; column-gap: 10px; }
.mi__perf .mi__k, .mi__perf .mi__hint { flex-basis: 100%; }
.mi__perf--pos { background: var(--positive-soft); }
.mi__perf--neg { background: var(--negative-soft); }
.mi__big { font-size: 1.7rem; font-weight: 450; letter-spacing: -0.03em; line-height: 1.1; white-space: nowrap; }
.mi__arrow { font-size: 0.5em; vertical-align: 0.3em; margin-right: 6px; }
.mi__mid { font-size: 1.35rem; font-weight: 450; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mi__value { justify-content: center; }
.mi__hint { font-size: 0.74rem; color: var(--text-muted); }

/* 2 · Grafico */
.mi__chart { margin: 14px 0 0; flex: 1 1 0; display: flex; flex-direction: column; min-height: 150px; }
.mi__chart > .mi__plot { flex: 1 1 0; height: auto; min-height: 150px; }
.mi__axis { display: flex; justify-content: space-between; font-size: 0.72rem; margin-top: 2px; }

/* 3 · Movimenti */
.mi__flows { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }
.mi__flows[open] > .mi__flowhead { margin-bottom: 12px; }
.mi__flows > :not(summary) + :not(summary) { margin-top: 12px; }
.mi__flowhead {
  display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
  list-style: none; cursor: pointer; padding: 6px 8px; margin: 0 -8px; border-radius: 12px;
  transition: background 0.15s ease;
}
.mi__flowhead::-webkit-details-marker { display: none; }
.mi__flowhead:hover { background: var(--surface-2); }
.mi__flowhead:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mi__flowhead .mi__k { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.mi__chev { color: var(--text-muted); transform: rotate(-90deg); transition: transform 0.15s ease; }
.mi__flows[open] .mi__chev { transform: none; }
.mi__sum { font-size: 0.95rem; font-weight: 550; }
.mi__sum .muted { font-weight: 400; }
.mi__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.mi__line { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 0.9rem; margin-bottom: 5px; }
.mi__name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: var(--text-primary); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mi__dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: none; }
.mi__amt { white-space: nowrap; }
.mi__track { display: flex; gap: 2px; height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.mi__fill { display: block; height: 100%; border-radius: 999px; background: var(--c); }
.mi__fill--sold {
  background: repeating-linear-gradient(135deg, var(--c) 0 3px, color-mix(in srgb, var(--c) 35%, var(--surface)) 3px 6px);
}
.mi__meta { display: block; margin-top: 4px; font-size: 0.74rem; }
.mi__net { display: flex; justify-content: space-between; color: var(--text-secondary); }

@media (max-width: 600px) {
  .mi__hero { grid-template-columns: minmax(0, 1fr); }
  .mi__big { font-size: 1.5rem; }
  .mi__chart, .mi__chart > .mi__plot { min-height: 130px; }
}
</style>
