<script setup lang="ts">
/** Investimenti di un mese: quanto è stato versato o venduto e come è andato il portafoglio. */
import { computed, onMounted } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { summarizeInvestmentMonth } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { useInvestmentStore } from '../store/investmentStore'
import { plainName, subcategoryColor } from '../presentation'

const props = defineProps<{ month: string; monthName: string }>()

const finance = useFinanceStore()
const ledger = useLedgerStore()
const inv = useInvestmentStore()
/** Aggiorna le quotazioni solo se vecchie (la cache vale un'ora). */
onMounted(() => void inv.refresh())

const m = (v: number) => formatMoney(v, finance.baseCurrency)
const r = computed(() => summarizeInvestmentMonth(inv.groups, inv.series, props.month))
const tone = (v: number | null) => (!v ? '' : v > 0 ? 'pos' : 'neg')
const colorOf = (category: string, name: string) => subcategoryColor(ledger.state.config, category, name === category ? '' : name, 'expense')
const hasAny = computed(() => r.value.rows.length > 0 || r.value.endValue !== null)
</script>

<template>
  <section class="panel mi" aria-labelledby="mv-inv">
    <header class="panel__head">
      <h2 id="mv-inv" class="panel__title"><span class="icon-chip"><UiIcon name="trend" /></span>Investimenti del mese</h2>
      <RouterLink :to="{ name: 'finance-investments' }" class="mi__go">Portafoglio <UiIcon name="arrowRight" :size="15" /></RouterLink>
    </header>

    <p v-if="!hasAny" class="muted small">Nessun investimento in {{ monthName }}.</p>
    <template v-else>
      <dl class="mi__kpis">
        <div>
          <dt>Versato</dt>
          <dd class="num">{{ m(r.bought) }}</dd>
          <small v-if="r.saveback" class="muted">di cui {{ m(r.saveback) }} saveback</small>
        </div>
        <div v-if="r.sold">
          <dt>Venduto</dt>
          <dd class="num">{{ m(r.sold) }}</dd>
        </div>
        <div>
          <dt>Rendimento del mese</dt>
          <dd class="num" :class="tone(r.gain)">
            <template v-if="r.gain !== null">{{ r.gain > 0 ? '▲ +' : r.gain < 0 ? '▼ −' : '' }}{{ m(Math.abs(r.gain)) }}</template>
            <template v-else>—</template>
          </dd>
          <small v-if="r.gainPct !== null" class="num" :class="tone(r.gain)">{{ r.gainPct > 0 ? '+' : r.gainPct < 0 ? '−' : '' }}{{ formatPercent(Math.abs(r.gainPct), 2) }}</small>
        </div>
        <div>
          <dt>Valore a fine mese</dt>
          <dd class="num">{{ r.endValue !== null ? m(r.endValue) : '—' }}</dd>
        </div>
      </dl>

      <ul v-if="r.rows.length" class="mi__list">
        <li v-for="row in r.rows" :key="row.key">
          <span class="mi__dot" :style="{ background: colorOf(row.category, row.name) }" aria-hidden="true" />
          <span class="mi__name">
            <strong>{{ plainName(row.name) }}</strong>
            <span class="muted small">{{ row.count }} {{ row.count === 1 ? 'operazione' : 'operazioni' }}</span>
          </span>
          <span class="mi__amt num">
            <span v-if="row.bought">+{{ m(row.bought) }}</span>
            <span v-if="row.sold" class="muted">venduti {{ m(row.sold) }}</span>
          </span>
        </li>
      </ul>
      <p v-else class="muted small">Nessun acquisto o vendita in {{ monthName }}.</p>
    </template>
  </section>
</template>

<style scoped>
.mi__go { display: inline-flex; align-items: center; gap: 4px; font-size: 0.86rem; font-weight: 500; color: var(--accent); }
.mi__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 0 0 14px; }
.mi__kpis div { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 16px; background: var(--surface-2); min-width: 0; }
.mi__kpis dt { font-size: 0.78rem; color: var(--text-secondary); }
.mi__kpis dd { margin: 0; font-size: 1.1rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mi__kpis small { font-size: 0.75rem; }
.mi__list { list-style: none; margin: 0; padding: 0; }
.mi__list li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 2px; }
.mi__list li + li { border-top: 1px solid var(--border); }
.mi__dot { width: 10px; height: 10px; border-radius: 50%; }
.mi__name { display: flex; flex-direction: column; min-width: 0; }
.mi__name strong { color: var(--text-primary); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mi__amt { display: flex; flex-direction: column; align-items: flex-end; font-size: 0.92rem; white-space: nowrap; }
.mi__amt .muted { font-size: 0.78rem; }
</style>
