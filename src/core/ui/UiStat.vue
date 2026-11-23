<script setup lang="ts">
/** Tile KPI: etichetta, valore principale, nota secondaria e marcatore colore opzionale. */
defineProps<{
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'pos' | 'neg'
  /** Variabile CSS del colore della serie a cui il KPI corrisponde. */
  swatch?: string
  emphasis?: boolean
}>()
</script>

<template>
  <div class="stat" :class="{ 'stat--emphasis': emphasis, 'stat--loss': emphasis && tone === 'neg' }">
    <div class="stat__label">
      <span v-if="swatch" class="stat__swatch" :style="{ background: `var(${swatch})` }" aria-hidden="true" />
      {{ label }}
    </div>
    <div class="stat__value num" :class="tone && tone !== 'default' ? tone : ''" :title="value">{{ value }}</div>
    <div v-if="hint || $slots.hint" class="stat__hint"><slot name="hint">{{ hint }}</slot></div>
  </div>
</template>

<style scoped>
.stat {
  background: var(--surface);
  border: 0;
  border-radius: var(--radius-lg);
  padding: 20px 22px;
  box-shadow: var(--shadow);
  min-width: 0;
  min-height: 112px;
}
.stat--emphasis { background: var(--brand); color: var(--on-brand); }
.stat--emphasis .stat__label, .stat--emphasis .stat__hint { color: var(--on-brand); }
.stat--emphasis .stat__value.pos { color: var(--positive-strong); }
.stat--loss { background: var(--negative-soft); color: #5c1410; }
.stat--loss .stat__label, .stat--loss .stat__hint { color: #5c1410; }
.stat__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-secondary);
  font-weight: 500;
}
.stat__swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.stat__value {
  font-size: clamp(1.2rem, 1.45vw, 1.55rem);
  font-weight: 500;
  letter-spacing: -0.035em;
  margin-top: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat__hint { font-size: 0.8rem; color: var(--text-muted); margin-top: 5px; }
@media (max-width: 480px) {
  .stat { padding: 14px; min-height: 104px; }
  .stat__label { font-size: 0.75rem; }
  .stat__value { font-size: 1.1rem; }
  .stat__hint { font-size: 0.72rem; }
}
</style>
