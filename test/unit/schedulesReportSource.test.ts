import { readFile } from 'node:fs/promises'
import { loadUiTable } from '../../src/host/l10n'
import { LocalSourceError, codeUnitCompare } from '../../src/core/reporting/sources/local'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { describe, expect, it } from 'vitest'
import {
  schedulesSource,
  type SchedulesReportReader,
} from '../../src/core/reporting/sources/schedules'
import { UI_TEXT, SCHEDULE_FIRE_OUTCOMES } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { installGerman } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  scheduleFireRecordSchema,
  scheduleV2Schema,
  scheduleTargetSchema,
  scheduleTimeTriggerSchema,
} from '../../src/shared/scheduleV2'
import {
  FIXTURE_WORKSPACE_KEY,
  fireFixture,
  scheduleFixture,
  scheduleTriggerFixtures,
  sectionById,
} from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'

setUiText(EN, 'en')

const schedule = scheduleV2Schema.parse(
  scheduleFixture(FIXTURE_WORKSPACE_KEY, { name: 'Morning build private-canary' }),
)
const fire = scheduleFireRecordSchema.parse(
  fireFixture({
    outcome: 'ran',
    refusedActions: [],
    cost: { usd: '2.5', certainty: 'exact', retainedLiabilityUsd: '0' },
  }),
)
// Storage shapes, not schema instances: the source validates what it reads.
const stored = <T>(value: T): T => structuredClone(value)

const scrub = (text: string) => text.replaceAll('private-canary', '[redacted]')
const context = (kind: 'schedules' | 'usage' = 'schedules') => ({
  reportText: EN,
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(kind),
  signal: new AbortController().signal,
})
const reader = (
  schedules: readonly unknown[],
  fires: readonly unknown[],
): SchedulesReportReader => ({
  read: () => Promise.resolve({ schedules, fires, observedAt: REPORT_FIXTURE_AS_OF }),
})

describe('schedules source', () => {
  it('builds the five sections from store rows and fires', async () => {
    const result = await schedulesSource(reader([stored(schedule)], [stored(fire)]), scrub).read(
      context(),
    )
    expect(result.record.status).toBe('ok')
    const timeline = sectionById(result.data, 'schedules/timeline')
    expect(timeline.rows).toHaveLength(1)
    expect(timeline.rows[0]!.cells['date']).toEqual({
      type: 'timestamp',
      value: '1970-01-01T00:00:02.000Z',
    })
    const schedules = sectionById(result.data, 'schedules/schedules')
    expect(schedules.rows[0]!.cells).toMatchObject({
      // Schedule names are report text: the scrub applies to them too.
      name: { type: 'text', value: 'Morning build [redacted]' },
      status: { type: 'label', value: 'active' },
    })
    const fires = sectionById(result.data, 'schedules/fires')
    expect(fires.rows[0]!.cells).toMatchObject({
      outcome: { type: 'text', value: EN.scheduleSettlement.outcomes.ran },
    })
    const cost = sectionById(result.data, 'schedules/cost')
    expect(cost.rows).toHaveLength(2)
  })

  it('pre-renders trigger and grant prose in the installed language', async () => {
    await installGerman(new FakeLogOutputChannel())
    try {
      const result = await schedulesSource(reader([stored(schedule)], []), scrub).read(context())
      expect(result.record.status).toBe('ok')
      expect(sectionById(result.data, 'schedules/schedules').rows[0]!.cells).toMatchObject({
        trigger: { type: 'text', value: 'alle 3600000 ms' },
        grant: { type: 'text', value: '0 Regeln, 0 Ziele, Limit 0' },
        creator: { type: 'label', value: 'user' },
        status: { type: 'label', value: 'active' },
      })
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('renders event triggers, targets, delivery and agent creators in German', async () => {
    await installGerman(new FakeLogOutputChannel())
    try {
      const job = scheduleV2Schema.parse(
        scheduleFixture(FIXTURE_WORKSPACE_KEY, {
          id: 'sched-event',
          name: 'Ereignisauftrag',
          trigger: {
            kind: 'event',
            source: 'github',
            event: 'pullRequestOpened',
            conditions: [],
          },
          target: { kind: 'worker', workerId: 'worker-1' },
          delivery: 'steer',
          creator: { kind: 'agent', agentId: 'agent-1', sessionId: 's1', orchestratorId: 'o1' },
          nextFireAtMs: 2000,
        }),
      )
      const result = await schedulesSource(reader([structuredClone(job)], []), scrub).read(
        context(),
      )
      expect(result.record.status).toBe('ok')
      // No English composed in code: every word comes from the installed
      // table and only the technical ids stay as they came.
      expect(sectionById(result.data, 'schedules/schedules').rows[0]!.cells).toMatchObject({
        trigger: { type: 'text', value: 'Bei einem Ereignis: github:pullRequestOpened' },
        target: { type: 'text', value: 'Arbeitsagent: worker-1' },
        delivery: { type: 'text', value: 'Laufenden Durchgang lenken' },
        creator: { type: 'text', value: 'Ersteller: agent-1' },
        status: { type: 'label', value: 'active' },
      })
      // The event trigger is armed, never an upcoming timed fire.
      expect(sectionById(result.data, 'schedules/timeline').rows).toHaveLength(0)
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('keeps all schema-allowed schedule prose stable across overlapping language reads', async () => {
    const triggers = scheduleTriggerFixtures()
    const targets = [
      { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
      { kind: 'newConversation', backend: 'modelApi' },
      { kind: 'worker', workerId: 'worker-1' },
      { kind: 'role', teamId: 'team-1', roleId: 'role-1' },
      { kind: 'team', teamId: 'team-1' },
      { kind: 'node', nodeId: 'node-1' },
    ]
    expect(triggers.map((trigger) => trigger.kind).toSorted(codeUnitCompare)).toEqual(
      [
        ...scheduleTimeTriggerSchema.def.options.flatMap((option) => option.shape.kind.def.values),
        'event',
        'afterEvent',
      ].toSorted(codeUnitCompare),
    )
    expect(targets.map((target) => target.kind).toSorted(codeUnitCompare)).toEqual(
      scheduleTargetSchema.def.options
        .flatMap((option) => option.shape.kind.def.values)
        .toSorted(codeUnitCompare),
    )
    const deliveries = scheduleV2Schema.shape.delivery.options
    const creators = [
      { kind: 'user' },
      { kind: 'agent', agentId: 'agent-1', sessionId: 's1', orchestratorId: 'o1' },
    ]
    expect(creators.map((creator) => creator.kind).toSorted(codeUnitCompare)).toEqual(
      scheduleV2Schema.shape.creator.def.options
        .flatMap((option) => option.shape.kind.def.values)
        .toSorted(codeUnitCompare),
    )
    const schedules = triggers.map((trigger, index) =>
      scheduleFixture(FIXTURE_WORKSPACE_KEY, {
        id: `schedule-${String(index)}`,
        trigger,
        target: targets[index % targets.length],
        delivery:
          targets[index % targets.length]?.kind === 'newConversation'
            ? 'newConversation'
            : deliveries[index % deliveries.length],
        creator: creators[index % creators.length],
      }),
    )
    expect(schedules.map((job) => scheduleV2Schema.parse(job).delivery)).toEqual(
      expect.arrayContaining(deliveries),
    )
    const fires = SCHEDULE_FIRE_OUTCOMES.map((outcome) => fireFixture({ runId: outcome, outcome }))
    await installGerman(new FakeLogOutputChannel())
    const german = await schedulesSource(reader(schedules, fires), scrub).read(context())
    const suspended = Promise.withResolvers<{
      schedules: readonly unknown[]
      fires: readonly unknown[]
      observedAt: string
    }>()
    const pending = schedulesSource({ read: () => suspended.promise }, scrub).read(context())
    setUiText(EN, 'en')
    const english = await schedulesSource(reader(schedules, fires), scrub).read(context())
    suspended.resolve({ schedules, fires, observedAt: REPORT_FIXTURE_AS_OF })
    expect(await pending).toEqual(german)
    expect(german.record.status).toBe('ok')
    expect(english.record.status).toBe('ok')
    expect(english).not.toEqual(german)
  })

  it('keeps a delayed source failure in the request language', async () => {
    await installGerman(new FakeLogOutputChannel())
    const expected = UI_TEXT.teamHostBusy
    const suspended = Promise.withResolvers<never>()
    const pending = schedulesSource({ read: () => suspended.promise }, scrub).read(context())
    setUiText(EN, 'en')
    suspended.reject(new LocalSourceError('busy'))
    const result = await pending
    expect(result.record.reason).toBe(expected)
  })

  it.each(TABLE_LOCALES)('translates every recent-fire outcome in %s', async (locale) => {
    const loaded = await loadUiTable({
      language: locale,
      readExtensionFile: () =>
        readFile(new URL(`../../l10n/ui.${locale}.json`, import.meta.url), 'utf8'),
      log: new FakeLogOutputChannel(),
    })
    try {
      expect(loaded.locale).toBe(locale)
      const outcomes = scheduleFireRecordSchema.shape.outcome.options
      const result = await schedulesSource(
        reader(
          [],
          outcomes.map((outcome) => fireFixture({ outcome, runId: outcome })),
        ),
        scrub,
      ).read(context())
      const rows = sectionById(result.data, 'schedules/fires').rows
      expect(rows).toHaveLength(outcomes.length)
      for (const outcome of outcomes) {
        const row = rows.find((row) => row.cells['run']?.value === outcome)
        expect(row?.cells['outcome']).toEqual({
          type: 'text',
          value: loaded.table.scheduleSettlement.outcomes[outcome],
        })
      }
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('reads an empty store as ok with empty sections, never invented rows', async () => {
    const result = await schedulesSource(reader([], []), scrub).read(context())
    expect(result.record.status).toBe('ok')
    for (const id of [
      'schedules/timeline',
      'schedules/schedules',
      'schedules/fires',
      'schedules/refusals',
      'schedules/cost',
    ])
      expect(sectionById(result.data, id).rows).toHaveLength(0)
  })

  it('reports corrupt rows as invalid, never partial success', async () => {
    const result = await schedulesSource(
      reader([{ ...stored(schedule), trigger: { kind: 'interval' } }], []),
      scrub,
    ).read(context())
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.invalid)
    expect(result.data).toBeNull()
  })

  it('stays notApplicable on other kinds and unavailable when unbound', async () => {
    const other = await schedulesSource(reader([stored(schedule)], []), scrub).read(
      context('usage'),
    )
    expect(other.record.status).toBe('notApplicable')
    expect(other.data).toBeNull()
    const unbound = await schedulesSource(undefined, scrub).read(context())
    expect(unbound.record.status).toBe('unavailable')
    expect(unbound.record.reason).toBe(UI_TEXT.reportSourceReasons.unbound)
  })
})
