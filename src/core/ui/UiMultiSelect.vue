<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import UiIcon from './UiIcon.vue'

export interface SelectOption {
  value: string
  label: string
  group?: string
  swatch?: string
}

const props = defineProps<{ label: string; options: SelectOption[]; placeholder?: string }>()
const model = defineModel<string[]>({ required: true })

const open = ref(false)
const query = ref('')
const root = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const id = useId()

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.options.filter((o) => `${o.label} ${o.group ?? ''}`.toLowerCase().includes(q)) : props.options
})

const grouped = computed(() => {
  const groups = new Map<string, SelectOption[]>()
  for (const o of filtered.value) {
    const g = o.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(o)
  }
  return [...groups.entries()]
})

const summary = computed(() => {
  if (!model.value.length) return props.placeholder ?? 'Tutti'
  if (model.value.length === 1) return props.options.find((o) => o.value === model.value[0])?.label ?? model.value[0]
  return `${model.value.length} selezionati`
})

function toggle(value: string) {
  model.value = model.value.includes(value) ? model.value.filter((v) => v !== value) : [...model.value, value]
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    await nextTick()
    if (props.options.length > 8) searchInput.value?.focus()
  } else {
    query.value = ''
    document.removeEventListener('mousedown', onDocClick)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="ms">
    <span :id="`${id}-label`" class="ms__label">{{ label }}</span>
    <button
      type="button"
      class="ms__trigger input"
      :class="{ 'ms__trigger--active': model.length }"
      :aria-expanded="open"
      :aria-labelledby="`${id}-label`"
      :aria-controls="`${id}-pop`"
      :disabled="!options.length"
      @click="open = !open"
    >
      <span class="ms__summary">{{ summary }}</span>
      <UiIcon name="chevron" :size="15" />
    </button>
    <div v-if="open" :id="`${id}-pop`" class="ms__pop" role="group" :aria-labelledby="`${id}-label`">
      <div v-if="options.length > 8" class="ms__search">
        <input ref="searchInput" v-model="query" class="input" type="search" placeholder="Cerca…" :aria-label="`Cerca ${label}`" />
      </div>
      <div class="ms__list">
        <template v-for="[group, items] in grouped" :key="group">
          <div v-if="group" class="ms__group">{{ group }}</div>
          <label v-for="o in items" :key="o.value" class="ms__opt">
            <input type="checkbox" :checked="model.includes(o.value)" @change="toggle(o.value)" />
            <span v-if="o.swatch" class="ms__swatch" :style="{ background: `var(${o.swatch})` }" aria-hidden="true" />
            <span class="ms__text">{{ o.label }}</span>
          </label>
        </template>
        <p v-if="!filtered.length" class="muted small ms__none">Nessun risultato</p>
      </div>
      <div class="ms__foot">
        <button type="button" class="ms__link" :disabled="!model.length" @click="model = []">Azzera</button>
        <button type="button" class="ms__link" @click="open = false">Chiudi</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ms__label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
.ms__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  cursor: pointer;
  text-align: left;
}
.ms__trigger--active { border-color: var(--accent); background: var(--accent-soft); }
.ms__summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms__pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  min-width: max(100%, 240px);
  max-width: min(340px, calc(100vw - 32px));
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
.ms__search { padding: 8px; border-bottom: 1px solid var(--border); }
.ms__search .input { width: 100%; }
.ms__list { max-height: 280px; overflow-y: auto; padding: 4px 0; }
.ms__group {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  padding: 8px 12px 2px;
}
.ms__opt { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; font-size: 0.9rem; }
.ms__opt:hover { background: var(--surface-2); }
.ms__opt input { accent-color: var(--accent); margin: 0; }
.ms__swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.ms__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms__none { padding: 8px 12px; }
.ms__foot { display: flex; justify-content: space-between; border-top: 1px solid var(--border); padding: 6px 8px; }
.ms__link { background: none; border: 0; color: var(--accent); cursor: pointer; font-size: 0.85rem; padding: 4px; }
.ms__link:disabled { color: var(--text-muted); cursor: default; }
</style>
