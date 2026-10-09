import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackend, type RuntimeBackendDeps } from '../../../src/runtime/backends'
import { runtimePaidRequestAdmission } from '../../../src/runtime/features/paidRequest'
import { isGoalRefusedError } from '../../../src/core/agent/agentBackend'
import { SECRET_KEYS, UI_TEXT } from '../../../src/shared/constants'
import { FakeLogOutputChannel, memorySecrets } from '../../unit/helpers/fakes'
import { fakeModelApi, FAKE_MODEL_API_KEY } from '../../unit/helpers/fakeModelApi'
import { buildModelApiBundle } from '../../unit/helpers/modelApiBundle'
import { watchSessionTurns } from '../../unit/helpers/sessionTurns'
import { engineFixtures } from './fixtures'
import { paidHarness, enginePaidBudget } from './paidHarness'

const fixtures = engineFixtures()
const dist = { folder: '' }
beforeAll(async () => {
  dist.folder = await mkdtemp(path.join(tmpdir(), 'm104-pb-session-dist-'))
  await buildModelApiBundle(dist.folder)
})
afterAll(async () => {
  await rm(dist.folder, { recursive: true, force: true })
})

async function setup(extra: Partial<RuntimeBackendDeps> = {}) {
  const root = await fixtures.folder('m104-pb-session-')
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const api = fakeModelApi()
  const state = { isTrusted: true }
  const runtime = createRuntimeBackend({
    options: {
      backend: 'modelApi',
      trustWorkspace: true,
      museBinary: '',
      shellSandbox: 'off',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures: [],
      isVerbose: false,
    },
    version: 'fixture',
    distDir: dist.folder,
    platform: process.platform,
    env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
    homeDir: root,
    secrets,
    museCodeCredentials: [],
    fetch: api.fetch,
    sleep: () => Promise.resolve(),
    runGit: () => Promise.reject(new Error('fixture forbids Git')),
    log: new FakeLogOutputChannel(),
    isWorkspaceTrusted: () => state.isTrusted,
    ...extra,
  })
  fixtures.own({ dispose: runtime.close })
  const host = await runtime.backend.hostFor(root)
  const session = await host.startSession({
    workspaceRoot: root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
  })
  return { root, runtime, host, session, api, state, watched: watchSessionTurns(session) }
}

describe('F20 portable session goal commands', () => {
  it('wakes the actual packaged engine, pauses durably and retains the goal in read/resume/fork', async () => {
    const rig = await setup()
    rig.api.script({ text: 'Goal work' })
    const done = rig.watched.turnDone()
    const accepted = await rig.session.controlGoal({ verb: 'set', objective: 'Implement the goal' })
    expect(accepted.turnId).toBeDefined()
    await done
    expect(rig.api.responseBodies()).toHaveLength(1)
    expect(JSON.stringify(rig.api.responseBodies()[0]?.['instructions'])).toContain(
      'Implement the goal',
    )
    await rig.session.controlGoal({ verb: 'pause' })
    const read = await rig.host.readSession(rig.session.sessionId)
    expect(read.goal).toMatchObject({ status: 'paused', objective: 'Implement the goal' })
    const resumed = await rig.host.resumeSession(rig.session.sessionId, rig.session.modelId)
    expect(resumed.history.goal).toEqual(read.goal)
    const forked = await rig.host.forkSession(rig.session.sessionId, rig.session.modelId)
    expect(forked.history.goal).toEqual(read.goal)
    expect(rig.api.responseBodies()).toHaveLength(1)
    await rig.session.controlGoal({ verb: 'clear' })
    const cleared = await rig.host.readSession(rig.session.sessionId)
    expect(cleared.goal).toBeNull()
    resumed.session.dispose()
    forked.session.dispose()
  })

  it('refuses invalid and missing goals without any model dispatch', async () => {
    const rig = await setup()
    await expect(rig.session.controlGoal({ verb: 'set', objective: '' })).rejects.toThrow(
      UI_TEXT.goalObjectiveMissing,
    )
    let problem: unknown
    try {
      await rig.session.controlGoal({ verb: 'resume' })
    } catch (error: unknown) {
      problem = error
    }
    expect(isGoalRefusedError(problem)).toBe(true)
    expect(rig.api.responseBodies()).toHaveLength(0)
  })

  it('refuses retained session commands after the owning runtime has drained', async () => {
    const rig = await setup()
    await rig.runtime.close()
    await expect(rig.session.controlGoal({ verb: 'set', objective: 'Late work' })).rejects.toThrow(
      UI_TEXT.turnStoppedByRestart,
    )
    expect(rig.api.responseBodies()).toHaveLength(0)
  })
})

describe('F23 portable user shell lifetime', () => {
  it('runs the user command locally without a model request and reports its captured row', async () => {
    const rig = await setup()
    const done = Promise.withResolvers<undefined>()
    const stop = rig.session.onEvent((event) => {
      if (event.type === 'itemCompleted') done.resolve(undefined)
    })
    try {
      const prefix = process.platform === 'win32' ? '& ' : ''
      await rig.session.runUserShell(
        `${prefix}"${process.execPath}" -e "process.stdout.write('portable-shell')"`,
      )
      await done.promise
      expect(rig.watched.events).toContainEqual(
        expect.objectContaining({
          type: 'itemCompleted',
          item: expect.objectContaining({
            status: 'completed',
            visibleOutput: expect.stringContaining('portable-shell'),
          }),
        }),
      )
      expect(rig.api.responseBodies()).toHaveLength(0)
    } finally {
      stop()
    }
  })

  it('refuses restricted user commands and unknown background task controls', async () => {
    const rig = await setup()
    rig.state.isTrusted = false
    await expect(rig.session.runUserShell('fixture-never-runs')).rejects.toThrow(
      UI_TEXT.userShellRestricted,
    )
    await expect(rig.session.stopTask('missing')).rejects.toThrow(UI_TEXT.taskNotRunning)
    expect(rig.watched.events).toHaveLength(0)
  })

  it('refuses a user command after owner release before adding a task or row', async () => {
    const rig = await setup()
    await rig.runtime.close()
    await expect(rig.session.runUserShell('fixture-never-runs')).rejects.toThrow(
      UI_TEXT.turnStoppedByRestart,
    )
    expect(rig.watched.events).toHaveLength(0)
  })
})

describe('F24 v2 portable Best-of-N attempt host', () => {
  it.each([true, false])(
    'uses the shared ledger only when attempt admission is on (%s)',
    async (isOn) => {
      const directory = await fixtures.folder('m104-pb-best-budget-')
      const budget = enginePaidBudget(directory)
      fixtures.own({ dispose: budget.dispose })
      const tariff = vi.fn(() => 0.25)
      const { paid } = paidHarness(['bestOfN'])
      const admission = runtimePaidRequestAdmission({
        budget,
        isOn: () => isOn,
        price: () => ({ costUsd: 0.4, isCurrent: () => true, receiptCost: tariff }),
      })
      const rig = await setup({
        interactivePaid: paid,
        reservePaidRequest: admission,
        paidResponseCost: admission.responseCost,
      })
      const manager = await rig.runtime.modelApiFor?.(rig.root)
      if (manager === undefined) throw new Error('fixture manager missing')
      const host = await manager.buildAttemptHost(rig.root, () => undefined)
      fixtures.own({ dispose: () => host.close() })
      const session = await host.startSession({
        workspaceRoot: rig.root,
        modelId: rig.session.modelId,
        approvalMode: 'promptUnmatched',
      })
      const watched = watchSessionTurns(session)
      rig.api.script({ text: 'attempt done' })
      const done = watched.turnDone()
      await session.sendTurn([{ type: 'text', text: 'attempt fixture' }])
      await done
      expect(rig.api.responseBodies()).toHaveLength(isOn ? 1 : 0)
      expect(tariff).toHaveBeenCalledTimes(isOn ? 1 : 0)
      await expect(budget.latestDay()).resolves.toMatchObject({ spentUsd: isOn ? 0.25 : 0 })
    },
  )
})
