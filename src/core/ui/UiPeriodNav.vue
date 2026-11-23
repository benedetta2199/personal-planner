<script setup lang="ts">
/** Navigazione «‹ periodo ›» con ritorno rapido al periodo corrente. */
import UiButton from './UiButton.vue'

defineProps<{ label: string; isCurrent: boolean; currentLabel?: string }>()
const emit = defineEmits<{ prev: []; next: []; current: [] }>()
</script>

<template>
  <div class="pn" role="group" aria-label="Periodo">
    <UiButton variant="ghost" size="sm" icon="chevronLeft" aria-label="Periodo precedente" @click="emit('prev')" />
    <span class="pn__label" aria-live="polite">{{ label }}</span>
    <UiButton variant="ghost" size="sm" icon="chevronRight" aria-label="Periodo successivo" @click="emit('next')" />
    <UiButton v-if="!isCurrent" variant="ghost" size="sm" @click="emit('current')">{{ currentLabel ?? 'Oggi' }}</UiButton>
  </div>
</template>

<style scoped>
.pn { display: inline-flex; align-items: center; gap: 2px; background: var(--surface); border-radius: 999px; padding: 4px; max-width: 100%; }
.pn__label { min-width: 150px; text-align: center; font-weight: 500; font-size: 0.95rem; padding: 0 4px; }
@media (max-width: 480px) { .pn__label { min-width: 0; font-size: 0.88rem; } }
</style>
