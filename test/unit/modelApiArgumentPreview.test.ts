// Synthetic events exercise the existing StreamEvent contract, not a live
// U9 receipt: lane 0's supplied capture explicitly lacks the raw deltas.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  metaArgumentPreviewCapabilities,
  metaModelFacts,
  metaOutputMaxTokens,
} from '../../src/core/backends/modelapi/modelCapabilities'
import {
  type CreateResponseBody,
  type FunctionCallItem,
  outputItemSchema,
  type StreamEvent,
  streamEventSchema,
} from '../../src/core/backends/modelapi/schemas'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo, hookResult } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession, watchSessionTurns } from './helpers/sessionTurns'
import { M106_CAPTURED_META_MODEL } from '../../src/shared/constants'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { FORMAT_QUIRKS } from '../../src/core/providers/presets'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { UpdateTranslator } from '../../src/acp/translate'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { ARGUMENT_PREVIEW_PROBES } from './helpers/argumentPreviewProbes'
import {
  TOOL_ARGUMENT_PREVIEW_INTERVAL_MS,
  TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
} from '../../src/shared/constants'

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
  beforeEvent?: (index: number) => void,
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
    for (const [index, event] of events.entries()) {
      beforeEvent?.(index)
      yield event
    }
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
  it.each([true, false])(
    'keeps every host tool curated and hidden fields off the wire with strict %s',
    async (strict) => {
      const h = await setup({
        observationPacking: () => true,
        modelFacts: () => ({
          capabilities: {
            ...CONSERVATIVE_CAPABILITIES,
            toolCalling: true,
            supportsStrictTools: strict,
          },
          quirks: FORMAT_QUIRKS.responses,
        }),
      })
      const calls = [
        { name: 'write_file', args: { path: 'new.txt', content: 'hidden-write-content' } },
        {
          name: 'edit_file',
          args: {
            path: 'new.txt',
            find: 'hidden-find',
            replace: 'hidden-replace',
            then_run: 'hidden-command',
          },
        },
        { name: 'ask_user', args: { question: 'hidden-question' } },
        { name: 'recall_output', args: { id: 'hidden-output-id', search: 'hidden-recall-text' } },
      ]
      const deltas = calls.flatMap(({ name, args }, index): StreamEvent[] => [
        {
          type: 'response.output_item.added',
          item: {
            ...CALL,
            id: `call-${String(index)}`,
            call_id: `call-${String(index)}`,
            name,
            arguments: '',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: `call-${String(index)}`,
          delta: JSON.stringify(args),
        },
      ])
      const stream = controlledStream(h.client, deltas)
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        const previews = previewEvents(h.events)
        for (const { name, args } of calls) {
          const preview = previews.findLast((event) => event.item.tool === name)
          expect(preview?.item.argumentPreview.bytes).toBe(Buffer.byteLength(JSON.stringify(args)))
          if ('path' in args)
            expect(preview?.item.argumentPreview.text).toContain('"path": "new.txt"')
          else expect(preview?.item.argumentPreview.text).toBe('')
        }
        expect(JSON.stringify(previews)).not.toContain('hidden-')
        expect(stream.bodies[0]).not.toContain('previewFields')
        expect(JSON.parse(stream.bodies[0] ?? '{}')).toMatchObject({
          tools: expect.arrayContaining([expect.objectContaining({ name: 'write_file', strict })]),
        })
      } finally {
        stream.gate.resolve(undefined)
        await h.host.close()
      }
    },
  )

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
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('new.txt')
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

  it('keeps text bounded while counting bytes after retention stops', async () => {
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
      expect(previewEvents(h.events)).toHaveLength(12)
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview).toMatchObject({
        text: '…: …',
        truncated: true,
        bytes: Buffer.byteLength('{"content":"') + 20_000 + 40,
      })
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

  it.each(ARGUMENT_PREVIEW_PROBES)(
    'keeps review probes out of preview events, transcript, ACP and saved webview state: %s',
    async (args) => {
      const h = await setup()
      const frames = [
        DELTAS[0],
        ...Array.from(args, (delta) => ({
          type: 'response.function_call_arguments.delta',
          item_id: 'wire-call',
          delta,
        })),
        { type: 'response.function_call_arguments.done', item_id: 'wire-call', arguments: args },
      ].map((frame) => streamEventSchema.parse(frame))
      const stream = controlledStream(h.client, frames)
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        const translator = new UpdateTranslator(ROOT, false)
        let state: UiState = { ...initialUiState, sessionId: 's1' }
        for (const event of previewEvents(h.events)) {
          state = uiReducer(state, {
            type: 'hostMessage',
            message: { type: 'agentEvent', event },
            at: 1,
          })
          const saved = webviewStateOf(state, true)
          const displayed = JSON.stringify({
            event,
            saved,
            restored: restoredUiState(saved),
            acp: translator.updates(event),
          })
          expect(displayed).not.toMatch(/dummy|private-name|9876543210/)
          expect(event.item.args).toBe('')
        }
        expect(JSON.stringify(h.session.snapshot().transcript)).not.toMatch(
          /dummy|private-name|9876543210/,
        )
        await h.session.cancel()
        stream.gate.resolve(undefined)
        await done
      } finally {
        stream.gate.resolve(undefined)
        await h.host.close()
      }
    },
  )

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
      expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('new.txt')
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
    ['bounded', 100, String.raw`x\n`.repeat(6000)],
    ['unfinished', 5000, 'x'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS - 20)],
  ] as const)(
    'bounds processing of unchanged %s previews under a burst',
    async (_kind, count, content) => {
      vi.useFakeTimers()
      let now = 0
      const h = await setup({ now: () => now })
      const snapshots = vi.spyOn(ArgumentPreview.prototype, 'snapshot')
      const frames: StreamEvent[] = [
        DELTAS[0]!,
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'wire-call',
          delta: '{"content":"' + content,
        },
        ...Array.from({ length: count }, (): StreamEvent => ({
          type: 'response.function_call_arguments.delta',
          item_id: 'wire-call',
          delta: '',
        })),
      ]
      const stream = controlledStream(h.client, frames, (index) => {
        if (index === 1 || index === 2) now += TOOL_ARGUMENT_PREVIEW_INTERVAL_MS
      })
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        // The third snapshot is identical: dedup must still start a new window.
        expect(snapshots).toHaveBeenCalledTimes(3)
        expect(previewEvents(h.events)).toHaveLength(2)
        now += TOOL_ARGUMENT_PREVIEW_INTERVAL_MS
        await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS)
        expect(snapshots).toHaveBeenCalledTimes(4)
        stream.gate.resolve(undefined)
        await done
        const settled = h.events.length
        await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS * 2)
        expect(h.events).toHaveLength(settled)
      } finally {
        snapshots.mockRestore()
        stream.gate.resolve(undefined)
        await h.host.close()
        vi.useRealTimers()
      }
    },
  )

  it.each([
    ['flushes a coalesced preview while streaming and cancels it on interruption', true],
    ['flushes a queued redacted preview before interrupt settlement', false],
  ] as const)('%s', async (_name, isFlushed) => {
    vi.useFakeTimers()
    const h = await setup({ now: () => Date.now() })
    const stream = controlledStream(h.client, [
      DELTAS[0]!,
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'wire-call',
        delta: String.raw`{"password":{"value":"dummy-first\ndummy-second"},"path":"safe.ts","content":"unfinished`,
      },
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      expect(previewEvents(h.events)).toHaveLength(1)
      if (isFlushed) {
        await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS)
        expect(previewEvents(h.events).at(-1)?.item.argumentPreview.text).toContain('safe.ts')
      }
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
      const flushed = previewEvents(h.events).at(-1)
      expect(flushed?.item.argumentPreview.text).toContain('safe.ts')
      expect(flushed?.item.argumentPreview.text).toContain('…')
      expect(flushed?.item.argumentPreview.text).not.toContain('dummy')
      const completedAt = h.events.findIndex((event) => event.type === 'itemCompleted')
      expect(h.events.indexOf(flushed!)).toBeLessThan(completedAt)
      const translator = new UpdateTranslator(ROOT, false)
      const updates = h.events.flatMap((event) => translator.updates(event))
      expect(JSON.stringify(updates)).toContain('safe.ts')
      expect(updates.at(-1)).toMatchObject({ status: 'failed', content: [] })
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

  it('withholds an aborted shell command and gives foreign tools byte counts only', async () => {
    for (const name of ['bash', 'mcp__foreign__bash', 'unknown_tool']) {
      const h = await setup()
      const stream = controlledStream(h.client, [
        { type: 'response.output_item.added', item: { ...CALL, arguments: '', name } },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'wire-call',
          delta: String.raw`{"command":"dummy-secret\nsuffix`,
        },
      ])
      const done = h.turnDone()
      try {
        await h.session.sendTurn(WRITE_PROMPT)
        await stream.reached.promise
        const preview = previewEvents(h.events).at(-1)?.item.argumentPreview
        expect(preview?.text).toBe(name === 'bash' ? '"command": …' : '')
        expect(preview?.bytes).toBeGreaterThan(0)
        expect(JSON.stringify(previewEvents(h.events))).not.toContain('dummy')
        await h.session.cancel()
        stream.gate.resolve(undefined)
        await done
        expect(h.shell).not.toHaveBeenCalled()
      } finally {
        stream.gate.resolve(undefined)
        await h.host.close()
      }
    }
  })

  it('renders no text for a catalogued MCP tool the request never offered', async () => {
    // RVCM1062C P2: get_weather is declared in the MCP catalogue, but the
    // untrusted workspace keeps MCP (and the shell) out of this request's
    // tool list. The streamed call still opens a row for its byte count,
    // yet its declared city/unit fields must never render as text.
    const args = JSON.stringify({ city: 'Oslo', unit: 'celsius' })
    const weather = {
      ...fakeMcpSource([]),
      definitions: () => [
        {
          type: 'function' as const,
          name: 'mcp__weather__get_weather',
          description: 'the weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' }, unit: { type: 'string' } },
            required: ['city'],
          },
          strict: false,
        },
      ],
    }
    const h = await setup({ isWorkspaceTrusted: () => false, mcpServers: weather })
    const bodies: string[] = []
    const gate = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    let attempt = 0
    const call: FunctionCallItem = {
      type: 'function_call',
      id: 'wire-weather',
      call_id: 'weather-1',
      name: 'mcp__weather__get_weather',
      arguments: args,
    }
    vi.spyOn(h.client, 'streamResponse').mockImplementation(async function* (body) {
      bodies.push(JSON.stringify(body))
      attempt += 1
      if (attempt > 1) {
        yield terminal([])
        return
      }
      yield { type: 'response.output_item.added', item: { ...call, arguments: '' } }
      yield { type: 'response.function_call_arguments.delta', item_id: 'wire-weather', delta: args }
      reached.resolve(undefined)
      await gate.promise
      yield terminal([])
    })
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await reached.promise
      // The premise: this request offered no weather tool.
      expect(JSON.stringify(bodies)).not.toContain('get_weather')
      const preview = previewEvents(h.events).at(-1)?.item.argumentPreview
      expect(preview?.text).toBe('')
      expect(preview?.bytes).toBe(Buffer.byteLength(args))
      expect(JSON.stringify(previewEvents(h.events))).not.toContain('Oslo')
      expect(JSON.stringify(previewEvents(h.events))).not.toContain('celsius')
      await h.session.cancel()
      gate.resolve(undefined)
      await done
    } finally {
      gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('displays completed shell commands after M84 scrubbing through every surface', async () => {
    const h = await setup()
    const command = 'echo safe; echo LLM_' + 'x'.repeat(24)
    const args = JSON.stringify({ command, description: 'dummy-hidden' })
    const stream = controlledStream(h.client, [
      { type: 'response.output_item.added', item: { ...CALL, name: 'bash', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'wire-call', delta: args },
    ])
    const done = h.turnDone()
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      const preview = previewEvents(h.events).at(-1)!
      expect(preview.item.argumentPreview.text).toContain('echo safe')
      expect(preview.item.argumentPreview.text).toContain('[redacted]')
      const translator = new UpdateTranslator(ROOT, false)
      const state = uiReducer(initialUiState, {
        type: 'hostMessage',
        message: { type: 'agentEvent', event: preview },
        at: 1,
      })
      const displayed = JSON.stringify({
        preview,
        transcript: h.session.history(),
        saved: webviewStateOf(state, true),
        acp: translator.updates(preview),
      })
      expect(displayed).not.toContain('LLM_')
      expect(displayed).not.toContain('dummy-hidden')
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
    } finally {
      stream.gate.resolve(undefined)
      await h.host.close()
    }
  })

  it('isolates nine concurrent previews by call ID and clears each on interruption', async () => {
    vi.useFakeTimers()
    const h = await setup({ now: () => Date.now() })
    const done = h.turnDone()
    const frames = Array.from({ length: 9 }, (_, index) => [
      {
        type: 'response.output_item.added',
        item: {
          ...CALL,
          id: `wire-${String(index)}`,
          call_id: `call-${String(index)}`,
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: `wire-${String(index)}`,
        delta: JSON.stringify({ path: `safe-${String(index)}.ts`, password: 'dummy-secret' }),
      },
    ])
      .flat()
      .map((frame) => streamEventSchema.parse(frame))
    const stream = controlledStream(h.client, frames)
    try {
      await h.session.sendTurn(WRITE_PROMPT)
      await stream.reached.promise
      await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS)
      const rows = h.session.history().items.filter((item) => item.argumentPreview !== undefined)
      expect(rows).toHaveLength(9)
      expect(new Set(rows.map((row) => row.itemId)).size).toBe(9)
      expect(rows.map((row) => row.argumentPreview?.text)).toEqual(
        Array.from({ length: 9 }, (_, index) => `"path": "safe-${String(index)}.ts"\n…: …`),
      )
      expect(JSON.stringify(previewEvents(h.events))).not.toContain('dummy-secret')
      await h.session.cancel()
      stream.gate.resolve(undefined)
      await done
      const settled = h.events.filter((event) => event.type === 'itemCompleted')
      expect(settled).toHaveLength(9)
      expect(new Set(settled.map((event) => event.item.itemId)).size).toBe(9)
      expect(
        settled.every(
          (event) =>
            event.item.status === 'interrupted' && event.item.argumentPreview === undefined,
        ),
      ).toBe(true)
      expect(h.session.history().items.every((item) => item.argumentPreview === undefined)).toBe(
        true,
      )
      const at = h.events.length
      await vi.advanceTimersByTimeAsync(TOOL_ARGUMENT_PREVIEW_INTERVAL_MS * 2)
      expect(h.events).toHaveLength(at)
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

async function productionRig(modelId: string) {
  const io = memoryToolIo({}, ROOT)
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(fakeModelApi(), log)
  const write = vi.spyOn(io, 'writeFile')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    argumentPreviewCapabilities: metaArgumentPreviewCapabilities,
    modelFacts: metaModelFacts,
    modelOutputMaxTokens: metaOutputMaxTokens,
  })
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId,
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) throw new TypeError('expected a Model API session')
  return { host, client, session, write, ...watchSessionTurns(session) }
}

/** One production turn through the entry's Meta defaults, observed mid-stream and settled. */
async function productionTurn(modelId: string) {
  const h = await productionRig(modelId)
  const stream = controlledStream(h.client, DELTAS)
  const done = h.turnDone()
  try {
    await h.session.sendTurn(WRITE_PROMPT)
    await stream.reached.promise
    expect(h.write).not.toHaveBeenCalled()
    const previews = previewEvents(h.events)
    stream.gate.resolve(undefined)
    await done
    return { previews, bodies: stream.bodies, writes: h.write.mock.calls.length }
  } finally {
    stream.gate.resolve(undefined)
    await h.host.close()
  }
}

/** The raw 2026-10-10 lead capture: all 16 strict-stream frames, scrubbed. */
function rawU9Capture() {
  const capture = z
    .object({
      request: z.object({
        body: z.object({
          tools: z.array(
            z.object({
              type: z.literal('function'),
              name: z.string(),
              description: z.string(),
              parameters: z.record(z.string(), z.unknown()),
            }),
          ),
        }),
      }),
      frames: z.array(z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) })),
    })
    .parse(
      JSON.parse(
        readFileSync(
          new URL('../fixtures/m106/u9-raw-strict-stream.json', import.meta.url),
          'utf8',
        ),
      ),
    )
  // The collector's own invariant: the raw deltas concatenate byte-exact to
  // the done arguments (scripts/capture-m106-meta.mjs checkCapture).
  const deltaTexts = capture.frames
    .map((frame) => frame.data)
    .filter((data) => data['type'] === 'response.function_call_arguments.delta')
    .map((data) => {
      const delta = data['delta']
      if (typeof delta !== 'string') throw new Error('the U9 capture names no delta text')
      return delta
    })
  const done = capture.frames
    .map((frame) => frame.data)
    .find((data) => data['type'] === 'response.function_call_arguments.done')
  const doneName = done?.['name']
  const doneArguments = done?.['arguments']
  if (typeof doneName !== 'string' || typeof doneArguments !== 'string')
    throw new Error('the U9 capture names no completed call')
  return {
    tools: capture.request.body.tools,
    frames: capture.frames,
    deltaTexts,
    doneName,
    doneArguments,
  }
}

describe('Model API captured declared-tool preview', () => {
  it('renders declared-tool preview TEXT from the raw captured U9 frames', async () => {
    // RVCM1062B external blocker closed: the captured strict get_weather
    // call streams its RAW delta payloads (captured split point, not the
    // test's), and the tool is declared to the host through its MCP
    // catalogue with the captured schema, so its declared string fields
    // render TEXT. A tool the request never offered stays textless.
    const capture = rawU9Capture()
    expect(capture.frames).toHaveLength(16)
    expect(capture.doneName).toBe('get_weather')
    expect(capture.deltaTexts).toHaveLength(2)
    expect(capture.deltaTexts.join('')).toBe(capture.doneArguments)
    // The production codec passes additive frames through untranslated
    // (src/core/backends/modelapi/codecs/responses.ts): the host receives
    // the other 13 raw frames, including every argument byte.
    const events: StreamEvent[] = []
    const skipped: string[] = []
    for (const frame of capture.frames) {
      const parsed = streamEventSchema.safeParse(frame.data)
      if (parsed.success) events.push(parsed.data)
      else skipped.push(frame.event)
    }
    expect(skipped).toEqual([
      'response.content_part.added',
      'response.output_text.done',
      'response.content_part.done',
    ])
    expect(events).toHaveLength(13)
    const declared = capture.tools.find((tool) => tool.name === capture.doneName)
    if (declared === undefined) throw new Error('the U9 capture declares no weather tool')
    const servers = {
      ...fakeMcpSource([]),
      definitions: () => [
        {
          type: 'function' as const,
          name: declared.name,
          description: declared.description,
          parameters: declared.parameters,
          strict: false,
        },
      ],
      find: (name: string) =>
        name === declared.name
          ? { server: 'weather', tool: 'get_weather', isReadOnly: true }
          : undefined,
    }
    const io = memoryToolIo({}, ROOT)
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(fakeModelApi(), log)
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
      mcpServers: servers,
      argumentPreviewCapabilities: metaArgumentPreviewCapabilities,
      modelOutputMaxTokens: metaOutputMaxTokens,
    })
    const session = await host.startSession({
      workspaceRoot: ROOT,
      modelId: M106_CAPTURED_META_MODEL,
      approvalMode: 'allowAll',
    })
    if (!(session instanceof ModelApiSession)) throw new TypeError('expected a Model API session')
    const watched = watchSessionTurns(session)
    const bodies: string[] = []
    let attempt = 0
    vi.spyOn(client, 'streamResponse').mockImplementation(async function* (body) {
      bodies.push(JSON.stringify(body))
      attempt += 1
      await Promise.resolve()
      if (attempt > 1) {
        yield terminal([])
        return
      }
      yield* events
    })
    try {
      await session.sendTurn([{ type: 'text', text: 'check the weather' }])
      await watched.turnDone()
      const previews = previewEvents(watched.events)
      expect(previews.length).toBeGreaterThan(0)
      // The captured bytes render the declared values, not placeholders.
      expect(previews.at(-1)?.item.argumentPreview.text).toContain('Oslo')
      expect(previews.at(-1)?.item.argumentPreview.text).toContain('celsius')
      expect(previews.at(-1)?.item.argumentPreview.bytes).toBe(
        Buffer.byteLength(capture.doneArguments),
      )
      expect(bodies[0]).toContain('"max_output_tokens":131072')
      expect(bodies[0]).toContain('get_weather')
      expect(bodies.join('')).not.toContain('argumentPreview')
      expect(servers.calls).toEqual([{ name: 'get_weather', args: capture.doneArguments }])
    } finally {
      await host.close()
    }
  })
})

/** The production binding (C-M106-2): the entry's Meta defaults on each selected model. */
describe('Model API selected-record production binding', () => {
  it('streams previews and requests the selected cap on the captured model', async () => {
    const turn = await productionTurn(M106_CAPTURED_META_MODEL)
    expect(turn.previews.at(-1)?.item.argumentPreview.text).toContain('new.txt')
    expect(turn.writes).toBe(1)
    expect(turn.bodies[0]).toContain('"max_output_tokens":131072')
    expect(turn.bodies.join('')).not.toContain('argumentPreview')
  })

  it('withholds previews on an uncaptured Meta model while keeping its selected cap', async () => {
    const turn = await productionTurn('muse-spark-1.2')
    expect(turn.previews).toEqual([])
    expect(turn.writes).toBe(1)
    expect(turn.bodies[0]).toContain('"max_output_tokens":131072')
  })

  it('keeps an unobserved model on the legacy cap with no previews', async () => {
    const turn = await productionTurn('future-model')
    expect(turn.previews).toEqual([])
    expect(turn.bodies[0]).toContain('"max_output_tokens":32768')
  })
})
