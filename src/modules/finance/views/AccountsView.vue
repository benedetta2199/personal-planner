<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import UiCard from '@/core/ui/UiCard.vue'
import UiStat from '@/core/ui/UiStat.vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { formatDate, formatMoney } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import FinanceFilterBar from '../components/FinanceFilterBar.vue'
import AccountTrendChart from '../components/AccountTrendChart.vue'
import { ACCOUNT_TYPE_LABEL, FLOW_META, accountSwatch } from '../presentation'
import type { AccountBalance } from '../domain'

const store = useFinanceStore()
const router = useRouter()
const cur = computed(() => store.baseCurrency)
const nw = computed(() => store.netWorth!)

const visible = computed(() => {
  const sel = store.filters.accounts
  return store.balances.filter((b) => !sel.length || sel.includes(b.account.name))
})
const groups = computed(() => [
  { type: 'liquidity' as const, items: visible.value.filter((b) => b.account.type === 'liquidity') },
  { type: 'investment' as const, items: visible.value.filter((b) => b.account.type === 'investment') },
])

function showOperations(b: AccountBalance) {
  store.filters.accounts = [b.account.name]
  router.push({ name: 'finance-operations' })
}
</script>

<template>
  <div class="stack">
    <FinanceFilterBar />

    <section class="grid grid-kpi" aria-label="Riepilogo conti">
      <UiStat emphasis label="Patrimonio finanziario" :value="formatMoney(nw.netWorth, cur)" :hint="store.balanceAsOf ? `al ${formatDate(store.balanceAsOf)}` : 'ad oggi'" />
      <UiStat label="Liquidità" :value="formatMoney(nw.liquidity, cur)" swatch="--series-1" />
      <UiStat label="Conti di investimento" :value="formatMoney(nw.investmentAccounts, cur)" :swatch="FLOW_META.investment.swatch" :hint="nw.unrealizedGain ? `${formatMoney(nw.unrealizedGain, cur, { sign: true })} rispetto al versato` : 'Valore di carico'" />
      <UiStat label="Investimenti esterni" :value="formatMoney(nw.externalInvestments, cur)" hint="Uscite «Investimento», al costo" />
    </section>

    <template v-for="g in groups" :key="g.type">
      <section v-if="g.items.length" :aria-label="ACCOUNT_TYPE_LABEL[g.type]">
        <h2 class="acc__group">{{ g.type === 'liquidity' ? 'Conti di liquidità' : 'Conti di investimento' }}</h2>
        <div class="grid grid-3">
          <article v-for="b in g.items" :key="b.account.name" class="acc">
            <header class="acc__head">
              <span class="acc__swatch" :style="{ background: `var(${accountSwatch(store.dataset!.accounts, b.account.name)})` }" aria-hidden="true" />
              <h3>{{ b.account.name }}</h3>
              <span class="spacer" />
              <UiBadge>{{ b.account.currency }}</UiBadge>
            </header>
            <div class="acc__balance num" :class="{ neg: b.balance < 0 }">
              {{ formatMoney(b.usesMarketValue ? b.account.marketValue! : b.balance, b.account.currency) }}
            </div>
            <p class="muted small">
              <template v-if="b.usesMarketValue">
                Valore di mercato · versato {{ formatMoney(b.balance, b.account.currency) }}
              </template>
              <template v-else-if="b.account.currency !== cur && b.balanceBase !== null">≈ {{ formatMoney(b.balanceBase, cur) }}</template>
              <template v-else>Saldo contabile</template>
            </p>
            <div class="acc__meta">
              <UiBadge>{{ b.account.label ?? ACCOUNT_TYPE_LABEL[b.account.type] }}</UiBadge>
              <UiBadge v-if="!b.account.declared" tone="warning">dedotto</UiBadge>
              <span class="muted small">{{ b.operationCount }} mov.<template v-if="b.lastDate"> · ultimo {{ formatDate(b.lastDate) }}</template></span>
            </div>
            <UiButton size="sm" variant="ghost" icon="list" class="acc__btn" @click="showOperations(b)">Movimenti</UiButton>
          </article>
        </div>
      </section>
    </template>

    <UiCard title="Andamento dei conti" subtitle="Saldo di fine mese in valuta base (ai tassi correnti)">
      <AccountTrendChart :points="store.balanceSeries" :accounts="store.dataset!.accounts" :currency="cur" :height="340" />
    </UiCard>

    <p class="muted small">
      I conti marcati «dedotto» compaiono nelle operazioni ma non nel foglio <strong>Conti</strong>: aggiungili lì per indicarne tipo,
      valuta e saldo iniziale.
    </p>
  </div>
</template>

<style scoped>
.acc__group { margin: var(--space-2) 0 var(--space-3); font-size: 0.95rem; color: var(--text-secondary); }
.acc {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.acc__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.acc__head h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc__swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.acc__balance { font-size: 1.5rem; font-weight: 650; margin-top: 6px; }
.acc__meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.acc__btn { align-self: flex-start; margin-top: 6px; margin-left: -10px; }
</style>
