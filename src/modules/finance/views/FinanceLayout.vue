<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatDateTime } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { financeTabs } from '../routes'

const store = useFinanceStore()
const ledger = useLedgerStore()
const router = useRouter()
const route = useRoute()
/** Scheda attiva: la sezione (anche annidata) corrente; «Mese» solo sulla propria pagina. */
const isTabOn = (name: string) => (name === 'finance-month' ? route.name === name : route.matched.some((r) => r.name === name))
onMounted(() => store.init())

const syncLabel = computed(() => {
  if (store.syncing) return 'Sincronizzazione…'
  if (!store.lastSyncAt) return 'Mai sincronizzato'
  return `${store.source === 'demo' ? 'Demo caricata' : 'Aggiornato'} ${formatDateTime(store.lastSyncAt)}`
})

/** Stato del salvataggio sul foglio delle modifiche fatte nell'app. */
const cloudChip = computed(() => {
  if (store.source === 'demo') return null
  const pending = ledger.pendingCount()
  const c = store.cloud
  if (c.state === 'saving') return { tone: 'busy', text: 'Salvataggio sul foglio…' }
  if (c.state === 'error' || c.state === 'needs-token') return { tone: 'error', text: pending ? `${pending} modifiche non salvate sul foglio` : 'Salvataggio sul foglio non riuscito' }
  if (pending) return { tone: 'busy', text: `${pending} modifiche in attesa di salvataggio` }
  if (c.state === 'saved') return { tone: 'ok', text: 'Tutto salvato sul foglio Google' }
  return null
})
</script>

<template>
  <div class="fin">
    <header class="fin__head">
      <div class="fin__title">
        <h1>Finanze personali</h1>
        <p class="fin__meta muted small">
          <template v-if="store.source === 'sheets'"><UiIcon name="sheet" :size="13" class="fin__src" /> {{ store.spreadsheetTitle ?? 'Google Sheets' }} · </template>
          {{ syncLabel }}
          <span v-if="cloudChip" class="fin__cloud" :class="`fin__cloud--${cloudChip.tone}`" role="status">{{ cloudChip.text }}</span>
        </p>
      </div>
      <div class="row">
        <UiButton
          v-if="store.errorCount || store.warningCount"
          size="sm"
          variant="ghost"
          icon="alert"
          @click="router.push({ name: 'finance-import' })"
        >
          {{ store.errorCount }} errori · {{ store.warningCount }} avvisi
        </UiButton>
        <UiButton variant="primary" icon="refresh" :loading="store.syncing" @click="store.sync()">Sincronizza</UiButton>
      </div>
    </header>

    <nav class="fin__tabs" aria-label="Sezioni finanze">
      <RouterLink v-for="t in financeTabs" :key="t.name" :to="{ name: t.name }" class="fin__tab" :class="{ 'fin__tab--on': isTabOn(t.name) }" :aria-current="isTabOn(t.name) ? 'page' : undefined" active-class="" exact-active-class="">
        <UiIcon :name="t.icon" :size="16" />
        {{ t.label }}
      </RouterLink>
    </nav>

    <UiAlert v-if="store.source === 'demo'" tone="info" title="Stai vedendo dati dimostrativi">
      Collega il tuo Google Sheet configurando le variabili d'ambiente sul server, poi premi Sincronizza.
      <template #actions>
        <UiButton size="sm" @click="router.push({ name: 'finance-import' })">Configura</UiButton>
      </template>
    </UiAlert>
    <UiAlert v-if="store.blockingError" tone="critical" title="Sincronizzazione non riuscita">
      {{ store.blockingError.message }}
      <span v-if="store.dataset"> Stai vedendo gli ultimi dati salvati.</span>
      <template v-if="store.blockingError.code === 'unauthorized'" #actions>
        <UiButton size="sm" icon="lock" @click="router.push({ name: 'finance-import' })">Inserisci token</UiButton>
      </template>
    </UiAlert>

    <UiAlert v-if="store.cloud.state === 'error' || store.cloud.state === 'needs-token'" tone="warning" title="Le modifiche non sono ancora sul foglio Google">
      {{ store.cloud.message }} Restano salvate in questo browser e verranno inviate alla prossima sincronizzazione.
      <template #actions>
        <UiButton v-if="store.cloud.state === 'needs-token'" size="sm" icon="lock" @click="router.push({ name: 'finance-import' })">Inserisci token</UiButton>
        <UiButton v-else size="sm" icon="refresh" :loading="store.syncing" @click="store.sync()">Riprova</UiButton>
      </template>
    </UiAlert>

    <UiAlert v-if="!store.rawDataset && !store.syncing" tone="info" title="Nessun dato sincronizzato">
      Puoi già inserire voci a mano: verranno salvate sul Google Sheet alla prima sincronizzazione.
      <template #actions>
        <UiButton size="sm" icon="refresh" @click="store.sync()">Sincronizza</UiButton>
        <UiButton size="sm" variant="ghost" @click="store.loadDemo()">Carica demo</UiButton>
      </template>
    </UiAlert>
    <UiAlert v-if="ledger.saveFailed" tone="critical" title="Salvataggio locale non riuscito">
      Il browser non permette di salvare i dati (spazio pieno o modalità privata): le ultime modifiche andranno perse alla chiusura.
    </UiAlert>

    <RouterView />
  </div>
</template>

<style scoped>
.fin__cloud { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; padding: 1px 9px; border-radius: 999px; font-size: 0.74rem; }
.fin__cloud::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.fin__cloud--ok { background: var(--good-soft); color: var(--positive); }
.fin__cloud--busy { background: var(--brand-soft); color: var(--accent); }
.fin__cloud--error { background: var(--warning-soft); color: var(--status-warning); }
.fin { display: flex; flex-direction: column; gap: 20px; }
.fin__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.fin__title { display: flex; flex-direction: column; gap: 5px; }
.fin__meta { display: flex; align-items: center; gap: 5px; }
.fin__src { vertical-align: -2px; }
.fin__tabs {
  display: flex;
  gap: 4px;
  padding: 5px;
  border-radius: 999px;
  background: var(--surface);
  align-self: flex-start;
  overflow-x: auto;
  scrollbar-width: none;
  max-width: 100%;
}
.fin__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-weight: 500;
  font-size: 0.88rem;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.fin__tab:hover { color: var(--text-primary); text-decoration: none; }
.fin__tab--on { color: var(--on-brand); background: var(--brand); font-weight: 600; }
@media (max-width: 600px) {
  .fin__tab { padding: 8px 10px; }
  .fin__head { align-items: flex-start; }
}
</style>
