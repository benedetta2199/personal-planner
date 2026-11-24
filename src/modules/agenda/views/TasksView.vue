<script setup lang="ts">
/**
 * Task del periodo: giornalieri, settimanali, mensili e annuali.
 * Ogni impegno ricorrente compare automaticamente nei periodi in cui scade.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiPeriodNav from '@/core/ui/UiPeriodNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import {
  addDaysTo,
  addMonthsTo,
  endOfMonth,
  endOfYear,
  fmtDayMonth,
  fmtLongDay,
  fmtMonthYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
  type IsoDay,
} from '@/core/utils/dates'
import OccurrenceRow from '../components/OccurrenceRow.vue'
import { HORIZON_LABEL, horizonOf, isEvent, type Horizon, type Occurrence } from '../domain/recurrence'
import { useAgendaStore } from '../store/agendaStore'

type Period = 'day' | 'week' | 'month' | 'year'
const store = useAgendaStore()
const route = useRoute()
const router = useRouter()

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Giorno' },
  { value: 'week', label: 'Settimana' },
  { value: 'month', label: 'Mese' },
  { value: 'year', label: 'Anno' },
]
const period = ref<Period>(PERIODS.some((p) => p.value === route.query.period) ? (route.query.period as Period) : 'week')
const cursor = ref<IsoDay>(store.today)
watch(period, (p) => router.replace({ query: { ...route.query, period: p } }))

const range = computed<[IsoDay, IsoDay]>(() => {
  const d = cursor.value
  switch (period.value) {
    case 'day':
      return [d, d]
    case 'week':
      return [startOfWeek(d), addDaysTo(startOfWeek(d), 6)]
    case 'month':
      return [startOfMonth(d), endOfMonth(d)]
    case 'year':
      return [startOfYear(d), endOfYear(d)]
  }
})
const isCurrent = computed(() => store.today >= range.value[0] && store.today <= range.value[1])
function shift(n: number) {
  const d = cursor.value
  cursor.value = period.value === 'day' ? addDaysTo(d, n) : period.value === 'week' ? addDaysTo(d, 7 * n) : period.value === 'month' ? addMonthsTo(startOfMonth(d), n) : addMonthsTo(startOfYear(d), 12 * n)
}
const label = computed(() => {
  const [a, b] = range.value
  switch (period.value) {
    case 'day':
      return fmtLongDay(a)
    case 'week':
      return `${fmtDayMonth(a)} – ${fmtDayMonth(b)}`
    case 'month':
      return fmtMonthYear(a)
    case 'year':
      return a.slice(0, 4)
  }
})

/** Filtro per cadenza dell'impegno. */
const horizon = ref<Horizon | 'all'>('all')
const showDone = ref(true)

/** Solo i task: gli eventi hanno la loro sezione. */
const all = computed(() => store.occurrences(...range.value).filter((o) => !isEvent(o.commitment)))
const counts = computed(() => {
  const m: Record<string, number> = {}
  for (const o of all.value) m[horizonOf(o.commitment.repeat)] = (m[horizonOf(o.commitment.repeat)] ?? 0) + 1
  return m
})
const filtered = computed(() => all.value.filter((o) => (horizon.value === 'all' || horizonOf(o.commitment.repeat) === horizon.value) && (showDone.value || o.status !== 'done')))
const doneCount = computed(() => all.value.filter((o) => o.status === 'done').length)
const plannedCount = computed(() => all.value.filter((o) => !o.projected && o.status !== 'missed').length)
/** Ritardi da periodi precedenti (mostrati solo nel periodo corrente). */
const carried = computed(() => (isCurrent.value ? store.overdue.filter((o) => o.date < range.value[0]) : []))

/** Raggruppamento: per giorno (giorno/settimana), per settimana (mese), per mese (anno). */
const groups = computed(() => {
  const key = (d: IsoDay) => (period.value === 'year' ? d.slice(0, 7) : period.value === 'month' ? startOfWeek(d) : d)
  const title = (k: string) => {
    if (period.value === 'year') return fmtMonthYear(`${k}-01`)
    if (period.value === 'month') {
      const end = addDaysTo(k, 6)
      return `Settimana ${fmtDayMonth(k < range.value[0] ? range.value[0] : k)} – ${fmtDayMonth(end > range.value[1] ? range.value[1] : end)}`
    }
    return fmtLongDay(k)
  }
  const map = new Map<string, Occurrence[]>()
  for (const o of filtered.value) {
    const k = key(o.date)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(o)
  }
  return [...map.entries()].map(([k, items]) => ({ key: k, title: title(k), items, isToday: k === store.today }))
})
const progress = computed(() => (plannedCount.value ? doneCount.value / plannedCount.value : 0))
</script>

<template>
  <div class="tk">
    <div class="tk__bar">
      <UiSegmented v-model="period" :options="PERIODS" label="Periodo" />
      <UiPeriodNav :label="label" :is-current="isCurrent" @prev="shift(-1)" @next="shift(1)" @current="cursor = store.today" />
    </div>

    <section class="panel">
      <div class="panel__head">
        <div class="tk__progress">
          <strong class="num">{{ doneCount }} / {{ plannedCount }}</strong>
          <span class="muted small">completati in questo periodo</span>
          <div class="bar" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress * 100}%` }" /></div>
        </div>
        <label class="tk__toggle small"><input v-model="showDone" type="checkbox" /> Mostra completati</label>
      </div>

      <div class="tk__filters" role="group" aria-label="Filtra per cadenza">
        <button type="button" class="chip" :class="{ on: horizon === 'all' }" :aria-pressed="horizon === 'all'" @click="horizon = 'all'">Tutti <span class="num">{{ all.length }}</span></button>
        <template v-for="(l, h) in HORIZON_LABEL" :key="h">
          <button v-if="counts[h]" type="button" class="chip" :class="{ on: horizon === h }" :aria-pressed="horizon === h" @click="horizon = h">{{ l }} <span class="num">{{ counts[h] }}</span></button>
        </template>
      </div>

      <div v-if="carried.length" class="tk__group tk__group--alert">
        <h3>Rimasti indietro</h3>
        <ul class="list"><OccurrenceRow v-for="o in carried" :key="o.commitment.id + o.date" :occurrence="o" /></ul>
      </div>

      <div v-for="g in groups" :key="g.key" class="tk__group">
        <h3 :class="{ today: g.isToday }">{{ g.title }}<span v-if="g.isToday" class="tk__today">oggi</span></h3>
        <ul class="list"><OccurrenceRow v-for="o in g.items" :key="o.commitment.id + o.date" :occurrence="o" :show-date="period === 'month' || period === 'year'" /></ul>
      </div>

      <UiEmpty v-if="!groups.length && !carried.length" title="Nessun task in questo periodo" icon="checkCircle">
        I task ricorrenti compaiono qui automaticamente in base alla loro cadenza.
        <template #actions><UiButton icon="plus" @click="store.openEditor({ date: period === 'day' ? cursor : null })">Nuovo task</UiButton></template>
      </UiEmpty>
    </section>
  </div>
</template>

<style scoped>
.tk { display: flex; flex-direction: column; gap: var(--space-4); }
.tk__bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.tk__bar :deep(.seg) { background: var(--surface); }
.tk__bar :deep(.seg__opt--on) { background: var(--ink); color: var(--brand); }
.tk__progress { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 4px 10px; min-width: min(360px, 100%); }
.tk__progress strong { font-size: 1.4rem; font-weight: 500; }
.bar { grid-column: 1 / -1; height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--positive); border-radius: inherit; transition: width 0.3s ease; }
.tk__toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); cursor: pointer; }
.tk__filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px; padding: 5px 12px; font-size: 0.83rem; cursor: pointer; display: inline-flex; gap: 6px; }
.chip span { color: var(--text-muted); }
.chip.on { background: var(--ink); color: var(--brand); border-color: var(--ink); }
.chip.on span { color: var(--brand); opacity: 0.8; }
.tk__group { margin-top: 14px; }
.tk__group h3 { font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; padding-bottom: 4px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
.tk__group h3.today { color: var(--accent); }
.tk__today { text-transform: none; letter-spacing: 0; background: var(--brand); color: var(--on-brand); border-radius: 999px; padding: 0 8px; font-size: 0.72rem; }
.tk__group--alert h3 { color: var(--negative); }
.list { list-style: none; margin: 0; padding: 0; }
</style>
