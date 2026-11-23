<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from '@/core/ui/UiIcon.vue'
import UiButton from '@/core/ui/UiButton.vue'
import { AuthError, useAuthStore } from '../auth/authStore'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const draft = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await auth.login(draft.value)
    const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    await router.replace(target)
  } catch (e) {
    error.value = e instanceof AuthError ? e.message : (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="submit">
      <span class="login__logo" aria-hidden="true"><UiIcon name="trend" :size="22" /></span>
      <h1>Growth Planner</h1>
      <p class="muted small">Inserisci il token di accesso per entrare. Verrà ricordato su questo dispositivo fino al logout.</p>

      <label class="login__field">
        <span class="small secondary">Token di accesso (APP_ACCESS_TOKEN)</span>
        <input
          v-model="draft"
          class="input"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="Incolla il token"
          autofocus
          :aria-invalid="!!error || undefined"
          aria-describedby="login-error"
        />
      </label>
      <p v-if="error" id="login-error" class="login__error small" role="alert">{{ error }}</p>

      <UiButton type="submit" variant="primary" icon="lock" :loading="loading" :disabled="!draft.trim()">Accedi</UiButton>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: var(--space-5) 16px; }
.login__card {
  width: 100%;
  max-width: 400px;
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  box-shadow: var(--shadow);
}
.login__logo { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--brand); color: var(--on-brand); }
.login__field { display: flex; flex-direction: column; gap: 6px; }
.login__error { color: var(--negative); margin-top: calc(-1 * var(--space-2)); }
</style>
