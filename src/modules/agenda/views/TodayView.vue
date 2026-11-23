<script setup lang="ts">
/** Panoramica del giorno: cosa è in ritardo, cosa c'è oggi, cosa sta arrivando, abitudini e tappe degli obiettivi. */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { addDaysTo, fmtShortDay, relativeDays } from '@/core/utils/dates'
import OccurrenceRow from '../components/OccurrenceRow.vue'
import { useAgendaStore } from '../store/agendaStore'
import { useHabitsStore } from '@/modules/habits/store'
import { isScheduled } from '@/modules/habits/domain'
import { useGoalsStore } from '@/modules/goals/store'
import { areaOf } from '@/modules/goals/domain'

const store = useAgendaStore()
const habits = useHabitsStore()
const goals = useGoalsStore()
const router = useRouter()

const todayList = computed(() => store.occurrences(store.today, store.today))
const todayOpen = computed(() => todayList.value.filter((o) => o.status !== 'done').length)
const week = computed(() => store.occurrences(addDaysTo(store.today, 1), addDaysTo(store.today, 7)).filter((o) => !o.projected))
/** In arrivo oltre la settimana, ma già dentro il periodo di preavviso. */
const later = computed(() => store.upcoming.filter((o) => o.date > addDaysTo(store.today, 7)))

const todayHabits = computed(() => habits.habits.filter((h) => isScheduled(h, store.today)))
const habitsDone = computed(() => todayHabits.value.filter((h) => habits.isDone(h.id, store.today)).length)
const goalItems = computed(() => goals.datedItems(store.today, addDaysTo(store.today, 30)).filter((i) => !i.done))
const empty = computed(() => !store.state.commitments.length)
</script>

<template>
  <div class="td">
    <div class="grid grid-kpi">
      <div class="kpi" :class="{ 'kpi--alert': store.overdue.length }">
        <span class="kpi__label">In ritardo</span>
        <span class="kpi__value num">{{ store.overdue.length }}</span>
      </div>
      <div class="kpi kpi--brand">
        <span class="kpi__label">Da fare oggi</span>
        <span class="kpi__value num">{{ todayOpen }}<small v-if="todayList.length"> / {{ todayList.length }}</small></span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Prossimi 7 giorni</span>
        <span class="kpi__value num">{{ week.length }}</span>
      </div>
      <div class="kpi">
        <span class="kpi__label">Abitudini di oggi</span>
        <span class="kpi__value num">{{ habitsDone }}<small> / {{ todayHabits.length }}</small></span>
      </div>
    </div>

    <section v-if="empty" class="panel">
      <UiEmpty title="Nessun impegno ancora" icon="bell">
        Aggiungi scadenze e attività ricorrenti — revisione dell'auto, filtri del condizionatore, bollette — e le ritroverai qui, nel calendario e tra i task del giorno, della settimana, del mese e dell'anno.
        <template #actions>
          <UiButton variant="primary" icon="plus" @click="store.openEditor()">Nuovo impegno</UiButton>
          <UiButton @click="router.push({ name: 'agenda-commitments' })">Scegli da un modello</UiButton>
        </template>
      </UiEmpty>
    </section>

    <div v-else class="td__cols">
      <div class="stack">
        <section v-if="store.overdue.length" class="panel panel--alert">
          <h2 class="panel__title"><UiIcon name="alert" /> In ritardo</h2>
          <ul class="list"><OccurrenceRow v-for="o in store.overdue" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><UiIcon name="sun" /> Oggi</h2>
            <UiButton size="sm" variant="ghost" icon="plus" @click="store.openEditor({ date: store.today })">Aggiungi</UiButton>
          </div>
          <ul v-if="todayList.length" class="list"><OccurrenceRow v-for="o in todayList" :key="o.commitment.id + o.date" :occurrence="o" :show-date="false" /></ul>
          <p v-else class="muted small">Niente in programma per oggi.</p>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><UiIcon name="calendar" /> Prossimi 7 giorni</h2>
            <RouterLink :to="{ name: 'agenda-tasks', query: { period: 'week' } }" class="small">Tutta la settimana</RouterLink>
          </div>
          <ul v-if="week.length" class="list"><OccurrenceRow v-for="o in week" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
          <p v-else class="muted small">Settimana libera.</p>
        </section>

        <section v-if="later.length" class="panel">
          <h2 class="panel__title"><UiIcon name="bell" /> In arrivo</h2>
          <p class="muted small td__hint">Scadenze più lontane, già dentro il periodo di preavviso che hai impostato.</p>
          <ul class="list"><OccurrenceRow v-for="o in later" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
        </section>
      </div>

      <aside class="stack">
        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><UiIcon name="repeat" /> Abitudini</h2>
            <RouterLink to="/abitudini" class="small">Apri</RouterLink>
          </div>
          <ul v-if="todayHabits.length" class="hb">
            <li v-for="h in todayHabits" :key="h.id">
              <button type="button" class="hb__btn" :class="{ on: habits.isDone(h.id, store.today) }" :aria-pressed="habits.isDone(h.id, store.today)" :style="{ '--c': `var(${h.color})` }" @click="habits.toggle(h.id, store.today)">
                <span aria-hidden="true">{{ h.emoji }}</span>
                {{ h.name }}
                <UiIcon v-if="habits.isDone(h.id, store.today)" name="check" :size="15" class="hb__tick" />
              </button>
            </li>
          </ul>
          <p v-else class="muted small">Nessuna abitudine prevista oggi.</p>
        </section>

        <section class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><UiIcon name="target" /> Obiettivi · 30 giorni</h2>
            <RouterLink to="/obiettivi" class="small">Apri</RouterLink>
          </div>
          <ul v-if="goalItems.length" class="gl">
            <li v-for="i in goalItems" :key="i.goal.id + i.kind + i.title + i.date">
              <span aria-hidden="true">{{ i.kind === 'goal' ? '🏁' : areaOf(i.goal.area).emoji }}</span>
              <div>
                <strong>{{ i.title }}</strong>
                <span class="muted small">{{ i.kind === 'milestone' ? `${i.goal.title} · ` : 'Scadenza obiettivo · ' }}{{ fmtShortDay(i.date) }} ({{ relativeDays(i.date, store.today) }})</span>
              </div>
            </li>
          </ul>
          <p v-else class="muted small">Nessuna tappa in scadenza nel prossimo mese.</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.td { display: flex; flex-direction: column; gap: var(--space-4); }
.kpi { background: var(--surface); border-radius: var(--radius-lg); padding: 18px 22px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.kpi__label { font-size: 0.84rem; color: var(--text-secondary); }
.kpi__value { font-size: 2.1rem; letter-spacing: -0.03em; line-height: 1; }
.kpi__value small { font-size: 1rem; color: var(--text-muted); }
.kpi--brand { background: var(--brand); color: var(--on-brand); }
.kpi--brand .kpi__label, .kpi--brand small { color: var(--on-brand); }
.kpi--alert { background: var(--critical-soft); color: var(--negative); }
.kpi--alert .kpi__label { color: var(--negative); }
.td__cols { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.panel--alert { box-shadow: inset 0 0 0 1.5px var(--critical-soft); }
.panel--alert .panel__title { color: var(--negative); margin-bottom: 8px; }
.panel > .panel__title { margin-bottom: 8px; }
.td__hint { margin: -4px 0 6px; }
.list { list-style: none; margin: 0; padding: 0; }
.hb { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hb__btn {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; cursor: pointer; text-align: left;
  border: 1px solid var(--border); background: var(--surface); font-size: 0.92rem;
}
.hb__btn:hover { background: var(--surface-2); }
.hb__btn.on { background: color-mix(in srgb, var(--c) 14%, var(--surface)); border-color: color-mix(in srgb, var(--c) 45%, transparent); }
.hb__tick { margin-left: auto; color: var(--positive); }
.gl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.gl li { display: flex; gap: 10px; align-items: flex-start; }
.gl li div { display: flex; flex-direction: column; min-width: 0; }
.gl strong { font-weight: 500; }
@media (max-width: 1000px) { .td__cols { grid-template-columns: minmax(0, 1fr); } }
</style>
