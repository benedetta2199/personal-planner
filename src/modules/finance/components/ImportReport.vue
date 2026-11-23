<script setup lang="ts">
import { computed, ref } from 'vue'
import UiBadge from '@/core/ui/UiBadge.vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import type { ImportIssue, SheetStats } from '../domain'

const props = defineProps<{ issues: ImportIssue[]; stats: SheetStats[] }>()
const filter = ref<'all' | 'error' | 'warning'>('all')
const shown = computed(() => (filter.value === 'all' ? props.issues : props.issues.filter((i) => i.severity === filter.value)))
const limit = ref(100)
</script>

<template>
  <div class="ir">
    <div class="ir__scroll">
      <table class="ir__stats">
        <thead>
          <tr>
            <th>Foglio</th>
            <th class="r">Righe lette</th>
            <th class="r">Importate</th>
            <th class="r">Scartate</th>
            <th class="r">Duplicati</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in stats" :key="s.sheet">
            <td>
              {{ s.sheet }}
              <UiBadge v-if="!s.present" :tone="['Conti', 'Valute'].includes(s.sheet) ? 'neutral' : 'warning'">{{ ['Conti', 'Valute'].includes(s.sheet) ? 'facoltativo, assente' : 'assente' }}</UiBadge>
            </td>
            <td class="r num">{{ s.rowsRead }}</td>
            <td class="r num">{{ s.imported }}</td>
            <td class="r num" :class="{ neg: s.skipped > 0 }">{{ s.skipped }}</td>
            <td class="r num">{{ s.duplicates }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="ir__head">
      <h3>Segnalazioni</h3>
      <UiSegmented
        v-model="filter"
        label="Filtra segnalazioni"
        :options="[
          { value: 'all', label: `Tutte (${issues.length})` },
          { value: 'error', label: `Errori (${issues.filter((i) => i.severity === 'error').length})` },
          { value: 'warning', label: `Avvisi (${issues.filter((i) => i.severity === 'warning').length})` },
        ]"
      />
    </div>
    <p v-if="!shown.length" class="muted small">Nessuna segnalazione: tutti i dati sono stati importati correttamente.</p>
    <ul v-else class="ir__list">
      <li v-for="(i, idx) in shown.slice(0, limit)" :key="idx" class="ir__item">
        <UiBadge :tone="i.severity === 'error' ? 'critical' : 'warning'">{{ i.severity === 'error' ? 'Errore' : 'Avviso' }}</UiBadge>
        <span class="ir__where muted small">{{ i.sheet }}<template v-if="i.row"> · riga {{ i.row }}</template><template v-if="i.column"> · {{ i.column }}</template></span>
        <span class="ir__msg">{{ i.message }}</span>
      </li>
    </ul>
    <button v-if="shown.length > limit" type="button" class="ir__more" @click="limit += 100">Mostra altre {{ Math.min(100, shown.length - limit) }}</button>
  </div>
</template>

<style scoped>
.ir__scroll { overflow-x: auto; }
th, td { padding: 7px 10px; border-bottom: 1px solid var(--border); font-size: 0.88rem; text-align: left; white-space: nowrap; }
th { color: var(--text-muted); font-weight: 500; font-size: 0.8rem; }
.r { text-align: right; }
.ir__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin: var(--space-5) 0 var(--space-3); flex-wrap: wrap; }
.ir__list { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow-y: auto; }
.ir__item { display: grid; grid-template-columns: auto 170px 1fr; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
.ir__more { margin-top: var(--space-2); background: none; border: 0; color: var(--accent); cursor: pointer; }
@media (max-width: 640px) {
  .ir__item { grid-template-columns: auto 1fr; }
  .ir__msg { grid-column: 1 / -1; }
}
</style>
