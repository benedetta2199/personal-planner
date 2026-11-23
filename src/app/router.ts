import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { modules } from './modules'

const moduleRoutes: RouteRecordRaw[] = modules.flatMap((m) =>
  m.status === 'active' && m.routes
    ? m.routes
    : [{ path: m.path, name: `planned-${m.id}`, component: () => import('./views/ComingSoonView.vue'), props: { moduleId: m.id }, meta: { title: m.label } }],
)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/finanze' },
    ...moduleRoutes,
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFoundView.vue'), meta: { title: 'Pagina non trovata' } },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · Growth Planner` : 'Growth Planner'
})
