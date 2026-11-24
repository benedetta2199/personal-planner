<script setup lang="ts">
/** `embedded`: sotto-sezione del Planner, senza titolo di pagina proprio. */
const props = defineProps<{ embedded?: boolean }>()
import { computed, ref } from 'vue'
import UiPageHeader from '@/core/ui/UiPageHeader.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { addDaysTo, daysBetween, fmtFullDate, fmtShortDay, relativeDays, todayDay } from '@/core/utils/dates'
import { useOpenFromQuery, usePrimaryAction } from '@/core/ui/primaryAction'
import GoalDialog from './GoalDialog.vue'
import { areaOf, goalProgress, linkLabel, nextMilestone, safeUrl, type Goal, type GoalStatus } from './domain'
import { useGoalsStore } from './store'

const store = useGoalsStore()
const today = todayDay()
const filter = ref<GoalStatus | 'all'>('active')
const FILTERS = [
  { value: 'active' as const, label: 'In corso' },
  { value: 'paused' as const, label: 'In pausa' },
  { value: 'done' as const, label: 'Raggiunti' },
  { value: 'all' as const, label: 'Tutti' },
]

const list = computed(() =>
  store.goals
    .filter((g) => filter.value === 'all' || g.status === filter.value)
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.title.localeCompare(b.title, 'it')),
)
const active = computed(() => store.goals.filter((g) => g.status === 'active'))
const doneThisYear = computed(() => store.goals.filter((g) => g.status === 'done' && g.completedAt?.startsWith(today.slice(0, 4))).length)
const avgProgress = computed(() => (active.value.length ? active.value.reduce((s, g) => s + goalProgress(g), 0) / active.value.length : 0))
const dueSoon = computed(() => store.datedItems(today, addDaysTo(today, 30)).filter((i) => !i.done && i.goal.status === 'active').length)

const dialog = ref<{ open: boolean; goal: Goal | null }>({ open: false, goal: null })
const edit = (goal: Goal | null) => (dialog.value = { open: true, goal })
usePrimaryAction({ label: 'Nuovo obiettivo', run: () => edit(null) })
useOpenFromQuery(() => edit(null))

/** Card con i testi lunghi (motivazione, descrizione) aperti per intero. */
const expanded = ref(new Set<string>())
function toggleExpand(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}
/** Mostra «Leggi tutto» solo se i testi possono superare le righe visibili. */
const isLong = (g: Goal) => (g.why?.length ?? 0) > 140 || (g.description?.length ?? 0) > 160 || (g.description?.split('\n').length ?? 0) > 3

const quick = ref<Record<string, string>>({})
function addQuick(g: Goal) {
  const t = quick.value[g.id]?.trim()
  if (!t) return
  store.addMilestone(g.id, t)
  quick.value[g.id] = ''
}

function deadline(g: Goal) {
  if (!g.targetDate) return null
  const n = daysBetween(today, g.targetDate)
  return { text: `${fmtFullDate(g.targetDate)} · ${relativeDays(g.targetDate, today)}`, late: n < 0 && g.status !== 'done' }
}
const pct = (v: number) => `${Math.round(v * 100)}%`
</script>

<template>
  <div class="gv">
    <UiPageHeader :title="props.embedded ? undefined : 'Obiettivi'" subtitle="Traguardi a lungo termine, divisi in tappe concrete">
      <UiButton variant="primary" icon="plus" @click="edit(null)">Nuovo obiettivo</UiButton>
    </UiPageHeader>
    <UiAlert v-if="store.saveFailed" tone="critical" title="Salvataggio non riuscito">Il browser non permette di salvare i dati: le ultime modifiche andranno perse alla chiusura.</UiAlert>

    <div class="grid grid-kpi">
      <div class="kpi kpi--brand"><span class="kpi__label">In corso</span><span class="kpi__value num">{{ active.length }}</span></div>
      <div class="kpi"><span class="kpi__label">Avanzamento medio</span><span class="kpi__value num">{{ pct(avgProgress) }}</span></div>
      <div class="kpi"><span class="kpi__label">Scadenze nei prossimi 30 giorni</span><span class="kpi__value num">{{ dueSoon }}</span></div>
      <div class="kpi"><span class="kpi__label">Raggiunti nel {{ today.slice(0, 4) }}</span><span class="kpi__value num">{{ doneThisYear }}</span></div>
    </div>

    <UiSegmented v-model="filter" :options="FILTERS" label="Filtra obiettivi" class="gv__filter" />

    <section v-if="!list.length" class="panel">
      <UiEmpty :title="store.goals.length ? 'Nessun obiettivo in questa vista' : 'Definisci il tuo primo obiettivo'" icon="target">
        Un buon obiettivo ha una data e qualche tappa intermedia: le tappe con una data compaiono anche nel calendario dell'Agenda.
        <template #actions><UiButton variant="primary" icon="plus" @click="edit(null)">Nuovo obiettivo</UiButton></template>
      </UiEmpty>
    </section>

    <div v-else class="gv__grid">
      <article v-for="g in list" :key="g.id" class="goal" :class="`goal--${g.status}`" :style="{ '--c': `var(${areaOf(g.area).color})` }">
        <header class="goal__head">
          <span class="goal__emoji" aria-hidden="true">{{ areaOf(g.area).emoji }}</span>
          <div class="goal__title">
            <h2 :title="g.title">{{ g.title }}</h2>
            <span class="muted small">{{ areaOf(g.area).label }}</span>
          </div>
          <UiButton size="sm" variant="ghost" icon="edit" aria-label="Modifica obiettivo" @click="edit(g)" />
        </header>

        <div v-if="g.why || g.description || safeUrl(g.link)" class="goal__info" :class="{ open: expanded.has(g.id) }">
          <p v-if="g.why" class="goal__why clamp">«{{ g.why }}»</p>
          <p v-if="g.description" class="goal__desc clamp">{{ g.description }}</p>
          <button v-if="isLong(g)" type="button" class="goal__more small" :aria-expanded="expanded.has(g.id)" @click="toggleExpand(g.id)">
            {{ expanded.has(g.id) ? 'Mostra meno' : 'Leggi tutto' }}
          </button>
          <a v-if="safeUrl(g.link)" :href="safeUrl(g.link)!" target="_blank" rel="noopener noreferrer" class="goal__link small" :title="safeUrl(g.link)!">
            <UiIcon name="link" :size="14" />
            <span>{{ linkLabel(safeUrl(g.link)!) }}</span>
          </a>
        </div>

        <div class="goal__progress">
          <div class="bar" role="progressbar" :aria-valuenow="Math.round(goalProgress(g) * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="`Avanzamento di ${g.title}`"><span :style="{ width: pct(goalProgress(g)) }" /></div>
          <strong class="num">{{ pct(goalProgress(g)) }}</strong>
        </div>
        <p v-if="deadline(g)" class="goal__deadline small" :class="{ late: deadline(g)!.late }"><UiIcon name="flag" :size="14" /> {{ deadline(g)!.text }}</p>

        <ul v-if="g.milestones.length" class="ms">
          <li v-for="m in g.milestones" :key="m.id" :class="{ done: m.done, next: nextMilestone(g)?.id === m.id }">
            <label :title="m.title">
              <input type="checkbox" :checked="m.done" @change="store.toggleMilestone(g.id, m.id)" />
              <span>{{ m.title }}</span>
            </label>
            <span v-if="m.due" class="ms__due small" :class="{ late: !m.done && m.due < today }">{{ fmtShortDay(m.due) }}</span>
          </li>
        </ul>
        <form v-if="g.status === 'active'" class="goal__quick" @submit.prevent="addQuick(g)">
          <input v-model="quick[g.id]" class="input" placeholder="+ Aggiungi tappa" :aria-label="`Nuova tappa per ${g.title}`" maxlength="140" />
        </form>

        <footer class="goal__foot">
          <template v-if="g.status === 'active'">
            <UiButton size="sm" icon="check" @click="store.setStatus(g.id, 'done')">Raggiunto</UiButton>
            <UiButton size="sm" variant="ghost" @click="store.setStatus(g.id, 'paused')">Metti in pausa</UiButton>
          </template>
          <template v-else-if="g.status === 'paused'">
            <UiButton size="sm" @click="store.setStatus(g.id, 'active')">Riprendi</UiButton>
          </template>
          <template v-else>
            <span class="goal__done small"><UiIcon name="checkCircle" :size="15" /> Raggiunto{{ g.completedAt ? ` il ${fmtFullDate(g.completedAt.slice(0, 10))}` : '' }}</span>
            <UiButton size="sm" variant="ghost" @click="store.setStatus(g.id, 'active')">Riapri</UiButton>
          </template>
        </footer>
      </article>
    </div>

    <GoalDialog :open="dialog.open" :goal="dialog.goal" @close="dialog.open = false" />
  </div>
</template>

<style scoped>
.gv { display: flex; flex-direction: column; gap: 20px; }
.gv__filter { align-self: flex-start; background: var(--surface); }
.kpi { background: var(--surface); border-radius: var(--radius-lg); padding: 18px 22px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.kpi__label { font-size: 0.84rem; color: var(--text-secondary); }
.kpi__value { font-size: 2.1rem; letter-spacing: -0.03em; line-height: 1; }
.kpi--brand { background: var(--brand); color: var(--on-brand); }
.kpi--brand .kpi__label { color: var(--on-brand); }
.gv__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-4); align-items: start; }
.goal { background: var(--surface); border-radius: var(--radius-lg); padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; border-top: 4px solid var(--c); min-width: 0; }
.goal--paused { opacity: 0.7; }
.goal__head { display: flex; align-items: flex-start; gap: 12px; }
.goal__emoji { width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; font-size: 1.3rem; background: color-mix(in srgb, var(--c) 16%, transparent); flex-shrink: 0; }
.goal__title { flex: 1; min-width: 0; }
/* Testi lunghi troncati con «…»: il titolo su 2 righe, i testi su 3 (aperti con «Leggi tutto»). */
.goal__title h2 {
  font-size: 1.08rem; font-weight: 600; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
}
.goal__info { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.goal__info.open .clamp { display: block; -webkit-line-clamp: unset; line-clamp: none; }
.goal__why { font-size: 0.88rem; color: var(--text-secondary); font-style: italic; }
.goal__desc { font-size: 0.88rem; color: var(--text-primary); white-space: pre-line; }
.goal__more { all: unset; align-self: flex-start; cursor: pointer; color: var(--accent); font-weight: 500; }
.goal__more:hover { text-decoration: underline; }
.goal__more:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }
.goal__link { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; max-width: 100%; padding: 3px 10px; border-radius: 999px; background: var(--surface-2); color: var(--text-secondary); }
.goal__link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.goal__link:hover { color: var(--text-primary); text-decoration: none; background: color-mix(in srgb, var(--c) 14%, var(--surface)); }
.goal__progress { display: flex; align-items: center; gap: 10px; }
.bar { flex: 1; height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--c); border-radius: inherit; transition: width 0.3s ease; }
.goal--done .bar span { background: var(--positive); }
.goal__deadline { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); margin-top: -4px; }
.goal__deadline.late { color: var(--negative); }
.ms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ms li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 10px; }
.ms li.next { background: var(--surface-2); }
.ms label { display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0; font-size: 0.9rem; }
.ms label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ms label input { flex: none; }
.ms li.done label span { text-decoration: line-through; color: var(--text-muted); }
.ms__due { color: var(--text-muted); white-space: nowrap; }
.ms__due.late { color: var(--negative); font-weight: 500; }
.goal__quick .input { width: 100%; height: 34px; border-style: dashed; font-size: 0.86rem; }
.goal__foot { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 12px; }
.goal__done { display: inline-flex; align-items: center; gap: 6px; color: var(--positive); margin-right: auto; }
@media (max-width: 420px) { .gv__grid { grid-template-columns: minmax(0, 1fr); } }
</style>
