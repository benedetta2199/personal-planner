import { CATEGORY_COLORS, buildResolver, type Account, type AccountType, type CardTheme, type CategoryKind, type FlowType, type LedgerConfig } from './domain'

/** Etichette e colori dei tipi di flusso: il colore segue sempre l'entità. */
export const FLOW_META: Record<FlowType, { label: string; short: string; swatch: string }> = {
  income: { label: 'Entrate', short: 'Entrata', swatch: '--flow-income' },
  necessary: { label: 'Uscite necessarie', short: 'Necessaria', swatch: '--flow-necessary' },
  additional: { label: 'Uscite aggiuntive', short: 'Aggiuntiva', swatch: '--flow-additional' },
  investment: { label: 'Investimenti', short: 'Investimento', swatch: '--flow-investment' },
  transfer: { label: 'Trasferimenti', short: 'Trasferimento', swatch: '--flow-transfer' },
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  liquidity: 'Liquidità',
  investment: 'Investimento',
}

const MAX_SERIES = 8

/**
 * Colore stabile per conto: deriva dalla posizione nel dataset (non dal ranking),
 * così filtrare non ricolora i conti. Oltre l'8° si usa il grigio "Altri".
 */
export function accountSwatch(accounts: Account[], name: string): string {
  const i = accounts.findIndex((a) => a.name === name)
  return i >= 0 && i < MAX_SERIES ? `--series-${i + 1}` : '--series-other'
}

// ---------------------------------------------------------------------------
// Carte conto e colori categoria
// ---------------------------------------------------------------------------

export const CARD_THEME_META: Record<CardTheme, { label: string; bg: string; fg: string; dim: string }> = {
  forest: { label: 'Bosco', bg: 'linear-gradient(135deg, #1b3510 0%, #2f5c1b 100%)', fg: '#d9f5ae', dim: 'rgba(217, 245, 174, 0.62)' },
  lime: { label: 'Lime', bg: 'linear-gradient(135deg, #c9f283 0%, #a2dc4f 100%)', fg: '#1b3510', dim: 'rgba(27, 53, 16, 0.6)' },
  graphite: { label: 'Grafite', bg: 'linear-gradient(135deg, #17191a 0%, #3a3e40 100%)', fg: '#f4f5f1', dim: 'rgba(244, 245, 241, 0.58)' },
  coral: { label: 'Corallo', bg: 'linear-gradient(135deg, #f26b3a 0%, #f59a5f 100%)', fg: '#fff8f3', dim: 'rgba(255, 248, 243, 0.7)' },
  red: { label: 'Rosso', bg: 'linear-gradient(135deg, #c9392f 0%, #97080f 100%)', fg: '#eef5ff', dim: 'rgba(238, 245, 255, 0.65)' },
  ocean: { label: 'Oceano', bg: 'linear-gradient(135deg, #123f7a 0%, #2f73c9 100%)', fg: '#eef5ff', dim: 'rgba(238, 245, 255, 0.65)' },
  violet: { label: 'Viola', bg: 'linear-gradient(135deg, #4d2a8f 0%, #dd8664 100%)', fg: '#f3f0ff', dim: 'rgba(243, 240, 255, 0.65)' },
  sand: { label: 'Sabbia', bg: 'linear-gradient(135deg, #e8e1d2 0%, #f6f2e8 100%)', fg: '#2b2a24', dim: 'rgba(43, 42, 36, 0.55)' },
}

/** Mescola un colore esadecimale verso il bianco (amount > 0) o il nero (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const target = amount > 0 ? 255 : 0
  const a = Math.min(1, Math.abs(amount))
  const ch = (v: number) => Math.round(v + (target - v) * a)
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/**
 * Colore configurato per la categoria; se non configurata, uno stabile
 * derivato dal nome (il colore segue l'entità, non la posizione).
 */
export function categoryColor(config: LedgerConfig, name: string, kind?: CategoryKind): string {
  const configured = buildResolver(config).categoryConfig(name, kind)?.color
  return configured ?? CATEGORY_COLORS[hashOf(name) % CATEGORY_COLORS.length]
}

/**
 * Varianti della tinta della categoria, alternando chiaro/scuro: ogni
 * sotto-categoria mantiene la sua variante (dipende dalla posizione nella
 * configurazione, non dal ranking nel periodo).
 */
const VARIANT_STEPS = [0, 0.4, -0.32, 0.62, -0.5, 0.22, -0.16, 0.76, 0.52, -0.42, 0.3, -0.24]
export const colorVariant = (hex: string, index: number) => shade(hex, VARIANT_STEPS[index % VARIANT_STEPS.length])

const hashOf = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h
}

/** Colore della sotto-categoria: variante del colore della sua categoria. */
export function subcategoryColor(config: LedgerConfig, category: string, sub: string, kind?: CategoryKind): string {
  const base = categoryColor(config, category, kind)
  if (!sub) return base
  const cfg = buildResolver(config).categoryConfig(category, kind)
  const i = cfg ? cfg.subcategories.findIndex((s) => s.name === sub) : -1
  return colorVariant(base, i >= 0 ? i + 1 : 1 + (hashOf(sub) % (VARIANT_STEPS.length - 1)))
}

/** Colore + trasparenza (per sfondi tenui). */
export const tint = (hex: string, alpha: number) => `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`

/** Nome senza emoji iniziale, per etichette compatte. */
export const plainName = (name: string) => name.replace(/^\p{Extended_Pictographic}️?\s*/u, '').trim() || name
