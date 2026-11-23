<script setup lang="ts">
/** Intestazione di pagina di un modulo: titolo, sottotitolo e azioni a destra. */
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <header class="ph">
    <div class="ph__title">
      <h1>{{ title }}</h1>
      <p v-if="subtitle || $slots.subtitle" class="muted small"><slot name="subtitle">{{ subtitle }}</slot></p>
    </div>
    <div v-if="$slots.default" class="row"><slot /></div>
  </header>
</template>

<style scoped>
.ph { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.ph__title { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
@media (max-width: 600px) { .ph { align-items: flex-start; } }
</style>
