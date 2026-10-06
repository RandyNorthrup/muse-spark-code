import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { ACP_PAID_OPTIONS, MHP_PANEL } from '../../src/shared/constants'
import { MHP_METHODS } from '../../src/shared/hostApi/methods'
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
    mhp: '1.1',
    kind: 'surface',
    surface: 'native-view',
    sessionId: frame.params.sessionId,
    surfaceKind: 'chat',
  }
  agent.send({ ...binding, event: 'opened' })
  agent.send({ ...binding, event: 'ready' })
  agent.send({
    mhp: '1.1',
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
        mhp: '1.1',
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
        mhp: '1.1',
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
  it('asks priced paid-use consent before enabling hosted search on the fake API', async () => {
    const agent = await open('modelApi', ['--web-search'])
    const before = fixture().api.responseBodies().length
    agent.send({
      mhp: '1.1',
      kind: 'panel',
      surface: 'native-view',
      direction: 'toHost',
      seq: 2,
      payload: { type: 'sendMessage', localId: 'paid', text: 'hello', attachmentIds: [] },
    })
    const questionSchema = z.object({
      id: z.string(),
      method: z.literal('ui/confirm'),
      params: MHP_METHODS['ui/confirm'].params,
    })
    const question = questionSchema.parse(
      await agent.wait((value) => questionSchema.safeParse(value).success),
    )
    expect(question.params.message).toContain('$')
    expect(question.params.choices.map((choice) => choice.id)).toContain(ACP_PAID_OPTIONS.deny)
    expect(fixture().api.responseBodies()).toHaveLength(before)
    agent.send({ jsonrpc: '2.0', id: question.id, result: ACP_PAID_OPTIONS.deny })
    await agent.wait((value) => JSON.stringify(value).includes('From the fake panel model.'))
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
      mhp: '1.1',
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
  it('refuses CLI trust when the native host reports an untrusted workspace', async () => {
    const agent = fixture().launch('stdio', 'modelApi', {}, ['--trust-workspace'])
    agent.sendInitialize()
    await agent.wait(
      (value) =>
        z
          .object({ error: z.object({ message: z.literal('MHP_INITIALIZE_FAILED') }) })
          .safeParse(value).success,
    )
    expect(agent.frames.some((value) => openSchema.safeParse(value).success)).toBe(false)
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
