<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiSegmented from '@/core/ui/UiSegmented.vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import { formatMoney, todayIso } from '@/core/utils/format'
import { daysInMonth, toBase, type FinanceDataset, type Operation } from '../domain'
import TxRow from './TxRow.vue'
import MonthSwitcher from './MonthSwitcher.vue'

const props = defineProps<{ dataset: FinanceDataset; operations: Operation[] }>()
/** Mese mostrato: condiviso con la pagina, così si può cambiare anche da qui. */
const month = defineModel<string>('month', { required: true })
const emit = defineEmits<{ open: [op: Operation]; add: [date: string] }>()

const view = ref<'list' | 'calendar'>('calendar')
const kind = ref<'all' | 'expense' | 'income' | 'transfer'>('all')
/** Giorno scelto nel calendario: condiviso con la pagina, così il «+» crea la voce in quella data. */
const selectedDay = defineModel<string | null>('day', { default: null })
watch(month, () => (selectedDay.value = null))
watch(view, (v) => v === 'list' && (selectedDay.value = null))

const today = todayIso()
const cur = computed(() => props.dataset.baseCurrency)
const visible = computed(() => (kind.value === 'all' ? props.operations : props.operations.filter((o) => o.kind === kind.value)))

const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (iso === today) return 'Oggi'
  const s = dayFmt.format(new Date(Date.UTC(y, m - 1, d)))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const base = (op: Operation) => toBase(props.dataset, op.amount, op.currency) ?? 0
/** Effetto sul saldo: + entrate, − uscite, 0 trasferimenti. */
const signed = (op: Operation) => (op.kind === 'income' ? base(op) : op.kind === 'expense' ? -base(op) : 0)
const netText = (v: number) => (v > 0 ? `+${formatMoney(v, cur.value)}` : v < 0 ? `−${formatMoney(-v, cur.value)}` : '')

const groups = computed(() => {
  const map = new Map<string, Operation[]>()
  for (const op of [...visible.value].reverse()) {
    const list = map.get(op.date) ?? []
    list.push(op)
    map.set(op.date, list)
  }
  return [...map.entries()].map(([date, ops]) => ({ date, ops, net: ops.reduce((s, o) => s + signed(o), 0) }))
})

// ---- Calendario ----------------------------------------------------------
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
interface Cell { date: string; day: number; out: number; inc: number; count: number }
const cells = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const n = daysInMonth(month.value)
  const byDay = new Map<string, { out: number; inc: number; count: number }>()
  for (const op of visible.value) {
    const d = byDay.get(op.date) ?? { out: 0, inc: 0, count: 0 }
    if (op.kind === 'expense') d.out += base(op)
    if (op.kind === 'income') d.inc += base(op)
    d.count++
    byDay.set(op.date, d)
  }
  const out: (Cell | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= n; d++) {
    const date = `${month.value}-${String(d).padStart(2, '0')}`
    const v = byDay.get(date) ?? { out: 0, inc: 0, count: 0 }
    out.push({ date, day: d, ...v })
  }
  while (out.length % 7) out.push(null)
  return out
})
/** Saldo del mese per i movimenti visibili (entrate − uscite). */
const monthNet = computed(() => visible.value.reduce((s, o) => s + signed(o), 0))
const selectedOps = computed(() => (selectedDay.value ? visible.value.filter((o) => o.date === selectedDay.value).reverse() : []))
const selectedNet = computed(() => selectedOps.value.reduce((s, o) => s + signed(o), 0))
/** Importo nelle celle: sempre con due decimali e la virgola (es. 1.250,00 · 12,50). */
const compact = (cents: number) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(cents / 100)
</script>

<template>
  <div class="tp">
    <div class="tp__bar">
      <div class="tp__switch" role="radiogroup" aria-label="Visualizzazione">
        <button type="button" role="radio" :aria-checked="view === 'calendar'" :class="{ on: view === 'calendar' }" title="Calendario" @click="view = 'calendar'">
          <UiIcon name="calendar" :size="17" /><span>Calendario</span>
        </button>
        <button type="button" role="radio" :aria-checked="view === 'list'" :class="{ on: view === 'list' }" title="Elenco" @click="view = 'list'">
          <UiIcon name="list" :size="17" /><span>Elenco</span>
        </button>
      </div>
      <UiSegmented
        v-model="kind"
        label="Tipo di movimento"
        class="tp__kinds"
        :options="[
          { value: 'all', label: 'Tutti' },
          { value: 'expense', label: 'Uscite' },
          { value: 'income', label: 'Entrate' },
          { value: 'transfer', label: 'Trasferimenti' },
        ]"
      />
    </div>
    <div class="tp__month">
      <MonthSwitcher v-model="month" class="tp__ms" />
      <span v-if="monthNet" class="tp__monthnet num" :class="monthNet > 0 ? 'pos' : 'neg'">{{ netText(monthNet) }}</span>
    </div>

    <!-- Elenco ---------------------------------------------------------->
    <div v-if="view === 'list'" class="tp__list">
      <p v-if="!groups.length" class="muted small tp__empty">Nessun movimento in questo mese.</p>
      <section v-for="g in groups" :key="g.date" class="tp__day">
        <header class="tp__dayhead">
          <span>{{ dayLabel(g.date) }}</span>
          <span class="num" :class="g.net > 0 ? 'pos' : 'neg'">{{ netText(g.net) }}</span>
        </header>
        <ul>
          <li v-for="op in g.ops" :key="op.id"><TxRow :op="op" @open="emit('open', $event)" /></li>
        </ul>
      </section>
    </div>

    <!-- Calendario ------------------------------------------------------>
    <div v-else class="tp__cal">
      <div class="cal" role="grid" aria-label="Calendario del mese">
        <div v-for="w in WEEKDAYS" :key="w" class="cal__wd" role="columnheader">{{ w }}</div>
        <template v-for="(c, i) in cells" :key="c ? c.date : `e${i}`">
          <div v-if="!c" class="cal__cell cal__cell--empty" aria-hidden="true" />
          <button
            v-else
            type="button"
            role="gridcell"
            class="cal__cell"
            :class="{ 'cal__cell--today': c.date === today, 'cal__cell--on': c.date === selectedDay }"
            :aria-label="`${dayLabel(c.date)}: ${c.count} movimenti${c.inc ? ', entrate ' + formatMoney(c.inc, cur) : ''}${c.out ? ', uscite ' + formatMoney(c.out, cur) : ''}`"
            :aria-selected="c.date === selectedDay"
            @click="selectedDay = selectedDay === c.date ? null : c.date"
            @dblclick="emit('add', c.date)"
          >
            <span class="cal__num">{{ c.day }}</span>
            <span v-if="c.inc" class="cal__in num">+{{ compact(c.inc) }}</span>
            <span v-if="c.out" class="cal__out num">−{{ compact(c.out) }}</span>
            <span v-if="c.count && !c.out && !c.inc" class="cal__dot" aria-hidden="true" />
          </button>
        </template>
      </div>
      <p class="muted small cal__hint">
        <span class="pos">+ entrate</span> · <span class="neg">− uscite</span>. Tocca un giorno per vederne i movimenti: il pulsante + aggiungerà la voce in quella data (doppio clic per aggiungere subito).
      </p>
      <section v-if="selectedDay" class="tp__day tp__selected">
        <header class="tp__dayhead tp__dayhead--sel">
          <span><strong>{{ dayLabel(selectedDay) }}</strong> <span v-if="selectedNet" class="num" :class="selectedNet > 0 ? 'pos' : 'neg'">{{ netText(selectedNet) }}</span></span>
        </header>
        <p v-if="!selectedOps.length" class="muted small tp__none">Nessun movimento in questo giorno.</p>
        <ul>
          <li v-for="op in selectedOps" :key="op.id"><TxRow :op="op" @open="emit('open', $event)" /></li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 14px; }
.tp__bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.tp__kinds { margin-left: auto; }
/* Mese: selettore centrato con il saldo del mese accanto. */
.tp__month { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.tp .tp__ms { background: var(--surface-2); }
.tp__monthnet { font-size: 0.85rem; font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); }
.tp__switch { display: inline-flex; background: var(--surface-2); border-radius: 999px; padding: 3px; }
.tp__switch button {
  display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
  padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; color: var(--text-secondary);
}
.tp__switch button.on { background: var(--ink); color: var(--brand); }
.tp__empty { padding: 28px 0; text-align: center; }
.tp__list { display: flex; flex-direction: column; gap: 14px; max-height: 640px; overflow-y: auto; padding-right: 4px; }
.tp__day ul { list-style: none; margin: 0; padding: 0; }
.tp__dayhead { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--text-muted); padding: 0 6px 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.tp__dayhead--sel { font-size: 0.92rem; color: var(--text-primary); padding-bottom: 10px; }
.tp__selected { margin-top: 6px; padding: 14px 10px 8px; border-radius: 18px; background: var(--surface-2); }
.tp__none { padding: 6px; }

.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.cal__wd { text-align: center; font-size: 0.75rem; color: var(--text-muted); padding-bottom: 2px; }
.cal__cell {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  min-height: 76px; padding: 7px 8px; border-radius: 14px; border: 1px solid transparent;
  background: var(--surface-2);
  font-size: 0.74rem; text-align: left; cursor: pointer; min-width: 0; overflow: hidden;
}
.cal__cell--empty { background: none; cursor: default; }
.cal__cell:hover { border-color: var(--border-strong); }
.cal__cell--today .cal__num { background: var(--ink); color: var(--brand); }
.cal__cell--on { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.cal__num { display: inline-grid; place-items: center; min-width: 22px; height: 22px; border-radius: 999px; font-size: 0.8rem; font-weight: 500; margin-bottom: 2px; }
.cal__in, .cal__out { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cal__in { color: var(--positive); }
.cal__out { color: var(--negative); }
.cal__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); margin-top: 4px; }
.cal__hint { margin-top: 6px; }
@media (max-width: 600px) {
  .tp__switch span { display: none; }
  .cal { gap: 3px; }
  .cal__cell { min-height: 56px; padding: 4px; border-radius: 10px; font-size: 0.62rem; }
}
</style>
