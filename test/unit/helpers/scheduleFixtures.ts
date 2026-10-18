// One valid schedule and run context for failure-path tests, with the
// fields each test varies as overrides, so no test repeats the literal.
import { scheduleEventRunId } from '../../../src/shared/scheduleEvents'
import { Usd } from '../../../src/shared/usd'
import {
  scheduleV2Schema,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../../src/shared/scheduleV2'

const zeroGrant = () => ({
  rules: [],
  destinationIds: [],
  paidCapUsd: Usd.from(0).toAmount(),
})

export function scheduleFixture(overrides: Partial<ScheduleV2> = {}): ScheduleV2 {
  return scheduleV2Schema.parse({
    workspaceKey: 'workspace-1',
    version: 2,
    revision: 0,
    id: 'schedule-1',
    paused: false,
    name: 'Failure path check',
    zone: 'UTC',
    mode: 'manual',
    delivery: 'interrupt',
    whenClosed: 'open',
    catchUp: 'runOnce',
    parallel: false,
    pinned: false,
    grant: zeroGrant(),
    paidCapUsd: Usd.from(0).toAmount(),
    creator: { kind: 'user' },
    action: { kind: 'prompt', prompt: 'Report.' },
    trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1_700_000_000_000 },
    target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
    depth: 0,
    allowAgentReschedule: false,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    nextFireAtMs: 1_700_000_060_000,
    fireCount: 0,
    consecutiveFailures: 0,
    ...overrides,
  })
}

/** The store methods a failure-path test never exercises. */
export function quietStoreBase() {
  return {
    update: () => Promise.resolve(true),
    remove: () => Promise.resolve(true),
    claim: () => Promise.resolve(true),
    record: () => Promise.resolve(undefined),
    fires: () => Promise.resolve([]),
  }
}

export function runContextFixture(schedule: ScheduleV2): ScheduleRunContext {
  return {
    unattended: true,
    scheduleId: schedule.id,
    runId: scheduleEventRunId(schedule.id, { source: 'manual', eventKey: 'req-1' }),
    grant: schedule.grant,
    creator: schedule.creator,
    mode: schedule.mode,
    depth: schedule.depth,
    allowAgentReschedule: schedule.allowAgentReschedule,
  }
}
