<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import { formatDate, formatMoney, todayIso } from '@/core/utils/format'
import { computeAccountBalances, flowTypeOf, norm, subKey, type ExpenseType, type Operation } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { LedgerError, useLedgerStore, type EntryDraft, type EntryPrefill } from '../store/ledgerStore'
import { CARD_THEME_META, FLOW_META, plainName, subcategoryColor } from '../presentation'
import { categoryIcon } from '../categoryIcons'
import { evaluateAmount, isAmountExpression } from '../amountExpression'

const props = defineProps<{
  open: boolean
  operation?: Operation | null
  defaultDate?: string
  prefill?: EntryPrefill | null
  /** Consente di modificare ed eliminare anche le righe scritte a mano nel foglio Google. */
  editSheetRows?: boolean
}>()
const emit = defineEmits<{ close: []; saved: [op: Operation | null]; needsInstrument: [category: string, subcategory: string] }>()

const store = useFinanceStore()
const ledger = useLedgerStore()

type Kind = 'expense' | 'income' | 'transfer'
const form = reactive({
  kind: 'expense' as Kind,
  expenseType: 'necessary' as ExpenseType,
  date: todayIso(),
  account: '',
  toAccount: '',
  category: '',
  subcategory: '',
  description: '',
  amount: '',
})
const error = ref<string | null>(null)

const sheetRow = computed(() => !!props.operation && !ledger.isManual(props.operation.id) && !!props.editSheetRows && store.canEdit(props.operation))
const editing = computed(() => !!props.operation && (ledger.isManual(props.operation.id) || sheetRow.value))
const busy = ref(false)
const readOnly = computed(() => !!props.operation && !editing.value)
const title = computed(() => (readOnly.value ? 'Dettaglio movimento' : editing.value ? 'Modifica voce' : 'Nuova voce di bilancio'))

const accountOptions = computed(() => {
  const names = ledger.state.config.accounts.map((a) => a.name)
  for (const a of store.dataset.accounts) if (!names.includes(a.name)) names.push(a.name)
  return names
})

const balances = computed(() => new Map(computeAccountBalances(store.dataset).map((b) => [b.account.name, b])))
const accountItems = computed<ComboOption[]>(() =>
  accountOptions.value.map((name) => {
    const cfg = ledger.state.config.accounts.find((a) => a.name === name)
    const b = balances.value.get(name)
    return {
      value: name,
      label: name,
      swatch: cfg ? CARD_THEME_META[cfg.cardTheme].bg : 'var(--surface-2)',
      hint: [cfg && ledger.state.config.defaultAccountId === cfg.id ? '★ predefinito' : '', b ? formatMoney(b.balance, b.account.currency) : ''].filter(Boolean).join(' · ') || undefined,
    }
  }),
)

const catKind = computed(() => (form.kind === 'income' ? 'income' : 'expense'))
const categoryOptions = computed(() => {
  const names = ledger.state.config.categories.filter((c) => c.kind === catKind.value).map((c) => c.name)
  const seen = new Set(names.map(norm))
  for (const op of store.dataset.operations) {
    if (op.kind === 'transfer' || (op.kind === 'income') !== (catKind.value === 'income')) continue
    if (op.category && !seen.has(norm(op.category))) {
      seen.add(norm(op.category))
      names.push(op.category)
    }
  }
  return names.sort((a, b) => plainName(a).localeCompare(plainName(b), 'it'))
})
const TYPE_SHORT: Record<ExpenseType, string> = { necessary: 'Necessaria', additional: 'Desiderio', investment: 'Investimento' }
const categoryItems = computed<ComboOption[]>(() =>
  categoryOptions.value.map((name) => {
    const type = catKind.value === 'expense' ? ledger.findCategory('expense', name)?.defaultExpenseType : undefined
    return { value: name, label: plainName(name), emoji: categoryIcon(ledger.state.config, name, catKind.value), hint: type ? TYPE_SHORT[type] : undefined }
  }),
)
const subcategoryOptions = computed(() => {
  const cfg = ledger.findCategory(catKind.value, form.category)
  const names = cfg ? cfg.subcategories.map((s) => s.name) : []
  const seen = new Set(names.map(norm))
  for (const op of store.dataset.operations) {
    if (op.category === (cfg?.name ?? form.category) && op.subcategory && !seen.has(norm(op.subcategory))) {
      seen.add(norm(op.subcategory))
      names.push(op.subcategory)
    }
  }
  return names.sort((a, b) => a.localeCompare(b, 'it'))
})
const subcategoryItems = computed<ComboOption[]>(() => {
  const cat = ledger.findCategory(catKind.value, form.category)?.name ?? form.category
  return subcategoryOptions.value.map((name) => ({ value: name, label: plainName(name), color: subcategoryColor(ledger.state.config, cat, name, catKind.value) }))
})
const categoryEmoji = computed(() => (form.category ? categoryIcon(ledger.state.config, form.category, catKind.value) : null))

// Cambiando categoria la sotto-categoria precedente non è più valida.
watch(
  () => form.category,
  (c, prev) => {
    if (props.open && prev !== undefined && c !== prev && form.subcategory && !subcategoryOptions.value.some((s) => norm(s) === norm(form.subcategory))) form.subcategory = ''
  },
)

function reset() {
  error.value = null
  const op = props.operation
  if (op) {
    form.kind = op.kind
    form.expenseType = op.kind === 'expense' ? op.expenseType : 'necessary'
    form.date = op.date
    form.account = op.account
    form.toAccount = op.kind === 'transfer' ? op.toAccount : ''
    form.category = op.category
    form.subcategory = op.subcategory
    form.description = op.description
    form.amount = (op.amount / 100).toFixed(2).replace('.', ',')
  } else {
    form.kind = 'expense'
    form.expenseType = 'necessary'
    form.date = props.defaultDate ?? todayIso()
    // Conto predefinito (Gestione → Conti), altrimenti il primo.
    form.account = ledger.defaultAccountName() ?? accountOptions.value[0] ?? ''
    form.toAccount = ''
    form.category = ''
    form.subcategory = ''
    form.description = ''
    form.amount = ''
    const p = props.prefill
    if (p) {
      if (p.kind) form.kind = p.kind
      if (p.expenseType) form.expenseType = p.expenseType
      if (p.date) form.date = p.date
      if (p.account) form.account = p.account
      if (p.toAccount) form.toAccount = p.toAccount
      if (p.category) form.category = p.category
      if (p.subcategory) form.subcategory = p.subcategory
      if (p.description) form.description = p.description
      if (p.amount) form.amount = (p.amount / 100).toFixed(2).replace('.', ',')
    }
  }
}
watch(() => props.open, (o) => o && reset(), { immediate: true })

// La tipologia proposta segue la categoria scelta.
watch(
  () => form.category,
  (c, prev) => {
    if (!props.open || c === prev || form.kind !== 'expense') return
    const t = ledger.findCategory('expense', c)?.defaultExpenseType
    if (t && !editing.value && !props.prefill?.expenseType) form.expenseType = t
  },
)

// L'importo può essere un'espressione (es. "12,50 + 3 * 2"): si mostra l'anteprima del risultato.
const parseAmount = evaluateAmount
const amountInput = ref<HTMLInputElement | null>(null)
const amountIsExpr = computed(() => isAmountExpression(form.amount))
const amountPreview = computed(() => {
  if (!amountIsExpr.value) return null
  const c = evaluateAmount(form.amount)
  return Number.isNaN(c) ? null : formatMoney(c, 'EUR')
})

/** Sostituisce l'espressione con il suo risultato (se valida). */
function resolveAmount() {
  if (!amountIsExpr.value) return
  const c = evaluateAmount(form.amount)
  if (!Number.isNaN(c)) form.amount = (c / 100).toFixed(2).replace('.', ',')
}

const OPERATORS = [
  { sym: '+', label: '+', aria: 'Più' },
  { sym: '-', label: '−', aria: 'Meno' },
  { sym: '*', label: '×', aria: 'Per' },
  { sym: '/', label: '÷', aria: 'Diviso' },
]
function insertOperator(sym: string) {
  const el = amountInput.value
  const start = el?.selectionStart ?? form.amount.length
  const end = el?.selectionEnd ?? form.amount.length
  const text = ` ${sym} `
  form.amount = (form.amount.slice(0, start) + text + form.amount.slice(end)).replace(/\s+/g, ' ').replace(/^ /, '')
  const caret = Math.min(form.amount.length, start + text.length - (start === 0 ? 1 : 0))
  requestAnimationFrame(() => {
    el?.focus()
    el?.setSelectionRange(caret, caret)
  })
}

function draft(): EntryDraft {
  const currency = store.dataset.accounts.find((a) => a.name === form.account)?.currency ?? 'EUR'
  // I trasferimenti non hanno categoria: sono solo spostamenti tra conti.
  const transfer = form.kind === 'transfer'
  const common = {
    date: form.date,
    account: form.account,
    category: transfer ? '' : form.category,
    subcategory: transfer ? '' : form.subcategory,
    description: form.description,
    amount: parseAmount(form.amount),
    currency,
  }
  if (form.kind === 'expense') return { ...common, kind: 'expense', expenseType: form.expenseType }
  if (form.kind === 'income') return { ...common, kind: 'income' }
  return { ...common, kind: 'transfer', toAccount: form.toAccount }
}

async function save(addAnother = false) {
  error.value = null
  if (busy.value) return
  busy.value = true
  try {
    let saved: Operation | null = null
    if (editing.value) await store.editOperation(props.operation!, draft())
    else saved = ledger.addEntry(draft())
    emit('saved', saved)
    // Nuova posizione d'investimento senza dati dello strumento: si chiedono subito.
    if (form.kind === 'expense' && form.expenseType === 'investment' && form.subcategory.trim()) {
      const cat = ledger.findCategory('expense', form.category)
      const sub = cat?.subcategories.find((x) => norm(x.name) === norm(form.subcategory))?.name ?? form.subcategory.trim()
      if (cat && !ledger.state.investments?.[subKey(cat.name, sub)]) emit('needsInstrument', cat.name, sub)
    }
    if (addAnother) {
      const keep = { kind: form.kind, date: form.date, account: form.account, expenseType: form.expenseType }
      reset()
      Object.assign(form, keep)
    } else emit('close')
  } catch (e) {
    error.value = e instanceof LedgerError ? e.message : (e as Error).message
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.operation || busy.value) return
  const where = sheetRow.value ? ` dal foglio Google (scheda ${props.operation.source.sheet}, riga ${props.operation.source.row})` : ''
  if (!window.confirm(`Eliminare definitivamente questa voce${where}?`)) return
  busy.value = true
  error.value = null
  try {
    await store.deleteOperation(props.operation)
    emit('saved', null)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const KINDS: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Uscita' },
  { value: 'income', label: 'Entrata' },
  { value: 'transfer', label: 'Trasferimento' },
]
const EXPENSE_TYPES: { value: ExpenseType; label: string; hint: string; emoji: string }[] = [
  { value: 'necessary', label: 'Necessaria', hint: 'Affitto, spesa, bollette', emoji: '🧾' },
  { value: 'additional', label: 'Desiderio', hint: 'Svago, shopping, extra', emoji: '✨' },
  { value: 'investment', label: 'Investimento', hint: 'ETF, titoli, crypto', emoji: '📈' },
]
</script>

<template>
  <UiDialog :open="open" :title="title" :width="560" @close="emit('close')">
    <!-- Movimento sincronizzato: sola lettura -->
    <template v-if="readOnly && operation">
      <dl class="ro">
        <dt>Importo</dt>
        <dd class="ro__amt num" :class="operation.kind === 'income' ? 'pos' : ''">{{ formatMoney(operation.kind === 'expense' ? -operation.amount : operation.amount, operation.currency) }}</dd>
        <dt>Tipologia</dt><dd>{{ FLOW_META[flowTypeOf(operation)].short }}</dd>
        <dt>Data</dt><dd>{{ formatDate(operation.date) }}</dd>
        <dt>Conto</dt><dd>{{ operation.account }}<template v-if="operation.kind === 'transfer'"> → {{ operation.toAccount }}</template></dd>
        <template v-if="operation.kind !== 'transfer'"><dt>Categoria</dt><dd>{{ operation.category || '—' }}<template v-if="operation.subcategory"> › {{ operation.subcategory }}</template></dd></template>
        <dt>Descrizione</dt><dd>{{ operation.description || '—' }}</dd>
        <dt>Origine</dt><dd>Google Sheet, foglio {{ operation.source.sheet }}, riga {{ operation.source.row }}</dd>
      </dl>
      <p class="muted small">I movimenti sincronizzati si modificano nel Google Sheet; le modifiche compaiono alla prossima sincronizzazione.</p>
    </template>

    <form v-else id="entry-form" class="ef" @submit.prevent="save()">
      <div class="ef__kinds" role="radiogroup" aria-label="Tipo di voce">
        <button
          v-for="k in KINDS"
          :key="k.value"
          type="button"
          role="radio"
          :aria-checked="form.kind === k.value"
          class="ef__kind"
          :class="[`ef__kind--${k.value}`, { on: form.kind === k.value }]"
          @click="form.kind = k.value"
        >
          {{ k.label }}
        </button>
      </div>

      <label class="ef__amount">
        <span class="sr-only">Importo</span>
        <span class="ef__cur" aria-hidden="true">€</span>
        <input
          ref="amountInput"
          v-model="form.amount"
          class="ef__amount-input num"
          inputmode="decimal"
          placeholder="0,00"
          autocomplete="off"
          required
          aria-label="Importo"
          aria-describedby="ef-amount-hint"
          @blur="resolveAmount"
          @keydown.enter="resolveAmount"
        />
      </label>
      <div class="ef__calc">
        <div class="ef__ops" role="group" aria-label="Operazioni">
          <button v-for="o in OPERATORS" :key="o.sym" type="button" class="ef__op" :aria-label="o.aria" @mousedown.prevent @click="insertOperator(o.sym)">{{ o.label }}</button>
        </div>
        <span id="ef-amount-hint" class="ef__preview num" aria-live="polite">
          <template v-if="amountPreview">= {{ amountPreview }}</template>
          <template v-else-if="amountIsExpr">Espressione non valida</template>
        </span>
      </div>

      <div class="ef__grid">
        <div class="ef__field">
          <span>Data</span>
          <UiDatePicker v-model="form.date" label="Data" required />
        </div>
        <div class="ef__field">
          <span>{{ form.kind === 'transfer' ? 'Da conto' : 'Conto' }}</span>
          <UiCombobox v-model="form.account" :options="accountItems" :label="form.kind === 'transfer' ? 'Da conto' : 'Conto'" placeholder="Scegli il conto" required />
        </div>
        <div v-if="form.kind === 'transfer'" class="ef__field">
          <span>A conto</span>
          <UiCombobox v-model="form.toAccount" :options="accountItems.filter((x) => x.value !== form.account)" label="A conto" placeholder="Scegli il conto" required />
        </div>
      </div>

      <div v-if="form.kind !== 'transfer'" class="ef__cats" :class="{ 'ef__cats--set': !!categoryEmoji }">
        <div class="ef__field">
          <span>Categoria</span>
          <UiCombobox
            v-model="form.category"
            :options="categoryItems"
            label="Categoria"
            placeholder="Cerca o crea una categoria"
            allow-create
            required
            :create-text="(q) => `Crea la categoria «${q}»`"
          />
        </div>
        <div class="ef__field">
          <span>Sotto-categoria <em class="muted">(facoltativa)</em></span>
          <UiCombobox
            v-model="form.subcategory"
            :options="subcategoryItems"
            label="Sotto-categoria"
            :placeholder="form.category ? 'Cerca o crea…' : 'Prima scegli la categoria'"
            :disabled="!form.category"
            allow-create
            clearable
            empty-text="Nessuna sotto-categoria: scrivi per crearne una"
            :create-text="(q) => `Crea «${q}» in ${plainName(form.category)}`"
          />
        </div>
      </div>

      <fieldset v-if="form.kind === 'expense'" class="ef__types">
        <legend>Tipologia di spesa</legend>
        <label v-for="t in EXPENSE_TYPES" :key="t.value" class="ef__type" :class="{ on: form.expenseType === t.value }">
          <input v-model="form.expenseType" type="radio" name="expenseType" :value="t.value" class="sr-only" />
          <span class="ef__type-emoji" aria-hidden="true">{{ t.emoji }}</span>
          {{ t.label }}
        </label>
      </fieldset>

      <label class="ef__field">
        <span>Descrizione</span>
        <input v-model="form.description" class="input" placeholder="Es. Spesa Esselunga" autocomplete="off" />
      </label>

      <p v-if="sheetRow && operation" class="muted small">
        Riga scritta a mano nel foglio (scheda {{ operation.source.sheet }}, riga {{ operation.source.row }}): le modifiche vengono salvate subito sul foglio Google.
      </p>
      <p class="muted small">Categorie e sotto-categorie nuove vengono aggiunte automaticamente alla Gestione.</p>
      <UiAlert v-if="error" tone="critical">{{ error }}</UiAlert>
    </form>

    <template #footer>
      <template v-if="readOnly">
        <UiButton @click="emit('close')">Chiudi</UiButton>
      </template>
      <template v-else>
        <UiButton v-if="editing" variant="ghost" icon="trash" class="ef__del" :disabled="busy" @click="remove">Elimina</UiButton>
        <UiButton v-if="!editing && !prefill" @click="save(true)">Salva e aggiungi altra</UiButton>
        <UiButton type="submit" variant="primary" form="entry-form" :disabled="busy">{{ busy ? 'Salvataggio…' : editing ? 'Salva modifiche' : 'Aggiungi voce' }}</UiButton>
      </template>
    </template>
  </UiDialog>
</template>

<style scoped>
.ef { display: flex; flex-direction: column; gap: 16px; }
.ef__kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: var(--surface-2); padding: 4px; border-radius: 999px; }
.ef__kind { border: 0; background: none; padding: 9px 8px; border-radius: 999px; cursor: pointer; font-weight: 500; color: var(--text-secondary); }
.ef__kind.on { background: var(--surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(19, 24, 17, 0.1); }
.ef__kind--expense.on { background: var(--ink); color: var(--brand); }
.ef__kind--income.on { background: var(--brand); color: var(--on-brand); }
.ef__amount { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.ef__cur { font-size: 1.8rem; color: var(--text-muted); }
.ef__amount-input { border: 0; outline: 0; background: none; font-size: 2.6rem; letter-spacing: -0.03em; width: 100%; max-width: 280px; text-align: center; padding: 0; }
.ef__amount-input:focus-visible { outline: 0; }
.ef__amount:focus-within { border-color: var(--ink); }
.ef__calc { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: -8px; min-height: 32px; }
/* Gli operatori servono solo su mobile (la tastiera numerica non li ha); su PC si scrivono da tastiera. */
.ef__ops { display: none; gap: 6px; }
@media (max-width: 520px), (pointer: coarse) {
  .ef__ops { display: flex; }
}
.ef__op {
  width: 34px; height: 30px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface);
  color: var(--text-secondary); font-size: 1.05rem; line-height: 1; cursor: pointer;
}
.ef__op:hover { background: var(--surface-2); color: var(--text-primary); }
.ef__preview { margin-left: auto; font-size: 0.9rem; color: var(--text-muted); text-align: right; }
.ef__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.ef__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.ef__field .input { width: 100%; color: var(--text-primary); font-size: 0.95rem; }
.ef__field > span em { font-style: normal; }
.ef__cats {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: end;
  padding: 12px; border-radius: 18px; background: var(--surface-2);
}
.ef__types { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ef__types legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.ef__type { display: flex; gap: 6px; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--border-strong); cursor: pointer; font-size: 0.9rem; }
.ef__type > span { font-size: 0.74rem; color: var(--text-muted); }
.ef__type-emoji { font-size: 1rem; }
.ef__type.on { border-color: var(--ink); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.ef__type:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.ef__del { margin-right: auto; color: var(--negative); }
.ro { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 0 0 14px; }
.ro dt { color: var(--text-muted); font-size: 0.85rem; }
.ro dd { margin: 0; }
.ro__amt { font-size: 1.4rem; }
@media (max-width: 520px) {
  .ef__grid, .ef__types { grid-template-columns: 1fr; }
  .ef__cats { grid-template-columns: auto minmax(0, 1fr); }
  .ef__cats > .ef__field:last-child { grid-column: 1 / -1; }
}
</style>
