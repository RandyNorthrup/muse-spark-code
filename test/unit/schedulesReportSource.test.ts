import { describe, expect, it } from 'vitest'
import {
  schedulesSource,
  type SchedulesReportReader,
} from '../../src/core/reporting/sources/schedules'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { installGerman } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../src/shared/scheduleV2'
import {
  FIXTURE_WORKSPACE_KEY,
  fireFixture,
  scheduleFixture,
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
      outcome: { type: 'text', value: 'ran' },
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
