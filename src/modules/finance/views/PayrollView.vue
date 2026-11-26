<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { compareNetWithSalary, CORE_FIELD_COLUMNS, isSalaryOperation, normalizeKey, PAYROLL_DETAIL_COLUMNS, parseAmount, parseDecimal, type PayrollRecord, type SalaryMatch } from '../domain'
import EntryDialog from '../components/EntryDialog.vue'
import { useLedgerStore, type EntryPrefill } from '../store/ledgerStore'
import { formatDate, formatMoney } from '@/core/utils/format'
import { readPayrollPdf } from '../data/localFiles'
import {
  checkPayrollRecord,
  MAX_PAYROLL_PDF_BYTES,
  PayrollApiError,
  savePayrollRecord,
  type PayrollExistingRow,
  type PayrollSaveResult,
} from '../data/payrollApi'
import { useFinanceStore } from '../store/financeStore'

interface PayrollDraft {
  record: PayrollRecord
  file: File
  /** URL locale (blob:) del PDF per l'anteprima affiancata. */
  pdfUrl: string
  /** Anteprima aperta (rilevante solo su schermi stretti, dove è minimizzabile). */
  previewOpen: boolean
  warnings: string[]
  error: string
  saved: PayrollSaveResult | null
  saving: boolean
  /** Esito del controllo "riga già presente nel foglio". */
  sheetCheck: SheetCheck
  /** Conferma esplicita di sovrascrivere la riga esistente. */
  overwrite: boolean
}

type SheetCheck =
  | { state: 'idle' | 'checking' | 'new' }
  | { state: 'exists'; existing: PayrollExistingRow; sheetUrl: string | null }
  | { state: 'error'; message: string }

type PayrollValueField = 'basePay' | 'grossPay' | 'totalDeductions' | 'netPay' | 'hoursWorked' | 'inpsTaxable' | 'irpefTaxable' | 'irpefPaid' | 'vacationRemaining' | 'permitsRemaining'

const store = useFinanceStore()
const ledger = useLedgerStore()
const drafts = ref<PayrollDraft[]>([])
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

/** Voci aggiuntive (quelle principali sono già nella griglia sopra). */
const coreColumns = new Set<string>(Object.values(CORE_FIELD_COLUMNS))
const extraColumns = PAYROLL_DETAIL_COLUMNS.filter((column) => !coreColumns.has(column))

function detailColumns(record: PayrollRecord) {
  return extraColumns.filter((column) => record.details[column] !== undefined)
}

function detailLabel(column: string) {
  return column.replace(/_/g, ' ')
}

function setDetail(draft: PayrollDraft, column: string, event: Event) {
  const value = parseDecimal((event.target as HTMLInputElement).value)
  if (value === null) delete draft.record.details[column]
  else draft.record.details[column] = value
  draft.saved = null
}

/** Confronto netto in busta ↔ entrate "Stipendio" del foglio (ricalcolato a ogni modifica). */
function salaryMatch(record: PayrollRecord): SalaryMatch {
  return compareNetWithSalary(record, store.dataset.operations)
}

function salaryTone(match: SalaryMatch) {
  return match.status === 'match' ? 'good' : match.status === 'mismatch' ? 'warning' : match.status === 'missing' ? 'critical' : 'neutral'
}

function salaryLabel(match: SalaryMatch) {
  return { match: 'Coincide', mismatch: 'Importo diverso', missing: 'Stipendio non trovato', unknown: 'Da verificare' }[match.status]
}

// ---- Stipendio non trovato: aggiunta diretta della voce al bilancio -----------
const entryDialog = ref<{ open: boolean; prefill: EntryPrefill | null }>({ open: false, prefill: null })

/**
 * Entrata «Stipendio» proposta dal cedolino: netto in busta, accredito nel mese seguente
 * nello stesso giorno e sullo stesso conto dell'ultimo stipendio registrato.
 */
function salaryPrefill(record: PayrollRecord): EntryPrefill {
  const last = store.dataset.operations.filter(isSalaryOperation).sort((a, b) => b.date.localeCompare(a.date))[0]
  const category =
    ledger.state.config.categories.find((c) => c.kind === 'income' && normalizeKey(c.name).includes('stipendio'))?.name ?? last?.category ?? 'Stipendio'
  const year = record.month === 12 ? record.year! + 1 : record.year!
  const month = record.month === 12 ? 1 : record.month! + 1
  const lastDay = new Date(year, month, 0).getDate()
  const day = Math.min(last ? Number(last.date.slice(8, 10)) || 27 : 27, lastDay)
  return {
    kind: 'income',
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    account: last?.account,
    category,
    subcategory: last?.category === category ? last.subcategory || undefined : undefined,
    description: `Stipendio ${draftTitle({ record } as PayrollDraft).toLowerCase()}`,
    amount: record.netPay ?? undefined,
  }
}
function addSalaryEntry(record: PayrollRecord) {
  entryDialog.value = { open: true, prefill: salaryPrefill(record) }
}

/** Su schermi stretti l'anteprima è sotto il modulo, minimizzabile e chiusa di default. */
const COMPACT_QUERY = '(max-width: 1100px)'
const compactMedia = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COMPACT_QUERY) : null
const compact = ref(compactMedia?.matches ?? false)
const onCompactChange = (event: MediaQueryListEvent) => (compact.value = event.matches)
compactMedia?.addEventListener('change', onCompactChange)

/** Viewer del browser senza barra laterale delle miniature, adattato alla larghezza. */
function previewSrc(draft: PayrollDraft) {
  return `${draft.pdfUrl}#navpanes=0&pagemode=none&view=FitH`
}

function releasePdfs(list: PayrollDraft[]) {
  for (const draft of list) URL.revokeObjectURL(draft.pdfUrl)
}

onBeforeUnmount(() => {
  releasePdfs(drafts.value)
  compactMedia?.removeEventListener('change', onCompactChange)
})

const readyCount = computed(() => drafts.value.filter((draft) => isReady(draft.record)).length)

function isReady(record: PayrollRecord) {
  return Boolean(record.year && record.year >= 2000 && record.year <= 2100 && record.month && record.month >= 1 && record.month <= 12 && record.netPay !== null && record.netPay > 0)
}

/** Avanzamento della lettura locale dei PDF (per barra e scheletri). */
const progress = ref<{ done: number; total: number; name: string } | null>(null)
const dragging = ref(false)

async function loadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  await readFiles(files)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.name.toLowerCase().endsWith('.pdf'))
  if (!files.length) {
    readError.value = 'Trascina file PDF.'
    return
  }
  void readFiles(files)
}

async function readFiles(files: File[]) {
  if (!files.length || reading.value) return
  reading.value = true
  progress.value = { done: 0, total: files.length, name: files[0].name }
  readError.value = ''
  readWarnings.value = []
  releasePdfs(drafts.value)
  drafts.value = []
  const loaded: PayrollDraft[] = []
  const warnings: string[] = []
  for (const [index, file] of files.entries()) {
    progress.value = { done: index, total: files.length, name: file.name }
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
        pdfUrl: URL.createObjectURL(file),
        previewOpen: false,
        warnings: [...extraction.warnings, ...fileWarnings],
        error: '',
        saved: null,
        saving: false,
        sheetCheck: { state: 'idle' },
        overwrite: false,
      })
      // Mostra subito il cedolino letto, senza attendere gli altri.
      drafts.value = [...loaded]
      // Controllo duplicati sul proxy reattivo, così l'esito aggiorna la card.
      void checkSheet(drafts.value[drafts.value.length - 1])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      warnings.push(`Cedolino ${index + 1}: ${message}`)
    }
  }
  drafts.value = loaded
  readWarnings.value = warnings
  if (!loaded.length && !warnings.length) readError.value = 'Nessun PDF selezionato.'
  reading.value = false
  progress.value = null
}

/** Titolo leggibile della card: periodo e tipo, se noti. */
function draftTitle(draft: PayrollDraft) {
  const { year, month, type } = draft.record
  if (!year || !month) return draft.file.name
  const name = new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(year, month - 1, 1))
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}${type !== 'Normale' ? ` · ${type}` : ''}`
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

// ---- Controllo "già presente nel foglio" ------------------------------------------

const checkRuns = new WeakMap<PayrollDraft, number>()
const checkTimers = new WeakMap<PayrollDraft, number>()

async function checkSheet(draft: PayrollDraft) {
  draft.overwrite = false
  if (!store.accessToken || !draft.record.year || !draft.record.month) {
    draft.sheetCheck = { state: 'idle' }
    return
  }
  // Solo l'ultima verifica avviata conta (il periodo può cambiare mentre è in corso).
  const run = (checkRuns.get(draft) ?? 0) + 1
  checkRuns.set(draft, run)
  draft.sheetCheck = { state: 'checking' }
  try {
    const result = await checkPayrollRecord(draft.record, store.accessToken)
    if (checkRuns.get(draft) !== run) return
    draft.sheetCheck = result.exists && result.existing
      ? { state: 'exists', existing: result.existing, sheetUrl: result.sheetUrl }
      : { state: 'new' }
  } catch (reason) {
    if (checkRuns.get(draft) !== run) return
    draft.sheetCheck = { state: 'error', message: reason instanceof Error ? reason.message : String(reason) }
  }
}

/** Ricontrolla dopo una modifica di periodo/tipo, senza una chiamata per ogni tasto. */
function scheduleCheck(draft: PayrollDraft) {
  window.clearTimeout(checkTimers.get(draft))
  checkTimers.set(draft, window.setTimeout(() => void checkSheet(draft), 450))
}

function existingLabel(existing: PayrollExistingRow) {
  const period = `${existing.mese} ${existing.anno ?? ''}`.trim()
  return existing.tipo && existing.tipo !== 'Normale' ? `${period} · ${existing.tipo}` : period
}

function existingSavedAt(existing: PayrollExistingRow) {
  if (!existing.savedAt) return ''
  const date = new Date(existing.savedAt)
  return Number.isNaN(date.getTime()) ? existing.savedAt : new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function canSave(draft: PayrollDraft) {
  if (!isReady(draft.record) || draft.saving || draft.saved || draft.sheetCheck.state === 'checking') return false
  return draft.sheetCheck.state !== 'exists' || draft.overwrite
}

function setPeriod(draft: PayrollDraft, field: 'year' | 'month', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const value = raw ? Number(raw) : null
  draft.record[field] = value
  draft.saved = null
  updateRecordKey(draft.record)
  scheduleCheck(draft)
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
  scheduleCheck(draft)
}

async function save(draft: PayrollDraft) {
  if (!isReady(draft.record)) {
    draft.error = 'Inserisci anno, mese e netto in busta prima di salvare.'
    return
  }
  if (!store.accessToken) {
    draft.error = 'Accedi di nuovo con il token di accesso.'
    return
  }
  draft.saving = true
  draft.error = ''
  draft.saved = null
  try {
    const overwrite = draft.sheetCheck.state === 'exists' && draft.overwrite
    const result = await savePayrollRecord(draft.record, store.accessToken, draft.file, { overwrite })
    draft.saved = result
    savedItems.value = [{ key: `${draft.record.sourceHash}-${Date.now()}`, label: draftTitle(draft), year: draft.record.year, result }, ...savedItems.value]
    // La conferma resta visibile un istante sulla card, poi la card esce.
    window.setTimeout(() => removeDraft(draft), 1100)
  } catch (reason) {
    if (reason instanceof PayrollApiError && reason.code === 'already_saved' && reason.existing) {
      // Inserita nel frattempo (o controllo non riuscito): serve la conferma esplicita.
      draft.sheetCheck = { state: 'exists', existing: reason.existing, sheetUrl: reason.sheetUrl ?? null }
      draft.overwrite = false
      draft.error = ''
    } else {
      draft.error = reason instanceof PayrollApiError ? reason.message : reason instanceof Error ? reason.message : String(reason)
    }
  } finally {
    draft.saving = false
  }
}

interface SavedItem {
  key: string
  label: string
  year: number | null
  result: PayrollSaveResult
}

/** Cedolini salvati in questa sessione (le card salvate vengono tolte dalla revisione). */
const savedItems = ref<SavedItem[]>([])

function removeDraft(draft: PayrollDraft) {
  const index = drafts.value.indexOf(draft)
  if (index === -1) return
  drafts.value.splice(index, 1)
  // Revoca dopo l'animazione di uscita, così l'anteprima non sparisce a metà.
  window.setTimeout(() => URL.revokeObjectURL(draft.pdfUrl), 600)
}

function savedSummary(result: PayrollSaveResult) {
  const row = result.action === 'inserted' ? 'Riga aggiunta' : 'Riga aggiornata'
  const pdf = result.pdf === 'uploaded' ? 'PDF caricato' : result.pdf === 'existing' ? 'PDF già presente' : 'PDF non caricato'
  return `${row} · ${pdf}`
}

const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/** Uscita della card: si richiude in altezza mentre svanisce, le altre risalgono. */
function onCardLeave(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (prefersReducedMotion()) return done()
  node.style.height = `${node.offsetHeight}px`
  node.style.overflow = 'hidden'
  void node.offsetHeight
  node.style.transition = 'height 360ms cubic-bezier(.4,0,.2,1), opacity 240ms ease, transform 240ms ease, padding 360ms ease, margin 360ms ease'
  node.style.height = '0px'
  node.style.opacity = '0'
  node.style.transform = 'scale(0.98)'
  node.style.paddingTop = '0px'
  node.style.paddingBottom = '0px'
  node.style.marginBottom = 'calc(-1 * var(--space-4))'
  window.setTimeout(done, 380)
}
</script>

<template>
  <div class="stack">
    <UiCard title="Importa i cedolini" subtitle="I dati vengono letti nel browser. Al salvataggio la riga va nel foglio Drive «ANNO/busta_paga_ANNO» e il PDF nella cartella «ANNO/busta_paga».">
      <label
        class="upload"
        :class="{ 'upload--drag': dragging, 'upload--busy': reading }"
        :for="inputId"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span class="upload__icon" aria-hidden="true"><UiIcon name="upload" :size="22" /></span>
        <span class="upload__text">
          <span class="upload__title">{{ dragging ? 'Rilascia qui i cedolini' : 'Seleziona o trascina uno o più PDF' }}</span>
          <span class="muted small">PDF digitali, massimo 20 MB ciascuno. I documenti scannerizzati richiedono OCR e non sono importati automaticamente.</span>
        </span>
      </label>
      <input :id="inputId" class="sr-only" type="file" accept=".pdf,application/pdf" multiple :disabled="reading" @change="loadFiles" />
      <Transition name="fade">
        <div v-if="progress" class="progress" role="status" aria-live="polite">
          <div class="progress__label small">
            <span>Lettura di <strong>{{ progress.name }}</strong></span>
            <span class="muted">{{ progress.done + 1 }} di {{ progress.total }}</span>
          </div>
          <div class="progress__track"><div class="progress__bar" :style="{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }" /></div>
        </div>
      </Transition>
      <p v-if="readError" class="error" role="alert">{{ readError }}</p>
      <ul v-if="readWarnings.length" class="warnings">
        <li v-for="warning in readWarnings" :key="warning">{{ warning }}</li>
      </ul>
    </UiCard>

    <Transition name="fade">
      <UiCard v-if="savedItems.length" title="Salvati su Google Drive" :subtitle="`${savedItems.length} ${savedItems.length === 1 ? 'cedolino salvato' : 'cedolini salvati'} in questa sessione.`">
        <TransitionGroup tag="ul" name="saved" class="saved-list">
          <li v-for="item in savedItems" :key="item.key" class="saved-item">
            <span class="saved-item__check" aria-hidden="true"><UiIcon name="check" :size="15" /></span>
            <span class="saved-item__label">{{ item.label }}</span>
            <UiBadge tone="good">{{ savedSummary(item.result) }}</UiBadge>
            <span class="saved-item__links small">
              <a v-if="item.result.sheetUrl" :href="item.result.sheetUrl" target="_blank" rel="noopener">busta_paga_{{ item.year }}</a>
              <template v-if="item.result.pdfUrl"> · <a :href="item.result.pdfUrl" target="_blank" rel="noopener">PDF in busta_paga/</a></template>
            </span>
          </li>
        </TransitionGroup>
      </UiCard>
    </Transition>

    <TransitionGroup name="draft" tag="div" class="stack drafts" @leave="onCardLeave">
    <UiCard
      v-for="draft in drafts"
      :key="draft.record.sourceHash"
      class="draft"
      :class="{ 'draft--saving': draft.saving, 'draft--saved': draft.saved }"
      :title="draftTitle(draft)"
      :subtitle="`${draft.file.name} · confronta i valori con il PDF e correggili prima di inviarli.`"
    >
      <div class="draft__busy" aria-hidden="true" />
      <Transition name="pop">
        <div v-if="draft.saved" class="draft__done" role="status">
          <span class="draft__done-icon"><UiIcon name="check" :size="26" /></span>
          <strong>Salvato su Google Drive</strong>
          <span class="small">{{ savedSummary(draft.saved) }}</span>
        </div>
      </Transition>
      <div class="review">
      <div class="review__form">
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
      <details v-if="detailColumns(draft.record).length" class="details">
        <summary class="small secondary">Altre voci lette dal cedolino ({{ detailColumns(draft.record).length }})</summary>
        <div class="payroll-grid">
          <label v-for="column in detailColumns(draft.record)" :key="column">
            <span class="small secondary">{{ detailLabel(column) }}</span>
            <input class="input" type="number" step="any" :value="draft.record.details[column]" @input="setDetail(draft, column, $event)" />
          </label>
        </div>
      </details>
      <section class="salary" :class="`salary--${salaryMatch(draft.record).status}`" aria-label="Confronto con lo stipendio registrato">
        <div class="salary__head">
          <strong>Netto in busta vs «Stipendio» nel foglio</strong>
          <Transition name="pop" mode="out-in">
            <UiBadge :key="salaryMatch(draft.record).status" :tone="salaryTone(salaryMatch(draft.record))">{{ salaryLabel(salaryMatch(draft.record)) }}</UiBadge>
          </Transition>
        </div>
        <template v-if="salaryMatch(draft.record).status === 'unknown'">
          <p class="muted small">Indica mese, anno e netto in busta per confrontarlo con le entrate del foglio.</p>
        </template>
        <template v-else-if="salaryMatch(draft.record).status === 'missing'">
          <p class="muted small">
            Nessuna entrata in categoria «Stipendio» tra {{ formatDate(salaryMatch(draft.record).from!) }} e la fine del mese successivo.
            <template v-if="!store.dataset.operations.length"> Il foglio delle finanze non è ancora caricato.</template>
          </p>
          <div class="salary__add">
            <UiButton size="sm" variant="primary" icon="plus" @click="addSalaryEntry(draft.record)">
              Aggiungi lo stipendio al bilancio ({{ formatMoney(draft.record.netPay, 'EUR') }})
            </UiButton>
          </div>
        </template>
        <template v-else>
          <dl class="salary__grid">
            <div><dt class="small secondary">Netto in busta</dt><dd>{{ formatMoney(draft.record.netPay, 'EUR') }}</dd></div>
            <div><dt class="small secondary">Stipendio nel foglio</dt><dd>{{ formatMoney(salaryMatch(draft.record).operation!.amount, salaryMatch(draft.record).operation!.currency) }}</dd></div>
            <div><dt class="small secondary">Differenza</dt><dd :class="{ 'salary__diff': salaryMatch(draft.record).difference !== 0 }">{{ formatMoney(salaryMatch(draft.record).difference, 'EUR', { sign: true }) }}</dd></div>
          </dl>
          <p class="muted small">
            Accredito del {{ formatDate(salaryMatch(draft.record).operation!.date.slice(0, 10)) }} su {{ salaryMatch(draft.record).operation!.account }}<template v-if="salaryMatch(draft.record).operation!.description"> · «{{ salaryMatch(draft.record).operation!.description }}»</template>
          </p>
          <ul v-if="salaryMatch(draft.record).candidates.length > 1" class="salary__others small muted">
            <li v-for="op in salaryMatch(draft.record).candidates.filter((c) => c !== salaryMatch(draft.record).operation)" :key="op.id">
              Altra entrata Stipendio: {{ formatDate(op.date.slice(0, 10)) }} · {{ formatMoney(op.amount, op.currency) }}<template v-if="op.description"> · {{ op.description }}</template>
            </li>
          </ul>
          <div v-if="salaryMatch(draft.record).status === 'mismatch'" class="salary__add">
            <span class="muted small">L'entrata trovata è di un altro mese?</span>
            <UiButton size="sm" icon="plus" @click="addSalaryEntry(draft.record)">Aggiungi come nuova entrata</UiButton>
          </div>
        </template>
      </section>
      <ul v-if="draft.warnings.length" class="warnings">
        <li v-for="warning in draft.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <p v-if="draft.error" class="error" role="alert">{{ draft.error }}</p>
      <Transition name="fade" mode="out-in">
        <p v-if="draft.sheetCheck.state === 'checking'" key="checking" class="sheet-check sheet-check--checking small" role="status">
          <span class="spinner" aria-hidden="true" /> Verifico se è già nel foglio busta_paga_{{ draft.record.year }}…
        </p>
        <p v-else-if="draft.sheetCheck.state === 'new'" key="new" class="sheet-check sheet-check--new small" role="status">
          <UiIcon name="checkCircle" :size="15" /> Non ancora presente nel foglio busta_paga_{{ draft.record.year }}.
        </p>
        <div v-else-if="draft.sheetCheck.state === 'exists'" key="exists" class="sheet-check sheet-check--exists" role="alert">
          <div class="sheet-check__head">
            <UiIcon name="alert" :size="17" />
            <strong v-if="draft.sheetCheck.existing.match === 'period'">Questo cedolino è già nel foglio</strong>
            <strong v-else>Questo PDF è già stato salvato come {{ existingLabel(draft.sheetCheck.existing) }}</strong>
          </div>
          <p class="small">
            Riga {{ draft.sheetCheck.existing.row }} · {{ existingLabel(draft.sheetCheck.existing) }}
            <template v-if="draft.sheetCheck.existing.netPay !== null"> · netto {{ formatMoney(Math.round(draft.sheetCheck.existing.netPay * 100), 'EUR') }}</template>
            <template v-if="draft.sheetCheck.existing.savedAt"> · salvata il {{ existingSavedAt(draft.sheetCheck.existing) }}</template>
            <template v-if="draft.sheetCheck.sheetUrl"> · <a :href="draft.sheetCheck.sheetUrl" target="_blank" rel="noopener">apri il foglio</a></template>
          </p>
          <label class="sheet-check__confirm small">
            <input v-model="draft.overwrite" type="checkbox" />
            Sovrascrivi la riga esistente con questi dati<template v-if="draft.sheetCheck.existing.match === 'pdf'"> (il periodo diventerà quello indicato sopra)</template>
          </label>
        </div>
        <p v-else-if="draft.sheetCheck.state === 'error'" key="error" class="sheet-check sheet-check--error small">
          <UiIcon name="info" :size="15" /> Non è stato possibile verificare il foglio ({{ draft.sheetCheck.message }}). Al salvataggio il controllo viene ripetuto.
          <button type="button" class="link-button" @click="checkSheet(draft)">Riprova</button>
        </p>
      </Transition>
      <div class="row payroll__actions">
        <UiButton variant="primary" icon="lock" :loading="draft.saving" :disabled="!canSave(draft)" @click="save(draft)">
          {{ draft.saving ? 'Salvataggio in corso…' : draft.sheetCheck.state === 'exists' ? 'Sovrascrivi su Google Drive' : 'Salva su Google Drive' }}
        </UiButton>
        <span v-if="!isReady(draft.record)" class="muted small">Per salvare servono periodo e netto in busta.</span>
      </div>
      </div>
      <div class="review__pdf">
        <UiButton
          v-if="compact"
          size="sm"
          :icon="draft.previewOpen ? 'arrowUp' : 'arrowDown'"
          :aria-expanded="draft.previewOpen"
          @click="draft.previewOpen = !draft.previewOpen"
        >
          {{ draft.previewOpen ? 'Nascondi anteprima PDF' : 'Mostra anteprima PDF' }}
        </UiButton>
        <template v-if="!compact || draft.previewOpen">
          <iframe :src="previewSrc(draft)" :title="`Anteprima di ${draft.file.name}`" class="pdf-frame" />
          <a class="small" :href="draft.pdfUrl" target="_blank" rel="noopener">Apri il PDF in una nuova scheda</a>
        </template>
      </div>
      </div>
    </UiCard>
    </TransitionGroup>

    <!-- Scheletri dei cedolini ancora da leggere -->
    <div v-if="progress && progress.total > drafts.length" class="stack" aria-hidden="true">
      <div v-for="n in progress.total - drafts.length" :key="n" class="skeleton-card">
        <div class="sk sk--title" />
        <div class="sk-grid">
          <div class="sk-col">
            <div v-for="i in 6" :key="i" class="sk sk--field" />
          </div>
          <div class="sk sk--pdf" />
        </div>
      </div>
    </div>

    <p v-if="drafts.length" class="muted small">
      {{ readyCount }} di {{ drafts.length }} cedolini pronti. Il PDF viene inviato solo al tuo Google Drive al momento del salvataggio.
    </p>

    <EntryDialog :open="entryDialog.open" :prefill="entryDialog.prefill" @close="entryDialog.open = false" />
  </div>
</template>

<style scoped>
.upload { display: flex; align-items: center; gap: 14px; padding: 18px; border: 1.5px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; transition: border-color 160ms ease, background 160ms ease, transform 160ms ease, box-shadow 160ms ease; }
.upload:hover { border-color: var(--accent); }
.upload--drag { border-color: var(--accent); background: var(--accent-soft); transform: scale(1.01); box-shadow: 0 0 0 4px var(--accent-soft); }
.upload--busy { cursor: progress; opacity: 0.75; }
.upload__icon { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); transition: transform 200ms ease; }
.upload:hover .upload__icon { transform: translateY(-2px); }
.upload--drag .upload__icon { animation: bob 900ms ease-in-out infinite; }
.upload--busy .upload__icon { animation: pulse 1.2s ease-in-out infinite; }
.upload__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.upload__title { font-weight: 650; }

.progress { margin-top: var(--space-3); }
.progress__label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.progress__label span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress__track { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.progress__bar { position: relative; height: 100%; overflow: hidden; border-radius: inherit; background: var(--accent); transition: width 400ms cubic-bezier(.4, 0, .2, 1); }
.progress__bar::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .45), transparent); animation: sweep 1.1s linear infinite; }

/* Scheletri durante la lettura */
.skeleton-card { background: var(--surface); border-radius: var(--radius-lg); padding: 22px 24px 24px; animation: fade-down 260ms ease; }
.sk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin-top: var(--space-4); }
.sk-col { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-content: start; }
.sk { border-radius: 8px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: sk-shimmer 1.3s linear infinite; }
.sk--title { width: 40%; height: 20px; }
.sk--field { height: 54px; }
.sk--pdf { height: 320px; }

/* Card del cedolino */
.drafts:empty { display: none; }
.draft { position: relative; overflow: clip; transition: box-shadow 240ms ease; }
.draft__busy { position: absolute; top: 0; left: 0; right: 0; height: 3px; opacity: 0; transition: opacity 200ms ease; background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 50% 100%; background-repeat: no-repeat; }
.draft--saving .draft__busy { opacity: 1; animation: busy 1.1s ease-in-out infinite; }
.review { transition: opacity 200ms ease, filter 200ms ease; }
.draft--saving .review { opacity: 0.55; pointer-events: none; filter: saturate(0.7); }
.draft--saved { box-shadow: 0 0 0 2px var(--positive); }
.draft__done { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(2px); color: var(--positive); }
.draft__done-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--positive-soft); animation: check-pop 420ms cubic-bezier(.2, 1.4, .4, 1); }

.saved-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.saved-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); }
.saved-item__check { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--positive-soft); color: var(--positive); }
.saved-item__label { font-weight: 650; }
.saved-item__links { margin-left: auto; }

/* Transizioni */
.draft-enter-active { transition: opacity 320ms ease, transform 320ms cubic-bezier(.2, .8, .2, 1); }
.draft-enter-from { opacity: 0; transform: translateY(12px); }
.draft-move { transition: transform 360ms cubic-bezier(.4, 0, .2, 1); }
.saved-enter-active { transition: opacity 300ms ease, transform 300ms cubic-bezier(.2, .8, .2, 1), background 1.2s ease; }
.saved-enter-from { opacity: 0; transform: translateY(-8px); background: var(--positive-soft); }
.saved-move { transition: transform 300ms ease; }
.fade-enter-active, .fade-leave-active { transition: opacity 220ms ease, transform 220ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
.pop-enter-active { transition: opacity 200ms ease, transform 260ms cubic-bezier(.2, 1.4, .4, 1); }
.pop-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(0.9); }
.details[open] .payroll-grid { animation: fade-down 220ms ease; }
.salary { transition: border-color 240ms ease, background 240ms ease; }

@keyframes sk-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes busy { from { background-position: -50% 0; } to { background-position: 150% 0; } }
@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes bob { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(-6px); } }
@keyframes check-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes fade-down { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .draft-enter-active, .draft-move, .saved-enter-active, .saved-move, .fade-enter-active, .fade-leave-active, .pop-enter-active, .pop-leave-active,
  .upload, .upload__icon, .progress__bar, .progress__bar::after, .sk, .skeleton-card, .draft, .draft__busy, .review, .draft__done-icon, .salary, .details[open] .payroll-grid { animation: none !important; transition: none !important; }
}
.period { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.period label, .payroll-grid label { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.period .input { min-width: 160px; }
.payroll-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-4); }
.payroll-grid .input { width: 100%; }
.review { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.review__form { min-width: 0; }
.review__form .payroll-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.review__pdf { position: sticky; top: var(--space-4); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pdf-frame { width: 100%; height: min(85vh, 1100px); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.salary { margin-top: var(--space-4); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.salary--match { border-color: var(--positive); }
.salary--mismatch, .salary--missing { border-color: var(--status-warning); }
.salary__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.salary__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin: var(--space-3) 0 6px; }
.salary__grid dd { margin: 2px 0 0; font-weight: 650; font-variant-numeric: tabular-nums; }
.salary__diff { color: var(--negative); }
.salary__others { margin: 6px 0 0; padding-left: 18px; }
.salary__add { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-top: var(--space-3); }
.details { margin-top: var(--space-4); }
.details summary { cursor: pointer; }
.warnings { margin: var(--space-3) 0 0; padding-left: 20px; color: var(--text-secondary); font-size: 0.85rem; }
.warnings li + li { margin-top: 4px; }
.error { margin-top: var(--space-3); color: var(--negative); }
.payroll__actions { margin-top: var(--space-3); }
.sheet-check { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: var(--space-4); }
.sheet-check--checking { color: var(--text-secondary); }
.sheet-check--new { color: var(--positive); }
.sheet-check--error { color: var(--text-secondary); }
.sheet-check--exists { display: block; padding: var(--space-3); border-radius: var(--radius); background: var(--warning-soft); border: 1px solid var(--status-warning); animation: fade-down 220ms ease; }
.sheet-check__head { display: flex; align-items: center; gap: 8px; color: var(--status-warning); }
.sheet-check--exists p { margin: 6px 0 0; color: var(--text-secondary); }
.sheet-check__confirm { display: flex; align-items: center; gap: 8px; margin-top: var(--space-3); cursor: pointer; font-weight: 600; }
.link-button { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
.spinner { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1100px) { .sk-grid { grid-template-columns: 1fr; } .sk--pdf { height: 44px; } .review { grid-template-columns: minmax(0, 1fr); } .review__pdf { position: static; align-items: flex-start; } .review__pdf .pdf-frame { align-self: stretch; } .pdf-frame { height: 70vh; } }
@media (max-width: 760px) { .payroll-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .payroll-grid { grid-template-columns: minmax(0, 1fr); } .period label { flex: 1; } .period .input { min-width: 0; width: 100%; } }
</style>
