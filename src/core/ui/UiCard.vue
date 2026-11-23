<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string; flush?: boolean }>()
</script>

<template>
  <section class="card" :class="{ 'card--flush': flush }">
    <header v-if="title || $slots.actions" class="card__head">
      <div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="subtitle" class="card__sub">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="card__actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 0;
  border-radius: var(--radius-lg);
  padding: 22px 24px 24px;
  min-width: 0;
}
.card--flush { padding: 0; overflow: hidden; }
.card--flush .card__head { padding: 18px 22px 14px; margin: 0; }
.card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
}
.card__sub { color: var(--text-muted); font-size: 0.86rem; margin-top: 4px; }
.card__actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
@media (max-width: 600px) {
  .card { padding: 16px; }
  .card--flush { padding: 0; }
  .card--flush .card__head { padding: 14px 16px; }
}
</style>
