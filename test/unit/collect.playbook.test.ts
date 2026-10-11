import { describe, expect, it } from 'vitest'
import {
  isModuleMatch,
  playbookSections,
  type PlaybookView,
} from '../../src/core/reporting/collect/playbook'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource, reportOptions } from './helpers/reporting/snapshot'

const view: PlaybookView = {
  modules: [
    {
      id: 'm1',
      key: 'src/alpha',
      strikes: 1,
      rounds: [
        { class: null, round: 2 },
        { class: 'validation', round: 1 },
      ],
    },
  ],
  designs: [
    {
      id: 'd1',
      moduleKey: 'src/alpha',
      redesignLane: 'C-M113-4',
      failureClass: 'Checks raced',
      outcome: 'remains',
      at: 4000,
      dateIso: '1970-01-01T00:00:04.000Z',
    },
  ],
  drills: [
    {
      commit: 'abc123',
      moduleId: 'm1',
      scope: 'commit',
      result: 'pass',
      at: 5000,
      dateIso: '1970-01-01T00:00:05.000Z',
    },
  ],
  disabledRules: [
    {
      rule: 'loudFailures',
      actor: 'lead',
      reason: 'Too noisy',
      at: 6000,
      dateIso: '1970-01-01T00:00:06.000Z',
    },
  ],
  refusals: [
    {
      code: 'lineageRequired',
      module: 'src/alpha',
      actor: 'rev',
      reason: 'Around the gate',
      at: 8000,
      dateIso: '1970-01-01T00:00:08.000Z',
    },
  ],
}

describe('playbook sections', () => {
  it('builds the five D93.4 sections with stable columns', () => {
    const sections = playbookSections(view, reportOptions('playbook'))
    expect(sections.map((section) => [section.id, section.label])).toEqual([
      ['playbook/totals', 'totals'],
      ['playbook/decisions', 'decisions'],
      ['playbook/drills', 'drills'],
      ['playbook/disabledRules', 'disabledRules'],
      ['playbook/refusals', 'refusals'],
    ])
    const totals = sections[0]!
    expect(totals.columns.map((column) => column.key)).toEqual([
      'module',
      'class',
      'strikes',
      'rounds',
    ])
    expect(totals.rows.map((row) => row.cells)).toEqual([
      {
        module: { type: 'text', value: 'src/alpha' },
        class: { type: 'text', value: 'all' },
        strikes: { type: 'count', value: 1 },
        rounds: { type: 'count', value: 2 },
      },
      {
        module: { type: 'text', value: 'src/alpha' },
        class: { type: 'text', value: 'validation' },
        strikes: { type: 'count', value: 1 },
        rounds: { type: 'count', value: 1 },
      },
    ])
    expect(totals.omittedRows).toBe(0)
  })

  it('filters by module glob and milestone without dropping workspace rows', () => {
    const moduleOptions = reportOptions('playbook', { module: 'src/beta/**' })
    const filtered = playbookSections(view, moduleOptions)
    expect(filtered.find((section) => section.id === 'playbook/totals')!.rows).toHaveLength(0)
    // Workspace-wide disabled rules stay: the switch is off for every module.
    expect(filtered.find((section) => section.id === 'playbook/disabledRules')!.rows).toHaveLength(
      1,
    )
    const milestoneOptions = reportOptions('playbook', { milestone: 'M113' })
    const byMilestone = playbookSections(view, milestoneOptions)
    // The redesign lane names the milestone; the module key does not.
    expect(byMilestone.find((section) => section.id === 'playbook/decisions')!.rows).toHaveLength(1)
    expect(byMilestone.find((section) => section.id === 'playbook/totals')!.rows).toHaveLength(0)
  })

  it('keeps out-of-range stamps visible as numbers, never guessed dates', () => {
    const outOfRange: PlaybookView = {
      ...view,
      designs: [{ ...view.designs[0]!, at: 9_000_000_000_000_000, dateIso: undefined }],
    }
    const sections = playbookSections(outOfRange, reportOptions('playbook'))
    const decision = sections[1]!.rows[0]!.cells['date']
    expect(decision).toEqual({ type: 'text', value: '9000000000000000' })
  })

  it('forwards through the collector with status columns and placeholders', () => {
    const options = reportOptions('playbook')
    const snapshot = fullSnapshot()
    const report = collectFixture(
      'playbook',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          playbook: availableSource('playbook', playbookSections(view, options)),
        },
      },
    )
    const totals = getSection(report, 'playbook/totals')
    expect(totals.columns.map((column) => column.key)).toEqual([
      'module',
      'class',
      'strikes',
      'rounds',
      'status',
      'reason',
    ])
    expect(totals.rows[0]!.cells['status']).toEqual({ type: 'label', value: 'ok' })
    expect(totals.rows[0]!.sourceIds).toEqual(['playbook'])
    // A missing heading stays visible as an empty section, never dropped.
    const withoutRefusals = playbookSections(view, options).filter(
      (section) => section.id !== 'playbook/refusals',
    )
    const forwarded = collectFixture(
      'playbook',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          playbook: availableSource('playbook', withoutRefusals),
        },
      },
    )
    const placeholder = getSection(forwarded, 'playbook/refusals')
    // The missing heading stays visible with its unavailable-source row.
    expect(placeholder.rows).toHaveLength(1)
    expect(placeholder.rows[0]!.cells['status']).toEqual({ type: 'label', value: 'unavailable' })
    expect(forwarded.sources.some((source) => source.id === 'playbook/refusals')).toBe(true)
  })
})

describe('module glob matching', () => {
  it.each([
    ['src/alpha', 'src/alpha', true],
    ['src/alpha', 'src/*', true],
    ['src/alpha/deep', 'src/*', false],
    ['src/alpha/deep', 'src/**', true],
    ['src/alpha', '**', true],
    ['src/alpha/index.ts', 'src/*.ts', false],
    ['src/alpha/index.ts', 'src/**/*.ts', true],
    [String.raw`src\alpha`, 'src/alpha', true],
    ['src/alpha', 'src/beta/**', false],
  ])('matches %s against %s as %s', (key, glob, expected) => {
    expect(isModuleMatch(key, glob)).toBe(expected)
  })
})
