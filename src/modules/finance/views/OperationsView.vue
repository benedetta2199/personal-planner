<script setup lang="ts">
import { computed } from 'vue'
import UiCard from '@/core/ui/UiCard.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import { formatMoney } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import FinanceFilterBar from '../components/FinanceFilterBar.vue'
import OperationsTable from '../components/OperationsTable.vue'
import { flowTypeOf, type Operation } from '../domain'
import { FLOW_META } from '../presentation'

const store = useFinanceStore()
const s = computed(() => store.flowSummary!)
const cur = computed(() => store.baseCurrency)

function csvCell(v: string | number) {
  const t = String(v)
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

function exportCsv() {
  const header = ['Data', 'Tipologia', 'Conto', 'Conto destinazione', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta', 'Foglio', 'Riga']
  const lines = store.filteredOperations.map((o: Operation) =>
    [
      o.date,
      FLOW_META[flowTypeOf(o)].short,
      o.account,
      o.kind === 'transfer' ? o.toAccount : '',
      o.category,
      o.subcategory,
      o.description,
      (o.amount / 100).toFixed(2).replace('.', ','),
      o.currency,
      o.source.sheet,
      o.source.row,
    ]
      .map(csvCell)
      .join(';'),
  )
  const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `movimenti-${store.today}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="stack">
    <FinanceFilterBar show-search />
    <UiCard flush :title="`${store.filteredOperations.length} movimenti`" :subtitle="`Entrate ${formatMoney(s.income, cur)} · Uscite ${formatMoney(s.expenses, cur)} · Investito ${formatMoney(s.invested, cur)}`">
      <template #actions>
        <UiButton size="sm" icon="upload" :disabled="!store.filteredOperations.length" @click="exportCsv">Esporta CSV</UiButton>
      </template>
      <OperationsTable v-if="store.filteredOperations.length" :operations="store.filteredOperations" />
      <UiEmpty v-else title="Nessun movimento" icon="search">Nessun movimento corrisponde ai filtri. Prova ad ampliare il periodo o a reimpostare i filtri.</UiEmpty>
    </UiCard>
  </div>
</template>
