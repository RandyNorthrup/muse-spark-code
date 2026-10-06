// Lane H (M95): the chat codec's requests and streams, per preset, against
// the 2026-10-04 wire captures in docs/certification/m95-captures/.
//
// Each encode test rebuilds a canonical body from a capture's own request
// and requires byte-equal native output; each decode test feeds a capture's
// own streamed `data` payloads. Nothing here is hand-shaped wire: the
// captures are the oracle. Quirks below mirror the preset data lane P will
// own (PLAN.md D74); the values match the captures' requests.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import { customQuirksFor } from '../../src/core/providers/presets'
import { mcpFunctionDefinition } from '../../src/core/backends/modelapi/mcp/functions'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import {
  CHAT_CODEC_FORMAT,
  ChatStreamDecoder,
  decodeChatStream,
  encodeChatRequest,
  readChatReasoning,
  type ChatEncodeOptions,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import type {
  CreateResponseBody,
  FunctionCallItem,
  InputItem,
  ReasoningItem,
  ResponseObject,
  StreamEvent,
  ToolDefinition,
} from '../../src/core/backends/modelapi/schemas'

const CHAT_LIMITS = {
  frameBytes: 64 * 1024,
  streamBytes: 1024 * 1024,
  argumentBytes: 64 * 1024,
  outputItems: 128,
}

const CAPTURES = fileURLToPath(new URL('../../docs/certification/m95-captures/', import.meta.url))

function captureFile(provider: string, file: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(`${CAPTURES}${provider}/${file}`, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`capture ${provider}/${file} is not an object`)
  }
  return parsed
}

interface CaptureFrame {
  readonly requestBody: Record<string, unknown>
  readonly payloads: unknown[]
}

function frameOf(provider: string, file: string): CaptureFrame {
  const frame = z
    .object({
      request: z.object({ body: z.record(z.string(), z.unknown()) }),
      response: z.object({ events: z.array(z.object({ data: z.unknown() })) }),
    })
    .parse(captureFile(provider, file))
  return {
    requestBody: frame.request.body,
    payloads: frame.response.events.map((event) => event.data),
  }
}

function stringField(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`expected a string ${what}`)
  }
  return value
}

function recordField(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`expected an object ${what}`)
  }
  return z.record(z.string(), z.unknown()).parse(value)
}

function arrayField(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`expected an array ${what}`)
  }
  return value
}

/** Mutates captured call identity fields; all remaining wire bytes stay captured. */
function withoutCapturedCallFields(
  payloads: readonly unknown[],
  fields: readonly string[],
): unknown[] {
  return payloads.map((payload) => {
    if (typeof payload !== 'object' || payload === null) return payload
    const chunk = recordField(payload, 'chunk')
    const choices = arrayField(chunk['choices'] ?? [], 'choices').map((value) => {
      const choice = recordField(value, 'choice')
      if (choice['delta'] == null) return choice
      const delta = recordField(choice['delta'], 'delta')
      if (!Array.isArray(delta['tool_calls'])) return choice
      const calls = delta['tool_calls'].map((value) => {
        const call = recordField(value, 'call')
        return Object.fromEntries(Object.entries(call).filter(([key]) => !fields.includes(key)))
      })
      return { ...choice, delta: { ...delta, tool_calls: calls } }
    })
    return { ...chunk, choices }
  })
}

// --- preset quirks under test (lane P's `presets.ts` will own these values) ---

const OPENROUTER: ChatPresetQuirks = {
  presetId: 'openrouter',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-object',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'details',
  routing: { zdr: true },
  extraHeaders: [
    ['HTTP-Referer', 'https://github.com/RandyNorthrup/muse-spark-code'],
    ['X-OpenRouter-Title', 'Muse Spark Code (Unofficial)'],
    ['X-OpenRouter-Categories', 'ide-extension'],
  ],
}

const GROQ: ChatPresetQuirks = {
  presetId: 'groq',
  outputCap: 'max_completion_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'text',
}

const MISTRAL: ChatPresetQuirks = {
  presetId: 'mistral',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: true,
  includeUsage: true,
  toolStream: false,
  toolResultName: true,
  replayField: 'none',
}

const TOGETHER: ChatPresetQuirks = {
  presetId: 'together',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'text',
}

const FIREWORKS: ChatPresetQuirks = {
  presetId: 'fireworks',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: true,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
}

const DEEPSEEK: ChatPresetQuirks = {
  presetId: 'deepseek',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
}

const HUGGINGFACE: ChatPresetQuirks = {
  presetId: 'huggingface',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'text',
}

const ZAI: ChatPresetQuirks = {
  presetId: 'zai',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: true,
  toolResultName: false,
  replayField: 'content',
}

// --- canonical bodies rebuilt from a capture's own request ---

function canonicalTool(native: unknown): ToolDefinition {
  const tool = recordField(native, 'tool')
  const fn = recordField(tool['function'], 'tool.function')
  return {
    type: 'function',
    name: stringField(fn['name'], 'tool name'),
    description: stringField(fn['description'], 'tool description'),
    parameters: recordField(fn['parameters'], 'tool parameters'),
    strict: false,
  }
}

/**
 * Rebuilds the canonical body a capture's request came from: system text
 * to instructions, messages to input items (assistant reasoning to a
 * reasoning item carrying this codec's opaque payload), tools to tools.
 * The codec must then reproduce the captured bytes exactly.
 */
function bodyFromCapture(
  requestBody: Record<string, unknown>,
  quirks: ChatPresetQuirks,
): { readonly body: CreateResponseBody; readonly model: string } {
  const messages = arrayField(requestBody['messages'], 'messages')
  const input: InputItem[] = []
  const model = stringField(requestBody['model'], 'model')
  let instructions = ''
  for (const message of messages) {
    const msg = recordField(message, 'message')
    const role = stringField(msg['role'], 'role')
    if (role === 'system' && instructions === '' && typeof msg['content'] === 'string') {
      instructions = msg['content']
      continue
    }
    if (role === 'system' || role === 'developer') {
      throw new Error('fixture system message is not a plain string')
    }
    if (role === 'user') {
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: stringField(msg['content'], 'user text') }],
      })
      continue
    }
    if (role === 'assistant') {
      const content = msg['content']
      if (typeof content === 'string' && content !== '') {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: content }],
        })
      }
      const details = msg['reasoning_details']
      const reasoningContent = msg['reasoning_content']
      const reasoning = msg['reasoning']
      let text = ''
      let detailsRaw: unknown[] | undefined
      if (Array.isArray(details)) {
        detailsRaw = details
        text = details
          .map((entry) => {
            const textPart = recordField(entry, 'reasoning detail')['text']
            return typeof textPart === 'string' ? textPart : ''
          })
          .join('')
      } else if (typeof reasoningContent === 'string') {
        text = reasoningContent
      } else if (typeof reasoning === 'string') {
        text = reasoning
      }
      if (detailsRaw !== undefined || text !== '') {
        input.push(opaqueReasoningItem(quirks.presetId, text, detailsRaw, model))
      }
      const calls = arrayField(msg['tool_calls'] ?? [], 'tool_calls')
      for (const call of calls) {
        const toolCall = recordField(call, 'tool_call')
        const fn = recordField(toolCall['function'], 'tool_call.function')
        input.push({
          type: 'function_call',
          call_id: stringField(toolCall['id'], 'call id'),
          name: stringField(fn['name'], 'call name'),
          arguments: stringField(fn['arguments'], 'call arguments'),
        })
      }
      continue
    }
    if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: stringField(msg['tool_call_id'], 'tool_call_id'),
        output: stringField(msg['content'], 'tool content'),
      })
      continue
    }
    throw new Error(`unexpected role ${role}`)
  }
  const tools = arrayField(requestBody['tools'] ?? [], 'tools').map((tool) => canonicalTool(tool))
  const cap =
    'max_tokens' in requestBody ? requestBody['max_tokens'] : requestBody['max_completion_tokens']
  if (typeof cap !== 'number') {
    throw new TypeError('capture request has no numeric output cap')
  }
  const cacheKey = requestBody['prompt_cache_key']
  return {
    model,
    body: {
      model: 'test-model',
      input,
      instructions,
      tools,
      tool_choice: 'auto',
      reasoning: { effort: 'low', summary: 'auto' },
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: cap,
      prompt_cache_key: typeof cacheKey === 'string' ? cacheKey : 'unused',
      prompt_cache_retention: '24h',
    },
  }
}

function opaqueReasoningItem(
  presetId: string,
  text: string,
  details: unknown[] | undefined,
  model = 'm',
): ReasoningItem {
  return {
    type: 'reasoning',
    summary: text === '' ? [] : [{ type: 'reasoning_text', text }],
    encrypted_content: JSON.stringify({
      chat: {
        v: 1,
        provider: presetId,
        model,
        ...(text !== '' && { text }),
        ...(details !== undefined && { details }),
      },
    }),
  }
}

// --- encode: the captured request bytes, per preset ---

function expectRoundTrip(provider: string, file: string, quirks: ChatPresetQuirks): void {
  const frame = frameOf(provider, file)
  const rebuilt = bodyFromCapture(frame.requestBody, quirks)
  const encoded = encodeChatRequest(rebuilt.body, rebuilt.model, quirks)
  expect(encoded.body).toEqual(frame.requestBody)
  expect(JSON.stringify(encoded.body)).toBe(JSON.stringify(frame.requestBody))
}

const CHAT_GOLDENS = fileURLToPath(new URL('../fixtures/modelapi-chat/', import.meta.url))
const IMAGE_URL = 'data:image/png;base64,AAAA'

function imageBody(isToolOutput: boolean): CreateResponseBody {
  const parts = [
    { type: 'input_text', text: 'Describe this image.' },
    { type: 'input_image', image_url: IMAGE_URL, detail: 'auto' },
    { type: 'input_text', text: 'Be brief.' },
  ] as const
  return tinyBody({
    input: isToolOutput
      ? [
          {
            type: 'function_call',
            call_id: 'image0001',
            name: 'read_file',
            arguments: '{"path":"shot.png"}',
          },
          { type: 'function_call_output', call_id: 'image0001', output: parts },
        ]
      : [{ type: 'message', role: 'user', content: parts }],
  })
}

function expectRequestGolden(name: string, request: unknown): void {
  const golden: unknown = JSON.parse(readFileSync(`${CHAT_GOLDENS}${name}.json`, 'utf8'))
  expect(JSON.stringify(request)).toBe(JSON.stringify(golden))
}

function retainedToolBody(output: string): CreateResponseBody {
  // The packing swap changes only the canonical result; compaction keeps these tools.
  return tinyBody({
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'What time is it?' }],
      },
      {
        type: 'function_call',
        call_id: 'time00001',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      { type: 'function_call_output', call_id: 'time00001', output },
    ],
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'time',
        parameters: { type: 'object' },
        strict: false,
      },
      {
        type: 'function',
        name: 'recall_output',
        description: 'recall',
        parameters: { type: 'object' },
        strict: false,
      },
    ],
    prompt_cache_key: 'session-cache',
  })
}

describe('chat codec retained-history scenario goldens', () => {
  it('encodes image input for the captured vision-capable Mistral model', () => {
    const capture = recordField(captureFile('mistral', '01-models-list.json'), 'model list')
    const response = recordField(capture['response'], 'response')
    const body = recordField(response['bodySummary'], 'body summary')
    const models = arrayField(body['sample'], 'models').map((model) => recordField(model, 'model'))
    const model = models.find((entry) => entry['id'] === 'ministral-3b-latest')
    const capabilities = recordField(model?.['capabilities'], 'capabilities')
    const hasVision = z.boolean().parse(capabilities['vision'])
    expect(hasVision).toBe(true)
    const encoded = encodeChatRequest(imageBody(false), 'ministral-3b-latest', MISTRAL, {
      capabilities: { vision: hasVision },
    })
    expectRequestGolden('image-input', encoded.body)
    const grown = encodeChatRequest(
      {
        ...imageBody(false),
        input: [
          ...imageBody(false).input,
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'And now?' }] },
        ],
      },
      'ministral-3b-latest',
      MISTRAL,
      { capabilities: { vision: hasVision } },
    )
    expect(JSON.stringify(grown.body.messages.slice(0, encoded.body.messages.length))).toBe(
      JSON.stringify(encoded.body.messages),
    )
  })

  it('encodes image tool output as a tool result followed by user image parts', () => {
    const encoded = encodeChatRequest(imageBody(true), 'ministral-3b-latest', MISTRAL, {
      capabilities: { vision: true },
    })
    expectRequestGolden('image-tool-output', encoded.body)
    const body = imageBody(true)
    const grown = encodeChatRequest(
      {
        ...body,
        input: [
          ...body.input,
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] },
        ],
      },
      'ministral-3b-latest',
      MISTRAL,
      { capabilities: { vision: true } },
    )
    expect(JSON.stringify(grown.body.messages.slice(0, encoded.body.messages.length))).toBe(
      JSON.stringify(encoded.body.messages),
    )
  })

  it('keeps parallel tool results together before appending their image messages', () => {
    const body = imageBody(true)
    const call = body.input[0]
    const output = body.input[1]
    if (call?.type !== 'function_call' || output?.type !== 'function_call_output') {
      throw new Error('image scenario is missing its tool call/result')
    }
    const encoded = encodeChatRequest(
      {
        ...body,
        input: [
          call,
          { ...call, call_id: 'image0002' },
          output,
          { ...output, call_id: 'image0002' },
        ],
      },
      'm',
      MISTRAL,
      { capabilities: { vision: true } },
    )
    expect(encoded.body.messages.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'tool',
      'tool',
      'user',
      'user',
    ])
    expect(encoded.body.messages[2]).toMatchObject({ tool_call_id: 'image0001' })
    expect(encoded.body.messages[3]).toMatchObject({ tool_call_id: 'image0002' })
    expect(encoded.body.messages.at(-1)).toEqual(encoded.body.messages.at(-2))
  })

  it('marks only the last text part of image input while retaining image bytes', () => {
    const parts = [
      { type: 'text', text: 'Describe this image.' },
      { type: 'image_url', image_url: { url: IMAGE_URL, detail: 'auto' } },
      { type: 'text', text: 'Be brief.' },
    ] as const
    for (const cacheBreakpoints of ['anthropic', 'last'] as const) {
      const options = { capabilities: { vision: true }, cacheBreakpoints }
      const encoded = encodeChatRequest(imageBody(false), 'm', OPENROUTER, options)
      expect(encoded.body.messages[1]).toEqual({
        role: 'user',
        content: [parts[0], parts[1], { ...parts[2], cache_control: { type: 'ephemeral' } }],
      })
      const grown = encodeChatRequest(
        {
          ...imageBody(false),
          input: [
            ...imageBody(false).input,
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next' }] },
          ],
        },
        'm',
        OPENROUTER,
        options,
      )
      expect(grown.body.messages[1]).toEqual({
        role: 'user',
        content: parts,
      })
    }
  })

  it('encodes retained completed hosted search as text and keeps the saved answer', () => {
    const input: InputItem[] = [
      opaqueReasoningItem('meta', 'old thought', undefined),
      {
        type: 'web_search_call',
        id: 'search-1',
        status: 'completed',
        action: {
          type: 'search',
          queries: ['vite 7 release'],
          sources: [{ type: 'url', url: 'https://vite.dev/' }],
        },
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Saved answer.' }],
      },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] },
    ]
    const encoded = encodeChatRequest(tinyBody({ input }), 'm', GROQ)
    expect(encoded.body).not.toHaveProperty('tools')
    expect(encoded.body.messages[1]).toEqual({
      role: 'assistant',
      content: JSON.stringify(input[1]),
    })
    expect(encoded.body.messages[2]).toEqual({ role: 'assistant', content: 'Saved answer.' })
    expect(JSON.stringify(encoded.body)).not.toContain('old thought')
    expectRequestGolden('hosted-search-history', encoded.body)
  })

  it('encodes packed output byte for byte and preserves all other native prefix bytes', () => {
    const packed =
      'Packed output "observation-1" (100 characters, 10 lines, about 25 tokens): sent whole before, packed to save context. Its first 1 and last 1 lines:\nhead\n[…]\ntail\nCall recall_output with id "observation-1" and an offset to page the original back.'
    const body = retainedToolBody(packed)
    const encoded = encodeChatRequest(body, 'ministral-3b-latest', MISTRAL, {
      cacheBreakpoints: 'anthropic',
    })
    expectRequestGolden('packed-output', encoded.body)
    const full = encodeChatRequest(
      retainedToolBody('full original output'),
      'ministral-3b-latest',
      MISTRAL,
      { cacheBreakpoints: 'anthropic' },
    )
    expect(JSON.stringify(encoded.body.messages.slice(0, -1))).toBe(
      JSON.stringify(full.body.messages.slice(0, -1)),
    )
    expect(encoded.body.tools).toEqual(full.body.tools)
    expect(encoded.body.prompt_cache_key).toBe(full.body.prompt_cache_key)
  })

  it('encodes compaction byte for byte with retained tool order and stable cache prefix', () => {
    const body = retainedToolBody('{"time":"12:00"}')
    const before = encodeChatRequest(body, 'ministral-3b-latest', MISTRAL, {
      cacheBreakpoints: 'anthropic',
    })
    const compact = encodeChatRequest(
      {
        ...body,
        input: [
          ...body.input,
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Summarize the conversation for continuation.' }],
          },
        ],
      },
      'ministral-3b-latest',
      MISTRAL,
      { cacheBreakpoints: 'anthropic' },
    )
    expectRequestGolden('compaction', compact.body)
    expect(JSON.stringify(compact.body.tools)).toBe(JSON.stringify(before.body.tools))
    expect(compact.body.tool_choice).toBe('auto')
    expect(compact.body.prompt_cache_key).toBe(before.body.prompt_cache_key)
    expect(JSON.stringify(compact.body.messages.slice(0, -2))).toBe(
      JSON.stringify(before.body.messages.slice(0, -1)),
    )
    expect(compact.body.messages.at(-2)).toMatchObject({
      content: [{ type: 'text', text: '{"time":"12:00"}' }],
    })
    expect(compact.body.messages.at(-1)).toMatchObject({
      content: [{ cache_control: { type: 'ephemeral' } }],
    })
  })
})

describe('chat codec request goldens', () => {
  it('preserves each MCP fallback in a mixed strict-capable Chat request (RVM106T F2)', () => {
    const closed = mcpFunctionDefinition('mcp__s__closed', {
      name: 'closed',
      inputSchema: { type: 'object', additionalProperties: false },
    })
    const open = mcpFunctionDefinition('mcp__s__open', {
      name: 'open',
      inputSchema: { type: 'object', additionalProperties: true },
    })
    const body = tinyBody({ tools: [closed.definition, open.definition] })
    const on = encodeChatRequest(body, 'm', { ...GROQ, supportsStrictTools: true })
    expect(on.body.tools?.[0]?.function.strict).toBe(true)
    expect(on.body.tools?.[1]?.function).toMatchObject({
      strict: false,
      parameters: open.definition.parameters,
    })
    const off = encodeChatRequest(body, 'm', { ...GROQ, supportsStrictTools: false })
    expect(off.body.tools?.every((tool) => !Object.hasOwn(tool.function, 'strict'))).toBe(true)
  })

  it('rewrites custom strict tools only when supportsStrictTools is on (F4)', () => {
    const body = tinyBody({ tools: toolDefinitions('linux') })
    const compat = customQuirksFor('chat', { supportsStrictTools: true })
    const on = encodeChatRequest(body, 'm', {
      ...GROQ,
      presetId: 'custom',
      supportsStrictTools: compat.supportsStrictTools,
    })
    expect(on.body.tools?.[0]?.function).toMatchObject({
      strict: true,
      parameters: {
        additionalProperties: false,
        required: ['path', 'offset', 'limit'],
        properties: { offset: { type: ['integer', 'null'] } },
      },
    })
    const before = encodeChatRequest(body, 'm', GROQ)
    const off = encodeChatRequest(body, 'm', { ...GROQ, supportsStrictTools: false })
    expect(JSON.stringify(off)).toBe(JSON.stringify(before))
    expect(off.body.tools?.[0]?.function).not.toHaveProperty('strict')
    expect(body.tools[0]).toMatchObject({ strict: false })
  })

  it('identifies the chat format for lane T', () => {
    expect(CHAT_CODEC_FORMAT).toBe('chat')
  })

  it('encodes OpenRouter byte for byte: tools, routing, reasoning object', () => {
    expectRoundTrip('openrouter', '04-tool-call-stream.json', OPENROUTER)
  })

  it('encodes the OpenRouter follow-up with reasoning_details in order', () => {
    expectRoundTrip('openrouter', '05-tool-result-stream.json', OPENROUTER)
  })

  it('encodes the OpenRouter no-tools turn: replay stays, tools stay out', () => {
    expectRoundTrip('openrouter', '06-tool-history-without-tools.json', OPENROUTER)
  })

  it('encodes Groq byte for byte: max_completion_tokens, flat effort', () => {
    expectRoundTrip('groq', '02-tool-call-stream.json', GROQ)
    expectRoundTrip('groq', '03-tool-result-stream.json', GROQ)
  })

  it('encodes Mistral byte for byte: cache key, named tool results', () => {
    expectRoundTrip('mistral', '02-tool-call-stream.json', MISTRAL)
    expectRoundTrip('mistral', '03-tool-result-stream.json', MISTRAL)
  })

  it('encodes Together byte for byte: text beside tool calls', () => {
    expectRoundTrip('together', '04-tool-call-stream-gpt-oss-120b.json', TOGETHER)
    expectRoundTrip('together', '05-tool-result-stream.json', TOGETHER)
  })

  it('encodes Fireworks byte for byte: cache key and reasoning_content', () => {
    expectRoundTrip('fireworks', '03-tool-call-stream.json', FIREWORKS)
    expectRoundTrip('fireworks', '04-tool-result-stream.json', FIREWORKS)
  })

  it('encodes DeepSeek byte for byte: reasoning_content replay', () => {
    expectRoundTrip('deepseek', '02-tool-call-stream.json', DEEPSEEK)
    expectRoundTrip('deepseek', '04-tool-result-stream.json', DEEPSEEK)
  })

  it('encodes Hugging Face byte for byte: the routed request', () => {
    expectRoundTrip('huggingface', '03-tool-call-stream.json', HUGGINGFACE)
    expectRoundTrip('huggingface', '04-tool-result-stream.json', HUGGINGFACE)
  })

  it('encodes Z.ai byte for byte: tool_stream, no reasoning parameter', () => {
    expectRoundTrip('zai', '02-tool-call-stream.json', ZAI)
    expectRoundTrip('zai', '03-tool-result-stream.json', ZAI)
  })

  it('keeps a fixed key order on every request', () => {
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    const rebuilt = bodyFromCapture(frame.requestBody, OPENROUTER)
    const encoded = encodeChatRequest(rebuilt.body, rebuilt.model, OPENROUTER)
    expect(Object.keys(encoded.body)).toEqual([
      'model',
      'messages',
      'tools',
      'tool_choice',
      'stream',
      'stream_options',
      'max_tokens',
      'provider',
      'reasoning',
    ])
  })

  it('emits OpenRouter attribution headers verbatim, in order', () => {
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    const rebuilt = bodyFromCapture(frame.requestBody, OPENROUTER)
    const encoded = encodeChatRequest(rebuilt.body, rebuilt.model, OPENROUTER)
    expect(encoded.headers).toEqual([
      ['HTTP-Referer', 'https://github.com/RandyNorthrup/muse-spark-code'],
      ['X-OpenRouter-Title', 'Muse Spark Code (Unofficial)'],
      ['X-OpenRouter-Categories', 'ide-extension'],
    ])
  })

  it('keeps all routing choices in a fixed order, including false values', () => {
    const body = bodyFromCapture(
      frameOf('openrouter', '04-tool-call-stream.json').requestBody,
      OPENROUTER,
    )
    const quirks = {
      ...OPENROUTER,
      routing: {
        allowFallbacks: false,
        order: ['first', 'second'],
        dataCollection: 'deny' as const,
        zdr: false,
      },
    }
    const request = encodeChatRequest(body.body, body.model, quirks).body.provider
    expect(JSON.stringify(request)).toBe(
      '{"zdr":false,"data_collection":"deny","order":["first","second"],"allow_fallbacks":false}',
    )
  })

  it('encodes the same body to the same bytes twice: no clock, no random', () => {
    const frame = frameOf('together', '05-tool-result-stream.json')
    const rebuilt = bodyFromCapture(frame.requestBody, TOGETHER)
    const first = encodeChatRequest(rebuilt.body, rebuilt.model, TOGETHER)
    const second = encodeChatRequest(rebuilt.body, rebuilt.model, TOGETHER)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

function encodedOpenRouterTurns(options?: ChatEncodeOptions) {
  const encode = (file: string) => {
    const { body, model } = bodyFromCapture(frameOf('openrouter', file).requestBody, OPENROUTER)
    return encodeChatRequest(body, model, OPENROUTER, options)
  }
  return { one: encode('04-tool-call-stream.json'), two: encode('05-tool-result-stream.json') }
}

describe('chat codec prefix stability', () => {
  it('keeps every earlier native byte when the session grows', () => {
    const { one, two } = encodedOpenRouterTurns()
    expect(two.body.messages.slice(0, 2)).toEqual(one.body.messages)
  })

  it('moves only the rolling breakpoint when caching', () => {
    const { one, two } = encodedOpenRouterTurns({ cacheBreakpoints: 'anthropic' })
    expect(two.body.messages[0]).toEqual(one.body.messages[0])
    const earlier = recordField(one.body.messages[1], 'user message')
    const later = recordField(two.body.messages[1], 'user message')
    const parts = arrayField(earlier['content'], 'content').map((part) => {
      const { cache_control: _marker, ...text } = recordField(part, 'text')
      return text
    })
    expect(later).toEqual({ ...earlier, content: parts })
    const lastOne = one.body.messages.at(-1)
    const lastTwo = two.body.messages.at(-1)
    for (const message of [lastOne, lastTwo]) {
      expect(message).toMatchObject({
        content: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
      })
    }
    expect(lastOne).not.toEqual(lastTwo)
  })
})

// --- decode: the captured streams, per preset ---

function callsOf(response: ResponseObject): FunctionCallItem[] {
  return response.output.filter(
    (item): item is FunctionCallItem => item.type === 'function_call' && 'call_id' in item,
  )
}

function textOf(response: ResponseObject): string {
  const message = response.output.find(
    (item): item is Extract<ResponseObject['output'][number], { type: 'message' }> =>
      item.type === 'message' && 'content' in item,
  )
  return message === undefined
    ? ''
    : message.content
        .map((part) => (part.type === 'output_text' && 'text' in part ? part.text : ''))
        .join('')
}

function reasoningItemOf(response: ResponseObject): ReasoningItem | undefined {
  return response.output.find(
    (item): item is ReasoningItem => item.type === 'reasoning' && !('call_id' in item),
  )
}

function reasoningTextOf(response: ResponseObject): string {
  const reasoning = reasoningItemOf(response)
  return reasoning?.summary === undefined ? '' : reasoning.summary.map((part) => part.text).join('')
}

function deltasOf(events: readonly StreamEvent[], type: StreamEvent['type']): string[] {
  return events.flatMap((event) => {
    return event.type === type && 'delta' in event ? [event.delta] : []
  })
}

/** The replay text a follow-up request carries on its assistant message. */
function replayTextOf(provider: string, file: string): string {
  const frame = frameOf(provider, file)
  const messages = arrayField(frame.requestBody['messages'], 'messages').map((message) =>
    recordField(message, 'message'),
  )
  const assistant = messages.find((message) => message['role'] === 'assistant')
  if (assistant === undefined) {
    throw new Error(`capture ${provider}/${file} has no assistant message`)
  }
  const details = assistant['reasoning_details']
  if (Array.isArray(details)) {
    return details
      .map((entry) => {
        const text = recordField(entry, 'reasoning detail')['text']
        return typeof text === 'string' ? text : ''
      })
      .join('')
  }
  for (const field of ['reasoning_content', 'reasoning'] as const) {
    const value = assistant[field]
    if (typeof value === 'string') {
      return value
    }
  }
  throw new Error(`capture ${provider}/${file} replays no reasoning`)
}

describe('chat codec stream decoding', () => {
  it('decodes OpenRouter: fragments, reasoning_details, usage and cost', () => {
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'openai/gpt-oss-20b', OPENROUTER, CHAT_LIMITS)
    expect(decoded.response.id).toBe('gen-1791153847-3d6RpFuNqkk5nNG1iZi2')
    expect(decoded.response.model).toBe('openai/gpt-oss-20b')
    expect(decoded.response.status).toBe('completed')
    const calls = callsOf(decoded.response)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.call_id).toBe('chatcmpl-tool-b14640ae3beaf9d7')
    expect(calls[0]?.name).toBe('get_time')
    expect(calls[0]?.arguments).toBe('{"timezone":"UTC"}')
    expect(deltasOf(decoded.events, 'response.function_call_arguments.delta').join('')).toBe(
      '{"timezone":"UTC"}',
    )
    expect(reasoningTextOf(decoded.response)).toBe('Need to call get_time with timezone UTC.')
    expect(deltasOf(decoded.events, 'response.reasoning_summary_text.delta').join('')).toBe(
      'Need to call get_time with timezone UTC.',
    )
    expect(decoded.response.usage).toEqual({
      input_tokens: 1522,
      output_tokens: 33,
      total_tokens: 1555,
      input_tokens_details: { cached_tokens: 64, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 9 },
    })
    expect(decoded.providerCostUsd).toBe(0.00004997)
  })

  it('decodes the OpenRouter final answer: text and usage on the finish chunk', () => {
    const frame = frameOf('openrouter', '05-tool-result-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'openai/gpt-oss-20b', OPENROUTER, CHAT_LIMITS)
    expect(textOf(decoded.response)).toBe('It is 12:00\u{202F}PM UTC today.')
    expect(callsOf(decoded.response)).toHaveLength(0)
    expect(decoded.response.usage).toEqual({
      input_tokens: 1588,
      output_tokens: 15,
      total_tokens: 1603,
      input_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    })
    expect(decoded.providerCostUsd).toBe(0.00004909)
  })

  it('decodes Groq: a whole call, reasoning with a channel, a choices-less usage chunk', () => {
    const frame = frameOf('groq', '02-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'openai/gpt-oss-20b', GROQ, CHAT_LIMITS)
    expect(reasoningTextOf(decoded.response)).toBe('Need call get_time with UTC.')
    const calls = callsOf(decoded.response)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.call_id).toBe('fc_60dc2eba-1b33-4ba2-b34d-d16ab6a1b5b0')
    expect(calls[0]?.arguments).toBe('{"timezone":"UTC"}')
    expect(decoded.response.usage).toEqual({
      input_tokens: 1522,
      output_tokens: 31,
      total_tokens: 1553,
      output_tokens_details: { reasoning_tokens: 8 },
    })
  })

  it('decodes Mistral: the whole call, reason and usage in one chunk', () => {
    const frame = frameOf('mistral', '02-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'ministral-3b-latest', MISTRAL, CHAT_LIMITS)
    const calls = callsOf(decoded.response)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.arguments).toBe('{"timezone": "UTC"}')
    expect(reasoningItemOf(decoded.response)).toBeUndefined()
    expect(decoded.response.usage).toEqual({
      input_tokens: 1559,
      output_tokens: 12,
      total_tokens: 1571,
      input_tokens_details: { cached_tokens: 0 },
    })
  })

  it('decodes Together: reasoning, fragments and token ids', () => {
    const frame = frameOf('together', '04-tool-call-stream-gpt-oss-120b.json')
    const decoded = decodeChatStream(frame.payloads, 'openai/gpt-oss-120b', TOGETHER, CHAT_LIMITS)
    expect(reasoningTextOf(decoded.response)).toBe(
      replayTextOf('together', '05-tool-result-stream.json'),
    )
    expect(deltasOf(decoded.events, 'response.function_call_arguments.delta').join('')).toBe(
      '{\n  "timezone": "UTC"\n}',
    )
    expect(decoded.response.usage).toEqual({
      input_tokens: 1523,
      output_tokens: 65,
      total_tokens: 1588,
      input_tokens_details: { cached_tokens: 48 },
      output_tokens_details: { reasoning_tokens: 18 },
    })
  })

  it('decodes Fireworks: reasoning_content and fragments', () => {
    const frame = frameOf('fireworks', '03-tool-call-stream.json')
    const decoded = decodeChatStream(
      frame.payloads,
      'accounts/fireworks/models/gpt-oss-120b',
      FIREWORKS,
      CHAT_LIMITS,
    )
    expect(reasoningTextOf(decoded.response)).toBe(
      replayTextOf('fireworks', '04-tool-result-stream.json'),
    )
    expect(callsOf(decoded.response)[0]?.arguments).toBe('{\n"timezone": "UTC"\n}')
    expect(decoded.response.usage).toEqual({
      input_tokens: 1522,
      output_tokens: 37,
      total_tokens: 1559,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 10 },
    })
  })

  it('decodes DeepSeek: reasoning_content deltas, usage on the finish chunk', () => {
    const frame = frameOf('deepseek', '02-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'deepseek-flash', DEEPSEEK, CHAT_LIMITS)
    expect(reasoningTextOf(decoded.response)).toBe(
      replayTextOf('deepseek', '04-tool-result-stream.json'),
    )
    expect(decoded.response.usage).toEqual({
      input_tokens: 1694,
      output_tokens: 62,
      total_tokens: 1756,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 23 },
    })
  })

  it('decodes Hugging Face: the routed Groq stream', () => {
    const frame = frameOf('huggingface', '03-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'openai/gpt-oss-20b', HUGGINGFACE, CHAT_LIMITS)
    expect(reasoningTextOf(decoded.response)).toBe(
      replayTextOf('huggingface', '04-tool-result-stream.json'),
    )
    expect(decoded.response.usage).toEqual({
      input_tokens: 1522,
      output_tokens: 34,
      total_tokens: 1556,
      output_tokens_details: { reasoning_tokens: 11 },
    })
  })

  it('decodes Z.ai: reasoning_content and tool_stream fragments', () => {
    const frame = frameOf('zai', '02-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'glm-5.3-flash', ZAI, CHAT_LIMITS)
    expect(reasoningTextOf(decoded.response)).toBe(
      replayTextOf('zai', '03-tool-result-stream.json'),
    )
    const calls = callsOf(decoded.response)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.arguments).toBe('{"timezone":"UTC"}')
    expect(decoded.response.usage).toEqual({
      input_tokens: 1559,
      output_tokens: 50,
      total_tokens: 1609,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 38 },
    })
  })
})

function loopBody(reasoning: ReasoningItem): CreateResponseBody {
  return {
    model: 'test-model',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      reasoning,
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      { type: 'function_call_output', call_id: 'call-1', output: '{"time":"12:00"}' },
    ],
    instructions: 'be brief',
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'time',
        parameters: { type: 'object' },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'unused',
    prompt_cache_retention: '24h',
  }
}

function assistantOf(result: {
  readonly body: { readonly messages: readonly unknown[] }
}): unknown {
  return result.body.messages.at(-2)
}

describe('chat codec reasoning replay', () => {
  it('binds reasoning to the exact model and configured provider', () => {
    const reasoning = opaqueReasoningItem('account-one', 'private thought', undefined, 'model-one')
    const first = { ...DEEPSEEK, providerId: 'account-one' }
    expect(
      recordField(
        assistantOf(encodeChatRequest(loopBody(reasoning), 'model-one', first)),
        'assistant',
      )['reasoning_content'],
    ).toBe('private thought')
    for (const [model, quirks] of [
      ['model-two', first],
      ['model-one', { ...first, providerId: 'account-two' }],
    ] as const) {
      const assistant = recordField(
        assistantOf(encodeChatRequest(loopBody(reasoning), model, quirks)),
        'assistant',
      )
      expect(assistant).not.toHaveProperty('reasoning_content')
      expect(assistant['tool_calls']).toHaveLength(1)
    }
  })

  it('replays DeepSeek reasoning on earlier plain assistant turns', () => {
    const reasoning = opaqueReasoningItem('deepseek', 'earlier thought', undefined)
    const body = loopBody(reasoning)
    const encoded = encodeChatRequest(
      {
        ...body,
        input: [
          body.input[0] ?? reasoning,
          reasoning,
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'answer' }],
          },
          ...body.input,
        ],
      },
      'm',
      DEEPSEEK,
    )
    expect(encoded.body.messages[2]).toEqual({
      role: 'assistant',
      content: 'answer',
      reasoning_content: 'earlier thought',
    })
  })

  it('replays the same preset verbatim: a decoded turn encodes its follow-up', () => {
    for (const [provider, file, followup, quirks, model] of [
      ['openrouter', '04-tool-call-stream.json', '05-tool-result-stream.json', OPENROUTER, 'm'],
      ['deepseek', '02-tool-call-stream.json', '04-tool-result-stream.json', DEEPSEEK, 'm'],
    ] as const) {
      const streamed = decodeChatStream(
        frameOf(provider, file).payloads,
        model,
        quirks,
        CHAT_LIMITS,
      )
      const reasoning = reasoningItemOf(streamed.response)
      if (reasoning === undefined) {
        throw new Error(`capture ${provider}/${file} decoded no reasoning`)
      }
      const calls = callsOf(streamed.response)
      const frame = frameOf(provider, followup)
      const expected = arrayField(frame.requestBody['messages'], 'messages').map((message) =>
        recordField(message, 'message'),
      )
      const expectedAssistant = expected.find((message) => message['role'] === 'assistant')
      const body = loopBody(reasoning)
      const call = calls[0]
      if (call === undefined) {
        throw new Error(`capture ${provider}/${file} decoded no calls`)
      }
      const input = body.input.map((item) => {
        if (item.type === 'function_call') {
          return { ...item, call_id: call.call_id, name: call.name, arguments: call.arguments }
        }
        return item.type === 'function_call_output' ? { ...item, call_id: call.call_id } : item
      })
      const encoded = encodeChatRequest({ ...body, input }, model, quirks)
      const assistant = recordField(encoded.body.messages.at(-2), 'assistant')
      expect({ ...assistant, tool_calls: 'calls' }).toEqual({
        ...expectedAssistant,
        tool_calls: 'calls',
      })
      const encodedCalls = arrayField(assistant['tool_calls'], 'tool_calls').map((entry) =>
        recordField(entry, 'tool_call'),
      )
      const expectedCalls = arrayField(expectedAssistant?.['tool_calls'], 'tool_calls').map(
        (entry) => recordField(entry, 'tool_call'),
      )
      expect(encodedCalls).toEqual(expectedCalls)
    }
  })

  it('drops another preset reasoning and keeps everything else', () => {
    const foreign = opaqueReasoningItem('openrouter', 'some thought', [
      { type: 'reasoning.text', text: 'some thought', index: 0 },
    ])
    for (const quirks of [GROQ, MISTRAL, DEEPSEEK, OPENROUTER]) {
      const encoded = encodeChatRequest(loopBody(foreign), 'm', quirks)
      const assistant = recordField(assistantOf(encoded), 'assistant')
      if (quirks.presetId === 'openrouter') {
        expect(assistant['reasoning_details']).toEqual([
          { type: 'reasoning.text', text: 'some thought', index: 0 },
        ])
      } else {
        expect(assistant).not.toHaveProperty('reasoning_details')
        expect(assistant).not.toHaveProperty('reasoning_content')
        expect(assistant).not.toHaveProperty('reasoning')
      }
    }
    const groq = encodeChatRequest(
      loopBody(opaqueReasoningItem('groq', 'own thought', undefined)),
      'm',
      GROQ,
    )
    expect(recordField(assistantOf(groq), 'assistant')['reasoning']).toBe('own thought')
  })

  it('keeps reasoning_details in order', () => {
    const payload = opaqueReasoningItem('openrouter', 'ab', [
      { type: 'reasoning.text', text: 'a', index: 1 },
      { type: 'reasoning.text', text: 'b', index: 0 },
    ])
    const encoded = encodeChatRequest(loopBody(payload), 'm', OPENROUTER)
    expect(recordField(assistantOf(encoded), 'assistant')['reasoning_details']).toEqual([
      { type: 'reasoning.text', text: 'a', index: 1 },
      { type: 'reasoning.text', text: 'b', index: 0 },
    ])
  })

  it('reads the opaque payload only from its own preset', () => {
    for (const value of [
      null,
      42,
      [],
      { chat: { v: 1, provider: 'openrouter', model: 'm', details: ['invalid'] } },
    ]) {
      expect(readChatReasoning(JSON.stringify(value), 'openrouter', 'm')).toBeUndefined()
    }
    expect(readChatReasoning('not json', 'openrouter', 'm')).toBeUndefined()
    expect(readChatReasoning(JSON.stringify({ other: {} }), 'openrouter', 'm')).toBeUndefined()
    expect(
      readChatReasoning(
        JSON.stringify({ chat: { v: 2, provider: 'openrouter', model: 'm' } }),
        'openrouter',
        'm',
      ),
    ).toBeUndefined()
    expect(
      readChatReasoning(
        JSON.stringify({ chat: { v: 1, provider: 'groq', text: 't' } }),
        'openrouter',
        'm',
      ),
    ).toBeUndefined()
    const payload = readChatReasoning(
      JSON.stringify({ chat: { v: 1, provider: 'openrouter', model: 'm', text: 't' } }),
      'openrouter',
      'm',
    )
    expect(payload?.text).toBe('t')
  })
})

function probeBody(): CreateResponseBody {
  const frame = frameOf('openrouter', '08-cache-call-1.json')
  const messages = arrayField(frame.requestBody['messages'], 'messages').map((message) =>
    recordField(message, 'message'),
  )
  const system = messages[0]
  const parts = arrayField(system?.['content'], 'content').map((part) => recordField(part, 'part'))
  const user = messages[1]
  return {
    model: 'test-model',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: stringField(user?.['content'], 'user text') }],
      },
    ],
    instructions: parts.map((part) => stringField(part['text'], 'system text')).join(''),
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 16,
    prompt_cache_key: 'unused',
    prompt_cache_retention: '24h',
  }
}

describe('chat codec breakpoints', () => {
  it.each(['anthropic', 'last'] as const)(
    '%s leaves progress uncached when instruction text and history are empty',
    (cacheBreakpoints) => {
      const encoded = encodeChatRequest(
        tinyBody({
          instructions: '',
          input: [
            {
              type: 'message',
              role: 'developer',
              content: [{ type: 'input_text', text: 'Goal progress: 10%' }],
            },
          ],
        }),
        'anthropic/claude-sonnet-5.5',
        OPENROUTER,
        { cacheBreakpoints },
      )
      expect(encoded.body.messages.at(-1)).toEqual({
        role: 'system',
        content: [{ type: 'text', text: 'Goal progress: 10%' }],
      })
    },
  )

  it.each(['anthropic', 'last'] as const)(
    '%s keeps the rolling marker on history before transient progress',
    (cacheBreakpoints) => {
      const histories: CreateResponseBody['input'][] = [
        probeBody().input,
        [
          ...probeBody().input,
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
        ],
        [
          ...probeBody().input,
          {
            type: 'function_call',
            call_id: 'read',
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
          },
          { type: 'function_call_output', call_id: 'read', output: 'file bytes' },
        ],
        [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Image context' },
              { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
            ],
          },
        ],
        [],
      ]
      for (const input of histories) {
        const encode = (progress?: string) =>
          encodeChatRequest(
            {
              ...probeBody(),
              input: [
                ...input,
                ...(progress === undefined
                  ? []
                  : [
                      {
                        type: 'message' as const,
                        role: 'developer' as const,
                        content: [{ type: 'input_text' as const, text: progress }],
                      },
                    ]),
              ],
            },
            'anthropic/claude-sonnet-5.5',
            OPENROUTER,
            { cacheBreakpoints, capabilities: { vision: true } },
          ).body
        const historical = encode()
        const first = encode('Goal progress: 10%')
        const next = encode('Goal progress: 20%')
        expect(first.messages.at(-1)).toEqual({
          role: 'system',
          content: [{ type: 'text', text: 'Goal progress: 10%' }],
        })
        expect(first.messages.slice(0, -1)).toEqual(historical.messages)
        expect(next.messages.slice(0, -1)).toEqual(first.messages.slice(0, -1))
        expect(JSON.stringify(next)).toBe(JSON.stringify(first).replace('10%', '20%'))
      }
    },
  )

  it('marks the system block as the cache probe shows', () => {
    const frame = frameOf('openrouter', '08-cache-call-1.json')
    const expected = arrayField(frame.requestBody['messages'], 'messages').map((message) =>
      recordField(message, 'message'),
    )
    const encoded = encodeChatRequest(probeBody(), 'anthropic/claude-sonnet-5.5', OPENROUTER, {
      cacheBreakpoints: 'anthropic',
    })
    expect(encoded.body.messages[0]).toEqual(expected[0])
  })

  it('rolls the last marker in anthropic mode and sends strings otherwise', () => {
    const plain = encodeChatRequest(probeBody(), 'm', OPENROUTER)
    expect(plain.body.messages[0]).toEqual({ role: 'system', content: expect.any(String) })
    expect(plain.body.messages[1]).toEqual({
      role: 'user',
      content: 'Reply with the single word OK.',
    })
    const marked = encodeChatRequest(probeBody(), 'm', OPENROUTER, {
      cacheBreakpoints: 'anthropic',
    })
    expect(marked.body.messages[0]).not.toEqual(plain.body.messages[0])
    expect(marked.body.messages[1]).not.toEqual(plain.body.messages[1])
    const lastOnly = encodeChatRequest(probeBody(), 'm', OPENROUTER, {
      cacheBreakpoints: 'last',
    })
    expect(lastOnly.body.messages[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: probeBody().instructions }],
    })
    expect(lastOnly.body.messages[1]).not.toEqual(plain.body.messages[1])
  })
})

function tinyBody(overrides?: Partial<CreateResponseBody>): CreateResponseBody {
  return {
    model: 'test-model',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    instructions: 'be brief',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'unused',
    prompt_cache_retention: '24h',
    ...overrides,
  }
}

describe('chat codec guards', () => {
  it('refuses nonpositive or nonfinite injected limits', () => {
    for (const frameBytes of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => new ChatStreamDecoder('m', GROQ, { ...CHAT_LIMITS, frameBytes })).toThrow(
        'invalid stream limits',
      )
    }
  })

  it('caps each frame and the cumulative stream in UTF-8 bytes', () => {
    const frame = JSON.stringify({ choices: [{ delta: { content: 'é' }, finish_reason: 'stop' }] })
    const frameBytes = new TextEncoder().encode(frame).byteLength
    const limitedFrame = new ChatStreamDecoder('m', GROQ, {
      ...CHAT_LIMITS,
      frameBytes: frameBytes - 1,
    })
    expect(limitedFrame.feed(frame)).toMatchObject([{ type: 'error', code: 'stream_limit' }])
    expect(limitedFrame.finish().response.status).toBe('failed')
    const limitedStream = new ChatStreamDecoder('m', GROQ, {
      ...CHAT_LIMITS,
      streamBytes: frameBytes,
    })
    expect(limitedStream.feed(frame).some((event) => event.type === 'error')).toBe(false)
    expect(limitedStream.feed(frame)).toMatchObject([{ type: 'error', code: 'stream_limit' }])
  })

  for (const { title, limits } of [
    {
      title: 'caps arguments accumulated across captured fragments',
      limits: { ...CHAT_LIMITS, argumentBytes: 16 },
    },
    {
      title: 'caps the number of decoded output items',
      limits: { ...CHAT_LIMITS, outputItems: 1 },
    },
  ]) {
    it(title, () => {
      const decoder = new ChatStreamDecoder('m', OPENROUTER, limits)
      const frame = frameOf('openrouter', '04-tool-call-stream.json')
      const events = frame.payloads.flatMap((payload) => decoder.feed(payload))
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'error', code: 'stream_limit' }),
      )
      expect(decoder.finish().response.status).toBe('failed')
    })
  }

  it('decodes the captured error envelopes for every chat preset', () => {
    for (const [provider, file] of [
      ['openrouter', '07-error-invalid-model.json'],
      ['groq', '04-error-invalid-model.json'],
      ['mistral', '04-error-invalid-model.json'],
      ['together', '06-error-invalid-model.json'],
      ['fireworks', '05-error-invalid-model.json'],
      ['deepseek', '05-error-invalid-model.json'],
      ['huggingface', '05-error-invalid-model.json'],
      ['zai', '04-error-invalid-model.json'],
    ]) {
      const frame = z
        .object({ response: z.object({ body: z.unknown() }) })
        .parse(captureFile(provider ?? '', file ?? ''))
      const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
      expect(decoder.feed(frame.response.body)).toMatchObject([{ type: 'error' }])
      const failed = decoder.finish().response
      expect(failed.status).toBe('failed')
      if (provider === 'mistral') expect(failed.error?.code).toBe('1500')
    }
  })

  it('omits tool_choice only where the preset asks and preserves tool order', () => {
    const body = loopBody(opaqueReasoningItem('groq', 't', undefined))
    const second: ToolDefinition = {
      type: 'function',
      name: 'a',
      description: 'second',
      parameters: {},
      strict: false,
    }
    const encoded = encodeChatRequest({ ...body, tools: [...body.tools, second] }, 'm', {
      ...GROQ,
      toolChoice: 'omit',
    })
    expect(encoded.body).not.toHaveProperty('tool_choice')
    expect(encoded.body.tools?.map((tool) => tool.function.name)).toEqual(['get_time', 'a'])
  })

  it('uses the captured id and model in the initial response event', () => {
    const frame = frameOf('groq', '02-tool-call-stream.json')
    const decoded = decodeChatStream(frame.payloads, 'fallback', GROQ, CHAT_LIMITS)
    expect(decoded.events[0]).toMatchObject({
      type: 'response.created',
      response: { id: decoded.response.id, model: decoded.response.model, status: 'in_progress' },
    })
  })

  it('keeps the captured cache-write count and reported cost', () => {
    const decoded = decodeChatStream(
      frameOf('openrouter', '08-cache-call-1.json').payloads,
      'anthropic/claude-sonnet-5.5',
      OPENROUTER,
      CHAT_LIMITS,
    )
    expect(decoded.response.usage?.input_tokens_details).toEqual({
      cached_tokens: 0,
      cache_write_tokens: 1925,
    })
    expect(decoded.providerCostUsd).toBe(0.0048845)
  })

  it('rejects invalid optional usage counts and negative cost', () => {
    const overflow = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    overflow.feed({
      choices: [],
      usage: { prompt_tokens: Number.MAX_VALUE, completion_tokens: Number.MAX_VALUE },
    })
    expect(overflow.finish().response.usage).toBeUndefined()
    for (const usage of [
      { total_tokens: -1 },
      { prompt_tokens_details: { cached_tokens: -1 } },
      { completion_tokens_details: { reasoning_tokens: -1 } },
    ]) {
      const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
      decoder.feed({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 1, ...usage },
      })
      const result = decoder.finish()
      expect(result.response.usage).toBeUndefined()
      expect(result.providerCostUsd).toBeUndefined()
    }
    const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
    decoder.feed({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: -1 } })
    expect(decoder.finish().providerCostUsd).toBeUndefined()
  })

  it('preserves deltas with malformed usage and clears earlier accounting', () => {
    const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
    decoder.feed({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 1 } })
    decoder.feed({
      choices: [{ delta: { content: 'kept' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 'invalid', completion_tokens: 5 },
    })
    const result = decoder.finish()
    expect(textOf(result.response)).toBe('kept')
    expect(result.response.usage).toBeUndefined()
    expect(result.providerCostUsd).toBeUndefined()
  })

  it('preserves unknown reasoning detail fields and assembled block order', () => {
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
    const first = recordField(frame.payloads[0], 'chunk')
    const choice = recordField(arrayField(first['choices'], 'choices')[0], 'choice')
    const delta = recordField(choice['delta'], 'delta')
    const detail = recordField(arrayField(delta['reasoning_details'], 'details')[0], 'detail')
    decoder.feed({
      ...first,
      choices: [
        {
          ...choice,
          delta: { ...delta, reasoning_details: [{ ...detail, future_field: 'kept' }] },
        },
      ],
    })
    for (const payload of frame.payloads.slice(1)) decoder.feed(payload)
    const reasoning = reasoningItemOf(decoder.finish().response)
    expect(readChatReasoning(reasoning?.encrypted_content, 'openrouter', 'm')?.details).toEqual([
      { ...detail, text: 'Need to call get_time with timezone UTC.', future_field: 'kept' },
    ])
  })

  it('splits think tags across every chunk boundary and retains partial ordinary text', () => {
    const content = 'Hello <think>secret</think> world'
    for (let split = 1; split < content.length; split += 1) {
      const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
      decoder.feed({ choices: [{ delta: { content: content.slice(0, split) } }] })
      decoder.feed({
        choices: [{ delta: { content: content.slice(split) }, finish_reason: 'stop' }],
      })
      const result = decoder.finish()
      expect(textOf(result.response)).toBe('Hello  world')
      expect(reasoningTextOf(result.response)).toBe('secret')
    }
    for (const content of ['answer <thi', '<think>unfinished']) {
      const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
      decoder.feed({ choices: [{ delta: { content } }] })
      const result = decoder.finish()
      expect(textOf(result.response) + reasoningTextOf(result.response)).toBe(
        content.replace('<think>', ''),
      )
    }
  })

  it('keeps truncated or empty streams incomplete and ignores chunks after an error', () => {
    const empty = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    expect(empty.finish().response).toMatchObject({
      status: 'incomplete',
      incomplete_details: { reason: 'stream_ended' },
    })
    const error = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    error.feed({ error: { message: 'failed', code: 'x' } })
    expect(
      error.feed({ choices: [{ delta: { content: 'late' }, finish_reason: 'stop' }] }),
    ).toEqual([])
    expect(error.finish().response).toMatchObject({ status: 'failed', output: [] })
  })

  it('groups indexless fragments by their captured call id', () => {
    const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    for (const argumentsText of ['{"x":', '1}']) {
      decoder.feed({
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'one', function: { name: 'a', arguments: argumentsText } }],
            },
          },
        ],
      })
    }
    expect(callsOf(decoder.finish().response).map((call) => call.arguments)).toEqual(['{"x":1}'])
  })

  it('never sends an empty tool list or a bare tool_choice', () => {
    const encoded = encodeChatRequest(tinyBody(), 'm', OPENROUTER)
    expect(encoded.body).not.toHaveProperty('tools')
    expect(encoded.body).not.toHaveProperty('tool_choice')
  })

  it('sends parallel_tool_calls only where the preset says so', () => {
    const single: ChatPresetQuirks = { ...OPENROUTER, parallelToolCalls: false }
    expect(encodeChatRequest(tinyBody(), 'm', single).body.parallel_tool_calls).toBe(false)
    expect(encodeChatRequest(tinyBody(), 'm', OPENROUTER).body).not.toHaveProperty(
      'parallel_tool_calls',
    )
  })

  it('refuses images with unknown vision and stands in without it (BYO item 1)', () => {
    const modelUnavailable = 'Dieses Modell ist für diesen Lauf nicht verfügbar.'
    setUiText({ ...EN, execUnknownModel: modelUnavailable }, 'de')
    try {
      expect(UI_TEXT.execUnknownModel).toBe(modelUnavailable)
      for (const body of [imageBody(false), imageBody(true)]) {
        expect(() => encodeChatRequest(body, 'm', GROQ, undefined)).toThrow(modelUnavailable)
        const stoodIn = encodeChatRequest(body, 'm', GROQ, { capabilities: { vision: false } })
        expect(JSON.stringify(stoodIn.body.messages)).toContain(
          '[image omitted: this model takes no images]',
        )
      }
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('refuses hosted tool declarations and unfinished hosted search history', () => {
    expect(() =>
      encodeChatRequest(
        tinyBody({
          tools: [{ type: 'web_search' }],
        }),
        'm',
        GROQ,
      ),
    ).toThrow('hosted search')
    expect(() =>
      encodeChatRequest(
        tinyBody({ input: [{ type: 'web_search_call', status: 'in_progress' }] }),
        'm',
        GROQ,
      ),
    ).toThrow('hosted search')
  })

  it('maps mid-stream errors in each captured envelope to the error event', () => {
    for (const [envelope, code] of [
      [{ error: { message: 'No cap', code: 400, user_id: 'u' } }, '400'],
      [{ error: { code: '1211', message: 'Unknown Model' } }, '1211'],
      [{ object: 'error', message: 'bad model', type: 'invalid_model' }, undefined],
      [{ error: { message: 'no such model', type: 'x', param: null, code: 'x' } }, 'x'],
    ] as const) {
      const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
      const events = decoder.feed(envelope)
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('error')
      if (code !== undefined) {
        expect(events[0]).toMatchObject({ code })
      }
      const done = decoder.finish()
      expect(done.response.status).toBe('failed')
    }
  })

  it('drops invalid usage and impossible captured cache counts without settling cost', () => {
    const bad = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    bad.feed({ choices: [], usage: { prompt_tokens: -1, completion_tokens: 5, total_tokens: 4 } })
    expect(bad.finish().response.usage).toBeUndefined()
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    for (const field of ['cached_tokens', 'cache_write_tokens']) {
      const payloads = frame.payloads.map((payload) => {
        if (typeof payload !== 'object' || payload === null) return payload
        const chunk = recordField(payload, 'chunk')
        if (chunk['usage'] == null) return payload
        const usage = recordField(chunk['usage'], 'usage')
        const details = recordField(usage['prompt_tokens_details'], 'cache details')
        return {
          ...chunk,
          usage: { ...usage, prompt_tokens_details: { ...details, [field]: 1523 } },
        }
      })
      const decoded = decodeChatStream(payloads, 'm', OPENROUTER, CHAT_LIMITS)
      expect(decoded.response.status).toBe('completed')
      expect(decoded.response.usage, field).toBeUndefined()
      expect(decoded.providerCostUsd, field).toBeUndefined()
      expect(decoded.events.at(-1)).not.toHaveProperty('response.usage')
    }
  })

  it('merges fragments by index, truncating floats, with an appearance fallback', () => {
    const decoder = new ChatStreamDecoder('m', DEEPSEEK, CHAT_LIMITS)
    decoder.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 1.5, id: 'second', function: { name: 'b', arguments: '{"x":' } },
              { index: 0.2, id: 'first', function: { name: 'a', arguments: '{"x":' } },
            ],
          },
        },
      ],
    })
    decoder.feed({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 1, function: { arguments: '1}' } },
              { index: 0, function: { arguments: '2}' } },
            ],
          },
        },
      ],
    })
    const calls = callsOf(decoder.finish().response)
    expect(calls.map((call) => [call.call_id, call.arguments])).toEqual([
      ['second', '{"x":1}'],
      ['first', '{"x":2}'],
    ])
  })

  it('groups parallel calls that carry no index in appearance order', () => {
    const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    decoder.feed({
      id: 'response-one',
      choices: [
        {
          delta: {
            tool_calls: [{ function: { name: 'a', arguments: '{"x":1}' } }],
          },
          finish_reason: null,
        },
      ],
    })
    decoder.feed({
      id: 'response-one',
      choices: [
        {
          delta: {
            tool_calls: [{ function: { name: 'b', arguments: '{"x":2}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
    const calls = callsOf(decoder.finish().response)
    expect(calls.map((call) => [call.call_id, call.name, call.arguments])).toEqual([
      ['chat-call-response-one-0', 'a', '{"x":1}'],
      ['chat-call-response-one-1', 'b', '{"x":2}'],
    ])
  })

  it('skips sentinels, blanks, keep-alives and unrelated additions', () => {
    const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    expect(decoder.feed('[DONE]')).toEqual([])
    expect(decoder.feed('')).toEqual([])
    expect(decoder.feed(': OPENROUTER PROCESSING')).toEqual([])
    expect(decoder.feed(42)).toEqual([])
    expect(decoder.feed({ object: 'list', data: [] })).toEqual([])
    decoder.feed({ choices: [{ delta: { content: 'hi' } }] })
    const done = decoder.finish()
    expect(textOf(done.response)).toBe('hi')
  })

  it('fails corrupt known captured chunks and malformed JSON with a named error', () => {
    const frame = frameOf('openrouter', '04-tool-call-stream.json')
    for (const corruption of ['content', 'model', 'json']) {
      let hasChanged = false
      const payloads = frame.payloads.map((payload) => {
        if (hasChanged || typeof payload !== 'object' || payload === null) return payload
        const chunk = recordField(payload, 'chunk')
        const choice = recordField(arrayField(chunk['choices'], 'choices')[0], 'choice')
        const delta = recordField(choice['delta'], 'delta')
        if (delta['tool_calls'] === undefined) return payload
        hasChanged = true
        if (corruption === 'json') return JSON.stringify(chunk).slice(0, -1)
        return corruption === 'model'
          ? { ...chunk, model: 42 }
          : { ...chunk, choices: [{ ...choice, delta: { ...delta, content: 42 } }] }
      })
      expect(hasChanged).toBe(true)
      const decoded = decodeChatStream(payloads, 'm', OPENROUTER, CHAT_LIMITS)
      expect(decoded.response).toMatchObject({
        status: 'failed',
        error: { code: 'malformed_chunk' },
      })
      expect(decoded.events).toContainEqual(
        expect.objectContaining({ type: 'error', code: 'malformed_chunk' }),
      )
      expect(decoded.events.at(-1)?.type).toBe('response.failed')
    }
  })

  it('clears earlier accounting when a later known chunk is corrupt', () => {
    const decoder = new ChatStreamDecoder('m', OPENROUTER, CHAT_LIMITS)
    decoder.feed({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 1 } })
    decoder.feed({ choices: [{ delta: { content: 42 } }] })
    const result = decoder.finish()
    expect(result.response.status).toBe('failed')
    expect(result.response.usage).toBeUndefined()
    expect(result.providerCostUsd).toBeUndefined()
  })

  it('refuses ambiguous indexless continuations and anonymous calls without a response id', () => {
    const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    decoder.feed({ choices: [{ delta: { tool_calls: [{ id: 'one' }, { id: 'two' }] } }] })
    expect(
      decoder.feed({ choices: [{ delta: { tool_calls: [{ function: { arguments: '{}' } }] } }] }),
    ).toMatchObject([{ type: 'error', code: 'ambiguous_tool_call' }])
    expect(decoder.finish().response.status).toBe('failed')
    const anonymous = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    expect(
      anonymous.feed({ choices: [{ delta: { tool_calls: [{ function: { name: 'a' } }] } }] }),
    ).toMatchObject([{ type: 'error', code: 'missing_response_id' }])
    expect(anonymous.finish().response.status).toBe('failed')
  })

  it('reconnects captured indexless continuations whose native id appears only once', () => {
    const payloads = withoutCapturedCallFields(
      frameOf('openrouter', '04-tool-call-stream.json').payloads,
      ['index'],
    )
    const decoded = decodeChatStream(payloads, 'm', OPENROUTER, CHAT_LIMITS)
    expect(decoded.response.status).toBe('completed')
    expect(callsOf(decoded.response)).toMatchObject([
      {
        call_id: 'chatcmpl-tool-b14640ae3beaf9d7',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
    ])
    expect(callsOf(decoded.response)).toHaveLength(1)
  })

  it('keeps synthetic ids unique across captured responses and earlier result bytes stable', () => {
    const frame = frameOf('mistral', '02-tool-call-stream.json')
    const withoutIds = withoutCapturedCallFields(frame.payloads, ['id'])
    const first = decodeChatStream(withoutIds, 'm', MISTRAL, CHAT_LIMITS)
    const secondPayloads = withoutIds.map((payload) => {
      if (typeof payload !== 'object' || payload === null) return payload
      const chunk = recordField(payload, 'chunk')
      const choices = arrayField(chunk['choices'], 'choices').map((value) => {
        const choice = recordField(value, 'choice')
        const delta = recordField(choice['delta'], 'delta')
        const calls = arrayField(delta['tool_calls'] ?? [], 'calls').map((value) => {
          const call = recordField(value, 'call')
          return {
            ...call,
            function: { ...recordField(call['function'], 'function'), name: 'read_file' },
          }
        })
        return { ...choice, delta: { ...delta, tool_calls: calls } }
      })
      return { ...chunk, id: `${String(chunk['id'])}-next`, choices }
    })
    const second = decodeChatStream(secondPayloads, 'm', MISTRAL, CHAT_LIMITS)
    const earlier = callsOf(first.response)[0]
    const later = callsOf(second.response)[0]
    if (earlier === undefined || later === undefined) throw new Error('capture has no call')
    expect(earlier.call_id).not.toBe(later.call_id)
    expect(earlier.call_id).toContain(first.response.id)
    expect(later.call_id).toContain(second.response.id)
    const body = tinyBody({
      input: [earlier, { type: 'function_call_output', call_id: earlier.call_id, output: 'saved' }],
    })
    const before = encodeChatRequest(body, 'm', MISTRAL).body.messages
    const after = encodeChatRequest({ ...body, input: [...body.input, later] }, 'm', MISTRAL).body
      .messages
    expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before))
  })

  it('splits think blocks out of answer text, unclosed ones too', () => {
    const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    decoder.feed({ choices: [{ delta: { content: 'Hello <think>sec' } }] })
    decoder.feed({ choices: [{ delta: { content: 'ret</think> world' } }] })
    const done = decoder.finish()
    expect(textOf(done.response)).toBe('Hello  world')
    expect(reasoningTextOf(done.response)).toBe('secret')
  })

  it('ends length stops incomplete and filtered stops failed', () => {
    const capped = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    capped.feed({ choices: [{ delta: { content: 'half' }, finish_reason: 'length' }] })
    const short = capped.finish()
    expect(short.response.status).toBe('incomplete')
    expect(short.response.incomplete_details?.reason).toBe('max_output_tokens')
    const filtered = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
    filtered.feed({ choices: [{ finish_reason: 'content_filter' }] })
    expect(filtered.finish().response.status).toBe('failed')
  })

  it('preserves unfamiliar finish reasons as incomplete', () => {
    for (const reason of ['abort', 'error', 'future_stop_reason']) {
      const decoder = new ChatStreamDecoder('m', GROQ, CHAT_LIMITS)
      decoder.feed({ choices: [{ delta: { content: 'partial' }, finish_reason: reason }] })
      const result = decoder.finish()
      expect(result.response).toMatchObject({
        status: 'incomplete',
        incomplete_details: { reason },
      })
      expect(textOf(result.response)).toBe('partial')
      expect(result.events.at(-1)?.type).toBe('response.incomplete')
    }
  })

  it('streams incrementally to the same events as the batch helper', () => {
    const frame = frameOf('fireworks', '03-tool-call-stream.json')
    const batch = decodeChatStream(frame.payloads, 'm', FIREWORKS, CHAT_LIMITS)
    const decoder = new ChatStreamDecoder('m', FIREWORKS, CHAT_LIMITS)
    const events: StreamEvent[] = []
    for (const payload of frame.payloads) {
      events.push(...decoder.feed(payload))
    }
    events.push(...decoder.finish().events)
    expect(events).toEqual(batch.events)
  })

  it('falls back to stable ids when the stream names nothing', () => {
    const decoder = new ChatStreamDecoder('fallback-model', GROQ, CHAT_LIMITS)
    decoder.feed({ choices: [{ delta: { content: 'hi' } }] })
    const done = decoder.finish()
    expect(done.response.id).toBe('chat-response')
    expect(done.response.model).toBe('fallback-model')
  })
})

function callBody(callId: string, output: string): CreateResponseBody {
  return {
    ...tinyBody(),
    input: [
      {
        type: 'function_call',
        call_id: callId,
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      { type: 'function_call_output', call_id: callId, output },
    ],
  }
}

describe('M101 lane P1 history hardening (BYO items 1, 3, 13)', () => {
  it('selects Mistral id rules by preset even under provider aliases', () => {
    const request = encodeChatRequest(callBody('image-1', 'noon'), 'mistral-medium', {
      ...MISTRAL,
      providerId: 'work-mistral',
    })
    const messages = JSON.stringify(request.body.messages)
    const ids = Array.from(messages.matchAll(/"id":"([A-Za-z0-9]{9})"/g), (match) => match[1])
    const resultIds = Array.from(
      messages.matchAll(/"tool_call_id":"([A-Za-z0-9]{9})"/g),
      (match) => match[1],
    )
    expect(ids).toHaveLength(1)
    expect(resultIds).toEqual(ids)
    expect(messages).not.toContain('image-1')
    const otherPreset = encodeChatRequest(callBody('image-1', 'noon'), 'm', {
      ...OPENROUTER,
      providerId: 'mistral',
    })
    expect(JSON.stringify(otherPreset.body.messages)).toContain('"id":"image-1"')
    expect(JSON.stringify(otherPreset.body.messages)).toContain('"tool_call_id":"image-1"')
  })

  it('rewrites hostile ids per target format, pairing calls with results (BYO item 3)', () => {
    const mistral = encodeChatRequest(callBody('image-1', 'noon'), 'mistral-medium', MISTRAL)
    const mistralText = JSON.stringify(mistral.body.messages)
    expect(mistralText).not.toContain('image-1')
    const mistralIds = Array.from(
      mistralText.matchAll(/"id":"([A-Za-z0-9]{9})"/g),
      (match) => match[1],
    )
    expect(mistralIds.length).toBeGreaterThan(0)
    // The call and its result carry the same mapped id.
    const toolIds = Array.from(
      mistralText.matchAll(/"tool_call_id":"([A-Za-z0-9]{9})"/g),
      (match) => match[1],
    )
    expect(toolIds).toEqual(mistralIds)
    const openrouter = encodeChatRequest(callBody('image-1', 'noon'), 'm', OPENROUTER)
    const openrouterText = JSON.stringify(openrouter.body.messages)
    expect(openrouterText).toContain('"id":"image-1"')
    // The captured 41-character Together id replays verbatim; only a
    // pathological id is remapped.
    const captured = encodeChatRequest(
      callBody('call_01a10910-a000-7d83-9b27-efc1bb3e764b', 'noon'),
      'm',
      OPENROUTER,
    )
    expect(JSON.stringify(captured.body.messages)).toContain(
      '"id":"call_01a10910-a000-7d83-9b27-efc1bb3e764b"',
    )
    const long = encodeChatRequest(
      callBody(`chat-call-4c7dca83f54445e19b3e16281105748c-0-${'x'.repeat(60)}`, 'noon'),
      'm',
      OPENROUTER,
    )
    const longText = JSON.stringify(long.body.messages)
    expect(longText).not.toContain('chat-call-4c7dca83')
    expect(longText).toMatch(/"id":"chat-[0-9a-f]{8}"/)
  })

  it('drops blank text and marks empty results (BYO item 1)', () => {
    const calls = callBody('call-1', '')
    const encoded = encodeChatRequest(
      {
        ...calls,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: ' '.repeat(3) },
              { type: 'input_text', text: 'hi' },
            ],
          },
          ...calls.input,
        ],
      },
      'm',
      OPENROUTER,
    )
    const text = JSON.stringify(encoded.body.messages)
    expect(text).not.toContain('"content":"   "')
    expect(text).toContain('"content":"hi"')
    expect(text).toContain('(no tool output)')
  })

  it('stands in for images without vision but refuses unknown vision (BYO item 1)', () => {
    const body: CreateResponseBody = {
      ...tinyBody(),
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,iVBOR', detail: 'auto' },
          ],
        },
      ],
    }
    const without = encodeChatRequest(body, 'm', OPENROUTER, {
      capabilities: { vision: false },
    })
    expect(JSON.stringify(without.body.messages)).toContain(
      '[image omitted: this model takes no images]',
    )
    expect(() => encodeChatRequest(body, 'm', OPENROUTER)).toThrow(UI_TEXT.execUnknownModel)
  })

  it('removes lone surrogates from text crossing the wire (BYO item 13)', () => {
    const encoded = encodeChatRequest(
      {
        ...tinyBody(),
        instructions: 'be brie\u{D800}f',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'a\u{DC00}b' }],
          },
        ],
      },
      'm',
      OPENROUTER,
    )
    const text = JSON.stringify(encoded.body)
    expect(text).toContain('be brie�f')
    expect(text).toContain('a�b')
    expect(text).not.toContain(String.raw`\ud800`)
    expect(text).not.toContain(String.raw`\udc00`)
  })
})

it('lets the selected chat model capability override a strict-capable preset', () => {
  const body = { ...tinyBody(), tools: toolDefinitions('linux') }
  for (const enabled of [true, false, undefined]) {
    const encoded = encodeChatRequest(
      body,
      'selected-model',
      { ...GROQ, supportsStrictTools: true },
      { capabilities: { vision: false, supportsStrictTools: enabled } },
    )
    expect(encoded.body.tools?.every((tool) => tool.function.strict === true)).toBe(
      enabled === true,
    )
  }
})
