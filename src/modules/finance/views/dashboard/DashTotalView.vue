<script setup lang="ts">
import { computed } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiStat from '@/core/ui/UiStat.vue'
import { formatMoney, formatPercent, todayIso } from '@/core/utils/format'
import { computeAccountBalances, computeBalanceSeries, computeFlowSummary, monthOf, monthRange, opsInYear, yearsOf } from '../../domain'
import { useFinanceStore } from '../../store/financeStore'
import NetWorthChart from '../../components/NetWorthChart.vue'
import AccountTrendChart from '../../components/AccountTrendChart.vue'
import CategoryDonut from '../../components/CategoryDonut.vue'
import { accountSwatch } from '../../presentation'

const store = useFinanceStore()
const today = todayIso()
const cur = computed(() => store.baseCurrency)
const m = (v: number, sign = false) => formatMoney(v, cur.value, { sign })

const ops = computed(() => store.operations)
const s = computed(() => computeFlowSummary(store.dataset, ops.value))
const months = computed(() => (ops.value.length ? monthRange(monthOf(ops.value[0].date), today.slice(0, 7)) : []))
const series = computed(() => computeBalanceSeries(store.dataset, months.value))

/** Quota di patrimonio per conto (solo saldi positivi). */
const distribution = computed(() => {
  const list = computeAccountBalances(store.dataset)
    .map((b) => ({ name: b.account.name, value: b.valueBase ?? 0 }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = list.reduce((a, b) => a + b.value, 0) || 1
  return list.map((b) => ({ ...b, share: b.value / total, swatch: accountSwatch(store.dataset.accounts, b.name) }))
})

const perYear = computed(() =>
  yearsOf(ops.value, today).map((y) => {
    const f = computeFlowSummary(store.dataset, opsInYear(ops.value, y))
    return { y, ...f }
  }),
)
</script>

<template>
  <div class="stack">
    <div class="grid grid-kpi">
      <UiStat emphasis label="Risparmio complessivo" :tone="s.savings >= 0 ? 'pos' : 'neg'" :value="m(s.savings, true)" :hint="`Tasso di risparmio ${formatPercent(s.savingsRate, 0)}`" />
      <UiStat label="Entrate totali" :value="m(s.income)" swatch="--flow-income" :hint="`${months.length} mesi registrati`" />
      <UiStat label="Uscite totali" :value="m(s.expenses)" swatch="--flow-necessary" :hint="`Necessarie ${m(s.necessary)} · Desideri ${m(s.additional)}`" />
      <UiStat label="Capitale investito" :value="m(s.invested)" swatch="--flow-investment" :hint="`${s.operationCount} movimenti in totale`" />
    </div>

    <div class="grid grid-2">
      <UiCard title="Patrimonio nel tempo" subtitle="Liquidità e investimenti a fine mese">
        <NetWorthChart :points="series" :currency="cur" />
      </UiCard>
      <UiCard title="Dove si trova il patrimonio" subtitle="Valore attuale per conto">
        <p v-if="!distribution.length" class="muted small">Nessun saldo positivo.</p>
        <ul v-else class="dist">
          <li v-for="d in distribution" :key="d.name">
            <div class="dist__line">
              <span class="dist__name"><span class="dist__dot" :style="{ background: `var(${d.swatch})` }" />{{ d.name }}</span>
              <span class="num">{{ m(d.value) }} <span class="muted">· {{ formatPercent(d.share, 0) }}</span></span>
            </div>
            <div class="dist__track"><span :style="{ width: `${d.share * 100}%`, background: `var(${d.swatch})` }" /></div>
          </li>
        </ul>
      </UiCard>
    </div>

    <UiCard title="Andamento dei conti" subtitle="Saldo di fine mese per conto">
      <AccountTrendChart :points="series" :accounts="store.dataset.accounts" :currency="cur" :height="320" />
    </UiCard>

    <div class="grid grid-2">
      <UiCard title="Categorie di sempre" subtitle="Tutti i movimenti registrati">
        <CategoryDonut :dataset="store.dataset" :operations="ops" :size="210" compact />
      </UiCard>
      <UiCard title="Anno per anno">
        <table class="yt">
          <thead>
            <tr><th>Anno</th><th class="r">Entrate</th><th class="r">Uscite</th><th class="r">Risparmio</th><th class="r">Tasso</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in perYear" :key="r.y">
              <td>{{ r.y }}</td>
              <td class="r num">{{ m(r.income) }}</td>
              <td class="r num">{{ m(r.expenses) }}</td>
              <td class="r num" :class="r.savings >= 0 ? 'pos' : 'neg'">{{ m(r.savings, true) }}</td>
              <td class="r num">{{ formatPercent(r.savingsRate, 0) }}</td>
            </tr>
          </tbody>
        </table>
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.dist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.dist__line { display: flex; justify-content: space-between; gap: 10px; font-size: 0.9rem; margin-bottom: 6px; }
.dist__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dist__dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dist__track { height: 10px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.dist__track span { display: block; height: 100%; border-radius: 999px; }
.yt th, .yt td { padding: 9px 6px; border-bottom: 1px solid var(--border); font-size: 0.88rem; text-align: left; }
.yt th { color: var(--text-muted); font-weight: 400; font-size: 0.78rem; }
.yt .r { text-align: right; white-space: nowrap; }
</style>
