<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'

const props = defineProps<{ tone?: 'info' | 'warning' | 'critical' | 'good'; title?: string }>()
const icon = computed(() => ({ info: 'info', warning: 'alert', critical: 'error', good: 'check' } as const)[props.tone ?? 'info'])
</script>

<template>
  <div class="alert" :class="`alert--${tone ?? 'info'}`" :role="tone === 'critical' ? 'alert' : 'status'">
    <UiIcon :name="icon" class="alert__icon" />
    <div class="alert__body">
      <strong v-if="title" class="alert__title">{{ title }}</strong>
      <div><slot /></div>
    </div>
    <div v-if="$slots.actions" class="alert__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.alert {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 0.9rem;
}
.alert__icon { margin-top: 2px; }
.alert__body { flex: 1; min-width: 0; }
.alert__title { display: block; margin-bottom: 2px; }
.alert__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; align-self: center; }
.alert--info { background: var(--accent-soft); }
.alert--info .alert__icon { color: var(--accent); }
.alert--warning { background: var(--warning-soft); }
.alert--warning .alert__icon { color: var(--status-warning); }
.alert--critical { background: var(--critical-soft); }
.alert--critical .alert__icon { color: var(--status-critical); }
.alert--good { background: var(--good-soft); }
.alert--good .alert__icon { color: var(--status-good); }
@media (max-width: 600px) { .alert { flex-wrap: wrap; } .alert__actions { width: 100%; } }
</style>
