<script setup lang="ts">
import UiEmpty from '@/core/ui/UiEmpty.vue'
import UiButton from '@/core/ui/UiButton.vue'
</script>

<template>
  <UiEmpty title="Pagina non trovata" icon="alert">
    L'indirizzo richiesto non esiste.
    <template #actions>
      <RouterLink to="/"><UiButton>Torna alla home</UiButton></RouterLink>
    </template>
  </UiEmpty>
</template>
