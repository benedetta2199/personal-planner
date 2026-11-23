<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney } from '@/core/utils/format'
import type { CardTheme } from '../domain'
import { CARD_THEME_META } from '../presentation'

const props = defineProps<{
  name: string
  balance: number
  currency: string
  theme: CardTheme
  /** Etichetta in basso (es. "Liquidità"). */
  kind: string
  /** Variazione del saldo nel mese corrente, in valuta del conto. */
  monthDelta?: number | null
}>()
const t = computed(() => CARD_THEME_META[props.theme] ?? CARD_THEME_META.forest)
const parts = computed(() => {
  const s = formatMoney(props.balance, props.currency)
  const i = s.lastIndexOf(',')
  return i > 0 ? { int: s.slice(0, i), dec: s.slice(i) } : { int: s, dec: '' }
})
</script>

<template>
  <article class="cc" :style="{ background: t.bg, color: t.fg, '--dim': t.dim }" :aria-label="`${name}: saldo ${formatMoney(balance, currency)}`">
    <header class="cc__top">
      <strong class="cc__name">{{ name }}</strong>
      <svg class="cc__wave" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M15.5 2.5a13 13 0 0 1 0 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </header>
    <div class="cc__chip" aria-hidden="true"><span /><span /><span /></div>
    <div class="cc__bal">
      <span class="cc__k">Saldo</span>
      <span class="cc__v num" :class="{ 'cc__v--neg': balance < 0 }">{{ parts.int }}<small>{{ parts.dec }}</small></span>
    </div>
    <footer class="cc__foot">
      <span class="cc__k">•••• {{ kind }}</span>
      <span v-if="monthDelta" class="cc__delta num">{{ monthDelta > 0 ? '▲' : '▼' }} {{ formatMoney(Math.abs(monthDelta), currency) }} mese</span>
    </footer>
  </article>
</template>

<style scoped>
.cc {
  position: relative;
  aspect-ratio: 1.586;
  border-radius: 22px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  min-width: 0;
  box-shadow: 0 10px 24px rgba(19, 24, 17, 0.12);
  isolation: isolate;
}
.cc::after {
  content: '';
  position: absolute;
  width: 70%;
  aspect-ratio: 1;
  right: -22%;
  top: -40%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.09);
  z-index: -1;
}
.cc__top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cc__name { font-size: 1.05rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc__wave { width: 22px; height: 22px; opacity: 0.8; transform: rotate(0deg); flex-shrink: 0; }
.cc__chip {
  width: 38px; height: 28px; border-radius: 7px; display: grid; grid-template-rows: repeat(3, 1fr); gap: 2px; padding: 4px;
  background: linear-gradient(135deg, #e9d79a, #c9a952); opacity: 0.92;
}
.cc__chip span { border-radius: 2px; background: rgba(0, 0, 0, 0.12); }
.cc__bal { display: flex; flex-direction: column; gap: 0; }
.cc__k { font-size: 0.74rem; color: var(--dim); letter-spacing: 0.02em; }
.cc__v { font-size: clamp(1.35rem, 2.1vw, 1.7rem); letter-spacing: -0.03em; line-height: 1.15; white-space: nowrap; }
.cc__v small { font-size: 0.62em; opacity: 0.75; }
.cc__v--neg { text-decoration: underline wavy rgba(255, 80, 60, 0.7); text-underline-offset: 4px; }
.cc__foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cc__delta { font-size: 0.72rem; color: var(--dim); white-space: nowrap; }
</style>
