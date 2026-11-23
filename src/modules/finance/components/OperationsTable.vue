<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatDate, formatMoney } from '@/core/utils/format'
import { flowTypeOf, type Operation } from '../domain'
import { FLOW_META } from '../presentation'

const props = withDefaults(defineProps<{ operations: Operation[]; pageSize?: number }>(), { pageSize: 50 })

type SortKey = 'date' | 'amount'
const sortKey = ref<SortKey>('date')
const sortDir = ref<1 | -1>(-1)
const page = ref(0)
const expanded = ref<string | null>(null)
watch(() => props.operations, () => (page.value = 0))

const sorted = computed(() => {
  const dir = sortDir.value
  const ops = [...props.operations]
  if (sortKey.value === 'date') ops.sort((a, b) => dir * (a.date.localeCompare(b.date) || a.source.row - b.source.row))
  else ops.sort((a, b) => dir * (a.amount - b.amount))
  return ops
})
const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / props.pageSize)))
const rows = computed(() => sorted.value.slice(page.value * props.pageSize, (page.value + 1) * props.pageSize))

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1
  else {
    sortKey.value = key
    sortDir.value = -1
  }
}
const ariaSort = (key: SortKey) => (sortKey.value === key ? (sortDir.value === 1 ? 'ascending' : 'descending') : 'none')

function signedAmount(op: Operation): { text: string; cls: string } {
  if (op.kind === 'income') return { text: formatMoney(op.amount, op.currency, { sign: true }), cls: 'pos' }
  if (op.kind === 'expense') return { text: formatMoney(-op.amount, op.currency), cls: '' }
  return { text: formatMoney(op.amount, op.currency), cls: 'muted' }
}

function details(op: Operation): [string, string][] {
  const d: [string, string][] = [['Origine', op.source.sheet === 'Manuale' ? 'Inserita dall’app' : `${op.source.sheet}, riga ${op.source.row}`]]
  if (op.kind === 'income') {
    if (op.incomeSource) d.push(['Fonte', op.incomeSource])
    if (op.recurrence) d.push(['Ricorrenza', op.recurrence])
  }
  if (op.kind === 'transfer' && op.toCurrency !== op.currency) d.push(['Accreditato', formatMoney(op.toAmount, op.toCurrency)])
  for (const [k, v] of Object.entries(op.extra)) d.push([k, v])
  return d
}
</script>

<template>
  <div class="ot">
    <div class="ot__scroll">
      <table>
        <thead>
          <tr>
            <th :aria-sort="ariaSort('date')">
              <button type="button" class="ot__sort" @click="sortBy('date')">Data <span aria-hidden="true">{{ sortKey === 'date' ? (sortDir === 1 ? '↑' : '↓') : '' }}</span></button>
            </th>
            <th>Tipologia</th>
            <th>Descrizione</th>
            <th>Categoria</th>
            <th>Conto</th>
            <th class="r" :aria-sort="ariaSort('amount')">
              <button type="button" class="ot__sort" @click="sortBy('amount')">Importo <span aria-hidden="true">{{ sortKey === 'amount' ? (sortDir === 1 ? '↑' : '↓') : '' }}</span></button>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="op in rows" :key="op.id">
            <tr class="ot__row" :class="{ 'ot__row--open': expanded === op.id }" tabindex="0" :aria-expanded="expanded === op.id" @click="expanded = expanded === op.id ? null : op.id" @keydown.enter.prevent="expanded = expanded === op.id ? null : op.id">
              <td class="ot__date num" data-label="Data">{{ formatDate(op.date) }}</td>
              <td data-label="Tipologia"><UiBadge :swatch="FLOW_META[flowTypeOf(op)].swatch">{{ FLOW_META[flowTypeOf(op)].short }}</UiBadge></td>
              <td class="ot__desc" data-label="Descrizione">{{ op.description || '—' }}</td>
              <td data-label="Categoria">
                <span>{{ op.category || '—' }}</span><span v-if="op.subcategory" class="muted"> › {{ op.subcategory }}</span>
              </td>
              <td data-label="Conto">
                {{ op.account }}<template v-if="op.kind === 'transfer'"> <UiIcon name="arrowRight" :size="13" class="ot__arrow" /> {{ op.toAccount }}</template>
              </td>
              <td class="r num ot__amount" :class="signedAmount(op).cls" data-label="Importo">{{ signedAmount(op).text }}</td>
            </tr>
            <tr v-if="expanded === op.id" class="ot__details">
              <td colspan="6">
                <dl>
                  <template v-for="[k, v] in details(op)" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>{{ v }}</dd>
                  </template>
                </dl>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-if="pageCount > 1" class="ot__pager">
      <span class="muted small">{{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, sorted.length) }} di {{ sorted.length }}</span>
      <div class="row">
        <UiButton size="sm" :disabled="page === 0" @click="page--">Precedenti</UiButton>
        <UiButton size="sm" :disabled="page >= pageCount - 1" @click="page++">Successivi</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ot__scroll { overflow-x: auto; }
th, td { padding: 9px 12px; border-bottom: 1px solid var(--border); text-align: left; font-size: 0.88rem; vertical-align: middle; }
th { color: var(--text-muted); font-weight: 500; font-size: 0.8rem; white-space: nowrap; background: var(--surface); }
.r { text-align: right; }
.ot__sort { background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.ot__row { cursor: pointer; }
.ot__row:hover, .ot__row--open { background: var(--surface-2); }
.ot__date { white-space: nowrap; color: var(--text-secondary); }
.ot__desc { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ot__amount { white-space: nowrap; font-weight: 600; }
.ot__arrow { vertical-align: -2px; color: var(--text-muted); }
.ot__details td { background: var(--surface-2); padding-top: 0; }
.ot__details dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; font-size: 0.85rem; }
.ot__details dt { color: var(--text-muted); }
.ot__details dd { margin: 0; }
.ot__pager { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); flex-wrap: wrap; }

/* Mobile: righe come schede */
@media (max-width: 720px) {
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  .ot__row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'desc amount' 'meta type' 'cat cat';
    gap: 2px 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .ot__row td { border: 0; padding: 0; }
  .ot__row td:nth-child(1) { grid-area: meta; font-size: 0.8rem; }
  .ot__row td:nth-child(2) { grid-area: type; text-align: right; }
  .ot__row td:nth-child(3) { grid-area: desc; font-weight: 500; max-width: none; }
  .ot__row td:nth-child(4) { grid-area: cat; font-size: 0.8rem; }
  .ot__row td:nth-child(5) { display: none; }
  .ot__row td:nth-child(6) { grid-area: amount; }
  .ot__details td { padding: 8px 14px 12px; }
}
</style>
