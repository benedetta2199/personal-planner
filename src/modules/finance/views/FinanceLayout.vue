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
import { useAuthStore } from '@/app/auth/authStore'

const store = useFinanceStore()
const ledger = useLedgerStore()
const router = useRouter()
const route = useRoute()
/** Scheda attiva: la sezione (anche annidata) corrente; «Mese» solo sulla propria pagina. */
const isTabOn = (name: string) => (name === 'finance-month' ? route.name === name : route.matched.some((r) => r.name === name))
onMounted(() => store.init())

/** Token rifiutato dal server: si esce e si torna al login. */
const auth = useAuthStore()
function relogin() {
  auth.logout()
  void router.replace({ name: 'login', query: { redirect: route.fullPath } })
}

const syncLabel = computed(() => {
  if (store.syncing) return 'Sincronizzazione…'
  if (!store.lastSyncAt) return 'Mai sincronizzato'
  return `${store.source === 'demo' ? 'Demo caricata' : 'Aggiornato'} ${formatDateTime(store.lastSyncAt)}`
})

/** Versione breve per mobile: solo l'ora se l'aggiornamento è di oggi. */
const syncShort = computed(() => {
  if (store.syncing) return 'Sincronizzo…'
  if (!store.lastSyncAt) return 'Mai sincronizzato'
  const d = new Date(store.lastSyncAt)
  const sameDay = d.toDateString() === new Date().toDateString()
  const when = sameDay
    ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(d)
  return `${store.source === 'demo' ? 'Demo' : 'Aggiornato'} ${when}`
})
const manageOn = computed(() => route.matched.some((r) => r.name === 'finance-manage'))

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
          <span class="fin__long">
            <template v-if="store.source === 'sheets'"><UiIcon name="sheet" :size="13" class="fin__src" /> {{ store.spreadsheetTitle ?? 'Google Sheets' }} · </template>
            {{ syncLabel }}
          </span>
          <span class="fin__short" :title="syncLabel">{{ syncShort }}</span>
          <span v-if="cloudChip" class="fin__cloud" :class="`fin__cloud--${cloudChip.tone}`" role="status" :title="cloudChip.text"><span class="fin__cloud-text">{{ cloudChip.text }}</span></span>
        </p>
      </div>
      <div class="fin__actions">
        <button
          v-if="store.errorCount || store.warningCount"
          type="button"
          class="fin__issues"
          :title="`${store.errorCount} errori · ${store.warningCount} avvisi`"
          @click="router.push({ name: 'finance-import' })"
        >
          <UiIcon name="alert" :size="15" />
          <span class="fin__long">{{ store.errorCount }} errori · {{ store.warningCount }} avvisi</span>
          <span class="fin__short num">{{ store.errorCount + store.warningCount }}</span>
        </button>
        <UiButton variant="primary" icon="refresh" :loading="store.syncing" title="Sincronizza con il Google Sheet" @click="store.sync()"><span class="fin__long">Sincronizza</span><span class="sr-only fin__sr">Sincronizza</span></UiButton>
      </div>
    </header>

    <div class="fin__navrow">
      <nav class="fin__tabs" aria-label="Sezioni finanze">
        <RouterLink v-for="t in financeTabs" :key="t.name" :to="{ name: t.name }" class="fin__tab" :class="{ 'fin__tab--on': isTabOn(t.name) }" :aria-current="isTabOn(t.name) ? 'page' : undefined" active-class="" exact-active-class="">
          <UiIcon :name="t.icon" :size="16" />
          {{ t.label }}
        </RouterLink>
      </nav>
      <RouterLink
        :to="{ name: 'finance-manage' }"
        class="fin__gear"
        :class="{ 'fin__gear--on': manageOn }"
        :aria-current="manageOn ? 'page' : undefined"
        title="Gestione: conti, categorie, importazione e backup"
        aria-label="Gestione"
        active-class=""
        exact-active-class=""
      >
        <UiIcon name="gear" :size="20" />
      </RouterLink>
    </div>

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
        <UiButton size="sm" icon="lock" @click="relogin">Accedi di nuovo</UiButton>
      </template>
    </UiAlert>

    <UiAlert v-if="store.cloud.state === 'error' || store.cloud.state === 'needs-token'" tone="warning" title="Le modifiche non sono ancora sul foglio Google">
      {{ store.cloud.message }} Restano salvate in questo browser e verranno inviate alla prossima sincronizzazione.
      <template #actions>
        <UiButton v-if="store.cloud.state === 'needs-token'" size="sm" icon="lock" @click="relogin">Accedi di nuovo</UiButton>
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
.fin__actions { display: flex; align-items: center; gap: 8px; flex: none; }
.fin__issues {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
  border: 0; border-radius: 999px; background: var(--warning-soft); color: var(--status-warning);
  font: inherit; font-size: 0.85rem; font-weight: 500; cursor: pointer;
}
.fin__issues:hover { background: color-mix(in srgb, var(--status-warning) 18%, var(--surface)); }
.fin__short { display: none; }
.fin__sr { display: none; }

/* Schede di sezione + ingranaggio della gestione */
.fin__navrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.fin__tabs {
  display: flex;
  gap: 4px;
  padding: 5px;
  border-radius: 999px;
  background: var(--surface);
  overflow-x: auto;
  scrollbar-width: none;
  min-width: 0;
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
  transition: background 0.15s ease, color 0.15s ease;
}
.fin__tab:hover { background: var(--brand-soft); color: var(--on-brand); text-decoration: none; }
.fin__tab--on, .fin__tab--on:hover { color: var(--brand); background: var(--ink); font-weight: 600; }
.fin__tab:focus-visible, .fin__gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.fin__gear {
  display: grid; place-items: center; flex: none; width: 46px; height: 46px; border-radius: 50%;
  background: var(--surface); color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.fin__gear :deep(svg) { transition: transform 0.25s ease; }
.fin__gear:hover { background: var(--brand-soft); color: var(--on-brand); text-decoration: none; }
.fin__gear:hover :deep(svg) { transform: rotate(45deg); }
.fin__gear--on, .fin__gear--on:hover { background: var(--ink); color: var(--brand); }

/* Mobile: intestazione compatta su una riga */
@media (max-width: 600px) {
  .fin { gap: 14px; }
  .fin__head { flex-wrap: nowrap; align-items: center; gap: 10px; }
  .fin__title { gap: 2px; min-width: 0; }
  .fin__title h1 { font-size: 1.35rem; }
  .fin__meta { font-size: 0.76rem; white-space: nowrap; min-width: 0; }
  .fin__long { display: none; }
  .fin__short { display: inline; }
  .fin__sr { display: block; }
  .fin__cloud { margin-left: 2px; padding: 0; background: none; }
  .fin__cloud::before { width: 8px; height: 8px; }
  .fin__cloud-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .fin__issues { padding: 0 10px; }
  .fin__actions :deep(.btn--primary) { width: 40px; padding: 0; gap: 0; }
  .fin__tab { padding: 8px 12px; }
  .fin__gear { width: 42px; height: 42px; }
}
@media (prefers-reduced-motion: reduce) { .fin__gear :deep(svg) { transition: none; } }
</style>
