import { describe, expect, it } from 'vitest'
import {
  playbookSource,
  type PlaybookReportReader,
} from '../../src/core/reporting/sources/playbook'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'

setUiText(EN, 'en')

const MODULE = { id: 'm1', key: 'src/alpha', files: ['src/alpha/index.ts'], source: 'lane' }
const journal: readonly unknown[] = [
  { kind: 'module', value: { module: MODULE, at: 1000 } },
  {
    kind: 'round',
    value: {
      module: MODULE,
      implementerId: 'dev',
      reviewerId: 'rev',
      implementerSessionId: 's1',
      reviewerSessionId: 's2',
      round: 1,
      phase: 'build',
      findings: [{ id: 'f1', file: 'src/alpha/index.ts', severity: 'P1', class: 'validation' }],
      answers: [{ findingId: 'f1', status: 'fixed' }],
      at: 2000,
    },
  },
  {
    kind: 'design',
    value: {
      id: 'd1',
      module: MODULE,
      failureClass: 'Checks raced private-canary',
      whyPatchesFailed: 'Patches raced',
      structuralChange: 'One atomic claim',
      planLocation: 'PLAN.md',
      redesignLane: 'C-M113-4',
      outcome: 'remains',
      at: 4000,
    },
  },
  {
    kind: 'verification',
    value: {
      workId: 'w1',
      moduleId: 'm1',
      commit: 'abc123',
      hookDigest: 'h1',
      scope: 'commit',
      result: 'pass',
      at: 5000,
    },
  },
  {
    kind: 'settings',
    value: {
      teamId: 't1',
      rules: {
        threeStrikes: { enabled: true },
        onePassReview: { enabled: true },
        contractsFirst: { enabled: true },
        smallFirst: { enabled: true },
        offload: { enabled: true },
        continuousIntegration: { enabled: true },
        breakOnPurpose: { enabled: true },
        loudFailures: { enabled: false, reason: 'Too noisy', actor: 'lead', at: 6000 },
      },
      patchRoundsMax: 2,
    },
  },
  {
    kind: 'note',
    value: {
      rule: 'neverAround',
      code: 'lineageRequired',
      module: 'src/alpha',
      laneId: 'C-M113-4',
      at: 8000,
      needsUser: true,
    },
  },
]

const scrub = (text: string) => text.replaceAll('private-canary', '[redacted]')
const context = (kind: 'playbook' | 'usage' = 'playbook') => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(kind),
  signal: new AbortController().signal,
})
const reader = (records: readonly unknown[]): PlaybookReportReader => ({
  read: () => Promise.resolve({ records, observedAt: REPORT_FIXTURE_AS_OF }),
})
const sectionById = (data: readonly { id: string }[] | null, id: string) => {
  if (data === null) throw new Error('Expected playbook sections')
  const section = data.find((entry) => entry.id === id)
  if (section === undefined) throw new Error(`Missing section ${id}`)
  return section as unknown as {
    rows: { cells: Record<string, { type: string; value: unknown }> }[]
  }
}

describe('playbook source', () => {
  it('builds the five sections from journal records with replayed strikes', async () => {
    const result = await playbookSource(reader(journal), scrub).read(context())
    expect(result.record.status).toBe('ok')
    const totals = sectionById(result.data, 'playbook/totals')
    expect(totals.rows.map((row) => row.cells)).toEqual([
      {
        module: { type: 'text', value: 'src/alpha' },
        class: { type: 'text', value: 'all' },
        strikes: { type: 'count', value: 1 },
        rounds: { type: 'count', value: 1 },
      },
    ])
    const decisions = sectionById(result.data, 'playbook/decisions')
    expect(decisions.rows[0]!.cells).toMatchObject({
      outcome: { type: 'text', value: 'remains' },
      // Secrets never reach a report cell, even inside journal prose.
      date: { type: 'timestamp', value: '1970-01-01T00:00:04.000Z' },
    })
    expect(JSON.stringify(decisions)).not.toContain('private-canary')
    expect(sectionById(result.data, 'playbook/drills').rows[0]!.cells).toMatchObject({
      result: { type: 'text', value: 'pass' },
    })
    expect(
      sectionById(result.data, 'playbook/disabledRules').rows.map((row) => row.cells['rule']),
    ).toEqual([{ type: 'text', value: 'loudFailures' }])
    expect(sectionById(result.data, 'playbook/refusals').rows[0]!.cells).toMatchObject({
      code: { type: 'text', value: 'lineageRequired' },
    })
  })

  it('reads an empty journal as ok with empty sections, never a miss', async () => {
    const result = await playbookSource(reader([]), scrub).read(context())
    expect(result.record.status).toBe('ok')
    for (const id of [
      'playbook/totals',
      'playbook/decisions',
      'playbook/drills',
      'playbook/disabledRules',
      'playbook/refusals',
    ])
      expect(sectionById(result.data, id).rows).toHaveLength(0)
  })

  it('reports malformed lines and inconsistent replays as invalid, never empty success', async () => {
    for (const records of [
      [{ kind: 'module', value: { module: MODULE } }],
      [
        { kind: 'module', value: { module: MODULE, at: 1000 } },
        {
          kind: 'round',
          value: {
            module: { ...MODULE, id: 'unknown' },
            implementerId: 'dev',
            reviewerId: 'rev',
            implementerSessionId: 's1',
            reviewerSessionId: 's2',
            round: 1,
            phase: 'build',
            findings: [],
            answers: [],
            at: 2000,
          },
        },
      ],
    ]) {
      const result = await playbookSource(reader(records), scrub).read(context())
      expect(result.record.status).toBe('unavailable')
      expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.invalid)
      expect(result.data).toBeNull()
    }
  })

  it('stays notApplicable on other kinds and unavailable when unbound', async () => {
    const other = await playbookSource(reader(journal), scrub).read(context('usage'))
    expect(other.record.status).toBe('notApplicable')
    expect(other.data).toBeNull()
    const unbound = await playbookSource(undefined, scrub).read(context())
    expect(unbound.record.status).toBe('unavailable')
    expect(unbound.record.reason).toBe(UI_TEXT.reportSourceReasons.unbound)
  })
})
