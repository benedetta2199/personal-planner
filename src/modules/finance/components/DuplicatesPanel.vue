<script setup lang="ts">
/**
 * Controllo dei movimenti doppi (stessa data e stesso importo).
 * L'elenco è ricalcolato dai dati attuali: dopo ogni eliminazione (e risincronizzazione del foglio)
 * si lavora sempre sulle righe aggiornate, anche se i numeri di riga cambiano.
 */
import { computed, ref } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { confirmDialog } from '@/core/ui/confirm'
import { formatDate, formatMoney } from '@/core/utils/format'
import { readJson, writeJson } from '@/core/utils/storage'
import { duplicateKey, findDuplicateGroups, ignoreKey, type DuplicateGroup, type Operation } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { plainName } from '../presentation'

const store = useFinanceStore()
const ledger = useLedgerStore()

const IGNORE_KEY = 'gp.finance.duplicates.ignored'
const ignored = ref(new Set(readJson<string[]>(IGNORE_KEY) ?? []))

const checked = ref(false)
const busy = ref<string | null>(null)
const error = ref<string | null>(null)
const done = ref<string | null>(null)

const groups = computed(() => (checked.value ? findDuplicateGroups(store.dataset.operations, ignored.value) : []))
const extraRows = computed(() => groups.value.reduce((n, g) => n + g.operations.length - 1, 0))

const KIND_LABEL: Record<Operation['kind'], string> = { expense: 'Uscita', income: 'Entrata', transfer: 'Trasferimento' }

function check() {
  error.value = null
  done.value = null
  checked.value = true
}

function sourceLabel(op: Operation) {
  return ledger.isManual(op.id) ? "Inserita dall'app" : `Foglio ${op.source.sheet}, riga ${op.source.row}`
}
/** Categoria e sotto-categoria (uguali in tutto il gruppo): mostrate nell'intestazione. */
function categoryLabel(op: Operation) {
  return [plainName(op.category), op.subcategory && plainName(op.subcategory)].filter(Boolean).join(' › ')
}
function where(op: Operation) {
  return op.kind === 'transfer' ? `${op.account} → ${op.toAccount}` : op.account
}
function opSummary(op: Operation) {
  return `${formatDate(op.date)} · ${formatMoney(op.amount, op.currency)}${op.description ? ` · ${op.description}` : ''}\n${sourceLabel(op)}`
}

async function removeOne(op: Operation) {
  const ok = await confirmDialog({ title: 'Eliminare questa riga?', message: `${opSummary(op)}\n\nL'operazione non si può annullare.`, confirmLabel: 'Elimina', danger: true })
  if (!ok) return
  busy.value = op.id
  error.value = null
  done.value = null
  try {
    await store.deleteOperation(op)
    done.value = 'Riga eliminata.'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = null
  }
}

/** Tiene la prima riga del gruppo ed elimina le altre, una alla volta, rileggendo i dati dopo ognuna. */
async function keepFirst(g: DuplicateGroup) {
  const others = g.operations.length - 1
  const ok = await confirmDialog({
    title: 'Eliminare i doppioni?',
    message: `${KIND_LABEL[g.kind]} del ${formatDate(g.date)} da ${formatMoney(g.amount, g.currency)}.\n\nSi tiene la prima riga e si eliminano le altre ${others}. L'operazione non si può annullare.`,
    confirmLabel: `Elimina ${others}`,
    danger: true,
  })
  if (!ok) return
  busy.value = g.key
  error.value = null
  done.value = null
  let removed = 0
  try {
    // Limite di sicurezza: al massimo tante eliminazioni quanti erano i doppioni.
    for (let n = 0; n < others; n++) {
      const current = store.dataset.operations.filter((o) => duplicateKey(o) === g.key)
      // Dal fondo: eliminare le righe più basse del foglio non sposta quelle sopra.
      const victim = current.slice(1).filter((o) => store.canEdit(o)).sort((a, b) => b.source.row - a.source.row)[0]
      if (!victim) break
      await store.deleteOperation(victim)
      removed++
    }
    const left = store.dataset.operations.filter((o) => duplicateKey(o) === g.key).length
    done.value = `${removed} ${removed === 1 ? 'riga eliminata' : 'righe eliminate'}.${left > 1 ? ` ${left - 1} non si possono eliminare dall'app.` : ''}`
  } catch (e) {
    error.value = `${removed ? `${removed} eliminate, poi: ` : ''}${(e as Error).message}`
  } finally {
    busy.value = null
  }
}

function ignore(g: DuplicateGroup) {
  ignored.value = new Set([...ignored.value, ignoreKey(g.operations)])
  writeJson(IGNORE_KEY, [...ignored.value])
}
function resetIgnored() {
  ignored.value = new Set()
  writeJson(IGNORE_KEY, [])
}
</script>

<template>
  <div class="dup">
    <div class="row">
      <UiButton icon="search" :disabled="!!busy" @click="check">{{ checked ? 'Controlla di nuovo' : 'Cerca righe duplicate' }}</UiButton>
      <span class="muted small">Stessa data, importo, categoria e sotto-categoria (e stesso tipo di movimento).</span>
    </div>

    <UiAlert v-if="error" tone="critical">{{ error }}</UiAlert>
    <UiAlert v-else-if="done" tone="info">{{ done }}</UiAlert>

    <template v-if="checked">
      <p v-if="!groups.length" class="dup__none">
        ✓ Nessuna riga duplicata.
        <button v-if="ignored.size" type="button" class="link" @click="resetIgnored">Mostra anche i {{ ignored.size }} gruppi ignorati</button>
      </p>
      <template v-else>
        <p class="secondary small">
          {{ groups.length }} {{ groups.length === 1 ? 'gruppo' : 'gruppi' }} di righe uguali, {{ extraRows }} {{ extraRows === 1 ? 'possibile doppione' : 'possibili doppioni' }}.
        </p>
        <article v-for="g in groups" :key="g.key" class="dup__group" :aria-busy="busy === g.key">
          <header class="dup__head">
            <strong class="num">{{ formatMoney(g.amount, g.currency) }}</strong>
            <span class="muted">{{ KIND_LABEL[g.kind] }} · {{ formatDate(g.date) }}<template v-if="g.operations[0].category"> · {{ categoryLabel(g.operations[0]) }}</template></span>
          </header>
          <ul class="dup__list">
            <li v-for="(op, i) in g.operations" :key="op.id" class="dup__op">
              <div class="dup__info">
                <span class="dup__desc">{{ op.description || 'Senza descrizione' }}<em v-if="i === 0" class="dup__keep">prima</em></span>
                <span class="muted small">{{ where(op) }} · {{ sourceLabel(op) }}</span>
              </div>
              <UiButton
                size="sm"
                variant="ghost"
                icon="trash"
                class="danger"
                :aria-label="`Elimina ${op.description || 'riga'}`"
                :title="store.canEdit(op) ? 'Elimina questa riga' : 'Questa riga non si può eliminare dall\'app'"
                :disabled="!!busy || !store.canEdit(op)"
                :loading="busy === op.id"
                @click="removeOne(op)"
              />
            </li>
          </ul>
          <footer class="row dup__actions">
            <UiButton size="sm" variant="ghost" :disabled="!!busy" @click="ignore(g)">Non sono doppioni</UiButton>
            <UiButton size="sm" icon="trash" class="danger" :disabled="!!busy" :loading="busy === g.key" @click="keepFirst(g)">Tieni la prima, elimina le altre</UiButton>
          </footer>
        </article>
      </template>
    </template>
  </div>
</template>

<style scoped>
.dup { display: flex; flex-direction: column; gap: 12px; }
.dup__none { margin: 0; color: var(--text-secondary); }
.dup__group { border: 1px solid var(--border); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.dup__group[aria-busy='true'] { opacity: 0.7; }
.dup__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.dup__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.dup__op { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--border); }
.dup__op:first-child { border-top: 0; }
.dup__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dup__desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dup__keep { margin-left: 8px; font-style: normal; font-size: 0.72rem; padding: 1px 7px; border-radius: 999px; background: var(--brand-soft); color: var(--text-secondary); }
.dup__actions { justify-content: flex-end; }
.danger { color: var(--negative); }
.link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
</style>
