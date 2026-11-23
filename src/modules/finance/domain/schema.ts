import type { SheetName } from './types.js'

/**
 * Definizione dello schema dei fogli Google Sheets.
 * Ogni campo ha un'etichetta canonica (quella documentata) e degli alias
 * accettati; il confronto avviene su intestazioni normalizzate (vedi `normalizeKey`).
 */
export interface FieldDef {
  key: string
  label: string
  aliases: string[]
  /** La colonna deve esistere nell'intestazione. */
  requiredColumn: boolean
  description: string
}

const common: FieldDef[] = [
  { key: 'date', label: 'Giorno', aliases: ['giorno', 'data', 'date'], requiredColumn: true, description: "Data dell'operazione (gg/mm/aaaa o formato data)" },
  { key: 'account', label: 'Conto', aliases: ['conto', 'account', 'contoorigine', 'contodiorigine'], requiredColumn: true, description: 'Conto associato (per le transazioni: conto di origine)' },
  { key: 'category', label: 'Categoria', aliases: ['categoria', 'category'], requiredColumn: true, description: 'Categoria principale' },
  { key: 'subcategory', label: 'Sotto-categoria', aliases: ['sottocategoria', 'subcategory', 'sottocat'], requiredColumn: true, description: 'Classificazione secondaria' },
  { key: 'description', label: 'Descrizione', aliases: ['descrizione', 'description', 'note'], requiredColumn: true, description: "Descrizione dell'operazione" },
  { key: 'amount', label: 'Importo', aliases: ['importo', 'amount', 'valore'], requiredColumn: true, description: 'Valore monetario (positivo)' },
  { key: 'currency', label: 'Valuta', aliases: ['valuta', 'currency', 'divisa'], requiredColumn: true, description: 'Codice ISO (EUR, USD…) o simbolo (€, $)' },
  { key: 'id', label: 'ID', aliases: ['id', 'idoperazione', 'codice'], requiredColumn: false, description: 'Facoltativo: identificativo stabile, consigliato per aggiornamenti senza duplicati' },
]

export const SHEET_SCHEMAS: Record<SheetName, FieldDef[]> = {
  Entrate: [
    ...common,
    { key: 'incomeSource', label: 'Fonte', aliases: ['fonte', 'fonteentrata', 'fontedellentrata', 'source'], requiredColumn: false, description: "Fonte dell'entrata (es. datore di lavoro)" },
    { key: 'recurrence', label: 'Ricorrenza', aliases: ['ricorrenza', 'recurrence', 'frequenza'], requiredColumn: false, description: 'Es. Mensile, Annuale, Una tantum' },
  ],
  Uscite: [
    ...common,
    { key: 'expenseType', label: 'Tipologia', aliases: ['tipologia', 'tipologiadispesa', 'tipospesa', 'tipo', 'type'], requiredColumn: true, description: 'Necessaria, Aggiuntiva o Investimento' },
  ],
  Transazioni: [
    ...common.map((f) =>
      f.key === 'category' || f.key === 'subcategory' ? { ...f, requiredColumn: false } : f,
    ),
    { key: 'toAccount', label: 'Conto destinazione', aliases: ['contodestinazione', 'contodidestinazione', 'destinazione', 'versoconto'], requiredColumn: true, description: 'Conto che riceve il trasferimento' },
    { key: 'toCurrency', label: 'Valuta destinazione', aliases: ['valutadestinazione', 'valutadidestinazione'], requiredColumn: false, description: 'Se diversa dalla valuta di origine' },
    { key: 'toAmount', label: 'Importo convertito', aliases: ['importoconvertito', 'importodestinazione', 'importoaccreditato'], requiredColumn: false, description: 'Importo accreditato in valuta di destinazione' },
  ],
  Conti: [
    { key: 'name', label: 'Conto', aliases: ['conto', 'nome', 'account'], requiredColumn: true, description: 'Nome del conto (uguale a quello usato negli altri fogli)' },
    { key: 'type', label: 'Tipo', aliases: ['tipo', 'tipologia', 'type'], requiredColumn: false, description: 'Liquidità (conto, carta, contanti…) o Investimento (broker, ETF, crypto…)' },
    { key: 'currency', label: 'Valuta', aliases: ['valuta', 'currency'], requiredColumn: false, description: 'Valuta del conto' },
    { key: 'openingBalance', label: 'Saldo iniziale', aliases: ['saldoiniziale', 'saldo', 'saldodipartenza'], requiredColumn: false, description: 'Saldo prima della prima operazione registrata' },
    { key: 'marketValue', label: 'Valore di mercato', aliases: ['valoredimercato', 'valoreattuale', 'valoremercato'], requiredColumn: false, description: 'Solo investimenti: valore corrente' },
  ],
  Valute: [
    { key: 'currency', label: 'Valuta', aliases: ['valuta', 'currency'], requiredColumn: true, description: 'Codice ISO' },
    { key: 'rate', label: 'Tasso', aliases: ['tasso', 'cambio', 'rate', 'tassoverso'], requiredColumn: true, description: '1 unità di questa valuta = N unità di valuta base' },
  ],
}

export const OPERATION_SHEETS = ['Entrate', 'Uscite', 'Transazioni'] as const
export const OPTIONAL_SHEETS = ['Conti', 'Valute'] as const
export const ALL_SHEETS: SheetName[] = [...OPERATION_SHEETS, ...OPTIONAL_SHEETS]
