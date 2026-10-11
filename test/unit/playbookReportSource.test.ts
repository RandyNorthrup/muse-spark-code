import { describe, expect, it } from 'vitest'
import {
  playbookSource,
  type PlaybookReportReader,
} from '../../src/core/reporting/sources/playbook'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  playbookJournalFixture,
  playbookModuleFixture,
  sectionById,
} from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'

setUiText(EN, 'en')

const journal = playbookJournalFixture()

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

describe('playbook source', () => {
  it('builds the five sections from journal records with replayed strikes', async () => {
    const result = await playbookSource(reader(journal), scrub).read(context())
    expect(result.record.status).toBe('ok')
    const totals = sectionById(result.data, 'playbook/totals')
    // One aggregate round replayed to one strike; the exact section shape
    // is the collect suite's job, the replayed values are this suite's.
    expect(totals.rows).toHaveLength(1)
    const strikes = totals.rows[0]!.cells
    expect(strikes['module']).toEqual({ type: 'text', value: 'src/alpha' })
    expect(strikes['class']).toEqual({ type: 'label', value: 'all' })
    expect(strikes['strikes']).toEqual({ type: 'count', value: 1 })
    expect(strikes['rounds']).toEqual({ type: 'count', value: 1 })
    const decisions = sectionById(result.data, 'playbook/decisions')
    expect(decisions.rows[0]!.cells).toMatchObject({
      outcome: { type: 'text', value: 'remains' },
      failure: { type: 'text', value: 'Checks raced [redacted]' },
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

  it('lists only true refusals, never admitted commands or fallback reviewers', async () => {
    const records: readonly unknown[] = [
      ...journal,
      {
        kind: 'note',
        value: { rule: 'neverAround', code: 'checksPassed', at: 9000, needsUser: false },
      },
      {
        kind: 'note',
        value: {
          rule: 'neverAround',
          code: 'fallbackReviewer',
          module: 'src/alpha',
          actor: 'lead',
          reason: 'Pre-named fallback',
          at: 9001,
          needsUser: false,
        },
      },
      {
        kind: 'note',
        value: {
          rule: 'neverAround',
          code: 'hookTampering',
          module: 'src/alpha',
          actor: 'lead',
          reason: 'Around the gate',
          at: 9002,
          needsUser: true,
        },
      },
    ]
    const result = await playbookSource(reader(records), scrub).read(context())
    expect(result.record.status).toBe('ok')
    const codes = sectionById(result.data, 'playbook/refusals').rows.map(
      (row) => row.cells['code']?.value,
    )
    // The fixture's safety-rule note and the tampering refusal stay;
    // the admitted command and the applied fallback reviewer never do.
    expect(codes).toContain('lineageRequired')
    expect(codes).toContain('hookTampering')
    expect(codes).not.toContain('checksPassed')
    expect(codes).not.toContain('fallbackReviewer')
  })

  it('dedupes one switched-off rule across snapshots and its note', async () => {
    const settings = journal.find(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        (record as { kind: unknown }).kind === 'settings',
    )
    const records: readonly unknown[] = [
      ...journal,
      settings,
      {
        kind: 'note',
        value: {
          rule: 'loudFailures',
          code: 'ruleDisabled',
          actor: 'lead',
          reason: 'Too noisy',
          at: 6000,
          needsUser: false,
        },
      },
    ]
    const result = await playbookSource(reader(records), scrub).read(context())
    expect(result.record.status).toBe('ok')
    // Two identical snapshots plus the switch-off note are one fact, so a
    // second disabled rule still fits the section instead of drowning.
    expect(sectionById(result.data, 'playbook/disabledRules').rows).toHaveLength(1)
  })

  it('heads the receipts section with what the journal holds', async () => {
    const result = await playbookSource(reader(journal), scrub).read(context())
    expect(sectionById(result.data, 'playbook/drills').label).toBe('hookVerification')
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
    const module = playbookModuleFixture()
    for (const records of [
      [{ kind: 'module', value: { module } }],
      [
        { kind: 'module', value: { module, at: 1000 } },
        {
          kind: 'round',
          value: {
            module: { ...module, id: 'unknown' },
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
