<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import { CARD_THEMES, type AccountConfig, type AccountType, type CardTheme } from '../domain'
import { LedgerError, useLedgerStore } from '../store/ledgerStore'
import { CARD_THEME_META } from '../presentation'
import AccountCard from './AccountCard.vue'

const props = defineProps<{ open: boolean; account?: AccountConfig | null; presetName?: string }>()
const emit = defineEmits<{ close: [] }>()
const ledger = useLedgerStore()

const form = reactive({
  name: '',
  aliases: '',
  type: 'liquidity' as AccountType,
  currency: 'EUR',
  opening: '',
  openingDate: '',
  cardTheme: 'ocean' as CardTheme,
  showCard: true,
  isDefault: false,
})
const error = ref<string | null>(null)
const isEdit = computed(() => !!props.account)

watch(
  () => props.open,
  (o) => {
    if (!o) return
    error.value = null
    const a = props.account
    form.name = a?.name ?? props.presetName ?? ''
    form.aliases = a?.aliases.join(', ') ?? ''
    form.type = a?.type ?? 'liquidity'
    form.currency = a?.currency ?? 'EUR'
    form.opening = a?.openingBalance === null || a?.openingBalance === undefined ? '' : (a.openingBalance / 100).toFixed(2).replace('.', ',')
    form.openingDate = a?.openingDate ?? ''
    form.cardTheme = a?.cardTheme ?? CARD_THEMES[ledger.state.config.accounts.length % CARD_THEMES.length]
    form.showCard = a?.showCard ?? true
    form.isDefault = !!a && ledger.state.config.defaultAccountId === a.id
  },
  { immediate: true },
)

function parseOpening(): number | null {
  const t = form.opening.trim()
  if (!t) return null
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (!Number.isFinite(v)) throw new LedgerError('Saldo iniziale non valido.')
  return Math.round(v * 100)
}

function openingDateValue(): string | null {
  const d = form.openingDate.trim()
  // Senza importo la data non ha effetto.
  if (!d || !form.opening.trim()) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new LedgerError('Data del saldo iniziale non valida.')
  return d
}

function save() {
  error.value = null
  try {
    const data = {
      name: form.name,
      aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
      type: form.type,
      currency: form.currency.trim().toUpperCase() || 'EUR',
      openingBalance: parseOpening(),
      openingDate: openingDateValue(),
      cardTheme: form.cardTheme,
      showCard: form.showCard,
    }
    if (props.account) ledger.updateAccount(props.account.id, data)
    else ledger.addAccount(data)
    const id = props.account?.id ?? ledger.state.config.accounts.find((a) => a.name === data.name.trim())?.id ?? null
    if (form.isDefault) ledger.setDefaultAccount(id)
    else if (id && ledger.state.config.defaultAccountId === id) ledger.setDefaultAccount(null)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <UiDialog :open="open" :title="isEdit ? 'Modifica conto' : 'Nuovo conto'" :width="560" @close="emit('close')">
    <form id="account-form" class="af" @submit.prevent="save">
      <div class="af__preview">
        <AccountCard :name="form.name || 'Nome conto'" :balance="0" :currency="form.currency || 'EUR'" :theme="form.cardTheme" :kind="form.type === 'investment' ? 'Investimento' : 'Liquidità'" />
      </div>
      <label class="af__field">
        <span>Nome</span>
        <input v-model="form.name" class="input" required placeholder="Es. Revolut" />
      </label>
      <label class="af__field">
        <span>Altri nomi nel Google Sheet <em class="muted">(separati da virgola)</em></span>
        <input v-model="form.aliases" class="input" placeholder="Es. Conti, Conto corrente" />
      </label>
      <div class="af__grid">
        <label class="af__field">
          <span>Tipo</span>
          <select v-model="form.type" class="input">
            <option value="liquidity">Liquidità</option>
            <option value="investment">Investimento</option>
          </select>
        </label>
        <label class="af__field">
          <span>Valuta</span>
          <input v-model="form.currency" class="input" maxlength="3" required />
        </label>
      </div>
      <fieldset class="af__opening">
        <legend>Saldo iniziale <em class="muted">(facoltativo)</em></legend>
        <div class="af__grid af__grid--2">
          <label class="af__field">
            <span>Importo</span>
            <input v-model="form.opening" class="input" inputmode="decimal" placeholder="Dal foglio" />
          </label>
          <div class="af__field">
            <span>Alla data</span>
            <UiDatePicker v-model="form.openingDate" label="Data del saldo iniziale" :disabled="!form.opening.trim()" :shortcuts="false" />
          </div>
        </div>
        <p class="muted small">
          <template v-if="form.openingDate && form.opening.trim()">
            All'inizio del {{ new Date(`${form.openingDate}T00:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) }}
            il conto varrà {{ form.opening }} {{ form.currency }}; i movimenti successivi lo aggiornano.
          </template>
          <template v-else>Senza data, l'importo vale come saldo prima del primo movimento registrato.</template>
        </p>
      </fieldset>
      <fieldset class="af__themes">
        <legend>Colore della carta</legend>
        <label v-for="t in CARD_THEMES" :key="t" class="af__theme" :class="{ on: form.cardTheme === t }" :title="CARD_THEME_META[t].label">
          <input v-model="form.cardTheme" type="radio" :value="t" class="sr-only" />
          <span :style="{ background: CARD_THEME_META[t].bg }" />
          <em>{{ CARD_THEME_META[t].label }}</em>
        </label>
      </fieldset>
      <label class="af__check"><input v-model="form.showCard" type="checkbox" /> Mostra come carta nella dashboard</label>
      <label class="af__check"><input v-model="form.isDefault" type="checkbox" /> Conto predefinito per le nuove voci</label>
      <p class="muted small">Rinominando il conto, il vecchio nome viene conservato tra gli «altri nomi», così i movimenti del foglio restano collegati.</p>
      <UiAlert v-if="error" tone="critical">{{ error }}</UiAlert>
    </form>
    <template #footer>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="account-form" variant="primary">{{ isEdit ? 'Salva' : 'Aggiungi conto' }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.af { display: flex; flex-direction: column; gap: 14px; }
.af__preview { max-width: 300px; margin: 0 auto 4px; width: 100%; }
.af__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.af__field .input { width: 100%; color: var(--text-primary); font-size: 0.95rem; }
.af__field em { font-style: normal; }
.af__grid { display: grid; grid-template-columns: 1fr 0.6fr; gap: 12px; }
.af__grid--2 { grid-template-columns: 1fr 1fr; }
.af__opening { border: 0; margin: 0; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; }
.af__opening legend { float: left; font-size: 0.82rem; color: var(--text-secondary); padding: 0; margin-bottom: 2px; }
.af__opening legend em { font-style: normal; }
.af__opening legend + * { clear: both; }
.af__themes { border: 0; margin: 0; padding: 0; display: flex; gap: 10px; flex-wrap: wrap; }
.af__themes legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.af__theme { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; font-size: 0.72rem; }
.af__theme span { width: 46px; height: 30px; border-radius: 8px; border: 2px solid transparent; box-shadow: 0 0 0 1px var(--border); }
.af__theme em { font-style: normal; color: var(--text-muted); }
.af__theme.on span { border-color: var(--surface); box-shadow: 0 0 0 2px var(--ink); }
.af__theme:focus-within span { outline: 2px solid var(--accent); outline-offset: 2px; }
.af__check { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
@media (max-width: 420px) { .af__grid--2 { grid-template-columns: 1fr; } }
</style>
