import { describe, expect, it } from 'vitest'
import { compareReports, reportDiffNotice, reportDiffSection } from '../../src/core/reporting/diff'
import {
  reportDiffSchema,
  reportSectionSchema,
  type ReportValue,
} from '../../src/shared/reportSchema'
import { REPORT_MAX_SECTIONS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { installGerman, restoreEnglish } from './helpers/germanTable'
import { reportDocument, unavailableSource } from './helpers/reporting/snapshot'

describe('report diff', () => {
  it('namespaces metadata identities apart from sourceIds and unchangedRows cells', () => {
    const before = reportDocument('project', [unavailableSource('git').record])
    before.sections[0]!.rows[0]!.sourceIds = []
    const after = structuredClone(before)
    const section = after.sections[0]!
    section.columns.push(
      { key: 'sourceIds', label: 'name' },
      { key: 'unchangedRows', label: 'name' },
    )
    section.rows[0]!.cells['sourceIds'] = { type: 'text', value: 'ordinary cell' }
    section.rows[0]!.cells['unchangedRows'] = { type: 'count', value: 0 }
    section.rows[0]!.sourceIds = ['git']
    section.rows.push({
      key: section.id,
      cells: {
        state: { type: 'label', value: 'planned' },
        sourceIds: { type: 'text', value: 'cell' },
        unchangedRows: { type: 'count', value: 1 },
      },
      sourceIds: [],
    })
    for (const diff of [compareReports(before, after), compareReports(after, before)]) {
      const rendered = reportDiffSection(diff, true)
      expect(new Set(rendered.rows.map((row) => row.key)).size).toBe(rendered.rows.length)
      expect(rendered.rows.filter((row) => row.cells['field']?.value === 'sourceIds')).toHaveLength(
        3,
      )
      expect(
        rendered.rows.filter((row) => row.cells['field']?.value === 'unchangedRows'),
      ).toHaveLength(4)
    }
  })

  it('retains presence changes when a field value is Not applicable', () => {
    const before = reportDocument()
    before.sections[0]!.columns.push({ key: 'retired', label: 'name' })
    before.sections[0]!.rows[0]!.cells['retired'] = { type: 'label', value: 'notApplicable' }
    const after = structuredClone(before)
    after.sections[0]!.columns = [
      { key: 'state', label: 'status' },
      { key: 'newField', label: 'name' },
    ]
    Reflect.deleteProperty(after.sections[0]!.rows[0]!.cells, 'retired')
    after.sections[0]!.rows[0]!.cells['newField'] = { type: 'label', value: 'notApplicable' }
    const section = reportDiffSection(compareReports(before, after), true)
    expect(
      section.rows.find((row) => row.cells['field']?.value === 'retired')?.cells['outcome'],
    ).toEqual({ type: 'label', value: 'removed' })
    expect(
      section.rows.find((row) => row.cells['field']?.value === 'newField')?.cells['outcome'],
    ).toEqual({ type: 'label', value: 'added' })
  })

  it('compares columns named constructor without inherited object values', () => {
    const before = reportDocument()
    const after = structuredClone(before)
    const field: ReportValue = { type: 'text', value: 'Field data' }
    after.sections[0]!.columns.push({ key: 'constructor', label: 'name' })
    Reflect.set(after.sections[0]!.rows[0]!.cells, 'constructor', field)
    const section = reportDiffSection(compareReports(before, after), true)
    expect(
      section.rows.find((row) => row.cells['field']?.value === 'constructor')?.cells,
    ).toMatchObject({
      outcome: { value: 'added' },
      before: { type: 'label', value: 'notApplicable' },
      after: { type: 'text', value: 'Field data' },
    })
    const reversed = reportDiffSection(compareReports(after, before), true)
    expect(
      reversed.rows.find((row) => row.cells['field']?.value === 'constructor')?.cells,
    ).toMatchObject({
      outcome: { value: 'removed' },
      before: { type: 'text', value: 'Field data' },
      after: { type: 'label', value: 'notApplicable' },
    })
  })
  it('lists exactly added, removed, changed and unchanged rows, including Needs you and source fields', () => {
    const before = reportDocument('project', [
      unavailableSource('plan').record,
      unavailableSource('git').record,
    ])
    const after = structuredClone(before)
    before.needsYou.rows.push({
      key: 'owner',
      cells: { detail: { type: 'text', value: 'Question' } },
      sourceIds: [],
    })
    after.sections[0]!.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    after.sections[0]!.rows[0]!.sourceIds = ['git']
    before.sections[0]!.rows.push({
      key: 'removed',
      cells: { state: { type: 'label', value: 'waiting' } },
      sourceIds: [],
    })
    after.sections[0]!.rows.push({
      key: 'added',
      cells: { state: { type: 'label', value: 'complete' } },
      sourceIds: [],
    })
    const unchanged = {
      key: 'same',
      cells: { state: { type: 'label' as const, value: 'built' as const } },
      sourceIds: [],
    }
    before.sections[0]!.rows.push(unchanged)
    after.sections[0]!.rows.push(unchanged)
    after.header.contentHash = 'b'.repeat(64)
    const diff = compareReports(before, after)
    expect(reportDiffSchema.parse(diff)).toEqual(diff)
    expect(diff.sections).toEqual([
      {
        id: 'needsYou',
        label: 'needsYou',
        added: [],
        removed: before.needsYou.rows,
        changed: [],
        unchangedRows: 0,
      },
      {
        id: 'status',
        label: 'status',
        added: [after.sections[0]!.rows[1]],
        removed: [before.sections[0]!.rows[1]],
        changed: [
          { key: 'M12', before: before.sections[0]!.rows[0], after: after.sections[0]!.rows[0] },
        ],
        unchangedRows: 1,
      },
    ])
    const section = reportDiffSection(diff, true)
    expect(reportSectionSchema.parse(section)).toEqual(section)
    expect(
      section.rows
        .filter((row) => row.cells['outcome']?.value === 'changed')
        .map((row) => row.cells['field']?.value)
        .toSorted((a, b) => (String(a) < String(b) ? -1 : 1)),
    ).toEqual(['sourceIds', 'state'])
    expect(
      section.rows.find(
        (row) => row.cells['field']?.value === 'state' && row.cells['row']?.value === 'M12',
      )?.cells,
    ).toMatchObject({
      before: { type: 'label', value: 'planned' },
      after: { type: 'label', value: 'merged' },
    })
    expect(reportDiffNotice(diff)).toBeUndefined()
  })

  it('ignores object insertion order and sorts section and row unions by code unit', () => {
    const before = reportDocument()
    before.sections[0]!.rows.push(
      { key: 'z', cells: { state: { type: 'label', value: 'built' } }, sourceIds: [] },
      { key: 'A', cells: { state: { type: 'label', value: 'built' } }, sourceIds: [] },
    )
    const after = structuredClone(before)
    after.sections[0]!.rows.reverse()
    expect(compareReports(before, after).sections[1]).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      unchangedRows: 3,
    })
    after.sections[0]!.rows = []
    expect(compareReports(before, after).sections[1]!.removed.map((row) => row.key)).toEqual([
      'A',
      'M12',
      'z',
    ])
    const reordered = structuredClone(before)
    reordered.sections[0]!.rows[0] = {
      sourceIds: ['plan'],
      cells: { state: { value: 'planned', type: 'label' } },
      key: 'M12',
    }
    expect(compareReports(before, reordered).sections[1]!.changed).toEqual([])
  })

  it('compares all 65 sections and disjoint section ids without dropping either input', () => {
    const before = reportDocument()
    before.needsYou.rows = [
      { key: 'owner', cells: { detail: { type: 'text', value: 'before' } }, sourceIds: [] },
    ]
    before.sections = Array.from({ length: REPORT_MAX_SECTIONS }, (_, index) => ({
      ...structuredClone(before.sections[0]!),
      id: `section-${String(index)}`,
    }))
    const after = structuredClone(before)
    after.needsYou.rows[0]!.cells['detail'] = { type: 'text', value: 'after' }
    for (const section of after.sections)
      section.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    const changed = compareReports(before, after)
    expect(changed.sections).toHaveLength(65)
    expect(changed.sections.every((section) => section.changed.length === 1)).toBe(true)
    for (const section of after.sections) section.id = `new-${section.id}`
    const union = compareReports(before, after)
    expect(union.sections).toHaveLength(129)
    expect(union.sections.filter((section) => section.added.length === 1)).toHaveLength(64)
    expect(union.sections.filter((section) => section.removed.length === 1)).toHaveLength(64)
    expect(reportDiffSection(union).rows).toHaveLength(10)
    expect(reportDiffSection(union).rows).toEqual(reportDiffSection(union, true).rows.slice(0, 10))
    expect(reportDiffSection(union).omittedRows).toBe(
      reportDiffSection(union, true).rows.length - 10,
    )
  })

  it('says No change since in the currently installed language for the same hash', async () => {
    const before = reportDocument()
    const after = structuredClone(before)
    after.header.asOf = '2026-10-07T12:00:00+00:00'
    const diff = compareReports(before, after)
    expect(reportDiffNotice(diff)).toBe(`No change since ${before.header.asOf}`)
    await installGerman(new FakeLogOutputChannel())
    const noChangeTemplate = UI_TEXT.reportUi.noChange
    try {
      expect(reportDiffNotice(diff)).toBe(
        fill(UI_TEXT.reportUi.noChange, { asOf: before.header.asOf }),
      )
      expect(reportDiffNotice(diff)).not.toMatch(/^No change since/)
    } finally {
      restoreEnglish()
    }
    expect(reportDiffNotice(diff, noChangeTemplate)).toBe(
      fill(noChangeTemplate, { asOf: before.header.asOf }),
    )
    expect(reportDiffNotice(diff)).toBe(`No change since ${before.header.asOf}`)
  })

  it('rejects mismatched kind, scope or invalid document instead of comparing unrelated reports', () => {
    const before = reportDocument()
    expect(() => compareReports(before, reportDocument('usage'))).toThrow()
    const after = structuredClone(before)
    after.header.scope = 'other-workspace'
    expect(() => compareReports(before, after)).toThrow()
    after.header.scope = before.header.scope
    after.sections[0]!.rows.push(after.sections[0]!.rows[0]!)
    expect(() => compareReports(before, after)).toThrow()
  })
})
