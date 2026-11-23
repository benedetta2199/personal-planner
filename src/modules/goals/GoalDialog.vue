<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import UiDialog from '@/core/ui/UiDialog.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiCombobox, { type ComboOption } from '@/core/ui/UiCombobox.vue'
import UiDatePicker from '@/core/ui/UiDatePicker.vue'
import { uid } from '@/core/utils/persisted'
import { GOAL_AREAS, type Goal } from './domain'
import { useGoalsStore } from './store'

const props = defineProps<{ open: boolean; goal: Goal | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useGoalsStore()

interface MilestoneForm { id: string; title: string; due: string; done: boolean }
const form = reactive({ title: '', area: 'crescita', why: '', targetDate: '', manualProgress: 0, milestones: [] as MilestoneForm[] })
const newMilestone = ref('')
const confirmDelete = ref(false)

watch(
  () => props.open,
  (o) => {
    if (!o) return
    const g = props.goal
    confirmDelete.value = false
    newMilestone.value = ''
    form.title = g?.title ?? ''
    form.area = g?.area ?? 'crescita'
    form.why = g?.why ?? ''
    form.targetDate = g?.targetDate ?? ''
    form.manualProgress = g?.manualProgress ?? 0
    form.milestones = (g?.milestones ?? []).map((m) => ({ ...m, due: m.due ?? '' }))
  },
  { immediate: true },
)

const areaOptions: ComboOption[] = GOAL_AREAS.map((a) => ({ value: a.id, label: a.label, emoji: a.emoji }))
const valid = computed(() => !!form.title.trim())

function addMilestone() {
  const t = newMilestone.value.trim()
  if (!t) return
  form.milestones.push({ id: uid(), title: t, due: '', done: false })
  newMilestone.value = ''
}
function move(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= form.milestones.length) return
  const [m] = form.milestones.splice(i, 1)
  form.milestones.splice(j, 0, m)
}

function save() {
  if (!valid.value) return
  const draft = {
    title: form.title.trim(),
    area: form.area,
    why: form.why.trim() || undefined,
    targetDate: form.targetDate || null,
    manualProgress: Math.min(100, Math.max(0, Number(form.manualProgress) || 0)),
    milestones: form.milestones.filter((m) => m.title.trim()).map((m) => ({ ...m, title: m.title.trim(), due: m.due || null })),
  }
  if (props.goal) store.update(props.goal.id, draft)
  else store.add(draft)
  emit('close')
}
function remove() {
  if (!props.goal) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  store.remove(props.goal.id)
  emit('close')
}
</script>

<template>
  <UiDialog :open="open" :title="goal ? 'Modifica obiettivo' : 'Nuovo obiettivo'" :width="620" @close="emit('close')">
    <form id="goal-form" class="gf" @submit.prevent="save">
      <label class="gf__field">
        <span>Obiettivo</span>
        <input v-model="form.title" class="input" placeholder="Es. Correre una mezza maratona" required maxlength="140" autocomplete="off" />
      </label>
      <div class="gf__grid">
        <div class="gf__field">
          <span>Area</span>
          <UiCombobox v-model="form.area" :options="areaOptions" label="Area" />
        </div>
        <div class="gf__field">
          <span>Entro il <em class="muted">(facoltativo)</em></span>
          <UiDatePicker v-model="form.targetDate" label="Data obiettivo" :shortcuts="false" />
        </div>
      </div>
      <label class="gf__field">
        <span>Perché è importante per me</span>
        <textarea v-model="form.why" class="input" rows="2" maxlength="600" placeholder="La motivazione da rileggere quando cala l'entusiasmo" />
      </label>

      <fieldset class="gf__ms">
        <legend>Tappe</legend>
        <ol v-if="form.milestones.length">
          <li v-for="(m, i) in form.milestones" :key="m.id">
            <input v-model="m.done" type="checkbox" :aria-label="`Tappa ${i + 1} completata`" />
            <input v-model="m.title" class="input" :aria-label="`Tappa ${i + 1}`" maxlength="140" />
            <UiDatePicker v-model="m.due" :label="`Scadenza tappa ${i + 1}`" :shortcuts="false" class="gf__mdate" />
            <span class="gf__mact">
              <UiButton size="sm" variant="ghost" icon="arrowUp" aria-label="Sposta su" :disabled="i === 0" @click="move(i, -1)" />
              <UiButton size="sm" variant="ghost" icon="close" aria-label="Rimuovi tappa" @click="form.milestones.splice(i, 1)" />
            </span>
          </li>
        </ol>
        <div class="gf__add">
          <input v-model="newMilestone" class="input" placeholder="Aggiungi una tappa e premi Invio" maxlength="140" @keydown.enter.prevent="addMilestone" />
          <UiButton icon="plus" :disabled="!newMilestone.trim()" @click="addMilestone">Aggiungi</UiButton>
        </div>
        <p class="muted small">Le tappe con una data compaiono anche nel calendario dell'Agenda.</p>
      </fieldset>

      <label v-if="!form.milestones.length" class="gf__field">
        <span>Avanzamento manuale: <strong class="num">{{ form.manualProgress }}%</strong></span>
        <input v-model.number="form.manualProgress" type="range" min="0" max="100" step="5" />
      </label>
    </form>
    <template #footer>
      <UiButton v-if="goal" variant="ghost" icon="trash" class="gf__del" @click="remove">{{ confirmDelete ? 'Conferma eliminazione' : 'Elimina' }}</UiButton>
      <UiButton @click="emit('close')">Annulla</UiButton>
      <UiButton type="submit" form="goal-form" variant="primary" :disabled="!valid">{{ goal ? 'Salva' : 'Crea obiettivo' }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.gf { display: flex; flex-direction: column; gap: 14px; }
.gf__field { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
.gf__field em { font-style: normal; }
.gf__field .input { font-size: 0.95rem; color: var(--text-primary); }
.gf__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.gf__ms { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.gf__ms legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.gf__ms ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.gf__ms li { display: grid; grid-template-columns: auto minmax(0, 1fr) 170px auto; gap: 6px; align-items: center; }
.gf__mact { display: flex; }
.gf__add { display: flex; gap: 8px; }
.gf__add .input { flex: 1; }
.gf__del { margin-right: auto; color: var(--negative); }
@media (max-width: 560px) {
  .gf__grid { grid-template-columns: 1fr; }
  .gf__ms li { grid-template-columns: auto minmax(0, 1fr) auto; }
  .gf__mdate { grid-column: 2 / -1; }
}
</style>
