<script setup lang="ts">
import UiIcon from './UiIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'brand'
    size?: 'sm' | 'md'
    icon?: IconName
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)
</script>

<template>
  <button :type="type" class="btn" :class="[`btn--${variant}`, `btn--${size}`]" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <UiIcon v-if="icon" :name="icon" :size="size === 'sm' ? 15 : 17" :class="{ spin: loading && icon === 'refresh' }" />
    <span v-if="$slots.default"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.btn--md { height: 40px; padding: 0 18px; }
.btn--sm { height: 32px; padding: 0 12px; font-size: 0.85rem; }
.btn--sm:not(:has(span)), .btn--md:not(:has(span)) { padding: 0; aspect-ratio: 1; }
.btn--primary { background: var(--ink); color: var(--brand); }
.btn--primary:hover:not(:disabled) { background: var(--ink-hover); }
.btn--brand { background: var(--brand); color: var(--on-brand); font-weight: 600; }
.btn--brand:hover:not(:disabled) { background: var(--brand-strong); }
.btn--secondary { background: var(--surface); border-color: var(--border-strong); }
.btn--secondary:hover:not(:disabled) { background: var(--surface-2); }
.btn--ghost { background: transparent; color: var(--text-secondary); }
.btn--ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--text-primary); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
