<script setup lang="ts">
/** Riga movimento: icona della categoria, sotto la categoria e (per le uscite) la tipologia. */
import { computed } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatMoney } from '@/core/utils/format'
import type { ExpenseType, Operation } from '../domain'
import { useLedgerStore } from '../store/ledgerStore'
import { categoryColor, plainName, tint } from '../presentation'
import { categoryIcon } from '../categoryIcons'
import CategoryIcon from './CategoryIcon.vue'

const props = defineProps<{ op: Operation }>()
defineEmits<{ open: [op: Operation] }>()
const ledger = useLedgerStore()

const TYPE_LABEL: Record<ExpenseType, string> = { necessary: 'Necessaria', additional: 'Desiderio', investment: 'Investimento' }

const kind = computed(() => (props.op.kind === 'income' ? 'income' : 'expense'))
const catColor = computed(() => categoryColor(ledger.state.config, props.op.category, kind.value))
const icon = computed(() => categoryIcon(ledger.state.config, props.op.category, kind.value))
const expenseType = computed(() => (props.op.kind === 'expense' ? props.op.expenseType : null))
const amount = computed(() => {
  const o = props.op
  if (o.kind === 'income') return { text: `+${formatMoney(o.amount, o.currency)}`, cls: 'pos' }
  if (o.kind === 'expense') return { text: `−${formatMoney(o.amount, o.currency)}`, cls: 'neg' }
  return { text: formatMoney(o.amount, o.currency), cls: 'muted' }
})
</script>

<template>
  <button type="button" class="tx" :style="op.kind === 'transfer' ? undefined : { '--cat': catColor }" @click="$emit('open', op)">
    <span
      class="tx__icon"
      :class="{ 'tx__icon--tr': op.kind === 'transfer' }"
      :style="op.kind === 'transfer' ? undefined : { background: tint(catColor, 0.16), color: catColor }"
      aria-hidden="true"
    >
      <UiIcon v-if="op.kind === 'transfer'" name="repeat" :size="18" />
      <CategoryIcon v-else :emoji="icon" :size="20" />
    </span>
    <span class="tx__main">
      <span class="tx__title">{{ op.description || op.subcategory || op.category || 'Movimento' }}</span>
      <span class="tx__meta">
        <template v-if="op.kind === 'transfer'">{{ op.account }} → {{ op.toAccount }}</template>
        <template v-else>
          <span class="tx__cat">{{ plainName(op.category) || 'Senza categoria' }}</span>
          <span v-if="expenseType" class="tx__type" :class="`tx__type--${expenseType}`">{{ TYPE_LABEL[expenseType] }}</span>
        </template>
      </span>
    </span>
    <span class="tx__amt num" :class="amount.cls">{{ amount.text }}</span>
  </button>
</template>

<style scoped>
.tx {
  display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 12px;
  width: 100%; padding: 9px 8px; border: 0; background: none; text-align: left; cursor: pointer; border-radius: 14px;
}
.tx:hover { background: var(--surface-2); }
.tx__icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; color: var(--text-secondary); }
.tx__icon--tr { border: 1px dashed var(--border-strong); background: var(--surface); }
.tx__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tx__title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tx__meta { display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--text-muted); min-width: 0; overflow: hidden; white-space: nowrap; }
.tx__cat { overflow: hidden; text-overflow: ellipsis; min-width: 0; color: var(--text-secondary); }
.tx__type { flex-shrink: 0; padding: 0 7px; border-radius: 999px; font-size: 0.7rem; line-height: 1.6; }
.tx__type--necessary { background: var(--negative-soft); color: var(--flow-necessary); }
.tx__type--additional { background: var(--warning-soft); color: #a35a12; }
.tx__type--investment { background: color-mix(in srgb, var(--flow-investment) 12%, var(--surface)); color: var(--flow-investment); }
.tx__amt { font-weight: 600; white-space: nowrap; }
</style>
