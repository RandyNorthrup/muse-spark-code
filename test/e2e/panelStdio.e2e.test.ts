import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { MHP_PANEL } from '../../src/shared/constants'
import { panelProcessSuite } from './panelProcess'

const fixture = panelProcessSuite()
const openSchema = z.object({
  id: z.string(),
  method: z.literal('surfaces/open'),
  params: z.object({ sessionId: z.string() }),
})
const payload = z.object({ kind: z.literal('panel'), payload: z.object({ type: z.string() }) })

async function open(backend: string, args?: readonly string[]) {
  const agent = fixture().launch('stdio', backend, {}, args)
  await agent.initialize()
  const frame = openSchema.parse(await agent.wait((value) => openSchema.safeParse(value).success))
  agent.send({ jsonrpc: '2.0', id: frame.id, result: { surfaceId: 'native-view' } })
  const binding = {
    mhp: '1.3',
    kind: 'surface',
    surface: 'native-view',
    sessionId: frame.params.sessionId,
    surfaceKind: 'chat',
  }
  agent.send({ ...binding, event: 'opened' })
  agent.send({ ...binding, event: 'ready' })
  agent.send({
    mhp: '1.3',
    kind: 'panel',
    surface: 'native-view',
    direction: 'toHost',
    seq: 1,
    payload: { type: 'ready' },
  })
  return { ...agent, binding }
}

describe('runtime panel native process', () => {
  for (const backend of ['museCode', 'modelApi'])
    it(`streams the shared conversation on fake ${backend}, rejects replay, and closes`, async () => {
      const agent = await open(backend)
      await agent.wait(
        (value) =>
          payload.safeParse(value).success && payload.parse(value).payload.type === 'sessionInfo',
      )
      agent.send({
        ...agent.binding,
        event: 'opened',
        surface: 'unsupported-usage',
        surfaceKind: 'usage',
      })
      await agent.wait(
        (value) =>
          z.object({ code: z.literal('MHP_PANEL_UNKNOWN_SURFACE') }).safeParse(value).success,
      )
      agent.send({
        mhp: '1.3',
        kind: 'panel',
        surface: 'native-view',
        direction: 'toHost',
        seq: 2,
        payload: { type: 'sendMessage', localId: 'local', text: 'hello', attachmentIds: [] },
      })
      await agent.wait((value) =>
        JSON.stringify(value).includes(
          backend === 'museCode' ? 'echo: hello' : 'From the fake panel model.',
        ),
      )
      agent.send({
        mhp: '1.3',
        kind: 'panel',
        surface: 'native-view',
        direction: 'toHost',
        seq: 2,
        payload: { type: 'ready' },
      })
      await agent.wait(
        (value) => z.object({ code: z.literal('MHP_PANEL_OUT_OF_ORDER') }).safeParse(value).success,
      )
      expect(agent.output().stdout).not.toContain('LLM|')
      expect(agent.output().stderr).not.toContain('LLM|')
      agent.child.stdin.end()
      expect(await agent.exited).toBe(0)
    })
  it('refuses hosted search before a popup without a verified native catalog and ledger', async () => {
    const agent = await open('modelApi', ['--web-search'])
    const before = fixture().api.responseBodies().length
    agent.send({
      mhp: '1.3',
      kind: 'panel',
      surface: 'native-view',
      direction: 'toHost',
      seq: 2,
      payload: { type: 'sendMessage', localId: 'paid', text: 'hello', attachmentIds: [] },
    })
    await agent.wait((value) => JSON.stringify(value).includes('From the fake panel model.'))
    expect(fixture().api.responseBodies()).toHaveLength(before + 1)
    expect(
      agent.frames.some(
        (frame) => z.object({ method: z.literal('ui/confirm') }).safeParse(frame).success,
      ),
    ).toBe(false)
    expect(JSON.stringify(fixture().api.responseBodies().at(-1)?.['tools'])).not.toContain(
      'web_search',
    )
    agent.child.stdin.end()
    expect(await agent.exited).toBe(0)
  })
  it('closes when the live fake backend exits during a turn', async () => {
    const agent = await open('museCode')
    await agent.wait(
      (value) =>
        payload.safeParse(value).success && payload.parse(value).payload.type === 'sessionInfo',
    )
    agent.send({
      mhp: '1.3',
      kind: 'panel',
      surface: 'native-view',
      direction: 'toHost',
      seq: 2,
      payload: { type: 'sendMessage', localId: 'dying', text: 'die', attachmentIds: [] },
    })
    expect(await agent.exited).toBe(1)
  })
  it('refuses a v1-only offer before starting a conversation', async () => {
    const agent = fixture().launch('stdio')
    agent.sendInitialize({ minimum: 'mhp/1.0.0', maximumExclusive: 'mhp/1.1.0' })
    await agent.wait(
      (value) =>
        z
          .object({ error: z.object({ message: z.literal('MHP_INCOMPATIBLE_VERSION') }) })
          .safeParse(value).success,
    )
    agent.child.stdin.end()
    expect(await agent.exited).toBe(0)
  })
  it('initializes in restricted mode when CLI trust exceeds the native host grant', async () => {
    const agent = fixture().launch('stdio', 'modelApi', {}, ['--trust-workspace'])
    await agent.initialize()
    const frame = openSchema.parse(await agent.wait((value) => openSchema.safeParse(value).success))
    agent.send({ jsonrpc: '2.0', id: frame.id, result: { surfaceId: 'restricted-view' } })
    agent.child.stdin.end()
    expect(await agent.exited).toBe(0)
  })
  it('refuses a result that has no matching native request', async () => {
    const agent = fixture().launch('stdio')
    await agent.initialize()
    await agent.wait((value) => openSchema.safeParse(value).success)
    agent.send({
      jsonrpc: '2.0',
      id: 'unknown-native-request',
      result: { surfaceId: 'native-view' },
    })
    expect(await agent.exited).toBe(1)
  })
  it('rejects a malformed correlated native result and closes fatally', async () => {
    const agent = fixture().launch('stdio')
    await agent.initialize()
    const frame = openSchema.parse(await agent.wait((value) => openSchema.safeParse(value).success))
    agent.send({ jsonrpc: '2.0', id: frame.id, result: { bogus: true } })
    expect(await agent.exited).toBe(1)
  })
  it('replays current history on reload while preserving sequence counters', async () => {
    const agent = await open('museCode')
    await agent.wait(
      (value) =>
        payload.safeParse(value).success && payload.parse(value).payload.type === 'historyLoaded',
    )
    const before = agent.frames.length
    agent.send({
      ...agent.binding,
      event: 'reloaded',
      stateRequest: { type: 'ready', attachmentEpoch: 2 },
    })
    agent.send({ ...agent.binding, event: 'ready' })
    await agent.wait(
      (value) =>
        agent.frames.indexOf(value) >= before &&
        payload.safeParse(value).success &&
        payload.parse(value).payload.type === 'historyLoaded',
    )
    const sequences = agent.frames.flatMap((value) => {
      const frame = z.object({ direction: z.literal('toPanel'), seq: z.number() }).safeParse(value)
      return frame.success ? [frame.data.seq] : []
    })
    expect(sequences).toEqual(sequences.map((_seq, index) => index + 1))
    agent.send({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: {} })
    expect(await agent.exited).toBe(0)
    expect(agent.frames.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: null })
  })
  it('refuses invalid UTF-8 and does not dispatch a subsequent complete request', async () => {
    const agent = fixture().launch('stdio')
    agent.child.stdin.write(Buffer.from([0xff, 0x0a]))
    expect(await agent.exited).toBe(1)
    expect(agent.frames).toEqual([])
  })
  it('bounds retained document snapshots separately from admitted frame size', async () => {
    const agent = await open('modelApi')
    const path = 'a'.repeat(Math.floor(MHP_PANEL.maximumEnvelopeBytes * 0.75))
    for (let index = 0; index < 3; index += 1)
      agent.send({
        jsonrpc: '2.0',
        method: 'documents/didSave',
        params: {
          uri: `file:///${path}/${String(index)}`,
          version: 1,
          dirty: false,
          languageId: 'text',
        },
      })
    await vi.waitFor(
      () => {
        expect(agent.child.exitCode).toBe(1)
      },
      { timeout: 10_000 },
    )
    expect(await agent.exited).toBe(1)
  })
  it('refuses an incomplete EOF frame', async () => {
    const agent = fixture().launch('stdio')
    agent.child.stdin.end('{"jsonrpc":')
    expect(await agent.exited).toBe(1)
  })
})

for (const backend of ['museCode', 'modelApi'])
  it(`${backend}: new conversation retires the old view before opening a fresh binding`, async () => {
    const agent = await open(backend)
    await agent.wait(
      (value) =>
        payload.safeParse(value).success && payload.parse(value).payload.type === 'historyLoaded',
    )
    agent.send({
      mhp: '1.3',
      kind: 'panel',
      surface: 'native-view',
      direction: 'toHost',
      seq: 2,
      payload: { type: 'clearConversation' },
    })
    const closeSchema = z.object({
      id: z.string(),
      method: z.literal('surfaces/close'),
      params: z.object({ surfaceId: z.literal('native-view') }),
    })
    const close = closeSchema.parse(
      await agent.wait((value) => closeSchema.safeParse(value).success),
    )
    agent.send({ ...agent.binding, event: 'closed', droppedMessages: 0 })
    agent.send({ jsonrpc: '2.0', id: close.id, result: null })
    const fresh = openSchema.parse(
      await agent.wait(
        (value) =>
          openSchema.safeParse(value).success &&
          openSchema.parse(value).params.sessionId !== agent.binding.sessionId,
      ),
    )
    agent.send({ jsonrpc: '2.0', id: fresh.id, result: { surfaceId: 'fresh-view' } })
    const binding = { ...agent.binding, surface: 'fresh-view', sessionId: fresh.params.sessionId }
    agent.send({ ...binding, event: 'opened' })
    agent.send({ ...binding, event: 'ready' })
    agent.send({
      mhp: '1.3',
      kind: 'panel',
      surface: 'fresh-view',
      direction: 'toHost',
      seq: 1,
      payload: { type: 'ready' },
    })
    await agent.wait(
      (value) =>
        z
          .object({
            surface: z.literal('fresh-view'),
            payload: z.object({
              type: z.literal('historyLoaded'),
              sessionId: z.literal(binding.sessionId),
            }),
          })
          .safeParse(value).success,
    )
    agent.child.stdin.end()
    expect(await agent.exited).toBe(0)
  })
