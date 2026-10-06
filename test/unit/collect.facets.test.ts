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

const kinds: readonly [ReportKind, ReportLabelKey][] = [
  ['fleet', 'agents'],
  ['security', 'vault'],
  ['accounts', 'accounts'],
  ['estimate', 'criticalPath'],
  ['playbook', 'decisions'],
  ['issues', 'issues'],
  ['schedules', 'timeline'],
  ['keybindings', 'keybindings'],
]

describe('injected milestone facets', () => {
  it.each(kinds)(
    '%s retains its typed facet, including column keys and provenance',
    (kind, heading) => {
      const report = collectFixture(kind)
      const section = getSection(report, `${kind}/${heading}`)
      expect(section.columns).toEqual([{ key: 'detail', label: 'name' }])
      expect(section.rows).toHaveLength(2)
      expect(section.rows.every((row) => row.sourceIds.includes(kind))).toBe(true)
      expect(
        report.sources.some(
          (source) => source.id.startsWith(`${kind}/`) && source.status === 'unavailable',
        ),
      ).toBe(kind !== 'keybindings')
    },
  )

  it.each(kinds)('%s explicitly lists every unavailable facet', (kind) => {
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
