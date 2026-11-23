<script setup lang="ts">
/** Schede principali di un modulo (pillole con icona) collegate al router. */
import { useRoute } from 'vue-router'
import UiIcon from './UiIcon.vue'
import type { IconName } from './icons'

defineProps<{ tabs: { name: string; label: string; icon: IconName; badge?: number }[]; label: string }>()
const route = useRoute()
const isOn = (name: string) => route.matched.some((r) => r.name === name)
</script>

<template>
  <nav class="tn" :aria-label="label">
    <RouterLink
      v-for="t in tabs"
      :key="t.name"
      :to="{ name: t.name }"
      class="tn__tab"
      :class="{ 'tn__tab--on': isOn(t.name) }"
      :aria-current="isOn(t.name) ? 'page' : undefined"
      active-class=""
      exact-active-class=""
    >
      <UiIcon :name="t.icon" :size="16" />
      {{ t.label }}
      <span v-if="t.badge" class="tn__badge num">{{ t.badge }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tn { display: flex; gap: 4px; padding: 5px; border-radius: 999px; background: var(--surface); align-self: flex-start; overflow-x: auto; scrollbar-width: none; max-width: 100%; }
.tn__tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 999px;
  color: var(--text-secondary); white-space: nowrap; font-weight: 500; font-size: 0.88rem;
  transition: background 0.15s ease, color 0.15s ease;
}
.tn__tab:hover { color: var(--text-primary); text-decoration: none; }
.tn__tab--on { color: var(--on-brand); background: var(--brand); font-weight: 600; }
.tn__badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--status-critical); color: #fff; font-size: 0.7rem; font-weight: 600; display: inline-grid; place-items: center; }
@media (max-width: 600px) { .tn__tab { padding: 8px 10px; } }
</style>
