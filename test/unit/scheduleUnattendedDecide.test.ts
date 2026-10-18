// D119 catch burn-down: an unreadable root fails closed into a refusal,
// and an audit failure is recorded as a refusal before it propagates.
// Both dependencies fail for real below.
import { describe, expect, it } from 'vitest'
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import {
  type ScheduleGrant,
  type ScheduleGrantMatcher,
  type ScheduleRunContext,
} from '../../src/shared/scheduleV2'
import {
  UnattendedRun,
  type ScheduleModelText,
  type ScheduleRunDeps,
} from '../../src/core/schedules/unattended'

const modelText: ScheduleModelText = {
  unattendedNote: 'unattended',
  approvalRefused: 'approval refused',
  physicalRefused: 'physical refused',
  protectedRefused: 'protected refused',
  requiresAskingRefused: 'requires asking refused',
  paidRefused: 'paid refused',
  questionsDeferred: 'questions deferred',
}

function grant(): ScheduleGrant {
  return { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() }
}

function context(): ScheduleRunContext {
  return {
    unattended: true,
    scheduleId: 'schedule-1',
    runId: scheduleEventRunId('schedule-1', { source: 'manual', eventKey: 'req-1' }),
    grant: grant(),
    creator: { kind: 'user' },
    mode: 'manual',
    depth: 0,
    allowAgentReschedule: false,
  }
}

function deps(overrides: Partial<ScheduleRunDeps>): ScheduleRunDeps {
  return {
    context: context(),
    modelText,
    workspaceRoot: '/workspace',
    platform: process.platform,
    io: { realPath: (absolute: string) => Promise.resolve(absolute) },
    matcher: { matches: () => undefined },
    now: () => 1,
    readGrant: () => Promise.resolve(undefined),
    isActive: () => true,
    audit: () => Promise.resolve(undefined),
    row: () => undefined,
    deferQuestions: () => Promise.resolve(undefined),
    safety: () => undefined,
    ...overrides,
  }
}

const rule = { id: 'rule-1', kind: 'tool', name: 'write' } as const
const toolMatcher: ScheduleGrantMatcher = { matches: () => rule }

describe('unattended decision failures', () => {
  it('refuses when the workspace root cannot be read', async () => {
    const run = new UnattendedRun(
      deps({ io: { realPath: () => Promise.reject(new Error('EACCES: permission denied')) } }),
    )
    const decision = await run.decide({
      id: 'action-1',
      class: 'edit',
      tool: 'write',
      paths: ['notes/a.txt'],
      requiresAsking: false,
      protectedPath: false,
    })
    expect(decision).toEqual({ allowed: false, reason: 'protected refused' })
    expect(run.refusedActions).toEqual([
      { actionClass: 'edit', tool: 'write', reason: 'protected refused' },
    ])
  })

  it('records the refusal before an audit failure propagates', async () => {
    const failure = new Error('audit store unavailable')
    const run = new UnattendedRun(
      deps({
        readGrant: () => Promise.resolve(grant()),
        matcher: toolMatcher,
        audit: () => Promise.reject(failure),
      }),
    )
    await expect(
      run.decide({
        id: 'action-1',
        class: 'edit',
        tool: 'write',
        paths: [],
        requiresAsking: false,
        protectedPath: false,
      }),
    ).rejects.toBe(failure)
    expect(run.refusedActions).toEqual([
      { actionClass: 'edit', tool: 'write', reason: 'approval refused' },
    ])
  })
})
