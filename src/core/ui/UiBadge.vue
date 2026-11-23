<script setup lang="ts">
defineProps<{ tone?: 'neutral' | 'accent' | 'good' | 'warning' | 'critical'; swatch?: string }>()
</script>

<template>
  <span class="badge" :class="`badge--${tone ?? 'neutral'}`">
    <span v-if="swatch" class="badge__dot" :style="{ background: `var(${swatch})` }" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 500;
  white-space: nowrap;
  background: var(--surface-2);
  color: var(--text-secondary);
}
.badge__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.badge--accent { background: var(--accent-soft); color: var(--accent-strong); }
.badge--good { background: var(--good-soft); color: var(--positive); }
.badge--warning { background: var(--warning-soft); color: var(--text-primary); }
.badge--critical { background: var(--critical-soft); color: var(--negative); }
</style>
