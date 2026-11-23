<script setup lang="ts">
/** Elenco dei piani di accumulo (PAC) con creazione, modifica, pausa ed eliminazione. */
import { computed, ref } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import { formatDate, formatMoney, todayIso } from '@/core/utils/format'
import { PLAN_FREQUENCY_LABEL, monthlyEquivalent, splitSubKey, upcomingCharges, type InvestmentPlan, type Position } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { plainName } from '../presentation'
import PlanDialog from './PlanDialog.vue'

const props = defineProps<{ positions: Position[] }>()
const emit = defineEmits<{ newInvestment: [] }>()
const finance = useFinanceStore()
const ledger = useLedgerStore()
const m = (c: number) => formatMoney(c, finance.baseCurrency)

const plans = computed(() => ledger.state.plans ?? [])
const hasEtf = computed(() => props.positions.some((p) => p.type === 'etf'))
const open = ref(false)
const editing = ref<InvestmentPlan | null>(null)
const presetKey = ref<string | null>(null)

/** Apre la creazione, eventualmente con l'ETF già scelto (usato dal dettaglio della posizione). */
function newPlan(key: string | null = null) {
  editing.value = null
  presetKey.value = key
  open.value = true
}
function editPlan(plan: InvestmentPlan) {
  editing.value = plan
  open.value = true
}
function deletePlan(plan: InvestmentPlan) {
  if (!window.confirm(`Eliminare il PAC su «${planName(plan)}»? Gli addebiti già registrati restano.`)) return
  ledger.removePlan(plan.id)
}
defineExpose({ newPlan })

const planName = (plan: InvestmentPlan) => {
  const { category, subcategory } = splitSubKey(plan.key)
  return plainName(subcategory || category)
}
const nextCharge = (plan: InvestmentPlan) => {
  if (!plan.active) return null
  const today = todayIso()
  return upcomingCharges(plan, today > plan.generatedUntil ? today : plan.generatedUntil, 2).find((d) => d > plan.generatedUntil) ?? null
}
const monthly = computed(() => plans.value.filter((x) => x.active).reduce((a, x) => a + monthlyEquivalent(x), 0))
</script>

<template>
  <section class="panel pac" aria-labelledby="pac-title">
    <header class="panel__head">
      <h2 id="pac-title" class="panel__title">Piani di accumulo</h2>
      <UiButton size="sm" variant="primary" icon="plus" @click="hasEtf ? newPlan() : emit('newInvestment')">{{ hasEtf ? 'Nuovo PAC' : 'Aggiungi un ETF' }}</UiButton>
    </header>
    <p v-if="!plans.length" class="muted small">
      Imposta un importo fisso su un ETF: ogni settimana (lunedì), ogni 15 giorni (il 2 e il 18) o ogni mese (il 2).
      Gli addebiti vengono registrati da soli.
      <template v-if="!hasEtf"><br />Per iniziare aggiungi l'ETF su cui investire.</template>
    </p>
    <template v-else>
      <p class="pac__total muted small">Attivi: <strong class="num">{{ m(monthly) }}</strong> al mese</p>
      <ul class="pac__list">
        <li v-for="plan in plans" :key="plan.id" class="pac__item" :class="{ 'pac__item--off': !plan.active }">
          <div class="pac__main">
            <strong>{{ planName(plan) }}</strong>
            <span class="muted small">
              <span class="num">{{ m(plan.amount) }}</span> · {{ PLAN_FREQUENCY_LABEL[plan.frequency].label.toLowerCase() }} · {{ plan.account }}
            </span>
            <span class="pac__next small">
              <template v-if="!plan.active">In pausa</template>
              <template v-else-if="nextCharge(plan)">Prossimo: {{ formatDate(nextCharge(plan)!) }}</template>
            </span>
          </div>
          <div class="pac__actions">
            <button
              type="button"
              class="pac__switch"
              role="switch"
              :aria-checked="plan.active"
              :aria-label="plan.active ? `Metti in pausa il PAC su ${planName(plan)}` : `Riattiva il PAC su ${planName(plan)}`"
              :title="plan.active ? 'Attivo: clic per mettere in pausa' : 'In pausa: clic per riattivare'"
              @click="ledger.setPlanActive(plan.id, !plan.active, todayIso())"
            >
              <span />
            </button>
            <UiButton size="sm" variant="ghost" icon="edit" :aria-label="`Modifica PAC su ${planName(plan)}`" @click="editPlan(plan)" />
            <UiButton size="sm" variant="ghost" icon="trash" class="pac__del" :aria-label="`Elimina PAC su ${planName(plan)}`" @click="deletePlan(plan)" />
          </div>
        </li>
      </ul>
    </template>
    <PlanDialog :open="open" :plan="editing" :positions="positions" :position-key="presetKey" @close="open = false" />
  </section>
</template>

<style scoped>
.pac__total { margin-bottom: 8px; }
.pac__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.pac__item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-top: 1px solid var(--border); }
.pac__item--off .pac__main { opacity: 0.55; }
.pac__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pac__main strong { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pac__next { color: var(--accent); }
.pac__actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.pac__del { color: var(--negative); }
.pac__switch { position: relative; width: 34px; height: 20px; border: 0; border-radius: 999px; background: var(--border-strong); cursor: pointer; margin-right: 4px; transition: background 0.15s ease; }
.pac__switch span { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transition: transform 0.15s ease; }
.pac__switch[aria-checked='true'] { background: var(--positive); }
.pac__switch[aria-checked='true'] span { transform: translateX(14px); }
.pac__switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
