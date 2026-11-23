<script setup lang="ts">
/**
 * Piano di accumulo (PAC) su un ETF: importo fisso, cadenza, conto e data di inizio.
 * Gli ETF non hanno commissioni: l'intero importo va sulla posizione.
 */
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import { formatDate, formatMoney, todayIso } from '@/core/utils/format'
import { PLAN_FREQUENCY_LABEL, addDays, chargeDates, monthlyEquivalent, upcomingCharges, type InvestmentPlan, type PlanFrequency, type Position } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { LedgerError, useLedgerStore } from '../store/ledgerStore'
import { CARD_THEME_META, plainName } from '../presentation'

const props = defineProps<{ open: boolean; plan?: InvestmentPlan | null; positions: Position[]; positionKey?: string | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const finance = useFinanceStore()
const ledger = useLedgerStore()

const today = todayIso()
const form = reactive({ key: '', amount: '', frequency: 'monthly' as PlanFrequency, account: '', startDate: today })
const error = ref<string | null>(null)
const editing = computed(() => !!props.plan)

/** Solo ETF: azioni e obbligazioni hanno commissioni e non si comprano a piano. */
const etfs = computed(() => props.positions.filter((p) => p.type === 'etf'))
const etfItems = computed<ComboOption[]>(() => etfs.value.map((p) => ({ value: p.key, label: plainName(p.name), hint: p.ticker ?? 'ETF' })))
const accountItems = computed<ComboOption[]>(() =>
  ledger.state.config.accounts.map((a) => ({ value: a.name, label: a.name, swatch: CARD_THEME_META[a.cardTheme].bg })),
)

const cur = computed(() => finance.baseCurrency)
const m = (c: number) => formatMoney(c, cur.value)
const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',')
function parseCents(text: string): number {
  const t = text.trim().replace(/\s|€/g, '')
  if (!t) return NaN
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}

watch(
  () => props.open,
  (o) => {
    if (!o) return
    error.value = null
    const p = props.plan
    form.key = p?.key ?? (props.positionKey && etfs.value.some((x) => x.key === props.positionKey) ? props.positionKey : etfs.value[0]?.key ?? '')
    form.amount = p ? euros(p.amount) : ''
    form.frequency = p?.frequency ?? 'monthly'
    form.account = p?.account ?? ledger.defaultAccountName() ?? ledger.state.config.accounts[0]?.name ?? ''
    form.startDate = p?.startDate ?? today
  },
  { immediate: true },
)

const amountCents = computed(() => parseCents(form.amount))
const valid = computed(() => !!form.key && Number.isFinite(amountCents.value) && amountCents.value > 0 && !!form.account && !!form.startDate)
const next = computed(() => upcomingCharges({ frequency: form.frequency, startDate: form.startDate }, today, 4))
/** Inizio nel passato: addebiti arretrati che verranno creati subito. */
const backfill = computed(() => (form.startDate <= today ? chargeDates(form.frequency, addDays(form.startDate, -1), today) : []))
const monthly = computed(() => (Number.isFinite(amountCents.value) && amountCents.value > 0 ? monthlyEquivalent({ amount: amountCents.value, frequency: form.frequency }) : null))

function save() {
  error.value = null
  const draft = { key: form.key, amount: amountCents.value, frequency: form.frequency, account: form.account, startDate: form.startDate }
  try {
    if (props.plan) ledger.updatePlan(props.plan.id, draft)
    else ledger.addPlan(draft)
  } catch (e) {
    error.value = e instanceof LedgerError ? e.message : (e as Error).message
    return
  }
  // Addebiti già scaduti (es. inizio nel passato o oggi): creati subito.
  finance.runPlans()
  emit('saved')
  emit('close')
}

const FREQS: PlanFrequency[] = ['weekly', 'biweekly', 'monthly']
const fmtDay = (d: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
</script>

<template>
  <UiDialog :open="open" :title="editing ? 'Modifica piano di accumulo' : 'Nuovo piano di accumulo (PAC)'" :width="580" @close="emit('close')">
    <form id="plan-form" class="pl" @submit.prevent="save">
      <UiAlert v-if="!etfs.length" tone="info">Nessun ETF disponibile: aggiungi prima un investimento di tipo ETF.</UiAlert>

      <div class="pl__field">
        <span>ETF</span>
        <UiCombobox v-model="form.key" :options="etfItems" label="ETF del piano" placeholder="Scegli l'ETF" required />
      </div>

      <label class="pl__amount">
        <span class="pl__amount-label">Importo per addebito <em>(nessuna commissione sugli ETF)</em></span>
        <span class="pl__amount-row">
          <span class="pl__cur" aria-hidden="true">€</span>
          <input v-model="form.amount" class="pl__amount-input num" inputmode="decimal" placeholder="0,00" autocomplete="off" required aria-label="Importo per addebito" />
        </span>
        <span v-if="monthly !== null && form.frequency !== 'monthly'" class="muted small">≈ {{ m(monthly) }} al mese</span>
      </label>

      <fieldset class="pl__freqs">
        <legend>Cadenza</legend>
        <label v-for="f in FREQS" :key="f" class="pl__freq" :class="{ on: form.frequency === f }">
          <input v-model="form.frequency" type="radio" name="frequency" :value="f" class="sr-only" />
          <strong>{{ PLAN_FREQUENCY_LABEL[f].label }}</strong>
          <span>{{ PLAN_FREQUENCY_LABEL[f].hint }}</span>
        </label>
      </fieldset>
      <p class="muted small pl__rule">Se il giorno cade di sabato o domenica, l'addebito avviene il lunedì successivo.</p>

      <div class="pl__grid">
        <div class="pl__field">
          <span>Dal conto</span>
          <UiCombobox v-model="form.account" :options="accountItems" label="Conto addebitato" placeholder="Scegli il conto" required />
        </div>
        <div class="pl__field">
          <span>A partire dal</span>
          <UiDatePicker v-model="form.startDate" label="Inizio del piano" required :shortcuts="false" />
        </div>
      </div>

      <div v-if="next.length" class="pl__next">
        <p class="pl__label">Prossimi addebiti</p>
        <ul>
          <li v-for="d in next" :key="d"><span>{{ fmtDay(d) }}</span><strong v-if="Number.isFinite(amountCents) && amountCents > 0" class="num">{{ m(amountCents) }}</strong></li>
        </ul>
      </div>
      <UiAlert v-if="!editing && backfill.length" tone="warning">
        L'inizio è nel passato: verranno create subito {{ backfill.length }} voci, dal {{ formatDate(backfill[0]) }} a oggi.
        Se quegli addebiti sono già nel foglio, scegli come inizio una data successiva per non contarli due volte.
      </UiAlert>
      <UiAlert v-if="error" tone="critical">{{ error }}</UiAlert>
    </form>
    <template #footer>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="plan-form" variant="primary" :disabled="!valid">{{ editing ? 'Salva piano' : 'Attiva piano' }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.pl { display: flex; flex-direction: column; gap: 14px; }
.pl__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.pl__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.pl__amount { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 10px; border-bottom: 1px solid var(--border); }
.pl__amount:focus-within { border-color: var(--ink); }
.pl__amount-label { font-size: 0.8rem; color: var(--text-secondary); }
.pl__amount-label em { font-style: normal; color: var(--text-muted); }
.pl__amount-row { display: flex; align-items: baseline; justify-content: center; gap: 6px; }
.pl__cur { font-size: 1.7rem; color: var(--text-muted); }
.pl__amount-input { border: 0; outline: 0; background: none; font-size: 2.5rem; letter-spacing: -0.03em; width: 100%; max-width: 260px; text-align: center; padding: 0; }
.pl__freqs { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pl__freqs legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.pl__freq { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--border-strong); cursor: pointer; font-size: 0.9rem; }
.pl__freq span { font-size: 0.74rem; color: var(--text-muted); }
.pl__freq.on { border-color: var(--ink); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.pl__freq:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.pl__rule { margin-top: -6px; }
.pl__next { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); }
.pl__label { font-size: 0.76rem; color: var(--text-muted); margin-bottom: 6px; }
.pl__next ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
.pl__next li { display: flex; justify-content: space-between; gap: 6px; padding: 6px 10px; border-radius: 10px; background: var(--surface); font-size: 0.84rem; }
@media (max-width: 520px) {
  .pl__grid, .pl__freqs { grid-template-columns: 1fr; }
}
</style>
