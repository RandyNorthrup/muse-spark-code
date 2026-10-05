import { describe, expect, it } from 'vitest'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'

describe('model reasoning producer identity', () => {
  it('keeps same-model reasoning, filters switches, and persists the producing identity', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const store = memorySessionStore()
    const client = fakeModelApiClient(api, log)
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client,
        workspaceRoot: ROOT,
        io: memoryToolIo({}, ROOT),
        log,
      }),
      store,
      models: createProviderRegistry({
        models: () =>
          Promise.resolve([
            {
              ref: 'openai/gpt-5.6',
              origin: 'https://example.test',
              evidence: { capabilities: { toolCalling: true } },
              pricing: { kind: 'unpriced' },
            },
          ]),
        createClient: () => Promise.resolve(client),
        isCurrent: () => true,
      }),
    })
    const session = await host.startSession({
      workspaceRoot: ROOT,
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    const { turnDone } = watchSessionTurns(session)
    const send = async () => {
      await session.sendTurn([{ type: 'text', text: 'continue' }])
      await turnDone()
    }
    try {
      api.script({ reasoning: 'private reasoning', text: 'first' })
      await send()
      api.script({ text: 'second' })
      await send()
      const hasReasoning = (body: Record<string, unknown> | undefined) =>
        JSON.stringify(body?.['input']).includes('encrypted_content')
      expect(hasReasoning(api.responseBodies()[1])).toBe(true)
      await session.setModel('openai/gpt-5.6')
      await send()
      expect(hasReasoning(api.responseBodies()[2])).toBe(false)
      expect(JSON.stringify(api.responseBodies()[2]?.['input'])).toContain('first')
      const saved = await store.load(session.sessionId)
      const parsed = parseStoredSession(saved)
      expect(parsed.ok).toBe(true)
      expect(
        parsed.ok
          ? parsed.session.replay.find((entry) => entry.item.type === 'reasoning')?.producer
          : undefined,
      ).toEqual({ provider: 'meta', model: 'muse-spark-1.3' })
      expect(saved?.replay.find((entry) => entry.item.type === 'reasoning')?.producer).toEqual({
        provider: 'meta',
        model: 'muse-spark-1.3',
      })
      await session.setModel('muse-spark-1.2')
      await send()
      expect(hasReasoning(api.responseBodies()[3])).toBe(false)
      api.script({ text: 'summary after switching' })
      await session.compact()
      expect(hasReasoning(api.responseBodies()[4])).toBe(false)
    } finally {
      await host.close()
    }
  })
})
