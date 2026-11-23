<script setup lang="ts">
import { computed, ref } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiButton from '@/core/ui/UiButton.vue'
import AccountDialog from '../../components/AccountDialog.vue'
import { formatMoney, formatPercent, todayIso } from '@/core/utils/format'
import { computeAccountBalances, computeNetWorth, monthEnd, shiftMonth } from '../../domain'
import { useFinanceStore } from '../../store/financeStore'
import { useLedgerStore } from '../../store/ledgerStore'
import AccountCard from '../../components/AccountCard.vue'
import { ACCOUNT_TYPE_LABEL } from '../../presentation'
import { dashboardTabs } from '../../routes'
import SubNav from '../../components/SubNav.vue'

const store = useFinanceStore()
const ledger = useLedgerStore()
const cur = computed(() => store.baseCurrency)
const accountDialog = ref(false)

/** Saldi attuali (indipendenti dai filtri) e a fine mese precedente. */
const now = computed(() => computeAccountBalances(store.dataset))
const lastMonthEnd = monthEnd(shiftMonth(todayIso().slice(0, 7), -1))
const before = computed(() => new Map(computeAccountBalances(store.dataset, { asOf: lastMonthEnd }).map((b) => [b.account.name, b.balance])))
const nw = computed(() => computeNetWorth(store.dataset, now.value))
const nwBefore = computed(() => computeNetWorth(store.dataset, computeAccountBalances(store.dataset, { asOf: lastMonthEnd }), { asOf: lastMonthEnd }))

const cards = computed(() =>
  ledger.state.config.accounts
    .filter((a) => a.showCard)
    .map((cfg) => {
      const b = now.value.find((x) => x.account.name === cfg.name)
      const balance = b ? (b.usesMarketValue ? b.account.marketValue! : b.balance) : 0
      return {
        cfg,
        balance,
        currency: b?.account.currency ?? cfg.currency,
        delta: b ? b.balance - (before.value.get(cfg.name) ?? b.account.openingBalance) : null,
      }
    }),
)
const others = computed(() => {
  const shown = new Set(cards.value.map((c) => c.cfg.name))
  return now.value.filter((b) => !shown.has(b.account.name) && (b.balance !== 0 || b.operationCount))
})
const nwDelta = computed(() => nw.value.netWorth - nwBefore.value.netWorth)
const nwDeltaPct = computed(() => (nwBefore.value.netWorth > 0 ? nwDelta.value / nwBefore.value.netWorth : null))

/** Ripartizione liquidità / investimenti per la barra (solo valori positivi). */
const split = computed(() => {
  const liq = Math.max(0, nw.value.liquidity)
  const inv = Math.max(0, nw.value.investments)
  const total = liq + inv
  return [
    { key: 'liq', label: 'Liquidità', value: nw.value.liquidity, share: total ? liq / total : 0, color: 'var(--accent)' },
    { key: 'inv', label: 'Investimenti', value: nw.value.investments, share: total ? inv / total : 0, color: 'var(--flow-investment)' },
  ]
})
const accountCount = computed(() => cards.value.length + others.value.length)
</script>

<template>
  <div class="dl">
    <section class="dl__accounts" aria-labelledby="dl-acc">
      <header class="dl__head">
        <div class="dl__titles">
          <h2 id="dl-acc" class="panel__title"><span class="icon-chip"><UiIcon name="card" /></span>I tuoi conti</h2>
          <span class="dl__count muted small">{{ accountCount }} {{ accountCount === 1 ? 'conto' : 'conti' }}</span>
        </div>
        <UiButton size="sm" icon="plus" @click="accountDialog = true">Nuovo conto</UiButton>
      </header>

      <div class="dl__summary">
        <div class="dl__nwbox">
          <p class="dl__label">Patrimonio totale</p>
          <p class="dl__nw big-num">{{ formatMoney(nw.netWorth, cur) }}</p>
          <p v-if="nwDelta" class="dl__delta num" :class="nwDelta > 0 ? 'pos' : 'neg'">
            {{ nwDelta > 0 ? '▲' : '▼' }} {{ formatMoney(Math.abs(nwDelta), cur) }}
            <template v-if="nwDeltaPct !== null">({{ formatPercent(Math.abs(nwDeltaPct), 1) }})</template>
            <span class="muted">questo mese</span>
          </p>
          <p v-else class="dl__delta muted">Nessuna variazione questo mese</p>
        </div>

        <div class="dl__split" aria-label="Composizione del patrimonio">
          <div class="dl__bar" role="img" :aria-label="split.map((x) => `${x.label} ${formatPercent(x.share, 0)}`).join(', ')">
            <span v-for="x in split" v-show="x.share > 0" :key="x.key" :style="{ flexGrow: x.share, background: x.color }" />
          </div>
          <ul class="dl__legend">
            <li v-for="x in split" :key="x.key">
              <span class="dl__dot" :style="{ background: x.color }" aria-hidden="true" />
              <span class="dl__legend-label">{{ x.label }}</span>
              <strong class="num">{{ formatMoney(x.value, cur) }}</strong>
              <span class="muted num">{{ formatPercent(x.share, 0) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="dl__cards">
        <AccountCard
          v-for="c in cards"
          :key="c.cfg.id"
          :name="c.cfg.name"
          :balance="c.balance"
          :currency="c.currency"
          :theme="c.cfg.cardTheme"
          :kind="ACCOUNT_TYPE_LABEL[c.cfg.type]"
          :month-delta="c.delta"
        />
      </div>

      <div v-if="others.length" class="dl__others">
        <p class="dl__label">Altri conti</p>
        <ul>
          <li v-for="b in others" :key="b.account.name">
            <span class="dl__other-name">{{ b.account.name }}</span>
            <span class="muted small">{{ ACCOUNT_TYPE_LABEL[b.account.type] }}</span>
            <strong class="num">{{ formatMoney(b.balance, b.account.currency) }}</strong>
          </li>
        </ul>
      </div>
    </section>

    <SubNav :tabs="dashboardTabs" label="Sezioni della dashboard" />
    <AccountDialog :open="accountDialog" @close="accountDialog = false" />

    <RouterView />
  </div>
</template>

<style scoped>
.dl { display: flex; flex-direction: column; gap: 18px; }
.dl__accounts { background: var(--surface); border-radius: var(--radius-lg); padding: 24px; display: flex; flex-direction: column; gap: 20px; }
.dl__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.dl__titles { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.dl__label { font-size: 0.82rem; color: var(--text-secondary); }

/* Patrimonio a sinistra, composizione a destra */
.dl__summary {
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: center;
  padding: 20px 22px; border-radius: var(--radius); background: var(--brand-soft);
}
.dl__nwbox { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dl__nw { font-size: clamp(2.2rem, 4vw, 3.2rem); color: var(--on-brand); }
.dl__delta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 0.92rem; font-weight: 500; }
.dl__delta .muted { font-weight: 400; }
.dl__split { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dl__bar { display: flex; gap: 3px; height: 12px; border-radius: 999px; overflow: hidden; background: var(--surface); }
.dl__bar span { flex-basis: 0; min-width: 6px; }
.dl__legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.dl__legend li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto 40px; align-items: center; gap: 10px; font-size: 0.9rem; }
.dl__legend strong { font-weight: 550; }
.dl__legend .muted { text-align: right; font-size: 0.82rem; }
.dl__dot { width: 10px; height: 10px; border-radius: 50%; }
.dl__legend-label { color: var(--text-secondary); }

.dl__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }

.dl__others { display: flex; flex-direction: column; gap: 8px; }
.dl__others ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.dl__others li {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 10px;
  padding: 10px 14px; border-radius: 14px; border: 1px solid var(--border);
}
.dl__others li strong { grid-row: 1 / 3; grid-column: 2; align-self: center; font-weight: 550; }
.dl__other-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 760px) {
  .dl__summary { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 18px; }
}
@media (max-width: 600px) {
  .dl__accounts { padding: 18px 16px; }
  .dl__cards { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; }
  .dl__cards > * { flex: 0 0 78%; scroll-snap-align: start; }
}
</style>
