<script setup lang="ts">
/**
 * Selettore dell'emoji di una categoria (Popover di Reka UI): griglia di emoji consigliate
 * con ricerca per nome, più un campo per usarne una qualsiasi.
 */
import { computed, ref, watch } from 'vue'
import { PopoverContent, PopoverRoot, PopoverTrigger } from 'reka-ui'
import UiIcon from '@/core/ui/UiIcon.vue'
import { EMOJI_CHOICES, isEmoji, leadingEmoji } from '../categoryIcons'
import { norm } from '../domain'

const props = withDefaults(defineProps<{ label: string; color?: string; size?: number }>(), { color: 'var(--surface-2)', size: 40 })
const model = defineModel<string>({ required: true })

const open = ref(false)
const query = ref('')
const custom = ref('')
watch(open, (o) => {
  if (o) {
    query.value = ''
    custom.value = ''
  }
})

const list = computed(() => {
  const q = norm(query.value)
  return q ? EMOJI_CHOICES.filter((e) => norm(e.label).includes(q)) : EMOJI_CHOICES
})

function choose(emoji: string) {
  model.value = emoji
  open.value = false
}
function useCustom() {
  const e = leadingEmoji(custom.value)
  if (e) choose(e)
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="ep__trigger"
        :style="{ background: props.color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.5)}px` }"
        :aria-label="`${label}: ${model}. Cambia emoji`"
        :title="label"
      >
        <span class="ep__emoji" aria-hidden="true">{{ model }}</span>
        <span class="ep__badge" aria-hidden="true"><UiIcon name="edit" :size="10" /></span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="ep__pop" side="bottom" align="start" :side-offset="8" :collision-padding="12">
      <label class="ep__search">
        <UiIcon name="search" :size="15" />
        <input v-model="query" placeholder="Cerca (es. casa, cibo…)" aria-label="Cerca emoji" />
      </label>
      <div class="ep__grid" role="listbox" :aria-label="label">
        <button
          v-for="e in list"
          :key="e.emoji"
          type="button"
          role="option"
          class="ep__opt"
          :class="{ on: e.emoji === model }"
          :aria-selected="e.emoji === model"
          :title="e.label"
          @click="choose(e.emoji)"
        >
          {{ e.emoji }}
        </button>
        <p v-if="!list.length" class="ep__none">Nessuna emoji con questo nome: scrivine una qui sotto.</p>
      </div>
      <form class="ep__custom" @submit.prevent="useCustom">
        <input v-model="custom" class="input" maxlength="8" placeholder="Altra emoji…" aria-label="Scrivi un'emoji" />
        <button type="submit" class="ep__use" :disabled="!isEmoji(custom)">Usa</button>
      </form>
      <p class="ep__hint">Su Windows apri tutte le emoji con <kbd>Win</kbd> + <kbd>.</kbd></p>
    </PopoverContent>
  </PopoverRoot>
</template>

<style>
/* Non «scoped»: i pannelli di Reka (Popover/DatePicker) non ricevono l attributo di scope,
 * quindi le regole vanno globali. Le classi hanno un prefisso univoco. */
.ep__trigger {
  position: relative; display: grid; place-items: center; flex-shrink: 0; border: 0; border-radius: 50%; cursor: pointer;
  box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.35); transition: transform 0.12s ease;
}
.ep__trigger:hover { transform: scale(1.06); }
.ep__trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ep__emoji, .ep__opt { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif; line-height: 1; }
.ep__badge {
  position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
  background: var(--surface); color: var(--text-secondary); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); opacity: 0; transition: opacity 0.12s ease;
}
.ep__trigger:hover .ep__badge, .ep__trigger:focus-visible .ep__badge, .ep__trigger[data-state='open'] .ep__badge { opacity: 1; }

.ep__pop {
  z-index: 1000; width: 300px; padding: 12px; display: flex; flex-direction: column; gap: 10px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-pop);
}
.ep__pop[data-state='open'] { animation: ep-in 0.12s ease-out; }
@keyframes ep-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
.ep__search {
  display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border-radius: 10px;
  background: var(--surface-2); color: var(--text-muted);
}
.ep__search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: 0.88rem; color: var(--text-primary); }
.ep__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; max-height: 210px; overflow-y: auto; }
.ep__opt { aspect-ratio: 1; border: 0; border-radius: 10px; background: none; font-size: 1.35rem; cursor: pointer; }
.ep__opt:hover, .ep__opt:focus-visible { background: var(--surface-2); outline: none; }
.ep__opt.on { background: var(--brand-soft); box-shadow: inset 0 0 0 2px var(--accent); }
.ep__none { grid-column: 1 / -1; padding: 8px 4px; font-size: 0.8rem; color: var(--text-muted); }
.ep__custom { display: flex; gap: 6px; }
.ep__custom .input { flex: 1; height: 34px; }
.ep__use { padding: 0 14px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; font: inherit; font-size: 0.85rem; }
.ep__use:disabled { opacity: 0.5; cursor: default; }
.ep__hint { font-size: 0.72rem; color: var(--text-muted); }
.ep__hint kbd { padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; font-family: inherit; font-size: 0.7rem; }
@media (prefers-reduced-motion: reduce) { .ep__pop[data-state='open'] { animation: none; } }
</style>
