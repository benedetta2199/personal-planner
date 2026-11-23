<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiAlert from '@/core/ui/UiAlert.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { modules } from './modules'
import { useCloudSync } from './sync/cloudSync'
import { useAuthStore } from './auth/authStore'
import { readJson, writeJson } from '@/core/utils/storage'

/** Barriera d'errore globale: un errore in una vista non blocca l'intera app. */
const fatal = ref<string | null>(null)
onErrorCaptured((err) => {
  console.error(err)
  fatal.value = err instanceof Error ? err.message : String(err)
  return false
})
const reload = () => window.location.reload()

/** Salvataggio sul foglio Google di Agenda, Obiettivi, Abitudini e Diario. */
const cloud = useCloudSync()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
/** Il salvataggio parte solo dopo il login; a ogni nuovo accesso si riprova subito. */
watch(
  () => auth.isAuthenticated,
  (on) => {
    if (!on) return
    cloud.start()
    cloud.retry()
  },
  { immediate: true },
)

/** Barra laterale ridotta alle sole icone (scelta ricordata su questo dispositivo). */
const SIDE_KEY = 'gp.sidebar.collapsed'
const collapsed = ref(readJson<boolean>(SIDE_KEY) === true)
watch(collapsed, (v) => writeJson(SIDE_KEY, v))

/** Pagine pubbliche (login): senza barra laterale. */
const isPublic = computed(() => !!route.meta.public)

async function logout() {
  auth.logout()
  await router.replace({ name: 'login' })
}
const cloudChip = computed(() => {
  const s = cloud.status
  if (s.state === 'saving') return { tone: 'busy', text: 'Salvataggio sul foglio…' }
  if (s.state === 'saved') return { tone: 'ok', text: 'Salvato sul foglio' }
  if (s.state === 'idle') return null
  return { tone: 'error', text: s.state === 'off' ? 'Foglio non collegato' : 'Non salvato sul foglio' }
})
/** L'avviso compare solo nelle pagine del planner: il Finanze ha già il suo. */
const showCloudAlert = computed(() => auth.isAuthenticated && (cloud.status.state === 'error' || cloud.status.state === 'needs-token') && !route.path.startsWith('/finanze'))
</script>

<template>
  <RouterView v-if="isPublic" />
  <div v-else class="shell" :class="{ 'shell--collapsed': collapsed }">
    <aside class="side" aria-label="Moduli">
      <div class="side__top">
        <RouterLink to="/" class="brand" title="Growth Planner">
          <span class="brand__logo" aria-hidden="true"><UiIcon name="trend" :size="18" /></span>
          <span class="brand__name">Growth Planner</span>
        </RouterLink>
        <button
          type="button"
          class="side__toggle"
          :aria-expanded="!collapsed"
          :title="collapsed ? 'Espandi la barra laterale' : 'Riduci la barra laterale'"
          :aria-label="collapsed ? 'Espandi la barra laterale' : 'Riduci la barra laterale'"
          @click="collapsed = !collapsed"
        >
          <UiIcon name="sidebar" :size="18" />
        </button>
      </div>
      <nav class="nav">
        <RouterLink to="/" class="nav__item" exact-active-class="nav__item--on" title="Home">
          <UiIcon name="home" />
          <span class="nav__label">Home</span>
        </RouterLink>
        <RouterLink v-for="m in modules" :key="m.id" :to="m.path" class="nav__item" active-class="nav__item--on" :title="m.label">
          <UiIcon :name="m.icon" />
          <span class="nav__label">{{ m.label }}</span>
          <span v-if="m.status === 'planned'" class="nav__soon">presto</span>
        </RouterLink>
      </nav>
      <button v-if="cloudChip" type="button" class="cloud" :class="`cloud--${cloudChip.tone}`" :title="cloud.status.message ?? 'Agenda, Obiettivi, Abitudini e Diario'" @click="cloud.retry()">
        <span class="cloud__dot" aria-hidden="true" />
        <span class="cloud__text" role="status">{{ cloudChip.text }}</span>
      </button>
      <button type="button" class="logout" :class="{ 'logout--alone': !cloudChip }" title="Esci (elimina il token da questo dispositivo)" @click="logout">
        <UiIcon name="logout" :size="16" />
        <span class="logout__text">Esci</span>
      </button>
    </aside>

    <main class="main">
      <UiAlert v-if="fatal" tone="critical" title="Si è verificato un errore imprevisto">
        {{ fatal }}
        <template #actions><UiButton size="sm" icon="refresh" @click="reload">Ricarica</UiButton></template>
      </UiAlert>
      <template v-else>
        <UiAlert v-if="showCloudAlert" tone="warning" title="Le modifiche non sono ancora sul foglio Google" class="cloud-alert">
          {{ cloud.status.message }} Restano salvate in questo browser e verranno inviate appena possibile.
          <template #actions>
            <UiButton v-if="cloud.status.state === 'needs-token'" size="sm" icon="lock" @click="logout">Accedi di nuovo</UiButton>
            <UiButton v-else size="sm" icon="refresh" @click="cloud.retry()">Riprova</UiButton>
          </template>
        </UiAlert>
        <RouterView />
      </template>
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
.side__top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.side__toggle {
  display: grid; place-items: center; width: 34px; height: 34px; flex: none;
  border: 0; border-radius: 10px; background: transparent; color: var(--text-muted); cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.side__toggle:hover { background: var(--surface); color: var(--text-primary); }
.side__toggle:focus-visible, .nav__item:focus-visible, .brand:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.shell { transition: grid-template-columns 0.2s ease; }
.brand { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 4px 8px; color: var(--text-primary); font-weight: 700; letter-spacing: -0.02em; }
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
.nav__item:hover { background: var(--brand-soft); color: var(--on-brand); text-decoration: none; }
.nav__item--on, .nav__item--on:hover { background: var(--ink); color: var(--brand); font-weight: 600; }
.nav__soon { margin-left: auto; font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
.cloud {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}
.cloud:hover { background: var(--surface); }
.logout {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.logout--alone { margin-top: auto; }
.logout:hover { background: var(--surface); color: var(--text-primary); }
.cloud__dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: currentColor; }
.cloud--ok .cloud__dot { color: var(--positive); }
.cloud--busy .cloud__dot { color: var(--accent); }
.cloud--error { color: var(--status-warning); }
.cloud-alert { margin-bottom: var(--space-5); }
.main { padding: 36px 40px 48px; max-width: 1520px; width: 100%; min-width: 0; }

/* Barra ridotta a sole icone: su richiesta su desktop, sempre su tablet */
@media (min-width: 641px) {
  .shell--collapsed { grid-template-columns: 68px minmax(0, 1fr); }
  .shell--collapsed :is(.brand__name, .nav__label, .nav__soon, .cloud__text, .logout__text) { display: none; }
  .shell--collapsed :is(.cloud, .logout) { justify-content: center; }
  .shell--collapsed :is(.nav__item, .brand) { justify-content: center; padding: 10px; }
  .shell--collapsed .side__top { flex-direction: column; gap: 10px; }
}
@media (max-width: 1024px) {
  .shell { grid-template-columns: 68px minmax(0, 1fr); }
  .brand__name, .nav__label, .nav__soon, .cloud__text, .logout__text, .side__toggle { display: none; }
  .cloud, .logout { justify-content: center; }
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
  .side__top, .cloud { display: none; }
  .nav { flex-direction: row; justify-content: space-around; width: 100%; gap: 2px; }
  .nav__item { flex-direction: column; gap: 3px; padding: 6px 4px; font-size: 0.66rem; flex: 1; min-width: 0; border-radius: 12px; }
  .nav__item--on, .nav__item--on:hover { background: var(--brand-soft); color: var(--on-brand); }
  .logout { margin-top: 0; flex-direction: column; gap: 3px; padding: 6px 4px; font-size: 0.66rem; border-radius: 10px; flex: none; }
  .logout__text { display: block; }
  .nav__label { display: block; }
  .main { padding: 22px 16px calc(88px + env(safe-area-inset-bottom)); }
}
</style>
