// C-M95-4: the local servers' wire, per server version, from live captures
// in docs/certification/m95-captures/<llamacpp|vllm|lmstudio>/. Nothing here
// is hand-shaped wire: the captures are the oracle. Each server pins its
// counted ledger, then the chat codec decodes the reply, tool, parallel
// tool, reasoning and usage frames, and the transport maps the 400 frames
// to typed errors the overflow classifier recognizes.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import {
  decodeChatStream,
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import {
  errorBodySchema,
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  type FunctionCallItem,
  type ResponseObject,
} from '../../src/core/backends/modelapi/schemas'
import { classifyContextOverflow } from '../../src/core/context/overflow'
import {
  nativeCapabilityEvidence,
  parseNativeModelsList,
} from '../../src/core/providers/modelMetadata'
import { presetById } from '../../src/core/providers/presets'

const CHAT_LIMITS = {
  frameBytes: 64 * 1024,
  streamBytes: 4 * 1024 * 1024,
  argumentBytes: 64 * 1024,
  outputItems: 128,
}

const CAPTURES = fileURLToPath(new URL('../../docs/certification/m95-captures/', import.meta.url))

const LLAMACPP: ChatPresetQuirks = {
  presetId: 'llamacpp',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
}

const LMSTUDIO: ChatPresetQuirks = {
  presetId: 'lmstudio',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
}

function captureFile(provider: string, file: string): unknown {
  return JSON.parse(readFileSync(`${CAPTURES}${provider}/${file}`, 'utf8'))
}

function recordField(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`expected an object ${what}`)
  }
  return value as Record<string, unknown>
}

function payloadsOf(provider: string, file: string): unknown[] {
  const frame = recordField(captureFile(provider, file), 'capture frame')
  const response = recordField(frame['response'], 'response')
  if (!Array.isArray(response['events'])) {
    throw new TypeError(`expected events in ${provider}/${file}`)
  }
  return response['events'].map((event) => recordField(event, 'event')['data'])
}

function callsOf(response: ResponseObject): FunctionCallItem[] {
  return response.output.filter(isFunctionCallItem)
}

function textOf(response: ResponseObject): string {
  const message = response.output.find(isMessageItem)
  return message === undefined
    ? ''
    : message.content
        .map((part) => (part.type === 'output_text' && 'text' in part ? part.text : ''))
        .join('')
}

function reasoningOf(response: ResponseObject): string {
  const reasoning = response.output.find(isReasoningItem)
  return reasoning?.summary === undefined ? '' : reasoning.summary.map((part) => part.text).join('')
}

const ledgerSchema = z.array(
  z.object({
    number: z.number(),
    step: z.string(),
    method: z.string(),
    path: z.string(),
    billed: z.boolean(),
    state: z.string(),
    status: z.number(),
    serverVersion: z.string(),
  }),
)

function ledgerOf(provider: string): z.infer<typeof ledgerSchema> {
  return ledgerSchema.parse(captureFile(provider, 'calls.json'))
}

describe('llama.cpp captures (b11541)', () => {
  it('pins the counted ledger: 19 recorded, unbilled frames from one server version', () => {
    const ledger = ledgerOf('llamacpp')
    expect(ledger).toHaveLength(19)
    expect(ledger.map((row) => row.number)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    )
    expect(ledger.every((row) => row.state === 'recorded' && !row.billed)).toBe(true)
    expect(new Set(ledger.map((row) => row.serverVersion))).toEqual(
      new Set(['b11541 (0.6.0-dev, commit f2918cabb)']),
    )
  })

  it('lists one model with its trained and loaded windows', () => {
    const frame = recordField(captureFile('llamacpp', '01-models-list.json'), 'models list')
    const response = recordField(frame['response'], 'response')
    const summary = recordField(response['bodySummary'], 'body summary')
    expect(summary['count']).toBe(1)
    const rows = parseNativeModelsList({ data: summary['sample'] })
    expect(rows).toHaveLength(1)
    const meta = recordField(rows[0]?.['meta'], 'model meta')
    expect(meta['n_ctx']).toBe(4096)
    expect(meta['n_ctx_train']).toBe(40_960)
  })

  it('reads the scanned window from the captured list, not the Meta default', () => {
    // C-M95-4 R2: the scan used to leave a llama.cpp model windowless, so
    // manual compact assumed Meta's 1,048,576-token window on a 4096-token
    // server. The captured sample must evidence the live window.
    const frame = recordField(captureFile('llamacpp', '01-models-list.json'), 'models list')
    const response = recordField(frame['response'], 'response')
    const summary = recordField(response['bodySummary'], 'body summary')
    const rows = parseNativeModelsList({ data: summary['sample'] })
    const evidence = nativeCapabilityEvidence('llamacpp', rows[0], {
      kind: 'models-list',
      ref: 'test',
    })
    expect(evidence.fields.limits?.contextTokens).toBe(4096)
  })

  it('stamps each preset with its ledger server version', () => {
    // C-M95-4 R2: the stamp is what the quirks were proven against; the
    // scan names it when it fails closed on an unknown build.
    const versionOf = (provider: string) => {
      const ledger = ledgerOf(provider)
      const versions = new Set(ledger.map((row) => row.serverVersion))
      expect(versions.size).toBe(1)
      return [...versions][0]
    }
    expect(presetById('llamacpp')?.capturedBuild).toBe(versionOf('llamacpp'))
    expect(presetById('lmstudio')?.capturedBuild).toBe(versionOf('lmstudio'))
  })

  it('decodes the plain reply with usage on a choices-less chunk', () => {
    const decoded = decodeChatStream(
      payloadsOf('llamacpp', '03-plain-reply.json'),
      'Qwen3-0.6B-Q8_0',
      LLAMACPP,
      CHAT_LIMITS,
    )
    // The 64-token cap hit mid-thought, so the turn is incomplete with
    // thinking but no answer text yet.
    expect(decoded.response.status).toBe('incomplete')
    expect(textOf(decoded.response)).toBe('')
    expect(reasoningOf(decoded.response)).toContain('hello')
    expect(callsOf(decoded.response)).toHaveLength(0)
    expect(decoded.response.usage?.input_tokens).toBe(14)
    expect(decoded.response.usage?.output_tokens).toBe(64)
  })

  it('decodes one fragmented tool call with its id and name', () => {
    const decoded = decodeChatStream(
      payloadsOf('llamacpp', '04-one-tool.json'),
      'Qwen3-0.6B-Q8_0',
      LLAMACPP,
      CHAT_LIMITS,
    )
    const calls = callsOf(decoded.response)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('get_weather')
    expect(calls[0]?.arguments).toBe('{"city": "Paris"}')
    expect(calls[0]?.call_id).not.toBe('')
  })

  it('decodes parallel tool calls as two calls', () => {
    const decoded = decodeChatStream(
      payloadsOf('llamacpp', '05-parallel-tools.json'),
      'Qwen3-0.6B-Q8_0',
      LLAMACPP,
      CHAT_LIMITS,
    )
    const calls = callsOf(decoded.response)
    expect(calls.map((call) => call.name)).toEqual(['get_weather', 'get_time'])
    expect(calls[0]?.arguments).toBe('{"city": "Paris"}')
    expect(calls[1]?.arguments).toBe('{"city": "London"}')
  })

  it('decodes streamed reasoning_content beside the answer', () => {
    const decoded = decodeChatStream(
      payloadsOf('llamacpp', '06-reasoning.json'),
      'Qwen3-0.6B-Q8_0',
      LLAMACPP,
      CHAT_LIMITS,
    )
    // The 256-token cap hit mid-thought: thinking but no answer yet.
    expect(decoded.response.status).toBe('incomplete')
    expect(reasoningOf(decoded.response)).toContain('sheep')
    expect(textOf(decoded.response)).toBe('')
  })

  it('maps the numeric-code 400s to typed errors the overflow classifier sees', () => {
    const overflow = recordField(
      captureFile('llamacpp', '15-overflow-long-prompt.json'),
      'overflow',
    )
    const overflowBody = errorBodySchema.parse(
      recordField(overflow['response'], 'response')['body'],
    )
    expect(overflowBody.error.type).toBe('exceed_context_size_error')
    expect(overflowBody.error.code).toBe('400')
    expect(
      classifyContextOverflow({
        format: 'chat',
        error: {
          message: overflowBody.error.message,
          status: 400,
          code: overflowBody.error.code ?? undefined,
          kind: overflowBody.error.type ?? undefined,
        },
      }),
    ).toBe('error')
    const malformed = recordField(
      captureFile('llamacpp', '16-malformed-temperature.json'),
      'malformed',
    )
    const malformedBody = errorBodySchema.parse(
      recordField(malformed['response'], 'response')['body'],
    )
    expect(malformedBody.error.type).toBe('invalid_request_error')
    expect(malformedBody.error.code).toBe('400')
  })

  it('encodes max_tokens, tool_choice auto and usage opt-in as captured', () => {
    const frame = recordField(captureFile('llamacpp', '04-one-tool.json'), 'one tool')
    const request = recordField(frame['request'], 'request')
    const native = recordField(request['body'], 'request body')
    expect(native['max_tokens']).toBe(128)
    expect(native['tool_choice']).toBe('auto')
    expect(native['stream_options']).toEqual({ include_usage: true })
    const encoded = encodeChatRequest(
      {
        model: 'Qwen3-0.6B-Q8_0',
        instructions: 'Be brief.',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What is the weather in Paris?' }],
          },
        ],
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get the current weather for a city.',
            parameters: { type: 'object' },
            strict: false,
          },
        ],
        tool_choice: 'auto',
        reasoning: { effort: 'low', summary: 'auto' },
        stream: true,
        store: false,
        include: [],
        max_output_tokens: 128,
        prompt_cache_key: 'unused',
        prompt_cache_retention: '24h',
      },
      'Qwen3-0.6B-Q8_0',
      LLAMACPP,
    )
    expect(encoded.body.max_tokens).toBe(128)
    expect(encoded.body.tool_choice).toBe('auto')
    expect(encoded.body.stream_options).toEqual({ include_usage: true })
    expect(encoded.body.stream).toBe(true)
  })
})

describe('LM Studio captures (llmster 0.0.25-1)', () => {
  it('pins the counted ledger: 12 recorded, unbilled frames from one server version', () => {
    const ledger = ledgerOf('lmstudio')
    expect(ledger).toHaveLength(12)
    expect(ledger.map((row) => row.number)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
    expect(ledger.every((row) => row.state === 'recorded' && !row.billed)).toBe(true)
    expect(new Set(ledger.map((row) => row.serverVersion))).toEqual(new Set(['llmster 0.0.25-1']))
  })

  it('lists models with clean ids and no window field', () => {
    const frame = recordField(captureFile('lmstudio', '01-models-list.json'), 'models list')
    const response = recordField(frame['response'], 'response')
    const summary = recordField(response['bodySummary'], 'body summary')
    expect(summary['count']).toBe(2)
    const sample = summary['sample']
    if (!Array.isArray(sample)) {
      throw new TypeError('expected a sample list')
    }
    const ids = sample.map((entry) => recordField(entry, 'model')['id'])
    expect(ids).toContain('qwen3-0.6b')
    for (const entry of sample) {
      const row = recordField(entry, 'model')
      expect(new Set(Object.keys(row))).toEqual(new Set(['id', 'object', 'owned_by']))
    }
  })

  it('decodes the plain reply: thinking cut by the cap, reasoning usage', () => {
    const decoded = decodeChatStream(
      payloadsOf('lmstudio', '02-plain-reply.json'),
      'qwen3-0.6b',
      LMSTUDIO,
      CHAT_LIMITS,
    )
    expect(decoded.response.status).toBe('incomplete')
    expect(textOf(decoded.response)).toBe('')
    expect(reasoningOf(decoded.response)).toContain('hello')
    expect(decoded.response.usage?.input_tokens).toBe(14)
    expect(decoded.response.usage?.output_tokens).toBe(32)
  })

  it('decodes one tool call and parallel tool calls', () => {
    const one = decodeChatStream(
      payloadsOf('lmstudio', '03-one-tool.json'),
      'qwen3-0.6b',
      LMSTUDIO,
      CHAT_LIMITS,
    )
    const oneCalls = callsOf(one.response)
    expect(oneCalls).toHaveLength(1)
    expect(oneCalls[0]?.name).toBe('get_weather')
    expect(oneCalls[0]?.call_id).not.toBe('')
    const parallel = decodeChatStream(
      payloadsOf('lmstudio', '04-parallel-tools.json'),
      'qwen3-0.6b',
      LMSTUDIO,
      CHAT_LIMITS,
    )
    expect(callsOf(parallel.response).map((call) => call.name)).toEqual(['get_weather', 'get_time'])
  })

  it('decodes streamed reasoning_content beside the cut answer', () => {
    const decoded = decodeChatStream(
      payloadsOf('lmstudio', '05-reasoning.json'),
      'qwen3-0.6b',
      LMSTUDIO,
      CHAT_LIMITS,
    )
    expect(decoded.response.status).toBe('incomplete')
    expect(reasoningOf(decoded.response)).toContain('sheep')
    expect(textOf(decoded.response)).toBe('')
  })

  it('maps the mid-stream overflow to the error event with the inner type', () => {
    const decoded = decodeChatStream(
      payloadsOf('lmstudio', '07-overflow-long-prompt.json'),
      'qwen3-0.6b',
      LMSTUDIO,
      CHAT_LIMITS,
    )
    expect(decoded.response.status).toBe('failed')
    const errors = decoded.events.filter((event) => event.type === 'error')
    expect(errors).toHaveLength(1)
    expect(JSON.stringify(errors[0])).toContain('exceed_context_size_error')
  })

  it('maps the string-form 400 to the server’s words', () => {
    const frame = recordField(captureFile('lmstudio', '11-toolchoice-object.json'), 'object choice')
    const response = recordField(frame['response'], 'response')
    const parsed = errorBodySchema.parse(response['body'])
    expect(parsed.error.message).toContain("Invalid tool_choice type: 'object'")
  })
})
