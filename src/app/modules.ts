import type { RouteRecordRaw } from 'vue-router'
import type { IconName } from '@/core/ui/icons'
import { financeModule } from '@/modules/finance'
import { agendaModule } from '@/modules/agenda'
import { journalModule } from '@/modules/planner'

/**
 * Contratto di un modulo della piattaforma. Per aggiungere un modulo:
 * 1. crea `src/modules/<nome>/` con domain/, data/, store/, components/, views/
 * 2. esporta un `AppModule` da `src/modules/<nome>/index.ts`
 * 3. registralo qui sotto: navigazione e route vengono generate automaticamente.
 */
export interface AppModule {
  id: string
  label: string
  description: string
  icon: IconName
  path: string
  status: 'active' | 'planned'
  routes?: RouteRecordRaw[]
}

const planned = (id: string, label: string, icon: IconName, description: string): AppModule => ({
  id,
  label,
  icon,
  description,
  path: `/${id}`,
  status: 'planned',
})

export const modules: AppModule[] = [financeModule, agendaModule, journalModule]

/** Segnaposto per moduli futuri: `planned('id', 'Etichetta', 'icona', 'Descrizione')`. */
export { planned }
