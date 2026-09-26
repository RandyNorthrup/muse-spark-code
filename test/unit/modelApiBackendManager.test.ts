import { describe, expect, it } from 'vitest'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { noopToolIo } from './helpers/fakeToolIo'

/** A manager on the fake API with no waits, over the given root and store. */
function managerOn(
  workspaceRoot: string | undefined,
  store: SessionStore | undefined,
  log = new FakeLogOutputChannel(),
) {
  const api = fakeModelApi()
  return {
    api,
    log,
    manager: new ModelApiBackendManager({
      log,
      getApiKey: () => Promise.resolve('LLM|1|secret'),
      workspaceRoot,
      io: noopToolIo,
      contextIo: memoryContextIo(new Map()),
      fetch: api.fetch,
      newId: () => 'id',
      now: () => 0,
      sleep: () => Promise.resolve(),
      random: () => 0,
      personalSkillsRoot: undefined,
      isWorkspaceTrusted: () => true,
      store,
      describeEnvironment: () => Promise.resolve({ git: undefined }),
      isPaidFeatureOn: () => false,
      notePaidUse: () => undefined,
      memory: undefined,
    }),
  }
}

function manager(workspaceRoot: string | undefined) {
  return managerOn(workspaceRoot, undefined)
}

describe('ModelApiBackendManager', () => {
  it('creates one host per window, lists its models, and forgets it on dispose', async () => {
    const m = manager('/ws')
    expect(m.manager.isRunning).toBe(false)
    const host = await m.manager.ensureHost()
    expect(await m.manager.ensureHost()).toBe(host)
    expect(m.manager.isRunning).toBe(true)
    expect(host.info).toMatchObject({ kind: 'modelApi', serverName: 'meta-model-api' })
    const models = await host.listModels()
    expect(models.map((model) => model.modelId)).toEqual([
      'muse-spark-1.3',
      'muse-spark-1.3-contributor',
      'muse-spark-1.2',
    ])
    expect(m.api.requests[0]?.headers['Authorization']).toBe('Bearer LLM|1|secret')
    await m.manager.dispose()
    expect(m.manager.isRunning).toBe(false)
    expect(m.log.info).toHaveBeenCalledWith(expect.stringContaining('Model API backend ready'))
  })

  it('refuses to start without a workspace', async () => {
    await expect(manager(undefined).manager.ensureHost()).rejects.toThrow('Open a folder first')
  })

  it('builds one host for concurrent callers, after the stored sessions are read (D25)', async () => {
    let lists = 0
    const store = {
      list: async () => {
        lists += 1
        await Promise.resolve()
        return []
      },
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    const [first, second] = await Promise.all([m.ensureHost(), m.ensureHost()])
    expect(second).toBe(first)
    expect(lists).toBe(1)
  })

  it('forgets a failed build so the next call tries again (D25)', async () => {
    let isBroken = true
    const store = {
      list: () => (isBroken ? Promise.reject(new Error('disk gone')) : Promise.resolve([])),
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    await expect(m.ensureHost()).rejects.toThrow('disk gone')
    expect(m.isRunning).toBe(false)
    isBroken = false
    await expect(m.ensureHost()).resolves.toBeDefined()
  })
})

/** A manager over a given session store, for the build-once cases. */
function managerWith(overrides: { store: SessionStore }) {
  return managerOn('/ws', overrides.store).manager
}
