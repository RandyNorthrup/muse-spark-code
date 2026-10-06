// Synthetic events exercise the existing StreamEvent contract, not a live
// U9 receipt: lane 0's supplied capture explicitly lacks the raw deltas.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  type CreateResponseBody,
  type FunctionCallItem,
  outputItemSchema,
  type StreamEvent,
  streamEventSchema,
} from '../../src/core/backends/modelapi/schemas'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo, hookResult } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { UpdateTranslator } from '../../src/acp/translate'
import { TOOL_ARGUMENT_PREVIEW_INTERVAL_MS } from '../../src/shared/constants'

const ROOT = '/ws'
const WRITE_PROMPT = [{ type: 'text' as const, text: 'write the file' }]
const ARGUMENTS = JSON.stringify({ path: 'new.txt', content: 'first\nsecond\nthird' })
const CALL: FunctionCallItem = {
  type: 'function_call',
  id: 'wire-call',
  call_id: 'call',
  name: 'write_file',
  arguments: ARGUMENTS,
}

function terminal(output: readonly z.infer<typeof outputItemSchema>[]): StreamEvent {
  return {
    type: 'response.completed',
    response: { id: 'response', status: 'completed', output: [...output] },
  }
}

async function setup(options: Partial<ModelApiHostDeps> = {}) {
  const io = memoryToolIo({}, ROOT)
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(fakeModelApi(), log)
  const write = vi.spyOn(io, 'writeFile')
  const shell = vi.spyOn(io, 'runShell').mockResolvedValue(hookResult('{}'))
  const hook = vi.fn(() => Promise.resolve(hookResult('{}')))
  io.runHook = hook
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    argumentPreviewCapabilities: () => ({
      tools: { streamingArguments: { state: 'yes', value: true } },
    }),
    ...options,
  })
  return {
    host,
    client,
    io,
    write,
    shell,
    hook,
    ...(await startWatchedSession(host, ROOT, 'allowAll')),
  }
}

function controlledStream(
  client: ReturnType<typeof fakeModelApiClient>,
  events: readonly StreamEvent[],
) {
  const gate = Promise.withResolvers<undefined>()
  const reached = Promise.withResolvers<undefined>()
  const bodies: string[] = []
  let attempt = 0
  vi.spyOn(client, 'streamResponse').mockImplementation(async function* (body, signal) {
    bodies.push(JSON.stringify(body))
    attempt += 1
    if (attempt > 1) {
      yield terminal([])
      return
    }
    for (const event of events) yield event
    reached.resolve(undefined)
    await gate.promise
    signal.throwIfAborted()
    yield {
      type: 'response.function_call_arguments.done',
      item_id: 'wire-call',
      arguments: ARGUMENTS,
    }
    yield { type: 'response.output_item.done', item: CALL }
    yield terminal([CALL])
  })
  return { gate, reached, bodies }
}

function previewEvents(events: readonly AgentEvent[]) {
  return events.filter((event) => event.type === 'toolArgumentPreview')
}

const DELTAS: readonly StreamEvent[] = [
  { type: 'response.output_item.added', item: { ...CALL, arguments: '' } },
  {
    type: 'response.function_call_arguments.delta',
    item_id: 'wire-call',
    delta: ARGUMENTS.slice(0, -2),
  },
]

describe('Model API argument preview admission', () => {
  it('never executes, asks or calls a tool hook on a delta, then reuses the row after done', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'pre-hook' }] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'post-hook' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    const h = await setup({ loadHooks: () => Promise.resolve(hooks), isHooksEnabled: () => true })
    const stream = controlledStream(h.client, DELTAS)
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(h.write).not.toHaveBeenCalled()
      expect(h.shell).not.toHaveBeenCalled()
      expect(h.hook).not.toHaveBeenCalled()
      expect(
        h.events.some(
          (event) => event.type === 'approvalRequested' || event.type === 'questionRequested',
        ),
      ).toBe(false)
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('first\nsecond\n')
      const previewId = previewEvents(h.events)[0]?.item.itemId
      expect(h.session.history()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            itemId: previewId,
            args: '',
            argumentPreview: expect.any(Object),
          }),
        ]),
      })
      stream.gate.resolve(undefined)
      await done
      expect(h.write).toHaveBeenCalledOnce()
      expect(h.hook).toHaveBeenCalledTimes(2)
      const completed = h.events.find(
        (event) => event.type === 'itemCompleted' && event.item.tool === 'write_file',
      )
      expect(completed).toMatchObject({
        item: { itemId: previewId, status: 'completed', args: ARGUMENTS },
      })
      expect(
        h.session.snapshot().transcript.some(({ item }) => item.argumentPreview !== undefined),
      ).toBe(false)
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it.each(['no', 'unknown'] as const)(
    'keeps previews off when the selected record says %s',
    async (state) => {
      const h = await setup({
        argumentPreviewCapabilities: () => ({ tools: { streamingArguments: { state } } }),
      })
      const stream = controlledStream(h.client, DELTAS)
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        expect(previewEvents(h.events)).toEqual([])
        stream.gate.resolve(undefined)
        await done
        expect(h.write).toHaveBeenCalledOnce()
      } finally {
        stream.gate.resolve(undefined)
        await h.host.close()
      }
    },
  )

  it('keeps on/off request bytes identical and sends no preview fields into replay', async () => {
    const requests: string[][] = []
    for (const isEnabled of [false, true]) {
      const h = await setup(isEnabled ? {} : { argumentPreviewCapabilities: undefined })
      const stream = controlledStream(h.client, DELTAS)
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        stream.gate.resolve(undefined)
        await done
        requests.push(stream.bodies)
        expect(stream.bodies).toHaveLength(2)
        expect(stream.bodies.join('')).not.toContain('argumentPreview')
        expect(
          h.session.snapshot().replay.find(({ item }) => item.type === 'function_call')?.item,
        ).toEqual(CALL)
      } finally {
        stream.gate.resolve(undefined)
        await h.host.close()
      }
    }
    expect(requests[1]).toEqual(requests[0])
  })

  it('waits for a complete response even after arguments.done and deduplicates identical previews', async () => {
    const h = await setup()
    const stream = controlledStream(h.client, [
      ...DELTAS,
      { type: 'response.function_call_arguments.done', item_id: 'wire-call', arguments: ARGUMENTS },
      { type: 'response.function_call_arguments.delta', item_id: 'wire-call', delta: 'ignored' },
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(h.write).not.toHaveBeenCalled()
      expect(h.hook).not.toHaveBeenCalled()
      expect(previewEvents(h.events)).toHaveLength(3)
      stream.gate.resolve(undefined)
      await done
      expect(h.write).toHaveBeenCalledOnce()
      expect(previewEvents(h.events)).toHaveLength(3)
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('stops resending an unchanged bounded prefix while consuming the rest of the stream', async () => {
    const h = await setup()
    const stream = controlledStream(h.client, [
      DELTAS[0]!,
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta: '{"content":"' + 'x'.repeat(20_000),
      },
      ...Array.from({ length: 10 }, (): StreamEvent => ({
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta: 'tail',
      })),
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(previewEvents(h.events)).toHaveLength(2)
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview.truncated).toBe(true)
      stream.gate.resolve(undefined)
      await done
      expect(h.write).toHaveBeenCalledOnce()
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it.each(['failure', 'omitted'] as const)(
    'settles %s calls as interrupted without executing',
    async (outcome) => {
      const h = await setup()
      vi.spyOn(h.client, 'streamResponse').mockImplementation(async function* () {
        for (const event of DELTAS) yield event
        await Promise.resolve()
        if (outcome === 'failure') yield { type: 'error', message: 'synthetic failure' }
        else yield terminal([])
      })
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await done
        expect(h.write).not.toHaveBeenCalled()
        expect(h.hook).not.toHaveBeenCalled()
        expect(
          h.events.some(
            (event) => event.type === 'itemCompleted' && event.item.status === 'interrupted',
          ),
        ).toBe(true)
        expect(
          h.session.snapshot().transcript.some(({ item }) => item.argumentPreview !== undefined),
        ).toBe(false)
      } finally {
        await h.host.close()
      }
    },
  )

  it('scrubs split and escaped secrets before the shared event and never exposes raw arguments', async () => {
    const h = await setup()
    const args = String.raw`{"content":"safe\n\u004cLM_` + 'x'.repeat(24) + String.raw`\nafter\n"}`
    const stream = controlledStream(h.client, [
      DELTAS[0]!,
      ...Array.from(args, (delta): StreamEvent => ({
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta,
      })),
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      for (const event of previewEvents(h.events)) {
        expect(event.item.args).toBe('')
        expect(event.item.argumentPreview.text).not.toContain('LLM_')
      }
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it.each([
    [String.raw`{"\u0070assword":"dummy-first\n`, 'dummy-second"}'],
    [String.raw`{"\u0070ass`, String.raw`word":"dummy-first\"dummy-second"}`],
    [String.raw`[{"password":"dummy-first\uD83D`, String.raw`\uDE00dummy-second"}]`],
    [String.raw`{"password":{"private-name":"dummy-first\n`, 'dummy-second"}}'],
    [String.raw`{"password":[[{"private-name":"dummy-first\n`, 'dummy-second"}]]}'],
  ])('keeps decoded sensitive values out of events, history and ACP: %s', async (first, second) => {
    const h = await setup()
    const frames = [
      DELTAS[0],
      { type: 'response.function_call_arguments.delta', item_id: 'wire-call', delta: first },
      { type: 'response.function_call_arguments.delta', item_id: 'wire-call', delta: second },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'wire-call',
        arguments: first + second,
      },
    ].map((frame) => streamEventSchema.parse(frame))
    const stream = controlledStream(h.client, frames)
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      const translator = new UpdateTranslator(ROOT, false)
      const previews = previewEvents(h.events)
      expect(previews.at(-1)?.item.argumentPreview.text).toContain('[redacted]')
      const displayed = JSON.stringify({
        previews,
        transcript: h.session.snapshot().transcript,
        acp: previews.flatMap((event) => translator.updates(event)),
      })
      expect(displayed).not.toContain('dummy-first')
      expect(displayed).not.toContain('dummy-second')
      expect(displayed).not.toContain('private-name')
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('processes 5,000 tiny deltas in under half a second with coalesced snapshots for both editors', async () => {
    const h = await setup({ now: () => Date.now() })
    const snapshots = vi.spyOn(ArgumentPreview.prototype, 'snapshot')
    const frames: StreamEvent[] = [
      DELTAS[0]!,
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta: '{"content":"',
      },
      ...Array.from({ length: 5000 }, (): StreamEvent => ({
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta: String.raw`x\n`,
      })),
    ]
    const stream = controlledStream(h.client, frames)
    const done = h.turnDone()
    try {
      const started = performance.now()
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      const elapsed = performance.now() - started
      expect(elapsed).toBeLessThan(500)
      const previews = previewEvents(h.events)
      expect(previews.length).toBeLessThanOrEqual(
        Math.floor(elapsed / TOOL_ARGUMENT_PREVIEW_INTERVAL_MS) + 1,
      )
      expect(snapshots).toHaveBeenCalledTimes(previews.length)
      const translator = new UpdateTranslator(ROOT, false)
      expect(previews.flatMap((event) => translator.updates(event))).toHaveLength(previews.length)
      stream.gate.resolve(undefined)
      await done
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('third')
      const settled = h.events.length
      await new Promise((resolve) => setTimeout(resolve, TOOL_ARGUMENT_PREVIEW_INTERVAL_MS * 2))
      expect(h.events).toHaveLength(settled)
    } finally {
      snapshots.mockRestore()
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it.each([
    ['flushes a coalesced preview while streaming and cancels it on interruption', true],
    ['cancels a queued coalesced preview before interrupt settlement', false],
  ] as const)('%s', async (_name, isFlushed) => {
    vi.useFakeTimers()
    const h = await setup({ now: () => Date.now() })
    const stream = controlledStream(h.client, DELTAS)
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(previewEvents(h.events)).toHaveLength(1)
      if (isFlushed) {
        await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS)
        expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('second')
      }
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
      const settled = h.events.length
      await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS * 2)
      expect(h.events).toHaveLength(settled)
      expect(
        h.session.snapshot().transcript.some(({ item }) => item.argumentPreview !== undefined),
      ).toBe(false)
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
      vi.useRealTimers()
    }
  })

  it('scrubs a provider-authored tool name before displaying its preview row', async () => {
    const h = await setup()
    const stream = controlledStream(h.client, [
      {
        type: 'response.output_item.added',
        item: { ...CALL, arguments: '', name: `LLM_${'x'.repeat(24)}` },
      },
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(previewEvents(h.events)[0]?.item.tool).toBe('[redacted]')
      stream.gate.resolve(undefined)
      await done
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('refuses a stream that reuses a preview item id for a message', async () => {
    const h = await setup()
    vi.spyOn(h.client, 'streamResponse').mockImplementation(async function* () {
      for (const event of DELTAS) yield event
      await Promise.resolve()
      yield {
        type: 'response.output_text.delta',
        item_id: 'wire-call',
        delta: 'conflicting message',
      }
      yield terminal([CALL])
    })
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await done
      expect(h.write).not.toHaveBeenCalled()
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
      })
    } finally {
      await h.host.close()
    }
  })

  it('settles a stopped preview without running a tool or leaving a pending row', async () => {
    const h = await setup()
    const stream = controlledStream(h.client, DELTAS)
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      const previewId = previewEvents(h.events)[0]?.item.itemId
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
      expect(h.write).not.toHaveBeenCalled()
      expect(h.events).toContainEqual({
        type: 'itemCompleted',
        item: {
          itemId: previewId,
          turnId: expect.any(String),
          kind: 'toolCall',
          tool: 'write_file',
          args: '',
          status: 'interrupted',
        },
      })
      expect(h.session.snapshot().replay.some(({ item }) => item.type === 'function_call')).toBe(
        false,
      )
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('resends U13 commentary and absent phases exactly without inventing a final-answer phase', async () => {
    const capture = z
      .array(z.object({ messages: z.array(outputItemSchema) }))
      .parse(
        JSON.parse(
          readFileSync(new URL('../fixtures/m106/u13-phases.json', import.meta.url), 'utf8'),
        ),
      )
    const messages = capture.flatMap((record) => record.messages)
    const h = await setup()
    let request = 0
    const bodies: CreateResponseBody[] = []
    vi.spyOn(h.client, 'streamResponse').mockImplementation(async function* (body) {
      bodies.push(body)
      await Promise.resolve()
      request += 1
      yield terminal(request === 1 ? messages : [])
    })
    try {
      for (const text of ['first', 'follow up']) {
        const done = h.turnDone()
        await h.session.sendTurn([{ type: 'text', text }])
        await done
      }
      const replayed = bodies[1]?.input.filter(
        (item) => item.type === 'message' && item.role === 'assistant',
      )
      expect(replayed?.map((item) => (item.type === 'message' ? item.phase : undefined))).toEqual([
        'commentary',
        undefined,
        undefined,
        undefined,
      ])
      expect(replayed?.slice(1).every((item) => !Object.hasOwn(item, 'phase'))).toBe(true)
    } finally {
      await h.host.close()
    }
  })
})
