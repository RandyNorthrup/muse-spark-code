import { describe, expect, it } from 'vitest'
import {
  schedulesSource,
  type SchedulesReportReader,
} from '../../src/core/reporting/sources/schedules'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../src/shared/scheduleV2'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'

setUiText(EN, 'en')

const workspaceKey = 'fixture-workspace'
const schedule = scheduleV2Schema.parse({
  version: 2,
  revision: 0,
  id: 'sched-1',
  name: 'Morning build private-canary',
  workspaceKey,
  action: { kind: 'prompt', prompt: 'Run the gates' },
  trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1000 },
  target: { kind: 'newConversation', backend: 'modelApi' },
  delivery: 'newConversation',
  whenClosed: 'open',
  catchUp: 'runOnce',
  mode: 'manual',
  grant: { rules: [], destinationIds: [], paidCapUsd: '0' },
  paidCapUsd: '0',
  parallel: false,
  creator: { kind: 'user' },
  depth: 0,
  allowAgentReschedule: false,
  pinned: false,
  zone: 'UTC',
  paused: false,
  createdAtMs: 1000,
  updatedAtMs: 1000,
  nextFireAtMs: 2000,
  fireCount: 0,
  consecutiveFailures: 0,
})
const fire = scheduleFireRecordSchema.parse({
  runId: 'sched-1:1',
  scheduleId: 'sched-1',
  workspaceKey,
  occurrenceMs: 1500,
  observedAtMs: 1600,
  target: { kind: 'newConversation', backend: 'modelApi' },
  delivery: 'newConversation',
  outcome: 'ran',
  refusedActions: [],
  cost: { usd: '2.5', certainty: 'exact', retainedLiabilityUsd: '0' },
})
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
const sectionById = (data: readonly { id: string }[] | null, id: string) => {
  if (data === null) throw new Error('Expected schedules sections')
  const section = data.find((entry) => entry.id === id)
  if (section === undefined) throw new Error(`Missing section ${id}`)
  return section as unknown as {
    rows: { cells: Record<string, { type: string; value: unknown }> }[]
  }
}

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
      status: { type: 'text', value: 'active' },
    })
    const fires = sectionById(result.data, 'schedules/fires')
    expect(fires.rows[0]!.cells).toMatchObject({
      outcome: { type: 'text', value: 'ran' },
    })
    const cost = sectionById(result.data, 'schedules/cost')
    expect(cost.rows).toHaveLength(2)
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
