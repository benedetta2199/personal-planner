<script setup lang="ts" generic="T extends string">
defineProps<{ options: { value: T; label: string }[]; label: string }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="seg__opt"
      :class="{ 'seg__opt--on': model === o.value }"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
  max-width: 100%;
  overflow-x: auto;
}
.seg__opt {
  border: 0;
  background: transparent;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.83rem;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.seg__opt--on { background: var(--surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(19, 24, 17, 0.08); font-weight: 500; }
</style>
