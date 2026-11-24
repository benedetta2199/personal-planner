<script setup lang="ts">
/** Eventi (anche su più giorni): in corso, in arrivo nei prossimi 12 mesi e, a richiesta, quelli passati. */
import { computed, ref } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import { addDaysTo, addMonthsTo, fmtMonthYear } from '@/core/utils/dates'
import OccurrenceRow from '../components/OccurrenceRow.vue'
import { isEvent, type Occurrence } from '../domain/recurrence'
import { useAgendaStore } from '../store/agendaStore'

const store = useAgendaStore()
const showPast = ref(false)

const hasEvents = computed(() => store.state.commitments.some((c) => isEvent(c)))
const events = (from: string, to: string) => store.occurrences(from, to).filter((o) => isEvent(o.commitment))

const ongoing = computed(() => events(store.today, store.today))
const upcoming = computed(() => events(addDaysTo(store.today, 1), addMonthsTo(store.today, 12)).filter((o) => o.date > store.today))
const past = computed(() => (showPast.value ? events(addMonthsTo(store.today, -12), addDaysTo(store.today, -1)).filter((o) => o.end < store.today).reverse() : []))

function byMonth(list: Occurrence[]) {
  const map = new Map<string, Occurrence[]>()
  for (const o of list) {
    const k = o.date.slice(0, 7)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(o)
  }
  return [...map.entries()].map(([k, items]) => ({ key: k, title: fmtMonthYear(`${k}-01`), items }))
}
const upcomingGroups = computed(() => byMonth(upcoming.value))
const pastGroups = computed(() => byMonth(past.value))
</script>

<template>
  <div class="ev">
    <section v-if="!hasEvents" class="panel">
      <UiEmpty title="Nessun evento" icon="calendar">
        Gli eventi sono cose che accadono in una data o per più giorni — un viaggio, un compleanno, una conferenza — e non vanno spuntati come i task.
        <template #actions><UiButton variant="primary" icon="plus" @click="store.openEditor({ kind: 'event' })">Nuovo evento</UiButton></template>
      </UiEmpty>
    </section>

    <template v-else>
      <section v-if="ongoing.length" class="panel">
        <h2 class="panel__title ev__title">In corso</h2>
        <ul class="list"><OccurrenceRow v-for="o in ongoing" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
      </section>

      <section class="panel">
        <div class="panel__head">
          <h2 class="panel__title">Prossimi 12 mesi</h2>
          <label class="ev__toggle small"><input v-model="showPast" type="checkbox" /> Mostra passati</label>
        </div>
        <div v-for="g in upcomingGroups" :key="g.key" class="ev__group">
          <h3>{{ g.title }}</h3>
          <ul class="list"><OccurrenceRow v-for="o in g.items" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
        </div>
        <p v-if="!upcomingGroups.length" class="muted small">Nessun evento in arrivo.</p>
      </section>

      <section v-if="showPast" class="panel">
        <h2 class="panel__title ev__title">Ultimi 12 mesi</h2>
        <div v-for="g in pastGroups" :key="g.key" class="ev__group">
          <h3>{{ g.title }}</h3>
          <ul class="list"><OccurrenceRow v-for="o in g.items" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
        </div>
        <p v-if="!pastGroups.length" class="muted small">Nessun evento passato.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ev { display: flex; flex-direction: column; gap: var(--space-4); }
.ev__title { margin-bottom: 6px; }
.ev__toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); cursor: pointer; }
.ev__group { margin-top: 10px; }
.ev__group h3 { font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.list { list-style: none; margin: 0; padding: 0; }
</style>
