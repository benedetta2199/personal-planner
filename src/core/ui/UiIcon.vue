<script setup lang="ts">
/** Icone SVG inline (tratto 1.75, stile coerente). */
import { ICON_PATHS, type IconName } from './icons'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="ui-icon"
  >
    <path :d="ICON_PATHS[name]" />
  </svg>
</template>

<style scoped>
.ui-icon { flex-shrink: 0; }
</style>
