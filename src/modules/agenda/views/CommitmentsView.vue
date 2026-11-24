<script setup lang="ts">
/** Elenco degli impegni e delle scadenze ricorrenti, raggruppati per categoria, con modelli pronti ed esportazione .ics. */
import { computed, ref } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { addDaysTo, daysBetween, fmtFullDate, relativeDays } from '@/core/utils/dates'
import { CATEGORIES, TEMPLATES, categoryOf, remindLabel, type CommitmentTemplate } from '../domain/catalog'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { extraDays, isEvent, kindOf, recurrenceLabel, type Commitment, type CommitmentKind } from '../domain/recurrence'
import { useAgendaStore } from '../store/agendaStore'

const store = useAgendaStore()
const query = ref('')
const showTemplates = ref(false)
const kind = ref<CommitmentKind | 'all'>('all')
const KINDS = [
  { value: 'all' as const, label: 'Tutti' },
  { value: 'task' as const, label: 'Task' },
  { value: 'event' as const, label: 'Eventi' },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const groups = computed(() => {
  const q = norm(query.value.trim())
  const list = store.commitments.filter((c) => (kind.value === 'all' || kindOf(c) === kind.value) && (!q || norm(`${c.title} ${c.notes ?? ''}`).includes(q)))
  return CATEGORIES.map((cat) => ({
    cat,
    items: list
      .filter((c) => categoryOf(c.category).id === cat.id)
      .map((c) => ({ c, next: store.nextDueOf(c), last: store.lastDoneOf(c.id) }))
      .sort((a, b) => (a.c.paused ? 1 : 0) - (b.c.paused ? 1 : 0) || (a.next ?? '9999').localeCompare(b.next ?? '9999')),
  })).filter((g) => g.items.length)
})

function tone(c: Commitment, next: string | null) {
  if (c.paused || !next) return 'muted'
  const n = daysBetween(store.today, next)
  if (isEvent(c) && n <= 0) return 'today'
  if (n < 0) return 'late'
  if (n === 0) return 'today'
  return n <= c.remindDays ? 'soon' : 'ok'
}

/** Modelli non ancora aggiunti (per titolo). */
const templates = computed(() => {
  const have = new Set(store.state.commitments.map((c) => norm(c.title)))
  return TEMPLATES.filter((t) => !have.has(norm(t.title)))
})
function useTemplate(t: CommitmentTemplate) {
  store.openEditor({ template: t })
}

function download() {
  const blob = new Blob([store.exportIcs()], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'scadenze.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="cm">
    <div class="cm__bar">
      <div class="row cm__filters">
        <label class="cm__search">
          <UiIcon name="search" :size="16" />
          <input v-model="query" class="input" type="search" placeholder="Cerca un impegno" aria-label="Cerca un impegno" />
        </label>
        <UiSegmented v-model="kind" :options="KINDS" label="Mostra" class="cm__kind" />
      </div>
      <div class="row">
        <UiButton icon="grid" :variant="showTemplates ? 'primary' : 'secondary'" :aria-expanded="showTemplates" @click="showTemplates = !showTemplates">Modelli</UiButton>
        <UiButton icon="download" :disabled="!store.state.commitments.length" title="File .ics da importare in Google Calendar, Apple Calendar o Outlook" @click="download">Esporta calendario</UiButton>
      </div>
    </div>

    <section v-if="showTemplates || !store.state.commitments.length" class="panel">
      <div class="panel__head">
        <h2 class="panel__title">Scadenze comuni</h2>
        <span class="muted small">Scegline una, imposta la data e salva.</span>
      </div>
      <div class="tpl">
        <button v-for="t in templates" :key="t.title" type="button" class="tpl__item" @click="useTemplate(t)">
          <span class="tpl__emoji" aria-hidden="true">{{ categoryOf(t.category).emoji }}</span>
          <span class="tpl__text">
            <strong>{{ t.title }}</strong>
            <span class="muted small">{{ recurrenceLabel(t.repeat) }}{{ t.mode === 'afterDone' && t.repeat.unit !== 'none' ? ' dal completamento' : '' }}</span>
          </span>
          <UiIcon name="plus" :size="16" class="tpl__plus" />
        </button>
      </div>
    </section>

    <section v-for="g in groups" :key="g.cat.id" class="panel">
      <h2 class="panel__title cm__cat"><span class="cm__emoji" :style="{ background: `color-mix(in srgb, var(${g.cat.color}) 16%, transparent)` }">{{ g.cat.emoji }}</span>{{ g.cat.label }}</h2>
      <ul class="cm__list">
        <li v-for="{ c, next, last } in g.items" :key="c.id" class="cm__item" :class="{ paused: c.paused }">
          <div class="cm__main">
            <button type="button" class="cm__title" :title="c.title" @click="store.openEditor({ commitment: c })">
              <UiIcon v-if="isEvent(c)" name="calendar" :size="14" class="cm__evt" />{{ c.title }}
            </button>
            <span class="muted small">
              <template v-if="isEvent(c)">Evento<template v-if="extraDays(c)"> di {{ extraDays(c) + 1 }} giorni</template> · {{ c.repeat.unit === 'none' ? 'una volta' : recurrenceLabel(c.repeat, c.start).toLowerCase() }}</template>
              <template v-else>{{ recurrenceLabel(c.repeat, c.start) }}<template v-if="c.mode === 'afterDone' && c.repeat.unit !== 'none'"> dal completamento</template></template>
              · {{ remindLabel(c.remindDays).toLowerCase() }}
              <template v-if="last"> · ultima volta il {{ fmtFullDate(last.doneOn) }}</template>
            </span>
            <span v-if="c.notes" class="cm__notes small">{{ c.notes }}</span>
          </div>
          <div class="cm__next" :class="`cm__next--${tone(c, next)}`">
            <template v-if="c.paused">In pausa</template>
            <template v-else-if="next">
              <strong>{{ fmtFullDate(next) }}</strong>
              <span v-if="isEvent(c) && next <= store.today">in corso fino al {{ fmtFullDate(addDaysTo(next, extraDays(c))) }}</span>
              <span v-else>{{ relativeDays(next, store.today) }}</span>
            </template>
            <template v-else>Concluso</template>
          </div>
          <div class="cm__actions">
            <UiButton v-if="next && !c.paused && !isEvent(c)" size="sm" icon="check" :title="`Segna come fatto oggi (scadenza del ${fmtFullDate(next)})`" @click="store.complete(c.id, next)">Fatto</UiButton>
            <UiButton size="sm" variant="ghost" :aria-label="c.paused ? 'Riattiva' : 'Metti in pausa'" :title="c.paused ? 'Riattiva' : 'Metti in pausa'" @click="store.togglePause(c.id)">{{ c.paused ? 'Riattiva' : 'Pausa' }}</UiButton>
            <UiButton size="sm" variant="ghost" icon="edit" aria-label="Modifica" @click="store.openEditor({ commitment: c })" />
          </div>
        </li>
      </ul>
    </section>

    <section v-if="store.state.commitments.length && !groups.length" class="panel">
      <UiEmpty title="Nessun risultato" icon="search">Nessun impegno corrisponde a «{{ query }}».</UiEmpty>
    </section>
  </div>
</template>

<style scoped>
.cm { display: flex; flex-direction: column; gap: var(--space-4); }
.cm__bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cm__filters { flex: 1; flex-wrap: wrap; gap: 10px; }
.cm__kind { background: var(--surface); }
.cm__evt { vertical-align: -2px; margin-right: 6px; color: var(--text-secondary); }
.cm__search { position: relative; flex: 1; max-width: 360px; min-width: 200px; display: flex; }
.cm__search svg { position: absolute; left: 14px; top: 12px; color: var(--text-muted); }
.cm__search .input { width: 100%; padding-left: 38px; border-radius: 999px; border-color: transparent; }
.tpl { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.tpl__item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; text-align: left; }
.tpl__item:hover { background: var(--surface-2); border-color: var(--border-strong); }
.tpl__emoji { font-size: 1.2rem; }
.tpl__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.tpl__text strong { font-weight: 500; font-size: 0.9rem; }
.tpl__plus { color: var(--text-muted); }
.cm__cat { margin-bottom: 6px; }
.cm__emoji { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; }
.cm__list { list-style: none; margin: 0; padding: 0; }
.cm__item { display: grid; grid-template-columns: minmax(0, 1fr) 170px auto; gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid var(--border); }
.cm__item.paused { opacity: 0.6; }
.cm__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cm__title { all: unset; cursor: pointer; font-weight: 500; }
.cm__title:hover { text-decoration: underline; }
.cm__title:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }
.cm__notes { color: var(--text-secondary); white-space: pre-line; }
.cm__next { display: flex; flex-direction: column; font-size: 0.82rem; color: var(--text-muted); padding: 6px 12px; border-radius: 12px; background: var(--surface-2); }
.cm__next strong { font-weight: 500; color: var(--text-primary); font-size: 0.9rem; }
.cm__next--late { background: var(--critical-soft); color: var(--negative); }
.cm__next--late strong { color: var(--negative); }
.cm__next--today { background: var(--brand); color: var(--on-brand); }
.cm__next--soon { background: var(--warning-soft); color: var(--status-warning); }
.cm__actions { display: flex; gap: 4px; justify-content: flex-end; }
@media (max-width: 760px) {
  .cm__item { grid-template-columns: minmax(0, 1fr) auto; }
  .cm__actions { grid-column: 1 / -1; justify-content: flex-start; }
}
</style>
