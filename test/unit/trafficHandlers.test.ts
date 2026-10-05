import { describe, expect, it, vi } from 'vitest'
import {
  handleTrafficMessage,
  handleRunnersMessage,
  type TrafficPanelDependencies,
} from '../../src/host/modelsPanelTraffic'
import {
  runnersMessageSchema,
  trafficHostMessageSchema,
  runnersHostMessageSchema,
  trafficMessageSchema,
  type TrafficMessage,
} from '../../src/shared/modelsPanel'
import {
  TEAM_SCHED_HISTORY_MAX,
  TEAM_WRITE_SET_MAX,
  RUNNER_CONFIG_MAX,
} from '../../src/shared/constants'
import { trafficFixture, runnersFixture } from './helpers/trafficFixtures'

const scope = { workspaceId: 'workspace', windowInstanceId: 'window' }
function dependencies() {
  return {
    traffic: vi.fn(() => Promise.resolve(trafficFixture())),
    runners: vi.fn(() => Promise.resolve(runnersFixture())),
    confirm: vi.fn(() => Promise.resolve(true)),
    dispatchTraffic: vi.fn(() => Promise.resolve()),
    dispatchRunners: vi.fn(() => Promise.resolve()),
  } satisfies TrafficPanelDependencies
}

describe('Traffic action boundary', () => {
  it('validates host envelopes and bounds projections, fits, positions and counts', () => {
    const state = trafficFixture()
    expect(trafficHostMessageSchema.safeParse({ type: 'traffic/state', state }).success).toBe(true)
    expect(
      runnersHostMessageSchema.safeParse({ type: 'runners/state', state: runnersFixture() })
        .success,
    ).toBe(true)
    const rank = state.ranks[0]
    const hint = state.windows[0]
    if (!rank || !hint) throw new Error('fixture rows missing')
    for (const value of [
      { ...state, ranks: Array.from({ length: TEAM_SCHED_HISTORY_MAX + 1 }, () => rank) },
      { ...state, ranks: [{ ...rank, fit: 2 }] },
      {
        ...state,
        windows: [{ ...hint, paths: Array.from({ length: TEAM_WRITE_SET_MAX + 1 }, () => 'a.ts') }],
      },
      { ...state, localWorkers: -1 },
      { ...state, metrics: [{ ...state.metrics[0], taskCount: -1 }] },
      { ...state, metrics: [{ ...state.metrics[0], busySlotMs: 3000, availableSlotMs: 2000 }] },
      { ...state, mergeQueue: [{ ...state.mergeQueue[0], position: 0 }] },
    ])
      expect(
        trafficHostMessageSchema.safeParse({ type: 'traffic/state', state: value }).success,
      ).toBe(false)
    expect(
      trafficHostMessageSchema.safeParse({ type: 'traffic/state', state, extra: true }).success,
    ).toBe(false)
    const health = runnersFixture().health[0]
    expect(
      runnersHostMessageSchema.safeParse({
        type: 'runners/state',
        state: {
          ...runnersFixture(),
          health: Array.from({ length: RUNNER_CONFIG_MAX + 1 }, () => health),
        },
      }).success,
    ).toBe(false)
  })
  it('refuses actions withdrawn from a resource, conflict or recovery row', async () => {
    const deps = dependencies()
    const state = trafficFixture()
    deps.traffic.mockResolvedValue({
      ...state,
      resources: state.resources.map((row) => ({ ...row, actions: [] })),
      conflicts: state.conflicts.map((row) => ({ ...row, actions: [] })),
      recovery: state.recovery.map((row) => ({ ...row, actions: [] })),
    })
    for (const raw of [
      { type: 'traffic/resource', ...scope, resourceId: 'browser', action: 'takeBack' },
      { type: 'traffic/conflict', ...scope, conflictId: 'conflict', action: 'serialize' },
      { type: 'traffic/recovery', ...scope, recoveryId: 'orphan', action: 'keep' },
    ])
      expect(await handleTrafficMessage(raw, deps)).toEqual({ handled: false })
    expect(deps.dispatchTraffic).not.toHaveBeenCalled()
  })

  it('refuses unknown fields, foreign windows, stale attempts and unavailable handoffs', async () => {
    const deps = dependencies()
    const task = {
      type: 'traffic/task',
      ...scope,
      taskId: 'blocked',
      attempt: 1,
      action: 'continueAnyway',
    }
    for (const raw of [
      { ...task, extra: true },
      { ...task, windowInstanceId: 'foreign' },
      { ...task, workspaceId: 'foreign' },
      { ...task, attempt: 0 },
      { ...task, action: 'handOffAnyway' },
      { ...task, taskId: 'missing' },
    ]) {
      expect(await handleTrafficMessage(raw, deps)).toEqual({ handled: false })
    }
    expect(deps.dispatchTraffic).not.toHaveBeenCalled()
    expect(deps.confirm).not.toHaveBeenCalled()
  })
  it('offers other windows only opening, never stopping or releasing their work', async () => {
    const deps = dependencies()
    const open = {
      type: 'traffic/window',
      ...scope,
      otherWindowId: 'peer-one',
      action: 'openWindow',
    }
    expect(await handleTrafficMessage(open, deps)).toEqual({ handled: true })
    expect(await handleTrafficMessage({ ...open, action: 'stop' }, deps)).toEqual({
      handled: false,
    })
    expect(await handleTrafficMessage({ ...open, action: 'release' }, deps)).toEqual({
      handled: false,
    })
    expect(await handleTrafficMessage({ ...open, otherWindowId: 'missing' }, deps)).toEqual({
      handled: false,
    })
    expect(deps.dispatchTraffic).toHaveBeenCalledExactlyOnceWith(open)
  })
  it('asks for every landing, without-checks landing and uncertain release, and rechecks after the card', async () => {
    const deps = dependencies()
    const base = { type: 'traffic/merge', ...scope, taskId: 'ready-one' }
    for (const action of ['landNow', 'landWithoutChecks', 'apply']) {
      expect(await handleTrafficMessage({ ...base, action }, deps)).toEqual({ handled: true })
    }
    expect(deps.confirm).toHaveBeenCalledTimes(3)
    const denied = dependencies()
    denied.confirm.mockResolvedValue(false)
    expect(await handleTrafficMessage({ ...base, action: 'landWithoutChecks' }, denied)).toEqual({
      handled: false,
    })
    expect(denied.dispatchTraffic).not.toHaveBeenCalled()
    const changed = dependencies()
    changed.confirm.mockImplementation(() => {
      changed.traffic.mockResolvedValue({ ...trafficFixture(), mergeQueue: [] })
      return Promise.resolve(true)
    })
    expect(await handleTrafficMessage({ ...base, action: 'landNow' }, changed)).toEqual({
      handled: false,
    })
    expect(changed.dispatchTraffic).not.toHaveBeenCalled()
    const resource: TrafficMessage = {
      type: 'traffic/resource',
      ...scope,
      resourceId: 'browser',
      action: 'releaseAnyway',
    }
    expect(await handleTrafficMessage(resource, deps)).toEqual({ handled: true })
    expect(deps.confirm).toHaveBeenCalledWith(resource)
  })
  it('confirms retirement, orphan stop and discard, and refuses withdrawn merge actions', async () => {
    const deps = dependencies()
    const state = trafficFixture()
    deps.traffic.mockResolvedValue({
      ...state,
      taskActions: state.taskActions.map((row) => ({
        ...row,
        actions: [...row.actions, 'handOffAnyway', 'restartTeamHost'],
      })),
      recovery: state.recovery.map((row) => ({ ...row, ownerMayBeLive: false })),
    })
    for (const action of ['handOffAnyway', 'continueAnyway', 'restartTeamHost']) {
      const message = { type: 'traffic/task', ...scope, taskId: 'blocked', attempt: 1, action }
      expect(await handleTrafficMessage(message, deps)).toEqual({ handled: true })
      expect(deps.confirm).toHaveBeenLastCalledWith(message)
    }
    for (const [recoveryId, action] of [
      ['orphan', 'stop'],
      ['interrupted', 'discard'],
    ]) {
      const message = { type: 'traffic/recovery', ...scope, recoveryId, action }
      expect(await handleTrafficMessage(message, deps)).toEqual({ handled: true })
      expect(deps.confirm).toHaveBeenLastCalledWith(message)
    }
    deps.traffic.mockResolvedValue({
      ...state,
      mergeQueue: state.mergeQueue.map((row) => ({ ...row, actions: [] })),
    })
    expect(
      await handleTrafficMessage(
        { type: 'traffic/merge', ...scope, taskId: 'ready-one', action: 'landNow' },
        deps,
      ),
    ).toEqual({ handled: false })
  })
  it('preserves possibly live owners, held locks and unmerged copies; permits explicit takeover', async () => {
    const deps = dependencies()
    const recovery = { type: 'traffic/recovery', ...scope, recoveryId: 'interrupted' }
    for (const action of ['resume', 'discard'])
      expect(await handleTrafficMessage({ ...recovery, action }, deps)).toEqual({ handled: false })
    expect(
      await handleTrafficMessage({ ...recovery, action: 'newTask', includeEdits: true }, deps),
    ).toEqual({ handled: true })
    expect(await handleTrafficMessage({ ...recovery, action: 'takeOver' }, deps)).toEqual({
      handled: true,
    })
    expect(deps.confirm).toHaveBeenCalledWith({ ...recovery, action: 'takeOver' })
    expect(
      await handleTrafficMessage({ ...recovery, recoveryId: 'landing', action: 'recover' }, deps),
    ).toEqual({ handled: false })
    for (const taskId of ['unmerged', 'quarantined', 'missing'])
      expect(
        await handleTrafficMessage({ type: 'traffic/cleanup', ...scope, taskId }, deps),
      ).toEqual({ handled: false })
    expect(
      await handleTrafficMessage({ type: 'traffic/cleanup', ...scope, taskId: 'landed' }, deps),
    ).toEqual({ handled: true })
    expect(trafficMessageSchema.safeParse({ ...recovery, action: 'removeLock' }).success).toBe(
      false,
    )
  })
  it('routes priority and same-role entry choices, conflicts and queue actions', async () => {
    const deps = dependencies()
    const task = { type: 'traffic/task', ...scope, taskId: 'ready-one', attempt: 0 }
    expect(await handleTrafficMessage({ ...task, action: 'priority' }, deps)).toEqual({
      handled: false,
    })
    expect(
      await handleTrafficMessage({ ...task, action: 'priority', priority: 'urgent' }, deps),
    ).toEqual({ handled: true })
    expect(
      await handleTrafficMessage({ ...task, action: 'reassign', entryId: 'docs-entry' }, deps),
    ).toEqual({ handled: false })
    expect(
      await handleTrafficMessage({ ...task, action: 'reassign', entryId: 'other-entry' }, deps),
    ).toEqual({ handled: true })
    for (const raw of [
      { type: 'traffic/load', ...scope },
      { type: 'traffic/queue', ...scope, action: 'resume' },
      { type: 'traffic/conflict', ...scope, conflictId: 'conflict', action: 'serialize' },
    ])
      expect(await handleTrafficMessage(raw, deps)).toEqual({ handled: true })
    for (const raw of [
      { type: 'traffic/resource', ...scope, resourceId: 'missing', action: 'takeBack' },
      { type: 'traffic/conflict', ...scope, conflictId: 'missing', action: 'serialize' },
      { type: 'traffic/recovery', ...scope, recoveryId: 'missing', action: 'keep' },
    ])
      expect(await handleTrafficMessage(raw, deps)).toEqual({ handled: false })
  })
})
describe('Runners user configuration boundary', () => {
  it('rejects credentials, environment values, SSH options and repository authority', async () => {
    const deps = dependencies()
    const runner = runnersFixture().runners[0]
    if (!runner) throw new Error('runner fixture missing')
    for (const raw of [
      { type: 'runners/save', runner: { ...runner, environmentNames: ['META_API_KEY'] } },
      { type: 'runners/save', runner: { ...runner, environment: { CI: '1' } } },
      { type: 'runners/save', runner: { ...runner, destination: '-oProxyCommand=bad' } },
      { type: 'runners/save', runner, source: 'repository' },
    ]) {
      expect(runnersMessageSchema.safeParse(raw).success).toBe(false)
      expect(await handleRunnersMessage(raw, deps)).toEqual({ handled: false })
    }
    expect(deps.dispatchRunners).not.toHaveBeenCalled()
  })
  it('refuses tests in Restricted Mode or for unknown runners; routes user saves and removal', async () => {
    const deps = dependencies()
    deps.runners.mockResolvedValue({ ...runnersFixture(), trusted: false })
    expect(await handleRunnersMessage({ type: 'runners/test', runnerId: 'macmini' }, deps)).toEqual(
      { handled: false },
    )
    expect(await handleRunnersMessage({ type: 'runners/testAll' }, deps)).toEqual({
      handled: false,
    })
    deps.runners.mockResolvedValue(runnersFixture())
    expect(await handleRunnersMessage({ type: 'runners/test', runnerId: 'missing' }, deps)).toEqual(
      { handled: false },
    )
    expect(
      await handleRunnersMessage({ type: 'runners/remove', runnerId: 'missing' }, deps),
    ).toEqual({ handled: false })
    for (const raw of [
      { type: 'runners/load' },
      { type: 'runners/testAll' },
      { type: 'runners/test', runnerId: 'macmini' },
      { type: 'runners/remove', runnerId: 'macmini' },
      { type: 'runners/save', runner: runnersFixture().runners[0] },
    ])
      expect(await handleRunnersMessage(raw, deps)).toEqual({ handled: true })
  })
})
