<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiPageHeader from '@/core/ui/UiPageHeader.vue'
import UiPeriodNav from '@/core/ui/UiPeriodNav.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import { addDaysTo, daysBetween, dayRange, fmtFullDate, fmtLongDay, isoWeekday, todayDay, type IsoDay } from '@/core/utils/dates'
import { isEmptyEntry, MOODS, PROMPTS, WEEKLY_REVIEW, useJournalStore, type JournalEntry } from './store'

const store = useJournalStore()
const today = todayDay()
const date = ref<IsoDay>(today)

/** Bozza della pagina aperta: salvata automaticamente poco dopo ogni modifica. */
const draft = ref<JournalEntry>(store.get(today) ? clone(store.get(today)!) : store.blank(today))
const tagInput = ref('')
const savedAt = ref<string | null>(null)
function clone(e: JournalEntry): JournalEntry {
  const g = [...e.gratitude]
  while (g.length < 3) g.push('')
  return { ...e, gratitude: g, tags: [...e.tags] }
}

let timer: ReturnType<typeof setTimeout> | null = null
/** Versione della pagina corrispondente alla bozza (salvata da qui o caricata). */
let loadedAt: string | undefined = store.get(today)?.updatedAt
/** La bozza è appena stata caricata dallo store: non va risalvata. */
let loading = false
function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  store.save(draft.value)
  loadedAt = store.get(date.value)?.updatedAt
  savedAt.value = isEmptyEntry(draft.value) ? null : new Date().toISOString()
}
watch(draft, () => {
  if (loading) {
    loading = false
    return
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 500)
}, { deep: true })
onBeforeUnmount(() => timer && flush())

function load(d: IsoDay) {
  const e = store.get(d)
  loading = true
  draft.value = e ? clone(e) : store.blank(d)
  loadedAt = e?.updatedAt
  savedAt.value = e?.updatedAt ?? null
}

function open(d: IsoDay) {
  if (timer) flush()
  date.value = d
  load(d)
  tagInput.value = ''
}

// Pagina aggiornata altrove (es. arrivata dal foglio Google da un altro dispositivo) senza modifiche in corso qui.
watch(() => store.get(date.value)?.updatedAt, (u) => {
  if (!timer && u !== loadedAt) load(date.value)
})

const prompt = computed(() => PROMPTS[Math.abs(daysBetween('2026-01-01', date.value)) % PROMPTS.length])
const isSunday = computed(() => isoWeekday(date.value) === 7)
function insertReview() {
  draft.value.text = draft.value.text.trim() ? `${draft.value.text.trimEnd()}\n\n${WEEKLY_REVIEW}` : WEEKLY_REVIEW
}

function addTag() {
  const tags = tagInput.value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean)
  for (const t of tags) if (!draft.value.tags.includes(t)) draft.value.tags.push(t)
  tagInput.value = ''
}
const suggestions = computed(() => store.allTags.filter((t) => !draft.value.tags.includes(t)).slice(0, 8))

/** Elenco delle pagine con ricerca testuale e per tag. */
const query = ref('')
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const results = computed(() => {
  const q = norm(query.value.trim().replace(/^#/, ''))
  const list = q ? store.entries.filter((e) => norm(`${e.text} ${e.gratitude.join(' ')} ${e.tags.join(' ')}`).includes(q)) : store.entries
  return list.slice(0, 60)
})
const excerpt = (e: JournalEntry) => e.text.replace(/[#*_>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || e.gratitude.filter(Boolean).join(' · ') || '—'

const last30 = computed(() => dayRange(addDaysTo(today, -29), today))
const moodOf = (d: IsoDay) => MOODS.find((m) => m.value === store.get(d)?.mood) ?? null
const avgMood = computed(() => {
  const v = last30.value.map((d) => store.get(d)?.mood).filter((m): m is NonNullable<typeof m> => !!m)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
})
const writtenDays = computed(() => last30.value.filter((d) => store.get(d)).length)
</script>

<template>
  <div class="jv">
    <UiPageHeader title="Diario" subtitle="Una pagina al giorno: umore, pensieri, gratitudine" />
    <UiAlert v-if="store.saveFailed" tone="critical" title="Salvataggio non riuscito">Il browser non permette di salvare i dati: le ultime modifiche andranno perse alla chiusura.</UiAlert>

    <div class="jv__layout">
      <section class="panel jv__editor">
        <div class="panel__head">
          <UiPeriodNav :label="fmtLongDay(date)" :is-current="date === today" @prev="open(addDaysTo(date, -1))" @next="open(addDaysTo(date, 1))" @current="open(today)" />
          <span class="muted small" aria-live="polite">{{ savedAt ? 'Salvato' : '' }}</span>
        </div>

        <fieldset class="moods">
          <legend>Com'è andata la giornata?</legend>
          <button
            v-for="m in MOODS"
            :key="m.value"
            type="button"
            class="mood"
            :class="{ on: draft.mood === m.value }"
            :style="{ '--m': m.color }"
            :aria-pressed="draft.mood === m.value"
            @click="draft.mood = draft.mood === m.value ? null : m.value"
          >
            <span aria-hidden="true">{{ m.emoji }}</span>
            <small>{{ m.label }}</small>
          </button>
        </fieldset>

        <div class="jv__prompt">
          <UiIcon name="info" :size="15" />
          <span>{{ prompt }}</span>
          <UiButton v-if="isSunday" size="sm" variant="ghost" class="jv__review" @click="insertReview">Revisione settimanale</UiButton>
        </div>
        <textarea v-model="draft.text" class="input jv__text" rows="12" placeholder="Scrivi liberamente…" aria-label="Testo della pagina" />
        <UiButton v-if="!isSunday" size="sm" variant="ghost" class="jv__review-alt" @click="insertReview">Inserisci modello di revisione settimanale</UiButton>

        <fieldset class="grat">
          <legend>Tre cose per cui sono grato/a</legend>
          <input v-for="i in 3" :key="i" v-model="draft.gratitude[i - 1]" class="input" :placeholder="`${i}.`" :aria-label="`Gratitudine ${i}`" maxlength="200" />
        </fieldset>

        <div class="tags">
          <span v-for="t in draft.tags" :key="t" class="tag">#{{ t }}<button type="button" :aria-label="`Rimuovi ${t}`" @click="draft.tags = draft.tags.filter((x) => x !== t)"><UiIcon name="close" :size="12" /></button></span>
          <input v-model="tagInput" class="input tags__input" placeholder="Aggiungi tag (Invio)" aria-label="Nuovo tag" maxlength="40" @keydown.enter.prevent="addTag" @keydown.,.prevent="addTag" @blur="tagInput && addTag()" />
        </div>
        <div v-if="suggestions.length" class="tags__sugg">
          <button v-for="t in suggestions" :key="t" type="button" class="tag tag--sugg" @click="draft.tags.push(t)">#{{ t }}</button>
        </div>
      </section>

      <aside class="stack">
        <section class="panel">
          <h2 class="panel__title">Ultimi 30 giorni</h2>
          <div class="strip" role="img" :aria-label="`Umore degli ultimi 30 giorni, scritto in ${writtenDays} giorni`">
            <button v-for="d in last30" :key="d" type="button" class="strip__day" :class="{ sel: d === date, has: store.get(d) }" :style="{ background: moodOf(d)?.color }" :title="`${fmtFullDate(d)}${moodOf(d) ? ' · ' + moodOf(d)!.label : ''}`" @click="open(d)" />
          </div>
          <p class="muted small strip__info">{{ writtenDays }} pagine scritte<template v-if="avgMood"> · umore medio {{ MOODS[Math.round(avgMood) - 1].emoji }} {{ avgMood.toFixed(1).replace('.', ',') }}</template></p>
        </section>

        <section class="panel">
          <h2 class="panel__title">Pagine</h2>
          <input v-model="query" class="input jv__search" type="search" placeholder="Cerca nel diario o #tag" aria-label="Cerca nel diario" />
          <ul v-if="results.length" class="entries">
            <li v-for="e in results" :key="e.date">
              <button type="button" class="entry" :class="{ sel: e.date === date }" @click="open(e.date)">
                <span class="entry__head">
                  <strong>{{ fmtFullDate(e.date) }}</strong>
                  <span v-if="e.mood" aria-hidden="true">{{ MOODS[e.mood - 1].emoji }}</span>
                </span>
                <span class="entry__text small">{{ excerpt(e) }}</span>
                <span v-if="e.tags.length" class="entry__tags small">{{ e.tags.map((t) => '#' + t).join(' ') }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="muted small">{{ store.entries.length ? 'Nessuna pagina trovata.' : 'Le pagine che scrivi compariranno qui.' }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.jv { display: flex; flex-direction: column; gap: 20px; }
.jv__layout { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr); gap: var(--space-4); align-items: start; }
.jv__editor { display: flex; flex-direction: column; gap: 14px; }
.jv__editor .panel__head { margin-bottom: 0; }
.jv__editor :deep(.pn) { background: var(--surface-2); }
.moods { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.moods legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px; padding: 0; }
.mood { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 1.5rem; }
.mood small { font-size: 0.72rem; color: var(--text-muted); }
.mood:hover { background: var(--surface-2); }
.mood.on { border-color: var(--m); background: color-mix(in srgb, var(--m) 14%, var(--surface)); box-shadow: inset 0 0 0 1px var(--m); }
.mood.on small { color: var(--text-primary); font-weight: 500; }
.jv__prompt { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 0.9rem; background: var(--brand-soft); padding: 8px 12px; border-radius: 12px; }
.jv__review { margin-left: auto; }
.jv__review-alt { align-self: flex-start; margin-top: -8px; }
.jv__text { width: 100%; min-height: 240px; line-height: 1.6; font-size: 0.98rem; }
.grat { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.grat legend { font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 6px; padding: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tags__input { flex: 1; min-width: 160px; height: 34px; }
.tags__sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -6px; }
.tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: var(--brand-soft); color: var(--accent); font-size: 0.82rem; border: 0; }
.tag button { border: 0; background: none; padding: 0; cursor: pointer; color: inherit; display: grid; }
.tag--sugg { background: var(--surface-2); color: var(--text-secondary); cursor: pointer; }
.strip { display: grid; grid-template-columns: repeat(15, 1fr); gap: 4px; margin-top: 10px; }
.strip__day { aspect-ratio: 1; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; padding: 0; }
.strip__day.has:not([style*='background']) { background: var(--border-strong); }
.strip__day.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
.strip__info { margin-top: 8px; }
.jv__search { width: 100%; margin: 10px 0; }
.entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 520px; overflow-y: auto; }
.entry { width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.entry:hover { background: var(--surface-2); }
.entry.sel { background: var(--brand-soft); }
.entry__head { display: flex; justify-content: space-between; gap: 8px; }
.entry__head strong { font-weight: 500; font-size: 0.9rem; }
.entry__text { color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.entry__tags { color: var(--accent); }
@media (max-width: 1000px) { .jv__layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .mood small { display: none; } }
</style>
