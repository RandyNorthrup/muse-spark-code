import { createHash } from 'node:crypto'
import {
  REPORT_DIFF_KEY_DIGEST_HALF,
  REPORT_MAX_ROWS,
  REPORT_SECTION_ROWS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  reportDiffSchema,
  reportDocumentSchema,
  reportSectionSchema,
  type ReportDocument,
  type ReportRow,
  type ReportSection,
  type ReportValue,
} from '../../shared/reportSchema'

type ReportDiff = ReturnType<typeof reportDiffSchema.parse>

function compareKey(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/** Object order is not a field change; array order (including source references) is. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => compareKey(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Pure comparison of already scrubbed, hash-verified inputs supplied by R/history. */
export function compareReports(before: ReportDocument, after: ReportDocument): ReportDiff {
  const from = reportDocumentSchema.parse(before)
  const to = reportDocumentSchema.parse(after)
  if (from.header.kind !== to.header.kind || from.header.scope !== to.header.scope)
    throw new Error(UI_TEXT.reportUi.generationFailed)
  const left = new Map([from.needsYou, ...from.sections].map((section) => [section.id, section]))
  const right = new Map([to.needsYou, ...to.sections].map((section) => [section.id, section]))
  const ids = [...new Set([...left.keys(), ...right.keys()])].toSorted(compareKey)
  const sections: ReportDiff['sections'] = []
  for (const id of ['needsYou', ...ids.filter((id) => id !== 'needsYou')]) {
    const oldSection = left.get(id)
    const newSection = right.get(id)
    const section = newSection ?? oldSection
    if (section === undefined) continue
    const oldRows = new Map(oldSection?.rows.map((row) => [row.key, row]))
    const newRows = new Map(newSection?.rows.map((row) => [row.key, row]))
    const added: ReportRow[] = []
    const removed: ReportRow[] = []
    const changed: ReportDiff['sections'][number]['changed'] = []
    let unchangedRows = 0
    for (const key of [...new Set([...oldRows.keys(), ...newRows.keys()])].toSorted(compareKey)) {
      const oldRow = oldRows.get(key)
      const newRow = newRows.get(key)
      if (oldRow === undefined && newRow !== undefined) added.push(newRow)
      else if (newRow === undefined && oldRow !== undefined) removed.push(oldRow)
      else if (oldRow !== undefined && newRow !== undefined) {
        if (canonical(oldRow) === canonical(newRow)) unchangedRows += 1
        else changed.push({ key, before: oldRow, after: newRow })
      }
    }
    sections.push({ id, label: section.label, added, removed, changed, unchangedRows })
  }
  return reportDiffSchema.parse({ from: from.header, to: to.header, sections })
}

/** The display sentence stays outside report-v1's untranslated data. Read at render time. */
export function reportDiffNotice(
  diff: ReportDiff,
  noChangeTemplate = UI_TEXT.reportUi.noChange,
): string | undefined {
  const parsed = reportDiffSchema.parse(diff)
  return parsed.from.contentHash === parsed.to.contentHash
    ? fill(noChangeTemplate, { asOf: parsed.from.asOf })
    : undefined
}

/** An ordinary typed section for every renderer; columns retain each field's display type. */
export function reportDiffSection(input: ReportDiff, isFull = false): ReportSection {
  const diff = reportDiffSchema.parse(input)
  const rows: ReportRow[] = []
  const maximum = REPORT_MAX_ROWS
  let total = 0
  const absent: ReportValue = { type: 'label', value: 'notApplicable' }
  const add = (
    section: ReportDiff['sections'][number],
    key: string,
    field: string,
    namespace: 'cell' | 'metadata',
    outcome: 'added' | 'removed' | 'changed' | 'unchanged',
    before: ReportValue,
    after: ReportValue,
  ) => {
    total += 1
    if (rows.length >= maximum) return
    // Split the digest: a bare 64-hex run reads as a key digest to the
    // credential scrub, which would collapse every row key to the same mark.
    const digest = createHash('sha256')
      .update(JSON.stringify([namespace, section.id, key, field]))
      .digest('hex')
    rows.push({
      key: `${digest.slice(0, REPORT_DIFF_KEY_DIGEST_HALF)}-${digest.slice(REPORT_DIFF_KEY_DIGEST_HALF)}`,
      cells: {
        section: { type: 'label', value: section.label },
        row: { type: 'text', value: key },
        field: { type: 'text', value: field },
        outcome: { type: 'label', value: outcome },
        before,
        after,
      },
      sourceIds: [],
    })
  }
  const sections = diff.sections.toSorted((a, b) => compareKey(a.id, b.id))
  for (const section of sections) {
    for (const outcome of ['added', 'removed'] as const) {
      const orderedRows = section[outcome].toSorted((a, b) => compareKey(a.key, b.key))
      for (const row of orderedRows) {
        const cells = Object.entries(row.cells).toSorted(([a], [b]) => compareKey(a, b))
        for (const [field, value] of cells)
          add(
            section,
            row.key,
            field,
            'cell',
            outcome,
            outcome === 'removed' ? value : absent,
            outcome === 'added' ? value : absent,
          )
        if (row.sourceIds.length === 0) continue
        const sources: ReportValue = { type: 'textList', value: row.sourceIds }
        add(
          section,
          row.key,
          'sourceIds',
          'metadata',
          outcome,
          outcome === 'removed' ? sources : absent,
          outcome === 'added' ? sources : absent,
        )
      }
    }
    const changed = section.changed.toSorted((a, b) => compareKey(a.key, b.key))
    for (const row of changed) {
      const fields = [
        ...new Set([...Object.keys(row.before.cells), ...Object.keys(row.after.cells)]),
      ].toSorted(compareKey)
      for (const field of fields) {
        const hasBefore = Object.hasOwn(row.before.cells, field)
        const hasAfter = Object.hasOwn(row.after.cells, field)
        const before = hasBefore ? (row.before.cells[field] ?? absent) : absent
        const after = hasAfter ? (row.after.cells[field] ?? absent) : absent
        if (!hasBefore) add(section, row.key, field, 'cell', 'added', before, after)
        else if (!hasAfter) add(section, row.key, field, 'cell', 'removed', before, after)
        else if (canonical(before) !== canonical(after))
          add(section, row.key, field, 'cell', 'changed', before, after)
      }
      if (canonical(row.before.sourceIds) !== canonical(row.after.sourceIds))
        add(
          section,
          row.key,
          'sourceIds',
          'metadata',
          'changed',
          { type: 'textList', value: row.before.sourceIds },
          { type: 'textList', value: row.after.sourceIds },
        )
    }
    add(
      section,
      section.id,
      'unchangedRows',
      'metadata',
      'unchanged',
      { type: 'count', value: section.unchangedRows },
      { type: 'count', value: section.unchangedRows },
    )
  }
  const ordered = rows.toSorted((a, b) => compareKey(a.key, b.key))
  const visible = isFull ? ordered : ordered.slice(0, REPORT_SECTION_ROWS)
  return reportSectionSchema.parse({
    id: 'diff',
    label: 'diff',
    sortKey: 'key',
    columns: [
      { key: 'section', label: 'scope' },
      { key: 'row', label: 'name' },
      { key: 'field', label: 'name' },
      { key: 'outcome', label: 'outcome' },
      { key: 'before', label: 'removed' },
      { key: 'after', label: 'added' },
    ],
    rows: visible,
    omittedRows: total - visible.length,
  })
}
