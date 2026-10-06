import { createHash } from 'node:crypto'
import {
  reportDocumentSchema,
  type ReportDocument,
  type ReportSection,
} from '../../../shared/reportSchema'
import { reportScrubber, type ReportRedaction } from './redaction'
import { reportTimestamp } from './timestamp'

/** Code-unit comparison, independent of the OS and installed language. */
function compare(a: string, b: string): number {
  return Number(a > b) - Number(a < b)
}

function orderedSection(section: ReportSection): ReportSection {
  return {
    ...section,
    rows: section.rows
      .toSorted((a, b) => compare(a.key, b.key))
      .map((row) => ({
        key: row.key,
        cells: Object.fromEntries(Object.entries(row.cells).toSorted(([a], [b]) => compare(a, b))),
        sourceIds: row.sourceIds.toSorted(compare),
      })),
  }
}

/** Zod establishes schema field order; dynamic cell keys and fact lists sort explicitly. */
function ordered(document: unknown): ReportDocument {
  const validation = reportDocumentSchema.safeParse(document)
  if (!validation.success) throw new Error('Invalid report document')
  const parsed = validation.data
  return {
    ...parsed,
    needsYou: orderedSection(parsed.needsYou),
    sections: parsed.sections.map((section) => orderedSection(section)),
    sources: parsed.sources.toSorted((a, b) => compare(a.id, b.id)),
  }
}

function bytes(document: unknown): string {
  return `${JSON.stringify(document, undefined, 2)}\n`
}

/** Only the exact structural hash path is omitted; source strings get no exemption. */
function scrubCanonical(document: ReportDocument, options: ReportRedaction): ReportDocument {
  const { contentHash, ...header } = document.header
  let clean: unknown
  try {
    clean = JSON.parse(reportScrubber(options)(bytes({ ...document, header })))
  } catch {
    throw new Error('Invalid scrubbed report')
  }
  if (typeof clean !== 'object' || clean === null) throw new Error('Invalid scrubbed report')
  const cleanHeader: unknown = Reflect.get(clean, 'header')
  if (typeof cleanHeader !== 'object' || cleanHeader === null)
    throw new Error('Invalid scrubbed report header')
  return ordered({ ...clean, header: { ...cleanHeader, contentHash } })
}

function hash(document: ReportDocument): string {
  const { asOf: _asOf, contentHash: _contentHash, ...header } = document.header
  return createHash('sha256')
    .update(bytes({ ...document, header }))
    .digest('hex')
}

function timestampsAtReportOffset(document: ReportDocument): ReportDocument {
  const sectionTimes = (section: ReportSection): ReportSection => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [
          key,
          cell.type === 'timestamp'
            ? { ...cell, value: reportTimestamp(cell.value, document.header.asOf) }
            : cell,
        ]),
      ),
    })),
  })
  return {
    ...document,
    needsYou: sectionTimes(document.needsYou),
    sections: document.sections.map((section) => sectionTimes(section)),
    sources: document.sources.map((source) => ({
      ...source,
      observedAt:
        source.observedAt === null
          ? null
          : reportTimestamp(source.observedAt, document.header.asOf),
    })),
  }
}

/** Finalize K's document after the snapshot scrub; no clock or environment is read. */
export function finalizeReport(
  document: ReportDocument,
  options: ReportRedaction = {},
): ReportDocument {
  const clean = scrubCanonical(ordered(timestampsAtReportOffset(ordered(document))), options)
  return { ...clean, header: { ...clean.header, contentHash: hash(clean) } }
}

/** Saved JSON must validate AND match its scrubbed canonical content. Fail without quoting it. */
export function verifyReport(input: unknown, options: ReportRedaction = {}): ReportDocument {
  const document = ordered(input)
  const clean = scrubCanonical(document, options)
  if (hash(clean) !== document.header.contentHash || bytes(clean) !== bytes(document)) {
    throw new Error('Report content hash or redaction mismatch')
  }
  return clean
}

/** Canonical report-v1, schema order, two spaces, LF, one final newline. */
export function canonicalReportJson(
  document: ReportDocument,
  options: ReportRedaction = {},
): string {
  return bytes(verifyReport(document, options))
}

/** Scrub the JSON syntax before putting back only verified /header/contentHash. */
export function scrubReportOutput(output: string, options: ReportRedaction): string {
  return reportScrubber(options)(output)
}
