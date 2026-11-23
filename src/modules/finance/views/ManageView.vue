<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatDate, formatMoney } from '@/core/utils/format'
import { CATEGORY_COLORS, INSTRUMENT_LABEL, computeAccountBalances, norm, subKey, type AccountConfig, type CategoryConfig, type CategoryKind, type ExpenseType } from '../domain'
import { useFinanceStore } from '../store/financeStore'
import { useLedgerStore } from '../store/ledgerStore'
import AccountDialog from '../components/AccountDialog.vue'
import InstrumentDialog from '../components/InstrumentDialog.vue'
import { useInvestmentStore } from '../store/investmentStore'
import { ACCOUNT_TYPE_LABEL, CARD_THEME_META, subcategoryColor } from '../presentation'
import { categoryIcon, guessCategoryEmoji, leadingEmoji } from '../categoryIcons'
import UiColorPicker from '@/core/ui/UiColorPicker.vue'
import EmojiPicker from '../components/EmojiPicker.vue'

const store = useFinanceStore()
const ledger = useLedgerStore()
const props = defineProps<{ section: 'accounts' | 'categories' | 'data' }>()
const message = ref<{ tone: 'info' | 'critical'; text: string } | null>(null)
const flash = (text: string, tone: 'info' | 'critical' = 'info') => (message.value = { tone, text })

function attempt(fn: () => void, ok?: string) {
  try {
    fn()
    if (ok) flash(ok)
    else message.value = null
    return true
  } catch (e) {
    flash((e as Error).message, 'critical')
    return false
  }
}

// ---- Conti ------------------------------------------------------------------
const balances = computed(() => new Map(computeAccountBalances(store.dataset).map((b) => [b.account.name, b])))
const opCountByAccount = computed(() => {
  const m = new Map<string, number>()
  for (const op of store.dataset.operations) {
    m.set(op.account, (m.get(op.account) ?? 0) + 1)
    if (op.kind === 'transfer') m.set(op.toAccount, (m.get(op.toAccount) ?? 0) + 1)
  }
  return m
})
const unconfiguredAccounts = computed(() => {
  const known = new Set(ledger.state.config.accounts.map((a) => a.name))
  return store.dataset.accounts.filter((a) => !known.has(a.name)).map((a) => a.name)
})

const accDialog = ref(false)
const accEditing = ref<AccountConfig | null>(null)
const accPreset = ref<string | undefined>()
function openAccount(a: AccountConfig | null, preset?: string) {
  accEditing.value = a
  accPreset.value = preset
  accDialog.value = true
}
function deleteAccount(a: AccountConfig) {
  const n = ledger.usage('account', a.name)
  const extra = n ? ` ${n} voci manuali lo usano e resteranno collegate al nome «${a.name}».` : ''
  if (!window.confirm(`Rimuovere il conto «${a.name}» dalla configurazione?${extra}`)) return
  ledger.removeAccount(a.id)
  flash(`Conto «${a.name}» rimosso.`)
}

// ---- Categorie --------------------------------------------------------------
const kind = ref<CategoryKind>('expense')
const categories = computed(() => ledger.state.config.categories.filter((c) => c.kind === kind.value))
const opCountByCategory = computed(() => {
  const m = new Map<string, number>()
  for (const op of store.dataset.operations) {
    if (op.kind === 'transfer') continue
    const k = `${op.kind === 'income' ? 'income' : 'expense'}␟${op.category}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
})
const catCount = (c: CategoryConfig) => opCountByCategory.value.get(`${c.kind}␟${c.name}`) ?? 0
const unconfiguredCategories = computed(() => {
  const set = new Set<string>()
  for (const op of store.dataset.operations) {
    if (op.kind === 'transfer' || !op.category) continue
    const k: CategoryKind = op.kind === 'income' ? 'income' : 'expense'
    if (k === kind.value && !ledger.findCategory(k, op.category)) set.add(op.category)
  }
  return [...set]
})

const open = ref(new Set<string>())
function toggle(id: string) {
  const s = new Set(open.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  open.value = s
}

// ---- Nuova categoria: nome, emoji, colore, tipologia e sotto-categorie in un solo passaggio.
const draft = reactive({ name: '', icon: '', iconTouched: false, color: '', type: 'necessary' as ExpenseType, subs: '' })
const nameInput = ref<HTMLInputElement | null>(null)
const justAdded = ref<string | null>(null)
function resetDraft() {
  draft.name = ''
  draft.icon = ''
  draft.iconTouched = false
  draft.subs = ''
  draft.color = ledger.nextColor(kind.value)
}
resetDraft()
watch(kind, resetDraft)
/** Emoji proposta: quella scelta, altrimenti dedotta dal nome mentre si scrive. */
const draftIcon = computed({
  get: () => (draft.iconTouched && draft.icon) || leadingEmoji(draft.name) || guessCategoryEmoji(draft.name),
  set: (v: string) => {
    draft.icon = v
    draft.iconTouched = true
  },
})
const draftSubs = computed(() => [...new Set(draft.subs.split(',').map((x) => x.trim()).filter(Boolean))])
const duplicate = computed(() => (draft.name.trim() ? ledger.findCategory(kind.value, draft.name) : undefined))

async function addCategory() {
  const name = draft.name.trim()
  if (!name || duplicate.value) return
  let created: CategoryConfig | undefined
  const ok = attempt(() => {
    created = ledger.addCategory(kind.value, name, {
      color: draft.color,
      icon: draftIcon.value,
      defaultExpenseType: kind.value === 'expense' ? draft.type : undefined,
      subcategories: draftSubs.value,
    })
  }, `Categoria «${name}» aggiunta${draftSubs.value.length ? ` con ${draftSubs.value.length} sotto-categorie` : ''}.`)
  if (!ok || !created) return
  resetDraft()
  justAdded.value = created.id
  if (created.subcategories.length) open.value = new Set([...open.value, created.id])
  await nextTick()
  document.querySelector(`[data-cat="${created.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  nameInput.value?.focus()
  setTimeout(() => (justAdded.value = null), 1800)
}
function showExisting(c: CategoryConfig) {
  open.value = new Set([...open.value, c.id])
  justAdded.value = c.id
  nextTick(() => document.querySelector(`[data-cat="${c.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  setTimeout(() => (justAdded.value = null), 1800)
}
const TYPE_OPTIONS: { value: ExpenseType; label: string; emoji: string }[] = [
  { value: 'necessary', label: 'Necessaria', emoji: '🧾' },
  { value: 'additional', label: 'Desiderio', emoji: '✨' },
  { value: 'investment', label: 'Investimento', emoji: '📈' },
]

/** Modifica in linea: un solo campo alla volta. */
const editing = ref<{ key: string; value: string } | null>(null)
async function startEdit(key: string, value: string) {
  editing.value = { key, value }
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-edit="${key}"]`)?.select()
}
function commitCategory(c: CategoryConfig) {
  if (!editing.value) return
  const v = editing.value.value
  if (attempt(() => ledger.updateCategory(c.id, { name: v }))) editing.value = null
}
function commitSub(c: CategoryConfig, subId: string) {
  if (!editing.value) return
  const v = editing.value.value
  if (attempt(() => ledger.renameSubcategory(c.id, subId, v))) editing.value = null
}
function deleteCategory(c: CategoryConfig) {
  const n = catCount(c)
  const extra = n ? ` ${n} movimenti la usano: resteranno con questo nome, ma senza colore e configurazione.` : ''
  if (!window.confirm(`Eliminare la categoria «${c.name}» e le sue ${c.subcategories.length} sotto-categorie?${extra}`)) return
  ledger.removeCategory(c.id)
  flash(`Categoria «${c.name}» eliminata.`)
}
function deleteSub(c: CategoryConfig, subId: string, name: string) {
  if (!window.confirm(`Eliminare la sotto-categoria «${name}» da ${c.name}?`)) return
  ledger.removeSubcategory(c.id, subId)
}
const iconOf = (c: CategoryConfig) => categoryIcon(ledger.state.config, c.name, c.kind)
const newSub = ref<Record<string, string>>({})
function addSub(c: CategoryConfig) {
  const v = newSub.value[c.id] ?? ''
  if (attempt(() => ledger.addSubcategory(c.id, v))) newSub.value[c.id] = ''
}
function recolor() {
  if (!window.confirm('Assegnare automaticamente un colore diverso a ogni categoria? I colori scelti a mano verranno sostituiti.')) return
  ledger.recolorCategories()
  flash('Colori riassegnati: ogni categoria ha ora una tinta propria, le sotto-categorie ne usano le varianti.')
}
// ---- Strumenti di investimento ------------------------------------------------
const inv = useInvestmentStore()
const isInvestment = (c: CategoryConfig) => c.kind === 'expense' && c.defaultExpenseType === 'investment'
const instrumentOf = (c: CategoryConfig, sub: string) => ledger.state.investments?.[subKey(c.name, sub)]
const insDialog = ref(false)
const insCategory = ref('')
const insSub = ref<string | null>(null)
function openInstrument(category: string, sub: string | null) {
  insCategory.value = category
  insSub.value = sub
  insDialog.value = true
}
onMounted(() => {
  if (props.section === 'categories') inv.loadInstruments()
})

function importFromData() {
  const added = ledger.seedFrom(store.dataset)
  flash(added ? `Importate ${added} tra categorie e sotto-categorie dai movimenti.` : 'Tutte le categorie dei movimenti sono già configurate.')
}
function adoptCategory(name: string) {
  attempt(() => ledger.addCategory(kind.value, name), `Categoria «${name}» aggiunta.`)
  // Porta con sé le sotto-categorie già usate nei movimenti.
  const cat = ledger.findCategory(kind.value, name)
  if (!cat) return
  const subs = new Set(store.dataset.operations.filter((o) => o.category === name && o.subcategory).map((o) => o.subcategory))
  for (const s of subs) if (!cat.subcategories.some((x) => norm(x.name) === norm(s))) ledger.addSubcategory(cat.id, s)
}

const EXPENSE_TYPE_LABEL: Record<ExpenseType, string> = { necessary: 'Necessaria', additional: 'Desiderio', investment: 'Investimento' }

// ---- Dati -------------------------------------------------------------------
function exportBackup() {
  const blob = new Blob([ledger.exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `finanze-registro-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
async function importBackup(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  if (!window.confirm('Sostituire conti, categorie e voci manuali attuali con quelli del backup?')) return
  attempt(() => ledger.importJson(text), 'Backup ripristinato.')
}
function resetLedger() {
  if (!window.confirm(`Eliminare tutte le ${ledger.state.entries.length} voci manuali e ripristinare conti e categorie predefiniti? L'operazione non si può annullare.`)) return
  ledger.reset()
  flash('Registro locale ripristinato.')
}
</script>

<template>
  <div class="mg">
    <UiAlert v-if="message" :tone="message.tone">
      {{ message.text }}
      <template #actions><UiButton size="sm" variant="ghost" icon="close" aria-label="Chiudi messaggio" @click="message = null" /></template>
    </UiAlert>

    <!-- CONTI ------------------------------------------------------------>
    <section v-if="section === 'accounts'" class="panel" aria-labelledby="mg-acc">
      <header class="panel__head">
        <h2 id="mg-acc" class="panel__title"><span class="icon-chip"><UiIcon name="card" /></span>Conti</h2>
        <UiButton variant="brand" icon="plus" @click="openAccount(null)">Nuovo conto</UiButton>
      </header>
      <ul class="list">
        <li v-for="(a, i) in ledger.state.config.accounts" :key="a.id" class="acc">
          <span class="acc__card" :style="{ background: CARD_THEME_META[a.cardTheme].bg }" aria-hidden="true" />
          <div class="acc__main">
            <strong>{{ a.name }} <span v-if="ledger.state.config.defaultAccountId === a.id" class="acc__default">★ Predefinito</span></strong>
            <span class="muted small">
              {{ ACCOUNT_TYPE_LABEL[a.type] }} · {{ a.currency }}
              <template v-if="a.aliases.length"> · anche «{{ a.aliases.join('», «') }}»</template>
              <template v-if="a.openingBalance !== null"> · saldo iniziale {{ formatMoney(a.openingBalance, a.currency) }}<template v-if="a.openingDate"> al {{ formatDate(a.openingDate) }}</template></template>
              <template v-if="!a.showCard"> · carta nascosta</template>
            </span>
          </div>
          <div class="acc__bal">
            <span class="num">{{ formatMoney(balances.get(a.name)?.balance ?? 0, a.currency) }}</span>
            <span class="muted small">{{ opCountByAccount.get(a.name) ?? 0 }} movimenti</span>
          </div>
          <div class="acc__actions">
            <button
              type="button"
              class="acc__star"
              :class="{ on: ledger.state.config.defaultAccountId === a.id }"
              :aria-pressed="ledger.state.config.defaultAccountId === a.id"
              :aria-label="ledger.state.config.defaultAccountId === a.id ? `${a.name} è il conto predefinito: togli` : `Usa ${a.name} come conto predefinito per le nuove voci`"
              :title="ledger.state.config.defaultAccountId === a.id ? 'Conto predefinito per le nuove voci' : 'Imposta come predefinito'"
              @click="ledger.setDefaultAccount(ledger.state.config.defaultAccountId === a.id ? null : a.id)"
            >
              {{ ledger.state.config.defaultAccountId === a.id ? '★' : '☆' }}
            </button>
            <UiButton size="sm" variant="ghost" icon="arrowUp" :disabled="i === 0" :aria-label="`Sposta su ${a.name}`" @click="ledger.moveAccount(a.id, -1)" />
            <UiButton size="sm" variant="ghost" icon="arrowDown" :disabled="i === ledger.state.config.accounts.length - 1" :aria-label="`Sposta giù ${a.name}`" @click="ledger.moveAccount(a.id, 1)" />
            <UiButton size="sm" variant="ghost" icon="edit" :aria-label="`Modifica ${a.name}`" @click="openAccount(a)" />
            <UiButton size="sm" variant="ghost" icon="trash" class="danger" :aria-label="`Elimina ${a.name}`" @click="deleteAccount(a)" />
          </div>
        </li>
      </ul>
      <div v-if="unconfiguredAccounts.length" class="found">
        <p class="small"><strong>Trovati nei movimenti ma non configurati:</strong> aggiungili per sceglierne tipo e carta, oppure indica il loro nome tra gli «altri nomi» di un conto esistente.</p>
        <div class="row">
          <button v-for="n in unconfiguredAccounts" :key="n" type="button" class="chip" @click="openAccount(null, n)"><UiIcon name="plus" :size="14" />{{ n }}</button>
        </div>
      </div>
    </section>

    <!-- CATEGORIE -------------------------------------------------------->
    <section v-else-if="section === 'categories'" class="panel" aria-labelledby="mg-cat">
      <header class="panel__head">
        <h2 id="mg-cat" class="panel__title"><span class="icon-chip"><UiIcon name="tag" /></span>Categorie e sotto-categorie</h2>
        <div class="row">
          <UiSegmented v-model="kind" label="Tipo di categoria" :options="[{ value: 'expense', label: 'Uscite' }, { value: 'income', label: 'Entrate' }]" />
          <UiButton icon="download" @click="importFromData">Importa dai movimenti</UiButton>
          <UiButton variant="ghost" icon="refresh" title="Una tinta diversa per ogni categoria" @click="recolor">Riassegna colori</UiButton>
        </div>
      </header>

      <form class="composer" :class="{ 'composer--dup': duplicate }" @submit.prevent="addCategory">
        <div class="composer__main">
          <EmojiPicker v-model="draftIcon" label="Emoji della nuova categoria" :color="draft.color" :size="44" />
          <div class="composer__name">
            <input
              ref="nameInput"
              v-model="draft.name"
              class="composer__input"
              :placeholder="kind === 'expense' ? 'Nuova categoria di uscita, es. Casa' : 'Nuova categoria di entrata, es. Stipendio'"
              aria-label="Nome della nuova categoria"
              autocomplete="off"
              @keydown.esc="resetDraft"
            />
            <input v-model="draft.subs" class="composer__subs" placeholder="Sotto-categorie (facoltative), separate da virgola" aria-label="Sotto-categorie della nuova categoria" autocomplete="off" />
          </div>
          <UiColorPicker v-model="draft.color" label="Colore della categoria" :presets="CATEGORY_COLORS" />
          <UiButton type="submit" variant="primary" icon="plus" :disabled="!draft.name.trim() || !!duplicate">Aggiungi</UiButton>
        </div>
        <div v-if="kind === 'expense'" class="composer__types" role="radiogroup" aria-label="Tipologia predefinita">
          <span class="muted small">Tipologia proposta:</span>
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.value"
            type="button"
            role="radio"
            class="composer__type"
            :class="{ on: draft.type === t.value }"
            :aria-checked="draft.type === t.value"
            @click="draft.type = t.value"
          >
            <span aria-hidden="true">{{ t.emoji }}</span> {{ t.label }}
          </button>
        </div>
        <div v-if="draftSubs.length" class="composer__chips" aria-label="Anteprima sotto-categorie">
          <span v-for="sub in draftSubs" :key="sub" class="composer__chip" :style="{ '--c': draft.color }">{{ sub }}</span>
        </div>
        <p v-if="duplicate" class="composer__dup" role="alert">
          Esiste già la categoria «{{ duplicate.name }}».
          <button type="button" class="linkish" @click="showExisting(duplicate)">Mostrala</button>
        </p>
      </form>

      <p v-if="!categories.length" class="muted small empty">Nessuna categoria configurata. Aggiungine una o importale dai movimenti.</p>
      <ul class="list">
        <li v-for="c in categories" :key="c.id" class="cat" :class="{ 'cat--new': justAdded === c.id }" :data-cat="c.id">
          <div class="cat__row">
            <button type="button" class="cat__toggle" :aria-expanded="open.has(c.id)" :aria-label="`Sotto-categorie di ${c.name}`" @click="toggle(c.id)">
              <UiIcon name="chevron" :size="16" :class="{ closed: !open.has(c.id) }" />
            </button>
            <EmojiPicker :model-value="iconOf(c)" :label="`Emoji di ${c.name}`" :color="c.color" @update:model-value="(e) => ledger.updateCategory(c.id, { icon: e })" />
            <div class="cat__main">
              <form v-if="editing?.key === c.id" class="inline" @submit.prevent="commitCategory(c)">
                <input v-model="editing.value" :data-edit="c.id" class="input" aria-label="Nuovo nome categoria" @keydown.esc="editing = null" />
                <UiButton size="sm" type="submit" variant="primary" icon="check" aria-label="Salva nome" />
                <UiButton size="sm" variant="ghost" icon="close" aria-label="Annulla" @click="editing = null" />
              </form>
              <template v-else>
                <strong>{{ c.name }}</strong>
                <span class="muted small">{{ c.subcategories.length }} sotto-categorie · {{ catCount(c) }} movimenti<template v-if="c.aliases.length"> · anche «{{ c.aliases.join('», «') }}»</template></span>
              </template>
            </div>
            <select
              v-if="c.kind === 'expense'"
              class="input cat__type"
              :value="c.defaultExpenseType ?? ''"
              :aria-label="`Tipologia predefinita per ${c.name}`"
              title="Tipologia proposta per le nuove spese"
              @change="ledger.updateCategory(c.id, { defaultExpenseType: ($event.target as HTMLSelectElement).value as ExpenseType })"
            >
              <option value="" disabled>Tipologia…</option>
              <option v-for="(l, k) in EXPENSE_TYPE_LABEL" :key="k" :value="k">{{ l }}</option>
            </select>
            <div class="acc__actions">
              <UiColorPicker :model-value="c.color" :label="`Colore di ${c.name}`" :presets="CATEGORY_COLORS" @update:model-value="(v) => ledger.updateCategory(c.id, { color: v })">
                <template #trigger="{ color }">
                  <button type="button" class="cat__colorbtn" :aria-label="`Cambia colore di ${c.name}`" title="Cambia colore"><span :style="{ background: color }" /></button>
                </template>
              </UiColorPicker>
              <UiButton size="sm" variant="ghost" icon="edit" :aria-label="`Rinomina ${c.name}`" @click="startEdit(c.id, c.name)" />
              <UiButton size="sm" variant="ghost" icon="trash" class="danger" :aria-label="`Elimina ${c.name}`" @click="deleteCategory(c)" />
            </div>
          </div>


          <div v-if="open.has(c.id)" class="subs">
            <ul>
              <li v-for="s in c.subcategories" :key="s.id" class="sub">
                <span class="sub__dot" :style="{ background: subcategoryColor(ledger.state.config, c.name, s.name, c.kind) }" aria-hidden="true" />
                <form v-if="editing?.key === s.id" class="inline" @submit.prevent="commitSub(c, s.id)">
                  <input v-model="editing.value" :data-edit="s.id" class="input" aria-label="Nuovo nome sotto-categoria" @keydown.esc="editing = null" />
                  <UiButton size="sm" type="submit" variant="primary" icon="check" aria-label="Salva nome" />
                  <UiButton size="sm" variant="ghost" icon="close" aria-label="Annulla" @click="editing = null" />
                </form>
                <span v-else class="sub__name">
                  {{ s.name }}
                  <button v-if="isInvestment(c)" type="button" class="sub__ins" :class="{ 'sub__ins--missing': !instrumentOf(c, s.name) }" @click="openInstrument(c.name, s.name)">
                    <template v-if="instrumentOf(c, s.name)">{{ INSTRUMENT_LABEL[instrumentOf(c, s.name)!.type ?? 'etf'] }} · {{ instrumentOf(c, s.name)!.ticker || instrumentOf(c, s.name)!.isin }}</template>
                    <template v-else>+ dati strumento</template>
                  </button>
                </span>
                <div v-if="editing?.key !== s.id" class="acc__actions">
                  <UiButton size="sm" variant="ghost" icon="edit" :aria-label="`Rinomina ${s.name}`" @click="startEdit(s.id, s.name)" />
                  <UiButton size="sm" variant="ghost" icon="trash" class="danger" :aria-label="`Elimina ${s.name}`" @click="deleteSub(c, s.id, s.name)" />
                </div>
              </li>
            </ul>
            <UiButton v-if="isInvestment(c)" size="sm" icon="plus" class="add--sub" @click="openInstrument(c.name, null)">Nuovo investimento (ETF, azione, obbligazione)</UiButton>
            <form v-else class="add add--sub" @submit.prevent="addSub(c)">
              <input v-model="newSub[c.id]" class="input" placeholder="Nuova sotto-categoria" :aria-label="`Nuova sotto-categoria di ${c.name}`" />
              <UiButton type="submit" size="sm" icon="plus" :disabled="!(newSub[c.id] ?? '').trim()">Aggiungi</UiButton>
            </form>
          </div>
        </li>
      </ul>

      <div v-if="unconfiguredCategories.length" class="found">
        <p class="small"><strong>Presenti nei movimenti ma non configurate:</strong></p>
        <div class="row">
          <button v-for="n in unconfiguredCategories" :key="n" type="button" class="chip" @click="adoptCategory(n)"><UiIcon name="plus" :size="14" />{{ n }}</button>
        </div>
      </div>
      <p class="muted small note">Rinominare una categoria non modifica il Google Sheet: il vecchio nome viene ricordato, così i movimenti sincronizzati continuano a ricadere nella categoria rinominata.</p>
    </section>

    <!-- DATI ------------------------------------------------------------->
    <section v-else class="panel" aria-labelledby="mg-data">
      <header class="panel__head">
        <h2 id="mg-data" class="panel__title"><span class="icon-chip"><UiIcon name="sheet" /></span>Dati e backup</h2>
      </header>
      <p class="secondary">
        Le voci inserite dall'app vengono scritte nelle schede <strong>Entrate</strong>, <strong>Uscite</strong> e <strong>Transazioni</strong> del foglio Google;
        conti, categorie, icone e saldi iniziali nella scheda nascosta <strong>_planner</strong>. Così li ritrovi su ogni dispositivo.
        <template v-if="ledger.pendingCount()"><br /><strong>{{ ledger.pendingCount() }} modifiche</strong> sono ancora solo in questo browser e verranno inviate alla prossima sincronizzazione.</template>
        Il backup .json resta utile come copia di sicurezza.
      </p>
      <div class="row data__actions">
        <UiButton variant="primary" icon="download" @click="exportBackup">Esporta backup (.json)</UiButton>
        <label class="file">
          <input type="file" accept="application/json,.json" class="sr-only" @change="importBackup" />
          <span><UiIcon name="upload" :size="17" /> Ripristina backup</span>
        </label>
        <UiButton variant="ghost" icon="trash" class="danger" @click="resetLedger">Ripristina predefiniti</UiButton>
      </div>
    </section>

    <AccountDialog :open="accDialog" :account="accEditing" :preset-name="accPreset" @close="accDialog = false" />
    <InstrumentDialog :open="insDialog" :category="insCategory" :subcategory="insSub" @close="insDialog = false" />
  </div>
</template>

<style scoped>
.mg { display: flex; flex-direction: column; gap: 18px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.acc, .cat__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border);
}
.acc__card { width: 58px; height: 38px; border-radius: 9px; box-shadow: 0 4px 10px rgba(19, 24, 17, 0.12); }
.acc__main, .cat__main { display: flex; flex-direction: column; min-width: 0; }
.acc__main strong, .cat__main strong { font-weight: 500; font-size: 1rem; }
.acc__bal { display: flex; flex-direction: column; align-items: flex-end; }
.acc__actions { display: flex; gap: 2px; align-items: center; }
.acc__default { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: var(--warning-soft); color: var(--status-warning); font-size: 0.72rem; font-weight: 600; vertical-align: middle; }
.acc__star { width: 32px; height: 32px; border: 0; border-radius: 999px; background: none; font-size: 1.1rem; color: var(--text-muted); cursor: pointer; }
.acc__star:hover { background: var(--surface-2); color: var(--status-warning); }
.acc__star.on { color: #e0a100; }
.cat__colorbtn { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); cursor: pointer; }
.cat__colorbtn span { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
.cat__colorbtn:hover, .cat__colorbtn[data-state='open'] { border-color: var(--ink); }
.cat--new { animation: cat-new 1.8s ease-out; }
@keyframes cat-new { 0%, 40% { background: var(--brand-soft); } 100% { background: transparent; } }

.composer { display: flex; flex-direction: column; gap: 10px; padding: 14px; margin-bottom: 12px; border-radius: 18px; background: var(--surface-2); border: 1px solid transparent; transition: border-color 0.15s ease; }
.composer:focus-within { border-color: var(--border-strong); background: var(--surface); box-shadow: 0 4px 18px rgba(18, 24, 33, 0.06); }
.composer--dup { border-color: var(--status-warning); }
.composer__main { display: flex; align-items: center; gap: 12px; }
.composer__name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.composer__input { border: 0; outline: 0; background: none; font: inherit; font-size: 1.05rem; font-weight: 500; color: var(--text-primary); padding: 4px 0; }
.composer__subs { border: 0; outline: 0; background: none; font: inherit; font-size: 0.85rem; color: var(--text-secondary); padding: 2px 0; }
.composer__input::placeholder, .composer__subs::placeholder { color: var(--text-muted); font-weight: 400; }
.composer__types { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-left: 56px; }
.composer__type { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); font: inherit; font-size: 0.82rem; cursor: pointer; }
.composer__type:hover { border-color: var(--ink); }
.composer__type.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.composer__chips { display: flex; gap: 6px; flex-wrap: wrap; padding-left: 56px; }
.composer__chip { padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; background: color-mix(in srgb, var(--c) 14%, var(--surface)); color: color-mix(in srgb, var(--c) 70%, #000); }
.composer__dup { padding-left: 56px; font-size: 0.85rem; color: var(--status-warning); }
.linkish { border: 0; background: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
.danger { color: var(--negative); }

.cat { border-bottom: 1px solid var(--border); }
.cat__row { grid-template-columns: auto auto minmax(0, 1fr) auto auto; border-bottom: 0; }
.cat__toggle { border: 0; background: none; cursor: pointer; padding: 4px; color: var(--text-muted); border-radius: 8px; }
.cat__toggle .closed { transform: rotate(-90deg); }
.cat__type { height: 34px; font-size: 0.82rem; max-width: 150px; }
.subs { padding: 0 4px 14px 76px; }
.subs ul { list-style: none; margin: 0; padding: 0; }
.sub { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 4px 0; min-height: 40px; }
.sub__dot { width: 12px; height: 12px; border-radius: 50%; }
.sub__name { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; white-space: nowrap; }
.sub__ins { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 1px 9px; font-size: 0.74rem; font-weight: 600; cursor: pointer; }
.sub__ins:hover { border-color: var(--ink); }
.sub__ins--missing { border-style: dashed; color: var(--accent); font-weight: 500; }
.inline { display: flex; gap: 6px; align-items: center; min-width: 0; }
.inline .input { height: 34px; flex: 1; min-width: 0; }
.sub .inline { grid-column: 2 / 4; }
.add { display: flex; gap: 8px; margin-bottom: 8px; }
.add .input { flex: 1; min-width: 0; }
.add--sub { margin: 8px 0 0; }
.add--sub .input { height: 34px; }
.empty { padding: 18px 0; }
.found { margin-top: 18px; padding: 14px 16px; border-radius: 18px; background: var(--surface-2); display: flex; flex-direction: column; gap: 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 999px;
  border: 1px dashed var(--border-strong); background: var(--surface); cursor: pointer; font-size: 0.85rem;
}
.chip:hover { border-style: solid; border-color: var(--ink); }
.note { margin-top: 14px; }
.data__actions { margin-top: 16px; }
.file span {
  display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 18px; border-radius: 999px;
  border: 1px solid var(--border-strong); cursor: pointer; font-weight: 500; background: var(--surface);
}
.file:hover span { background: var(--surface-2); }
.file:focus-within span { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 700px) {
  .acc { grid-template-columns: auto minmax(0, 1fr) auto; }
  .acc__bal { display: none; }
  .cat__row { grid-template-columns: auto auto minmax(0, 1fr) auto; }
  .cat__type { display: none; }
  .subs { padding-left: 20px; }
  .composer__main { flex-wrap: wrap; }
  .composer__name { flex-basis: calc(100% - 60px); }
}
</style>
