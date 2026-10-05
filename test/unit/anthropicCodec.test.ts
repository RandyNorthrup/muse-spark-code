import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodeAnthropicStream,
  encodeAnthropicRequest,
  parseAnthropicError,
  parseAnthropicModelsList,
  type AnthropicDecodeOptions,
  type AnthropicEncodeOptions,
} from '../../src/core/backends/modelapi/codecs/anthropic'
import {
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  messageText,
  responseSchema,
  type CreateResponseBody,
  type FunctionToolDefinition,
  type InputItem,
  type ReasoningItem,
  type StreamEvent,
} from '../../src/core/backends/modelapi/schemas'
import type { SseEvent } from '../../src/core/backends/modelapi/sse'
import {
  ANTHROPIC_MAX_ARGUMENT_BYTES,
  ANTHROPIC_MAX_FRAME_BYTES,
  ANTHROPIC_MAX_FRAMES,
  ANTHROPIC_MAX_ITEM_BYTES,
  ANTHROPIC_MAX_ITEMS,
  ANTHROPIC_MAX_STREAM_BYTES,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

const MODEL = 'claude-sonnet-5-5'
const BASE_OPTIONS: AnthropicEncodeOptions = { model: MODEL, maxTokens: 256, effort: 'high' }

const GET_TIME_TOOL: FunctionToolDefinition = {
  type: 'function',
  name: 'get_time',
  description: 'Returns the current time in the given IANA time zone.',
  parameters: {
    type: 'object',
    properties: { timezone: { type: 'string', description: 'An IANA time zone such as UTC.' } },
    required: ['timezone'],
  },
  strict: false,
}

function canonicalBody(overrides: Partial<CreateResponseBody>): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input: [],
    instructions: '',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'high', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 256,
    prompt_cache_key: 'test-key',
    prompt_cache_retention: 'in_memory',
    ...overrides,
  }
}

function golden(name: string): string {
  return readFileSync(new URL(`anthropicCodecGoldens/${name}.json`, import.meta.url), 'utf8')
}

/**
 * The golden file parsed and re-serialized: key order (the assertion) and
 * values survive, file formatting does not, so the goldens stay
 * prettier-clean without weakening the reorder drill.
 */
function goldenBytes(name: string): string {
  return `${JSON.stringify(JSON.parse(golden(name)), null, 2)}\n`
}

function encodedText(
  body: CreateResponseBody,
  options: AnthropicEncodeOptions = BASE_OPTIONS,
): string {
  return `${JSON.stringify(encodeAnthropicRequest(body, options), null, 2)}\n`
}

/** M95 explicitly excepts rolling cache markers from the immutable prefix. */
function historyBytes(messages: unknown): string {
  return JSON.stringify(messages, (key, value: unknown) =>
    key === 'cache_control' ? undefined : value,
  )
}

interface CaptureFile {
  response: { events: { event: string; data: unknown }[] }
}

function captureEvents(path: string): SseEvent[] {
  const file = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as CaptureFile
  return file.response.events.map((entry) => ({
    event: entry.event,
    data: JSON.stringify(entry.data),
  }))
}

function decodeAll(frames: readonly SseEvent[], options: AnthropicDecodeOptions) {
  return Array.fromAsync(decodeAnthropicStream(frames, options))
}

async function decodeCompleted(frames: readonly SseEvent[]): Promise<{
  events: StreamEvent[]
  terminal: Extract<StreamEvent, { type: 'response.completed' }>
}> {
  const events = await decodeAll(frames, { model: MODEL })
  const terminal = events.at(-1)
  expect(terminal?.type).toBe('response.completed')
  if (terminal?.type !== 'response.completed') {
    throw new Error('expected a completed response')
  }
  return { events, terminal }
}

function timeQuestionBody(rest: CreateResponseBody['input']): CreateResponseBody {
  return canonicalBody({
    instructions: 'You are a capture assistant. Call get_time, then answer briefly.',
    tools: [GET_TIME_TOOL],
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What time is it in UTC? Call get_time.' }],
      },
      ...rest,
    ],
  })
}

function errorStreamFrames(errorPayload: unknown): SseEvent[] {
  return [
    {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: { id: 'm2', usage: { input_tokens: 3, output_tokens: 1 } },
      }),
    },
    { event: 'error', data: JSON.stringify({ type: 'error', error: errorPayload }) },
  ]
}

/** The frame's `type` without trusting its shape. */
function frameTypeOf(frame: SseEvent): string | undefined {
  const data: unknown = JSON.parse(frame.data)
  if (typeof data === 'object' && data !== null && 'type' in data) {
    return typeof data.type === 'string' ? data.type : undefined
  }
  return undefined
}

const ANTHROPIC_CAPTURE = '../../docs/certification/m95-captures/anthropic/'

function replayBody(reasoning: ReasoningItem) {
  return canonicalBody({
    instructions: 'Answer briefly.',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      {
        type: 'function_call',
        id: 'toolu_01r',
        call_id: 'toolu_01r',
        name: 'get_time',
        arguments: '{}',
      },
      reasoning,
    ],
  })
}

function userOnly(instructions: string) {
  return canonicalBody({
    instructions,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  })
}

function streamOf(
  blocks: { start: unknown; deltas: unknown[] }[],
  stopReason: unknown,
): SseEvent[] {
  const frames: SseEvent[] = [
    {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: { id: 'msg_edge', usage: { input_tokens: 5, output_tokens: 1 } },
      }),
    },
  ]
  for (const [index, block] of blocks.entries()) {
    frames.push(
      {
        event: 'content_block_start',
        data: JSON.stringify({ type: 'content_block_start', index, content_block: block.start }),
      },
      ...block.deltas.map((delta) => ({
        event: 'content_block_delta',
        data: JSON.stringify({ type: 'content_block_delta', index, delta }),
      })),
      {
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index }),
      },
    )
  }
  frames.push(
    {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    },
    { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
  )
  return frames
}

describe('anthropic codec goldens (checked-in request bytes)', () => {
  it('encodes a first turn with a system breakpoint and adaptive thinking', () => {
    expect(encodedText(timeQuestionBody([]))).toBe(goldenBytes('first-turn'))
  })

  it('encodes a thinking tool loop with the stale-block beta and caller replay', () => {
    const body = timeQuestionBody([
      {
        type: 'reasoning',
        encrypted_content: JSON.stringify({
          v: 1,
          provider: 'anthropic',
          kind: 'thinking',
          model: MODEL,
          thinking: '',
          signature: 'test-signature-bytes',
        }),
      },
      {
        type: 'function_call',
        id: 'toolu_01test',
        call_id: 'toolu_01test',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      {
        type: 'function_call_output',
        call_id: 'toolu_01test',
        output: '{"timezone":"UTC","time":"2026-10-04T12:00:00Z"}',
      },
    ])
    expect(
      encodedText(body, {
        ...BASE_OPTIONS,
        toolExtras: { toolu_01test: { caller: { type: 'direct' } } },
      }),
    ).toBe(goldenBytes('tool-loop-reasoning'))
  })

  it('encodes an image turn as native image blocks', () => {
    const body = canonicalBody({
      instructions: 'Describe the attached picture.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is in this picture?' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,iVBORw0KGgo=',
              detail: 'auto',
            },
          ],
        },
      ],
    })
    expect(encodedText(body)).toBe(goldenBytes('image'))
  })

  it('encodes packed tool output as tool_result content blocks', () => {
    const body = timeQuestionBody([
      {
        type: 'function_call',
        id: 'toolu_01packed',
        call_id: 'toolu_01packed',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      {
        type: 'function_call_output',
        call_id: 'toolu_01packed',
        output: [
          { type: 'input_text', text: 'The clock reads:' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
            detail: 'auto',
          },
        ],
      },
    ])
    expect(encodedText(body)).toBe(goldenBytes('packed-output'))
  })

  it('encodes a compaction with the turn tools kept beside the summary', () => {
    const body = canonicalBody({
      instructions: 'You are a capture assistant. Call get_time, then answer briefly.',
      tools: [GET_TIME_TOOL],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Summary of the session so far: asked for UTC, got 12:00.',
            },
          ],
        },
      ],
    })
    expect(encodedText(body)).toBe(goldenBytes('compaction'))
  })
})

describe('prefix stability (acceptance 4)', () => {
  it('a follow-up keeps every earlier native byte', () => {
    const first = canonicalBody({
      instructions: 'You are a capture assistant.',
      tools: [GET_TIME_TOOL],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What time is it?' }],
        },
      ],
    })
    const followUp = canonicalBody({
      instructions: 'You are a capture assistant.',
      tools: [GET_TIME_TOOL],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What time is it?' }],
        },
        {
          type: 'function_call',
          id: 'toolu_01a',
          call_id: 'toolu_01a',
          name: 'get_time',
          arguments: '{"timezone":"UTC"}',
        },
        { type: 'function_call_output', call_id: 'toolu_01a', output: '{"time":"12:00"}' },
      ],
    })
    const firstNative = encodeAnthropicRequest(first, BASE_OPTIONS).body
    const followUpNative = encodeAnthropicRequest(followUp, BASE_OPTIONS).body
    expect(followUpNative.system).toEqual(firstNative.system)
    expect(followUpNative.tools).toEqual(firstNative.tools)
    expect(historyBytes(followUpNative.messages.slice(0, 1))).toBe(
      historyBytes(firstNative.messages),
    )
    expect(followUpNative.messages.length).toBe(3)
  })
})

describe('stream decoding from the captures', () => {
  it.each([
    'anthropic/03-tool-call-stream.json',
    'anthropic/04-tool-result-stream.json',
    'anthropic/05-tool-history-without-tools.json',
    'anthropic/06-thinking-tool-call-stream.json',
    'anthropic/07-thinking-tool-result-stream.json',
    'anthropic/08-cache-call-1.json',
    'anthropic/09-cache-call-2.json',
    'anthropic-sonnet-thinking-high/01-tool-call-stream.json',
    'anthropic-sonnet-thinking-high/02-tool-result-stream.json',
    'anthropic-sonnet-thinking-riddle/01-tool-call-stream.json',
    'anthropic-sonnet-thinking-riddle/02-tool-result-stream.json',
    'anthropic-opus-thinking/01-tool-call-stream.json',
    'anthropic-opus-thinking/02-tool-result-stream.json',
  ])('replays the counted stream capture %s to completion under the bounds', async (name) => {
    await decodeCompleted(captureEvents(`../../docs/certification/m95-captures/${name}`))
  })

  it('decodes a tool-call stream: fragments assemble, caller is collected', async () => {
    const extras: Record<string, Readonly<Record<string, unknown>>> = {}
    const events = await decodeAll(captureEvents(`${ANTHROPIC_CAPTURE}03-tool-call-stream.json`), {
      model: MODEL,
      onToolExtras: (callId, extra) => {
        extras[callId] = extra
      },
    })
    expect(events[0]?.type).toBe('response.created')
    expect(events[1]?.type).toBe('response.in_progress')
    const done = events.filter((event) => event.type === 'response.function_call_arguments.done')
    expect(done).toEqual([
      {
        type: 'response.function_call_arguments.done',
        item_id: 'toolu_01S1LvZbGnDjtmtuJf7MYCN7',
        arguments: '{"timezone": "UTC"}',
      },
    ])
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('response.completed')
    if (terminal?.type !== 'response.completed') {
      throw new Error('expected a completed response')
    }
    expect(terminal.response.output).toEqual([
      {
        type: 'function_call',
        id: 'toolu_01S1LvZbGnDjtmtuJf7MYCN7',
        call_id: 'toolu_01S1LvZbGnDjtmtuJf7MYCN7',
        name: 'get_time',
        arguments: '{"timezone": "UTC"}',
      },
    ])
    expect(terminal.response.usage).toEqual({
      input_tokens: 2074,
      output_tokens: 54,
      total_tokens: 2128,
      input_tokens_details: { cache_write_tokens: 0, cache_write_tokens_1h: 0 },
    })
    expect(extras).toEqual({ toolu_01S1LvZbGnDjtmtuJf7MYCN7: { caller: { type: 'direct' } } })
  })

  it('decodes a text follow-up with cumulative usage', async () => {
    const { terminal } = await decodeCompleted(
      captureEvents(`${ANTHROPIC_CAPTURE}04-tool-result-stream.json`),
    )
    const message = terminal.response.output.find((item) => item.type === 'message')
    expect(message).toMatchObject({ type: 'message', role: 'assistant' })
    if (message === undefined || !isMessageItem(message)) {
      throw new Error('expected an assistant message item')
    }
    expect(messageText(message).length).toBeGreaterThan(0)
    expect(terminal.response.usage?.output_tokens).toBeGreaterThan(0)
  })

  it('decodes a thinking turn into a byte-exact replayable envelope', async () => {
    const { terminal } = await decodeCompleted(
      captureEvents(
        '../../docs/certification/m95-captures/anthropic-sonnet-thinking-riddle/01-tool-call-stream.json',
      ),
    )
    const reasoning = terminal.response.output.find((item) => item.type === 'reasoning')
    expect(reasoning?.type).toBe('reasoning')
    if (reasoning === undefined || !isReasoningItem(reasoning)) {
      throw new Error('expected a reasoning item with an envelope')
    }
    if (typeof reasoning.encrypted_content !== 'string') {
      throw new TypeError('expected a reasoning item with an envelope')
    }
    const envelope: { thinking: string; signature: string } = JSON.parse(
      reasoning.encrypted_content,
    )
    // The 5.x text is omitted; the signature carries the reasoning (captures §Anthropic).
    expect(envelope.thinking).toBe('')
    expect(envelope.signature.length).toBeGreaterThan(100)

    // Re-encoding the decoded turn reproduces the capture's follow-up request.
    const followUp: { request: { body: { messages: { role: string; content: unknown[] }[] } } } =
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/certification/m95-captures/anthropic-sonnet-thinking-riddle/02-tool-result-stream.json',
            import.meta.url,
          ),
          'utf8',
        ),
      )
    const capturedAssistant = followUp.request.body.messages.find(
      (message) => message.role === 'assistant',
    )
    const call = terminal.response.output.find((item) => item.type === 'function_call')
    if (call === undefined || !isFunctionCallItem(call)) {
      throw new Error('expected a function call')
    }
    const reencoded = encodeAnthropicRequest(
      canonicalBody({
        instructions: 'x',
        tools: [GET_TIME_TOOL],
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'riddle' }] },
          reasoning,
          {
            type: 'function_call',
            id: call.id ?? '',
            call_id: call.call_id,
            name: call.name,
            arguments: call.arguments,
          },
          { type: 'function_call_output', call_id: call.call_id, output: '{"timezone":"UTC"}' },
        ],
      }),
      {
        model: MODEL,
        maxTokens: 2048,
        effort: 'high',
        toolExtras: { [call.call_id]: { caller: { type: 'direct' } } },
      },
    )
    expect(reencoded.body.messages[1]?.content).toEqual(capturedAssistant?.content)
  })

  it('maps cached reads and thinking tokens from the riddle follow-up', async () => {
    const { terminal } = await decodeCompleted(
      captureEvents(
        '../../docs/certification/m95-captures/anthropic-sonnet-thinking-riddle/02-tool-result-stream.json',
      ),
    )
    // input 295 after the last breakpoint plus 2,054 cached reads (captures §Anthropic).
    expect(terminal.response.usage).toEqual({
      input_tokens: 295 + 2054,
      output_tokens: 227,
      total_tokens: 295 + 2054 + 227,
      input_tokens_details: {
        cached_tokens: 2054,
        cache_write_tokens: 0,
        cache_write_tokens_1h: 0,
      },
      output_tokens_details: { reasoning_tokens: 114 },
    })
  })

  it('preserves cache writes and their captured TTL split on the cache pair', async () => {
    const first = await decodeCompleted(captureEvents(`${ANTHROPIC_CAPTURE}08-cache-call-1.json`))
    const second = await decodeCompleted(captureEvents(`${ANTHROPIC_CAPTURE}09-cache-call-2.json`))
    // 16 post-breakpoint tokens plus 1,925 written, then read back in full.
    expect(first.terminal.response.usage?.input_tokens).toBe(16 + 1925)
    expect(first.terminal.response.usage?.input_tokens_details).toEqual({
      cache_write_tokens: 1925,
      cache_write_tokens_1h: 0,
    })
    expect(second.terminal.response.usage?.input_tokens_details).toEqual({
      cached_tokens: 1925,
      cache_write_tokens: 0,
      cache_write_tokens_1h: 0,
    })
  })

  it('is deterministic: the same frames decode to the same events', async () => {
    const frames = captureEvents(`${ANTHROPIC_CAPTURE}03-tool-call-stream.json`)
    const first = await decodeAll(frames, { model: MODEL })
    const second = await decodeAll(frames, { model: MODEL })
    expect(second).toEqual(first)
  })
})

describe('encoding determinism', () => {
  it('is deterministic: the same body encodes to the same bytes', () => {
    const body = canonicalBody({
      instructions: 'You are a capture assistant.',
      tools: [GET_TIME_TOOL],
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    })
    expect(encodedText(body)).toBe(encodedText(body))
  })
})

describe('thinking replay (acceptance 9 and 12)', () => {
  const thinkingEnvelope = JSON.stringify({
    v: 1,
    provider: 'anthropic',
    kind: 'thinking',
    model: MODEL,
    thinking: 'let me think',
    signature: 'sig-bytes',
  })

  const rollingToolUse = {
    type: 'tool_use',
    id: 'toolu_01r',
    name: 'get_time',
    input: {},
    cache_control: { type: 'ephemeral', ttl: '5m' },
  }

  it('replays the same model thinking first in its turn, with the beta', () => {
    const native = encodeAnthropicRequest(
      replayBody({ type: 'reasoning', encrypted_content: thinkingEnvelope }),
      BASE_OPTIONS,
    )
    expect(native.headers['anthropic-beta']).toBe('thinking-binding-controls-2026-08-01')
    expect(native.body.thinking).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(native.body.messages[1]?.content).toEqual([
      { type: 'thinking', thinking: 'let me think', signature: 'sig-bytes' },
      rollingToolUse,
    ])
  })

  it('drops thinking from another model', () => {
    const foreign = JSON.stringify({
      v: 1,
      provider: 'anthropic',
      kind: 'thinking',
      model: 'claude-opus-5-5',
      thinking: 'other',
      signature: 'other-sig',
    })
    const native = encodeAnthropicRequest(
      replayBody({ type: 'reasoning', encrypted_content: foreign }),
      BASE_OPTIONS,
    )
    expect(native.headers['anthropic-beta']).toBeUndefined()
    expect(native.body.thinking).toEqual({ type: 'adaptive' })
    expect(native.body.messages[1]?.content).toEqual([rollingToolUse])
  })

  it('drops thinking from another provider and damaged envelopes', () => {
    for (const encryptedContent of [
      JSON.stringify({ v: 1, provider: 'openrouter', kind: 'thinking', model: MODEL }),
      '{"truncated json',
      undefined,
    ]) {
      const native = encodeAnthropicRequest(
        replayBody(
          encryptedContent === undefined
            ? { type: 'reasoning' }
            : { type: 'reasoning', encrypted_content: encryptedContent },
        ),
        BASE_OPTIONS,
      )
      expect(native.body.messages[1]?.content).toEqual([rollingToolUse])
    }
  })

  it('drops replayed thinking while thinking is off', () => {
    const native = encodeAnthropicRequest(
      replayBody({ type: 'reasoning', encrypted_content: thinkingEnvelope }),
      { ...BASE_OPTIONS, effort: 'none' },
    )
    expect(native.body.thinking).toBeUndefined()
    expect(native.headers['anthropic-beta']).toBeUndefined()
    expect(native.body.messages[1]?.content).toEqual([rollingToolUse])
  })

  it('round-trips a redacted block exactly', async () => {
    const frames: SseEvent[] = [
      {
        event: 'message_start',
        data: JSON.stringify({
          type: 'message_start',
          message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 1 } },
        }),
      },
      {
        event: 'content_block_start',
        data: JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'redacted_thinking', data: 'redacted-bytes' },
        }),
      },
      {
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
      },
      {
        event: 'message_delta',
        data: JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
      },
      { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
    ]
    const { terminal } = await decodeCompleted(frames)
    const reasoning = terminal.response.output.find((item) => item.type === 'reasoning')
    if (reasoning === undefined || !isReasoningItem(reasoning)) {
      throw new Error('expected a reasoning item')
    }
    const native = encodeAnthropicRequest(
      canonicalBody({
        instructions: 'Answer briefly.',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
          reasoning,
        ],
      }),
      BASE_OPTIONS,
    )
    expect(native.body.messages[1]?.content).toEqual([
      { type: 'redacted_thinking', data: 'redacted-bytes' },
    ])
  })
})

describe('breakpoints and effort', () => {
  it('marks the last message without tools or system', () => {
    const native = encodeAnthropicRequest(userOnly(''), BASE_OPTIONS)
    expect(native.body.system).toBeUndefined()
    expect(native.body.tools).toBeUndefined()
    expect(native.body.tool_choice).toBeUndefined()
    expect(native.body.messages[0]?.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '5m' } },
    ])
  })

  it('marks only the last message when there is no system text', () => {
    const native = encodeAnthropicRequest(
      canonicalBody({
        instructions: '',
        tools: [GET_TIME_TOOL, { ...GET_TIME_TOOL, name: 'get_date' }],
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      }),
      BASE_OPTIONS,
    )
    expect(native.body.tools?.[0]).not.toHaveProperty('cache_control')
    expect(native.body.tools?.[1]).toMatchObject({
      name: 'get_date',
    })
    expect(native.body.tools?.[1]).not.toHaveProperty('cache_control')
    expect(native.body.messages[0]?.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '5m' } },
    ])
    expect(native.body.tool_choice).toEqual({ type: 'auto' })
  })

  it('honours the 1h TTL', () => {
    const native = encodeAnthropicRequest(userOnly('Remember this.'), {
      ...BASE_OPTIONS,
      cacheTtl: '1h',
    })
    expect(native.body.system?.[0]).toMatchObject({
      cache_control: { type: 'ephemeral', ttl: '1h' },
    })
    expect(native.body.messages[0]?.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } },
    ])
  })

  it('maps minimal to low and leaves thinking off for none', () => {
    const low = encodeAnthropicRequest(userOnly('Remember this.'), {
      ...BASE_OPTIONS,
      effort: 'minimal',
    })
    expect(low.body.output_config).toEqual({ effort: 'low' })
    const off = encodeAnthropicRequest(userOnly('Remember this.'), {
      ...BASE_OPTIONS,
      effort: 'none',
    })
    expect(off.body.thinking).toBeUndefined()
    expect(off.body.output_config).toBeUndefined()
  })

  it('refuses an unknown effort', () => {
    expect(() =>
      encodeAnthropicRequest(userOnly('Remember this.'), { ...BASE_OPTIONS, effort: 'ultra' }),
    ).toThrow(/unsupported_reasoning_effort/)
  })
})

describe('encode guards', () => {
  it('refuses tool arguments that are not a JSON object', () => {
    for (const args of ['{broken', '"just-a-string"', '[1,2]']) {
      expect(() =>
        encodeAnthropicRequest(
          canonicalBody({
            instructions: '',
            input: [
              {
                type: 'function_call',
                id: 'toolu_01b',
                call_id: 'toolu_01b',
                name: 'get_time',
                arguments: args,
              },
            ],
          }),
          BASE_OPTIONS,
        ),
      ).toThrow(/invalid_tool_arguments/)
    }
  })

  it('refuses images that are not base64 data URLs of a supported type', () => {
    for (const imageUrl of [
      'https://example.com/pic.png',
      'data:image/bmp;base64,AAAA',
      'not-a-url',
    ]) {
      expect(() =>
        encodeAnthropicRequest(
          canonicalBody({
            instructions: '',
            input: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_image', image_url: imageUrl, detail: 'auto' }],
              },
            ],
          }),
          BASE_OPTIONS,
        ),
      ).toThrow(/image/)
    }
  })

  it('refuses PDF input and empty turns', () => {
    expect(() =>
      encodeAnthropicRequest(
        canonicalBody({
          instructions: '',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_file',
                  filename: 'doc.pdf',
                  file_data: 'data:application/pdf;base64,AAAA',
                },
              ],
            },
          ],
        }),
        BASE_OPTIONS,
      ),
    ).toThrow(/unsupported_pdf_input/)
    expect(() => encodeAnthropicRequest(canonicalBody({ instructions: '' }), BASE_OPTIONS)).toThrow(
      /empty_turn/,
    )
  })

  it('merges commentary into the assistant turn and skips empty messages', () => {
    const native = encodeAnthropicRequest(
      canonicalBody({
        instructions: '',
        tools: [GET_TIME_TOOL],
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Let me check.' },
              {
                type: 'input_image',
                image_url: 'data:image/png;base64,iVBORw0KGgo=',
                detail: 'auto',
              },
            ],
          },
          { type: 'function_call', id: 't1', call_id: 't1', name: 'get_time', arguments: '{}' },
          { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: '' }] },
        ],
      }),
      { ...BASE_OPTIONS, effort: 'none' },
    )
    expect(native.body.messages[1]?.content).toEqual([
      { type: 'text', text: 'Let me check.' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
      },
      {
        type: 'tool_use',
        id: 't1',
        name: 'get_time',
        input: {},
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
    ])
  })

  it('merges a later user message into blocks beside results', () => {
    const native = encodeAnthropicRequest(
      canonicalBody({
        instructions: '',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a' }] },
          { type: 'function_call_output', call_id: 't1', output: 'out' },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'b' }] },
        ],
      }),
      { ...BASE_OPTIONS, effort: 'none' },
    )
    expect(native.body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'tool_result', tool_use_id: 't1', content: 'out' },
          { type: 'text', text: 'b', cache_control: { type: 'ephemeral', ttl: '5m' } },
        ],
      },
    ])
  })

  it('leaves Meta-only search out and reads developer as user', () => {
    const native = encodeAnthropicRequest(
      canonicalBody({
        instructions: '',
        tools: [{ type: 'web_search' }, GET_TIME_TOOL],
        input: [
          {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'Be brief.' }],
          },
          { type: 'web_search_call', status: 'completed' },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        ],
      }),
      { ...BASE_OPTIONS, effort: 'none' },
    )
    expect(native.body.tools?.map((tool) => tool.name)).toEqual(['get_time'])
    expect(native.body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Be brief.hi', cache_control: { type: 'ephemeral', ttl: '5m' } },
        ],
      },
    ])
  })
})

describe('decode edges', () => {
  it('tolerates pings, unknown events and unknown deltas and blocks', async () => {
    const frames = streamOf(
      [
        {
          start: { type: 'fallback', note: 'a future block' },
          deltas: [{ type: 'mystery_delta', payload: 1 }],
        },
      ],
      'end_turn',
    )
    frames.splice(1, 0, { event: 'ping', data: JSON.stringify({ type: 'ping' }) })
    frames.splice(2, 0, { event: 'glow', data: JSON.stringify({ type: 'glow', brightness: 11 }) })
    const events = await decodeAll(frames, { model: MODEL })
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('response.completed')
  })

  it('accepts empty string deltas and surfaces thinking text', async () => {
    const frames = streamOf(
      [
        { start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: '' }] },
        {
          start: { type: 'tool_use', id: 't9', name: 'get_time' },
          deltas: [{ type: 'input_json_delta', partial_json: '' }],
        },
        {
          start: { type: 'thinking', thinking: '', signature: '' },
          deltas: [
            { type: 'thinking_delta', thinking: '' },
            { type: 'thinking_delta', thinking: 'hmm' },
            { type: 'signature_delta', signature: '' },
          ],
        },
      ],
      'end_turn',
    )
    const { events, terminal } = await decodeCompleted(frames)
    const call = terminal.response.output.find((item) => item.type === 'function_call')
    if (call === undefined || !isFunctionCallItem(call)) {
      throw new Error('expected a function call')
    }
    expect(call.arguments).toBe('{}')
    const reasoning = terminal.response.output.find((item) => item.type === 'reasoning')
    if (reasoning === undefined || !isReasoningItem(reasoning)) {
      throw new Error('expected a reasoning item')
    }
    expect(reasoning.summary).toEqual([{ type: 'summary_text', text: 'hmm' }])
    expect(
      events.some(
        (event) => event.type === 'response.reasoning_summary_text.delta' && event.delta === 'hmm',
      ),
    ).toBe(true)
  })

  it('decodes usage carried only by the final delta', async () => {
    const frames = streamOf([], 'end_turn').map((frame) =>
      frameTypeOf(frame) === 'message_start'
        ? { ...frame, data: JSON.stringify({ type: 'message_start', message: { id: 'msg_edge' } }) }
        : frame,
    )
    const { terminal } = await decodeCompleted(frames)
    expect(terminal.response.usage?.input_tokens).toBe(5)
  })

  it('keeps the start usage when the delta carries none', async () => {
    const frames = streamOf([], 'end_turn').map((frame) =>
      frameTypeOf(frame) === 'message_delta'
        ? {
            ...frame,
            data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
          }
        : frame,
    )
    const { terminal } = await decodeCompleted(frames)
    expect(terminal.response.usage?.input_tokens).toBe(5)
  })

  it('leaves usage unknown when the stream carries none', async () => {
    const frames: SseEvent[] = [
      {
        event: 'message_start',
        data: JSON.stringify({ type: 'message_start', message: { id: 'm0' } }),
      },
      {
        event: 'message_delta',
        data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
      },
      { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
    ]
    const { terminal } = await decodeCompleted(frames)
    expect(terminal.response.usage).toBeNull()
  })

  it('faults a stream with no stop reason as incomplete', async () => {
    const frames = streamOf([], 'end_turn').filter(
      (frame) => frameTypeOf(frame) !== 'message_delta',
    )
    const events = await decodeAll(frames, { model: MODEL })
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('response.incomplete')
    if (terminal?.type === 'response.incomplete') {
      expect(terminal.response.incomplete_details).toEqual({ reason: 'missing_stop_reason' })
    }
  })

  it('maps stop reasons to completed and incomplete', async () => {
    for (const [stopReason, type, reason] of [
      ['end_turn', 'response.completed', undefined],
      ['tool_use', 'response.completed', undefined],
      ['stop_sequence', 'response.completed', undefined],
      ['max_tokens', 'response.incomplete', 'max_tokens'],
      ['refusal', 'response.incomplete', 'refusal'],
      ['pause_turn', 'response.incomplete', 'pause_turn'],
      ['something_new', 'response.incomplete', 'something_new'],
      [null, 'response.incomplete', 'missing_stop_reason'],
    ] as const) {
      const events = await decodeAll(streamOf([], stopReason), { model: MODEL })
      const terminal = events.at(-1)
      expect(terminal?.type).toBe(type)
      if (terminal?.type === 'response.incomplete') {
        expect(terminal.response.incomplete_details).toEqual({ reason })
      }
    }
  })

  it('closes an unterminated block at message_stop and faults without one', async () => {
    const frames = streamOf(
      [{ start: { type: 'text', text: '' }, deltas: [{ type: 'text_delta', text: 'tail' }] }],
      'end_turn',
    ).filter((frame) => frameTypeOf(frame) !== 'content_block_stop')
    const events = await decodeAll(frames, { model: MODEL })
    const terminal = events.at(-1)
    if (terminal?.type !== 'response.completed') {
      throw new Error('expected a completed response')
    }
    const message = terminal.response.output.find((item) => item.type === 'message')
    if (message === undefined || !isMessageItem(message)) {
      throw new Error('expected a message item')
    }
    expect(messageText(message)).toBe('tail')

    await expect(decodeAll([], { model: MODEL })).rejects.toThrow(/missing_message_stop/)
  })

  it('refuses malformed streams with explicit errors', async () => {
    const start = {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: { id: 'm9', usage: { input_tokens: 1, output_tokens: 1 } },
      }),
    }
    const cases: [string, SseEvent[]][] = [
      ['non-JSON frame', [{ event: undefined, data: '{oops' }]],
      ['frameless type', [{ event: undefined, data: '{"a":1}' }]],
      [
        'bad start',
        [{ event: 'message_start', data: JSON.stringify({ type: 'message_start', message: {} }) }],
      ],
      [
        'delta without start',
        [
          start,
          {
            event: 'content_block_delta',
            data: JSON.stringify({
              type: 'content_block_delta',
              index: 4,
              delta: { type: 'text_delta', text: 'x' },
            }),
          },
        ],
      ],
      [
        'tool without identity',
        [
          start,
          {
            event: 'content_block_start',
            data: JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', name: 'get_time' },
            }),
          },
        ],
      ],
      [
        'redacted without data',
        [
          start,
          {
            event: 'content_block_start',
            data: JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'redacted_thinking' },
            }),
          },
        ],
      ],
      [
        'bad tool JSON',
        [
          start,
          {
            event: 'content_block_start',
            data: JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 't1', name: 'get_time' },
            }),
          },
          {
            event: 'content_block_delta',
            data: JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{oops' },
            }),
          },
          {
            event: 'content_block_stop',
            data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
          },
        ],
      ],
      [
        'start without index',
        [
          {
            event: 'content_block_start',
            data: JSON.stringify({ type: 'content_block_start', content_block: { type: 'text' } }),
          },
        ],
      ],
      [
        'delta without index',
        [
          {
            event: 'content_block_delta',
            data: JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'x' },
            }),
          },
        ],
      ],
      [
        'stop without index',
        [{ event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop' }) }],
      ],
      [
        'delta without delta',
        [{ event: 'message_delta', data: JSON.stringify({ type: 'message_delta' }) }],
      ],
      [
        'stop without start',
        [{ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) }],
      ],
      ['error without envelope', [{ event: 'error', data: JSON.stringify({ type: 'error' }) }]],
      [
        'negative usage',
        streamOf([], 'end_turn').map((frame) =>
          frameTypeOf(frame) === 'message_delta'
            ? {
                ...frame,
                data: JSON.stringify({
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn' },
                  usage: { input_tokens: -1, output_tokens: 1 },
                }),
              }
            : frame,
        ),
      ],
    ]
    for (const [name, frames] of cases) {
      await expect(decodeAll(frames, { model: MODEL }), name).rejects.toThrow(/Anthropic/)
    }
  })

  it('turns a mid-stream error into the canonical error event', async () => {
    const events = await decodeAll(
      errorStreamFrames({ type: 'overloaded_error', message: 'Overloaded' }),
      { model: MODEL },
    )
    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'overloaded_error',
      message: 'Overloaded',
    })

    const typeless = await decodeAll(errorStreamFrames({ message: 'Busy' }), { model: MODEL })
    expect(typeless.at(-1)).toEqual({ type: 'error', code: undefined, message: 'Busy' })
  })
})

describe('error envelope and models list', () => {
  it('maps the invalid-model envelope from the capture', () => {
    const capture: { response: { body: unknown; status: number } } = JSON.parse(
      readFileSync(
        new URL(`${ANTHROPIC_CAPTURE}10-error-invalid-model.json`, import.meta.url),
        'utf8',
      ),
    )
    const error = parseAnthropicError(capture.response.status, capture.response.body)
    expect(error).toMatchObject({ status: 404, kind: 'not_found_error', code: undefined })
    expect(error.message).toContain('no-such-model-m95')
  })

  it('marks the spend cap so the transport never retries it', () => {
    const capped = parseAnthropicError(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Overloaded, enforced_spend_limit_reached here' },
    })
    expect(capped.code).toBe('enforced_spend_limit_reached')
    const plain = parseAnthropicError(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Slow down' },
    })
    expect(plain).toMatchObject({ status: 429, kind: 'rate_limit_error', code: undefined })
    const unenveloped = parseAnthropicError(503, '<html>bad gateway</html>')
    expect(unenveloped).toMatchObject({ status: 503, kind: undefined, code: undefined })
  })

  it('parses the models list shape from the capture sample', () => {
    const capture: {
      response: {
        bodySummary: {
          sample: {
            id: string
            display_name: string
            max_input_tokens: number
            max_tokens: number
          }[]
        }
      }
    } = JSON.parse(
      readFileSync(
        new URL(`${ANTHROPIC_CAPTURE}01-models-list-x-api-key.json`, import.meta.url),
        'utf8',
      ),
    )
    const models = parseAnthropicModelsList({ data: capture.response.bodySummary.sample })
    expect(models.map((model) => model.id)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-4-5-20251001',
    ])
    expect(models[0]).toEqual({
      id: 'claude-sonnet-5-5',
      displayName: 'Claude Sonnet 5.5',
      maxInputTokens: 1_000_000,
      maxTokens: 128_000,
      native: capture.response.bodySummary.sample[0],
    })
    expect(parseAnthropicModelsList({ data: [{ id: 'bare' }] })).toEqual([
      {
        id: 'bare',
        displayName: undefined,
        maxInputTokens: undefined,
        maxTokens: undefined,
        native: { id: 'bare' },
      },
    ])
  })

  it('refuses a models list of unknown shape', () => {
    expect(() => parseAnthropicModelsList({ data: [{ name: 'no-id' }] })).toThrow(
      /invalid_models_list/,
    )
  })
})

describe('review regressions (RVM95AO)', () => {
  it('uses the captured native model id in every golden', () => {
    const captured: { request: { body: { model: string } } } = JSON.parse(
      readFileSync(new URL(`${ANTHROPIC_CAPTURE}08-cache-call-1.json`, import.meta.url), 'utf8'),
    )
    expect(MODEL).toBe(captured.request.body.model)
    for (const name of [
      'first-turn',
      'tool-loop-reasoning',
      'image',
      'packed-output',
      'compaction',
    ]) {
      const request: { body: { model: string } } = JSON.parse(golden(name))
      expect(request.body.model).toBe(captured.request.body.model)
    }
  })

  it('rolls only the final breakpoint as growing history preserves prefix bytes', () => {
    const histories: CreateResponseBody['input'][] = [
      [],
      [
        { type: 'function_call', call_id: 'rolling-call', name: 'get_time', arguments: '{}' },
        { type: 'function_call_output', call_id: 'rolling-call', output: '{"time":"12:00"}' },
      ],
      [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '12:00 UTC.' }],
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'And tomorrow?' }] },
      ],
    ]
    const snapshots = []
    const input: InputItem[] = []
    for (const history of histories) {
      input.push(...history)
      const request = encodeAnthropicRequest(timeQuestionBody(input), BASE_OPTIONS)
      const prior = snapshots.at(-1)
      if (prior !== undefined) {
        expect(JSON.stringify(request.body.system)).toBe(JSON.stringify(prior.body.system))
        expect(JSON.stringify(request.body.tools)).toBe(JSON.stringify(prior.body.tools))
        expect(historyBytes(request.body.messages.slice(0, prior.body.messages.length))).toBe(
          historyBytes(prior.body.messages),
        )
      }
      const controls = JSON.stringify(request).match(/"cache_control"/g)
      expect(controls).toHaveLength(2)
      const earlierMessages = request.body.messages.slice(0, -1)
      for (const message of earlierMessages) {
        expect(JSON.stringify(message)).not.toContain('cache_control')
      }
      expect(request.body.messages.at(-1)?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ cache_control: { type: 'ephemeral', ttl: '5m' } }),
        ]),
      )
      snapshots.push(request)
    }
    expect(`${JSON.stringify(snapshots, null, 2)}\n`).toBe(goldenBytes('growing-history'))
  })

  it.each([
    ['text_delta', 'text', { type: 'text', text: '' }],
    ['input_json_delta', 'partial_json', { type: 'tool_use', id: 't1', name: 'get_time' }],
    ['thinking_delta', 'thinking', { type: 'thinking', thinking: '', signature: '' }],
    ['signature_delta', 'signature', { type: 'thinking', thinking: '', signature: '' }],
  ])('fails malformed known %s payloads instead of completing', async (type, field, start) => {
    for (const payload of [37, undefined]) {
      const frames = streamOf([{ start, deltas: [{ type, [field]: payload }] }], 'end_turn')
      await expect(decodeAll(frames, { model: MODEL })).rejects.toThrow(`malformed_${type}`)
    }
  })

  it('refuses the captured tool stream with numeric partial_json', async () => {
    const frames = captureEvents(`${ANTHROPIC_CAPTURE}03-tool-call-stream.json`).map((frame) => {
      if (frameTypeOf(frame) !== 'content_block_delta') return frame
      const data: { type: string; index: number; delta: { type: string; partial_json: unknown } } =
        JSON.parse(frame.data)
      return {
        ...frame,
        data: JSON.stringify({ ...data, delta: { ...data.delta, partial_json: 37 } }),
      }
    })
    await expect(decodeAll(frames, { model: MODEL })).rejects.toThrow('malformed_input_json_delta')
  })

  it('rejects a known delta for the wrong block kind', async () => {
    const frames = streamOf(
      [
        {
          start: { type: 'text', text: '' },
          deltas: [{ type: 'input_json_delta', partial_json: '{}' }],
        },
      ],
      'end_turn',
    )
    await expect(decodeAll(frames, { model: MODEL })).rejects.toThrow('malformed_input_json_delta')
  })

  it('retains distinct write counts at equal total input through canonical validation', async () => {
    const first = await decodeCompleted(cacheUsageFrames(16, 1925, 1925, 0))
    const second = await decodeCompleted(cacheUsageFrames(941, 1000, 750, 250))
    const firstUsage = responseSchema.parse(first.terminal.response).usage
    const secondUsage = responseSchema.parse(second.terminal.response).usage
    expect(firstUsage?.input_tokens).toBe(secondUsage?.input_tokens)
    expect(firstUsage?.input_tokens_details).toEqual({
      cache_write_tokens: 1925,
      cache_write_tokens_1h: 0,
    })
    expect(secondUsage?.input_tokens_details).toEqual({
      cache_write_tokens: 1000,
      cache_write_tokens_1h: 250,
    })
    expect(secondUsage).not.toEqual(firstUsage)
  })

  it('leaves uncaptured TTL unknown and rejects inconsistent TTL counters', async () => {
    const frames = cacheUsageFrames(16, 1925, 1925, 0).map((frame) => {
      if (frameTypeOf(frame) !== 'message_start') return frame
      const data: { message: { usage: Record<string, unknown> } } = JSON.parse(frame.data)
      delete data.message.usage['cache_creation']
      return { ...frame, data: JSON.stringify(data) }
    })
    const { terminal } = await decodeCompleted(frames)
    expect(terminal.response.usage?.input_tokens_details).toEqual({ cache_write_tokens: 1925 })
    await expect(decodeAll(cacheUsageFrames(16, 1925, 1925, 1), { model: MODEL })).rejects.toThrow(
      'invalid_cache_write_split',
    )
  })

  it('reads the installed language when a local refusal occurs', async () => {
    setUiText(
      {
        ...EN,
        anthropicCodecEmptyTurn: 'Lokalisierte leere Anfrage',
        anthropicCodecError: 'Lokalisierter Protokollfehler',
      },
      'de',
    )
    try {
      expect(() => encodeAnthropicRequest(canonicalBody({}), BASE_OPTIONS)).toThrow(
        'Lokalisierte leere Anfrage (empty_turn)',
      )
      await expect(
        decodeAll([{ event: undefined, data: '{bad' }], { model: MODEL }),
      ).rejects.toThrow('Lokalisierter Protokollfehler (non_json_frame)')
    } finally {
      setUiText(EN, 'en')
    }
  })
})

/** Fault injections preserve the captured usage shape and final-delta omission of TTL. */
function cacheUsageFrames(
  fresh: number,
  written: number,
  fiveMinute: number,
  oneHour: number,
): SseEvent[] {
  return captureEvents(`${ANTHROPIC_CAPTURE}08-cache-call-1.json`).map((frame) => {
    const type = frameTypeOf(frame)
    if (type !== 'message_start' && type !== 'message_delta') return frame
    const data: { type: string; message?: { usage: unknown }; usage?: unknown } = JSON.parse(
      frame.data,
    )
    const usage = {
      input_tokens: fresh,
      cache_creation_input_tokens: written,
      cache_read_input_tokens: 0,
      output_tokens: 4,
    }
    if (data.message === undefined) {
      data.usage = usage
    } else {
      data.message.usage = {
        ...usage,
        cache_creation: {
          ephemeral_5m_input_tokens: fiveMinute,
          ephemeral_1h_input_tokens: oneHour,
        },
      }
    }
    return { ...frame, data: JSON.stringify(data) }
  })
}

describe('bounded Anthropic accumulation (RVM95AO 4)', () => {
  it('caps frame bytes before parsing, including UTF-8 bytes', async () => {
    const data = JSON.stringify({
      type: 'ping',
      padding: 'é'.repeat(ANTHROPIC_MAX_FRAME_BYTES / 2),
    })
    expect(data.length).toBeLessThan(ANTHROPIC_MAX_FRAME_BYTES)
    await expect(decodeAll([{ event: 'ping', data }], { model: MODEL })).rejects.toThrow(
      'frame_bytes_limit',
    )
  })

  it.each([
    ['text', 'text_delta', 'text'],
    ['thinking', 'thinking_delta', 'thinking'],
    ['thinking', 'signature_delta', 'signature'],
    ['tool_use', 'input_json_delta', 'partial_json'],
  ])('caps retained %s/%s bytes before append', async (kind, type, field) => {
    const limit = kind === 'tool_use' ? ANTHROPIC_MAX_ARGUMENT_BYTES : ANTHROPIC_MAX_ITEM_BYTES
    const fragment = 'x'.repeat(ANTHROPIC_MAX_FRAME_BYTES / 2)
    const deltas = Array.from({ length: limit / fragment.length + 1 }, () => ({
      type,
      [field]: fragment,
    }))
    if (kind === 'tool_use') {
      deltas.unshift({ type, [field]: '{"value":"' })
      deltas.push({ type, [field]: '"}' })
    }
    const frames = streamOf(
      [
        {
          start: { type: kind, id: 't1', name: 'get_time', text: '', thinking: '', signature: '' },
          deltas,
        },
      ],
      'end_turn',
    )
    await expect(decodeAll(frames, { model: MODEL })).rejects.toThrow(
      kind === 'tool_use' ? 'argument_limit' : 'item_bytes_limit',
    )
  })

  it.each(['text', 'future'])(
    'caps the lifetime %s item count, including finished blocks',
    async (type) => {
      const frames = streamOf(
        Array.from({ length: ANTHROPIC_MAX_ITEMS + 1 }, () => ({
          start: { type, text: '' },
          deltas: [],
        })),
        'end_turn',
      )
      await expect(decodeAll(frames, { model: MODEL })).rejects.toThrow('item_count_limit')
    },
  )

  it.each(['bytes', 'frames'])(
    'caps total stream %s and closes its async source',
    async (dimension) => {
      let isClosed = false
      const frame = {
        event: 'ping',
        data: JSON.stringify({
          type: 'ping',
          padding: dimension === 'bytes' ? 'x'.repeat(ANTHROPIC_MAX_FRAME_BYTES / 2) : '',
        }),
      }
      const count =
        (dimension === 'bytes'
          ? Math.ceil(ANTHROPIC_MAX_STREAM_BYTES / frame.data.length)
          : ANTHROPIC_MAX_FRAMES) + 1
      async function* source() {
        await Promise.resolve()
        try {
          for (let index = 0; index < count; index += 1) yield frame
          yield { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) }
        } finally {
          isClosed = true
        }
      }
      await expect(
        Array.fromAsync(decodeAnthropicStream(source(), { model: MODEL })),
      ).rejects.toThrow('stream_limit')
      expect(isClosed).toBe(true)
    },
  )
})
