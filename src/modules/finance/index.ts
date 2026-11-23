import type { AppModule } from '@/app/modules'
import { financeRoutes } from './routes'

export const financeModule: AppModule = {
  id: 'finance',
  label: 'Finanze',
  description: 'Conti, entrate, uscite, investimenti e patrimonio',
  icon: 'wallet',
  path: '/finanze',
  status: 'active',
  routes: financeRoutes,
}
