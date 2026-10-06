import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRuntimeBackend } from '../../../src/runtime/backends'
import { isGoalRefusedError } from '../../../src/core/agent/agentBackend'
import { SECRET_KEYS, UI_TEXT } from '../../../src/shared/constants'
import { FakeLogOutputChannel, memorySecrets } from '../../unit/helpers/fakes'
import { fakeModelApi, FAKE_MODEL_API_KEY } from '../../unit/helpers/fakeModelApi'
import { buildModelApiBundle } from '../../unit/helpers/modelApiBundle'
import { watchSessionTurns } from '../../unit/helpers/sessionTurns'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
const dist = { folder: '' }
beforeAll(async () => {
  dist.folder = await mkdtemp(path.join(tmpdir(), 'm104-pb-session-dist-'))
  await buildModelApiBundle(dist.folder)
})
afterAll(async () => {
  await rm(dist.folder, { recursive: true, force: true })
})

async function setup() {
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
    env: {},
    homeDir: root,
    secrets,
    museCodeCredentials: [],
    fetch: api.fetch,
    sleep: () => Promise.resolve(),
    runGit: () => Promise.reject(new Error('fixture forbids Git')),
    log: new FakeLogOutputChannel(),
    isWorkspaceTrusted: () => state.isTrusted,
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
