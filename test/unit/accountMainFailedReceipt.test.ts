import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { FAKE_MODEL_API_BASE_URL } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { writerRig } from './helpers/accounts/writer'

// The vault origin must equal the origin the host acquires with (production:
// both are the Model API origin; here both are the fake origin).
const ORIGIN = new URL(FAKE_MODEL_API_BASE_URL).origin

describe('main-turn failed usage settles on its lease', () => {
  const { api, pool, client, writer, claims } = writerRig(ORIGIN, (scripted) => {
    scripted.script({
      text: 'partial',
      failed: { code: 'e', message: 'boom' },
      usage: { input: 10, output: 2 },
    })
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
      withinRequest: writer.withinRequest.bind(writer),
      paidClient: writer.paidClient.bind(writer),
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
  })
})
