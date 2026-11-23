<script setup lang="ts">
import { computed, ref } from 'vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiCard from '@/core/ui/UiCard.vue'
import { formatDate, formatMoney } from '@/core/utils/format'
import { extractCategoryOptions, reconcileStatements, type CategoryOption, type LedgerRow, type ReconciliationItem, type StatementRow } from '../domain/reconciliation'
import { readLedgerFile, readStatementFile } from '../data/localFiles'

interface Classification {
  category: string
  subcategory: string
  expenseType: string
}

interface ImportedStatementFile {
  name: string
  rows: StatementRow[]
}

const ledger = ref<LedgerRow[]>([])
const ledgerName = ref('')
const categories = ref<CategoryOption[]>([])
const statements = ref<ImportedStatementFile[]>([])
const issues = ref<{ file: string; severity: 'error' | 'warning'; message: string; row?: number }[]>([])
const classifications = ref<Record<string, Classification>>({})
const busy = ref(false)
const error = ref('')
const statementAccount = ref('')

const statementRows = computed(() => statements.value.flatMap((file) => file.rows))
const reconciliation = computed(() => reconcileStatements(ledger.value, statementRows.value))
const counts = computed(() => ({
  matched: reconciliation.value.filter((row) => row.status === 'matched').length,
  mismatched: reconciliation.value.filter((row) => ['amount_mismatch', 'date_mismatch', 'description_mismatch', 'currency_mismatch'].includes(row.status)).length,
  missingInGeneral: reconciliation.value.filter((row) => row.status === 'missing_in_general').length,
  missingInStatement: reconciliation.value.filter((row) => row.status === 'missing_in_statement').length,
  duplicates: reconciliation.value.filter((row) => row.status === 'duplicate').length,
}))
const accounts = computed(() => [...new Set(ledger.value.flatMap((row) => [row.account, row.toAccount]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')))
const exportableMissingCount = computed(() => reconciliation.value.filter((row) => row.status === 'missing_in_general' && row.statement?.kind !== 'transfer').length)
const missingTransferCount = computed(() => reconciliation.value.filter((row) => row.status === 'missing_in_general' && row.statement?.kind === 'transfer').length)

const statusLabels: Record<ReconciliationItem['status'], string> = {
  matched: 'Corrisponde',
  amount_mismatch: 'Importo diverso',
  date_mismatch: 'Data diversa',
  description_mismatch: 'Descrizione diversa',
  currency_mismatch: 'Valuta diversa',
  duplicate: 'Duplicato',
  missing_in_general: 'Manca nel generale',
  missing_in_statement: 'Manca nell’estratto',
}

const statusTones: Record<ReconciliationItem['status'], 'good' | 'warning' | 'critical' | 'neutral'> = {
  matched: 'good',
  amount_mismatch: 'critical',
  date_mismatch: 'warning',
  description_mismatch: 'warning',
  currency_mismatch: 'critical',
  duplicate: 'warning',
  missing_in_general: 'critical',
  missing_in_statement: 'warning',
}

async function loadLedger(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  busy.value = true
  error.value = ''
  try {
    const result = await readLedgerFile(file)
    ledger.value = result.records
    ledgerName.value = file.name
    categories.value = extractCategoryOptions(result.records)
    issues.value = result.issues.map((item) => ({ ...item, file: file.name }))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
    ;(event.target as HTMLInputElement).value = ''
  }
}

async function loadStatements(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  busy.value = true
  error.value = ''
  try {
    const parsedFiles = await Promise.all(files.map((file) => readStatementFile(file, statementAccount.value || undefined)))
    statements.value = parsedFiles.map((result) => ({ name: result.fileName, rows: result.records }))
    const newClassifications = { ...classifications.value }
    for (const statement of parsedFiles.flatMap((result) => result.records)) {
      newClassifications[statement.id] ??= { category: '', subcategory: '', expenseType: 'Desiderio' }
    }
    classifications.value = newClassifications
    issues.value = [
      ...issues.value.filter((item) => !parsedFiles.some((file) => file.fileName === item.file)),
      ...parsedFiles.flatMap((result) => result.issues.map((item) => ({ ...item, file: result.fileName }))),
    ]
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
    input.value = ''
  }
}

function setCategory(statementId: string, category: string) {
  const current = classifications.value[statementId] ?? { category: '', subcategory: '', expenseType: 'Desiderio' }
  classifications.value[statementId] = { ...current, category, subcategory: '' }
}

function setClassification(statementId: string, key: keyof Classification, value: string) {
  const current = classifications.value[statementId] ?? { category: '', subcategory: '', expenseType: 'Desiderio' }
  classifications.value[statementId] = { ...current, [key]: value }
}

function downloadMissingRows() {
  const rows = reconciliation.value.filter((item) => item.status === 'missing_in_general' && item.statement?.kind !== 'transfer')
  if (!rows.length) return
  const header = ['Giorno', 'Tipo', 'Tipo_spesa', 'Conto', 'Conto_dest', 'Categoria', 'Sotto-categoria', 'Importo', 'Valuta', 'Descrizione', 'Nota', 'EUR', 'row_id']
  const output = rows.map((item) => {
    const statement = item.statement!
    const classification = classifications.value[statement.id]
    return [
      statement.date,
      statement.kind === 'income' ? 'Guadagno' : statement.kind === 'transfer' ? 'Trasferimento' : 'Spesa',
      statement.kind === 'expense' ? classification?.expenseType ?? 'Desiderio' : '',
      statement.account,
      '',
      classification?.category || 'Senza categoria',
      classification?.subcategory || '',
      (statement.amount / 100).toFixed(2),
      statement.currency,
      statement.description,
      '',
      statement.currency === 'EUR' ? (statement.amount / 100).toFixed(2) : '',
      statement.id,
    ]
  })
  const csv = `\uFEFF${[header, ...output].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'movimenti-mancanti.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function displayAmount(cents?: number, currency = 'EUR') {
  return cents === undefined ? '—' : formatMoney(cents, currency)
}
</script>

<template>
  <div class="stack">
    <UiCard title="Confronta gli estratti" subtitle="I file vengono elaborati solo in questo browser: non vengono caricati sul server né salvati in memoria persistente.">
      <div class="upload-grid">
        <label class="upload">
          <span class="upload__title">1. File generale</span>
          <span class="muted small">CSV o XLSX con i movimenti già registrati</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx" @change="loadLedger" />
          <span v-if="ledgerName" class="upload__file">{{ ledgerName }} · {{ ledger.length }} righe valide</span>
        </label>
        <label class="upload">
          <span class="upload__title">2. Estratti conto</span>
          <span class="muted small">CSV Revolut/Trade Republic, XLSX Satispay o estratto interessi Revolut</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx" multiple @change="loadStatements" />
          <span v-if="statements.length" class="upload__file">{{ statements.length }} file · {{ statementRows.length }} operazioni</span>
        </label>
      </div>
      <label class="account">
        <span class="small secondary">Associa i conti prima di caricare gli estratti</span>
        <select v-model="statementAccount" class="input">
          <option value="">Rilevamento automatico</option>
          <option v-for="account in accounts" :key="account" :value="account">{{ account }}</option>
        </select>
      </label>
      <p v-if="busy" class="muted small" role="status">Lettura e confronto dei file in corso…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="issues.length" class="issues">
        <p v-for="(issue, index) in issues.slice(0, 20)" :key="`${issue.file}-${issue.row}-${index}`" class="small">
          <strong>{{ issue.file }}</strong><template v-if="issue.row"> · riga {{ issue.row }}</template>: {{ issue.message }}
        </p>
        <p v-if="issues.length > 20" class="muted small">Altre {{ issues.length - 20 }} segnalazioni.</p>
      </div>
    </UiCard>

    <template v-if="ledger.length && statementRows.length">
      <section class="grid grid-kpi" aria-label="Riepilogo riconciliazione">
        <div class="summary"><span>Corrispondono</span><strong>{{ counts.matched }}</strong></div>
        <div class="summary" :class="{ 'summary--alert': counts.mismatched }"><span>Da verificare</span><strong>{{ counts.mismatched }}</strong></div>
        <div class="summary" :class="{ 'summary--alert': counts.missingInGeneral }"><span>Mancano nel generale</span><strong>{{ counts.missingInGeneral }}</strong></div>
        <div class="summary"><span>Mancano nell’estratto</span><strong>{{ counts.missingInStatement }}</strong></div>
      </section>

      <UiCard flush title="Dettaglio corrispondenze" :subtitle="`${reconciliation.length} righe da verificare`">
        <template #actions>
          <UiButton size="sm" icon="upload" :disabled="!exportableMissingCount" @click="downloadMissingRows">Scarica righe mancanti</UiButton>
        </template>
        <p v-if="missingTransferCount" class="recon__note muted small">
          {{ missingTransferCount }} trasferimenti da integrare manualmente: il file generale richiede anche il conto di destinazione.
        </p>
        <div class="recon__scroll">
          <table class="recon">
            <thead>
              <tr><th>Esito</th><th>Data / descrizione</th><th>Estratto</th><th>File generale</th><th v-if="categories.length">Categoria per nuovi movimenti</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in reconciliation" :key="item.key">
                <td><UiBadge :tone="statusTones[item.status]">{{ statusLabels[item.status] }}</UiBadge></td>
                <td>
                  <strong>{{ formatDate(item.statement?.date ?? item.ledger?.date ?? '') }}</strong>
                  <p class="muted small">{{ item.statement?.description || item.ledger?.description || '—' }}</p>
                  <p v-if="item.candidate" class="muted small">Possibile riga corrispondente: {{ item.candidate.description || 'senza descrizione' }}</p>
                </td>
                <td class="num">{{ item.statement ? displayAmount(item.statement.amount, item.statement.currency) : '—' }}</td>
                <td class="num">
                  <template v-if="item.ledger">{{ displayAmount(item.ledger.amount, item.ledger.currency) }}</template>
                  <template v-else-if="item.candidate">{{ displayAmount(item.candidate.amount, item.candidate.currency) }}</template>
                  <template v-else>—</template>
                </td>
                <td v-if="categories.length">
                  <template v-if="item.status === 'missing_in_general' && item.statement">
                    <select class="input category-select" :value="classifications[item.statement.id]?.category" aria-label="Categoria" @change="setCategory(item.statement.id, ($event.target as HTMLSelectElement).value)">
                      <option value="">Scegli categoria</option>
                      <option v-for="category in categories" :key="category.name" :value="category.name">{{ category.name }}</option>
                    </select>
                    <select
                      v-if="classifications[item.statement.id]?.category"
                      class="input category-select"
                      :value="classifications[item.statement.id]?.subcategory"
                      aria-label="Sotto-categoria"
                      @change="setClassification(item.statement.id, 'subcategory', ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">Nessuna sotto-categoria</option>
                      <option v-for="subcategory in categories.find((category) => category.name === classifications[item.statement!.id]?.category)?.subcategories ?? []" :key="subcategory" :value="subcategory">{{ subcategory }}</option>
                    </select>
                    <select
                      v-if="item.statement.kind === 'expense'"
                      class="input category-select"
                      :value="classifications[item.statement.id]?.expenseType"
                      aria-label="Tipologia spesa"
                      @change="setClassification(item.statement.id, 'expenseType', ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="Necessario">Necessaria</option>
                      <option value="Desiderio">Desiderio</option>
                      <option value="Investimento">Investimento</option>
                    </select>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.upload-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.upload { display: flex; flex-direction: column; gap: 6px; padding: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; }
.upload:hover { border-color: var(--accent); }
.upload__title { font-weight: 650; }
.upload__file { color: var(--accent-strong); font-size: 0.85rem; overflow-wrap: anywhere; }
.account { display: flex; align-items: center; gap: 10px; margin-top: var(--space-3); }
.account select { width: min(100%, 260px); }
.issues { margin-top: var(--space-3); max-height: 180px; overflow: auto; }
.issues p { margin: 4px 0; }
.error { margin-top: var(--space-3); color: var(--negative); }
.summary { display: flex; flex-direction: column; gap: 4px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); color: var(--text-secondary); font-size: 0.84rem; }
.summary strong { color: var(--text-primary); font-size: 1.45rem; line-height: 1.2; }
.summary--alert strong { color: var(--negative); }
.recon__scroll { overflow-x: auto; }
.recon { min-width: 720px; }
.recon th, .recon td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; font-size: 0.86rem; }
.recon th { color: var(--text-muted); font-weight: 550; font-size: 0.78rem; }
.recon .num { white-space: nowrap; text-align: right; }
.recon p { margin-top: 3px; }
.recon__note { padding: 0 22px 10px; }
.category-select { display: block; width: 180px; margin-bottom: 5px; }
@media (max-width: 640px) {
  .upload-grid { grid-template-columns: 1fr; }
  .account { align-items: flex-start; flex-direction: column; }
}
</style>
