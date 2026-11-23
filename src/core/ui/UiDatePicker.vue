<script setup lang="ts">
/**
 * Selettore data (Reka UI DatePicker): campo a segmenti gg/mm/aaaa digitabile da tastiera,
 * calendario in un pannello e scorciatoie «Oggi» / «Ieri». Il modello è una data ISO «aaaa-mm-gg».
 * Il pannello non usa portal, così funziona anche dentro i <dialog> modali.
 */
import { computed } from 'vue'
import { CalendarDate, getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import {
  DatePickerCalendar,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerContent,
  DatePickerField,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerInput,
  DatePickerNext,
  DatePickerPrev,
  DatePickerRoot,
  DatePickerTrigger,
} from 'reka-ui'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ label: string; required?: boolean; disabled?: boolean; shortcuts?: boolean }>(), { shortcuts: true })
const model = defineModel<string>({ required: true })

const value = computed<DateValue | undefined>({
  get: () => {
    try {
      return model.value ? parseDate(model.value) : undefined
    } catch {
      return undefined
    }
  },
  set: (d) => {
    model.value = d ? new CalendarDate(d.year, d.month, d.day).toString() : ''
  },
})

const todayDate = () => today(getLocalTimeZone())
function pick(offset: number) {
  value.value = todayDate().subtract({ days: offset })
}
const isOffset = (offset: number) => !!value.value && value.value.compare(todayDate().subtract({ days: offset })) === 0
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
</script>

<template>
  <DatePickerRoot
    v-model="value"
    locale="it-IT"
    :week-starts-on="1"
    weekday-format="short"
    fixed-weeks
    close-on-select
    :required="required"
    :disabled="disabled"
    granularity="day"
  >
    <div class="dp__wrap">
      <DatePickerField v-slot="{ segments }" class="dp__field" :aria-label="label">
        <template v-for="item in segments" :key="item.part">
          <DatePickerInput v-if="item.part === 'literal'" :part="item.part" class="dp__lit">{{ item.value }}</DatePickerInput>
          <DatePickerInput v-else :part="item.part" class="dp__seg">{{ item.value }}</DatePickerInput>
        </template>
        <DatePickerTrigger class="dp__trigger" :aria-label="`Apri il calendario: ${label}`">
          <UiIcon name="calendar" :size="17" />
        </DatePickerTrigger>
      </DatePickerField>

      <div v-if="shortcuts && !disabled" class="dp__quick">
        <button type="button" class="dp__chip" :class="{ on: isOffset(0) }" @click="pick(0)">Oggi</button>
        <button type="button" class="dp__chip" :class="{ on: isOffset(1) }" @click="pick(1)">Ieri</button>
      </div>
    </div>

    <DatePickerContent class="dp__pop" side="bottom" align="start" :side-offset="8" :collision-padding="12" :portal="{ disabled: true }">
      <DatePickerCalendar v-slot="{ weekDays, grid }" class="dp__cal">
        <DatePickerHeader class="dp__head">
          <DatePickerPrev class="dp__nav" aria-label="Mese precedente"><UiIcon name="chevronLeft" :size="16" /></DatePickerPrev>
          <DatePickerHeading v-slot="{ headingValue }" class="dp__heading">{{ capitalize(headingValue) }}</DatePickerHeading>
          <DatePickerNext class="dp__nav" aria-label="Mese successivo"><UiIcon name="chevronRight" :size="16" /></DatePickerNext>
        </DatePickerHeader>
        <DatePickerGrid v-for="month in grid" :key="month.value.toString()" class="dp__grid">
          <DatePickerGridHead>
            <DatePickerGridRow class="dp__row">
              <DatePickerHeadCell v-for="day in weekDays" :key="day" class="dp__wd">{{ capitalize(day) }}</DatePickerHeadCell>
            </DatePickerGridRow>
          </DatePickerGridHead>
          <DatePickerGridBody>
            <DatePickerGridRow v-for="(week, i) in month.rows" :key="`w-${i}`" class="dp__row">
              <DatePickerCell v-for="d in week" :key="d.toString()" :date="d" class="dp__cell">
                <DatePickerCellTrigger :day="d" :month="month.value" class="dp__day" />
              </DatePickerCell>
            </DatePickerGridRow>
          </DatePickerGridBody>
        </DatePickerGrid>
      </DatePickerCalendar>
      <div class="dp__popfoot">
        <button type="button" class="dp__chip" @click="pick(0)">Oggi</button>
      </div>
    </DatePickerContent>
  </DatePickerRoot>
</template>

<style>
/* Non «scoped»: i pannelli di Reka (Popover/DatePicker) non ricevono l attributo di scope,
 * quindi le regole vanno globali. Le classi hanno un prefisso univoco. */
.dp__wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dp__field {
  display: flex; align-items: center; gap: 1px; height: 42px; padding: 0 6px 0 12px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface);
  font-size: 0.95rem; color: var(--text-primary); transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dp__field:hover { border-color: var(--text-muted); }
.dp__field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--brand-soft); }
.dp__field[data-disabled] { opacity: 0.6; }
.dp__field[data-invalid] { border-color: var(--negative); }
.dp__seg { padding: 2px 3px; border-radius: 6px; outline: none; font-variant-numeric: tabular-nums; }
.dp__seg:focus { background: var(--brand-soft); color: var(--on-brand); }
.dp__seg[data-placeholder] { color: var(--text-muted); }
.dp__cal{background: #ffffff;}
.dp__lit { color: var(--text-muted); padding: 0 1px; }
.dp__trigger {
  display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; border: 0; border-radius: 8px;
  background: none; color: var(--text-secondary); cursor: pointer;
}
.dp__trigger:hover, .dp__trigger[data-state='open'] { background: var(--surface-2); color: var(--text-primary); }

.dp__quick { display: flex; gap: 6px; }
.dp__chip {
  padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface);
  font: inherit; font-size: 0.76rem; color: var(--text-secondary); cursor: pointer;
}
.dp__chip:hover { border-color: var(--ink); color: var(--text-primary); }
.dp__chip.on { background: var(--ink); border-color: var(--ink); color: #fff; }

.dp__pop {
  z-index: 1000; padding: 8px; border-radius: 20px;
  /* Vetro smerigliato: bianco semitrasparente che sfoca ciò che c'è dietro. */
  background: rgba(255, 255, 255, 0.62);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 18px 48px rgba(18, 24, 33, 0.18), 0 2px 6px rgba(18, 24, 33, 0.06);
}
/* Senza supporto al blur meglio un bianco pieno, per la leggibilità. */
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  .dp__pop { background: #fff; border-color: var(--border); }
}
.dp__pop[data-state='open'] { animation: dp-in 0.14s ease-out; transform-origin: var(--reka-popover-content-transform-origin, top left); }
@keyframes dp-in { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: none; } }

/* Scheda del calendario: bianco latte con una lieve sfumatura azzurra verso il basso. */
.dp__cal {
  padding: 12px 12px 8px;
  border-radius: 14px;
  background:
    radial-gradient(120% 60% at 50% 0%, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0) 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(234, 241, 249, 0.86) 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.9), 0 1px 2px rgba(18, 24, 33, 0.06);
}
.dp__head { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; gap: 8px; margin-bottom: 10px; }
.dp__heading { text-align: center; font-weight: 650; font-size: 0.98rem; letter-spacing: -0.01em; color: var(--text-primary); }
.dp__nav {
  display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%;
  background: transparent; color: var(--text-secondary); cursor: pointer; transition: background 0.12s ease, color 0.12s ease;
}
.dp__nav:hover { color: var(--on-brand); background: var(--brand-soft); }
.dp__nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dp__grid { border-collapse: collapse; }
.dp__row { display: grid; grid-template-columns: repeat(7, 36px); gap: 2px; }
.dp__wd {
  font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--text-muted); text-align: center; padding-bottom: 6px; margin-bottom: 4px;
  border-bottom: 1px solid rgba(18, 24, 33, 0.06);
}
/* Sabato e domenica (la settimana parte da lunedì). */
.dp__row > .dp__wd:nth-child(n + 6) { color: var(--accent); }
.dp__row > .dp__cell:nth-child(n + 6) .dp__day:not([data-selected]):not([data-outside-view]) { color: var(--accent); }
.dp__cell { display: grid; place-items: center; }
.dp__day {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
  font-size: 0.88rem; color: var(--text-primary); cursor: pointer; outline: none; font-variant-numeric: tabular-nums;
  transition: background 0.1s ease, transform 0.1s ease;
}
.dp__day:hover, .dp__day[data-highlighted] { background: var(--brand-soft); }
.dp__day:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.dp__day[data-today]:not([data-selected]) { font-weight: 700; color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
.dp__day[data-selected] { background: var(--ink); color: #fff; font-weight: 650; box-shadow: 0 4px 10px rgba(34, 64, 95, 0.35); }
.dp__day[data-selected]:hover { transform: scale(1.04); }
.dp__day[data-outside-view] { color: var(--text-muted); opacity: 0.45; }
.dp__day[data-disabled], .dp__day[data-unavailable] { opacity: 0.3; pointer-events: none; }
.dp__popfoot { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 4px 2px; }
.dp__popfoot .dp__chip { background: rgba(255, 255, 255, 0.8); }
@media (prefers-reduced-motion: reduce) { .dp__pop[data-state='open'] { animation: none; } }
</style>
