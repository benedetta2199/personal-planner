/**
 * Icone delle categorie in stile emoji.
 * Priorità: emoji scelta in Gestione → emoji iniziale del nome (es. «🍱 Cibo») → dedotta dal nome.
 */
import { buildResolver, norm, type CategoryKind, type LedgerConfig } from './domain'

/** Emoji proposte nel selettore della Gestione (l'utente può comunque scriverne un'altra). */
export const EMOJI_CHOICES: { emoji: string; label: string }[] = [
  { emoji: '🍽️', label: 'Cibo' },
  { emoji: '🛒', label: 'Spesa' },
  { emoji: '🍕', label: 'Asporto' },
  { emoji: '☕', label: 'Bar' },
  { emoji: '🍸', label: 'Svago' },
  { emoji: '🍺', label: 'Bevute' },
  { emoji: '🎉', label: 'Feste' },
  { emoji: '🎟️', label: 'Eventi' },
  { emoji: '🎬', label: 'Cinema' },
  { emoji: '🎮', label: 'Giochi' },
  { emoji: '🚗', label: 'Auto' },
  { emoji: '⛽', label: 'Carburante' },
  { emoji: '🚌', label: 'Mezzi' },
  { emoji: '🚲', label: 'Bici' },
  { emoji: '✈️', label: 'Voli' },
  { emoji: '🧳', label: 'Viaggi' },
  { emoji: '🏖️', label: 'Vacanze' },
  { emoji: '🏠', label: 'Casa' },
  { emoji: '💡', label: 'Utenze' },
  { emoji: '🧾', label: 'Bollette' },
  { emoji: '📺', label: 'Abbonamenti' },
  { emoji: '📱', label: 'Telefono' },
  { emoji: '💻', label: 'Tecnologia' },
  { emoji: '🧹', label: 'Pulizie' },
  { emoji: '🔧', label: 'Riparazioni' },
  { emoji: '🩺', label: 'Salute' },
  { emoji: '💊', label: 'Farmaci' },
  { emoji: '🏋️', label: 'Sport' },
  { emoji: '👕', label: 'Abbigliamento' },
  { emoji: '🛍️', label: 'Shopping' },
  { emoji: '💅', label: 'Cura personale' },
  { emoji: '🎁', label: 'Regali' },
  { emoji: '📚', label: 'Istruzione' },
  { emoji: '🎵', label: 'Hobby' },
  { emoji: '🐾', label: 'Animali' },
  { emoji: '👶', label: 'Figli' },
  { emoji: '🌱', label: 'Piante' },
  { emoji: '📈', label: 'Investimenti' },
  { emoji: '🏦', label: 'Banca' },
  { emoji: '💰', label: 'Risparmi' },
  { emoji: '💼', label: 'Stipendio' },
  { emoji: '💵', label: 'Contanti' },
  { emoji: '⭐', label: 'Bonus' },
  { emoji: '↩️', label: 'Rimborsi' },
  { emoji: '🪙', label: 'Interessi' },
  { emoji: '💳', label: 'Carte' },
  { emoji: '📦', label: 'Varie' },
  { emoji: '🏷️', label: 'Altro' },
]

/** Parole chiave (normalizzate) → emoji: la prima regola che corrisponde vince. */
const GUESSES: [RegExp, string][] = [
  [/supermerc|alimentar|spesa/, '🛒'],
  [/asporto|pizz|delivery/, '🍕'],
  [/cibo|ristor|pranz|cena|food|mangiar/, '🍽️'],
  [/caff|bar\b|colazion/, '☕'],
  [/bevut|aperitiv|birr/, '🍺'],
  [/divertiment|svago|uscit/, '🍸'],
  [/concert|bigliett|esperienz|musei|event/, '🎟️'],
  [/cinema|film/, '🎬'],
  [/carburant|benzin/, '⛽'],
  [/auto|parchegg|autostrad|manutenz/, '🚗'],
  [/traspor|mezzi|treno|bus|metro/, '🚌'],
  [/vol[io]\b|aere/, '✈️'],
  [/viagg|vacanz|allogg|hotel|souvenir/, '🧳'],
  [/casa|affitt|mutuo|condomin/, '🏠'],
  [/utenz|luce|energia|gas\b/, '💡'],
  [/abbonament|streaming/, '📺'],
  [/fiss|bollett|serviz/, '🧾'],
  [/telefon|internet|cellular/, '📱'],
  [/medicin|farmac/, '💊'],
  [/salut|medic|visit|dentist/, '🩺'],
  [/sport|palestr|fitness/, '🏋️'],
  [/abbigliament|vestit|scarp/, '👕'],
  [/regal/, '🎁'],
  [/istruz|scuol|libr|cors|universit/, '📚'],
  [/hobby|musica/, '🎵'],
  [/animal|cane|gatto|veterinar/, '🐾'],
  [/cura|bellezz|parrucch|personal|sfiz/, '💅'],
  [/invest|etf|azion|obbligaz|crypto|bitcoin/, '📈'],
  [/risparm/, '💰'],
  [/banca|conto/, '🏦'],
  [/stipend|salari|lavor|13|14esima|saltuari/, '💼'],
  [/bonus|premi/, '⭐'],
  [/rimbors/, '↩️'],
  [/commission|spese bancarie|canone/, '💳'],
  [/saveback|cashback|roundup/, '💸'],
  [/interess|rendit|dividend|cedol|vendit/, '🪙'],
]

/** Chiavi usate dalla versione precedente (icone SVG) → emoji equivalente. */
const LEGACY: Record<string, string> = {
  food: '🍽️', cart: '🛒', coffee: '☕', glass: '🍸', ticket: '🎟️', car: '🚗', bus: '🚌', suitcase: '🧳', home: '🏠',
  bolt: '💡', receipt: '🧾', phone: '📱', heart: '🩺', pill: '💊', dumbbell: '🏋️', shirt: '👕', gift: '🎁', book: '📚',
  music: '🎵', paw: '🐾', sparkle: '💅', trend: '📈', bank: '🏦', briefcase: '💼', star: '⭐', refund: '↩️', coin: '🪙', tag: '🏷️',
}

const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)/u

/** Emoji all'inizio del nome (es. «🍱 Cibo» → 🍱), se presente. */
export function leadingEmoji(name: string): string | null {
  return LEADING_EMOJI.exec(name.trim())?.[1] ?? null
}

/** true se la stringa è (o inizia con) un'emoji. */
export const isEmoji = (v: string) => LEADING_EMOJI.test(v.trim())

export function guessCategoryEmoji(name: string): string {
  const n = norm(name)
  return GUESSES.find(([re]) => re.test(n))?.[1] ?? '🏷️'
}

/** Normalizza un'icona salvata: emoji così com'è, vecchie chiavi convertite. */
function storedIcon(icon: string | undefined): string | null {
  if (!icon) return null
  if (LEGACY[icon]) return LEGACY[icon]
  return isEmoji(icon) ? leadingEmoji(icon) : null
}

/** Emoji della categoria. */
export function categoryIcon(config: LedgerConfig, name: string, kind?: CategoryKind): string {
  return storedIcon(buildResolver(config).categoryConfig(name, kind)?.icon) ?? leadingEmoji(name) ?? guessCategoryEmoji(name)
}
