<script setup lang="ts">
/** Finestra di conferma (al posto di window.confirm), con azione distruttiva opzionale. */
import UiDialog from './UiDialog.vue'
import UiButton from './UiButton.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  { confirmLabel: 'Conferma', cancelLabel: 'Annulla' },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <UiDialog :open="open" :title="title" :width="420" @close="emit('cancel')">
    <div class="cf"><slot /></div>
    <template #footer>
      <UiButton :disabled="busy" @click="emit('cancel')">{{ cancelLabel }}</UiButton>
      <UiButton variant="primary" :class="{ cf__danger: danger }" :icon="danger ? 'trash' : undefined" :disabled="busy" @click="emit('confirm')">{{ confirmLabel }}</UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.cf { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; }
.cf :deep(p) { margin: 0 0 8px; white-space: pre-line; }
.cf :deep(p:last-child) { margin-bottom: 0; }
.cf__danger { background: var(--negative); border-color: var(--negative); color: #fff; }
.cf__danger:hover:not(:disabled) { background: var(--negative); filter: brightness(0.92); }
</style>
