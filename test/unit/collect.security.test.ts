import { describe, expect, it } from 'vitest'
import { codeUnitCompare } from '../../src/core/reporting/sources/local'
import {
  collectFixture,
  fullSnapshot,
  getSection,
  noSources,
  availableSource,
} from './helpers/reporting/kindFixtures'
import type { SecurityFacts } from '../../src/core/reporting/sources/types'

function collectWithSecurity(overrides: Partial<SecurityFacts>) {
  const snapshot = fullSnapshot()
  return collectFixture(
    'security',
    {},
    {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        security: availableSource('security', {
          ...snapshot.sources.security.data!,
          ...overrides,
        }),
      },
    },
  )
}

describe('security collector', () => {
  it('renders vault aggregates and the developer audit without any value', () => {
    const report = collectFixture('security')
    // Rows sort by stable key, not by facet: compare as a set.
    const vaultRows = getSection(report, 'security/vault').rows
    const vaultKind = (name: string) =>
      vaultRows.find((row) => (row.cells['name'] as { value: string }).value === name)!.cells[
        'kind'
      ]
    expect(
      vaultRows
        .map((row) => (row.cells['name'] as { value: string }).value)
        .toSorted(codeUnitCompare),
    ).toEqual(['items', 'state', 'tier'])
    expect(vaultKind('state')).toEqual({ type: 'text', value: 'unlocked' })
    expect(vaultKind('tier')).toEqual({ type: 'text', value: 'osStore' })
    expect(vaultKind('items')).toEqual({ type: 'text', value: '2' })
    // Rows sort by stable key: compare as a set.
    expect(
      getSection(report, 'security/breakdown')
        .rows.map((row) => (row.cells['kind'] as { value: string }).value)
        .toSorted(codeUnitCompare),
    ).toEqual(['apiKey', 'password'])
    for (const row of getSection(report, 'security/breakdown').rows)
      expect(row.cells['count']).toEqual({ type: 'count', value: 1 })
    expect(getSection(report, 'security/grants').rows[0]!.cells).toMatchObject({
      kind: { type: 'text', value: 'named/named' },
      count: { type: 'count', value: 1 },
    })
    const usage = getSection(report, 'security/usage')
      .rows.map(
        (row) =>
          [
            (row.cells['kind'] as { value: string }).value,
            (row.cells['outcome'] as { value: string }).value,
            (row.cells['count'] as { value: number }).value,
          ] as const,
      )
      .toSorted((left, right) => codeUnitCompare(left[0], right[0]))
    // The Outcome column carries the audit outcome, never the authority
    // (RVCM1133): the allow rows split by outcome instead of collapsing.
    expect(usage).toEqual([
      ['environment', 'succeeded', 1],
      ['ssh', 'locked', 1],
    ])
    expect(getSection(report, 'security/denials').rows[0]!.cells).toMatchObject({
      kind: { type: 'text', value: 'environment' },
      outcome: { type: 'text', value: 'denied' },
      count: { type: 'count', value: 1 },
    })
    // A locked outcome is a lock even when its decision allowed the attempt.
    expect(getSection(report, 'security/locks').rows[0]!.cells).toMatchObject({
      kind: { type: 'text', value: 'ssh' },
      outcome: { type: 'text', value: 'locked' },
      count: { type: 'count', value: 1 },
    })
    expect(
      getSection(report, 'security/developerAudit')
        .rows.map((row) => (row.cells['name'] as { value: string }).value)
        .toSorted(codeUnitCompare),
    ).toEqual(['enable', 'unlock'])
    for (const row of getSection(report, 'security/developerAudit').rows) {
      expect(row.cells['count']).toEqual({ type: 'count', value: 1 })
      expect(row.cells['kind']).toEqual({
        type: 'text',
        value: (row.cells['name'] as { value: string }).value === 'enable' ? 'page' : 'palette',
      })
    }
  })

  it('leaves the vault facets empty but present when the vault is locked', () => {
    const report = collectWithSecurity({ vault: null, audit: [] })
    for (const id of [
      'security/vault',
      'security/breakdown',
      'security/grants',
      'security/usage',
      'security/denials',
      'security/locks',
    ]) {
      expect(getSection(report, id).rows).toEqual([])
    }
    expect(getSection(report, 'security/developerAudit').rows).toHaveLength(2)
  })

  it('names the audits unavailable with their reason instead of empty sections', () => {
    const report = collectFixture('security', {}, noSources())
    const sections = report.sections.filter((entry) => entry.id !== 'planFormat')
    for (const section of sections) {
      expect(section.rows[0]!.cells['status']).toEqual({ type: 'label', value: 'unavailable' })
      expect(section.rows[0]!.sourceIds).toEqual(['security'])
    }
  })

  it('collects the same rows regardless of audit order', () => {
    const snapshot = fullSnapshot()
    const facts = snapshot.sources.security.data!
    const reordered = collectFixture(
      'security',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          security: availableSource('security', {
            ...facts,
            audit: facts.audit.toReversed(),
            developerAudit: facts.developerAudit.toReversed(),
          }),
        },
      },
    )
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(collectFixture('security')))
  })
})
