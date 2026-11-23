<script setup lang="ts">
/** Barra di sotto-sezioni (pillole) collegata al router. */
defineProps<{ tabs: { name: string; label: string }[]; label: string }>()
</script>

<template>
  <nav class="sn" :aria-label="label">
    <RouterLink v-for="t in tabs" :key="t.name" :to="{ name: t.name }" class="sn__tab" active-class="sn__tab--on">{{ t.label }}</RouterLink>
  </nav>
</template>

<style scoped>
.sn {
  display: inline-flex; gap: 4px; padding: 5px; background: var(--surface); border-radius: 999px; align-self: flex-start;
  max-width: 100%; overflow-x: auto; scrollbar-width: none;
}
.sn__tab { padding: 8px 18px; border-radius: 999px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; }
.sn__tab:hover { text-decoration: none; color: var(--text-primary); }
.sn__tab--on { background: var(--ink); color: var(--brand); }
@media (max-width: 600px) { .sn__tab { padding: 8px 13px; } }
</style>
