<script setup lang="ts">
import { computed, ref } from 'vue'
import UiPageHeader from '@/core/ui/UiPageHeader.vue'
import UiPeriodNav from '@/core/ui/UiPeriodNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { addDaysTo, dayRange, fmtDayMonth, fmtLongDay, startOfWeek, todayDay, WEEKDAY_LETTERS, type IsoDay } from '@/core/utils/dates'
import HabitDialog from './HabitDialog.vue'
import { bestStreak, completionRate, isScheduled, streak, type Habit } from './domain'
import { useHabitsStore } from './store'

const store = useHabitsStore()
const today = todayDay()
const weekStart = ref(startOfWeek(today))
const days = computed(() => dayRange(weekStart.value, addDaysTo(weekStart.value, 6)))
const isCurrentWeek = computed(() => weekStart.value === startOfWeek(today))
const weekLabel = computed(() => `${fmtDayMonth(days.value[0])} – ${fmtDayMonth(days.value[6])}`)

const todayHabits = computed(() => store.habits.filter((h) => isScheduled(h, today)))
const todayDone = computed(() => todayHabits.value.filter((h) => store.isDone(h.id, today)).length)
const rows = computed(() =>
  store.habits.map((h) => {
    const set = store.doneSet(h.id)
    return { h, streak: streak(h, set, today), best: bestStreak(h, set, today), rate: completionRate(h, set, today) }
  }),
)
const topStreak = computed(() => Math.max(0, ...rows.value.map((r) => r.streak)))
const avgRate = computed(() => {
  const rates = rows.value.map((r) => r.rate).filter((r): r is number => r !== null)
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null
})

/** Ultime 12 settimane per la mappa di calore di ogni abitudine. */
const heatDays = computed(() => dayRange(addDaysTo(startOfWeek(today), -77), addDaysTo(startOfWeek(today), 6)))
const expanded = ref<string | null>(null)

function cellState(h: Habit, d: IsoDay) {
  if (d > today) return 'future'
  if (!isScheduled(h, d)) return store.isDone(h.id, d) ? 'extra' : 'off'
  return store.isDone(h.id, d) ? 'done' : d === today ? 'pending' : 'miss'
}

const dialog = ref<{ open: boolean; habit: Habit | null }>({ open: false, habit: null })
const edit = (habit: Habit | null) => (dialog.value = { open: true, habit })
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
</script>

<template>
  <div class="hv">
    <UiPageHeader title="Abitudini" subtitle="Piccole azioni ripetute ogni giorno">
      <UiButton variant="primary" icon="plus" @click="edit(null)">Nuova abitudine</UiButton>
    </UiPageHeader>
    <UiAlert v-if="store.saveFailed" tone="critical" title="Salvataggio non riuscito">Il browser non permette di salvare i dati: le ultime modifiche andranno perse alla chiusura.</UiAlert>

    <div class="grid grid-kpi">
      <div class="kpi kpi--brand"><span class="kpi__label">Oggi</span><span class="kpi__value num">{{ todayDone }}<small> / {{ todayHabits.length }}</small></span></div>
      <div class="kpi"><span class="kpi__label">Serie più lunga in corso</span><span class="kpi__value num">{{ topStreak }}<small> giorni</small></span></div>
      <div class="kpi"><span class="kpi__label">Costanza ultimi 30 giorni</span><span class="kpi__value num">{{ pct(avgRate) }}</span></div>
    </div>

    <section v-if="!store.habits.length" class="panel">
      <UiEmpty title="Nessuna abitudine" icon="repeat">
        Aggiungi un'abitudine da costruire — bere acqua, leggere, allenarsi — e segna ogni giorno se l'hai rispettata.
        <template #actions><UiButton variant="primary" icon="plus" @click="edit(null)">Nuova abitudine</UiButton></template>
      </UiEmpty>
    </section>

    <section v-else class="panel">
      <div class="panel__head">
        <h2 class="panel__title">Settimana</h2>
        <UiPeriodNav :label="weekLabel" :is-current="isCurrentWeek" current-label="Questa settimana" @prev="weekStart = addDaysTo(weekStart, -7)" @next="weekStart = addDaysTo(weekStart, 7)" @current="weekStart = startOfWeek(today)" />
      </div>

      <div class="tbl" role="table" aria-label="Abitudini della settimana">
        <div class="tbl__row tbl__row--head" role="row">
          <span role="columnheader">Abitudine</span>
          <span v-for="(d, i) in days" :key="d" role="columnheader" class="tbl__day" :class="{ today: d === today }" :title="fmtLongDay(d)">
            {{ WEEKDAY_LETTERS[i] }}<small class="num">{{ Number(d.slice(8)) }}</small>
          </span>
          <span role="columnheader" class="tbl__stat">Serie</span>
          <span role="columnheader" class="tbl__stat">30 gg</span>
        </div>
        <template v-for="r in rows" :key="r.h.id">
          <div class="tbl__row" role="row" :style="{ '--c': `var(${r.h.color})` }">
            <span role="cell" class="tbl__name">
              <button type="button" class="tbl__expand" :aria-expanded="expanded === r.h.id" :aria-label="`Storico di ${r.h.name}`" @click="expanded = expanded === r.h.id ? null : r.h.id">
                <UiIcon name="chevron" :size="14" :style="{ transform: expanded === r.h.id ? 'none' : 'rotate(-90deg)' }" />
              </button>
              <span aria-hidden="true">{{ r.h.emoji }}</span>
              <button type="button" class="tbl__title" @click="edit(r.h)">{{ r.h.name }}</button>
            </span>
            <span v-for="d in days" :key="d" role="cell" class="tbl__cellwrap">
              <button
                type="button"
                class="cell"
                :class="`cell--${cellState(r.h, d)}`"
                :disabled="d > today"
                :aria-pressed="store.isDone(r.h.id, d)"
                :aria-label="`${r.h.name}, ${fmtLongDay(d)}`"
                @click="store.toggle(r.h.id, d)"
              >
                <UiIcon v-if="store.isDone(r.h.id, d)" name="check" :size="14" />
              </button>
            </span>
            <span role="cell" class="tbl__stat num" :title="`Record: ${r.best} giorni`"><UiIcon v-if="r.streak >= 3" name="flame" :size="14" class="flame" />{{ r.streak }}</span>
            <span role="cell" class="tbl__stat num">{{ pct(r.rate) }}</span>
          </div>
          <div v-if="expanded === r.h.id" class="heat" :style="{ '--c': `var(${r.h.color})` }">
            <div class="heat__grid" role="img" :aria-label="`Ultime 12 settimane di ${r.h.name}`">
              <span v-for="d in heatDays" :key="d" class="heat__cell" :class="`cell--${cellState(r.h, d)}`" :title="fmtLongDay(d)" />
            </div>
            <span class="muted small">Ultime 12 settimane · record {{ r.best }} giorni di fila</span>
          </div>
        </template>
      </div>
      <p class="muted small hv__legend">Le caselle tratteggiate sono i giorni in cui l'abitudine non è prevista. Puoi segnare anche i giorni passati.</p>
    </section>

    <section v-if="store.archived.length" class="panel">
      <h2 class="panel__title">Archiviate</h2>
      <ul class="arch">
        <li v-for="h in store.archived" :key="h.id">
          <span>{{ h.emoji }} {{ h.name }}</span>
          <UiButton size="sm" variant="ghost" @click="edit(h)">Gestisci</UiButton>
        </li>
      </ul>
    </section>

    <HabitDialog :open="dialog.open" :habit="dialog.habit" @close="dialog.open = false" />
  </div>
</template>

<style scoped>
.hv { display: flex; flex-direction: column; gap: 20px; }
.kpi { background: var(--surface); border-radius: var(--radius-lg); padding: 18px 22px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.kpi__label { font-size: 0.84rem; color: var(--text-secondary); }
.kpi__value { font-size: 2.1rem; letter-spacing: -0.03em; line-height: 1; }
.kpi__value small { font-size: 1rem; color: var(--text-muted); }
.kpi--brand { background: var(--brand); color: var(--on-brand); }
.kpi--brand .kpi__label, .kpi--brand small { color: var(--on-brand); }
.tbl { display: flex; flex-direction: column; overflow-x: auto; }
.tbl__row { display: grid; grid-template-columns: minmax(170px, 1fr) repeat(7, 44px) 64px 64px; align-items: center; gap: 4px; padding: 6px 0; border-bottom: 1px solid var(--border); min-width: 560px; }
.tbl__row--head { font-size: 0.78rem; color: var(--text-muted); border-bottom: 0; }
.tbl__day { display: flex; flex-direction: column; align-items: center; line-height: 1.2; font-weight: 500; }
.tbl__day small { font-size: 0.7rem; font-weight: 400; }
.tbl__day.today { color: var(--accent); font-weight: 700; }
.tbl__stat { text-align: center; display: inline-flex; align-items: center; justify-content: center; gap: 2px; font-size: 0.88rem; }
.flame { color: var(--orange); }
.tbl__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tbl__expand { border: 0; background: none; padding: 2px; cursor: pointer; color: var(--text-muted); display: grid; }
.tbl__title { all: unset; cursor: pointer; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tbl__title:hover { text-decoration: underline; }
.tbl__title:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }
.tbl__cellwrap { display: grid; place-items: center; }
.cell { width: 36px; height: 36px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--surface); cursor: pointer; display: grid; place-items: center; color: #fff; }
.cell:hover:not(:disabled) { border-color: var(--c); }
.cell--done, .cell--extra { background: var(--c); border-color: var(--c); }
.cell--extra { opacity: 0.6; }
.cell--pending { border-color: var(--c); border-width: 2px; }
.cell--miss { background: var(--surface-2); }
.cell--off { border-style: dashed; background: transparent; }
.cell--future { opacity: 0.35; cursor: default; }
.heat { padding: 10px 0 14px 30px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.heat__grid { display: grid; grid-template-rows: repeat(7, 12px); grid-auto-flow: column; grid-auto-columns: 12px; gap: 3px; }
.heat__cell { border-radius: 3px; border: 1px solid var(--border); background: var(--surface-2); }
.heat__cell.cell--done, .heat__cell.cell--extra { background: var(--c); border-color: var(--c); }
.heat__cell.cell--off { background: transparent; border-style: dashed; }
.heat__cell.cell--future { opacity: 0.3; }
.hv__legend { margin-top: 10px; }
.arch { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.arch li { display: flex; justify-content: space-between; align-items: center; color: var(--text-secondary); }
</style>
