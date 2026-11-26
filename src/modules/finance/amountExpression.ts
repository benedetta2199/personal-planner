/**
 * Valuta l'importo scritto nel campo «Importo», che può essere un'espressione
 * con + − × ÷ e parentesi (es. "12,50 + 3 * 2", "100 / 3", "(20+5)*2").
 * Numeri nel formato italiano ("1.234,56") o con il punto decimale ("12.5").
 * Restituisce i centesimi arrotondati, oppure NaN se l'espressione non è valida.
 */
export function evaluateAmount(text: string): number {
  const v = evaluateExpression(text)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}

/** true se il testo contiene almeno un operatore (oltre a un eventuale segno iniziale). */
export function isAmountExpression(text: string): boolean {
  return /[+\-*/×÷x:()]/i.test(text.trim().replace(/^[+-]/, ''))
}

function parseNumber(raw: string): number {
  // "1.234,56" → 1234.56 ; "12.5" → 12.5 ; "12,5" → 12.5
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.' || normalized === '') return NaN
  return Number(normalized)
}

export function evaluateExpression(text: string): number {
  const src = text
    .replace(/\s|€/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–]/g, '-')
  if (!src) return NaN
  const tokens = src.match(/\d[\d.,]*|[.,]\d[\d.,]*|[+\-*/()]|./g) ?? []
  let i = 0

  const peek = () => tokens[i]
  const next = () => tokens[i++]

  // expr := term (('+'|'-') term)*
  function expr(): number {
    let v = term()
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term()
    return v
  }
  // term := factor (('*'|'/') factor)*
  function term(): number {
    let v = factor()
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const r = factor()
      v = op === '*' ? v * r : r === 0 ? NaN : v / r
    }
    return v
  }
  // factor := ('+'|'-') factor | '(' expr ')' | number
  function factor(): number {
    const t = next()
    if (t === '-') return -factor()
    if (t === '+') return factor()
    if (t === '(') {
      const v = expr()
      if (next() !== ')') return NaN
      return v
    }
    if (t === undefined) return NaN
    return parseNumber(t)
  }

  const result = expr()
  return i === tokens.length ? result : NaN
}
