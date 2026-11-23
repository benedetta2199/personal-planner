<script setup lang="ts">
import SubNav from '../../components/SubNav.vue'
import { manageTabs } from '../../routes'
</script>

<template>
  <div class="ml">
    <SubNav :tabs="manageTabs" label="Sezioni di gestione" />
    <RouterView />
  </div>
</template>

<style scoped>
.ml { display: flex; flex-direction: column; gap: 18px; }
</style>
