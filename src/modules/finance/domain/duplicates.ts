import type { Operation } from './types.js'
import { normalizeKey } from './parsers.js'

export interface DuplicateGroup {
  /** Chiave stabile del gruppo (tipo, data, importo, valuta, categoria, sotto-categoria). */
  key: string
  date: string
  amount: number
  currency: string
  kind: Operation['kind']
  operations: Operation[]
}

/**
 * Movimenti con stessa data, importo, categoria e sotto-categoria (e stesso tipo e valuta:
 * un'entrata e un'uscita uguali non sono un doppione).
 * Gruppi dal più recente; nel gruppo l'ordine è quello dei dati (il primo è quello che si tiene).
 */
export function findDuplicateGroups(operations: readonly Operation[], ignored: ReadonlySet<string> = new Set()): DuplicateGroup[] {
  const byKey = new Map<string, Operation[]>()
  for (const op of operations) {
    const key = duplicateKey(op)
    const list = byKey.get(key)
    if (list) list.push(op)
    else byKey.set(key, [op])
  }
  const groups: DuplicateGroup[] = []
  for (const [key, ops] of byKey) {
    if (ops.length < 2 || ignored.has(ignoreKey(ops))) continue
    const first = ops[0]
    groups.push({ key, date: first.date, amount: first.amount, currency: first.currency, kind: first.kind, operations: ops })
  }
  return groups.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
}

export function duplicateKey(op: Operation): string {
  // Categoria e sotto-categoria senza maiuscole, accenti ed emoji: «💵 Stipendio» = «stipendio».
  return `${op.kind}|${op.date}|${op.amount}|${op.currency}|${normalizeKey(op.category)}|${normalizeKey(op.subcategory)}`
}

/** Identifica un gruppo segnato come «non sono doppioni»: se cambia la composizione, torna visibile. */
export function ignoreKey(ops: readonly Operation[]): string {
  return ops
    .map((o) => o.id)
    .sort()
    .join('+')
}
