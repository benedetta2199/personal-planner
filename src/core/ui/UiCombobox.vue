<script setup lang="ts">
/**
 * Dropdown con ricerca (pattern ARIA "combobox" + "listbox").
 * - si apre al click o con ↓, filtra mentre scrivi (senza accenti né emoji iniziali);
 * - ↑/↓ per muoversi, Invio per scegliere, Esc per chiudere (senza chiudere il dialog);
 * - ogni voce può avere un'emoji, un pallino colorato o un campione di sfondo e un'indicazione a destra;
 * - con `allowCreate` il testo scritto diventa una nuova voce.
 * Il pannello è `position: fixed`, così non viene tagliato dai contenitori con scroll.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import UiIcon from './UiIcon.vue'

export interface ComboOption {
  value: string
  label: string
  /** Emoji mostrata a sinistra. */
  emoji?: string
  /** Pallino colorato (se non c'è emoji). */
  color?: string
  /** Sfondo del campione (es. gradiente della carta del conto). */
  swatch?: string
  /** Testo secondario a destra. */
  hint?: string
}

const props = withDefaults(
  defineProps<{
    options: ComboOption[]
    placeholder?: string
    label: string
    allowCreate?: boolean
    clearable?: boolean
    required?: boolean
    disabled?: boolean
    emptyText?: string
    /** Testo della voce "crea" (riceve quanto scritto). */
    createText?: (q: string) => string
  }>(),
  { placeholder: 'Scegli…', emptyText: 'Nessun risultato', createText: (q: string) => `Crea «${q}»` },
)
const model = defineModel<string>({ required: true })

const id = useId()
const listId = `${id}-list`
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const open = ref(false)
const query = ref('')
/** true dopo che l'utente ha scritto: prima si mostrano tutte le voci. */
const typed = ref(false)
const active = ref(0)
const pos = ref<{ top: number; left: number; width: number; maxHeight: number; up: boolean }>({ top: 0, left: 0, width: 0, maxHeight: 280, up: false })

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .toLocaleLowerCase('it')
    .trim()

const selected = computed(() => props.options.find((o) => o.value === model.value) ?? null)
const displayText = computed(() => selected.value?.label ?? model.value)

const filtered = computed(() => {
  const q = key(query.value)
  if (!typed.value || !q) return props.options
  const starts: ComboOption[] = []
  const contains: ComboOption[] = []
  for (const o of props.options) {
    const k = key(o.label)
    if (k.startsWith(q)) starts.push(o)
    else if (k.includes(q) || (o.hint && key(o.hint).includes(q))) contains.push(o)
  }
  return [...starts, ...contains]
})

const canCreate = computed(() => {
  if (!props.allowCreate || !typed.value) return false
  const q = query.value.trim()
  return !!q && !props.options.some((o) => key(o.label) === key(q) || key(o.value) === key(q))
})
/** Voci navigabili: le opzioni filtrate più l'eventuale "crea". */
const count = computed(() => filtered.value.length + (canCreate.value ? 1 : 0))

function place() {
  const el = input.value?.parentElement
  if (!el) return
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - 12
  const above = r.top - 12
  const up = below < 200 && above > below
  pos.value = { top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, maxHeight: Math.max(160, Math.min(300, up ? above : below)), up }
}

function show() {
  if (props.disabled || open.value) return
  open.value = true
  typed.value = false
  query.value = displayText.value
  const i = filtered.value.findIndex((o) => o.value === model.value)
  active.value = i >= 0 ? i : 0
  place()
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onOutside, true)
  nextTick(scrollActive)
}

function hide(commit = true) {
  if (!open.value) return
  // Testo libero: con allowCreate diventa il valore (o la voce che corrisponde).
  if (commit && typed.value) {
    const q = query.value.trim()
    const match = props.options.find((o) => key(o.label) === key(q) || key(o.value) === key(q))
    if (match) model.value = match.value
    else if (props.allowCreate) model.value = q
  }
  open.value = false
  typed.value = false
  query.value = ''
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onOutside, true)
}
onBeforeUnmount(() => hide(false))

function onOutside(e: Event) {
  const t = e.target as Node
  if (root.value?.contains(t) || list.value?.contains(t)) return
  hide()
}

function choose(i: number) {
  if (i < filtered.value.length) model.value = filtered.value[i].value
  else if (canCreate.value) model.value = query.value.trim()
  typed.value = false
  hide(false)
  input.value?.focus()
}

function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  typed.value = true
  active.value = 0
  if (!open.value) {
    show()
    typed.value = true
    query.value = (e.target as HTMLInputElement).value
  }
}

function move(delta: number) {
  if (!open.value) return show()
  if (!count.value) return
  active.value = (active.value + delta + count.value) % count.value
  nextTick(scrollActive)
}

function scrollActive() {
  list.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    if (!open.value) return
    e.preventDefault()
    if (count.value) choose(active.value)
    else hide()
  } else if (e.key === 'Escape') {
    if (!open.value) return
    // Impedisce al <dialog> di chiudersi: Esc chiude solo la lista.
    e.preventDefault()
    e.stopPropagation()
    hide(false)
  } else if (e.key === 'Tab') {
    hide()
  }
}

function clear() {
  model.value = ''
  hide(false)
  input.value?.focus()
}

watch(
  () => props.options,
  () => {
    if (active.value >= count.value) active.value = Math.max(0, count.value - 1)
  },
)

/** Evidenzia la parte che corrisponde alla ricerca. */
function parts(label: string): [string, string, string] {
  const q = key(query.value)
  if (!typed.value || !q) return [label, '', '']
  const i = key(label).indexOf(q)
  // key() rimuove i simboli iniziali: si ricalcola l'offset sul testo originale.
  const offset = label.length - label.replace(/^[^\p{L}\p{N}]+/u, '').length
  if (i < 0) return [label, '', '']
  const start = offset + i
  return [label.slice(0, start), label.slice(start, start + q.length), label.slice(start + q.length)]
}
</script>

<template>
  <div ref="root" class="cb" :class="{ 'cb--open': open, 'cb--disabled': disabled }">
    <div class="cb__field" @click="open ? null : (show(), input?.focus())">
      <span v-if="selected?.emoji && !(open && typed)" class="cb__lead cb__emoji" aria-hidden="true">{{ selected.emoji }}</span>
      <span v-else-if="selected?.swatch && !(open && typed)" class="cb__lead cb__swatch" :style="{ background: selected.swatch }" aria-hidden="true" />
      <span v-else-if="selected?.color && !(open && typed)" class="cb__lead cb__dot" :style="{ background: selected.color }" aria-hidden="true" />
      <UiIcon v-else-if="open" name="search" :size="16" class="cb__lead cb__search" />
      <input
        ref="input"
        class="cb__input"
        role="combobox"
        :aria-label="label"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open && count ? `${id}-opt-${active}` : undefined"
        aria-autocomplete="list"
        autocomplete="off"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :value="open ? query : displayText"
        @focus="show"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button v-if="clearable && model && !disabled" type="button" class="cb__btn" aria-label="Svuota" tabindex="-1" @click.stop="clear">
        <UiIcon name="close" :size="14" />
      </button>
      <button type="button" class="cb__btn cb__chev" :aria-label="open ? 'Chiudi elenco' : 'Apri elenco'" tabindex="-1" @click.stop="open ? hide() : (show(), input?.focus())">
        <UiIcon name="chevron" :size="16" />
      </button>
    </div>

    <div
      v-if="open"
      ref="list"
      class="cb__pop"
      :class="{ 'cb__pop--up': pos.up }"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px`, maxHeight: `${pos.maxHeight}px` }"
    >
      <ul :id="listId" role="listbox" :aria-label="label" class="cb__list">
        <li
          v-for="(o, i) in filtered"
          :id="`${id}-opt-${i}`"
          :key="o.value"
          :data-i="i"
          role="option"
          class="cb__opt"
          :class="{ 'cb__opt--active': i === active }"
          :aria-selected="o.value === model"
          @pointerenter="active = i"
          @pointerdown.prevent
          @click="choose(i)"
        >
          <span v-if="o.emoji" class="cb__emoji" aria-hidden="true">{{ o.emoji }}</span>
          <span v-else-if="o.swatch" class="cb__swatch" :style="{ background: o.swatch }" aria-hidden="true" />
          <span v-else-if="o.color" class="cb__dot" :style="{ background: o.color }" aria-hidden="true" />
          <span class="cb__label">{{ parts(o.label)[0] }}<mark>{{ parts(o.label)[1] }}</mark>{{ parts(o.label)[2] }}</span>
          <span v-if="o.hint" class="cb__hint">{{ o.hint }}</span>
          <UiIcon v-if="o.value === model" name="check" :size="16" class="cb__check" />
        </li>
        <li
          v-if="canCreate"
          :id="`${id}-opt-${filtered.length}`"
          :data-i="filtered.length"
          role="option"
          aria-selected="false"
          class="cb__opt cb__opt--create"
          :class="{ 'cb__opt--active': active === filtered.length }"
          @pointerenter="active = filtered.length"
          @pointerdown.prevent
          @click="choose(filtered.length)"
        >
          <span class="cb__plus" aria-hidden="true"><UiIcon name="plus" :size="14" /></span>
          <span class="cb__label">{{ createText(query.trim()) }}</span>
        </li>
        <li v-if="!count" class="cb__empty">{{ emptyText }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cb { position: relative; min-width: 0; }
.cb__field {
  display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 6px 0 12px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface);
  cursor: text; transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cb__field:hover { border-color: var(--text-muted); }
.cb--open .cb__field, .cb__field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--brand-soft); }
.cb--disabled .cb__field { opacity: 0.6; cursor: not-allowed; }
.cb__input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font: inherit; font-size: 0.95rem; color: var(--text-primary); }
.cb__input::placeholder { color: var(--text-muted); }
.cb__lead { flex-shrink: 0; }
.cb__search { color: var(--text-muted); }
.cb__btn {
  display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px;
  background: none; color: var(--text-muted); cursor: pointer; flex-shrink: 0;
}
.cb__btn:hover { background: var(--surface-2); color: var(--text-primary); }
.cb__chev :deep(svg) { transition: transform 0.15s ease; }
.cb--open .cb__chev :deep(svg) { transform: rotate(180deg); }

.cb__emoji { font-size: 1.15rem; line-height: 1; width: 22px; text-align: center; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; }
.cb__dot { width: 10px; height: 10px; border-radius: 50%; margin: 0 6px; flex-shrink: 0; }
.cb__swatch { width: 26px; height: 17px; border-radius: 5px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }

.cb__pop {
  position: fixed; z-index: 1000; overflow-y: auto; overscroll-behavior: contain;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-pop);
  padding: 6px; animation: cb-in 0.12s ease-out;
}
.cb__pop--up { transform: translateY(-100%); animation-name: cb-in-up; }
@keyframes cb-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes cb-in-up { from { opacity: 0; transform: translateY(calc(-100% + 4px)); } to { opacity: 1; transform: translateY(-100%); } }
.cb__list { list-style: none; margin: 0; padding: 0; }
.cb__opt {
  display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 10px; border-radius: 10px;
  cursor: pointer; font-size: 0.93rem; color: var(--text-primary);
}
.cb__opt--active { background: var(--brand-soft); }
.cb__opt[aria-selected='true'] { font-weight: 600; }
.cb__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb__label mark { background: none; color: var(--accent); font-weight: 700; }
.cb__hint { flex-shrink: 0; font-size: 0.76rem; color: var(--text-muted); font-weight: 400; }
.cb__check { color: var(--accent); }
.cb__opt--create { color: var(--accent); border-top: 1px solid var(--border); border-radius: 0 0 10px 10px; margin-top: 4px; }
.cb__plus { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--brand-soft); }
.cb__empty { padding: 12px 10px; color: var(--text-muted); font-size: 0.88rem; }
@media (prefers-reduced-motion: reduce) { .cb__pop { animation: none; } }
</style>
