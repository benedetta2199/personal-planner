<script setup lang="ts">
/** Dialog unico per le richieste di confirmDialog(); va montato una volta in App.vue. */
import { computed, ref, watch } from 'vue'
import UiConfirmDialog from './UiConfirmDialog.vue'
import { pendingConfirm, settleConfirm, type ConfirmOptions } from './confirm'

// Si tiene l'ultimo contenuto anche dopo la chiusura, così il testo non sparisce durante l'animazione.
const last = ref<ConfirmOptions>({ title: '' })
watch(pendingConfirm, (p) => p && (last.value = p))
const paragraphs = computed(() => (last.value.message ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean))
</script>

<template>
  <UiConfirmDialog
    :open="!!pendingConfirm"
    :title="last.title"
    :confirm-label="last.confirmLabel"
    :cancel-label="last.cancelLabel"
    :danger="last.danger"
    @confirm="settleConfirm(true)"
    @cancel="settleConfirm(false)"
  >
    <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
  </UiConfirmDialog>
</template>
