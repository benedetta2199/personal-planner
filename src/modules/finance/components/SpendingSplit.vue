<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { FLOW_META } from '../presentation'
import type { FlowSummary } from '../domain'

/** Barra segmentata: dove sono andati i soldi in uscita (consumo vs investimento). */
const props = defineProps<{ summary: FlowSummary; currency: string }>()

const parts = computed(() => {
  const items = [
    { key: 'necessary', value: props.summary.necessary, meta: FLOW_META.necessary },
    { key: 'additional', value: props.summary.additional, meta: FLOW_META.additional },
    { key: 'investment', value: Math.max(0, props.summary.invested), meta: FLOW_META.investment },
  ]
  const total = items.reduce((s, i) => s + i.value, 0)
  return { total, items: items.map((i) => ({ ...i, share: total > 0 ? i.value / total : 0 })) }
})
</script>

<template>
  <div class="split">
    <div v-if="parts.total > 0" class="split__bar" role="img" :aria-label="parts.items.map((i) => `${i.meta.label} ${formatPercent(i.share)}`).join(', ')">
      <div
        v-for="i in parts.items.filter((x) => x.share > 0)"
        :key="i.key"
        class="split__seg"
        :style="{ flexGrow: i.share, background: `var(${i.meta.swatch})` }"
        :title="`${i.meta.label}: ${formatMoney(i.value, currency)}`"
      />
    </div>
    <div v-else class="split__bar split__bar--empty" />
    <ul class="split__legend">
      <li v-for="i in parts.items" :key="i.key">
        <span class="split__dot" :style="{ background: `var(${i.meta.swatch})` }" aria-hidden="true" />
        <span class="split__name">{{ i.meta.label }}</span>
        <span class="split__val num">{{ formatMoney(i.value, currency) }}</span>
        <span class="split__pct num muted">{{ formatPercent(i.share) }}</span>
      </li>
    </ul>
    <p class="muted small split__note">
      Rapporto necessarie / aggiuntive:
      <strong class="num">{{ summary.expenses > 0 ? formatPercent(summary.necessary / summary.expenses, 0) : '—' }}</strong>
      /
      <strong class="num">{{ summary.expenses > 0 ? formatPercent(summary.additional / summary.expenses, 0) : '—' }}</strong>
      delle spese di consumo.
    </p>
  </div>
</template>

<style scoped>
.split__bar { display: flex; gap: 2px; height: 14px; border-radius: 4px; overflow: hidden; }
.split__bar--empty { background: var(--surface-2); }
.split__seg { min-width: 3px; }
.split__legend { list-style: none; padding: 0; margin: var(--space-4) 0 0; display: flex; flex-direction: column; gap: 8px; }
.split__legend li { display: grid; grid-template-columns: 12px 1fr auto 52px; align-items: center; gap: 8px; font-size: 0.9rem; }
.split__dot { width: 10px; height: 10px; border-radius: 3px; }
.split__val { font-weight: 600; }
.split__pct { text-align: right; font-size: 0.85rem; }
.split__note { margin-top: var(--space-4); }
</style>
