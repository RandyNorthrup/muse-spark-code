import { createHash } from 'node:crypto'
import {
  REPORT_ID_PATTERN,
  REPORT_MAX_ID_CHARS,
  REPORT_SECTION_ROWS,
  REPORT_MAX_ROWS,
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
The one row-identity guarantee every collected row passes through. The
first row with a key keeps the bare key, so saved reports, links and ids
for unique rows never change; each later row sharing a key in source order
takes a `key/2`, `key/3`, … suffix reserved against all original keys.
No collector — present or later — can fail validation through a duplicate key, whatever
plan, journal, git, GitHub or store data repeats (RVCM1132E findings 1–2).
*/
function uniqueRowKeys(original: Set<string>): (wanted: string) => string {
  const used = new Set<string>()
  const ordinals = new Map<string, number>()
  // The schema reserves no usable character for generated keys. A fixed stem
  // leaves room for any safe ordinal; counters belong to stems so long keys
  // that truncate alike cannot rescan each other's candidates either.
  const room = REPORT_MAX_ID_CHARS - 1 - String(Number.MAX_SAFE_INTEGER).length
  return (wanted) => {
    if (!used.has(wanted)) {
      used.add(wanted)
      return wanted
    }
    const stem = wanted.slice(0, room)
    let ordinal = ordinals.get(stem) ?? 2
    for (;;) {
      const candidate = `${stem}/${String(ordinal)}`
      ordinal += 1
      if (original.has(candidate) || used.has(candidate)) continue
      ordinals.set(stem, ordinal)
      used.add(candidate)
      return candidate
    }
  }
}

export function dedupeRowKeys(rows: readonly ReportRow[]): ReportRow[] {
  const unique = uniqueRowKeys(new Set(rows.map((entry) => entry.key)))
  return rows.map((entry) => {
    const kept = unique(entry.key)
    return kept === entry.key ? entry : { ...entry, key: kept }
  })
}

/**
Admission before validation for forwarded source sections: keep the
first rows and count the omitted, so a section past the row limit still
reaches the schema intact and the collector discloses the gap instead of
throwing it away (RVREPORTJOIN P2-4). Only array `rows` are touched; the
schema still validates everything it receives strictly.
*/
function forwardedRows(value: unknown): readonly unknown[] | undefined {
  if (typeof value !== 'object' || value === null || !('rows' in value)) return undefined
  const rows: unknown = value.rows
  return Array.isArray(rows) ? rows : undefined
}

export function admitForwardedSection(value: unknown): { section: unknown; omittedRows: number } {
  if (typeof value !== 'object' || value === null) return { section: value, omittedRows: 0 }
  const rows = forwardedRows(value)
  if (rows === undefined || rows.length <= REPORT_MAX_ROWS)
    return { section: value, omittedRows: 0 }
  return {
    section: { ...value, rows: rows.slice(0, REPORT_MAX_ROWS) },
    omittedRows: rows.length - REPORT_MAX_ROWS,
  }
}

/** Blind pre-parse pass for forwarded source sections, whose rows have not
been validated yet; only string `key` fields of array `rows` are touched. */
export function dedupeUnknownRowKeys(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((section) => dedupeUnknownSection(section))
    : dedupeUnknownSection(value)
}

function dedupeUnknownSection(section: unknown): unknown {
  if (
    typeof section !== 'object' ||
    section === null ||
    !('rows' in section) ||
    !Array.isArray(section.rows)
  )
    return section
  const entries: readonly unknown[] = section.rows
  const unique = uniqueRowKeys(new Set(entries.filter(hasRowKey).map((row) => row.key)))
  const rows = entries.map((row) => {
    if (!hasRowKey(row)) return row
    const kept = unique(row.key)
    return kept === row.key ? row : { ...row, key: kept }
  })
  return { ...section, rows }
}

function hasRowKey(value: unknown): value is object & { key: string } {
  return (
    typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string'
  )
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

/** D218: a built row as a report item. Label cells read from the closed enum
(a failed cell fails the row; needs-you, open or blocked calls it the
person's); every other label — waiting, stale, skipped, and every absence
(unavailable, unknown, partial) — flags nothing, so unknown never reads as
failure. The playbook kind renders its closed status enums as text, so the
two status columns read exactly: a failed drill result fails the row, and an
unresolved design outcome calls it the person's. */
export function playbookRowReportFlags(reportRow: ReportRow): {
  readonly needsUser: boolean
  readonly failing: boolean
} {
  let hasNeedsUser = false
  let isFailing = false
  for (const [column, cell] of Object.entries(reportRow.cells)) {
    if (cell.type === 'label') {
      if (cell.value === 'failed') isFailing = true
      else if (['needsYou', 'open', 'blocked'].includes(cell.value)) hasNeedsUser = true
      continue
    }
    if (cell.type !== 'text') continue
    if (column === 'result' && cell.value === 'fail') isFailing = true
    else if (column === 'outcome' && cell.value !== 'impossible') hasNeedsUser = true
  }
  return { needsUser: hasNeedsUser, failing: isFailing }
}

export function section(
  id: string,
  heading: ReportLabelKey,
  columns: readonly (ReportLabelKey | ReportSection['columns'][number])[],
  rows: readonly ReportRow[],
  options: Pick<ReportOptions, 'full'>,
): ReportSection {
  // Canonicalize ties before assigning duplicate suffixes, so identity stays
  // attached to the same fact when a reader returns its records in a new order.
  const ordered = dedupeRowKeys(
    rows.toSorted(
      (left, right) =>
        compare(left.key, right.key) || compare(JSON.stringify(left), JSON.stringify(right)),
    ),
  ).toSorted((left, right) => compare(left.key, right.key))
  const admitted: ReportRow[] = []
  const limit = options.full ? REPORT_MAX_ROWS : REPORT_SECTION_ROWS
  let omittedRows = 0
  // Admission includes the source disclosure rows. Neither a combined facet
  // nor --full can add one beyond the final document's unchanged schema cap.
  for (const entry of ordered) {
    if (admitted.length >= limit) omittedRows += 1
    else admitted.push(entry)
  }
  return {
    id,
    label: heading,
    sortKey: 'key',
    columns: columns.map((column) =>
      typeof column === 'string' ? { key: column, label: column } : column,
    ),
    rows: admitted,
    omittedRows,
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
