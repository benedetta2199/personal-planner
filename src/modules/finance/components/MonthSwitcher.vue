<script setup lang="ts">
import { computed } from 'vue'
import UiButton from '@/core/ui/UiButton.vue'
import { todayIso } from '@/core/utils/format'
import { shiftMonth } from '../domain'

/** Selettore mese «‹ Novembre 2026 ›» con ritorno rapido al mese corrente. */
const month = defineModel<string>({ required: true })
const current = todayIso().slice(0, 7)

const label = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const s = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
  return s.charAt(0).toUpperCase() + s.slice(1)
})
</script>

<template>
  <div class="ms" role="group" aria-label="Mese">
    <UiButton variant="ghost" size="sm" icon="chevronLeft" aria-label="Mese precedente" @click="month = shiftMonth(month, -1)" />
    <span class="ms__label" aria-live="polite">{{ label }}</span>
    <UiButton variant="ghost" size="sm" icon="chevronRight" aria-label="Mese successivo" @click="month = shiftMonth(month, 1)" />
    <UiButton v-if="month !== current" variant="ghost" size="sm" class="ms__today" @click="month = current">Oggi</UiButton>
  </div>
</template>

<style scoped>
.ms { display: inline-flex; align-items: center; gap: 2px; background: var(--surface); border-radius: 999px; padding: 4px; }
.ms__label { min-width: 132px; text-align: center; font-weight: 500; font-size: 0.95rem; }
.ms__today { margin-left: 2px; }
</style>
