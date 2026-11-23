import Papa from 'papaparse'
import { strFromU8, unzipSync } from 'fflate'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseLedgerRows, parseStatementRows, type FileIssue, type StatementProvider } from '../domain/reconciliation'
import { extractPayrollRecord, type PayrollExtraction } from '../domain/payroll'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_FILE_SIZE = 20 * 1024 * 1024

export interface LocalFileResult<T> {
  fileName: string
  records: T[]
  issues: FileIssue[]
}

function assertFileSize(file: File) {
  if (file.size > MAX_FILE_SIZE) throw new Error('Il file supera il limite locale di 20 MB.')
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function parseCsv(text: string): { rows: unknown[][]; issues: FileIssue[] } {
  const parsed = Papa.parse<string[]>(text, {
    delimiter: '',
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
  })
  const issues = parsed.errors.map((error) => ({
    severity: 'warning' as const,
    row: error.row === undefined ? undefined : error.row + 1,
    code: 'csv_parse_warning',
    message: `Riga CSV da verificare: ${error.message}`,
  }))
  return { rows: parsed.data, issues }
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    result[match[1]] = decodeXml(match[2])
  }
  return result
}

function elements(source: string, name: string): RegExpMatchArray[] {
  const tag = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...source.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>|<${tag}\\b([^>]*)\\/>`, 'g'))]
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? ''
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function parseWorksheetXml(xml: string, sharedStrings: string[]): unknown[][] {
  const rows: unknown[][] = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: unknown[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = attributes(cellMatch[1] ?? cellMatch[3] ?? '')
      const body = cellMatch[2] ?? ''
      const index = columnIndex(attrs.r ?? '')
      if (index < 0) continue
      let value = ''
      if (attrs.t === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('')
      } else {
        const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
        value = attrs.t === 's' ? sharedStrings[Number(rawValue)] ?? '' : decodeXml(rawValue)
      }
      row[index] = value
    }
    if (row.some((cell) => cell !== undefined && String(cell).trim())) rows.push(row)
  }
  return rows
}

function parseXlsx(bytes: Uint8Array): unknown[][] {
  const archive = unzipSync(bytes)
  const getXml = (name: string) => {
    const content = archive[name]
    if (!content) throw new Error(`Il file XLSX non contiene ${name}.`)
    return strFromU8(content)
  }
  const workbookXml = getXml('xl/workbook.xml')
  const relsXml = getXml('xl/_rels/workbook.xml.rels')
  const firstSheet = elements(workbookXml, 'sheet')[0]
  const relationId = firstSheet ? attributes(firstSheet[1]).id ?? attributes(firstSheet[1])['r:id'] : undefined
  const relationship = elements(relsXml, 'Relationship').find((match) => attributes(match[1] ?? match[3] ?? '').Id === relationId)
  const target = relationship ? attributes(relationship[1] ?? relationship[3] ?? '').Target : undefined
  if (!target) throw new Error('Non è stato possibile individuare il primo foglio del file XLSX.')

  const sheetPath = `xl/${target.replace(/^\/+/, '').replace(/^xl\//, '')}`
  const sharedStrings = archive['xl/sharedStrings.xml']
    ? elements(strFromU8(archive['xl/sharedStrings.xml']), 'si').map((match) =>
        [...match[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join(''),
      )
    : []
  return parseWorksheetXml(getXml(sheetPath), sharedStrings)
}

async function readTable(file: File): Promise<{ rows: unknown[][]; issues: FileIssue[] }> {
  assertFileSize(file)
  const extension = file.name.split('.').pop()?.toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    return parseCsv(decodeText(bytes))
  }
  if (extension === 'xlsx') return { rows: parseXlsx(bytes), issues: [] }
  throw new Error('Formato non supportato. Carica un CSV o un file XLSX.')
}

function detectProvider(rows: unknown[][], fileName: string): StatementProvider | null {
  const header = rows.find((row) => row.some((cell) => String(cell ?? '').trim()))
  if (!header) return null
  const normalized = new Set(header.map((cell) => String(cell ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')))
  if (normalized.has('transactionid') && normalized.has('accounttype')) return 'trade-republic'
  if (normalized.has('datadicompletamento') && normalized.has('prodotto')) return 'revolut'
  if (normalized.has('entrate') && normalized.has('uscite') && normalized.has('saldo')) return 'revolut-savings'
  if (normalized.has('disponibilitadopolatransazione') || normalized.has('stato') && normalized.has('nome') && normalized.has('importo')) return 'satispay'
  const name = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (name.includes('revolut') && normalized.has('data') && normalized.has('descrizione') && normalized.has('entrate')) return 'revolut-savings'
  return null
}

export async function readLedgerFile(file: File): Promise<LocalFileResult<ReturnType<typeof parseLedgerRows>['records'][number]>> {
  const { rows, issues: parseIssues } = await readTable(file)
  const parsed = parseLedgerRows(rows)
  return { fileName: file.name, records: parsed.records, issues: [...parseIssues, ...parsed.issues] }
}

export async function readStatementFile(
  file: File,
  accountOverride?: string,
): Promise<LocalFileResult<ReturnType<typeof parseStatementRows>['records'][number]>> {
  const { rows, issues: parseIssues } = await readTable(file)
  const provider = detectProvider(rows, file.name)
  if (!provider) {
    return {
      fileName: file.name,
      records: [],
      issues: [...parseIssues, { severity: 'error', code: 'unsupported_format', message: `Formato di estratto non riconosciuto: ${file.name}.` }],
    }
  }
  const parsed = parseStatementRows(rows, provider, file.name, accountOverride)
  return { fileName: file.name, records: parsed.records, issues: [...parseIssues, ...parsed.issues] }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function readPayrollPdf(file: File): Promise<PayrollExtraction> {
  assertFileSize(file)
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Carica un cedolino in formato PDF.')
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const lines: { y: number; x: number; text: string }[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageItems = content.items.filter((item) => 'str' in item && item.str.trim())
    const groups: { y: number; items: { x: number; text: string }[] }[] = []
    for (const item of pageItems) {
      if (!('str' in item)) continue
      const x = item.transform[4]
      const y = item.transform[5]
      let group = groups.find((candidate) => Math.abs(candidate.y - y) < 2)
      if (!group) groups.push((group = { y, items: [] }))
      group.items.push({ x, text: item.str })
    }
    for (const group of groups) {
      group.items.sort((a, b) => a.x - b.x)
      lines.push({ y: group.y, x: group.items[0]?.x ?? 0, text: group.items.map((item) => item.text).join(' ').trim() })
    }
  }
  lines.sort((a, b) => b.y - a.y || a.x - b.x)
  return extractPayrollRecord(file.name, lines.map((line) => line.text), await sha256(file))
}
