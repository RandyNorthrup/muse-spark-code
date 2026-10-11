import { describe, expect, it } from 'vitest'
import { REPORT_SECTION_ROWS } from '../../src/shared/constants'
import type { ReportKind, ReportLabelKey } from '../../src/shared/reportSchema'
import {
  collectFixture,
  facet,
  fullSnapshot,
  getSection,
  noSources,
} from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'

const kinds = [
  ['fleet', 'agents'],
  ['security', 'vault'],
  ['accounts', 'accounts'],
  ['estimate', 'criticalPath'],
  ['playbook', 'decisions'],
  ['issues', 'issues'],
  ['schedules', 'timeline'],
  ['keybindings', 'keybindings'],
] as const satisfies readonly [ReportKind, ReportLabelKey][]

describe('injected milestone facets', () => {
  it.each(kinds.map(([kind]) => kind))(
    '%s retains partial-source rows in every supplied empty facet',
    (kind) => {
      const snapshot = fullSnapshot()
      const source = snapshot.sources[kind]
      const data = source.data!
      const reason = 'Editor bindings could not be read'
      const partial = {
        record: { ...source.record, status: 'partial' as const, reason },
        data: data.map((entry) => ({ ...entry, rows: [] })),
      }
      for (const isFull of [false, true]) {
        const report = collectFixture(
          kind,
          { full: isFull },
          {
            ...snapshot,
            sources: { ...snapshot.sources, [kind]: partial },
          },
        )
        for (const entry of partial.data) {
          const section = getSection(report, entry.id)
          expect(section.columns).toContainEqual({ key: 'detail', label: 'name' })
          expect(section.omittedRows).toBe(0)
          expect(section.rows).toEqual([
            expect.objectContaining({
              cells: expect.objectContaining({
                status: { type: 'label', value: 'partial' },
                reason: { type: 'text', value: reason },
              }),
              sourceIds: [kind],
            }),
          ])
        }
      }
    },
  )

  it.each(kinds)(
    '%s retains its typed facet, including column keys and provenance',
    (kind, heading) => {
      const report = collectFixture(kind)
      const section = getSection(report, `${kind}/${heading}`)
      expect(section.columns).toEqual([
        { key: 'detail', label: 'name' },
        { key: 'status', label: 'status' },
        { key: 'reason', label: 'reason' },
      ])
      expect(section.rows).toHaveLength(2)
      expect(section.rows.every((row) => row.sourceIds.includes(kind))).toBe(true)
      expect(
        report.sources.some(
          (source) => source.id.startsWith(`${kind}/`) && source.status === 'unavailable',
        ),
      ).toBe(kind !== 'keybindings')
    },
  )

  it.each(kinds.map(([kind]) => kind))('%s explicitly lists every unavailable facet', (kind) => {
    const report = collectFixture(kind, {}, noSources())
    const sections = report.sections.filter((section) => section.id !== 'planFormat')
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) {
      expect(section.rows[0]!.cells['status']).toEqual({ type: 'label', value: 'unavailable' })
      expect(section.rows[0]!.sourceIds).toEqual([kind])
    }
  })

  it('caps injected editor keybindings and preserves conflicts; --full shows all', () => {
    const snapshot = fullSnapshot()
    const keybindings = availableSource('keybindings', [
      facet('keybindings', 'keybindings', REPORT_SECTION_ROWS + 2),
      facet('keybindings', 'conflicts'),
    ])
    const input = { ...snapshot, sources: { ...snapshot.sources, keybindings } }
    const short = getSection(collectFixture('keybindings', {}, input), 'keybindings/keybindings')
    expect(short.rows).toHaveLength(REPORT_SECTION_ROWS)
    expect(short.omittedRows).toBe(2)
    const full = collectFixture('keybindings', { full: true }, input)
    expect(getSection(full, 'keybindings/keybindings').rows).toHaveLength(REPORT_SECTION_ROWS + 2)
    expect(getSection(full, 'keybindings/conflicts').rows).toHaveLength(2)
    const truncated = keybindings.data!.map((entry, index) =>
      index === 0 ? { ...entry, omittedRows: 1 } : entry,
    )
    expect(() =>
      collectFixture(
        'keybindings',
        { full: true },
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            keybindings: availableSource('keybindings', truncated),
          },
        },
      ),
    ).toThrow('report/incompleteFullSource')
  })

  it('rejects malformed facets and unresolved source references', () => {
    const snapshot = fullSnapshot()
    const bad = facet('keybindings', 'keybindings')
    bad.rows[0]!.sourceIds = ['foreign-source']
    expect(() =>
      collectFixture(
        'keybindings',
        {},
        {
          ...snapshot,
          sources: { ...snapshot.sources, keybindings: availableSource('keybindings', [bad]) },
        },
      ),
    ).toThrow()
    expect(() =>
      collectFixture(
        'fleet',
        {},
        {
          ...snapshot,
          sources: {
            ...snapshot.sources,
            fleet: availableSource('fleet', [
              {
                ...facet('fleet', 'agents'),
                rows: [facet('fleet', 'agents').rows[0]!, facet('fleet', 'agents').rows[0]!],
              },
            ]),
          },
        },
      ),
    ).toThrow()
  })
})
