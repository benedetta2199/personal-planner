<script setup lang="ts">
/**
 * Allinea il valore di una posizione a quello reale del broker. Si inserisce il
 * valore che si vede nell'app del broker; la differenza col valore calcolato
 * diventa una correzione fissa, che da oggi in poi si somma al valore di mercato.
 */
import { computed, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { formatDate, formatMoney, todayIso } from '@/core/utils/format'
import { plainName } from '../presentation'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { useInvestmentStore } from '../store/investmentStore'
import type { Position } from '../domain'

const props = defineProps<{ open: boolean; position: Position | null }>()
const emit = defineEmits<{ close: [] }>()

const finance = useFinanceStore()
const ledger = useLedgerStore()
const inv = useInvestmentStore()
const m = (cents: number) => formatMoney(cents, finance.baseCurrency)

const input = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

const cfg = computed(() => (props.position ? ledger.state.investments?.[props.position.key] : undefined))
/** Valore calcolato senza correzione (centesimi). */
const computedValue = computed(() => (props.position ? props.position.value - props.position.adjustment : 0))

watch(
  () => props.open,
  (open) => {
    if (!open || !props.position) return
    error.value = null
    input.value = (props.position.value / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
  },
  { immediate: true },
)

/** Accetta «1.234,56», «1234,56» e «1234.56». */
function parseAmount(raw: string): number | null {
  let t = raw.replace(/[€\s]/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}
const entered = computed(() => parseAmount(input.value))
const correction = computed(() => (entered.value === null ? null : entered.value - computedValue.value))
const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${m(Math.abs(c))}`

async function persist(adjustment: number | null) {
  const p = props.position
  if (!p || !cfg.value) return
  saving.value = true
  const ok = await inv.saveInstrumentData(p.key, {
    ...cfg.value,
    adjustment,
    adjustmentFrom: adjustment === null ? null : todayIso(),
    updatedAt: undefined,
  })
  saving.value = false
  if (!ok) error.value = 'Correzione salvata su questo dispositivo, ma non sul foglio Google: riprova più tardi.'
  else emit('close')
}
function save() {
  if (correction.value === null) {
    error.value = 'Inserisci un importo valido, es. 1.234,56.'
    return
  }
  void persist(correction.value === 0 ? null : correction.value / 100)
}
</script>

<template>
  <UiDialog :open="open" :title="position ? `Allinea valore · ${plainName(position.name)}` : 'Allinea valore'" :width="460" @close="emit('close')">
    <form v-if="position" id="value-adjust" class="va" @submit.prevent="save">
      <p class="muted small">
        Inserisci il valore che vedi nell'app del broker. La differenza con il valore calcolato (costi nascosti, arrotondamenti)
        resta salvata come correzione e si somma al valore di mercato da oggi in poi.
      </p>

      <label class="va__field">
        <span>Valore reale oggi ({{ finance.baseCurrency }})</span>
        <input v-model="input" class="input va__input num" inputmode="decimal" autocomplete="off" required />
      </label>

      <dl class="va__sum">
        <div><dt>Valore calcolato</dt><dd class="num">{{ m(computedValue) }}</dd></div>
        <div>
          <dt>Correzione</dt>
          <dd class="num" :class="correction ? (correction > 0 ? 'pos' : 'neg') : ''">{{ correction === null ? '—' : signed(correction) }}</dd>
        </div>
        <div v-if="position.adjustment && cfg?.adjustmentFrom">
          <dt>Correzione attuale</dt>
          <dd class="num">{{ signed(position.adjustment) }} <span class="muted">dal {{ formatDate(cfg.adjustmentFrom) }}</span></dd>
        </div>
      </dl>

      <UiAlert v-if="!cfg" tone="warning">Configura prima lo strumento (ticker o dati dell'obbligazione) per poter correggere il valore.</UiAlert>
      <UiAlert v-if="error" tone="warning">{{ error }}</UiAlert>
    </form>
    <template #footer>
      <UiButton v-if="position?.adjustment" variant="ghost" icon="trash" :disabled="saving" class="va__reset" @click="persist(null)">Rimuovi correzione</UiButton>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="value-adjust" variant="primary" :loading="saving" :disabled="!cfg">Salva</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.va { display: flex; flex-direction: column; gap: 14px; }
.va__field { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; color: var(--text-secondary); }
.va__input { font-size: 1.3rem; height: 48px; }
.va__sum { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.va__sum div { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); min-width: 0; }
.va__sum div:nth-child(3) { grid-column: 1 / -1; }
.va__sum dt { font-size: 0.75rem; color: var(--text-muted); }
.va__sum dd { margin: 2px 0 0; font-size: 1rem; }
.va__reset { margin-right: auto; }
</style>
