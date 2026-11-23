import type { AccountType, Cents, CurrencyCode, ExpenseType, IsoDate } from './types.js'

/** Normalizza un'intestazione: minuscolo, senza accenti, solo alfanumerici. */
export function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function isBlank(value: unknown): boolean {
  return cellText(value) === ''
}

const pad = (n: number) => String(n).padStart(2, '0')

function buildIsoDate(y: number, m: number, d: number): IsoDate | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Converte una cella in data ISO. Accetta:
 * - numeri seriali di Google Sheets (giorni dal 30/12/1899)
 * - `YYYY-MM-DD` (anche con orario)
 * - `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` (anno a 2 cifre → 20xx)
 */
export function parseDate(value: unknown): IsoDate | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 150000) return null
    const ms = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000
    const d = new Date(ms)
    return buildIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const text = cellText(value)
  if (!text) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text)
  if (m) return buildIsoDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(text)
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return buildIsoDate(year, +m[2], +m[1])
  }
  return null
}

/**
 * Converte una cella in centesimi. Gestisce formati italiani (`1.234,56`),
 * anglosassoni (`1,234.56`), simboli di valuta e negativi tra parentesi.
 */
export function parseAmount(value: unknown): Cents | null {
  const num = parseDecimal(value)
  return num === null ? null : Math.round(num * 100)
}

/** Converte una cella in numero decimale (stesse regole di `parseAmount`). */
export function parseDecimal(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  let text = cellText(value)
  if (!text) return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  text = text.replace(/[€$£¥\s ']/g, '').replace(/^[A-Za-z]{3}|[A-Za-z]{3}$/g, '')
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  if (!/^[\d.,]+$/.test(text)) return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    // Il separatore che compare per ultimo è quello decimale.
    normalized = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const parts = text.split(',')
    // "1,234,567" → migliaia; "12,5" e "1,234" → decimale (convenzione italiana)
    normalized = parts.length > 2 ? parts.join('') : text.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = text.split('.')
    // "1.234.567" → migliaia; "1.234" (3 cifre dopo il punto) → migliaia in stile italiano
    normalized = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0') ? parts.join('') : text
  } else {
    normalized = text
  }
  const num = Number(normalized)
  if (!Number.isFinite(num)) return null
  return negative ? -num : num
}

const CURRENCY_SYMBOLS: Record<string, CurrencyCode> = {
  '€': 'EUR',
  EURO: 'EUR',
  $: 'USD',
  US$: 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  FR: 'CHF',
}

export function parseCurrency(value: unknown): CurrencyCode | null {
  const text = cellText(value).toUpperCase()
  if (!text) return null
  if (CURRENCY_SYMBOLS[text]) return CURRENCY_SYMBOLS[text]
  return /^[A-Z]{3}$/.test(text) ? text : null
}

const EXPENSE_TYPES: Record<string, ExpenseType> = {
  necessaria: 'necessary',
  necessario: 'necessary',
  necessarie: 'necessary',
  essenziale: 'necessary',
  necessary: 'necessary',
  aggiuntiva: 'additional',
  aggiuntivo: 'additional',
  aggiuntive: 'additional',
  discrezionale: 'additional',
  desiderio: 'additional',
  desideri: 'additional',
  extra: 'additional',
  additional: 'additional',
  investimento: 'investment',
  investimenti: 'investment',
  investment: 'investment',
}

export function parseExpenseType(value: unknown): ExpenseType | null {
  return EXPENSE_TYPES[normalizeKey(value)] ?? null
}

const INVESTMENT_ACCOUNT_WORDS = [
  'investimento', 'investimenti', 'investment', 'broker', 'titoli', 'dossier',
  'crypto', 'cripto', 'etf', 'azioni', 'fondo', 'fondi', 'pensione', 'previdenza',
]

export function parseAccountType(value: unknown): AccountType | null {
  const key = normalizeKey(value)
  if (!key) return null
  return INVESTMENT_ACCOUNT_WORDS.some((w) => key.includes(w)) ? 'investment' : 'liquidity'
}

/** Hash deterministico a 53 bit (cyrb53) usato per le impronte dei record. */
export function hash53(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
