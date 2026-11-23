<script setup lang="ts">
/**
 * Inserimento e modifica di un impegno: titolo, categoria, prossima scadenza, cadenza,
 * modo di calcolo (date fisse / dal completamento), preavviso e note.
 */
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import { fmtShortDay, isoWeekday, WEEKDAY_SHORT } from '@/core/utils/dates'
import { CATEGORIES, REMIND_OPTIONS, remindLabel } from '../domain/catalog'
import { isValidDay, previewDates, recurrenceLabel, UNIT_LABEL, type RepeatUnit, type ScheduleMode } from '../domain/recurrence'
import { useAgendaStore } from '../store/agendaStore'

const store = useAgendaStore()
const ed = store.editor

/** Cadenze rapide; «custom» apre i campi «ogni N unità». */
const PRESETS: { id: string; label: string; unit: RepeatUnit; every: number }[] = [
  { id: 'none', label: 'Una volta', unit: 'none', every: 1 },
  { id: 'day', label: 'Ogni giorno', unit: 'day', every: 1 },
  { id: 'week', label: 'Ogni settimana', unit: 'week', every: 1 },
  { id: 'month', label: 'Ogni mese', unit: 'month', every: 1 },
  { id: 'm3', label: 'Ogni 3 mesi', unit: 'month', every: 3 },
  { id: 'm6', label: 'Ogni 6 mesi', unit: 'month', every: 6 },
  { id: 'year', label: 'Ogni anno', unit: 'year', every: 1 },
  { id: 'y2', label: 'Ogni 2 anni', unit: 'year', every: 2 },
]

const form = reactive({
  title: '',
  category: 'casa',
  start: store.today,
  unit: 'none' as RepeatUnit,
  every: 1,
  weekdays: [] as number[],
  mode: 'fixed' as ScheduleMode,
  remindDays: 7,
  notes: '',
  until: '',
})
const custom = ref(false)
const confirmDelete = ref(false)

watch(
  () => ed.open,
  (open) => {
    if (!open) return
    confirmDelete.value = false
    const c = ed.commitment
    const t = ed.template
    form.title = c?.title ?? t?.title ?? ''
    form.category = c?.category ?? t?.category ?? 'casa'
    form.start = c?.start ?? ed.date ?? store.today
    form.unit = c?.repeat.unit ?? t?.repeat.unit ?? 'none'
    form.every = c?.repeat.every ?? t?.repeat.every ?? 1
    form.weekdays = [...(c?.repeat.weekdays ?? [])]
    form.mode = c?.mode ?? t?.mode ?? 'fixed'
    form.remindDays = c?.remindDays ?? t?.remindDays ?? 7
    form.notes = c?.notes ?? t?.notes ?? ''
    form.until = c?.until ?? ''
    custom.value = !PRESETS.some((p) => p.unit === form.unit && p.every === form.every)
  },
  { immediate: true },
)

const presetId = computed(() => (custom.value ? 'custom' : PRESETS.find((p) => p.unit === form.unit && p.every === form.every)?.id ?? 'custom'))
function pickPreset(id: string) {
  if (id === 'custom') {
    custom.value = true
    if (form.unit === 'none') form.unit = 'month'
    return
  }
  const p = PRESETS.find((x) => x.id === id)!
  custom.value = false
  form.unit = p.unit
  form.every = p.every
}

function toggleWeekday(d: number) {
  const days = form.weekdays.length ? form.weekdays : [isoWeekday(form.start)]
  form.weekdays = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
}
const activeWeekdays = computed(() => (form.weekdays.length ? form.weekdays : isValidDay(form.start) ? [isoWeekday(form.start)] : []))

const catOptions: ComboOption[] = CATEGORIES.map((c) => ({ value: c.id, label: c.label, emoji: c.emoji }))
const repeating = computed(() => form.unit !== 'none')
/** «Dal completamento» ha senso per cadenze lunghe, non per attività quotidiane o su più giorni della settimana. */
const modeAllowed = computed(() => repeating.value && form.unit !== 'day' && !(form.unit === 'week' && activeWeekdays.value.length > 1))
const effectiveMode = computed<ScheduleMode>(() => (modeAllowed.value ? form.mode : 'fixed'))
const repeat = computed(() => ({ unit: form.unit, every: Math.max(1, Math.floor(Number(form.every) || 1)), ...(form.unit === 'week' && form.weekdays.length ? { weekdays: [...form.weekdays] } : {}) }))
const valid = computed(() => !!form.title.trim() && isValidDay(form.start) && (!form.until || form.until >= form.start))
const preview = computed(() => (valid.value ? previewDates({ start: form.start, repeat: repeat.value, mode: effectiveMode.value }, 5) : []))

function save() {
  if (!valid.value) return
  const draft = {
    title: form.title.trim(),
    category: form.category,
    start: form.start,
    repeat: repeat.value,
    mode: effectiveMode.value,
    remindDays: form.remindDays,
    notes: form.notes.trim() || undefined,
    until: repeating.value && form.until ? form.until : null,
    paused: ed.commitment?.paused ?? false,
  }
  if (ed.commitment) store.update(ed.commitment.id, draft)
  else store.add(draft)
  store.closeEditor()
}

function remove() {
  if (!ed.commitment) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  store.remove(ed.commitment.id)
  store.closeEditor()
}
</script>

<template>
  <UiDialog :open="ed.open" :title="ed.commitment ? 'Modifica impegno' : 'Nuovo impegno'" :width="600" @close="store.closeEditor()">
    <form id="commitment-form" class="cf" @submit.prevent="save">
      <label class="cf__field">
        <span>Cosa</span>
        <input v-model="form.title" class="input" placeholder="Es. Revisione auto, cambio filtri condizionatore…" required maxlength="120" autocomplete="off" />
      </label>

      <div class="cf__grid">
        <div class="cf__field">
          <span>Categoria</span>
          <UiCombobox v-model="form.category" :options="catOptions" label="Categoria" />
        </div>
        <div class="cf__field">
          <span>{{ repeating ? 'Prossima scadenza' : 'Data' }}</span>
          <UiDatePicker v-model="form.start" label="Prossima scadenza" required :shortcuts="false" />
        </div>
      </div>

      <fieldset class="cf__set">
        <legend>Si ripete</legend>
        <div class="cf__chips">
          <button v-for="p in PRESETS" :key="p.id" type="button" class="chip" :class="{ on: presetId === p.id }" :aria-pressed="presetId === p.id" @click="pickPreset(p.id)">{{ p.label }}</button>
          <button type="button" class="chip" :class="{ on: presetId === 'custom' }" :aria-pressed="presetId === 'custom'" @click="pickPreset('custom')">Personalizzata…</button>
        </div>
        <div v-if="presetId === 'custom'" class="cf__custom">
          <span>Ogni</span>
          <input v-model.number="form.every" class="input cf__num num" type="number" min="1" max="365" aria-label="Intervallo" />
          <select v-model="form.unit" class="input" aria-label="Unità">
            <option v-for="(l, u) in UNIT_LABEL" :key="u" :value="u">{{ form.every === 1 ? l[0] : l[1] }}</option>
          </select>
        </div>
        <div v-if="form.unit === 'week'" class="cf__days" role="group" aria-label="Giorni della settimana">
          <button v-for="(d, i) in WEEKDAY_SHORT" :key="d" type="button" class="day" :class="{ on: activeWeekdays.includes(i + 1) }" :aria-pressed="activeWeekdays.includes(i + 1)" @click="toggleWeekday(i + 1)">{{ d }}</button>
        </div>
      </fieldset>

      <fieldset v-if="modeAllowed" class="cf__set">
        <legend>Come si calcola la scadenza successiva</legend>
        <div class="cf__modes">
          <label class="mode" :class="{ on: form.mode === 'fixed' }">
            <input v-model="form.mode" type="radio" value="fixed" class="sr-only" />
            <strong>Date fisse</strong>
            <span>Sempre alla stessa data (es. bollo, assicurazione, revisione).</span>
          </label>
          <label class="mode" :class="{ on: form.mode === 'afterDone' }">
            <input v-model="form.mode" type="radio" value="afterDone" class="sr-only" />
            <strong>Dal completamento</strong>
            <span>Conta dal giorno in cui l'hai fatto (es. filtri, tagliando).</span>
          </label>
        </div>
      </fieldset>

      <div class="cf__grid">
        <label class="cf__field">
          <span>Avvisami</span>
          <select v-model.number="form.remindDays" class="input">
            <option v-for="n in REMIND_OPTIONS" :key="n" :value="n">{{ remindLabel(n) }}</option>
          </select>
        </label>
        <div v-if="repeating" class="cf__field">
          <span>Fino al <em class="muted">(facoltativo)</em></span>
          <UiDatePicker v-model="form.until" label="Ultima scadenza" :shortcuts="false" />
        </div>
      </div>

      <label class="cf__field">
        <span>Note</span>
        <textarea v-model="form.notes" class="input" rows="2" maxlength="1000" placeholder="Officina, costo, codice filtro…" />
      </label>

      <div v-if="preview.length" class="cf__preview">
        <p class="muted small">{{ recurrenceLabel(repeat, form.start) }}<template v-if="effectiveMode === 'afterDone'"> · date stimate, si aggiornano quando segni «fatto»</template></p>
        <ul>
          <li v-for="d in preview" :key="d">{{ fmtShortDay(d) }} {{ d.slice(0, 4) !== store.today.slice(0, 4) ? d.slice(0, 4) : '' }}</li>
        </ul>
      </div>
      <UiAlert v-if="form.until && form.until < form.start" tone="warning">La data di fine è precedente alla prima scadenza.</UiAlert>
    </form>
    <template #footer>
      <UiButton v-if="ed.commitment" variant="ghost" icon="trash" class="cf__del" @click="remove">{{ confirmDelete ? 'Conferma eliminazione' : 'Elimina' }}</UiButton>
      <UiButton @click="store.closeEditor()">Annulla</UiButton>
      <UiButton type="submit" form="commitment-form" variant="primary" :disabled="!valid">{{ ed.commitment ? 'Salva' : 'Aggiungi' }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.cf { display: flex; flex-direction: column; gap: 14px; }
.cf__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.cf__field em { font-style: normal; }
.cf__field .input { font-size: 0.95rem; color: var(--text-primary); }
.cf__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.cf__set { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.cf__set legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.cf__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 0.84rem; cursor: pointer; }
.chip:hover { background: var(--surface-2); }
.chip.on { background: var(--ink); color: var(--brand); border-color: var(--ink); }
.cf__custom { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
.cf__num { width: 80px; }
.cf__days { display: flex; gap: 6px; flex-wrap: wrap; }
.day { width: 46px; height: 36px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; font-size: 0.82rem; }
.day.on { background: var(--brand); border-color: var(--ink); color: var(--on-brand); font-weight: 600; }
.cf__modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mode { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--border-strong); cursor: pointer; font-size: 0.9rem; }
.mode span { font-size: 0.76rem; color: var(--text-muted); }
.mode.on { border-color: var(--ink); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.mode:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.cf__preview { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
.cf__preview ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.cf__preview li { padding: 4px 10px; border-radius: 10px; background: var(--surface); font-size: 0.82rem; }
.cf__del { margin-right: auto; color: var(--negative); }
@media (max-width: 520px) { .cf__grid, .cf__modes { grid-template-columns: 1fr; } }
</style>
