<script setup lang="ts">
import { computed } from 'vue'
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { modules } from '../modules'

const props = defineProps<{ moduleId: string }>()
const mod = computed(() => modules.find((m) => m.id === props.moduleId))
</script>

<template>
  <div class="cs">
    <UiEmpty :title="`${mod?.label ?? 'Modulo'} — in arrivo`" :icon="mod?.icon ?? 'info'">
      {{ mod?.description }}. Questo modulo è previsto nelle prossime fasi della piattaforma.
      <template #actions>
        <RouterLink to="/finanze"><UiButton>Vai alle Finanze</UiButton></RouterLink>
      </template>
    </UiEmpty>
  </div>
</template>

<style scoped>
.cs { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); margin-top: var(--space-5); }
</style>
