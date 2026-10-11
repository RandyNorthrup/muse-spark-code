import { afterEach, describe, expect, it, vi } from 'vitest'
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
  type TrafficSlice,
} from '../../src/shared/modelsPanel'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT, setUiText } from '../../src/shared/l10n/text'
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
    notify: vi.fn(() => Promise.resolve()),
    dispatchTraffic: vi.fn(() => Promise.resolve()),
    dispatchRunners: vi.fn(() => Promise.resolve()),
  } satisfies TrafficPanelDependencies
}

function selected(raw: Record<string, unknown>, state: TrafficSlice = trafficFixture()) {
  let expected: unknown
  switch (raw['type']) {
    case 'traffic/task': {
      expected = {
        task: state.board.tasks.find((row) => row.id === raw['taskId']),
        availability: state.taskActions.find(
          (row) => row.taskId === raw['taskId'] && row.attempt === raw['attempt'],
        ),
        destination:
          raw['action'] === 'reassign'
            ? state.entries.find((row) => row.id === raw['entryId'])
            : undefined,
      }
      break
    }
    case 'traffic/resource': {
      expected = state.resources.find((row) => row.id === raw['resourceId'])
      break
    }
    case 'traffic/recovery': {
      expected = state.recovery.find((row) => row.id === raw['recoveryId'])
      break
    }
    case 'traffic/conflict': {
      expected = state.conflicts.find((row) => row.id === raw['conflictId'])
      break
    }
    case 'traffic/merge': {
      expected = state.mergeQueue.find((row) => row.taskId === raw['taskId'])
      break
    }
    case 'traffic/cleanup': {
      expected = state.copies.find((row) => row.taskId === raw['taskId'])
      break
    }
    default: {
      return raw
    }
  }
  return { ...raw, expected }
}

async function handleSelectedMessage(
  raw: Record<string, unknown>,
  deps: ReturnType<typeof dependencies>,
) {
  return await handleTrafficMessage(selected(raw, await deps.traffic()), deps)
}

async function expectChanged(
  message: Record<string, unknown>,
  deps: ReturnType<typeof dependencies>,
) {
  expect(await handleTrafficMessage(message, deps)).toEqual({ handled: false })
  expect(deps.dispatchTraffic).not.toHaveBeenCalled()
  expect(deps.notify).toHaveBeenCalledExactlyOnceWith(UI_TEXT.teamTrafficDetails.changedSinceOpened)
}

afterEach(() => {
  setUiText(EN, 'en')
})

const destructiveActions: [string, Record<string, unknown>][] = [
  ...['takeBack', 'restartServer', 'releaseAnyway'].map(
    (action): [string, Record<string, unknown>] => [
      action,
      { type: 'traffic/resource', resourceId: 'browser', action },
    ],
  ),
  ...['handOffAnyway', 'continueAnyway', 'restartTeamHost'].map(
    (action): [string, Record<string, unknown>] => [
      action,
      { type: 'traffic/task', taskId: 'blocked', attempt: 1, action },
    ],
  ),
  ...['cancel', 'reassign'].map((action): [string, Record<string, unknown>] => [
    action,
    {
      type: 'traffic/task',
      taskId: 'ready-one',
      attempt: 0,
      action,
      ...(action === 'reassign' && { entryId: 'other-entry' }),
    },
  ]),
  ...['resume', 'discard', 'recover', 'takeOver'].map(
    (action): [string, Record<string, unknown>] => [
      action,
      { type: 'traffic/recovery', recoveryId: 'interrupted', action },
    ],
  ),
  ['stop', { type: 'traffic/recovery', recoveryId: 'orphan', action: 'stop' }],
  ...['retry', 'remove', 'landNow', 'landWithoutChecks', 'apply', 'undoBatch'].map(
    (action): [string, Record<string, unknown>] => [
      action,
      { type: 'traffic/merge', taskId: 'ready-one', action },
    ],
  ),
  ...['serialize', 'letBothRun'].map((action): [string, Record<string, unknown>] => [
    action,
    { type: 'traffic/conflict', conflictId: 'conflict', action },
  ]),
  ['cleanup', { type: 'traffic/cleanup', taskId: 'landed' }],
]

describe('Traffic action boundary', () => {
  it('refuses reassignment to a replacement destination entry while confirmation is open', async () => {
    const deps = dependencies()
    const state = trafficFixture()
    const message = selected(
      {
        ...scope,
        type: 'traffic/task',
        taskId: 'ready-one',
        attempt: 0,
        action: 'reassign',
        entryId: 'other-entry',
      },
      state,
    )
    deps.confirm.mockImplementation(() => {
      deps.traffic.mockResolvedValue({
        ...state,
        entries: state.entries.map((row) => ({ ...row, generation: row.generation + 1 })),
      })
      return Promise.resolve(true)
    })
    await expectChanged(message, deps)
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(message)
  })
  it('requires target generations and refuses identical reacquisition during confirmation', async () => {
    const deps = dependencies()
    const state = trafficFixture()
    const resource = state.resources[0]
    if (!resource) throw new Error('resource fixture missing')
    const message = selected(
      { ...scope, type: 'traffic/resource', resourceId: 'browser', action: 'releaseAnyway' },
      state,
    )
    expect(
      trafficMessageSchema.safeParse({
        ...message,
        expected: { ...resource, generation: undefined },
      }).success,
    ).toBe(false)
    deps.confirm.mockImplementation(() => {
      deps.traffic.mockResolvedValue({
        ...state,
        resources: [{ ...resource, generation: resource.generation + 1 }],
      })
      return Promise.resolve(true)
    })
    await expectChanged(message, deps)
  })
  it.each(destructiveActions)(
    'binds %s confirmation to the displayed target and refuses its replacement',
    async (_action, raw) => {
      const deps = dependencies()
      const fixture = trafficFixture()
      const state = {
        ...fixture,
        taskActions: fixture.taskActions.map((row) => ({
          ...row,
          actions: [...row.actions, 'handOffAnyway' as const],
        })),
        recovery: fixture.recovery.map((row) => ({
          ...row,
          ownerMayBeLive: false,
          actions: [...row.actions, 'recover' as const],
        })),
      }
      deps.traffic.mockResolvedValue(state)
      const message = selected({ ...scope, ...raw }, state)
      expect(trafficMessageSchema.safeParse({ ...scope, ...raw }).success).toBe(false)
      expect(await handleTrafficMessage(message, deps)).toEqual({ handled: true })
      expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(message)
      expect(deps.dispatchTraffic).toHaveBeenCalledExactlyOnceWith(message)
      deps.confirm.mockClear()
      deps.dispatchTraffic.mockClear()
      deps.confirm.mockImplementation(() => {
        deps.traffic.mockResolvedValue({
          ...state,
          board: {
            ...state.board,
            tasks: state.board.tasks.map((task) => ({
              ...task,
              held: !task.held,
              attempts: task.attempts.map((attempt) => ({
                ...attempt,
                entryId: 'replacement-entry',
              })),
            })),
          },
          resources: state.resources.map((row) => ({ ...row, holder: 'different-task' })),
          recovery: state.recovery.map((row) => ({
            ...row,
            attempt: 2,
            launchId: 'replacement-launch',
          })),
          mergeQueue: state.mergeQueue.map((row) => ({
            ...row,
            landingBranch: 'agents/landing/replacement',
          })),
          conflicts: state.conflicts.map((row) => ({ ...row, paths: ['src/replacement.ts'] })),
          copies: state.copies.map((row) => ({ ...row, bytes: row.bytes + 1 })),
        })
        return Promise.resolve(true)
      })
      await expectChanged(message, deps)
      expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(message)
    },
  )
  it.each(destructiveActions)(
    'rejects an old %s generation before opening confirmation, including identical replacement rows',
    async (_action, raw) => {
      const deps = dependencies()
      const state = trafficFixture()
      const message = selected({ ...scope, ...raw }, state)
      deps.traffic.mockResolvedValue({
        ...state,
        taskActions: state.taskActions.map((row) => ({ ...row, generation: row.generation + 1 })),
        resources: state.resources.map((row) => ({ ...row, generation: row.generation + 1 })),
        recovery: state.recovery.map((row) => ({ ...row, generation: row.generation + 1 })),
        mergeQueue: state.mergeQueue.map((row) => ({ ...row, generation: row.generation + 1 })),
        conflicts: state.conflicts.map((row) => ({ ...row, generation: row.generation + 1 })),
        copies: state.copies.map((row) => ({ ...row, generation: row.generation + 1 })),
      })
      setUiText(
        {
          ...EN,
          teamTrafficDetails: {
            ...EN.teamTrafficDetails,
            changedSinceOpened: 'Změněno od otevření.',
          },
        },
        'cs',
      )
      expect(await handleTrafficMessage(message, deps)).toEqual({ handled: false })
      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.dispatchTraffic).not.toHaveBeenCalled()
      expect(deps.notify).toHaveBeenCalledExactlyOnceWith('Změněno od otevření.')
    },
  )
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
      expect(await handleSelectedMessage(raw, deps)).toEqual({ handled: false })
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
      expect(await handleSelectedMessage(raw, deps)).toEqual({ handled: false })
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
    expect(await handleSelectedMessage(open, deps)).toEqual({ handled: true })
    expect(await handleSelectedMessage({ ...open, action: 'stop' }, deps)).toEqual({
      handled: false,
    })
    expect(await handleSelectedMessage({ ...open, action: 'release' }, deps)).toEqual({
      handled: false,
    })
    expect(await handleSelectedMessage({ ...open, otherWindowId: 'missing' }, deps)).toEqual({
      handled: false,
    })
    expect(deps.dispatchTraffic).toHaveBeenCalledExactlyOnceWith(open)
  })
  it('asks for every landing, without-checks landing and uncertain release, and rechecks after the card', async () => {
    const deps = dependencies()
    const base = { type: 'traffic/merge', ...scope, taskId: 'ready-one' }
    for (const action of ['landNow', 'landWithoutChecks', 'apply']) {
      expect(await handleSelectedMessage({ ...base, action }, deps)).toEqual({ handled: true })
    }
    expect(deps.confirm).toHaveBeenCalledTimes(3)
    const denied = dependencies()
    denied.confirm.mockResolvedValue(false)
    expect(await handleSelectedMessage({ ...base, action: 'landWithoutChecks' }, denied)).toEqual({
      handled: false,
    })
    expect(denied.dispatchTraffic).not.toHaveBeenCalled()
    const changed = dependencies()
    changed.confirm.mockImplementation(() => {
      changed.traffic.mockResolvedValue({ ...trafficFixture(), mergeQueue: [] })
      return Promise.resolve(true)
    })
    expect(await handleSelectedMessage({ ...base, action: 'landNow' }, changed)).toEqual({
      handled: false,
    })
    expect(changed.dispatchTraffic).not.toHaveBeenCalled()
    const resource = {
      type: 'traffic/resource',
      ...scope,
      resourceId: 'browser',
      action: 'releaseAnyway',
    }
    expect(await handleSelectedMessage(resource, deps)).toEqual({ handled: true })
    expect(deps.confirm).toHaveBeenCalledWith(selected(resource))
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
      expect(await handleSelectedMessage(message, deps)).toEqual({ handled: true })
      expect(deps.confirm).toHaveBeenLastCalledWith(selected(message, await deps.traffic()))
    }
    for (const [recoveryId, action] of [
      ['orphan', 'stop'],
      ['interrupted', 'discard'],
    ]) {
      const message = { type: 'traffic/recovery', ...scope, recoveryId, action }
      expect(await handleSelectedMessage(message, deps)).toEqual({ handled: true })
      expect(deps.confirm).toHaveBeenLastCalledWith(selected(message, await deps.traffic()))
    }
    deps.traffic.mockResolvedValue({
      ...state,
      mergeQueue: state.mergeQueue.map((row) => ({ ...row, actions: [] })),
    })
    expect(
      await handleSelectedMessage(
        { type: 'traffic/merge', ...scope, taskId: 'ready-one', action: 'landNow' },
        deps,
      ),
    ).toEqual({ handled: false })
  })
  it('preserves possibly live owners, held locks and unmerged copies; permits explicit takeover', async () => {
    const deps = dependencies()
    const recovery = { type: 'traffic/recovery', ...scope, recoveryId: 'interrupted' }
    for (const action of ['resume', 'discard'])
      expect(await handleSelectedMessage({ ...recovery, action }, deps)).toEqual({ handled: false })
    expect(
      await handleSelectedMessage({ ...recovery, action: 'newTask', includeEdits: true }, deps),
    ).toEqual({ handled: true })
    expect(await handleSelectedMessage({ ...recovery, action: 'takeOver' }, deps)).toEqual({
      handled: true,
    })
    expect(deps.confirm).toHaveBeenCalledWith(selected({ ...recovery, action: 'takeOver' }))
    expect(
      await handleSelectedMessage({ ...recovery, recoveryId: 'landing', action: 'recover' }, deps),
    ).toEqual({ handled: false })
    for (const taskId of ['unmerged', 'quarantined', 'missing'])
      expect(
        await handleSelectedMessage({ type: 'traffic/cleanup', ...scope, taskId }, deps),
      ).toEqual({ handled: false })
    expect(
      await handleSelectedMessage({ type: 'traffic/cleanup', ...scope, taskId: 'landed' }, deps),
    ).toEqual({ handled: true })
    expect(trafficMessageSchema.safeParse({ ...recovery, action: 'removeLock' }).success).toBe(
      false,
    )
  })
  it('routes priority and same-role entry choices, conflicts and queue actions', async () => {
    const deps = dependencies()
    const task = { type: 'traffic/task', ...scope, taskId: 'ready-one', attempt: 0 }
    expect(await handleSelectedMessage({ ...task, action: 'priority' }, deps)).toEqual({
      handled: false,
    })
    expect(
      await handleSelectedMessage({ ...task, action: 'priority', priority: 'urgent' }, deps),
    ).toEqual({ handled: true })
    expect(
      await handleSelectedMessage({ ...task, action: 'reassign', entryId: 'docs-entry' }, deps),
    ).toEqual({ handled: false })
    expect(
      await handleSelectedMessage({ ...task, action: 'reassign', entryId: 'other-entry' }, deps),
    ).toEqual({ handled: true })
    for (const raw of [
      { type: 'traffic/load', ...scope },
      { type: 'traffic/queue', ...scope, action: 'resume' },
      { type: 'traffic/conflict', ...scope, conflictId: 'conflict', action: 'serialize' },
    ])
      expect(await handleSelectedMessage(raw, deps)).toEqual({ handled: true })
    for (const raw of [
      { type: 'traffic/resource', ...scope, resourceId: 'missing', action: 'takeBack' },
      { type: 'traffic/conflict', ...scope, conflictId: 'missing', action: 'serialize' },
      { type: 'traffic/recovery', ...scope, recoveryId: 'missing', action: 'keep' },
    ])
      expect(await handleSelectedMessage(raw, deps)).toEqual({ handled: false })
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
