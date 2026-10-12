import { afterEach, describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { FAKE_MODEL_API_BASE_URL } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { writerRig } from './helpers/accounts/writer'
import { estimateCostUsd } from '../../src/core/usage/insights'
import { parseUsd } from '../../src/shared/accountUsd'

// The vault origin must equal the origin the host acquires with (production:
// both are the Model API origin; here both are the fake origin).
const ORIGIN = new URL(FAKE_MODEL_API_BASE_URL).origin

describe('main-turn failed usage settles on its lease', () => {
  const rig = writerRig(ORIGIN, (scripted) => {
    scripted.script({
      text: 'partial',
      failed: { code: 'e', message: 'boom' },
      usage: { input: 10, output: 2 },
    })
  })
  const { api, pool, client, writer, claims } = rig
  afterEach(() => {
    expect(rig.liveLeases()).toBe(0)
  })
  const t = { api, pool, claims }
  const log = new FakeLogOutputChannel()
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
      currentWithoutNext: writer.currentWithoutNext.bind(writer),
      withinRequest: writer.withinRequest.bind(writer),
      paidClient: writer.paidClient.bind(writer),
      withLease: writer.withLease.bind(writer),
    },
  })

  it('settles known cost from a failed main response carrying usage', async () => {
    const { session, turnDone } = await startWatchedSession(host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    await session.sendTurn([{ type: 'text', text: 'Hello' }])
    await turnDone()
    expect(api.responseBodies()).toHaveLength(1)
    expect(t.claims).toHaveLength(1)
    expect(t.claims[0]?.actual).not.toBeNull()
    expect(t.claims[0]?.actual).toEqual(
      parseUsd(
        estimateCostUsd({ inputTokens: 10, outputTokens: 2, cachedTokens: 0 }, 'muse-spark-1.3'),
      ),
    )
  })
})
