<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import UiPageHeader from '@/core/ui/UiPageHeader.vue'
import UiTabNav from '@/core/ui/UiTabNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { fmtLongDay } from '@/core/utils/dates'
import { usePrimaryAction } from '@/core/ui/primaryAction'
import CommitmentDialog from '../components/CommitmentDialog.vue'
import { useAgendaStore } from '../store/agendaStore'

const store = useAgendaStore()
const route = useRoute()
const tabs = computed(() => [
  { name: 'agenda-today', label: 'Oggi', icon: 'sun' as const, badge: store.overdue.length },
  { name: 'agenda-tasks', label: 'Task', icon: 'checkCircle' as const },
  { name: 'agenda-events', label: 'Eventi', icon: 'flag' as const },
  { name: 'agenda-calendar', label: 'Calendario', icon: 'calendar' as const },
  { name: 'agenda-commitments', label: 'Scadenze', icon: 'bell' as const },
  { name: 'goals', label: 'Obiettivi', icon: 'target' as const },
  { name: 'habits', label: 'Abitudini', icon: 'repeat' as const },
])
/** Obiettivi e Abitudini hanno le proprie azioni: «Nuovo task/evento» solo nelle sezioni dell'agenda. */
const isAgenda = computed(() => String(route.name ?? '').startsWith('agenda-'))
const onEvents = computed(() => route.name === 'agenda-events')
const onTasks = computed(() => route.name === 'agenda-tasks')

/** «+» su mobile: nella sezione Eventi crea un evento, in Task un task, altrove chiede quale dei due. */
usePrimaryAction(() => {
  if (!isAgenda.value) return null
  if (onEvents.value) return { label: 'Nuovo evento', run: () => store.openEditor({ kind: 'event' }) }
  if (onTasks.value) return { label: 'Nuovo task', run: () => store.openEditor({ kind: 'task' }) }
  return {
    label: 'Nuovo task o evento',
    menu: [
      { label: 'Nuovo task', icon: 'checkCircle', run: () => store.openEditor({ kind: 'task' }) },
      { label: 'Nuovo evento', icon: 'calendar', run: () => store.openEditor({ kind: 'event' }) },
    ],
  }
})
</script>

<template>
  <div class="ag">
    <UiPageHeader title="Planner" :subtitle="fmtLongDay(store.today)">
      <template v-if="isAgenda">
        <UiButton :variant="onEvents ? 'secondary' : 'primary'" icon="plus" @click="store.openEditor({ kind: 'task' })">Nuovo task</UiButton>
        <UiButton :variant="onEvents ? 'primary' : 'secondary'" icon="calendar" @click="store.openEditor({ kind: 'event' })">Nuovo evento</UiButton>
      </template>
    </UiPageHeader>
    <UiTabNav :tabs="tabs" label="Sezioni del planner" />
    <UiAlert v-if="isAgenda && store.saveFailed" tone="critical" title="Salvataggio non riuscito">
      Il browser non permette di salvare i dati (spazio pieno o modalità privata): le ultime modifiche andranno perse alla chiusura.
    </UiAlert>
    <RouterView />
    <CommitmentDialog />
  </div>
</template>

<style scoped>
.ag { display: flex; flex-direction: column; gap: 20px; }
</style>
