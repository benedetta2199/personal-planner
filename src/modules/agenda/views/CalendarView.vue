<script setup lang="ts">
/** Calendario mensile: impegni ricorrenti, scadenze degli obiettivi e dettaglio del giorno scelto. */
import { computed, ref } from 'vue'
import UiPeriodNav from '@/core/ui/UiPeriodNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { addMonthsTo, fmtLongDay, fmtMonthYear, monthGrid, startOfMonth, WEEKDAY_SHORT, type IsoDay } from '@/core/utils/dates'
import OccurrenceRow from '../components/OccurrenceRow.vue'
import { categoryOf, CATEGORIES } from '../domain/catalog'
import { useAgendaStore } from '../store/agendaStore'
import { useGoalsStore } from '@/modules/goals/store'
import { areaOf } from '@/modules/goals/domain'

const store = useAgendaStore()
const goals = useGoalsStore()

const month = ref(startOfMonth(store.today))
const selected = ref<IsoDay>(store.today)
const weeks = computed(() => monthGrid(month.value))
const range = computed<[IsoDay, IsoDay]>(() => [weeks.value[0][0], weeks.value[5][6]])

const byDay = computed(() => {
  const map = new Map<IsoDay, ReturnType<typeof store.occurrences>>()
  for (const o of store.occurrences(...range.value)) {
    if (!map.has(o.date)) map.set(o.date, [])
    map.get(o.date)!.push(o)
  }
  return map
})
const goalByDay = computed(() => {
  const map = new Map<IsoDay, ReturnType<typeof goals.datedItems>>()
  for (const i of goals.datedItems(...range.value)) {
    if (!map.has(i.date)) map.set(i.date, [])
    map.get(i.date)!.push(i)
  }
  return map
})

function shift(n: number) {
  month.value = addMonthsTo(month.value, n)
}
function goToday() {
  month.value = startOfMonth(store.today)
  selected.value = store.today
}
function pick(d: IsoDay) {
  selected.value = d
  if (d.slice(0, 7) !== month.value.slice(0, 7)) month.value = startOfMonth(d)
}

const dayItems = computed(() => byDay.value.get(selected.value) ?? [])
const dayGoals = computed(() => goalByDay.value.get(selected.value) ?? [])
const usedCategories = computed(() => CATEGORIES.filter((c) => store.state.commitments.some((x) => x.category === c.id)))
const MAX_CHIPS = 3
</script>

<template>
  <div class="cal">
    <div class="cal__bar">
      <UiPeriodNav :label="fmtMonthYear(month)" :is-current="month === startOfMonth(store.today)" @prev="shift(-1)" @next="shift(1)" @current="goToday" />
      <ul v-if="usedCategories.length" class="cal__legend" aria-label="Legenda categorie">
        <li v-for="c in usedCategories" :key="c.id"><span :style="{ background: `var(${c.color})` }" />{{ c.label }}</li>
      </ul>
    </div>

    <div class="cal__layout">
      <section class="panel cal__grid-wrap">
        <div class="cal__grid" role="grid" :aria-label="fmtMonthYear(month)">
          <div v-for="d in WEEKDAY_SHORT" :key="d" class="cal__wd" role="columnheader">{{ d }}</div>
          <template v-for="w in weeks" :key="w[0]">
            <button
              v-for="d in w"
              :key="d"
              type="button"
              role="gridcell"
              class="cal__day"
              :class="{ out: d.slice(0, 7) !== month.slice(0, 7), today: d === store.today, sel: d === selected }"
              :aria-selected="d === selected"
              :aria-label="`${fmtLongDay(d)}: ${(byDay.get(d)?.length ?? 0) + (goalByDay.get(d)?.length ?? 0)} elementi`"
              @click="pick(d)"
            >
              <span class="cal__num num">{{ Number(d.slice(8)) }}</span>
              <span class="cal__chips">
                <span
                  v-for="o in (byDay.get(d) ?? []).slice(0, MAX_CHIPS)"
                  :key="o.commitment.id"
                  class="cal__chip"
                  :class="[`st-${o.status}`, { proj: o.projected }]"
                  :style="{ '--c': `var(${categoryOf(o.commitment.category).color})` }"
                >{{ o.commitment.title }}</span>
                <span v-for="g in (goalByDay.get(d) ?? []).slice(0, Math.max(0, MAX_CHIPS - (byDay.get(d)?.length ?? 0)))" :key="g.goal.id + g.title" class="cal__chip cal__chip--goal" :class="{ 'st-done': g.done }">🏁 {{ g.title }}</span>
                <span v-if="(byDay.get(d)?.length ?? 0) + (goalByDay.get(d)?.length ?? 0) > MAX_CHIPS" class="cal__more">+{{ (byDay.get(d)?.length ?? 0) + (goalByDay.get(d)?.length ?? 0) - MAX_CHIPS }}</span>
              </span>
              <span class="cal__dots" aria-hidden="true">
                <span v-for="o in (byDay.get(d) ?? []).slice(0, 4)" :key="o.commitment.id" :class="`st-${o.status}`" :style="{ background: `var(${categoryOf(o.commitment.category).color})` }" />
                <span v-if="goalByDay.get(d)?.length" class="goal" />
              </span>
            </button>
          </template>
        </div>
      </section>

      <section class="panel cal__detail">
        <div class="panel__head">
          <h2 class="panel__title">{{ fmtLongDay(selected) }}</h2>
          <UiButton size="sm" icon="plus" @click="store.openEditor({ date: selected })">Aggiungi</UiButton>
        </div>
        <ul v-if="dayItems.length" class="list"><OccurrenceRow v-for="o in dayItems" :key="o.commitment.id" :occurrence="o" :show-date="false" /></ul>
        <ul v-if="dayGoals.length" class="cal__goals">
          <li v-for="g in dayGoals" :key="g.goal.id + g.title">
            <UiIcon :name="g.kind === 'goal' ? 'flag' : 'target'" :size="16" />
            <div>
              <RouterLink :to="{ name: 'goals' }">{{ g.title }}</RouterLink>
              <span class="muted small">{{ g.kind === 'goal' ? 'Scadenza obiettivo' : `Tappa di «${g.goal.title}»` }} · {{ areaOf(g.goal.area).label }}<template v-if="g.done"> · completata</template></span>
            </div>
          </li>
        </ul>
        <p v-if="!dayItems.length && !dayGoals.length" class="muted small">Niente in programma.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: var(--space-4); }
.cal__bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.cal__legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8rem; color: var(--text-secondary); }
.cal__legend li { display: inline-flex; align-items: center; gap: 6px; }
.cal__legend span { width: 9px; height: 9px; border-radius: 3px; }
.cal__layout { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr); gap: var(--space-4); align-items: start; }
.cal__grid-wrap { padding: 14px; }
.cal__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.cal__wd { font-size: 0.76rem; color: var(--text-muted); text-align: center; padding: 4px 0 6px; font-weight: 500; }
.cal__day {
  min-height: 104px; border: 1px solid transparent; background: var(--surface-2); border-radius: 12px; padding: 6px; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px; text-align: left; min-width: 0;
}
.cal__day:hover { border-color: var(--border-strong); }
.cal__day.out { background: transparent; }
.cal__day.out .cal__num { color: var(--text-muted); }
.cal__day.sel { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); background: var(--surface); }
.cal__num { font-size: 0.82rem; font-weight: 500; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; }
.cal__day.today .cal__num { background: var(--ink); color: var(--brand); }
.cal__chips { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cal__chip {
  font-size: 0.72rem; line-height: 1.35; padding: 1px 6px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: color-mix(in srgb, var(--c) 18%, var(--surface)); color: var(--text-primary); border-left: 3px solid var(--c);
}
.cal__chip.st-done { text-decoration: line-through; opacity: 0.55; }
.cal__chip.st-overdue { background: var(--critical-soft); border-left-color: var(--negative); color: var(--negative); font-weight: 500; }
.cal__chip.st-missed, .cal__chip.proj { opacity: 0.55; border-left-style: dashed; }
.cal__chip--goal { --c: var(--orange); }
.cal__more { font-size: 0.7rem; color: var(--text-muted); padding-left: 4px; }
.cal__dots { display: none; gap: 3px; flex-wrap: wrap; }
.cal__dots span { width: 6px; height: 6px; border-radius: 50%; }
.cal__dots span.st-done { opacity: 0.4; }
.cal__dots span.st-overdue { outline: 1.5px solid var(--negative); outline-offset: 1px; }
.cal__dots .goal { background: var(--orange); }
.cal__detail { position: sticky; top: 16px; }
.list { list-style: none; margin: 0; padding: 0; }
.cal__goals { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.cal__goals li { display: flex; gap: 10px; align-items: flex-start; color: var(--orange); }
.cal__goals li div { display: flex; flex-direction: column; color: var(--text-primary); }
@media (max-width: 1100px) { .cal__layout { grid-template-columns: minmax(0, 1fr); } .cal__detail { position: static; } }
@media (max-width: 700px) {
  .cal__day { min-height: 54px; align-items: center; padding: 4px 2px; }
  .cal__chips { display: none; }
  .cal__dots { display: flex; justify-content: center; }
  .cal__grid-wrap { padding: 8px; }
}
</style>
