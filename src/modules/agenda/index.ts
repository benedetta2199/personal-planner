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
      { path: 'obiettivi', name: 'goals', component: () => import('@/modules/goals/GoalsView.vue'), props: { embedded: true }, meta: { title: 'Obiettivi' } },
      { path: 'abitudini', name: 'habits', component: () => import('@/modules/habits/HabitsView.vue'), props: { embedded: true }, meta: { title: 'Abitudini' } },
    ],
  },
  // Indirizzi delle versioni precedenti (pagine separate)
  { path: '/obiettivi', redirect: { name: 'goals' } },
  { path: '/abitudini', redirect: { name: 'habits' } },
]

/** Agenda, Obiettivi e Abitudini riuniti in un'unica pagina divisa in sotto-sezioni. */
export const agendaModule: AppModule = {
  id: 'agenda',
  label: 'Planner',
  description: 'Agenda, task, scadenze, obiettivi e abitudini',
  icon: 'calendar',
  path: '/agenda',
  status: 'active',
  routes,
}
