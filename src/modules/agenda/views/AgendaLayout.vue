<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import UiPageHeader from '@/core/ui/UiPageHeader.vue'
import UiTabNav from '@/core/ui/UiTabNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { fmtLongDay } from '@/core/utils/dates'
import CommitmentDialog from '../components/CommitmentDialog.vue'
import { useAgendaStore } from '../store/agendaStore'

const store = useAgendaStore()
const route = useRoute()
const tabs = computed(() => [
  { name: 'agenda-today', label: 'Oggi', icon: 'sun' as const, badge: store.overdue.length },
  { name: 'agenda-tasks', label: 'Task', icon: 'checkCircle' as const },
  { name: 'agenda-calendar', label: 'Calendario', icon: 'calendar' as const },
  { name: 'agenda-commitments', label: 'Scadenze', icon: 'bell' as const },
  { name: 'goals', label: 'Obiettivi', icon: 'target' as const },
  { name: 'habits', label: 'Abitudini', icon: 'repeat' as const },
])
/** Obiettivi e Abitudini hanno le proprie azioni: «Nuovo impegno» solo nelle sezioni dell'agenda. */
const isAgenda = computed(() => String(route.name ?? '').startsWith('agenda-'))
</script>

<template>
  <div class="ag">
    <UiPageHeader title="Planner" :subtitle="fmtLongDay(store.today)">
      <UiButton v-if="isAgenda" variant="primary" icon="plus" @click="store.openEditor()">Nuovo impegno</UiButton>
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
