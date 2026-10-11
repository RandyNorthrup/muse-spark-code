import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

describe('parallel session save failures (RVM101P2 F1)', () => {
  it('drains a blocked A after B fails under default Node rejection handling', async () => {
    // Run the real host without Vitest's unhandledRejection listener or
    // NODE_OPTIONS. An unobserved rejection must terminate this child.
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import assert from 'node:assert/strict'
          import { setTimeout as delay } from 'node:timers/promises'
          import { ModelApiHost } from './src/core/backends/modelapi/ModelApiHost'
          import { fakeModelApi, fakeModelApiClient, FAKE_MODEL_API_ACCOUNT_ID } from './test/unit/helpers/fakeModelApi'
          import { memorySessionStore } from './test/unit/helpers/fakeSessionStore'
          import { memoryToolIo } from './test/unit/helpers/fakeToolIo'
          import { memoryContextIo } from './test/unit/helpers/fakeContextIo'

          async function probe() {
            const failed = Promise.withResolvers()
            const releaseA = Promise.withResolvers()
            const writes = []
            const log = { trace() {}, info() {}, error() {}, warn(message) { failed.resolve(message) } }
            const store = memorySessionStore()
            const io = memoryToolIo({}, '/ws')
            let ids = 0
            const host = new ModelApiHost({
              client: fakeModelApiClient(fakeModelApi(), log),
              workspaceRoot: '/ws', platform: 'linux', io,
              contextIo: memoryContextIo(io.files), newId: () => String(++ids),
              now: () => 1000000, log, store,
              personalSkillsRoot: undefined, personalAgentsRoot: undefined,
              isWorkspaceTrusted: () => true, isConfidentialWorkspace: () => false,
              confirmContributorModel: async () => false,
              describeEnvironment: async () => ({ git: undefined }),
              isPaidFeatureOn: () => false, notePaidUse() {},
              promptCacheRetention: () => 'in_memory', sessionBudgetUsd: () => 0,
              showReplyUsage: () => false, memory: undefined,
              getAccountId: async () => FAKE_MODEL_API_ACCOUNT_ID,
              allowsPaidUse: async () => false, noteSubagentUsage() {},
            })
            const options = { workspaceRoot: '/ws', modelId: 'muse-spark-1.3', approvalMode: 'promptUnmatched' }
            const a = await host.startSession(options)
            const b = await host.startSession(options)
            const save = store.save.bind(store)
            store.save = async (snapshot) => {
              if (snapshot.sessionId === b.sessionId) throw new Error('fast save failed')
              await releaseA.promise
              await save(snapshot)
              writes.push(snapshot.sessionId)
            }
            await a.setModel('muse-spark-1.2')
            await b.setModel('muse-spark-1.2')
            assert.match(await failed.promise, /fast save failed/)
            let isDrained = false
            const drain = host.flush().then(() => { isDrained = true })
            await delay(20)
            assert.equal(isDrained, false)
            releaseA.resolve()
            await drain
            assert.deepEqual(writes, [a.sessionId])
            await host.close()
            process.stdout.write('drain completed')
          }
          void probe()
        `,
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      logLevel: 'silent',
    })
    const child = spawnSync(process.execPath, [], {
      input: bundle.outputFiles[0]?.text,
      encoding: 'utf8',
      env: { NODE_OPTIONS: '' },
      timeout: 10_000,
    })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
    expect(child.stdout).toBe('drain completed')
  })
})
