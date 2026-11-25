<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatDate, formatDateTime, formatMoney } from '@/core/utils/format'
import { readJson, writeJson } from '@/core/utils/storage'
import {
  reconcileStatements,
  suggestAccount,
  suggestEntry,
  type FileIssue,
  type LedgerSide,
  type ReconciliationItem,
  type ReconciliationStatus,
  type StatementProvider,
  type StatementRow,
} from '../domain/reconciliation'
import type { Operation } from '../domain'
import { readStatementFile } from '../data/localFiles'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore, type EntryDraft, type EntryPrefill } from '../store/ledgerStore'
import EntryDialog from '../components/EntryDialog.vue'

const store = useFinanceStore()
const ledger = useLedgerStore()

// ---- Estratti caricati (solo in memoria: non lasciano il browser) -----------------
interface LoadedFile {
  name: string
  provider: StatementProvider | null
  rows: StatementRow[]
  issues: FileIssue[]
}
const files = ref<LoadedFile[]>([])
const reading = ref(false)
const readError = ref('')

const PROVIDER_LABEL: Record<StatementProvider, string> = {
  revolut: 'Revolut',
  'revolut-savings': 'Revolut · depositi',
  'trade-republic': 'Trade Republic',
  satispay: 'Satispay',
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const list = [...(input.files ?? [])]
  input.value = ''
  if (!list.length) return
  reading.value = true
  readError.value = ''
  try {
    const parsed = await Promise.all(list.map(readStatementFile))
    // Ricaricare lo stesso file lo sostituisce.
    const names = new Set(parsed.map((p) => p.fileName))
    files.value = [...files.value.filter((f) => !names.has(f.name)), ...parsed.map((p) => ({ name: p.fileName, provider: p.provider, rows: p.records, issues: p.issues }))]
  } catch (e) {
    readError.value = (e as Error).message
  } finally {
    reading.value = false
  }
}
const removeFile = (name: string) => (files.value = files.value.filter((f) => f.name !== name))

// ---- Associazione conto dell'estratto → conto dell'app ----------------------------
const IGNORE = ''
const mapping = reactive<Record<string, string>>({})
const accountChoices = computed(() => {
  const list = ledger.state.config.accounts.map((a) => ({ name: a.name, aliases: a.aliases }))
  for (const name of store.accountNames) if (!list.some((a) => a.name === name)) list.push({ name, aliases: [] })
  return list
})
const labels = computed(() => [...new Set(files.value.flatMap((f) => f.rows.map((r) => r.account)))])
watch(
  labels,
  (list) => {
    for (const label of list) if (!(label in mapping)) mapping[label] = suggestAccount(label, accountChoices.value)
  },
  { immediate: true },
)

// ---- Confronto ---------------------------------------------------------------
/** Come il notebook: si confronta dal primo movimento del foglio in poi. */
const since = computed(() => store.operations[0]?.date)
const statementRows = computed(() =>
  files.value.flatMap((f) => f.rows).filter((r) => mapping[r.account]).map((r) => ({ ...r, account: mapping[r.account] })),
)
const skippedBefore = computed(() => (since.value ? statementRows.value.filter((r) => r.date < since.value!).length : 0))
const items = computed(() => reconcileStatements(store.operations, statementRows.value, { since: since.value }))

const IGNORED_KEY = 'gp.finance.recon.ignored.v1'
const ignored = ref(new Set(readJson<string[]>(IGNORED_KEY) ?? []))
function toggleIgnore(item: ReconciliationItem) {
  const next = new Set(ignored.value)
  if (next.has(item.key)) next.delete(item.key)
  else next.add(item.key)
  ignored.value = next
  writeJson(IGNORED_KEY, [...next])
}

const ISSUE_STATUSES: ReconciliationStatus[] = ['amount_mismatch', 'missing_in_general', 'missing_in_statement', 'duplicate']
type View = 'issues' | 'dates' | 'matched' | 'ignored'
const view = ref<View>('issues')
const active = computed(() => items.value.filter((i) => !ignored.value.has(i.key)))
const groups = computed<Record<View, ReconciliationItem[]>>(() => ({
  issues: active.value.filter((i) => ISSUE_STATUSES.includes(i.status)),
  dates: active.value.filter((i) => i.status === 'date_mismatch'),
  matched: active.value.filter((i) => i.status === 'matched' || i.status === 'matched_group'),
  ignored: items.value.filter((i) => ignored.value.has(i.key)),
}))
const viewOptions = computed(() => [
  { value: 'issues' as const, label: `Da sistemare · ${groups.value.issues.length}` },
  { value: 'dates' as const, label: `Date sfasate · ${groups.value.dates.length}` },
  { value: 'matched' as const, label: `Corrispondenti · ${groups.value.matched.length}` },
  { value: 'ignored' as const, label: `Ignorate · ${groups.value.ignored.length}` },
])
const count = (s: ReconciliationStatus) => active.value.filter((i) => i.status === s).length

const STATUS: Record<ReconciliationStatus, { label: string; tone: 'good' | 'warning' | 'critical' | 'neutral' }> = {
  matched: { label: 'Corrisponde', tone: 'good' },
  matched_group: { label: 'Corrisponde (somma)', tone: 'good' },
  date_mismatch: { label: 'Data diversa', tone: 'warning' },
  amount_mismatch: { label: 'Importo diverso', tone: 'critical' },
  duplicate: { label: 'Duplicato', tone: 'warning' },
  missing_in_general: { label: 'Manca nel foglio', tone: 'critical' },
  missing_in_statement: { label: 'Manca nell’estratto', tone: 'warning' },
}

// ---- Scrittura sul foglio -------------------------------------------------------
const writable = computed(() => store.source === 'sheets' && !!store.accessToken)
const busyKey = ref<string | null>(null)
const actionError = ref('')

const signed = (amount: number, direction: 'in' | 'out') => (direction === 'out' ? -amount : amount)
const origin = (op: Operation) => (ledger.isManual(op.id) ? 'voce dell’app' : `${op.source.sheet}, riga ${op.source.row}`)

function draftOf(op: Operation, patch: Partial<{ date: string; amount: number }> = {}): EntryDraft {
  const common = { date: op.date, account: op.account, category: op.category, subcategory: op.subcategory, description: op.description, amount: op.amount, currency: op.currency, ...patch }
  if (op.kind === 'expense') return { ...common, kind: 'expense', expenseType: op.expenseType }
  if (op.kind === 'income') return { ...common, kind: 'income' }
  return { ...common, kind: 'transfer', toAccount: op.toAccount }
}

/** Correzione rapida solo se non tocca conversioni di valuta. */
const canFixAmount = (side: LedgerSide) => side.op.kind !== 'transfer' || (side.op.toCurrency === side.op.currency && side.op.toAmount === side.op.amount)

async function run(item: ReconciliationItem, action: () => Promise<void> | void) {
  busyKey.value = item.key
  actionError.value = ''
  try {
    await action()
  } catch (e) {
    actionError.value = (e as Error).message
  } finally {
    busyKey.value = null
  }
}

const useStatementDate = (item: ReconciliationItem) => run(item, () => store.editOperation(item.sides[0].op, draftOf(item.sides[0].op, { date: item.statements[0].date })))
const useStatementAmount = (item: ReconciliationItem) => run(item, () => store.editOperation(item.sides[0].op, draftOf(item.sides[0].op, { amount: item.statements[0].amount })))
function removeFromSheet(item: ReconciliationItem) {
  const op = item.sides[0].op
  const what = `${formatDate(op.date)} · ${formatMoney(op.amount, op.currency)}${op.description ? ` · ${op.description}` : ''}`
  if (!window.confirm(`Eliminare dal foglio Google questo movimento?\n\n${what}`)) return
  void run(item, () => store.deleteOperation(op))
}

// ---- Finestra di inserimento/modifica -------------------------------------------
/** Conto bancario da cui partono le ricariche Satispay: il conto «Conto» (anche se rinominato, tramite alias). */
const bankAccount = computed(() => accountChoices.value.find((a) => [a.name, ...a.aliases].some((n) => n.trim().toLowerCase() === 'conto'))?.name ?? 'Conto')
const dialog = reactive<{ open: boolean; operation: Operation | null; prefill: EntryPrefill | null }>({ open: false, operation: null, prefill: null })
function addFromStatement(item: ReconciliationItem) {
  const s = item.statements[0]
  const suggestion = suggestEntry(s, store.operations, { bankAccount: bankAccount.value })
  dialog.operation = null
  dialog.prefill = { ...suggestion, toAccount: suggestion.toAccount || undefined, account: suggestion.account || undefined }
  dialog.open = true
}
function edit(op: Operation) {
  dialog.prefill = null
  dialog.operation = op
  dialog.open = true
}
</script>

<template>
  <div class="stack">
    <UiCard
      title="Confronta un estratto conto con il foglio"
      subtitle="Carica l'estratto scaricato dall'app della banca: viene confrontato con i movimenti del foglio Google. Il file resta in questo browser, non viene caricato sul server."
    >
      <UiAlert v-if="store.source !== 'sheets'" tone="warning" class="mb">
        Il confronto usa i movimenti del foglio Google: collega il foglio (Gestione → Dati e backup) per poter anche correggere le differenze.
      </UiAlert>
      <UiAlert v-else-if="!store.accessToken" tone="info" class="mb">Accedi per poter aggiungere, correggere o eliminare i movimenti direttamente sul foglio.</UiAlert>

      <label class="upload">
        <span class="upload__title">Estratti conto</span>
        <span class="muted small">CSV di Revolut (movimenti o depositi), CSV di Trade Republic, XLSX di Satispay. Puoi caricarne più di uno.</span>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx" multiple @change="onFiles" />
      </label>
      <p v-if="reading" class="muted small mt" role="status">Lettura dei file…</p>
      <UiAlert v-if="readError" tone="critical" class="mt">{{ readError }}</UiAlert>

      <ul v-if="files.length" class="files">
        <li v-for="f in files" :key="f.name" class="files__item">
          <div>
            <strong>{{ f.name }}</strong>
            <span class="muted small"> · {{ f.provider ? PROVIDER_LABEL[f.provider] : 'formato non riconosciuto' }} · {{ f.rows.length }} operazioni</span>
            <p v-for="(issue, i) in f.issues.slice(0, 5)" :key="i" class="small" :class="issue.severity === 'error' ? 'neg' : 'muted'">
              <template v-if="issue.row">Riga {{ issue.row }}: </template>{{ issue.message }}
            </p>
            <p v-if="f.issues.length > 5" class="muted small">Altre {{ f.issues.length - 5 }} segnalazioni.</p>
          </div>
          <UiButton size="sm" variant="ghost" icon="close" @click="removeFile(f.name)">Rimuovi</UiButton>
        </li>
      </ul>

      <div v-if="labels.length" class="map">
        <p class="small secondary">Conto del foglio a cui corrisponde ogni conto dell'estratto:</p>
        <label v-for="label in labels" :key="label" class="map__row">
          <span>{{ label }}</span>
          <select v-model="mapping[label]" class="input">
            <option :value="IGNORE">Non confrontare</option>
            <option v-for="a in accountChoices" :key="a.name" :value="a.name">{{ a.name }}</option>
          </select>
        </label>
      </div>
      <p v-if="skippedBefore" class="muted small mt">
        {{ skippedBefore }} operazioni precedenti al primo movimento del foglio ({{ formatDate(since!) }}) non vengono confrontate.
      </p>
    </UiCard>

    <template v-if="statementRows.length">
      <section class="grid grid-kpi" aria-label="Riepilogo">
        <div class="summary"><span>Corrispondono</span><strong>{{ groups.matched.length }}</strong></div>
        <div class="summary" :class="{ 'summary--alert': count('amount_mismatch') }"><span>Importo diverso</span><strong>{{ count('amount_mismatch') }}</strong></div>
        <div class="summary" :class="{ 'summary--alert': count('missing_in_general') }"><span>Mancano nel foglio</span><strong>{{ count('missing_in_general') }}</strong></div>
        <div class="summary" :class="{ 'summary--alert': count('missing_in_statement') }"><span>Mancano nell’estratto</span><strong>{{ count('missing_in_statement') }}</strong></div>
      </section>

      <UiCard flush>
        <div class="toolbar">
          <UiSegmented v-model="view" :options="viewOptions" label="Righe da mostrare" />
          <span v-if="store.syncing" class="muted small" role="status">Aggiornamento dal foglio…</span>
          <span v-else-if="store.lastSyncAt" class="muted small">Foglio letto {{ formatDateTime(store.lastSyncAt) }}</span>
        </div>
        <UiAlert v-if="actionError" tone="critical" class="recon__alert">{{ actionError }}</UiAlert>
        <UiAlert v-if="store.cloud.state === 'error'" tone="warning" class="recon__alert">Salvataggio sul foglio non riuscito: {{ store.cloud.message }}</UiAlert>

        <p v-if="!groups[view].length" class="muted recon__empty">
          {{ view === 'issues' ? 'Nessuna differenza da sistemare.' : 'Nessuna riga.' }}
        </p>
        <div v-else class="recon__scroll">
          <table class="recon">
            <thead>
              <tr><th>Esito</th><th>Estratto conto</th><th>Foglio</th><th class="recon__actions-h">Azioni</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in groups[view]" :key="item.key" :aria-busy="busyKey === item.key || undefined">
                <td>
                  <UiBadge :tone="STATUS[item.status].tone">{{ STATUS[item.status].label }}</UiBadge>
                  <p v-if="item.amountDifference" class="small neg">Δ {{ formatMoney(item.amountDifference, item.statements[0]?.currency ?? 'EUR', { sign: true }) }}</p>
                  <p v-if="item.dateDifference" class="small muted">{{ item.dateDifference > 0 ? '+' : '' }}{{ item.dateDifference }} gg</p>
                </td>
                <td>
                  <div v-for="s in item.statements" :key="s.id" class="line">
                    <span class="line__date">{{ formatDate(s.date) }}</span>
                    <span class="line__desc">{{ s.description || '—' }}<span class="muted small"> · {{ s.account }}</span></span>
                    <span class="num" :class="{ pos: s.direction === 'in' }">{{ formatMoney(signed(s.amount, s.direction), s.currency) }}</span>
                  </div>
                  <span v-if="!item.statements.length" class="muted">—</span>
                </td>
                <td>
                  <div v-for="l in item.sides" :key="`${l.op.id}|${l.direction}`" class="line">
                    <span class="line__date">{{ formatDate(l.op.date) }}</span>
                    <span class="line__desc">
                      <button type="button" class="link" :title="`Apri il movimento (${origin(l.op)})`" @click="edit(l.op)">
                        {{ l.op.description || (l.op.kind === 'transfer' ? `${l.op.account} → ${l.op.toAccount}` : l.op.category) || '—' }}
                      </button>
                      <span class="muted small"> · {{ l.op.kind === 'transfer' ? 'trasferimento' : l.op.category }} · {{ origin(l.op) }}</span>
                    </span>
                    <span class="num" :class="{ pos: l.direction === 'in' }">{{ formatMoney(signed(l.amount, l.direction), l.currency) }}</span>
                  </div>
                  <span v-if="!item.sides.length" class="muted">—</span>
                </td>
                <td class="recon__actions">
                  <template v-if="item.status === 'missing_in_general'">
                    <UiButton size="sm" variant="primary" icon="plus" :disabled="!writable" @click="addFromStatement(item)">Aggiungi al foglio</UiButton>
                  </template>
                  <template v-else-if="item.status === 'amount_mismatch'">
                    <UiButton
                      size="sm"
                      variant="primary"
                      :disabled="!writable || !canFixAmount(item.sides[0])"
                      :loading="busyKey === item.key"
                      @click="useStatementAmount(item)"
                    >
                      Usa {{ formatMoney(item.statements[0].amount, item.statements[0].currency) }}
                    </UiButton>
                    <UiButton size="sm" icon="edit" :disabled="!writable" @click="edit(item.sides[0].op)">Modifica</UiButton>
                  </template>
                  <template v-else-if="item.status === 'date_mismatch'">
                    <UiButton size="sm" variant="primary" :disabled="!writable" :loading="busyKey === item.key" @click="useStatementDate(item)">
                      Usa data {{ formatDate(item.statements[0].date) }}
                    </UiButton>
                  </template>
                  <template v-else-if="item.status === 'missing_in_statement'">
                    <UiButton size="sm" icon="edit" :disabled="!writable" @click="edit(item.sides[0].op)">Modifica</UiButton>
                    <UiButton size="sm" variant="ghost" icon="trash" class="danger" :disabled="!writable" :loading="busyKey === item.key" @click="removeFromSheet(item)">Elimina</UiButton>
                  </template>
                  <UiButton v-if="!item.status.startsWith('matched')" size="sm" variant="ghost" @click="toggleIgnore(item)">
                    {{ ignored.has(item.key) ? 'Ripristina' : 'Ignora' }}
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small recon__note">
          «Ignora» nasconde una differenza nota solo in questo browser. Le righe scritte a mano nel foglio, una volta corrette dall'app, ricevono un ID nella colonna «ID» e diventano voci dell'app.
        </p>
      </UiCard>
    </template>

    <EntryDialog :open="dialog.open" :operation="dialog.operation" :prefill="dialog.prefill" edit-sheet-rows @close="dialog.open = false" />
  </div>
</template>

<style scoped>
.mb { margin-bottom: var(--space-3); }
.mt { margin-top: var(--space-3); }
.upload { display: flex; flex-direction: column; gap: 6px; padding: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--surface-2); cursor: pointer; }
.upload:hover { border-color: var(--accent); }
.upload__title { font-weight: 650; }
.files { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.files__item { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); overflow-wrap: anywhere; }
.files__item p { margin: 3px 0 0; }
.map { margin-top: var(--space-3); display: flex; flex-direction: column; gap: 8px; }
.map__row { display: flex; align-items: center; gap: 12px; }
.map__row > span { min-width: 140px; font-weight: 550; }
.map__row select { width: min(100%, 280px); }
.neg { color: var(--negative); }
.pos { color: var(--positive); }
.summary { display: flex; flex-direction: column; gap: 4px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); color: var(--text-secondary); font-size: 0.84rem; }
.summary strong { color: var(--text-primary); font-size: 1.45rem; line-height: 1.2; }
.summary--alert strong { color: var(--negative); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 22px; }
.recon__alert { margin: 0 22px 12px; }
.recon__empty { padding: 18px 22px; }
.recon__scroll { overflow-x: auto; }
.recon { width: 100%; min-width: 860px; border-collapse: collapse; }
.recon th, .recon td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; font-size: 0.86rem; }
.recon th { color: var(--text-muted); font-weight: 550; font-size: 0.78rem; }
.recon tr[aria-busy] { opacity: 0.6; }
.recon p { margin: 3px 0 0; }
.recon__actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 210px; }
.recon__actions-h { min-width: 210px; }
.recon__note { padding: 12px 22px; }
.line { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; }
.line + .line { margin-top: 4px; }
.line__date { color: var(--text-secondary); white-space: nowrap; }
.line__desc { min-width: 0; overflow-wrap: anywhere; }
.num { white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.link { border: 0; background: none; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
.link:hover { text-decoration-color: currentColor; }
.danger { color: var(--negative); }
@media (max-width: 640px) {
  .map__row { flex-direction: column; align-items: flex-start; gap: 4px; }
}
</style>
