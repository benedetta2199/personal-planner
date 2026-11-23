<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { modules } from './modules'

/** Barriera d'errore globale: un errore in una vista non blocca l'intera app. */
const fatal = ref<string | null>(null)
onErrorCaptured((err) => {
  console.error(err)
  fatal.value = err instanceof Error ? err.message : String(err)
  return false
})
const reload = () => window.location.reload()
</script>

<template>
  <div class="shell">
    <aside class="side" aria-label="Moduli">
      <RouterLink to="/" class="brand">
        <span class="brand__logo" aria-hidden="true"><UiIcon name="trend" :size="18" /></span>
        <span class="brand__name">Growth Planner</span>
      </RouterLink>
      <nav class="nav">
        <RouterLink v-for="m in modules" :key="m.id" :to="m.path" class="nav__item" active-class="nav__item--on" :title="m.label">
          <UiIcon :name="m.icon" />
          <span class="nav__label">{{ m.label }}</span>
          <span v-if="m.status === 'planned'" class="nav__soon">presto</span>
        </RouterLink>
      </nav>
    </aside>

    <main class="main">
      <UiAlert v-if="fatal" tone="critical" title="Si è verificato un errore imprevisto">
        {{ fatal }}
        <template #actions><UiButton size="sm" icon="refresh" @click="reload">Ricarica</UiButton></template>
      </UiAlert>
      <RouterView v-else />
    </main>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100vh; min-height: 100dvh; }
.side {
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100dvh;
  background: transparent;
  padding: var(--space-5) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.brand { display: flex; align-items: center; gap: 12px; padding: 4px 8px; color: var(--text-primary); font-weight: 700; letter-spacing: -0.02em; }
.brand:hover { text-decoration: none; }
.brand__logo {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--brand);
  color: var(--on-brand);
}
.nav { display: flex; flex-direction: column; gap: 5px; }
.nav__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.92rem;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav__item:hover { background: var(--surface); color: var(--text-primary); text-decoration: none; }
.nav__item--on { background: var(--surface); color: var(--text-primary); font-weight: 600; }
.nav__soon { margin-left: auto; font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
.main { padding: 36px 40px 48px; max-width: 1520px; width: 100%; min-width: 0; }

/* Tablet: sidebar compatta a sole icone */
@media (max-width: 1024px) {
  .shell { grid-template-columns: 68px minmax(0, 1fr); }
  .brand__name, .nav__label, .nav__soon { display: none; }
  .nav__item, .brand { justify-content: center; padding: 10px; }
  .main { padding: 28px 28px 40px; }
}

/* Mobile: barra di navigazione in basso */
@media (max-width: 640px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side {
    position: fixed;
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    height: auto;
    z-index: 50;
    flex-direction: row;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .brand { display: none; }
  .nav { flex-direction: row; justify-content: space-around; width: 100%; gap: 4px; }
  .nav__item { flex-direction: column; gap: 3px; padding: 6px 8px; font-size: 0.7rem; flex: 1; border-radius: 10px; }
  .nav__label { display: block; }
  .main { padding: 22px 16px calc(88px + env(safe-area-inset-bottom)); }
}
</style>
