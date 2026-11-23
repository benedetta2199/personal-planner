<script setup lang="ts">
/** Icona (emoji) di una categoria — vedi categoryIcons.ts. */
withDefaults(defineProps<{ emoji: string; size?: number }>(), { size: 18 })
</script>

<template>
  <span class="cat-emoji" :style="{ fontSize: `${size}px` }" aria-hidden="true">{{ emoji }}</span>
</template>

<style scoped>
.cat-emoji {
  display: inline-grid;
  place-items: center;
  line-height: 1;
  flex-shrink: 0;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
}
</style>
