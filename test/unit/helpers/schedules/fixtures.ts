import { SCHEDULE_DEFAULT_POLICY, SCHEDULE_MIN_INTERVAL_MS } from '../../../../src/shared/constants'
import {
  scheduleRunContextSchema,
  scheduleV2Schema,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../../../src/shared/scheduleV2'
import type { ScheduledPrompt } from '../../../../src/shared/schedule'

export function fakeSchedule(overrides: Partial<ScheduleV2> = {}): ScheduleV2 {
  const now = Date.parse('2026-10-05T12:00:00Z')
  return scheduleV2Schema.parse({
    version: 2,
    id: 'schedule-1',
    name: 'Check the build',
    workspaceKey: 'workspace-1',
    action: { kind: 'prompt', prompt: 'Read the build result' },
    trigger: { kind: 'once', atMs: now + SCHEDULE_MIN_INTERVAL_MS },
    target: { kind: 'conversation', backend: 'modelApi', sessionId: 'session-1' },
    ...SCHEDULE_DEFAULT_POLICY,
    delivery: 'whenIdle',
    grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
    paidCapUsd: 0,
    creator: { kind: 'user' },
    zone: 'America/Los_Angeles',
    paused: false,
    createdAtMs: now,
    updatedAtMs: now,
    nextFireAtMs: now + SCHEDULE_MIN_INTERVAL_MS,
    fireCount: 0,
    consecutiveFailures: 0,
    ...overrides,
  })
}
export function fakeRunContext(schedule = fakeSchedule()): ScheduleRunContext {
  return scheduleRunContextSchema.parse({
    unattended: true,
    scheduleId: schedule.id,
    runId: `${schedule.id}:${String(schedule.nextFireAtMs ?? schedule.createdAtMs)}`,
    grant: schedule.grant,
    creator: schedule.creator,
    mode: schedule.mode,
    depth: schedule.depth,
    allowAgentReschedule: schedule.allowAgentReschedule,
  })
}
export function fakeV1Schedule(): ScheduledPrompt {
  const schedule = fakeSchedule()
  return {
    id: schedule.id,
    sessionId: 'session-1',
    workspaceRoot: '/test/workspace',
    accountId: 'digest-not-a-key',
    prompt: 'Read the build result',
    cadence: { kind: 'interval', everyMs: SCHEDULE_MIN_INTERVAL_MS },
    createdAtMs: schedule.createdAtMs,
    expiresAtMs: schedule.createdAtMs + SCHEDULE_MIN_INTERVAL_MS,
    nextFireAtMs: schedule.createdAtMs,
    fireCount: 2,
    lastFireAtMs: schedule.createdAtMs - SCHEDULE_MIN_INTERVAL_MS,
  }
}
