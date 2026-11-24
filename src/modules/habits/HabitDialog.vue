<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { WEEKDAY_SHORT } from '@/core/utils/dates'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { HABIT_COLORS, HABIT_EMOJIS, frequencyOf, targetOf, type Habit, type HabitFrequency } from './domain'
import { useHabitsStore } from './store'

const props = defineProps<{ open: boolean; habit: Habit | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useHabitsStore()

const FREQUENCIES: { value: HabitFrequency; label: string }[] = [
  { value: 'week', label: 'Settimanale' },
  { value: 'halfmonth', label: 'Ogni mezzo mese' },
  { value: 'month', label: 'Mensile' },
]
const form = reactive({ name: '', emoji: HABIT_EMOJIS[0], color: HABIT_COLORS[0], weekdays: [1, 2, 3, 4, 5, 6, 7], frequency: 'week' as HabitFrequency, target: 1 })
/** Massimo di volte per periodo: i giorni del periodo. */
const maxTarget = computed(() => (form.frequency === 'month' ? 31 : 16))
const confirmDelete = ref(false)

watch(
  () => props.open,
  (o) => {
    if (!o) return
    const h = props.habit
    confirmDelete.value = false
    form.name = h?.name ?? ''
    form.emoji = h?.emoji ?? HABIT_EMOJIS[store.state.habits.length % HABIT_EMOJIS.length]
    form.color = h?.color ?? HABIT_COLORS[store.state.habits.length % HABIT_COLORS.length]
    form.weekdays = [...(h?.weekdays ?? [1, 2, 3, 4, 5, 6, 7])]
    form.frequency = h ? frequencyOf(h) : 'week'
    form.target = h ? targetOf(h) : 1
  },
  { immediate: true },
)

const PRESETS = [
  { label: 'Tutti i giorni', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Giorni feriali', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend', days: [6, 7] },
]
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x))
function toggleDay(d: number) {
  form.weekdays = form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort()
}
const periodic = computed(() => form.frequency !== 'week')
const cleanTarget = computed(() => Math.min(maxTarget.value, Math.max(1, Math.floor(Number(form.target) || 1))))
const valid = computed(() => !!form.name.trim() && (periodic.value || form.weekdays.length > 0))

function save() {
  if (!valid.value) return
  const d = {
    name: form.name.trim(),
    emoji: form.emoji,
    color: form.color,
    // I giorni restano salvati: tornando alla cadenza settimanale si ritrovano.
    weekdays: form.weekdays.length ? [...form.weekdays] : [1, 2, 3, 4, 5, 6, 7],
    frequency: form.frequency,
    target: periodic.value ? cleanTarget.value : undefined,
  }
  if (props.habit) store.update(props.habit.id, d)
  else store.add(d)
  emit('close')
}
function remove() {
  if (!props.habit) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  store.remove(props.habit.id)
  emit('close')
}
function archive() {
  if (!props.habit) return
  store.setArchived(props.habit.id, !props.habit.archived)
  emit('close')
}
</script>

<template>
  <UiDialog :open="open" :title="habit ? 'Modifica abitudine' : 'Nuova abitudine'" :width="520" @close="emit('close')">
    <form id="habit-form" class="hf" @submit.prevent="save">
      <label class="hf__field">
        <span>Abitudine</span>
        <input v-model="form.name" class="input" placeholder="Es. Bere 2 litri d'acqua, 20 minuti di lettura" required maxlength="80" autocomplete="off" />
      </label>

      <fieldset class="hf__set">
        <legend>Icona</legend>
        <div class="hf__emojis">
          <button v-for="e in HABIT_EMOJIS" :key="e" type="button" class="em" :class="{ on: form.emoji === e }" :aria-pressed="form.emoji === e" :aria-label="e" @click="form.emoji = e">{{ e }}</button>
        </div>
      </fieldset>

      <fieldset class="hf__set">
        <legend>Colore</legend>
        <div class="hf__colors">
          <button v-for="c in HABIT_COLORS" :key="c" type="button" class="sw" :class="{ on: form.color === c }" :style="{ background: `var(${c})` }" :aria-pressed="form.color === c" :aria-label="`Colore ${c.replace('--series-', '')}`" @click="form.color = c" />
        </div>
      </fieldset>

      <fieldset class="hf__set">
        <legend>Quando</legend>
        <UiSegmented v-model="form.frequency" :options="FREQUENCIES" label="Cadenza" class="hf__freq" />
        <template v-if="!periodic">
          <div class="hf__presets">
            <button v-for="p in PRESETS" :key="p.label" type="button" class="chip" :class="{ on: same(form.weekdays, p.days) }" @click="form.weekdays = [...p.days]">{{ p.label }}</button>
          </div>
          <div class="hf__days" role="group" aria-label="Giorni della settimana">
            <button v-for="(d, i) in WEEKDAY_SHORT" :key="d" type="button" class="day" :class="{ on: form.weekdays.includes(i + 1) }" :aria-pressed="form.weekdays.includes(i + 1)" @click="toggleDay(i + 1)">{{ d }}</button>
          </div>
        </template>
        <template v-else>
          <div class="hf__target">
            <UiButton size="sm" icon="minus" aria-label="Una volta in meno" :disabled="cleanTarget <= 1" @click="form.target = cleanTarget - 1" />
            <input v-model.number="form.target" class="input num" type="number" min="1" :max="maxTarget" aria-label="Volte per periodo" />
            <UiButton size="sm" icon="plus" aria-label="Una volta in più" :disabled="cleanTarget >= maxTarget" @click="form.target = cleanTarget + 1" />
            <span>{{ cleanTarget === 1 ? 'volta' : 'volte' }} {{ form.frequency === 'month' ? 'al mese' : 'ogni mezzo mese (1–15 e 16–fine mese)' }}</span>
          </div>
          <p class="muted small">Segni i giorni in cui la fai, quando vuoi: l'abitudine resta tra quelle di oggi finché non raggiungi l'obiettivo del periodo.</p>
        </template>
      </fieldset>
    </form>
    <template #footer>
      <template v-if="habit">
        <UiButton variant="ghost" icon="trash" class="hf__del" @click="remove">{{ confirmDelete ? 'Conferma (cancella lo storico)' : 'Elimina' }}</UiButton>
        <UiButton variant="ghost" @click="archive">{{ habit.archived ? 'Ripristina' : 'Archivia' }}</UiButton>
      </template>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="habit-form" variant="primary" :disabled="!valid">{{ habit ? 'Salva' : 'Aggiungi' }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.hf { display: flex; flex-direction: column; gap: 14px; }
.hf__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); }
.hf__field .input { font-size: 0.95rem; color: var(--text-primary); }
.hf__set { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.hf__set legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.hf__emojis { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.em { height: 40px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); font-size: 1.2rem; cursor: pointer; }
.em.on { border-color: var(--ink); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--ink); }
.hf__colors { display: flex; gap: 8px; flex-wrap: wrap; }
.sw { width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; }
.sw.on { outline: 2px solid var(--ink); outline-offset: 2px; }
.hf__presets { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 5px 12px; font-size: 0.83rem; cursor: pointer; }
.chip.on { background: var(--ink); color: var(--brand); border-color: var(--ink); }
.hf__days { display: flex; gap: 6px; flex-wrap: wrap; }
.day { width: 46px; height: 36px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; font-size: 0.82rem; }
.day.on { background: var(--brand); border-color: var(--ink); color: var(--on-brand); font-weight: 600; }
.hf__del { margin-right: auto; color: var(--negative); }
.hf__freq { align-self: flex-start; }
.hf__target { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.9rem; }
.hf__target .input { width: 64px; text-align: center; }
@media (max-width: 420px) { .hf__emojis { grid-template-columns: repeat(6, 1fr); } }
</style>
