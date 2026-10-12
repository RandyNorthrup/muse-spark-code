import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { AccountRequestWriter } from '../../src/core/accounts/requestWriter'
import { AccountStore } from '../../src/core/providers/accounts'
import type { AccountCredentialVault } from '../../src/core/providers/accountCredentialRecord'
import { poolMetadata } from './helpers/accounts/metadata'
import { poolRig } from './helpers/accounts/pool'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'

const ORIGIN = 'https://provider.invalid'

describe('main-turn failed usage settles on its lease', () => {
  const secret = 'fake-only-a'
  const api = fakeModelApi({ keys: [secret] })
  api.script({
    text: 'partial',
    failed: { code: 'e', message: 'boom' },
    usage: { input: 10, output: 2 },
  })
  const t = poolRig()
  const keys = new Map(t.rows.map((row) => [row.id, secret]))
  const store = new AccountStore(poolMetadata(t.rows, ORIGIN), {
    read: (binding) =>
      Promise.resolve({
        ...binding,
        v: 1,
        auth: 'apiKey',
        secret: keys.get(binding.account) ?? '',
      }),
    readForRemoval: () => Promise.resolve(undefined),
    write: (binding, credential) => {
      keys.set(binding.account, credential.secret)
      return Promise.resolve()
    },
    remove: (binding) => {
      keys.delete(binding.account)
      return Promise.resolve()
    },
  } satisfies AccountCredentialVault)
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const writer = new AccountRequestWriter({
    store,
    pool: t.pool,
    refresh: () => Promise.resolve(),
    defaults: () => ({ account: 'a', isInteractive: true, hasPoolFlag: true }),
    createClient: async (_binding, apiKey, request, isCurrent) => {
      const selected = client.withAccountKey(apiKey, isCurrent)
      const models = await selected.listModels()
      if (!models.includes(request.modelId)) throw new Error(`unknown model ${request.modelId}`)
      return {
        streamResponse: selected.streamResponse.bind(selected),
        countInputTokens: selected.countInputTokens.bind(selected),
        listModels: selected.listModels.bind(selected),
        currentKeyDigest: selected.currentKeyDigest.bind(selected),
        retryDelayMs: selected.retryDelayMs.bind(selected),
        waitBeforeRetry: selected.waitBeforeRetry.bind(selected),
        paidClient: selected,
      }
    },
  })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log,
    }),
    accountRequests: {
      acquire: writer.acquire.bind(writer),
      within: writer.within.bind(writer),
      current: writer.current.bind(writer),
      withinRequest: writer.withinRequest.bind(writer),
      paidClient: writer.paidClient.bind(writer),
    },
  })

  it('settles known cost from a failed main response carrying usage', async () => {
    const { session, turnDone } = await startWatchedSession(host, '/ws', 'allowAll')
    await session.sendTurn([{ type: 'text', text: 'Hello' }])
    await turnDone()
    expect(t.claims).toHaveLength(1)
    expect(t.claims[0]?.actual).not.toBeNull()
  })
})
