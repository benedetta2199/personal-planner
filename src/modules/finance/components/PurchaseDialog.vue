<script setup lang="ts">
/**
 * Acquisto o vendita dalla pagina Investimenti.
 *
 * Acquisto — l'importo è quanto esce dal conto. Per azioni e obbligazioni la commissione
 * (1 € di default) viene separata: 10 € addebitati → 9 € sulla posizione + 1 € in «Commissioni».
 * Gli ETF non hanno commissione: 10 € addebitati → 10 € sulla posizione.
 *
 * Vendita — l'importo è quanto entra sul conto. Il venduto è accreditato + commissione:
 * 9 € accreditati su un'azione → 10 € venduti (entrata sulla posizione) + 1 € in «Commissioni».
 *
 * Saveback — acquisto pagato dal broker, senza commissioni e senza uscita di denaro:
 * un'entrata «Saveback» e un'uscita «Investimento» della stessa cifra sullo stesso conto.
 */
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatMoney, todayIso } from '@/core/utils/format'
import { INSTRUMENT_LABEL, TRANSACTION_FEE_CENTS, splitPurchase, splitSale, splitSubKey, subKey, uid, type Position } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { LedgerError, useLedgerStore } from '../store/ledgerStore'
import { CARD_THEME_META, plainName } from '../presentation'

const props = withDefaults(defineProps<{ open: boolean; positions: Position[]; positionKey?: string | null; mode?: 'buy' | 'sell' | 'saveback' }>(), { mode: 'buy', positionKey: null })
const emit = defineEmits<{ close: []; saved: [] }>()
const finance = useFinanceStore()
const ledger = useLedgerStore()

/** Categoria in cui finiscono le commissioni (creata da sola se non esiste). */
const FEE_CATEGORY = 'Commissioni'
/** Categoria di entrata dei saveback. */
const SAVEBACK_CATEGORY = 'Saveback'

/** In acquisto si può passare da «Acquisto» a «Saveback». */
const kind = ref<'buy' | 'sell' | 'saveback'>('buy')
const selling = computed(() => kind.value === 'sell')
const isSaveback = computed(() => kind.value === 'saveback')
const form = reactive({ key: '', amount: '', fee: '', date: todayIso(), account: '', description: '' })
const error = ref<string | null>(null)
const feeTouched = ref(false)

/** In vendita solo le posizioni ancora aperte. */
const choices = computed(() => (selling.value ? props.positions.filter((p) => !p.closed) : props.positions))
const position = computed(() => choices.value.find((p) => p.key === form.key) ?? null)
const cur = computed(() => finance.baseCurrency)
const m = (c: number) => formatMoney(c, cur.value)

const positionItems = computed<ComboOption[]>(() =>
  [...choices.value]
    .sort((a, b) => Number(a.closed) - Number(b.closed) || b.value - a.value)
    .map((p) => ({ value: p.key, label: plainName(p.name), hint: selling.value ? `${INSTRUMENT_LABEL[p.type]} · ${m(p.value)}` : `${INSTRUMENT_LABEL[p.type]}${p.closed ? ' · chiusa' : ''}` })),
)

const accountItems = computed<ComboOption[]>(() => {
  const names = ledger.state.config.accounts.map((a) => a.name)
  for (const a of finance.dataset.accounts) if (!names.includes(a.name)) names.push(a.name)
  return names.map((name) => {
    const cfg = ledger.state.config.accounts.find((a) => a.name === name)
    return { value: name, label: name, swatch: cfg ? CARD_THEME_META[cfg.cardTheme].bg : 'var(--surface-2)', hint: cfg?.type === 'investment' ? 'Investimento' : undefined }
  })
})

/** Conto usato per l'ultimo acquisto di quella posizione, altrimenti il predefinito. */
function accountFor(key: string): string {
  const last = [...finance.dataset.operations]
    .reverse()
    .find((o) => o.kind === 'expense' && o.expenseType === 'investment' && subKey(o.category, o.subcategory) === key)
  return last?.account ?? ledger.defaultAccountName() ?? accountItems.value[0]?.value ?? ''
}

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
    feeTouched.value = false
    kind.value = props.mode
    form.key = (props.positionKey && choices.value.some((p) => p.key === props.positionKey) ? props.positionKey : null) ?? choices.value.find((p) => !p.closed)?.key ?? ''
    form.amount = ''
    form.date = todayIso()
    form.description = ''
    form.account = form.key ? accountFor(form.key) : ledger.defaultAccountName() ?? ''
    form.fee = euros(position.value ? TRANSACTION_FEE_CENTS[position.value.type] : 0)
  },
  { immediate: true },
)

// Cambiando posizione: commissione del suo tipo (se non modificata a mano) e conto abituale.
watch(
  () => form.key,
  (k, prev) => {
    if (!props.open || !k || k === prev) return
    if (!feeTouched.value && position.value) form.fee = euros(TRANSACTION_FEE_CENTS[position.value.type])
    form.account = accountFor(k)
  },
)

const amountCents = computed(() => parseCents(form.amount))
const feeCents = computed(() => (isSaveback.value ? 0 : form.fee.trim() ? parseCents(form.fee) : 0))
const valid = computed(() => !!position.value && Number.isFinite(amountCents.value) && Number.isFinite(feeCents.value))
const buySplit = computed(() => (valid.value && !selling.value ? splitPurchase(amountCents.value, position.value!.type, feeCents.value) : null))
const saleSplit = computed(() => (valid.value && selling.value ? splitSale(amountCents.value, feeCents.value) : null))
/** Totale mosso sul conto (per il pulsante). */
const total = computed(() => {
  if (isSaveback.value) return valid.value && amountCents.value > 0 ? amountCents.value : null
  return selling.value ? saleSplit.value?.gross ?? null : buySplit.value ? buySplit.value.invested + buySplit.value.fee : null
})
/** Vendita oltre il valore stimato della posizione: probabilmente un errore di battitura. */
const oversell = computed(() => !!saleSplit.value && !!position.value && position.value.value > 0 && saleSplit.value.gross > position.value.value * 1.15)

/** «Vendi tutto»: accredito = valore attuale della posizione − commissione. */
function sellAll() {
  const p = position.value
  if (!p) return
  form.amount = euros(Math.max(0, p.value - (Number.isFinite(feeCents.value) ? feeCents.value : 0)))
}

function save() {
  error.value = null
  const p = position.value
  if (!p) return (error.value = selling.value ? 'Scegli la posizione da vendere.' : 'Scegli la posizione da acquistare.')
  if (!Number.isFinite(amountCents.value) || amountCents.value <= 0) return (error.value = selling.value ? "Inserisci l'importo accreditato sul conto." : "Inserisci l'importo addebitato sul conto.")
  if (!Number.isFinite(feeCents.value) || feeCents.value < 0) return (error.value = 'Commissione non valida.')
  if (!form.account) return (error.value = selling.value ? 'Scegli il conto su cui arriva il denaro.' : 'Scegli il conto da cui esce il denaro.')

  const { category, subcategory } = splitSubKey(p.key)
  const name = plainName(p.name)
  const currency = finance.dataset.accounts.find((a) => a.name === form.account)?.currency ?? 'EUR'
  const common = { date: form.date, account: form.account, currency }
  let fee = 0
  try {
    if (isSaveback.value) {
      // Saveback: due voci della stessa cifra sullo stesso conto (saldo invariato), collegate dall'ID.
      if (!Number.isFinite(amountCents.value) || amountCents.value <= 0) return (error.value = 'Importo del saveback non valido.')
      const id = `m-sb-${uid().replace(/[^\w]/g, '')}`
      const description = form.description.trim() || `Saveback ${name}`
      ledger.addEntry({ ...common, kind: 'income', category: SAVEBACK_CATEGORY, subcategory: subcategory || category, description, amount: amountCents.value }, `${id}-in`)
      ledger.addEntry({ ...common, kind: 'expense', expenseType: 'investment', category, subcategory, description, amount: amountCents.value }, id)
    } else if (selling.value) {
      const s = saleSplit.value
      if (!s) return (error.value = 'Importo non valido.')
      // Entrata sulla stessa categoria/sotto-categoria della posizione: è così che l'app riconosce le vendite.
      ledger.addEntry({ ...common, kind: 'income', category, subcategory, description: form.description.trim() || `Vendita ${name}`, amount: s.gross })
      fee = s.fee
    } else {
      const s = buySplit.value
      if (!s) return (error.value = "L'importo deve essere maggiore della commissione.")
      ledger.addEntry({ ...common, kind: 'expense', expenseType: 'investment', category, subcategory, description: form.description.trim() || `Acquisto ${name}`, amount: s.invested })
      fee = s.fee
    }
    if (fee > 0) {
      ledger.addEntry({
        ...common,
        kind: 'expense',
        expenseType: 'necessary',
        category: FEE_CATEGORY,
        // Sotto-categoria = posizione: così si sa quanto è costato in commissioni ogni investimento.
        subcategory: subcategory || category,
        description: `Commissione ${selling.value ? 'vendita' : 'acquisto'} ${name}`,
        amount: fee,
      })
    }
  } catch (e) {
    error.value = e instanceof LedgerError ? e.message : (e as Error).message
    return
  }
  emit('saved')
  emit('close')
}
</script>

<template>
  <UiDialog :open="open" :title="selling ? 'Vendita' : isSaveback ? 'Saveback' : 'Nuovo acquisto'" :width="560" @close="emit('close')">
    <form id="purchase-form" class="pd" :class="{ 'pd--sell': selling, 'pd--sb': isSaveback }" @submit.prevent="save">
      <UiSegmented
        v-if="!selling"
        v-model="kind"
        label="Tipo di acquisto"
        class="pd__kind"
        :options="[{ value: 'buy', label: 'Acquisto' }, { value: 'saveback', label: 'Saveback' }]"
      />
      <p v-if="isSaveback" class="pd__sbnote">
        Il saveback è un acquisto pagato dal broker: nessuna commissione e nessun denaro esce dal conto.
        Viene registrato come entrata «{{ SAVEBACK_CATEGORY }}» e acquisto della stessa cifra, quindi il saldo del conto non cambia.
      </p>
      <div class="pd__field">
        <span>Investimento</span>
        <UiCombobox v-model="form.key" :options="positionItems" label="Investimento" placeholder="Cerca la posizione" required />
      </div>

      <label class="pd__amount">
        <span class="pd__amount-label">{{ selling ? 'Accreditato sul conto' : isSaveback ? 'Saveback ricevuto' : 'Addebitato sul conto' }}</span>
        <span class="pd__amount-row">
          <span class="pd__cur" aria-hidden="true">€</span>
          <input
            v-model="form.amount"
            class="pd__amount-input num"
            inputmode="decimal"
            placeholder="0,00"
            autocomplete="off"
            required
            :aria-label="selling ? 'Importo accreditato sul conto' : 'Importo addebitato sul conto'"
          />
        </span>
        <button v-if="selling && position && position.value > 0" type="button" class="pd__all" @click.prevent="sellAll">
          Vendi tutto · valore attuale {{ m(position.value) }}
        </button>
      </label>

      <!-- Ripartizione tra posizione e commissione -->
      <div v-if="position && !isSaveback" class="pd__split" aria-live="polite">
        <div class="pd__part">
          <span>{{ selling ? 'Venduto da' : 'Su' }} {{ plainName(position.name) }}</span>
          <strong class="num">
            <template v-if="selling">{{ saleSplit ? m(saleSplit.gross) : '—' }}</template>
            <template v-else>{{ buySplit ? m(buySplit.invested) : '—' }}</template>
          </strong>
        </div>
        <span class="pd__plus" aria-hidden="true">{{ selling ? '−' : '+' }}</span>
        <label class="pd__part pd__part--fee">
          <span>Commissione <em>({{ INSTRUMENT_LABEL[position.type] }}: {{ m(TRANSACTION_FEE_CENTS[position.type]) }})</em></span>
          <span class="pd__fee">
            <span aria-hidden="true">€</span>
            <input v-model="form.fee" class="num" inputmode="decimal" aria-label="Commissione" @input="feeTouched = true" />
          </span>
        </label>
      </div>
      <UiAlert v-if="oversell" tone="warning">
        Stai vendendo {{ m(saleSplit!.gross) }}, più del valore stimato della posizione ({{ m(position!.value) }}). Controlla l'importo.
      </UiAlert>

      <div class="pd__grid">
        <div class="pd__field">
          <span>Data</span>
          <UiDatePicker v-model="form.date" :label="selling ? 'Data della vendita' : 'Data dell\'acquisto'" required />
        </div>
        <div class="pd__field">
          <span>{{ selling ? 'Sul conto' : isSaveback ? 'Conto del broker' : 'Dal conto' }}</span>
          <UiCombobox v-model="form.account" :options="accountItems" :label="selling ? 'Conto accreditato' : 'Conto addebitato'" placeholder="Scegli il conto" required />
        </div>
      </div>
      <label class="pd__field">
        <span>Descrizione <em class="muted">(facoltativa)</em></span>
        <input v-model="form.description" class="input" :placeholder="position ? `${selling ? 'Vendita' : 'Acquisto'} ${plainName(position.name)}` : ''" autocomplete="off" />
      </label>

      <p class="muted small">
        <template v-if="isSaveback">Vengono create un'entrata «{{ SAVEBACK_CATEGORY }}» e un'uscita «Investimento» sulla posizione, della stessa cifra</template>
        <template v-else-if="selling">Viene creata un'entrata sulla posizione per il venduto</template>
        <template v-else>Viene creata un'uscita «Investimento» sulla posizione</template>
        <template v-if="feeCents > 0"> e un'uscita nella categoria «{{ FEE_CATEGORY }}» per la commissione</template>.
        Le ritrovi nelle Transazioni e sul foglio Google.
      </p>
      <UiAlert v-if="error" tone="critical">{{ error }}</UiAlert>
    </form>
    <template #footer>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="purchase-form" variant="primary" :icon="selling ? 'arrowUpRight' : 'plus'" :disabled="total === null">
        {{ selling ? 'Registra vendita' : isSaveback ? 'Registra saveback' : 'Registra acquisto' }}<template v-if="total !== null"> · {{ m(total) }}</template>
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.pd { display: flex; flex-direction: column; gap: 14px; }
.pd__kind { align-self: center; }
.pd__sbnote { padding: 10px 12px; border-radius: 14px; background: var(--good-soft); color: var(--positive); font-size: 0.82rem; }
.pd--sb .pd__amount-input { color: var(--flow-investment); }
.pd__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.pd__field em { font-style: normal; }
.pd__field .input { width: 100%; color: var(--text-primary); font-size: 0.95rem; }
.pd__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }

.pd__amount { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 10px; border-bottom: 1px solid var(--border); }
.pd__amount:focus-within { border-color: var(--ink); }
.pd__amount-label { font-size: 0.8rem; color: var(--text-secondary); }
.pd__amount-row { display: flex; align-items: baseline; justify-content: center; gap: 6px; }
.pd__cur { font-size: 1.7rem; color: var(--text-muted); }
.pd__amount-input { border: 0; outline: 0; background: none; font-size: 2.5rem; letter-spacing: -0.03em; width: 100%; max-width: 260px; text-align: center; padding: 0; }
.pd--sell .pd__amount-input { color: var(--positive); }
.pd__all { margin-top: 4px; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); font: inherit; font-size: 0.78rem; color: var(--text-secondary); cursor: pointer; }
.pd__all:hover { border-color: var(--ink); color: var(--text-primary); }

.pd__split { display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; gap: 8px; }
.pd__part { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 14px; background: var(--surface-2); min-width: 0; }
.pd__part > span:first-child { font-size: 0.76rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd__part em { font-style: normal; color: var(--text-muted); }
.pd__part strong { font-size: 1.1rem; font-weight: 600; color: var(--flow-investment); }
.pd__plus { align-self: center; color: var(--text-muted); font-weight: 600; }
.pd__fee { display: flex; align-items: baseline; gap: 4px; }
.pd__fee input { width: 100%; min-width: 0; border: 0; border-bottom: 1px dashed var(--border-strong); background: none; font: inherit; font-size: 1.1rem; font-weight: 600; color: var(--text-primary); padding: 0; outline: 0; }
.pd__fee input:focus { border-bottom-color: var(--accent); }
@media (max-width: 520px) {
  .pd__grid { grid-template-columns: 1fr; }
  .pd__split { grid-template-columns: 1fr; }
  .pd__plus { display: none; }
}
</style>
