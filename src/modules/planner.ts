/**
 * Modulo Diario: una sola pagina, dati salvati nel browser.
 * Obiettivi e Abitudini sono sotto-sezioni del Planner (vedi `modules/agenda`).
 */
import type { AppModule } from '@/app/modules'

export const journalModule: AppModule = {
  id: 'diario',
  label: 'Diario',
  icon: 'book',
  description: 'Riflessioni, journaling e revisioni periodiche',
  path: '/diario',
  status: 'active',
  routes: [{ path: '/diario', name: 'journal', component: () => import('./journal/JournalView.vue'), meta: { title: 'Diario' } }],
}
