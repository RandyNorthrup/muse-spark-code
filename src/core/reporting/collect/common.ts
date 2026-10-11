import { createHash } from 'node:crypto'
import {
  REPORT_ID_PATTERN,
  REPORT_MAX_ID_CHARS,
  REPORT_SECTION_ROWS,
} from '../../../shared/constants'
import type {
  ReportLabelKey,
  ReportOptions,
  ReportRow,
  ReportSection,
  ReportSourceRecord,
  ReportValue,
} from '../../../shared/reportSchema'
import type { ReportSourceKind, ReportSourcePayloads, SourceSnapshot } from '../sources/types'

export const text = (value: string): ReportValue => ({ type: 'text', value })
export const label = (value: ReportLabelKey): ReportValue => ({ type: 'label', value })
export const count = (value: number): ReportValue => ({ type: 'count', value })
export const list = (value: readonly string[]): ReportValue => ({
  type: 'textList',
  value: [...new Set(value)].toSorted(compare),
})

/** Code-unit comparison is independent of the installed language and ICU. */
export function compare(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

// Digest identities, never display positions or prose truncated to fit the id cap.
// Prefixes express the declared priority (Needs you and delivery order).
function digestIdentity(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex')
  const midpoint = digest.length / 2
  // M84 scrubs contiguous hexadecimal key digests; generated ids must survive it.
  return `${digest.slice(0, midpoint)}_${digest.slice(midpoint)}`
}

export function key(prefix: string, ...identity: string[]): string {
  const digest = digestIdentity(JSON.stringify([prefix, ...identity]))
  const namespace =
    !REPORT_ID_PATTERN.test(prefix) ||
    /[a-f0-9]{64}/i.test(prefix) ||
    prefix.length + digest.length + 1 > REPORT_MAX_ID_CHARS
      ? `row-${digestIdentity(prefix)}`
      : prefix
  return `${namespace}/${digest}`
}

export function derivedSourceId(sourceId: string, facet: string): string {
  const id = `${sourceId}/${facet}`
  return id.length > REPORT_MAX_ID_CHARS ? key('source', sourceId, facet) : id
}

/**
 * The one row-identity guarantee every collected row passes through. The
 * first row with a key keeps the bare key, so saved reports, links and ids
 * for unique rows never change; each later row sharing a key in source order
 * takes the first free `key/2`, `key/3`, … suffix. No collector — present or
 * later — can fail document validation through a duplicate row key, whatever
 * plan, journal, git, GitHub or store data repeats (RVCM1132E findings 1–2).
 */
export function uniqueRowKey(wanted: string, used: Set<string>): string {
  if (!used.has(wanted)) {
    used.add(wanted)
    return wanted
  }
  let ordinal = 2
  for (;;) {
    const suffix = `/${String(ordinal)}`
    const room = REPORT_MAX_ID_CHARS - suffix.length
    const candidate = `${wanted.slice(0, Math.max(0, room))}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    ordinal += 1
  }
}

export function dedupeRowKeys(rows: readonly ReportRow[]): ReportRow[] {
  const used = new Set<string>()
  return rows.map((entry) => {
    const kept = uniqueRowKey(entry.key, used)
    return kept === entry.key ? entry : { ...entry, key: kept }
  })
}

/** Blind pre-parse pass for forwarded source sections, whose rows have not
 * been validated yet; only string `key` fields of array `rows` are touched. */
export function dedupeUnknownRowKeys(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((section) => dedupeUnknownSection(section))
    : dedupeUnknownSection(value)
}

function dedupeUnknownSection(section: unknown): unknown {
  if (
    typeof section !== 'object' ||
    section === null ||
    !Array.isArray((section as { readonly rows?: unknown }).rows)
  )
    return section
  const used = new Set<string>()
  const rows = (section as { readonly rows: readonly unknown[] }).rows.map((row) => {
    if (
      typeof row !== 'object' ||
      row === null ||
      typeof (row as { readonly key?: unknown }).key !== 'string'
    )
      return row
    const wanted = (row as { readonly key: string }).key
    const kept = uniqueRowKey(wanted, used)
    return kept === wanted ? row : { ...row, key: kept }
  })
  return { ...section, rows }
}

export function row(
  prefix: string,
  identity: readonly string[],
  cells: Record<string, ReportValue>,
  sourceIds: readonly string[],
): ReportRow {
  return {
    key: key(prefix, ...identity),
    cells,
    sourceIds: [...new Set(sourceIds)].toSorted(compare),
  }
}

export function section(
  id: string,
  heading: ReportLabelKey,
  columns: readonly (ReportLabelKey | ReportSection['columns'][number])[],
  rows: readonly ReportRow[],
  options: ReportOptions,
): ReportSection {
  const ordered = dedupeRowKeys(rows).toSorted((left, right) => compare(left.key, right.key))
  return {
    id,
    label: heading,
    sortKey: 'key',
    columns: columns.map((column) =>
      typeof column === 'string' ? { key: column, label: column } : column,
    ),
    rows: options.full ? ordered : ordered.slice(0, REPORT_SECTION_ROWS),
    omittedRows: options.full ? 0 : Math.max(0, ordered.length - REPORT_SECTION_ROWS),
  }
}

/** Missing sources are visible inside each affected section, even with --full. */
export function sourcedSection(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  id: string,
  heading: ReportLabelKey,
  columns: readonly (ReportLabelKey | ReportSection['columns'][number])[],
  rows: readonly ReportRow[],
  kinds: readonly ReportSourceKind[],
  extraSources: readonly ReportSourceRecord[] = [],
): ReportSection {
  const definitions = columns.map((column) =>
    typeof column === 'string' ? { key: column, label: column } : column,
  )
  for (const field of ['status', 'reason'] as const) {
    if (definitions.every((column) => column.key !== field))
      definitions.push({ key: field, label: field })
  }
  const fields = definitions.map((column) => column.key)
  const completeRows: ReportRow[] = rows.map((entry) => ({
    ...entry,
    cells: { status: label('ok'), reason: text(''), ...entry.cells },
  }))
  for (const source of [...kinds.map((kind) => snapshot.sources[kind].record), ...extraSources]) {
    if (source.status === 'ok') continue
    const cells: Record<string, ReportValue> = Object.fromEntries(
      fields.map((field) => [field, text('')]),
    )
    cells['status'] = label(source.status)
    cells['reason'] = text(source.reason)
    completeRows.push(row('0-source', [source.id], cells, [source.id]))
  }
  return section(id, heading, definitions, completeRows, options)
}

export function unavailableRecord(id: string, reason: string): ReportSourceRecord {
  return {
    id,
    status: 'unavailable',
    reason,
    observedAt: null,
    freshness: { state: 'unknown', ageMs: null },
  }
}

export function normalizeMilestone(id: string): string {
  return id.replace(/^m(?=\d)/i, '').toUpperCase()
}

export function isSameMilestone(left: string, right: string): boolean {
  return normalizeMilestone(left) === normalizeMilestone(right)
}

export function version(value: string): string {
  return value.replace(/^v(?=\d)/, '')
}

export function checkRows(
  records: readonly {
    readonly check: string
    readonly outcome: ReportLabelKey
    readonly durationMs: number
    readonly commit: string
    readonly at: string
  }[],
  sourceId: string,
): ReportRow[] {
  return records.map((run) =>
    row(
      'check',
      [run.check, run.commit, run.at],
      {
        name: text(run.check),
        outcome: label(run.outcome),
        duration: { type: 'durationMs', value: run.durationMs },
        commit: text(run.commit),
        date: { type: 'timestamp', value: run.at },
      },
      [sourceId],
    ),
  )
}

export const CHECK_COLUMNS: readonly ReportLabelKey[] = [
  'name',
  'outcome',
  'duration',
  'commit',
  'date',
]

export function certificationRows(
  records: ReportSourcePayloads['certification']['records'],
  sourceId: string,
): ReportRow[] {
  return records.map((record) =>
    row(
      'record',
      [record.path.replaceAll('\\', '/')],
      {
        milestones: text(record.milestoneId),
        files: text(record.path.replaceAll('\\', '/')),
        count: count(record.checklist.filter((item) => item.done).length),
        totals: count(record.checklist.length),
      },
      [sourceId],
    ),
  )
}
