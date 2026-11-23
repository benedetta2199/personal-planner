<script setup lang="ts">
/**
 * Dati di uno strumento di investimento (ETF, azione, obbligazione) necessari
 * al tracking giornaliero. Con `subcategory` null crea anche la sotto-categoria.
 */
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { INSTRUMENT_LABEL, ISIN_RE, subKey, validateInstrument, type InstrumentType, type InvestmentConfig, type SymbolMatch } from '../domain'
import { searchSymbols } from '../data/quotesApi'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import { useInvestmentStore } from '../store/investmentStore'
import { plainName } from '../presentation'

const props = defineProps<{ open: boolean; category: string; subcategory: string | null }>()
const emit = defineEmits<{ close: []; saved: [key: string] }>()
const finance = useFinanceStore()
const ledger = useLedgerStore()
const inv = useInvestmentStore()

const creating = computed(() => props.subcategory === null)
const form = reactive({
  name: '',
  type: 'etf' as InstrumentType,
  ticker: '',
  isin: '',
  instrumentName: '',
  units: '',
  nominal: '',
  buyPrice: '',
  coupon: '',
  couponFrequency: '1',
  maturity: '',
})
/** Ricerca per nome: solo come ripiego se non si conosce l'ISIN. */
const byName = ref(false)
const query = ref('')
const results = ref<SymbolMatch[]>([])
const searched = ref(false)
const isinClean = computed(() => form.isin.replace(/\s+/g, '').toUpperCase())
const isinValid = computed(() => ISIN_RE.test(isinClean.value))
const searching = ref(false)
const errors = ref<string[]>([])
const saving = ref(false)
const existing = computed(() => (props.subcategory !== null ? ledger.state.investments?.[subKey(props.category, props.subcategory)] : undefined))

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
watch(
  () => props.open,
  (o) => {
    if (!o) return
    const c = existing.value
    form.name = props.subcategory ?? ''
    form.type = c?.type ?? 'etf'
    form.ticker = c?.ticker ?? ''
    form.isin = c?.isin ?? ''
    form.instrumentName = c?.name ?? ''
    form.units = fmt(c?.units)
    form.nominal = fmt(c?.nominal)
    form.buyPrice = fmt(c?.buyPrice)
    form.coupon = fmt(c?.coupon)
    form.couponFrequency = String(c?.couponFrequency ?? 1)
    form.maturity = c?.maturity ?? ''
    query.value = plainName(props.subcategory ?? '')
    byName.value = false
    results.value = []
    searched.value = false
    errors.value = []
    // ISIN già noto: si cercano subito le quotazioni, per verificare il ticker salvato.
    if (c?.isin && ISIN_RE.test(c.isin) && (c.type ?? 'etf') !== 'bond') search()
  },
  { immediate: true },
)


async function search() {
  const q = byName.value ? query.value.trim() : isinClean.value
  if (!q) return
  if (!byName.value && !isinValid.value) {
    errors.value = ['ISIN non valido: sono 12 caratteri, es. IE00B4L5Y983.']
    return
  }
  searching.value = true
  errors.value = []
  try {
    results.value = await searchSymbols(q, finance.accessToken || undefined)
    searched.value = true
  } catch (e) {
    errors.value = [(e as Error).message]
  } finally {
    searching.value = false
  }
}

// ISIN completo digitato o incollato: ricerca automatica.
let isinTimer: ReturnType<typeof setTimeout> | undefined
watch(isinClean, (v, old) => {
  if (!props.open || byName.value || form.type === 'bond' || v === old) return
  results.value = []
  searched.value = false
  clearTimeout(isinTimer)
  if (ISIN_RE.test(v)) isinTimer = setTimeout(search, 350)
})

function pick(r: SymbolMatch) {
  form.ticker = r.symbol
  if (!form.instrumentName || form.instrumentName === form.ticker) form.instrumentName = r.name
  // Con la ricerca per nome l'ISIN resta da indicare a mano.
}

/** Ticker salvato che non corrisponde a nessuna quotazione trovata per l'ISIN (es. «XEON» senza borsa). */
const tickerMismatch = computed(
  () => searched.value && !byName.value && results.value.length > 0 && !!form.ticker && !results.value.some((r) => r.symbol === form.ticker.trim().toUpperCase()),
)

/** Messaggio sul salvataggio, coerente con lo stato reale del foglio. */
const sheetNote = computed(() => {
  const s = inv.sheet
  if (s.state === 'local' || s.state === 'error') return { tone: 'warn', text: s.message ?? '' }
  if (existing.value) return { tone: 'ok', text: 'Già presente nel foglio degli investimenti (scheda «Strumenti»): salvando aggiorni la sua riga.' }
  return { tone: 'info', text: 'Salvando, lo strumento viene aggiunto al foglio degli investimenti (scheda «Strumenti»).' }
})

const parseNum = (t: string): number | null => {
  const s = t.trim()
  if (!s) return null
  const v = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(v) ? v : NaN
}

function build(): InvestmentConfig {
  const bond = form.type === 'bond'
  return {
    type: form.type,
    ticker: form.ticker.trim().toUpperCase(),
    isin: form.isin.replace(/\s+/g, '').toUpperCase() || undefined,
    name: form.instrumentName.trim() || undefined,
    units: bond ? null : parseNum(form.units),
    nominal: bond ? parseNum(form.nominal) : null,
    buyPrice: bond ? parseNum(form.buyPrice) : null,
    coupon: bond ? parseNum(form.coupon) : null,
    couponFrequency: bond ? Number(form.couponFrequency) : null,
    maturity: bond ? form.maturity || null : null,
  }
}

async function save() {
  const cfg = build()
  const problems = validateInstrument(cfg)
  if (creating.value && !form.name.trim()) problems.unshift('Indica il nome della posizione (es. MSCI World).')
  errors.value = problems
  if (problems.length) return
  let sub = props.subcategory
  if (creating.value) {
    const cat = ledger.findCategory('expense', props.category)
    try {
      if (cat) ledger.addSubcategory(cat.id, form.name)
    } catch (e) {
      errors.value = [(e as Error).message]
      return
    }
    sub = form.name.trim()
  }
  saving.value = true
  const key = subKey(props.category, sub!)
  await inv.saveInstrumentData(key, cfg)
  saving.value = false
  emit('saved', key)
  emit('close')
}

async function unlink() {
  if (props.subcategory === null || !window.confirm('Rimuovere i dati dello strumento? La posizione resterà valutata al prezzo di acquisto.')) return
  await inv.removeInstrumentData(subKey(props.category, props.subcategory))
  emit('close')
}

const TYPES: { value: InstrumentType; hint: string }[] = [
  { value: 'etf', hint: 'Fondo quotato: prezzo giornaliero di borsa' },
  { value: 'stock', hint: 'Singola società: prezzo giornaliero di borsa' },
  { value: 'bond', hint: 'BTP, titoli di stato, corporate: cedole e scadenza' },
]
const title = computed(() => (creating.value ? `Nuovo investimento in ${plainName(props.category)}` : `Strumento «${plainName(props.subcategory ?? '')}»`))
</script>

<template>
  <UiDialog :open="open" :title="title" :width="620" @close="emit('close')">
    <form id="instrument-form" class="ins" @submit.prevent="save">
      <label v-if="creating" class="ins__field">
        <span>Nome della posizione (sotto-categoria)</span>
        <input v-model="form.name" class="input" placeholder="Es. MSCI World" required />
      </label>

      <fieldset class="ins__types">
        <legend>Tipo di strumento</legend>
        <label v-for="t in TYPES" :key="t.value" class="ins__type" :class="{ on: form.type === t.value }">
          <input v-model="form.type" type="radio" :value="t.value" class="sr-only" />
          <strong>{{ INSTRUMENT_LABEL[t.value] }}</strong>
          <span>{{ t.hint }}</span>
        </label>
      </fieldset>

      <!-- ETF / Azione -->
      <template v-if="form.type !== 'bond'">
        <p class="muted small">
          Serve il <strong>ticker</strong> per scaricare ogni giorno il prezzo. Preferisci la quotazione in euro su cui acquisti
          (es. Borsa Italiana <code>.MI</code>, Xetra <code>.DE</code>).
        </p>
        <div class="ins__search">
          <label v-if="!byName" class="ins__field ins__isin">
            <span>ISIN dello strumento</span>
            <input
              v-model="form.isin"
              class="input ins__upper num"
              placeholder="Es. IE00B4L5Y983"
              maxlength="14"
              spellcheck="false"
              autocomplete="off"
              aria-describedby="ins-isin-help"
              @keydown.enter.prevent="search"
            />
          </label>
          <label v-else class="ins__field ins__isin">
            <span>Nome o indice</span>
            <input v-model="query" class="input" placeholder="Es. MSCI World" autocomplete="off" @keydown.enter.prevent="search" />
          </label>
          <UiButton icon="search" :loading="searching" :disabled="byName ? !query.trim() : !isinValid" @click="search">Cerca</UiButton>
        </div>
        <p id="ins-isin-help" class="muted small ins__help">
          <template v-if="!byName">
            Trovi l'ISIN nell'app del broker o sul KID del fondo. Appena è completo cerco le quotazioni: quelle in euro sono in cima.
            <button type="button" class="ins__link" @click="byName = true; results = []; searched = false">Non hai l'ISIN? Cerca per nome</button>
          </template>
          <template v-else>
            <button type="button" class="ins__link" @click="byName = false; results = []; searched = false">← Torna alla ricerca per ISIN</button>
          </template>
        </p>
        <!-- Segnaposto durante la ricerca -->
        <div v-if="searching" class="ins__loading" role="status" aria-live="polite">
          <p class="muted small">Cerco le quotazioni di <strong>{{ byName ? query.trim() : isinClean }}</strong> sulle borse europee…</p>
          <ul class="ins__results ins__skeleton" aria-hidden="true">
            <li v-for="n in 3" :key="n">
              <div class="ins__skel-row">
                <span class="sk sk--sym" />
                <span class="sk sk--name" :style="{ width: `${70 - n * 12}%` }" />
                <span class="sk sk--ex" />
              </div>
            </li>
          </ul>
        </div>
        <ul v-else-if="results.length" class="ins__results" role="listbox" aria-label="Quotazioni trovate">
          <li v-for="(r, i) in results" :key="r.symbol">
            <button type="button" role="option" :aria-selected="form.ticker === r.symbol" :class="{ on: form.ticker === r.symbol }" @click="pick(r)">
              <strong>{{ r.symbol }}</strong>
              <span class="ins__rname">{{ r.name }}</span>
              <span class="ins__rex">
                <em v-if="i === 0 && r.eur" class="ins__tag ins__tag--best">Consigliato</em>
                <em v-if="r.eur" class="ins__tag">EUR</em>
                {{ r.exchange }}
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="searched" class="muted small">
          Nessuna quotazione trovata<template v-if="!byName"> per questo ISIN</template>: inserisci il ticker a mano (es. <code>SWDA.MI</code>).
        </p>
        <UiAlert v-if="tickerMismatch" tone="warning">
          Il ticker salvato «{{ form.ticker }}» non corrisponde a nessuna quotazione di questo ISIN{{ form.ticker.includes('.') ? '' : ' (manca la borsa, es. .MI o .DE)' }}:
          scegline una qui sopra, altrimenti il prezzo giornaliero non viene trovato.
        </UiAlert>
        <div class="ins__grid">
          <label class="ins__field"><span>Ticker *</span><input v-model="form.ticker" class="input ins__upper" placeholder="Scegli dai risultati, es. SWDA.MI" /></label>
          <label v-if="byName" class="ins__field"><span>ISIN</span><input v-model="form.isin" class="input ins__upper" placeholder="Es. IE00B4L5Y983" maxlength="14" /></label>
          <label class="ins__field ins__wide"><span>Nome dello strumento</span><input v-model="form.instrumentName" class="input" placeholder="Es. iShares Core MSCI World" /></label>
          <label class="ins__field">
            <span>{{ form.type === 'etf' ? 'Quote' : 'Azioni' }} possedute</span>
            <input v-model="form.units" class="input" inputmode="decimal" placeholder="Stimate dagli acquisti" />
          </label>
        </div>
      </template>

      <!-- Obbligazione -->
      <template v-else>
        <p class="muted small">
          Il valore viene calcolato ogni giorno in autonomia: rateo della cedola maturato e avvicinamento del prezzo a 100 alla scadenza.
          Se indichi un ticker, si usa invece il prezzo di mercato.
        </p>
        <div class="ins__grid">
          <label class="ins__field"><span>ISIN *</span><input v-model="form.isin" class="input ins__upper" placeholder="Es. AT0000A1ZGE4" maxlength="12" /></label>
          <label class="ins__field"><span>Scadenza *</span><input v-model="form.maturity" type="date" class="input" /></label>
          <label class="ins__field ins__wide"><span>Nome</span><input v-model="form.instrumentName" class="input" placeholder="Es. Austria 2,55% apr 2027" /></label>
          <label class="ins__field"><span>Cedola annua lorda (%) *</span><input v-model="form.coupon" class="input" inputmode="decimal" placeholder="Es. 2,55 (0 se zero coupon)" /></label>
          <label class="ins__field">
            <span>Pagamento cedola *</span>
            <select v-model="form.couponFrequency" class="input">
              <option value="1">Annuale</option>
              <option value="2">Semestrale</option>
              <option value="4">Trimestrale</option>
              <option value="12">Mensile</option>
            </select>
          </label>
          <label class="ins__field"><span>Valore nominale (€)</span><input v-model="form.nominal" class="input" inputmode="decimal" placeholder="Ricavato dal costo" /></label>
          <label class="ins__field"><span>Prezzo di acquisto (% del nominale)</span><input v-model="form.buyPrice" class="input" inputmode="decimal" placeholder="Es. 99,5 (vuoto = 100)" /></label>
          <label class="ins__field ins__wide"><span>Ticker di mercato (facoltativo)</span><input v-model="form.ticker" class="input ins__upper" placeholder="Solo se quotato con prezzo in % del nominale" /></label>
        </div>
      </template>

      <p class="ins__sheet" :class="`ins__sheet--${sheetNote.tone}`">
        <span aria-hidden="true">{{ sheetNote.tone === 'ok' ? '✔' : sheetNote.tone === 'warn' ? '⚠' : 'ℹ' }}</span> {{ sheetNote.text }}
      </p>
      <UiAlert v-if="errors.length" tone="critical">
        <ul class="ins__errors"><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </UiAlert>
    </form>
    <template #footer>
      <UiButton v-if="existing" variant="ghost" icon="trash" class="ins__unlink" @click="unlink">Rimuovi dati</UiButton>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="instrument-form" variant="primary" :loading="saving">Salva</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.ins { display: flex; flex-direction: column; gap: 14px; }
.ins code { font-size: 0.85em; background: var(--surface-2); padding: 0 4px; border-radius: 4px; }
.ins__isin { flex: 1; min-width: 0; }
.ins__loading { display: flex; flex-direction: column; gap: 8px; }
.ins__skel-row { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; gap: 12px; padding: 12px; }
.sk {
  display: block; height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-2) 0%, var(--border) 40%, var(--surface-2) 80%);
  background-size: 200% 100%; animation: sk-shimmer 1.2s ease-in-out infinite;
}
.sk--sym { width: 70px; height: 14px; }
.sk--ex { width: 70px; justify-self: end; }
@keyframes sk-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
.ins__isin .input { width: 100%; letter-spacing: 0.04em; }
.ins__help { margin-top: -6px; }
.ins__link { border: 0; background: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
.ins__tag { font-style: normal; padding: 0 6px; border-radius: 999px; background: var(--good-soft); color: var(--positive); font-size: 0.7rem; font-weight: 600; margin-right: 4px; }
.ins__tag--best { background: var(--ink); color: #fff; }
.ins__sheet { display: flex; gap: 6px; align-items: baseline; padding: 8px 12px; border-radius: 12px; font-size: 0.82rem; }
.ins__sheet--ok { background: var(--good-soft); color: var(--positive); }
.ins__sheet--info { background: var(--surface-2); color: var(--text-secondary); }
.ins__sheet--warn { background: var(--warning-soft); color: var(--status-warning); }
.ins__types { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ins__types legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.ins__type { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border-strong); cursor: pointer; }
.ins__type span { font-size: 0.74rem; color: var(--text-muted); }
.ins__type.on { border-color: var(--ink); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.ins__type:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.ins__search { display: flex; gap: 8px; align-items: flex-end; }
.ins__search .input { flex: 1; min-width: 0; }
.ins__results { list-style: none; margin: 0; padding: 4px; max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 16px; }
.ins__results button {
  display: grid; grid-template-columns: 110px minmax(0, 1fr); grid-template-areas: 'sym name' 'sym ex'; gap: 0 12px;
  width: 100%; text-align: left; padding: 8px 10px; border: 0; background: none; border-radius: 12px; cursor: pointer;
}
.ins__results button strong { grid-area: sym; align-self: center; }
.ins__results button:hover { background: var(--surface-2); }
.ins__results button.on { background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.ins__rname { grid-area: name; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ins__rex { grid-area: ex; font-size: 0.75rem; color: var(--text-muted); }
.ins__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ins__wide { grid-column: 1 / -1; }
.ins__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.ins__field .input { width: 100%; color: var(--text-primary); }
.ins__upper { text-transform: uppercase; }
.ins__upper::placeholder { text-transform: none; }
.ins__errors { margin: 0; padding-left: 18px; }
.ins__unlink { margin-right: auto; color: var(--negative); }
@media (max-width: 560px) {
  .ins__types, .ins__grid { grid-template-columns: 1fr; }
}
</style>
