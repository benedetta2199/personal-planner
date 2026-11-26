<script setup lang="ts">
/**
 * Campo descrizione con suggerimenti dalle descrizioni già usate.
 * Il testo resta libero: i suggerimenti compaiono mentre scrivi (↑/↓, Invio, Esc).
 */
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'

export interface DescriptionSuggestion {
  text: string
  /** Testo secondario (es. categoria). */
  hint?: string
}

const props = withDefaults(defineProps<{ suggestions: DescriptionSuggestion[]; placeholder?: string; max?: number }>(), { max: 6 })
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ pick: [s: DescriptionSuggestion] }>()

const id = useId()
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const active = ref(-1)
const pos = ref({ top: 0, left: 0, width: 0, up: false })

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('it').trim()

const filtered = computed(() => {
  const q = key(model.value)
  if (!q) return []
  const starts: DescriptionSuggestion[] = []
  const contains: DescriptionSuggestion[] = []
  for (const s of props.suggestions) {
    const k = key(s.text)
    if (k === q) continue
    if (k.startsWith(q)) starts.push(s)
    else if (k.includes(q)) contains.push(s)
    if (starts.length >= props.max) break
  }
  return [...starts, ...contains].slice(0, props.max)
})
const visible = computed(() => open.value && filtered.value.length > 0)

function place() {
  const r = input.value?.getBoundingClientRect()
  if (!r) return
  const up = window.innerHeight - r.bottom < 240 && r.top > window.innerHeight - r.bottom
  pos.value = { top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, up }
}
function show() {
  if (open.value) return
  open.value = true
  place()
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
}
function hide() {
  open.value = false
  active.value = -1
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
}
onBeforeUnmount(hide)

function onInput() {
  active.value = -1
  show()
}
function choose(s: DescriptionSuggestion) {
  model.value = s.text
  emit('pick', s)
  hide()
  input.value?.focus()
}
function onKeydown(e: KeyboardEvent) {
  const n = filtered.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!visible.value) return show()
    e.preventDefault()
    active.value = e.key === 'ArrowDown' ? (active.value + 1) % n : (active.value - 1 + n) % n
    nextTick(() => list.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter' && visible.value && active.value >= 0) {
    e.preventDefault()
    choose(filtered.value[active.value])
  } else if (e.key === 'Escape' && visible.value) {
    // Esc chiude solo i suggerimenti, non il dialog.
    e.preventDefault()
    e.stopPropagation()
    hide()
  }
}

/** Evidenzia la parte che corrisponde a quanto scritto. */
function parts(text: string): [string, string, string] {
  const q = key(model.value)
  const i = key(text).indexOf(q)
  if (!q || i < 0) return [text, '', '']
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)]
}
</script>

<template>
  <div class="ds">
    <input
      ref="input"
      v-model="model"
      class="input ds__input"
      role="combobox"
      aria-label="Descrizione"
      aria-autocomplete="list"
      :aria-expanded="visible"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="visible && active >= 0 ? `${id}-opt-${active}` : undefined"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @keydown="onKeydown"
      @blur="hide"
    />
    <ul
      v-if="visible"
      :id="`${id}-list`"
      ref="list"
      role="listbox"
      aria-label="Descrizioni usate"
      class="ds__pop"
      :class="{ 'ds__pop--up': pos.up }"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }"
    >
      <li
        v-for="(s, i) in filtered"
        :id="`${id}-opt-${i}`"
        :key="s.text"
        :data-i="i"
        role="option"
        class="ds__opt"
        :class="{ 'ds__opt--active': i === active }"
        :aria-selected="i === active"
        @pointerenter="active = i"
        @pointerdown.prevent
        @click="choose(s)"
      >
        <span class="ds__label">{{ parts(s.text)[0] }}<mark>{{ parts(s.text)[1] }}</mark>{{ parts(s.text)[2] }}</span>
        <span v-if="s.hint" class="ds__hint">{{ s.hint }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ds { position: relative; min-width: 0; }
.ds__input { width: 100%; }
.ds__pop {
  position: fixed; z-index: 1000; list-style: none; margin: 0; padding: 6px; max-height: 260px; overflow-y: auto; overscroll-behavior: contain;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-pop);
}
.ds__pop--up { transform: translateY(-100%); }
.ds__opt { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 6px 10px; border-radius: 10px; cursor: pointer; font-size: 0.93rem; color: var(--text-primary); }
.ds__opt--active { background: var(--brand-soft); }
.ds__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ds__label mark { background: none; color: var(--accent); font-weight: 700; }
.ds__hint { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; color: var(--text-muted); }
</style>
