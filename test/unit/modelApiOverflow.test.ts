import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { ModelApiClientDeps } from '../../src/core/backends/modelapi/client'
import type { ContextModel, ContextOverflowEvent } from '../../src/core/providers/overflow'
import { EN } from '../../src/shared/l10n/en'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

async function setup(
  modelId = 'muse-spark-1.3',
  contextModel?: ModelApiHostDeps['contextModel'],
  clientChanges: Partial<ModelApiClientDeps> = {},
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'read.txt': 'line\n'.repeat(5000) }, '/ws')
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: api.fetch,
    ...clientChanges,
  })
  const overflowEvents: ContextOverflowEvent[] = []
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io, log }),
    contextModel,
    confirmContributorModel: () => Promise.resolve(true),
    onContextOverflow: (event) => {
      overflowEvents.push(event)
    },
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId,
    approvalMode: 'onRequest',
  })
  return { api, host, session, overflowEvents, ...watchSessionTurns(session) }
}

async function send(harness: Awaited<ReturnType<typeof setup>>, text = 'hello') {
  const done = harness.turnDone()
  await harness.session.sendTurn([{ type: 'text', text }])
  await done
}

describe('Model API context protection (M101 item 6 / F4)', () => {
  it('exposes a classified HTTP overflow event without retrying or leaking provider prose', async () => {
    const t = await setup('anthropic/claude', () => ({
      format: 'anthropic',
      contextTokens: 65_536,
    }))
    t.api.script({
      httpError: {
        status: 400,
        body: { error: { message: 'prompt is too long: provider-private-detail' } },
      },
    })
    await send(t)
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(t.overflowEvents).toEqual([
      {
        sessionId: t.session.sessionId,
        turnId: expect.any(String),
        modelId: 'anthropic/claude',
        kind: 'error',
        contextTokens: 65_536,
      },
    ])
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      errorKind: 'context_overflow',
      reason: EN.contextWindowFull,
    })
    expect(JSON.stringify(t.events)).not.toContain('provider-private-detail')
    await t.host.close()
  })

  it('classifies existing canonical response.failed errors through the same path', async () => {
    const t = await setup()
    t.api.script({
      failed: { code: 'context_length_exceeded', message: 'The input exceeds the context window' },
    })
    await send(t)
    expect(t.overflowEvents[0]?.kind).toBe('error')
    expect(t.api.responseBodies()).toHaveLength(1)
    await t.host.close()
  })

  it('keeps 429 retries separate even when the error mentions context overflow', async () => {
    const t = await setup()
    t.api.script(
      { httpError: { status: 429, body: { error: { message: 'prompt is too long' } } } },
      { text: 'recovered' },
    )
    await send(t)
    expect(t.overflowEvents).toEqual([])
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await t.host.close()
  })

  it('keeps quota refusals on the ordinary error path without overflow recovery', async () => {
    const t = await setup()
    t.api.script({
      failed: {
        code: 'insufficient_quota',
        message: 'Token limit exceeded for your current quota',
      },
    })
    await send(t)
    expect(t.overflowEvents).toEqual([])
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      errorKind: 'modelApi',
    })
    expect(JSON.stringify(t.events)).not.toContain(EN.contextWindowFull)
    expect(t.api.responseBodies()).toHaveLength(1)
    await t.host.close()
  })

  it('starts and answers in an 8192-token Ollama window with the real static prompt and tools', async () => {
    const t = await setup('ollama/loaded', () => ({ format: 'ollama', contextTokens: 8192 }))
    t.api.script({ text: 'answer', usage: { input: 1000, output: 10 } })
    await send(t)
    expect(t.api.responseBodies()).toHaveLength(1)
    const body = t.api.responseBodies()[0]
    expect(body).toMatchObject({
      instructions: expect.any(String),
      tools: expect.arrayContaining([expect.objectContaining({ name: 'read_file' })]),
    })
    const upperBytes = Buffer.byteLength(
      JSON.stringify([body?.['instructions'], body?.['tools'], body?.['input']]),
    )
    expect(upperBytes).toBeGreaterThan(8192)
    expect(t.overflowEvents).toEqual([])
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    expect(t.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ kind: 'agentMessage', text: 'answer' }),
      }),
    )
    await t.host.close()
  })

  it('dispatches when the lower estimate exceeds the old reserve but fits the full window', async () => {
    const t = await setup('ollama/loaded', () => ({ format: 'ollama', contextTokens: 8192 }))
    t.api.script({ text: 'answer', usage: { input: 7500, output: 10 } })
    await send(t, 'hello '.repeat(3500))
    expect(t.api.responseBodies()).toHaveLength(1)
    const body = t.api.responseBodies()[0]
    const lowerTokens = Math.floor(
      Buffer.byteLength(
        JSON.stringify([body?.['instructions'], body?.['tools'], body?.['input']]),
      ) / 4,
    )
    expect(lowerTokens).toBeGreaterThan(6144)
    expect(lowerTokens).toBeLessThanOrEqual(8192)
    expect(t.overflowEvents).toEqual([])
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await t.host.close()
  })

  it.each([
    { input: 65_537, output: 10, kind: 'input-above-window' },
    { input: 65_000, output: 0, kind: 'empty-near-window' },
  ])('detects silent $kind and still counts its billed usage', async ({ input, output, kind }) => {
    const t = await setup('ollama/loaded', () => ({ format: 'ollama', contextTokens: 65_536 }))
    t.api.script({
      usage: { input, output },
      calls: [{ name: 'read_file', arguments: '{"path":"read.txt"}' }],
    })
    await send(t)
    expect(t.overflowEvents[0]?.kind).toBe(kind)
    expect(t.events.find((event) => event.type === 'tokenUsage')).toMatchObject({
      inputTokens: input,
      outputTokens: output,
    })
    expect(
      t.events.some((event) => event.type === 'itemStarted' && event.item.kind === 'tool'),
    ).toBe(false)
    expect(t.api.responseBodies()).toHaveLength(1)
    await t.host.close()
  })

  it('refuses preflight before a request or pre-model hook when the selected window cannot fit', async () => {
    const t = await setup('custom/small', () => ({ format: 'chat', contextTokens: 2000 }))
    await send(t)
    expect(t.api.responseBodies()).toEqual([])
    expect(t.overflowEvents[0]).toMatchObject({
      modelId: 'custom/small',
      kind: 'preflight',
      contextTokens: 2000,
    })
    await t.host.close()
  })

  it('rechecks the loaded window at final admission after asynchronous key retrieval', async () => {
    let window = 65_536
    const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
    const t = await setup('custom/moving', () => ({ format: 'chat', contextTokens: window }), {
      apiKey: async () => {
        window = 2000
        return await settings.apiKey()
      },
    })
    await send(t)
    expect(t.api.responseBodies()).toEqual([])
    expect(t.overflowEvents[0]?.kind).toBe('preflight')
    await t.host.close()
  })

  it('retains the window refreshed during key retrieval at final admission', async () => {
    let window = 65_536
    const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
    const t = await setup('ollama/loaded', () => ({ format: 'ollama', contextTokens: window }), {
      apiKey: async () => {
        window = 16_384
        return await settings.apiKey()
      },
    })
    t.api.script({
      onRequest: () => {
        window = 65_536
      },
      text: 'answer',
      usage: { input: 20_000, output: 10 },
    })
    await send(t)
    expect(t.overflowEvents).toEqual([
      expect.objectContaining({ kind: 'input-above-window', contextTokens: 16_384 }),
    ])
    await t.host.close()
  })

  it('uses the sent model format when the selection changes during its request', async () => {
    const held = Promise.withResolvers<undefined>()
    const received = Promise.withResolvers<undefined>()
    const t = await setup('anthropic/first', (modelId) => ({
      format: modelId === 'anthropic/first' ? 'anthropic' : 'gemini',
      contextTokens: 65_536,
    }))
    t.api.script({
      hold: held.promise,
      onRequest: () => {
        received.resolve(undefined)
      },
      failed: { code: 'bad_request', message: 'prompt is too long' },
    })
    const sending = send(t)
    await Promise.race([received.promise, sending])
    await t.session.setModel('gemini/second')
    held.resolve(undefined)
    await sending
    expect(t.overflowEvents[0]?.modelId).toBe('anthropic/first')
    await t.host.close()
  })

  it.each([
    { admitted: 65_536, refreshed: 8192, terminal: 'completed' },
    { admitted: 8192, refreshed: 65_536, terminal: 'failed' },
  ])(
    'classifies completion with the admitted $admitted window after refresh to $refreshed',
    async ({ admitted, refreshed, terminal }) => {
      const held = Promise.withResolvers<undefined>()
      const received = Promise.withResolvers<undefined>()
      let window = admitted
      const t = await setup('ollama/loaded', () => ({ format: 'ollama', contextTokens: window }))
      t.api.script({
        hold: held.promise,
        onRequest: () => {
          received.resolve(undefined)
        },
        text: 'answer',
        usage: { input: 9000, output: 10 },
      })
      const sending = send(t)
      await Promise.race([received.promise, sending])
      window = refreshed
      held.resolve(undefined)
      await sending
      expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({ terminal })
      expect(t.events.find((event) => event.type === 'contextUsage')).toMatchObject({
        windowTokens: admitted,
      })
      expect(t.overflowEvents).toEqual(
        terminal === 'completed'
          ? []
          : [expect.objectContaining({ kind: 'input-above-window', contextTokens: admitted })],
      )
      await t.host.close()
    },
  )

  it('classifies errors and reports the window from final admission after registry refresh', async () => {
    const held = Promise.withResolvers<undefined>()
    const received = Promise.withResolvers<undefined>()
    let row: ContextModel = { format: 'chat', contextTokens: 65_536 }
    const t = await setup('custom/loaded', () => row)
    t.api.script({
      hold: held.promise,
      onRequest: () => {
        received.resolve(undefined)
      },
      failed: { code: 'bad_request', message: 'Maximum prompt length is 8192' },
    })
    const sending = send(t)
    await Promise.race([received.promise, sending])
    row = { format: 'ollama', contextTokens: 8192 }
    held.resolve(undefined)
    await sending
    expect(t.overflowEvents).toEqual([
      expect.objectContaining({ kind: 'error', contextTokens: 65_536 }),
    ])
    await t.host.close()
  })

  it('reads the selected window for pressure, model listing and compaction, which remains available', async () => {
    let window = 65_536
    const t = await setup('muse-spark-1.3', () => ({ format: 'responses', contextTokens: window }))
    t.api.script({ text: 'history', usage: { input: 60_000, output: 10 } })
    await send(t)
    expect(t.events.find((event) => event.type === 'contextUsage')).toMatchObject({
      windowTokens: 65_536,
      pressure: 'high',
    })
    expect(await t.host.listModels(t.session.sessionId)).toContainEqual(
      expect.objectContaining({ modelId: 'muse-spark-1.3', contextLimit: 65_536 }),
    )
    window = 2000
    t.api.inputTokens = 42
    t.api.script({ text: 'summary' })
    await expect(t.session.compact()).resolves.toMatchObject({ status: 'accepted' })
    expect(t.events.findLast((event) => event.type === 'contextUsage')).toMatchObject({
      usedTokens: 42,
      windowTokens: 2000,
    })
    expect(t.api.responseBodies()).toHaveLength(2)
    await t.host.close()
  })

  it.each([
    { modelId: 'custom/unknown', hasResolver: false },
    { modelId: 'muse-spark-compatible/unknown', hasResolver: false },
    { modelId: 'muse-spark-unknown', hasResolver: false },
    { modelId: 'muse-spark-1.3', hasResolver: true },
    { modelId: 'muse-spark-unknown', hasResolver: true },
  ])(
    'uses no invented Meta window for $modelId (resolver: $hasResolver)',
    async ({ modelId, hasResolver }) => {
      const t = await setup(modelId, hasResolver ? () => undefined : undefined)
      t.api.script({ text: 'answer', usage: { input: 2_000_000, output: 1 } })
      await send(t)
      expect(t.overflowEvents).toEqual([])
      expect(t.events.some((event) => event.type === 'contextUsage')).toBe(false)
      expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      if (hasResolver) {
        expect(await t.host.listModels(t.session.sessionId)).toContainEqual(
          expect.objectContaining({ modelId: 'muse-spark-1.3', contextLimit: undefined }),
        )
      }
      await t.host.close()
    },
  )

  it.each([
    'muse-spark-1.1',
    'muse-spark-1.2',
    'muse-spark-1.3',
    'muse-spark-1.2-contributor',
    'muse-spark-1.3-contributor',
  ])('retains the verified legacy Muse window without a resolver for %s', async (modelId) => {
    const t = await setup(modelId)
    await send(t)
    expect(t.events.find((event) => event.type === 'contextUsage')).toMatchObject({
      windowTokens: 1_048_576,
    })
    expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await t.host.close()
  })
})
