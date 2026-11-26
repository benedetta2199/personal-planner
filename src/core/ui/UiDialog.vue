<script setup lang="ts">
/** Finestra modale accessibile basata su <dialog> (focus trap ed Esc nativi). */
import { onBeforeUnmount, ref, watch } from 'vue'
import UiButton from './UiButton.vue'

const props = defineProps<{ open: boolean; title: string; width?: number }>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLDialogElement | null>(null)

watch(
  () => [props.open, el.value] as const,
  ([open, d]) => {
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  },
  { immediate: true },
)
onBeforeUnmount(() => el.value?.open && el.value.close())

/**
 * Esc con un pannello aperto dentro la finestra (calendario, colori, elenco):
 * chiude solo il pannello. Il controllo avviene in fase di cattura, prima che il pannello sparisca.
 */
let keepOpen = false
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  keepOpen = !!el.value?.querySelector('[data-reka-popper-content-wrapper], .cb__pop, .ms__pop, .ds__pop')
}
function onCancel() {
  if (keepOpen) {
    keepOpen = false
    return
  }
  emit('close')
}

/** Chiusura cliccando sullo sfondo. */
function onClick(e: MouseEvent) {
  if (e.target === el.value) emit('close')
}
</script>

<template>
  <dialog ref="el" class="dlg" :style="{ '--dlg-w': `${width ?? 520}px` }" :aria-label="title" @cancel.prevent="onCancel" @keydown.capture="onKeydownCapture" @click="onClick">
    <div class="dlg__box">
      <header class="dlg__head">
        <h2>{{ title }}</h2>
        <UiButton variant="ghost" size="sm" icon="close" aria-label="Chiudi" @click="emit('close')" />
      </header>
      <div class="dlg__body"><slot /></div>
      <footer v-if="$slots.footer" class="dlg__foot"><slot name="footer" /></footer>
    </div>
  </dialog>
</template>

<style scoped>
.dlg {
  border: 0;
  padding: 0;
  border-radius: var(--radius-lg);
  width: min(var(--dlg-w), calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-pop);
}
.dlg::backdrop { background: rgba(19, 24, 17, 0.38); backdrop-filter: blur(2px); }
.dlg__box { display: flex; flex-direction: column; max-height: calc(100dvh - 24px); }
.dlg__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 22px 8px; }
.dlg__head h2 { font-size: 1.25rem; }
.dlg__body { padding: 8px 22px 16px; overflow-y: auto; }
.dlg__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 22px 20px; border-top: 1px solid var(--border); flex-wrap: wrap; }
</style>
