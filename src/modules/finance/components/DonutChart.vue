<script setup lang="ts">
/**
 * Ciambella a due anelli: interno = categorie, esterno = sotto-categorie
 * allineate all'arco del genitore. Il centro mostra il totale o il segmento
 * sotto il puntatore. Segmenti separati da uno spazio di 2px.
 */
import { computed, ref } from 'vue'

export interface DonutSegment {
  key: string
  label: string
  value: number
  color: string
  children?: DonutSegment[]
}

const props = defineProps<{
  segments: DonutSegment[]
  centerTitle: string
  format: (v: number) => string
  /** Chiave della categoria evidenziata (le altre si attenuano). */
  focus?: string | null
  size?: number
}>()
const emit = defineEmits<{ select: [key: string] }>()

const S = 260
const C = S / 2
const INNER = { r: 82, w: 26 }
const OUTER = { r: 112, w: 14 }
const GAP_PX = 2

const total = computed(() => props.segments.reduce((s, x) => s + Math.max(0, x.value), 0))

interface Arc { key: string; parent: string; label: string; value: number; color: string; d: string; ring: 'in' | 'out' }

function arcPath(r: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 0.0001)
  const end = a0 + sweep
  const x0 = C + r * Math.sin(a0), y0 = C - r * Math.cos(a0)
  const x1 = C + r * Math.sin(end), y1 = C - r * Math.cos(end)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

const arcs = computed<Arc[]>(() => {
  const t = total.value
  if (!t) return []
  const out: Arc[] = []
  let a = 0
  const many = props.segments.filter((s) => s.value > 0).length > 1
  for (const seg of props.segments) {
    if (seg.value <= 0) continue
    const span = (seg.value / t) * Math.PI * 2
    const gapIn = many ? GAP_PX / INNER.r : 0
    if (span > gapIn) out.push({ key: seg.key, parent: seg.key, label: seg.label, value: seg.value, color: seg.color, d: arcPath(INNER.r, a + gapIn / 2, a + span - gapIn / 2), ring: 'in' })
    let b = a
    const kids = (seg.children ?? []).filter((c) => c.value > 0)
    const gapOut = kids.length > 1 || many ? GAP_PX / OUTER.r : 0
    for (const ch of kids) {
      const cs = (ch.value / t) * Math.PI * 2
      if (cs > gapOut) out.push({ key: `${seg.key}/${ch.key}`, parent: seg.key, label: ch.label, value: ch.value, color: ch.color, d: arcPath(OUTER.r, b + gapOut / 2, b + cs - gapOut / 2), ring: 'out' })
      b += cs
    }
    a += span
  }
  return out
})

const hover = ref<Arc | null>(null)
const parentLabel = (key: string) => props.segments.find((s) => s.key === key)?.label ?? ''
const dimmed = (arc: Arc) => {
  const f = hover.value?.parent ?? props.focus
  return !!f && arc.parent !== f
}

const summary = computed(() =>
  props.segments
    .filter((s) => s.value > 0)
    .map((s) => `${s.label} ${props.format(s.value)}`)
    .join(', '),
)
</script>

<template>
  <div class="donut" :style="{ width: `${size ?? S}px` }">
    <svg :viewBox="`0 0 ${S} ${S}`" role="img" :aria-label="`${centerTitle}: ${format(total)}. ${summary}`" @mouseleave="hover = null">
      <circle v-if="!arcs.length" :cx="C" :cy="C" :r="INNER.r" fill="none" stroke="var(--surface-2)" :stroke-width="INNER.w" />
      <path
        v-for="arc in arcs"
        :key="arc.key"
        :d="arc.d"
        fill="none"
        :stroke="arc.color"
        :stroke-width="arc.ring === 'in' ? INNER.w : OUTER.w"
        class="donut__arc"
        :class="{ 'donut__arc--dim': dimmed(arc), 'donut__arc--on': hover?.key === arc.key }"
        @mouseenter="hover = arc"
        @click="emit('select', arc.parent)"
      />
      <!-- Aree di aggancio più larghe del segno, per un hover comodo -->
      <path
        v-for="arc in arcs"
        :key="`hit-${arc.key}`"
        :d="arc.d"
        fill="none"
        stroke="transparent"
        :stroke-width="arc.ring === 'in' ? INNER.w + 6 : OUTER.w + 10"
        class="donut__hit"
        @mouseenter="hover = arc"
        @click="emit('select', arc.parent)"
      />
    </svg>
    <div class="donut__center" aria-hidden="true">
      <template v-if="hover">
        <span class="donut__k">{{ hover.ring === 'out' ? parentLabel(hover.parent) : 'Categoria' }}</span>
        <strong class="donut__name">{{ hover.label }}</strong>
        <span class="donut__v num">{{ format(hover.value) }}</span>
        <span class="donut__pct num">{{ total ? Math.round((hover.value / total) * 1000) / 10 : 0 }}%</span>
      </template>
      <template v-else>
        <span class="donut__k">{{ centerTitle }}</span>
        <span class="donut__total num">{{ format(total) }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.donut { position: relative; aspect-ratio: 1; max-width: 100%; margin: 0 auto; }
.donut svg { display: block; width: 100%; height: 100%; overflow: visible; }
.donut__arc { transition: opacity 0.15s ease, stroke-width 0.15s ease; pointer-events: none; }
.donut__arc--dim { opacity: 0.25; }
.donut__hit { cursor: pointer; }
.donut__center {
  position: absolute;
  inset: 26%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
  gap: 1px;
}
.donut__k { font-size: 0.72rem; color: var(--text-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.donut__name { font-size: 0.86rem; font-weight: 500; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.donut__v { font-size: 1.05rem; }
.donut__pct { font-size: 0.75rem; color: var(--text-secondary); }
.donut__total { font-size: 1.45rem; letter-spacing: -0.03em; }
@media (prefers-reduced-motion: reduce) { .donut__arc { transition: none; } }
</style>
