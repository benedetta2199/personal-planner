<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { NO_SUBCATEGORY, OTHER_COLOR, computeCategoryBreakdown, type FinanceDataset, type FlowType, type Operation } from '../domain'
import { useLedgerStore } from '../store/ledgerStore'
import { categoryColor, shade, subcategoryColor } from '../presentation'
import { categoryIcon } from '../categoryIcons'
import CategoryIcon from './CategoryIcon.vue'
import DonutChart, { type DonutSegment } from './DonutChart.vue'

const props = withDefaults(defineProps<{ dataset: FinanceDataset; operations: Operation[]; size?: number; compact?: boolean }>(), { size: 250 })
const ledger = useLedgerStore()

type Mode = 'expenses' | 'investment' | 'income'
const mode = ref<Mode>('expenses')
const TYPES: Record<Mode, FlowType[]> = { expenses: ['necessary', 'additional'], investment: ['investment'], income: ['income'] }
const TITLES: Record<Mode, string> = { expenses: 'Uscite', investment: 'Investito', income: 'Entrate' }
const focus = ref<string | null>(null)
watch([mode, () => props.operations], () => (focus.value = null))

const MAX = 8
const OTHER_KEY = '__other__'
const cur = computed(() => props.dataset.baseCurrency)
const fmt = (v: number) => formatMoney(v, cur.value)

const breakdown = computed(() => computeCategoryBreakdown(props.dataset, props.operations, TYPES[mode.value]))
const total = computed(() => breakdown.value.reduce((s, c) => s + c.total, 0))

/** Al massimo 8 colori: oltre, le categorie minori confluiscono in «Altre». */
const segments = computed<DonutSegment[]>(() => {
  const kind = mode.value === 'income' ? 'income' : 'expense'
  const list = breakdown.value
  const head = list.length > MAX ? list.slice(0, MAX - 1) : list
  const segs: DonutSegment[] = head.map((c) => {
    const color = categoryColor(ledger.state.config, c.name, kind)
    return {
      key: c.name,
      label: c.name,
      value: c.total,
      color,
      children: c.subcategories.map((s) => ({
        key: s.name,
        label: s.name === NO_SUBCATEGORY ? 'Senza sotto-categoria' : s.name,
        value: s.total,
        color: s.name === NO_SUBCATEGORY ? shade(color, 0.55) : subcategoryColor(ledger.state.config, c.name, s.name, kind),
      })),
    }
  })
  if (list.length > MAX) {
    const rest = list.slice(MAX - 1)
    const value = rest.reduce((s, c) => s + c.total, 0)
    segs.push({
      key: OTHER_KEY,
      label: `Altre (${rest.length})`,
      value,
      color: OTHER_COLOR,
      children: rest.map((c, i) => ({ key: c.name, label: c.name, value: c.total, color: shade(OTHER_COLOR, 0.15 + (i % 4) * 0.17) })),
    })
  }
  return segs
})

const toggle = (key: string) => (focus.value = focus.value === key ? null : key)
</script>

<template>
  <div class="cd" :class="{ 'cd--compact': compact }">
    <UiSegmented
      v-model="mode"
      label="Tipo di ripartizione"
      class="cd__mode"
      :options="[
        { value: 'expenses', label: 'Uscite' },
        { value: 'investment', label: 'Investimenti' },
        { value: 'income', label: 'Entrate' },
      ]"
    />
    <div class="cd__body">
      <DonutChart :segments="segments" :center-title="TITLES[mode]" :format="fmt" :focus="focus" :size="size" @select="toggle" />
      <p v-if="!segments.length" class="muted small cd__empty">Nessun movimento di questo tipo nel periodo.</p>
      <ul v-else class="cd__legend">
        <li v-for="s in segments" :key="s.key">
          <button type="button" class="cd__row" :aria-expanded="focus === s.key" @click="toggle(s.key)">
            <span class="cd__dot" :style="{ background: s.color }" aria-hidden="true" />
            <span class="cd__glyph" aria-hidden="true"><template v-if="s.key === OTHER_KEY">…</template><CategoryIcon v-else :emoji="categoryIcon(ledger.state.config, s.label, mode === 'income' ? 'income' : 'expense')" :size="15" /></span>
            <span class="cd__name">{{ s.label }}</span>
            <span class="cd__val num">{{ fmt(s.value) }}</span>
            <span class="cd__pct num">{{ formatPercent(s.value / (total || 1), 0) }}</span>
          </button>
          <ul v-if="focus === s.key && s.children?.length" class="cd__subs">
            <li v-for="c in s.children" :key="c.key" class="cd__sub">
              <span class="cd__dot cd__dot--sm" :style="{ background: c.color }" aria-hidden="true" />
              <span class="cd__name">{{ c.label }}</span>
              <span class="cd__val num">{{ fmt(c.value) }}</span>
              <span class="cd__pct num">{{ formatPercent(c.value / (s.value || 1), 0) }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cd { display: flex; flex-direction: column; gap: 16px; container-type: inline-size; }
.cd__mode { align-self: flex-start; }
.cd__body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 24px; align-items: center; }
.cd--compact .cd__body { grid-template-columns: minmax(0, 1fr); }
.cd__empty { text-align: center; }
.cd__legend, .cd__subs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cd__legend { gap: 2px; max-height: 330px; overflow-y: auto; }
.cd__row, .cd__sub {
  display: grid;
  grid-template-columns: 10px 22px minmax(0, 1fr) auto 40px;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 12px;
  font-size: 0.9rem;
  text-align: left;
}
.cd__row { background: none; border: 0; cursor: pointer; }
.cd__row:hover, .cd__row[aria-expanded='true'] { background: var(--surface-2); }
.cd__sub { grid-template-columns: 8px minmax(0, 1fr) auto 40px; padding: 4px 10px 4px 50px; font-size: 0.84rem; color: var(--text-secondary); }
.cd__dot { width: 10px; height: 10px; border-radius: 50%; }
.cd__dot--sm { width: 8px; height: 8px; }
.cd__glyph { display: grid; place-items: center; font-size: 0.95rem; color: var(--text-secondary); }
.cd__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd__val { font-weight: 500; }
.cd__pct { color: var(--text-muted); font-size: 0.8rem; text-align: right; }
/* Card stretta: legenda sotto la ciambella, così i nomi restano leggibili. */
@container (max-width: 640px) {
  .cd__body { grid-template-columns: minmax(0, 1fr); }
  .cd__legend { max-height: none; }
}
</style>
