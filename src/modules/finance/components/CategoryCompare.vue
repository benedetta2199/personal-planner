<script setup lang="ts">
/** Confronto categoria per categoria tra due periodi (es. mese vs mese precedente). */
import { computed } from 'vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { computeCategoryBreakdown, type FinanceDataset, type FlowType, type Operation } from '../domain'
import { useLedgerStore } from '../store/ledgerStore'
import { categoryColor } from '../presentation'

const props = withDefaults(
  defineProps<{ dataset: FinanceDataset; current: Operation[]; previous: Operation[]; currentLabel: string; previousLabel: string; types?: FlowType[]; limit?: number }>(),
  { types: () => ['necessary', 'additional'], limit: 10 },
)
const ledger = useLedgerStore()
const cur = computed(() => props.dataset.baseCurrency)

const rows = computed(() => {
  const now = computeCategoryBreakdown(props.dataset, props.current, props.types)
  const before = new Map(computeCategoryBreakdown(props.dataset, props.previous, props.types).map((c) => [c.name, c.total]))
  const names = new Set([...now.map((c) => c.name), ...before.keys()])
  const list = [...names].map((name) => {
    const value = now.find((c) => c.name === name)?.total ?? 0
    const prev = before.get(name) ?? 0
    return { name, value, prev, diff: value - prev, pct: prev ? (value - prev) / prev : null }
  })
  list.sort((a, b) => b.value - a.value || b.prev - a.prev)
  return list.slice(0, props.limit)
})
const max = computed(() => Math.max(1, ...rows.value.flatMap((r) => [r.value, r.prev])))
</script>

<template>
  <div class="cc">
    <p v-if="!rows.length" class="muted small cc__empty">Nessuna spesa nei periodi confrontati.</p>
    <table v-else>
      <caption class="sr-only">Spese per categoria: {{ currentLabel }} rispetto a {{ previousLabel }}</caption>
      <thead>
        <tr>
          <th>Categoria</th>
          <th class="r">{{ currentLabel }}</th>
          <th class="r hide-sm">{{ previousLabel }}</th>
          <th class="r">Variazione</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.name">
          <td>
            <div class="cc__name">{{ r.name }}</div>
            <div class="cc__bars" aria-hidden="true">
              <span class="cc__bar" :style="{ width: `${(r.value / max) * 100}%`, background: categoryColor(ledger.state.config, r.name, 'expense') }" />
              <span class="cc__bar cc__bar--prev" :style="{ width: `${(r.prev / max) * 100}%` }" />
            </div>
          </td>
          <td class="r num">{{ formatMoney(r.value, cur) }}</td>
          <td class="r num muted hide-sm">{{ formatMoney(r.prev, cur) }}</td>
          <td class="r num" :class="r.diff > 0 ? 'neg' : r.diff < 0 ? 'pos' : 'muted'">
            {{ r.diff > 0 ? '▲' : r.diff < 0 ? '▼' : '' }} {{ r.pct === null ? (r.value ? 'nuova' : '—') : formatPercent(Math.abs(r.pct), 0) }}
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted small cc__legend"><span class="cc__swatch" /> barra piena: {{ currentLabel }} · <span class="cc__swatch cc__swatch--prev" /> barra chiara: {{ previousLabel }}</p>
  </div>
</template>

<style scoped>
.cc__empty { padding: 20px 0; text-align: center; }
th, td { padding: 8px 6px; border-bottom: 1px solid var(--border); font-size: 0.88rem; text-align: left; vertical-align: middle; }
th { color: var(--text-muted); font-weight: 400; font-size: 0.78rem; }
.r { text-align: right; white-space: nowrap; }
.cc__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
.cc__bars { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; max-width: 220px; }
.cc__bar { display: block; height: 6px; border-radius: 999px; min-width: 2px; }
.cc__bar--prev { background: var(--border-strong); height: 4px; }
.cc__legend { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cc__swatch { display: inline-block; width: 16px; height: 6px; border-radius: 999px; background: var(--series-2); }
.cc__swatch--prev { background: var(--border-strong); height: 4px; }
@media (max-width: 600px) { .hide-sm { display: none; } }
</style>
