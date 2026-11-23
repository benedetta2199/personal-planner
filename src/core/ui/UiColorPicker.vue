<script setup lang="ts">
/**
 * Selettore colore (Reka UI): palette di colori consigliati, area saturazione/luminosità,
 * cursore della tonalità e campo esadecimale. Restituisce sempre «#rrggbb» minuscolo.
 * Il pannello non usa portal, così funziona anche dentro i <dialog> modali.
 */
import { computed, ref, watch } from 'vue'
import {
  ColorAreaArea,
  ColorAreaRoot,
  ColorAreaThumb,
  ColorSliderRoot,
  ColorSliderThumb,
  ColorSliderTrack,
  ColorSwatchPickerItem,
  ColorSwatchPickerItemIndicator,
  ColorSwatchPickerItemSwatch,
  ColorSwatchPickerRoot,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ label: string; presets?: string[]; showValue?: boolean }>(), { presets: () => [], showValue: false })
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ commit: [color: string] }>()

const open = ref(false)
const HEX = /^#?([0-9a-f]{6})$/i
const normalize = (v: string) => {
  const m = HEX.exec(v.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

/** Valore di lavoro: si applica subito, ma `commit` scatta alla chiusura del pannello. */
const color = computed({
  get: () => normalize(model.value) ?? '#888888',
  set: (v: string) => {
    const n = normalize(v)
    if (n && n !== model.value) model.value = n
  },
})
const presetValue = computed(() => (props.presets.map((p) => p.toLowerCase()).includes(color.value) ? color.value : undefined))

const hexDraft = ref(color.value)
watch(color, (c) => (hexDraft.value = c))
function applyHex() {
  const n = normalize(hexDraft.value)
  if (n) color.value = n
  else hexDraft.value = color.value
}

const startColor = ref(color.value)
watch(open, (o) => {
  if (o) startColor.value = color.value
  else if (color.value !== startColor.value) emit('commit', color.value)
})
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" :color="color" :open="open">
        <button type="button" class="cp__trigger" :aria-label="label">
          <span class="cp__dot" :style="{ background: color }" aria-hidden="true" />
          <span v-if="showValue" class="cp__value num">{{ color }}</span>
          <UiIcon name="chevron" :size="14" class="cp__chev" />
        </button>
      </slot>
    </PopoverTrigger>

    <PopoverContent class="cp__pop" side="bottom" align="start" :side-offset="8" :collision-padding="12">
      <p class="cp__title">{{ label }}</p>

      <ColorSwatchPickerRoot
        v-if="presets.length"
        :model-value="presetValue"
        class="cp__swatches"
        aria-label="Colori consigliati"
        @update:model-value="(v) => typeof v === 'string' && (color = v)"
      >
        <ColorSwatchPickerItem v-for="p in presets" :key="p" :value="p.toLowerCase()" class="cp__swatch">
          <ColorSwatchPickerItemSwatch class="cp__swatch-fill" />
          <ColorSwatchPickerItemIndicator class="cp__swatch-check"><UiIcon name="check" :size="13" /></ColorSwatchPickerItemIndicator>
        </ColorSwatchPickerItem>
      </ColorSwatchPickerRoot>

      <ColorAreaRoot v-slot="{ style }" v-model="color" color-space="hsb" x-channel="saturation" y-channel="brightness" class="cp__arearoot">
        <ColorAreaArea class="cp__area" :style="style">
          <ColorAreaThumb class="cp__thumb" :style="{ background: color }" aria-label="Saturazione e luminosità" />
        </ColorAreaArea>
      </ColorAreaRoot>

      <ColorSliderRoot v-model="color" channel="hue" color-space="hsb" class="cp__slider">
        <ColorSliderTrack class="cp__track" />
        <ColorSliderThumb class="cp__sthumb" aria-label="Tonalità" />
      </ColorSliderRoot>

      <div class="cp__foot">
        <span class="cp__preview" :style="{ background: color }" aria-hidden="true" />
        <label class="cp__hex">
          <span class="sr-only">Codice esadecimale</span>
          <input v-model="hexDraft" class="input num" maxlength="7" spellcheck="false" @keydown.enter.prevent="applyHex" @blur="applyHex" />
        </label>
      </div>
    </PopoverContent>
  </PopoverRoot>
</template>

<style>
/* Non «scoped»: i pannelli di Reka (Popover/DatePicker) non ricevono l attributo di scope,
 * quindi le regole vanno globali. Le classi hanno un prefisso univoco. */
.cp__trigger {
  display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px 0 8px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer;
}
.cp__trigger:hover { border-color: var(--text-muted); }
.cp__trigger[data-state='open'] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--brand-soft); }
.cp__dot { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
.cp__value { font-size: 0.85rem; color: var(--text-secondary); }
.cp__chev { color: var(--text-muted); }

.cp__pop {
  z-index: 1000; width: 260px; padding: 14px; display: flex; flex-direction: column; gap: 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-pop);
}
.cp__pop[data-state='open'] { animation: cp-in 0.12s ease-out; }
@keyframes cp-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
.cp__title { font-size: 0.8rem; color: var(--text-secondary); }

.cp__swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; outline: none; }
.cp__swatch { position: relative; display: grid; place-items: center; aspect-ratio: 1; border-radius: 50%; cursor: pointer; outline: none; }
.cp__swatch-fill { width: 100%; height: 100%; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1); }
.cp__swatch[data-highlighted] .cp__swatch-fill, .cp__swatch:hover .cp__swatch-fill { transform: scale(1.1); transition: transform 0.1s ease; }
.cp__swatch[data-state='checked'] .cp__swatch-fill { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.cp__swatch-check { position: absolute; color: #fff; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4)); }

.cp__area { position: relative; height: 150px; border-radius: 12px; touch-action: none; cursor: crosshair; }
.cp__thumb {
  width: 18px; height: 18px; border-radius: 50%; border: 3px solid #fff; transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.25); outline: none;
}
.cp__thumb:focus-visible { box-shadow: 0 0 0 3px var(--accent); }

.cp__slider { position: relative; display: flex; align-items: center; height: 18px; touch-action: none; }
.cp__track { position: relative; flex: 1; height: 12px; border-radius: 999px; }
.cp__sthumb {
  display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; cursor: grab;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.25); outline: none;
}
.cp__sthumb:focus-visible { box-shadow: 0 0 0 3px var(--accent); }

.cp__foot { display: flex; align-items: center; gap: 10px; }
.cp__preview { width: 34px; height: 34px; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1); flex-shrink: 0; }
.cp__hex { flex: 1; }
.cp__hex .input { width: 100%; height: 34px; text-transform: lowercase; }
@media (prefers-reduced-motion: reduce) { .cp__pop[data-state='open'] { animation: none; } }
</style>
