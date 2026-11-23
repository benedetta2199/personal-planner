<script setup lang="ts">
import { computed, ref } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { formatMoney, formatPercent, todayIso } from '@/core/utils/format'
import { computeFlowSummary, daysInMonth, opsInMonth, shiftMonth, type Operation } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import MonthSwitcher from '../components/MonthSwitcher.vue'
import CategoryDonut from '../components/CategoryDonut.vue'
import TransactionsPanel from '../components/TransactionsPanel.vue'
import EntryDialog from '../components/EntryDialog.vue'
import InstrumentDialog from '../components/InstrumentDialog.vue'
import MonthInvestments from '../components/MonthInvestments.vue'
import { FLOW_META } from '../presentation'

const store = useFinanceStore()
const today = todayIso()
const month = ref(today.slice(0, 7))
const cur = computed(() => store.baseCurrency)
const m = (v: number, sign = false) => formatMoney(v, cur.value, { sign })

const ops = computed(() => opsInMonth(store.operations, month.value))
const s = computed(() => computeFlowSummary(store.dataset, ops.value))
const prev = computed(() => computeFlowSummary(store.dataset, opsInMonth(store.operations, shiftMonth(month.value, -1))))

/** Variazione percentuale rispetto al mese precedente (null se non confrontabile). */
const delta = (now: number, before: number) => (before ? (now - before) / Math.abs(before) : null)
const expDelta = computed(() => delta(s.value.expenses, prev.value.expenses))

const monthName = computed(() => {
  const [y, mo] = month.value.split('-').map(Number)
  return new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 1)))
})
/** Giorni trascorsi nel mese (tutto il mese se passato). */
const elapsedDays = computed(() => {
  const cm = today.slice(0, 7)
  if (month.value < cm) return daysInMonth(month.value)
  if (month.value > cm) return 0
  return Number(today.slice(8, 10))
})
const dailyAvg = computed(() => (elapsedDays.value ? Math.round(s.value.expenses / elapsedDays.value) : 0))

const typeRows = computed(() => {
  const rows = [
    { key: 'necessary' as const, label: 'Necessarie', value: s.value.necessary, prev: prev.value.necessary },
    { key: 'additional' as const, label: 'Desideri', value: s.value.additional, prev: prev.value.additional },
    { key: 'investment' as const, label: 'Investimenti', value: s.value.investedViaExpenses, prev: prev.value.investedViaExpenses },
  ]
  const max = Math.max(1, ...rows.map((r) => r.value))
  return rows.map((r) => ({ ...r, share: r.value / max, swatch: FLOW_META[r.key].swatch }))
})
const outTotal = computed(() => s.value.expenses + s.value.investedViaExpenses)

// ---- Dialog voce ----------------------------------------------------------
const dialogOpen = ref(false)
const selected = ref<Operation | null>(null)
const pickedDate = ref<string | null>(null)
const defaultDate = computed(() => pickedDate.value ?? (month.value === today.slice(0, 7) ? today : `${month.value}-01`))
function add() {
  selected.value = null
  pickedDate.value = null
  dialogOpen.value = true
}
/** Giorno selezionato nel calendario delle transazioni (se c'è). */
const calendarDay = ref<string | null>(null)
const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const calendarDayLabel = computed(() => {
  if (!calendarDay.value) return ''
  const [y, m, d] = calendarDay.value.split('-').map(Number)
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d)))
})
function addFromPanel() {
  if (calendarDay.value) addOn(calendarDay.value)
  else add()
}
/** Aggiunta da calendario: la voce nasce già con il giorno scelto. */
function addOn(date: string) {
  selected.value = null
  pickedDate.value = date
  dialogOpen.value = true
}
function openOp(op: Operation) {
  selected.value = op
  dialogOpen.value = true
}
const insOpen = ref(false)
const insCat = ref('')
const insSub = ref<string>('')
function askInstrument(category: string, sub: string) {
  insCat.value = category
  insSub.value = sub
  insOpen.value = true
}
const toast = ref<string | null>(null)
let toastTimer: number | undefined
function onSaved(op: Operation | null) {
  if (op && !op.date.startsWith(month.value)) month.value = op.date.slice(0, 7)
  toast.value = op ? 'Voce aggiunta' : 'Modifiche salvate'
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2500)
}
</script>

<template>
  <div class="mv">
    <div class="mv__bar">
      <MonthSwitcher v-model="month" />
      <button type="button" class="mv__add" @click="add">
        <UiIcon name="plus" :size="20" />
        Aggiungi voce
      </button>
    </div>

    <UiAlert v-if="s.missingRates.length" tone="warning">
      Tassi di cambio mancanti per {{ s.missingRates.join(', ') }}: quei movimenti sono esclusi dai totali in {{ cur }}.
    </UiAlert>

    <!-- Riepilogo ------------------------------------------------------->
    <div class="mv__top">
      <div class="mv__summary">
        <section class="panel hero" aria-labelledby="mv-balance">
          <div class="hero__head">
            <div>
              <p id="mv-balance" class="hero__label">Saldo di {{ monthName }}</p>
              <p class="hero__value big-num" :class="s.netCashflow > 0 ? 'pos' : s.netCashflow < 0 ? 'neg' : ''">
                <span class="hero__arrow" aria-hidden="true">{{ s.netCashflow > 0 ? '▲' : s.netCashflow < 0 ? '▼' : '' }}</span>{{ m(s.netCashflow, true) }}
              </p>
            </div>
            <RouterLink :to="{ name: 'finance-dash-month' }" class="hero__go" aria-label="Analisi mensile nella panoramica">
              <UiIcon name="arrowUpRight" :size="26" />
            </RouterLink>
          </div>
          <p class="muted small">Entrate meno uscite e capitale investito: quanto resta sui conti questo mese.</p>
          <div class="hero__stats">
            <div class="hero__stat">
              <span class="hero__k"><span class="dot" style="background: var(--flow-income)" />Entrate</span>
              <strong class="num pos">+{{ m(s.income) }}</strong>
            </div>
            <div class="hero__stat">
              <span class="hero__k"><span class="dot" style="background: var(--flow-necessary)" />Uscite</span>
              <strong class="num neg">−{{ m(s.expenses) }}</strong>
              <span v-if="expDelta !== null" class="pill" :class="expDelta > 0 ? 'pill--neg' : 'pill--pos'">
                {{ expDelta > 0 ? '+' : '' }}{{ formatPercent(expDelta, 0) }} vs mese prec.
              </span>
            </div>
            <div class="hero__stat">
              <span class="hero__k"><span class="dot" style="background: var(--flow-investment)" />Investito</span>
              <strong class="num">{{ m(s.invested) }}</strong>
            </div>
          </div>
        </section>

        <section class="savings" :class="s.savings < 0 ? 'savings--neg' : 'savings--pos'" aria-labelledby="mv-savings">
          <svg class="savings__deco" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" /></svg>
          <span class="savings__tag">{{ s.savings < 0 ? 'In perdita' : 'Risparmio' }}</span>
          <p id="mv-savings" class="savings__label">Risparmiato in {{ monthName }}</p>
          <div class="savings__row">
            <p class="savings__value big-num">{{ s.savings > 0 ? '▲ ' : s.savings < 0 ? '▼ ' : '' }}{{ m(s.savings, true) }}</p>
            <span v-if="s.savingsRate !== null" class="pill pill--white">{{ formatPercent(s.savingsRate, 0) }} delle entrate</span>
          </div>
          <div class="savings__tiles">
            <div class="savings__tile">
              <span>Media spesa / giorno</span>
              <strong class="num">{{ m(dailyAvg) }}</strong>
            </div>
            <div class="savings__tile">
              <span>Movimenti</span>
              <strong class="num">{{ s.operationCount }}</strong>
            </div>
          </div>
        </section>
      </div>

      <MonthInvestments :month="month" :month-name="monthName" />
    </div>

    <!-- Analisi + movimenti --------------------------------------------->
    <div class="mv__main">
      <div class="mv__col">
        <section class="panel" aria-labelledby="mv-cats">
          <header class="panel__head">
            <h2 id="mv-cats" class="panel__title"><span class="icon-chip"><UiIcon name="pie" /></span>Categorie del mese</h2>
          </header>
          <CategoryDonut :dataset="store.dataset" :operations="ops" :size="230" />
        </section>

        <section class="panel" aria-labelledby="mv-types">
          <header class="panel__head">
            <h2 id="mv-types" class="panel__title"><span class="icon-chip"><UiIcon name="wallet" /></span>Uscite per tipologia</h2>
            <span class="types__total num">{{ m(outTotal) }}</span>
          </header>
          <ul class="types">
            <li v-for="r in typeRows" :key="r.key">
              <div class="types__line">
                <span>{{ r.label }}</span>
                <span class="num">{{ m(r.value) }}</span>
              </div>
              <div class="types__track" role="presentation">
                <span class="types__fill" :style="{ width: `${Math.max(r.value ? 4 : 0, r.share * 100)}%`, background: `var(${r.swatch})` }" />
              </div>
              <span class="types__prev muted small">Mese precedente {{ m(r.prev) }}</span>
            </li>
          </ul>
        </section>

      </div>

      <section class="panel mv__tx" aria-labelledby="mv-tx">
        <header class="panel__head">
          <h2 id="mv-tx" class="panel__title"><span class="icon-chip"><UiIcon name="list" /></span>Transazioni</h2>
          <UiButton v-if="calendarDay" size="sm" icon="plus" variant="primary" :title="`Aggiungi voce il ${calendarDayLabel}`" @click="addFromPanel">
            {{ calendarDayLabel }}
          </UiButton>
          <UiButton v-else size="sm" icon="plus" aria-label="Aggiungi voce" title="Aggiungi voce" @click="addFromPanel" />
        </header>
        <TransactionsPanel v-model:day="calendarDay" v-model:month="month" :dataset="store.dataset" :operations="ops" @open="openOp" @add="addOn" />
      </section>
    </div>

    <EntryDialog :open="dialogOpen" :operation="selected" :default-date="defaultDate" @close="dialogOpen = false" @saved="onSaved" @needs-instrument="askInstrument" />
    <InstrumentDialog :open="insOpen" :category="insCat" :subcategory="insSub" @close="insOpen = false" />
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>

    <!-- Mobile: azione principale sempre a portata di pollice -->
    <button type="button" class="mv__fab" aria-label="Aggiungi voce" @click="add">
      <UiIcon name="plus" :size="24" />
      <span>Aggiungi</span>
    </button>
  </div>
</template>

<style scoped>
.mv { display: flex; flex-direction: column; gap: 18px; }
.mv__bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.mv__add {
  display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 24px 0 18px;
  border: 0; border-radius: 999px; background: var(--ink); color: var(--brand);
  font: inherit; font-size: 1rem; font-weight: 600; cursor: pointer;
  box-shadow: 0 6px 18px rgba(34, 64, 95, 0.28);
  transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.mv__add:hover { background: var(--ink-hover); transform: translateY(-1px); box-shadow: 0 10px 24px rgba(34, 64, 95, 0.32); }
.mv__add:focus-visible, .mv__fab:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.mv__fab {
  display: none; position: fixed; z-index: 55;
  right: 16px; bottom: calc(84px + env(safe-area-inset-bottom));
  align-items: center; gap: 6px; height: 56px; padding: 0 22px 0 18px;
  border: 0; border-radius: 999px; background: var(--ink); color: var(--brand);
  font: inherit; font-size: 1rem; font-weight: 600; cursor: pointer;
  box-shadow: 0 10px 28px rgba(18, 24, 33, 0.3);
}
.mv__fab:active { transform: scale(0.97); }
.mv__top { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; align-items: stretch; }
/* Le due card si dividono in parti uguali l'altezza della colonna (pari a quella degli investimenti). */
.mv__summary { display: grid; grid-template-rows: 1fr 1fr; gap: 18px; min-width: 0; }
.mv__main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 18px; align-items: start; }
.mv__col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.hero { display: flex; flex-direction: column; gap: 10px; padding: 26px 28px; }
.hero__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.hero__label { color: var(--text-secondary); font-size: 0.92rem; }
.hero__value { font-size: clamp(2.3rem, 4.4vw, 3.6rem); margin-top: 4px; }
.hero__arrow { font-size: 0.45em; vertical-align: 0.35em; margin-right: 8px; }
.hero__go {
  display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%;
  background: var(--brand); color: var(--on-brand); flex-shrink: 0; transition: transform 0.15s ease;
}
.hero__go:hover { transform: rotate(45deg); text-decoration: none; }
.hero__stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: auto; padding-top: 6px; }
.hero__stat { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border-radius: 18px; background: var(--surface-2); min-width: 0; }
.hero__stat strong { font-size: 1.15rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero__stat .pill { align-self: flex-start; font-size: 0.7rem; }
.hero__k { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.savings {
  position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px;
  background: var(--brand); color: var(--on-brand); border-radius: var(--radius-lg); padding: 24px 26px;
}
.savings__deco { position: absolute; right: -20px; top: -10px; width: 170px; height: 170px; fill: var(--brand-strong); opacity: 0.55; }
.savings__tag { position: relative; align-self: flex-start; background: var(--ink); color: var(--brand); border-radius: 999px; padding: 6px 14px; font-size: 0.82rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.savings__label { position: relative; margin-top: 10px; font-size: 0.92rem; }
.savings__row { position: relative; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.savings__value { font-size: clamp(2rem, 3.4vw, 2.8rem); }
.savings--pos .savings__value { color: var(--positive-strong); }
.savings--neg { background: var(--negative-soft); color: #5c1410; }
.savings--neg .savings__deco { fill: #f6cdc8; }
.savings--neg .savings__tag { background: var(--negative); color: #fff; }
.savings--neg .savings__value { color: var(--negative); }
.savings--neg .savings__tile { background: #f8d9d5; }
.savings--neg .pill--white { color: var(--negative); }
.savings__tiles { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; padding-top: 12px; }
.savings__tile { display: flex; flex-direction: column; gap: 2px; background: var(--brand-tile); border-radius: 16px; padding: 12px 14px; }
.savings__tile span { font-size: 0.78rem; }
.savings__tile strong { font-size: 1.2rem; font-weight: 500; }

.types { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.types__total { font-size: 1.5rem; letter-spacing: -0.03em; }
.types__line { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 6px; }
.types__track { height: 10px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.types__fill { display: block; height: 100%; border-radius: 999px; }
.types__prev { display: block; margin-top: 4px; font-size: 0.75rem; }

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;
  background: var(--ink); color: var(--brand); padding: 10px 20px; border-radius: 999px; font-weight: 500; box-shadow: var(--shadow-pop);
}
@media (max-width: 1100px) {
  .mv__top, .mv__main { grid-template-columns: minmax(0, 1fr); }
}
/* Tablet: le due card affiancate, investimenti sotto a tutta larghezza */
@media (min-width: 761px) and (max-width: 1100px) {
  .mv__summary { grid-template-rows: none; grid-template-columns: 1fr 1fr; }
  .hero__stats { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .mv__summary { grid-template-rows: none; }
}
@media (max-width: 600px) {
  .hero { padding: 20px 18px; }
  .hero__stats { grid-template-columns: 1fr 1fr; }
  .hero__go { width: 52px; height: 52px; }
  .toast { bottom: calc(150px + env(safe-area-inset-bottom)); }
}
@media (max-width: 640px) {
  .mv__add { display: none; }
  .mv__fab { display: inline-flex; }
  /* spazio perché il pulsante flottante non copra l'ultima riga */
  .mv { padding-bottom: 72px; }
}
</style>
