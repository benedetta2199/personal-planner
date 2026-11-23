import type { FinanceDataset, Operation } from './types.js'

export interface SyncDiff {
  added: number
  updated: number
  removed: number
  unchanged: number
}

const signature = (op: Operation) => {
  const { source: _source, ...rest } = op
  return JSON.stringify(rest)
}

/**
 * Confronta il dataset precedente con quello appena importato.
 * Google Sheets è la fonte di verità: il nuovo dataset sostituisce il vecchio,
 * ma l'identità stabile dei record (ID o impronta) garantisce che un nuovo
 * import non generi mai duplicati e permette di riportare cosa è cambiato.
 */
export function diffDatasets(prev: FinanceDataset | null, next: FinanceDataset): SyncDiff {
  if (!prev) return { added: next.operations.length, updated: 0, removed: 0, unchanged: 0 }
  const before = new Map(prev.operations.map((op) => [op.id, signature(op)]))
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const op of next.operations) {
    const old = before.get(op.id)
    if (old === undefined) added++
    else if (old === signature(op)) unchanged++
    else updated++
    before.delete(op.id)
  }
  return { added, updated, removed: before.size, unchanged }
}
