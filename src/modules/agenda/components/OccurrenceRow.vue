<script setup lang="ts">
/** Una scadenza con spunta, categoria, cadenza e stato. Cliccando sul titolo si modifica l'impegno. */
import { computed } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { fmtDayMonth, fmtShortDay, relativeDays } from '@/core/utils/dates'
import { categoryOf } from '../domain/catalog'
import { recurrenceLabel, type Occurrence } from '../domain/recurrence'
import { useAgendaStore } from '../store/agendaStore'

const props = withDefaults(defineProps<{ occurrence: Occurrence; showDate?: boolean }>(), { showDate: true })
const store = useAgendaStore()

const c = computed(() => props.occurrence.commitment)
const cat = computed(() => categoryOf(c.value.category))
const done = computed(() => props.occurrence.status === 'done')

const badge = computed(() => {
  const o = props.occurrence
  const rel = relativeDays(o.date, store.today)
  switch (o.status) {
    case 'done':
      return { tone: 'good', text: o.completion && o.completion.doneOn !== o.date ? `Fatto il ${fmtDayMonth(o.completion.doneOn)}` : 'Fatto' }
    case 'overdue':
      return { tone: 'critical', text: `In ritardo · ${rel}` }
    case 'today':
      return { tone: 'accent', text: 'Oggi' }
    case 'soon':
      return { tone: 'warning', text: rel.charAt(0).toUpperCase() + rel.slice(1) }
    case 'missed':
      return { tone: 'neutral', text: 'Non fatto' }
    default:
      return { tone: 'neutral', text: o.projected ? `Stimata · ${rel}` : rel.charAt(0).toUpperCase() + rel.slice(1) }
  }
})
</script>

<template>
  <li class="occ" :class="[`occ--${occurrence.status}`, { 'occ--projected': occurrence.projected }]">
    <button
      type="button"
      class="occ__check"
      :class="{ on: done }"
      :disabled="occurrence.projected"
      :aria-pressed="done"
      :aria-label="done ? `Segna «${c.title}» come da fare` : `Segna «${c.title}» come fatto`"
      :title="occurrence.projected ? 'Data stimata: si potrà segnare quando sarà la prossima scadenza' : undefined"
      @click="store.toggle(occurrence)"
    >
      <UiIcon v-if="done" name="check" :size="14" />
    </button>
    <span class="occ__emoji" :style="{ background: `color-mix(in srgb, var(${cat.color}) 16%, transparent)` }" aria-hidden="true">{{ cat.emoji }}</span>
    <div class="occ__body">
      <button type="button" class="occ__title" @click="store.openEditor({ commitment: c })">{{ c.title }}</button>
      <span class="occ__meta muted small">
        <template v-if="showDate">{{ fmtShortDay(occurrence.date) }} · </template>{{ recurrenceLabel(c.repeat, c.start) }}<template v-if="c.mode === 'afterDone' && c.repeat.unit !== 'none'"> dal completamento</template>
      </span>
    </div>
    <span class="occ__badge" :class="`occ__badge--${badge.tone}`">{{ badge.text }}</span>
  </li>
</template>

<style scoped>
.occ { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); min-width: 0; }
.occ:last-child { border-bottom: 0; }
.occ__check {
  width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface);
  display: grid; place-items: center; cursor: pointer; flex-shrink: 0; color: #fff; transition: background 0.15s, border-color 0.15s;
}
.occ__check:hover:not(:disabled) { border-color: var(--ink); }
.occ__check.on { background: var(--positive); border-color: var(--positive); }
.occ__check:disabled { cursor: default; border-style: dashed; }
.occ__emoji { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 1.05rem; flex-shrink: 0; }
.occ__body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.occ__title { all: unset; cursor: pointer; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.occ__title:hover { text-decoration: underline; }
.occ__title:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.occ__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.occ--done .occ__title { color: var(--text-muted); text-decoration: line-through; }
.occ--projected, .occ--missed { opacity: 0.7; }
.occ__badge { padding: 2px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 500; white-space: nowrap; background: var(--surface-2); color: var(--text-secondary); flex-shrink: 0; }
.occ__badge--good { background: var(--good-soft); color: var(--positive); }
.occ__badge--critical { background: var(--critical-soft); color: var(--negative); }
.occ__badge--accent { background: var(--brand); color: var(--on-brand); }
.occ__badge--warning { background: var(--warning-soft); color: var(--status-warning); }
@media (max-width: 520px) {
  .occ { flex-wrap: wrap; }
  .occ__body { flex-basis: calc(100% - 90px); }
  .occ__badge { margin-left: 70px; }
}
</style>
