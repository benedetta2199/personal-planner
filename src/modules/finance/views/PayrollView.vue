<script setup lang="ts">
import { computed, ref } from 'vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiCard from '@/core/ui/UiCard.vue'
import { parseAmount, parseDecimal, type PayrollRecord } from '../domain'
import { readPayrollPdf } from '../data/localFiles'
import { MAX_PAYROLL_PDF_BYTES, PayrollApiError, savePayrollRecord, type PayrollSaveResult } from '../data/payrollApi'
import { useFinanceStore } from '../store/financeStore'

interface PayrollDraft {
  record: PayrollRecord
  file: File
  warnings: string[]
  error: string
  saved: PayrollSaveResult | null
  saving: boolean
}

type PayrollValueField = 'basePay' | 'grossPay' | 'totalDeductions' | 'netPay' | 'hoursWorked' | 'inpsTaxable' | 'irpefTaxable' | 'irpefPaid' | 'vacationRemaining' | 'permitsRemaining'

const store = useFinanceStore()
const drafts = ref<PayrollDraft[]>([])
const tokenDraft = ref(store.accessToken)
const readError = ref('')
const readWarnings = ref<string[]>([])
const reading = ref(false)
const inputId = 'payroll-files'

const fields: { key: PayrollValueField; label: string; unit: 'money' | 'number' }[] = [
  { key: 'basePay', label: 'Paga base', unit: 'money' },
  { key: 'grossPay', label: 'Totale competenze', unit: 'money' },
  { key: 'totalDeductions', label: 'Totale trattenute', unit: 'money' },
  { key: 'netPay', label: 'Netto in busta', unit: 'money' },
  { key: 'hoursWorked', label: 'Ore lavorate', unit: 'number' },
  { key: 'inpsTaxable', label: 'Imponibile INPS', unit: 'money' },
  { key: 'irpefTaxable', label: 'Imponibile IRPEF', unit: 'money' },
  { key: 'irpefPaid', label: 'IRPEF pagata', unit: 'money' },
  { key: 'vacationRemaining', label: 'Ferie residue', unit: 'number' },
  { key: 'permitsRemaining', label: 'Permessi residui', unit: 'number' },
]

const readyCount = computed(() => drafts.value.filter((draft) => isReady(draft.record)).length)

function isReady(record: PayrollRecord) {
  return Boolean(record.year && record.year >= 2000 && record.year <= 2100 && record.month && record.month >= 1 && record.month <= 12 && record.netPay !== null && record.netPay > 0)
}

async function loadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  readError.value = ''
  readWarnings.value = []
  drafts.value = []
  const loaded: PayrollDraft[] = []
  const warnings: string[] = []
  for (const [index, file] of files.entries()) {
    try {
      const extraction = await readPayrollPdf(file)
      if (loaded.some((draft) => draft.record.sourceHash === extraction.record.sourceHash)) {
        warnings.push(`Cedolino ${index + 1}: file duplicato, escluso dall'anteprima.`)
        continue
      }
      const fileWarnings = file.size > MAX_PAYROLL_PDF_BYTES ? ['PDF oltre 3 MB: verranno salvati solo i dati nel foglio, non il file.'] : []
      loaded.push({
        record: extraction.record,
        file,
        warnings: [...extraction.warnings, ...fileWarnings],
        error: '',
        saved: null,
        saving: false,
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      warnings.push(`Cedolino ${index + 1}: ${message}`)
    }
  }
  drafts.value = loaded
  readWarnings.value = warnings
  if (!loaded.length && !warnings.length) readError.value = 'Nessun PDF selezionato.'
  reading.value = false
  input.value = ''
}

function euros(value: number | null, unit: 'money' | 'number') {
  if (value === null) return ''
  return unit === 'money' ? (value / 100).toFixed(2) : String(value)
}

function setValue(draft: PayrollDraft, field: PayrollValueField, unit: 'money' | 'number', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const value = raw.trim() ? (unit === 'money' ? parseAmount(raw) : parseDecimal(raw)) : null
  draft.record[field] = value
  draft.saved = null
}

function setPeriod(draft: PayrollDraft, field: 'year' | 'month', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const value = raw ? Number(raw) : null
  draft.record[field] = value
  draft.saved = null
  updateRecordKey(draft.record)
}

function updateRecordKey(record: PayrollRecord) {
  if (record.year && record.month) {
    record.recordKey = `${record.year}-${String(record.month).padStart(2, '0')}-${record.type.toLowerCase().replace(/[^a-z0-9]/g, '')}`
  }
}

function setType(draft: PayrollDraft, event: Event) {
  draft.record.type = (event.target as HTMLSelectElement).value
  draft.saved = null
  updateRecordKey(draft.record)
}

function connectToken() {
  store.setAccessToken(tokenDraft.value)
}

async function save(draft: PayrollDraft) {
  if (!isReady(draft.record)) {
    draft.error = 'Inserisci anno, mese e netto in busta prima di salvare.'
    return
  }
  if (!store.accessToken) {
    draft.error = 'Inserisci prima il token di accesso.'
    return
  }
  draft.saving = true
  draft.error = ''
  draft.saved = null
  try {
    draft.saved = await savePayrollRecord(draft.record, store.accessToken, draft.file)
  } catch (reason) {
    draft.error = reason instanceof PayrollApiError ? reason.message : reason instanceof Error ? reason.message : String(reason)
  } finally {
    draft.saving = false
  }
}
</script>

<template>
  <div class="stack">
    <UiCard title="Importa i cedolini" subtitle="I dati vengono letti nel browser. Al salvataggio la riga va nel foglio Drive «ANNO/busta_paga_ANNO» e il PDF nella cartella «ANNO/busta_paga».">
      <label class="upload" :for="inputId">
        <span class="upload__title">Seleziona uno o più PDF</span>
        <span class="muted small">PDF digitali, massimo 20 MB ciascuno. I documenti scannerizzati richiedono OCR e non sono importati automaticamente.</span>
      </label>
      <input :id="inputId" class="sr-only" type="file" accept=".pdf,application/pdf" multiple @change="loadFiles" />
      <p v-if="reading" class="muted small" role="status">Estrazione locale dei dati in corso…</p>
      <p v-if="readError" class="error" role="alert">{{ readError }}</p>
      <ul v-if="readWarnings.length" class="warnings">
        <li v-for="warning in readWarnings" :key="warning">{{ warning }}</li>
      </ul>
      <form v-if="!store.accessToken" class="token" @submit.prevent="connectToken">
        <label>
          <span class="small secondary">Token di accesso richiesto per salvare su Google Sheets</span>
          <input v-model="tokenDraft" class="input" type="password" autocomplete="current-password" placeholder="Incolla il token" />
        </label>
        <UiButton type="submit" icon="lock">Collega</UiButton>
      </form>
    </UiCard>

    <UiCard v-for="(draft, index) in drafts" :key="draft.record.sourceHash" :title="`Cedolino ${index + 1}`" subtitle="Verifica e correggi i valori prima di inviarli.">
      <div class="period">
        <label>
          <span class="small secondary">Anno</span>
          <input class="input" type="number" min="2000" max="2100" :value="draft.record.year ?? ''" @input="setPeriod(draft, 'year', $event)" />
        </label>
        <label>
          <span class="small secondary">Mese</span>
          <select class="input" :value="draft.record.month ?? ''" @change="setPeriod(draft, 'month', $event)">
            <option value="">Seleziona</option>
            <option v-for="month in 12" :key="month" :value="month">{{ new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(2026, month - 1, 1)) }}</option>
          </select>
        </label>
        <label>
          <span class="small secondary">Tipo busta</span>
          <select class="input" :value="draft.record.type" @change="setType(draft, $event)">
            <option>Normale</option>
            <option>Tredicesima</option>
            <option>Quattordicesima</option>
          </select>
        </label>
      </div>
      <div class="payroll-grid">
        <label v-for="field in fields" :key="field.key">
          <span class="small secondary">{{ field.label }}<template v-if="field.unit === 'money'"> (€)</template></span>
          <input
            class="input"
            type="number"
            step="0.01"
            min="0"
            :value="euros(draft.record[field.key], field.unit)"
            @input="setValue(draft, field.key, field.unit, $event)"
          />
        </label>
      </div>
      <ul v-if="draft.warnings.length" class="warnings">
        <li v-for="warning in draft.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <p v-if="draft.error" class="error" role="alert">{{ draft.error }}</p>
      <p v-if="draft.saved" class="saved" role="status">
        <UiBadge tone="good">{{ draft.saved.action === 'inserted' ? 'Riga aggiunta' : 'Riga aggiornata' }}</UiBadge>
        <a v-if="draft.saved.sheetUrl" :href="draft.saved.sheetUrl" target="_blank" rel="noopener">busta_paga_{{ draft.record.year }}</a>
        <template v-if="draft.saved.pdf !== 'skipped'">
          ·
          <a v-if="draft.saved.pdfUrl" :href="draft.saved.pdfUrl" target="_blank" rel="noopener">PDF {{ draft.saved.pdf === 'uploaded' ? 'caricato' : 'già presente' }} in busta_paga/</a>
        </template>
        <span v-else class="muted small">· PDF non caricato</span>
      </p>
      <div class="row payroll__actions">
        <UiButton variant="primary" icon="lock" :loading="draft.saving" :disabled="!isReady(draft.record)" @click="save(draft)">
          Salva su Google Drive
        </UiButton>
        <span v-if="!isReady(draft.record)" class="muted small">Per salvare servono periodo e netto in busta.</span>
      </div>
    </UiCard>

    <p v-if="drafts.length" class="muted small">
      {{ readyCount }} di {{ drafts.length }} cedolini pronti. Il PDF viene inviato solo al tuo Google Drive al momento del salvataggio.
    </p>
  </div>
</template>

<style scoped>
.upload { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; }
.upload:hover { border-color: var(--accent); }
.upload__title { font-weight: 650; }
.token { display: flex; align-items: flex-end; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
.token label { display: flex; flex: 1; flex-direction: column; gap: 5px; min-width: 220px; }
.period { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.period label, .payroll-grid label { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.period .input { min-width: 160px; }
.payroll-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-4); }
.payroll-grid .input { width: 100%; }
.warnings { margin: var(--space-3) 0 0; padding-left: 20px; color: var(--text-secondary); font-size: 0.85rem; }
.warnings li + li { margin-top: 4px; }
.error { margin-top: var(--space-3); color: var(--negative); }
.saved { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: var(--space-3); }
.payroll__actions { margin-top: var(--space-4); }
@media (max-width: 760px) { .payroll-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .payroll-grid { grid-template-columns: minmax(0, 1fr); } .period label { flex: 1; } .period .input { min-width: 0; width: 100%; } }
</style>
