<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiCard from '@/core/ui/UiCard.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiButton from '@/core/ui/UiButton.vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { useFinanceStore } from '../store/financeStore'
import FinanceFilterBar from '../components/FinanceFilterBar.vue'
import CategoryBreakdown from '../components/CategoryBreakdown.vue'
import { NO_SUBCATEGORY, computeCategoryBreakdown, subKey, type FlowType } from '../domain'
import { FLOW_META } from '../presentation'

const store = useFinanceStore()
const router = useRouter()
const cur = computed(() => store.baseCurrency)

type Mode = 'expenses' | 'necessary' | 'additional' | 'income' | 'investment'
const mode = ref<Mode>('expenses')
const TYPES: Record<Mode, FlowType[]> = {
  expenses: ['necessary', 'additional'],
  necessary: ['necessary'],
  additional: ['additional'],
  income: ['income'],
  investment: ['investment'],
}
const open = ref(new Set<string>())

const tree = computed(() => computeCategoryBreakdown(store.dataset!, store.filteredOperations, TYPES[mode.value]))
const total = computed(() => tree.value.reduce((s, c) => s + c.total, 0))
const monthCount = computed(() => Math.max(1, store.months.length))

function toggle(name: string) {
  const s = new Set(open.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  open.value = s
}

function filterBy(category: string, sub?: string) {
  store.filters.categories = [category]
  store.filters.subcategories = sub && sub !== NO_SUBCATEGORY ? [subKey(category, sub)] : []
  router.push({ name: 'finance-operations' })
}
</script>

<template>
  <div class="stack">
    <FinanceFilterBar />
    <div class="grid grid-2">
      <UiCard flush title="Categorie e sotto-categorie" :subtitle="`Totale ${formatMoney(total, cur)} · media mensile ${formatMoney(Math.round(total / monthCount), cur)}`">
        <template #actions>
          <UiSegmented
            v-model="mode"
            label="Tipologia"
            :options="[
              { value: 'expenses', label: 'Spese' },
              { value: 'necessary', label: 'Necessarie' },
              { value: 'additional', label: 'Aggiuntive' },
              { value: 'income', label: 'Entrate' },
              { value: 'investment', label: 'Investimenti' },
            ]"
          />
        </template>
        <UiEmpty v-if="!tree.length" title="Nessun dato" icon="tag">Nessun movimento di questo tipo nel periodo selezionato.</UiEmpty>
        <table v-else class="ct">
          <thead>
            <tr>
              <th>Categoria</th>
              <th class="r">Totale</th>
              <th class="r hide-sm">Quota</th>
              <th class="r hide-sm">Op.</th>
              <th class="r"><span class="sr-only">Azioni</span></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="c in tree" :key="c.name">
              <tr class="ct__cat">
                <td>
                  <button type="button" class="ct__toggle" :aria-expanded="open.has(c.name)" @click="toggle(c.name)">
                    <UiIcon name="chevron" :size="14" :class="{ 'ct__chev--closed': !open.has(c.name) }" />
                    {{ c.name }}
                  </button>
                  <div class="ct__share" aria-hidden="true">
                    <span :style="{ width: `${(c.total / (total || 1)) * 100}%`, background: `var(${mode === 'expenses' ? '--text-muted' : FLOW_META[TYPES[mode][0]].swatch})` }" />
                  </div>
                </td>
                <td class="r num">{{ formatMoney(c.total, cur) }}</td>
                <td class="r num hide-sm">{{ formatPercent(c.total / (total || 1)) }}</td>
                <td class="r num hide-sm">{{ c.count }}</td>
                <td class="r"><UiButton size="sm" variant="ghost" icon="list" :aria-label="`Movimenti di ${c.name}`" @click="filterBy(c.name)" /></td>
              </tr>
              <template v-if="open.has(c.name)">
                <tr v-for="sub in c.subcategories" :key="sub.name" class="ct__sub">
                  <td>{{ sub.name }}</td>
                  <td class="r num">{{ formatMoney(sub.total, cur) }}</td>
                  <td class="r num hide-sm">{{ formatPercent(sub.total / (c.total || 1)) }}</td>
                  <td class="r num hide-sm">{{ sub.count }}</td>
                  <td class="r"><UiButton size="sm" variant="ghost" icon="list" :aria-label="`Movimenti di ${c.name} › ${sub.name}`" @click="filterBy(c.name, sub.name)" /></td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </UiCard>
      <UiCard title="Confronto visivo" subtitle="Tocca una barra per scendere nelle sotto-categorie">
        <CategoryBreakdown :dataset="store.dataset!" :operations="store.filteredOperations" :max-bars="12" />
      </UiCard>
    </div>
    <p class="muted small">Le categorie si personalizzano direttamente nel Google Sheet: ogni nuova coppia categoria / sotto-categoria compare qui alla sincronizzazione.</p>
  </div>
</template>

<style scoped>
.ct th, .ct td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 0.88rem; text-align: left; }
.ct th { color: var(--text-muted); font-weight: 500; font-size: 0.8rem; }
.ct .r { text-align: right; white-space: nowrap; }
.ct th:first-child, .ct td:first-child { padding-left: var(--space-5); }
.ct__toggle { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0; cursor: pointer; font-weight: 600; text-align: left; }
.ct__chev--closed { transform: rotate(-90deg); }
.ct__share { height: 4px; border-radius: 2px; background: var(--surface-2); margin: 6px 0 0 20px; max-width: 220px; }
.ct__share span { display: block; height: 100%; border-radius: 2px; }
.ct__sub td { background: var(--surface-2); color: var(--text-secondary); }
.ct__sub td:first-child { padding-left: calc(var(--space-5) + 20px); }
@media (max-width: 600px) {
  .hide-sm { display: none; }
  .ct th:first-child, .ct td:first-child { padding-left: var(--space-4); }
}
</style>
