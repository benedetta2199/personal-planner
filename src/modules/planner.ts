/** Moduli Obiettivi, Abitudini e Diario: una sola pagina ciascuno, dati salvati nel browser. */
import type { AppModule } from '@/app/modules'

export const goalsModule: AppModule = {
  id: 'obiettivi',
  label: 'Obiettivi',
  icon: 'target',
  description: 'Obiettivi a lungo termine e milestone',
  path: '/obiettivi',
  status: 'active',
  routes: [{ path: '/obiettivi', name: 'goals', component: () => import('./goals/GoalsView.vue'), meta: { title: 'Obiettivi' } }],
}

export const habitsModule: AppModule = {
  id: 'abitudini',
  label: 'Abitudini',
  icon: 'repeat',
  description: 'Tracciamento quotidiano delle abitudini',
  path: '/abitudini',
  status: 'active',
  routes: [{ path: '/abitudini', name: 'habits', component: () => import('./habits/HabitsView.vue'), meta: { title: 'Abitudini' } }],
}

export const journalModule: AppModule = {
  id: 'diario',
  label: 'Diario',
  icon: 'book',
  description: 'Riflessioni, journaling e revisioni periodiche',
  path: '/diario',
  status: 'active',
  routes: [{ path: '/diario', name: 'journal', component: () => import('./journal/JournalView.vue'), meta: { title: 'Diario' } }],
}
