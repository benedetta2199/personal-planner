<script setup lang="ts">
import UiIcon from './UiIcon.vue'
import type { IconName } from './icons'
defineProps<{ title: string; icon?: IconName }>()
</script>

<template>
  <div class="empty">
    <UiIcon :name="icon ?? 'info'" :size="28" class="empty__icon" />
    <strong>{{ title }}</strong>
    <p class="muted small"><slot /></p>
    <div v-if="$slots.actions" class="row empty__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  text-align: center;
  padding: var(--space-6) var(--space-4);
}
.empty__icon { color: var(--text-muted); }
.empty p { max-width: 440px; }
.empty__actions { justify-content: center; margin-top: var(--space-2); }
</style>
