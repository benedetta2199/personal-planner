<script setup lang="ts">
import { computed, ref } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatDateTime } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import ImportReport from '../components/ImportReport.vue'
import { ALL_SHEETS, SHEET_SCHEMAS, type SheetName } from '../domain'

const store = useFinanceStore()
const tokenDraft = ref(store.accessToken)
const showToken = computed(() => store.error?.code === 'unauthorized' || !!store.accessToken)
const sheetTab = ref<SheetName>('Uscite')

async function saveToken() {
  store.setAccessToken(tokenDraft.value)
  await store.sync()
}

const SHEET_NOTES: Record<SheetName, string> = {
  Entrate: 'Ogni riga aumenta la disponibilità del conto indicato.',
  Uscite: 'Ogni riga riduce il conto. La Tipologia separa spese necessarie, aggiuntive e investimenti (capitale che resta nel patrimonio).',
  Transazioni: 'Spostamenti tra conti: non sono né entrate né uscite. Verso un conto di investimento contano come capitale investito.',
  Conti: 'Facoltativo. Definisce tipo (Liquidità/Investimento), valuta, saldo iniziale e valore di mercato.',
  Valute: 'Facoltativo. Tassi verso la valuta base, necessari per sommare importi in valute diverse.',
}
</script>

<template>
  <div class="stack">
    <UiCard title="Sorgente dati" subtitle="Google Sheets è la fonte di verità: ogni sincronizzazione rilegge il documento e aggiorna i dati senza duplicati.">
      <dl class="src">
        <dt>Sorgente</dt>
        <dd>
          <UiBadge v-if="store.source === 'sheets'" tone="good">Google Sheets</UiBadge>
          <UiBadge v-else-if="store.source === 'demo'" tone="accent">Dati dimostrativi</UiBadge>
          <UiBadge v-else>Nessuna</UiBadge>
          <span v-if="store.spreadsheetTitle && store.source === 'sheets'"> {{ store.spreadsheetTitle }}</span>
        </dd>
        <dt>Ultimo aggiornamento</dt>
        <dd>{{ store.lastSyncAt ? formatDateTime(store.lastSyncAt) : '—' }}</dd>
        <template v-if="store.lastDiff">
          <dt>Ultima sincronizzazione</dt>
          <dd class="num">
            +{{ store.lastDiff.added }} nuovi · {{ store.lastDiff.updated }} modificati · −{{ store.lastDiff.removed }} rimossi ·
            {{ store.lastDiff.unchanged }} invariati
          </dd>
        </template>
        <template v-if="store.dataset">
          <dt>Contenuto</dt>
          <dd class="num">
            {{ store.dataset.operations.length }} movimenti · {{ store.dataset.accounts.length }} conti · {{ store.categories.length }} categorie · valuta base
            {{ store.dataset.baseCurrency }}
          </dd>
        </template>
      </dl>
      <div class="row src__actions">
        <UiButton variant="primary" icon="refresh" :loading="store.syncing" @click="store.sync()">Sincronizza da Google Sheets</UiButton>
        <UiButton @click="store.loadDemo()">Carica dati demo</UiButton>
        <UiButton v-if="store.dataset" variant="ghost" @click="store.clearData()">Svuota dati locali</UiButton>
      </div>

      <UiAlert v-if="store.error?.code === 'not_configured'" tone="warning" title="Google Sheets non ancora collegato" class="src__alert">
        {{ store.error.message }} Segui la guida qui sotto, poi premi Sincronizza.
      </UiAlert>
      <UiAlert v-else-if="store.error" tone="critical" title="Errore di sincronizzazione" class="src__alert">{{ store.error.message }}</UiAlert>

      <form v-if="showToken" class="token" @submit.prevent="saveToken">
        <label class="token__field">
          <span class="small secondary">Token di accesso all'API (APP_ACCESS_TOKEN)</span>
          <input v-model="tokenDraft" class="input" type="password" autocomplete="current-password" placeholder="Incolla il token" />
        </label>
        <UiButton type="submit" icon="lock">Salva e sincronizza</UiButton>
      </form>
      <p v-else class="muted small token__hint">
        Se hai impostato <code>APP_ACCESS_TOKEN</code> sul server, ti verrà chiesto alla prima sincronizzazione.
      </p>
    </UiCard>

    <UiCard v-if="store.stats.length" title="Esito dell'importazione" subtitle="Validazione di schema, tipi di dato, campi obbligatori e duplicati">
      <ImportReport :issues="store.issues" :stats="store.stats" />
    </UiCard>

    <UiCard title="Struttura del documento" subtitle="Nomi dei fogli e intestazioni attese (sono accettati alias comuni e colonne aggiuntive)">
      <UiSegmented v-model="sheetTab" label="Foglio" :options="ALL_SHEETS.map((s) => ({ value: s, label: s }))" />
      <p class="secondary small schema__note">{{ SHEET_NOTES[sheetTab] }}</p>
      <div class="schema__scroll">
        <table class="schema">
          <thead>
            <tr><th>Colonna</th><th>Obbligatoria</th><th>Contenuto</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in SHEET_SCHEMAS[sheetTab]" :key="f.key">
              <td><code>{{ f.label }}</code></td>
              <td>{{ f.requiredColumn ? 'Sì' : 'No' }}</td>
              <td class="secondary">{{ f.description }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small schema__note">
        Qualsiasi altra colonna viene importata come attributo aggiuntivo e mostrata nel dettaglio del movimento.
        Aggiungere una colonna <code>ID</code> rende gli aggiornamenti tracciabili anche quando modifichi una riga.
      </p>
    </UiCard>

    <UiCard title="Collegare Google Sheets" subtitle="Configurazione una tantum lato server">
      <ol class="guide">
        <li>
          <strong>Modo più semplice:</strong> nel foglio del bilancio apri <strong>Estensioni → Apps Script</strong>, incolla
          <code>docs/apps-script/Code.gs</code>, pubblicalo come <strong>App web</strong> (esegui come: Me, accesso: Chiunque) e imposta
          <code>APPS_SCRIPT_URL</code> e <code>APPS_SCRIPT_SECRET</code>. In questo caso puoi saltare i passaggi su service account e OAuth.
        </li>
        <li>In alternativa, in Google Cloud Console crea un progetto, abilita <strong>Google Sheets API</strong> e crea un <strong>service account</strong> con una chiave JSON.</li>
        <li>Condividi il documento finanziario con l'email del service account con ruolo <strong>Visualizzatore</strong>.</li>
        <li>
          Su Vercel (Settings → Environment Variables) imposta <code>GOOGLE_SHEET_ID</code>, <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code>,
          <code>GOOGLE_PRIVATE_KEY</code>, <code>BASE_CURRENCY</code> e <code>APP_ACCESS_TOKEN</code>. In locale usa <code>.env.local</code>.
        </li>
        <li>
          Per i cedolini abilita anche <strong>Google Drive API</strong>, crea un client OAuth di tipo <strong>App desktop</strong>, esegui
          <code>npm run google:auth</code> e imposta <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code>,
          <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> e <code>GOOGLE_DRIVE_ROOT_FOLDER_ID</code>. L'app crea <code>ANNO/busta_paga_ANNO</code> e
          <code>ANNO/busta_paga/</code> se mancano.
        </li>
        <li>Premi <strong>Sincronizza</strong>. Le credenziali restano sul server; il PDF del cedolino viene inviato solo al tuo Drive quando lo salvi.</li>
      </ol>
    </UiCard>
  </div>
</template>

<style scoped>
.src { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; font-size: 0.9rem; }
.src dt { color: var(--text-muted); }
.src dd { margin: 0; }
.src__actions { margin-top: var(--space-4); }
.src__alert { margin-top: var(--space-4); }
.token { display: flex; gap: var(--space-3); align-items: flex-end; margin-top: var(--space-4); flex-wrap: wrap; }
.token__field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px; }
.token__hint { margin-top: var(--space-3); }
code { font-family: var(--font-mono); font-size: 0.85em; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.schema__note { margin: var(--space-3) 0; }
.schema__scroll { overflow-x: auto; }
.schema th, .schema td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; font-size: 0.88rem; }
.schema th { color: var(--text-muted); font-weight: 500; font-size: 0.8rem; }
.schema td:first-child { white-space: nowrap; }
.guide { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 8px; font-size: 0.92rem; }
@media (max-width: 600px) { .src { grid-template-columns: 1fr; } .src dt { margin-top: 6px; } }
</style>
