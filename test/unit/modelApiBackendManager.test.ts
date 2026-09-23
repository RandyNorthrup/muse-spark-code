import { describe, expect, it } from 'vitest'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { noopToolIo } from './helpers/fakeToolIo'

function manager(workspaceRoot: string | undefined) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  return {
    api,
    log,
    manager: new ModelApiBackendManager({
      log,
      getApiKey: () => Promise.resolve('LLM|1|secret'),
      workspaceRoot,
      io: noopToolIo,
      fetch: api.fetch,
      newId: () => 'id',
      now: () => 0,
      sleep: () => Promise.resolve(),
      random: () => 0,
      personalSkillsRoot: undefined,
      isWorkspaceTrusted: () => true,
    }),
  }
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
})
