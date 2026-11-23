import { describe, expect, it } from 'vitest'
import { categoryIcon, guessCategoryEmoji, leadingEmoji } from './categoryIcons'
import { defaultLedger } from './domain'

describe('emoji delle categorie', () => {
  it('usa l emoji scelta, poi quella nel nome, poi la deduce', () => {
    const state = defaultLedger()
    const cibo = state.config.categories.find((c) => c.name === 'Cibo' && c.kind === 'expense')!
    expect(categoryIcon(state.config, 'Cibo', 'expense')).toBe('🍽️')
    cibo.icon = '🥗'
    expect(categoryIcon(state.config, 'Cibo', 'expense')).toBe('🥗')
    cibo.icon = 'cart' // chiave della versione precedente
    expect(categoryIcon(state.config, 'Cibo', 'expense')).toBe('🛒')
    expect(categoryIcon(state.config, '🍱 Pranzi', 'expense')).toBe('🍱')
  })

  it('riconosce emoji composte e ha un ripiego', () => {
    expect(leadingEmoji('🏋️ Palestra')).toBe('🏋️')
    expect(leadingEmoji('Palestra')).toBeNull()
    expect(guessCategoryEmoji('Qualcosa di nuovo')).toBe('🏷️')
  })
})
