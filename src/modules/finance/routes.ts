import type { RouteRecordRaw } from 'vue-router'
import type { IconName } from '@/core/ui/icons'

export const financeTabs: { name: string; label: string; icon: IconName }[] = [
  { name: 'finance-month', label: 'Mese', icon: 'calendar' },
  { name: 'finance-dashboard', label: 'Panoramica', icon: 'dashboard' },
  { name: 'finance-investments', label: 'Investimenti', icon: 'trend' },
]

/** Gestione (conti, categorie, importazione…) è raggiunta dal pulsante a ingranaggio accanto alle schede. */
export const dashboardTabs: { name: string; label: string }[] = [
  { name: 'finance-dash-total', label: 'Totale' },
  { name: 'finance-dash-year', label: 'Annuale' },
  { name: 'finance-dash-month', label: 'Mensile' },
  { name: 'finance-operations', label: 'Movimenti' },
]

export const manageTabs: { name: string; label: string }[] = [
  { name: 'finance-manage-accounts', label: 'Conti' },
  { name: 'finance-manage-categories', label: 'Categorie' },
  { name: 'finance-import', label: 'Importazione' },
  { name: 'finance-reconciliation', label: 'Riconciliazione' },
  { name: 'finance-payroll', label: 'Buste paga' },
  { name: 'finance-manage-data', label: 'Dati e backup' },
]

export const financeRoutes: RouteRecordRaw[] = [
  {
    path: '/finanze',
    component: () => import('./views/FinanceLayout.vue'),
    children: [
      { path: '', name: 'finance-month', component: () => import('./views/MonthView.vue'), meta: { title: 'Spese del mese' } },
      {
        path: 'panoramica',
        name: 'finance-dashboard',
        component: () => import('./views/dashboard/DashboardLayout.vue'),
        redirect: { name: 'finance-dash-total' },
        children: [
          { path: 'totale', name: 'finance-dash-total', component: () => import('./views/dashboard/DashTotalView.vue'), meta: { title: 'Panoramica · Totale' } },
          { path: 'annuale', name: 'finance-dash-year', component: () => import('./views/dashboard/DashYearView.vue'), meta: { title: 'Panoramica · Annuale' } },
          { path: 'mensile', name: 'finance-dash-month', component: () => import('./views/dashboard/DashMonthView.vue'), meta: { title: 'Panoramica · Mensile' } },
          { path: 'movimenti', name: 'finance-operations', component: () => import('./views/OperationsView.vue'), meta: { title: 'Movimenti' } },
        ],
      },
      {
        path: 'gestione',
        name: 'finance-manage',
        component: () => import('./views/manage/ManageLayout.vue'),
        redirect: { name: 'finance-manage-accounts' },
        children: [
          { path: 'conti', name: 'finance-manage-accounts', component: () => import('./views/ManageView.vue'), props: { section: 'accounts' }, meta: { title: 'Gestione · Conti' } },
          { path: 'categorie', name: 'finance-manage-categories', component: () => import('./views/ManageView.vue'), props: { section: 'categories' }, meta: { title: 'Gestione · Categorie' } },
          { path: 'importazione', name: 'finance-import', component: () => import('./views/ImportView.vue'), meta: { title: 'Importazione' } },
          { path: 'riconciliazione', name: 'finance-reconciliation', component: () => import('./views/ReconciliationView.vue'), meta: { title: 'Riconciliazione estratti' } },
          { path: 'buste paga', name: 'finance-payroll', component: () => import('./views/PayrollView.vue'), meta: { title: 'Buste paga' } },
          { path: 'dati', name: 'finance-manage-data', component: () => import('./views/ManageView.vue'), props: { section: 'data' }, meta: { title: 'Gestione · Dati e backup' } },
        ],
      },
      { path: 'investimenti', name: 'finance-investments', component: () => import('./views/InvestmentsView.vue'), meta: { title: 'Investimenti' } },
      // Percorsi delle versioni precedenti
      { path: 'dashboard/:rest(.*)*', redirect: (to) => `/finanze/panoramica/${([] as string[]).concat(to.params.rest ?? []).join('/')}` },
      { path: 'movimenti', redirect: { name: 'finance-operations' } },
      { path: 'importazione', redirect: { name: 'finance-import' } },
      { path: 'riconciliazione', redirect: { name: 'finance-reconciliation' } },
      { path: 'buste paga', redirect: { name: 'finance-payroll' } },
      { path: 'conti', redirect: { name: 'finance-dashboard' } },
      { path: 'categorie', redirect: { name: 'finance-manage-categories' } },
    ],
  },
]
