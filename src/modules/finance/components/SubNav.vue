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
.sn__tab { padding: 8px 18px; border-radius: 999px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; transition: background 0.15s ease, color 0.15s ease; }
.sn__tab:hover { text-decoration: none; background: var(--brand-soft); color: var(--on-brand); }
.sn__tab--on, .sn__tab--on:hover { background: var(--brand); color: var(--on-brand); font-weight: 600; }
.sn__tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 600px) { .sn__tab { padding: 8px 13px; } }
</style>
