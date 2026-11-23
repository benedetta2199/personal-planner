<script setup lang="ts">
import { computed } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiStat from '@/core/ui/UiStat.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { formatDate, formatMoney, formatPercent } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import FinanceFilterBar from '../components/FinanceFilterBar.vue'
import CashflowChart from '../components/CashflowChart.vue'
import NetWorthChart from '../components/NetWorthChart.vue'
import SpendingSplit from '../components/SpendingSplit.vue'
import CategoryBreakdown from '../components/CategoryBreakdown.vue'
import AccountTrendChart from '../components/AccountTrendChart.vue'
import { FLOW_META } from '../presentation'

const store = useFinanceStore()
const cur = computed(() => store.baseCurrency)
const m = (v: number | undefined | null, sign = false) => formatMoney(v ?? null, cur.value, { sign })

const s = computed(() => store.flowSummary!)
const nw = computed(() => store.netWorth!)
const missingRates = computed(() => [...new Set([...(s.value?.missingRates ?? []), ...(nw.value?.missingRates ?? [])])])
const balanceNote = computed(() => (store.balanceAsOf ? `al ${formatDate(store.balanceAsOf)}` : 'ad oggi'))
</script>

<template>
  <div class="stack">
    <FinanceFilterBar />

    <UiAlert v-if="missingRates.length" tone="warning">
      Tassi di cambio mancanti per {{ missingRates.join(', ') }}: quei movimenti sono esclusi dai totali in {{ cur }}.
    </UiAlert>

    <section aria-labelledby="dashboard-assets" class="dashboard__section">
      <header class="dashboard__section-head">
        <h2 id="dashboard-assets">Il tuo patrimonio</h2>
        <p class="muted small">Liquidità e investimenti, aggiornati {{ balanceNote }}.</p>
      </header>
      <div class="grid grid-kpi">
        <UiStat emphasis label="Patrimonio finanziario" :value="m(nw.netWorth)" hint="Liquidità + investimenti" />
        <UiStat label="Saldo conti (liquidità)" :value="m(nw.liquidity)" swatch="--series-1" :hint="`Somma dei conti correnti, carte, contanti`" />
        <UiStat label="Investimenti" :value="m(nw.investments)" :swatch="FLOW_META.investment.swatch">
          <template #hint>
            <span v-if="nw.unrealizedGain" :class="nw.unrealizedGain > 0 ? 'pos' : 'neg'">{{ m(nw.unrealizedGain, true) }} plusvalenza</span>
            <span v-else>Valore di carico</span>
            <span v-if="nw.externalInvestments"> · {{ m(nw.externalInvestments) }} esterni</span>
          </template>
        </UiStat>
        <UiStat label="Risparmio nel periodo" :value="m(s.savings, true)" :tone="s.savings >= 0 ? 'pos' : 'neg'" :hint="`Tasso di risparmio ${formatPercent(s.savingsRate)}`" />
      </div>
    </section>

    <section aria-labelledby="dashboard-flows" class="dashboard__section">
      <header class="dashboard__section-head">
        <h2 id="dashboard-flows">Flussi nel periodo</h2>
        <p class="muted small">Entrate, spese e capitale investito nel periodo selezionato.</p>
      </header>
      <div class="grid grid-kpi">
        <UiStat :label="FLOW_META.income.label" :value="m(s.income)" :swatch="FLOW_META.income.swatch" :hint="`${s.operationCount} movimenti nel periodo`" />
        <UiStat label="Uscite (consumo)" :value="m(s.expenses)" :hint="`Necessarie ${m(s.necessary)} · Aggiuntive ${m(s.additional)}`" />
        <UiStat label="Capitale investito" :value="m(s.invested)" :swatch="FLOW_META.investment.swatch" :hint="`Uscite ${m(s.investedViaExpenses)} · Trasferimenti ${m(s.investedViaTransfers)}`" />
        <UiStat label="Flusso di cassa netto" :value="m(s.netCashflow, true)" :tone="s.netCashflow >= 0 ? 'pos' : 'neg'" :hint="`Trasferimenti esclusi (${m(s.transferVolume)} movimentati)`" />
      </div>
    </section>

    <UiCard title="Flussi nel tempo" subtitle="Entrate, spese e investimenti mese per mese">
      <CashflowChart :flows="store.monthlyFlows" :currency="cur" />
    </UiCard>

    <div class="grid grid-2">
      <UiCard title="Patrimonio nel tempo" subtitle="Saldi di fine mese in valuta base">
        <NetWorthChart :points="store.balanceSeries" :currency="cur" />
      </UiCard>
      <UiCard title="Dove vanno le uscite" subtitle="Necessarie, aggiuntive e investimenti nel periodo">
        <SpendingSplit :summary="s" :currency="cur" />
      </UiCard>
    </div>

    <div class="grid grid-2">
      <UiCard title="Per categoria" subtitle="Distribuzione per categoria e sotto-categoria">
        <CategoryBreakdown :dataset="store.dataset!" :operations="store.filteredOperations" />
      </UiCard>
      <UiCard title="Andamento dei conti" subtitle="Saldo di fine mese per conto">
        <AccountTrendChart :points="store.balanceSeries" :accounts="store.dataset!.accounts" :currency="cur" />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.dashboard__section { display: flex; flex-direction: column; gap: 12px; }
.dashboard__section-head { display: flex; flex-direction: column; gap: 3px; }
.dashboard__section-head h2 { font-size: 1rem; font-weight: 650; }
</style>
