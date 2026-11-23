import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { modules } from './modules'
import { useAuthStore } from './auth/authStore'

const moduleRoutes: RouteRecordRaw[] = modules.flatMap((m) =>
  m.status === 'active' && m.routes
    ? m.routes
    : [{ path: m.path, name: `planned-${m.id}`, component: () => import('./views/ComingSoonView.vue'), props: { moduleId: m.id }, meta: { title: m.label } }],
)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { title: 'Accedi', public: true } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: 'Home' } },
    ...moduleRoutes,
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFoundView.vue'), meta: { title: 'Pagina non trovata' } },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

/** Senza token si viene mandati al login; dopo l'accesso si torna alla pagina richiesta. */
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return auth.isAuthenticated && to.name === 'login' ? { name: 'home' } : true
  if (!auth.isAuthenticated) return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  return true
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · Growth Planner` : 'Growth Planner'
})
