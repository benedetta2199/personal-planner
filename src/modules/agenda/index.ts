import type { AppModule } from '@/app/modules'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/agenda',
    component: () => import('./views/AgendaLayout.vue'),
    children: [
      { path: '', name: 'agenda-today', component: () => import('./views/TodayView.vue'), meta: { title: 'Agenda · Oggi' } },
      { path: 'task', name: 'agenda-tasks', component: () => import('./views/TasksView.vue'), meta: { title: 'Agenda · Task' } },
      { path: 'calendario', name: 'agenda-calendar', component: () => import('./views/CalendarView.vue'), meta: { title: 'Agenda · Calendario' } },
      { path: 'scadenze', name: 'agenda-commitments', component: () => import('./views/CommitmentsView.vue'), meta: { title: 'Agenda · Scadenze' } },
    ],
  },
]

export const agendaModule: AppModule = {
  id: 'agenda',
  label: 'Agenda',
  description: 'Impegni, scadenze ricorrenti, calendario e task',
  icon: 'calendar',
  path: '/agenda',
  status: 'active',
  routes,
}
