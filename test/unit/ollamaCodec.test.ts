// Native fixtures: nine counted Ollama 0.35.1 captures, 2026-10-05.
// Mutations below are explicit fault injections of those captured shapes.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  OLLAMA_ARGUMENT_MAX_BYTES,
  OLLAMA_FRAME_MAX_BYTES,
  OLLAMA_ITEM_MAX_BYTES,
  OLLAMA_OUTPUT_MAX_ITEMS,
  OLLAMA_STREAM_MAX_BYTES,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT, setUiText } from '../../src/shared/l10n/text'
import {
  OLLAMA_CHAT_PATH,
  decodeOllamaStream,
  encodeOllamaRequest,
  parseOllamaError,
  readOllamaLines,
  thinkForEffort,
} from '../../src/core/backends/modelapi/codecs/ollama'
import { isFunctionCallItem, isReasoningItem } from '../../src/core/backends/modelapi/schemas'
import type {
  CreateResponseBody,
  ResponseObject,
  StreamEvent,
} from '../../src/core/backends/modelapi/schemas'

const model = 'qwen3:4b-instruct-2507-q4_K_M'
const encoder = new TextEncoder()
const encodeOptions = { model, numCtx: 32_768, think: false } as const
const decodeOptions = { model, status: 200, responseId: 'session-turn-1' }
const receiptSchema = z.object({
  request: z.object({ body: z.object({ model: z.string() }) }),
  response: z.object({ body: z.string(), chunkBytes: z.array(z.number()), status: z.number() }),
})
const recordSchema = z.record(z.string(), z.unknown())
const toolSchema = z.object({
  id: z.optional(z.string()),
  function: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
})
function capture(name: string): {
  request: { body: { model: string } }
  response: { body: string; chunkBytes: number[]; status: number }
} {
  return receiptSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../docs/certification/m95-captures/ollama/${name}.json`, import.meta.url),
        'utf8',
      ),
    ),
  )
}
function stream(...parts: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part)
      controller.close()
    },
  })
}
function keepalive(): ReadableStream<Uint8Array> {
  const chunk = encoder.encode('\n'.repeat(OLLAMA_FRAME_MAX_BYTES))
  return stream(...Array.from({ length: OLLAMA_STREAM_MAX_BYTES / chunk.length + 1 }, () => chunk))
}
function recordedStream(name: string): AsyncIterable<Uint8Array> {
  const receipt = capture(name)
  const bytes = encoder.encode(receipt.response.body)
  let offset = 0
  return stream(
    ...receipt.response.chunkBytes.map((length) => {
      const part = bytes.subarray(offset, offset + length)
      offset += length
      return part
    }),
  )
}
function lines(name: string): Record<string, unknown>[] {
  return capture(name)
    .response.body.trim()
    .split('\n')
    .map((line) => recordSchema.parse(JSON.parse(line)))
}
function nativeCallLines(): string[] {
  return capture('09-two-tool-chunks')
    .response.body.trim()
    .split('\n')
    .filter((line) => line.includes('tool_calls'))
}
function terminal(): string {
  return JSON.stringify(lines('03-plain-stream').at(-1)) + '\n'
}
async function events(
  chunks: AsyncIterable<Uint8Array>,
  options = decodeOptions,
): Promise<StreamEvent[]> {
  return await Array.fromAsync(decodeOllamaStream(chunks, options))
}
async function response(
  chunks: AsyncIterable<Uint8Array>,
  options = decodeOptions,
): Promise<ResponseObject> {
  const all = await events(chunks, options)
  const last = all.at(-1)
  if (
    last?.type !== 'response.completed' &&
    last?.type !== 'response.incomplete' &&
    last?.type !== 'response.failed'
  )
    throw new Error('Missing terminal event')
  return last.response
}
function firstTurn(): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hi' }] }],
    instructions: 'Be brief.',
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'low', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 1024,
    prompt_cache_key: 'k',
    prompt_cache_retention: 'in_memory',
  }
}
function toolLoop(): CreateResponseBody {
  return {
    ...firstTurn(),
    input: [
      ...firstTurn().input,
      {
        type: 'reasoning',
        id: 'r1',
        encrypted_content:
          'ollama-thinking-v2:' + JSON.stringify({ model, thinking: 'Check the file first' }),
      },
      {
        type: 'function_call',
        id: 'c1',
        call_id: 'session-turn-1:call:0',
        name: 'read_file',
        arguments: '{"path":"notes.md"}',
      },
      { type: 'function_call_output', call_id: 'session-turn-1:call:0', output: 'hello' },
    ],
  }
}
function golden(name: string, body: CreateResponseBody): void {
  const request = encodeOllamaRequest(body, encodeOptions)
  expect(request.path).toBe(OLLAMA_CHAT_PATH)
  expect(request.body).toBe(
    z
      .string()
      .parse(
        JSON.parse(
          readFileSync(new URL(`ollamaCodecGoldens/${name}.json`, import.meta.url), 'utf8'),
        ),
      ),
  )
}
function mutatedCalls(mutator: (call: Record<string, unknown>) => void): string {
  const all = lines('04-two-tool-stream')
  for (const frame of all) {
    const message = frame['message']
    if (
      typeof message !== 'object' ||
      message === null ||
      !('tool_calls' in message) ||
      !Array.isArray(message.tool_calls)
    )
      continue
    message.tool_calls = message.tool_calls.map((call) => {
      const parsed = recordSchema.parse(call)
      mutator(parsed)
      return parsed
    })
  }
  return all.map((frame) => JSON.stringify(frame)).join('\n') + '\n'
}
function idlessNativeCalls(): string {
  return mutatedCalls((call) => {
    delete call['id']
  })
}

describe('encodeOllamaRequest', () => {
  it('pins first-turn bytes', () => {
    golden('first-turn', firstTurn())
  })
  it('pins tool-loop reasoning and result bytes', () => {
    golden('tool-loop', toolLoop())
  })
  it('pins image bytes and omits empty tools', () => {
    golden('image', {
      ...firstTurn(),
      tools: [],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this?' },
            { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'auto' },
          ],
        },
      ],
    })
  })
  it('pins packed-output bytes', () => {
    golden('packed-output', {
      ...toolLoop(),
      input: [
        ...toolLoop().input.slice(0, -1),
        {
          type: 'function_call_output',
          call_id: 'session-turn-1:call:0',
          output: 'Packed: two lines. Recall with recall_output(output-1).',
        },
      ],
    })
  })
  it('pins compaction bytes with tools and history', () => {
    golden('compaction', {
      ...toolLoop(),
      max_output_tokens: 256,
      input: [
        ...toolLoop().input,
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Summarize this conversation for continuation.' }],
        },
      ],
    })
  })

  it('keeps the growing-session tool-result prefix and unique fallback ids', async () => {
    const first = await response(stream(idlessNativeCalls()))
    const second = await response(stream(idlessNativeCalls()), {
      ...decodeOptions,
      responseId: 'session-turn-2',
    })
    const calls = [...first.output, ...second.output].filter((item) => isFunctionCallItem(item))
    expect(new Set(calls.map((call) => call.call_id)).size).toBe(4)
    const oldInput = [
      ...firstTurn().input,
      ...first.output.filter((item) => isFunctionCallItem(item)),
      ...first.output
        .filter((item) => isFunctionCallItem(item))
        .map((call) => ({
          type: 'function_call_output' as const,
          call_id: call.call_id,
          output: 'synthetic result',
        })),
    ]
    const firstBytes = encodeOllamaRequest({ ...firstTurn(), input: oldInput }, encodeOptions).body
    const grownBytes = encodeOllamaRequest(
      {
        ...firstTurn(),
        input: [...oldInput, ...second.output.filter((item) => isFunctionCallItem(item))],
      },
      encodeOptions,
    ).body
    expect(grownBytes.startsWith(firstBytes.slice(0, firstBytes.indexOf('],"tools"')))).toBe(true)
  })
  it('refuses duplicate historical call ids rather than rewriting a result', () => {
    const original = toolLoop()
    expect(() =>
      encodeOllamaRequest(
        {
          ...original,
          input: [
            ...original.input,
            {
              type: 'function_call',
              id: 'c2',
              call_id: 'session-turn-1:call:0',
              name: 'bash',
              arguments: '{}',
            },
          ],
        },
        encodeOptions,
      ),
    ).toThrow(UI_TEXT.ollamaDuplicateCall)
  })
  it('binds reasoning to its producing model and drops legacy or foreign envelopes', async () => {
    const nativeModel = 'qwen3:1.7b'
    const answer = await response(recordedStream('06-thinking-on'), {
      ...decodeOptions,
      model: nativeModel,
    })
    const reasoning = answer.output.filter((item) => isReasoningItem(item))
    expect(reasoning).toHaveLength(1)
    const body = { ...firstTurn(), input: reasoning }
    expect(encodeOllamaRequest(body, { ...encodeOptions, model: nativeModel }).body).toContain(
      '"thinking":',
    )
    expect(encodeOllamaRequest(body, encodeOptions).body).not.toContain('"thinking":')
    expect(
      encodeOllamaRequest(
        {
          ...body,
          input: [
            { type: 'reasoning', id: 'old', encrypted_content: 'ollama-thinking-v1:legacy' },
            { type: 'reasoning', id: 'foreign', encrypted_content: 'foreign' },
          ],
        },
        encodeOptions,
      ).body,
    ).not.toContain('"thinking":')
  })
  it('uses the installed language for codec refusals at invocation time', () => {
    const text = { ...EN, ollamaModelRequired: 'Modell fehlt.' }
    setUiText(text, 'de')
    try {
      expect(() => encodeOllamaRequest(firstTurn(), { ...encodeOptions, model: '' })).toThrow(
        'Modell fehlt.',
      )
    } finally {
      setUiText(EN, 'en')
    }
  })
  it('refuses unsupported input and invalid context explicitly', () => {
    for (const numCtx of [0, -1, 1.5, NaN])
      expect(() => encodeOllamaRequest(firstTurn(), { ...encodeOptions, numCtx })).toThrow(
        UI_TEXT.ollamaContextRequired,
      )
    expect(() =>
      encodeOllamaRequest(
        {
          ...firstTurn(),
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_file', filename: 'private.pdf', file_data: 'data:;base64,AA==' },
              ],
            },
          ],
        },
        encodeOptions,
      ),
    ).toThrow(UI_TEXT.ollamaPdfUnsupported)
    expect(() =>
      encodeOllamaRequest(
        {
          ...firstTurn(),
          input: [
            {
              type: 'function_call_output',
              call_id: 'c',
              output: [
                { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
              ],
            },
          ],
        },
        encodeOptions,
      ),
    ).toThrow(UI_TEXT.ollamaToolImageUnsupported)
  })
  it('maps effort and omits hosted search', () => {
    expect(
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'].map((effort) =>
        thinkForEffort(effort),
      ),
    ).toEqual([false, 'low', 'low', 'medium', 'high', 'high', 'high', true])
    expect(
      encodeOllamaRequest(
        {
          ...firstTurn(),
          tools: [{ type: 'web_search' }],
          input: [{ type: 'web_search_call', id: 's', status: 'completed' }],
        },
        encodeOptions,
      ).body,
    ).not.toContain('"tools"')
  })
})

async function expectMalformedCall(line: string): Promise<void> {
  const raw = line + '\n' + terminal().replace(model, 'qwen3:1.7b')
  await expect(response(stream(raw), { ...decodeOptions, model: 'qwen3:1.7b' })).rejects.toThrow(
    UI_TEXT.ollamaMalformedFrame.split('{', 1)[0],
  )
}

describe('decodeOllamaStream native captures', () => {
  it('pins capture version, counted ledger and exact transport byte lengths', () => {
    const dir = new URL('../../docs/certification/m95-captures/ollama/', import.meta.url)
    const version = z
      .object({ response: z.object({ body: z.string() }) })
      .parse(JSON.parse(readFileSync(new URL('01-version.json', dir), 'utf8')))
    expect(JSON.parse(version.response.body)).toEqual({ version: '0.35.1' })
    const ledger = z
      .array(recordSchema)
      .parse(JSON.parse(readFileSync(new URL('calls.json', dir), 'utf8')))
    expect(ledger).toHaveLength(9)
    expect(ledger.map((row) => row['number'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(ledger.every((row) => row['state'] === 'recorded' && row['billed'] === false)).toBe(true)
    for (const name of [
      '03-plain-stream',
      '04-two-tool-stream',
      '05-tool-follow-up',
      '06-thinking-on',
      '07-thinking-off',
      '08-unknown-model',
      '09-two-tool-chunks',
    ]) {
      const receipt = capture(name)
      expect(receipt.response.chunkBytes.reduce((total, length) => total + length, 0)).toBe(
        encoder.encode(receipt.response.body).byteLength,
      )
    }
  })
  it.each([
    '03-plain-stream',
    '04-two-tool-stream',
    '05-tool-follow-up',
    '06-thinking-on',
    '07-thinking-off',
    '09-two-tool-chunks',
  ])('replays counted receipt %s with usage at native chunk boundaries', async (name) => {
    const receipt = capture(name)
    const answer = await response(recordedStream(name), {
      ...decodeOptions,
      model: receipt.request.body.model,
    })
    const last = lines(name).at(-1)
    expect(answer.status).toBe('completed')
    expect(answer.usage?.input_tokens).toBe(last?.['prompt_eval_count'])
    expect(answer.usage?.output_tokens).toBe(last?.['eval_count'])
    const native = lines(name).flatMap((frame) => {
      const message = frame['message']
      return typeof message === 'object' &&
        message !== null &&
        'tool_calls' in message &&
        Array.isArray(message.tool_calls)
        ? message.tool_calls.map((call) => toolSchema.parse(call))
        : []
    })
    expect(
      answer.output
        .filter((item) => isFunctionCallItem(item))
        .map((item) => ({ name: item.name, arguments: item.arguments })),
    ).toEqual(
      native.map((call) => ({
        name: call.function.name,
        arguments: JSON.stringify(call.function.arguments),
      })),
    )
  })
  it('maps a length done_reason to the canonical incomplete response (M101 item 8)', async () => {
    const answer = await response(
      stream(
        `${JSON.stringify({ model, message: { role: 'assistant', content: 'half' } })}\n${JSON.stringify({ model, done: true, done_reason: 'length' })}\n`,
      ),
    )
    expect(answer.status).toBe('incomplete')
  })
  it('keeps two native indices distinct across lines and byte splits', async () => {
    const raw = capture('09-two-tool-chunks').response.body
    const answer = await response(
      stream(...Array.from(encoder.encode(raw), (byte) => Uint8Array.of(byte))),
      { ...decodeOptions, model: 'qwen3:1.7b' },
    )
    expect(
      answer.output
        .filter((item) => isFunctionCallItem(item))
        .map((item) => [item.name, item.arguments]),
    ).toEqual([
      ['read_file', '{"path":"notes.md"}'],
      ['bash', '{"cmd":"pwd"}'],
    ])
  })
  it('matches by native id when index is absent', async () => {
    const raw =
      nativeCallLines()
        .map((line) => line.replaceAll(/"index":\d+,/g, ''))
        .join('\n') +
      '\n' +
      terminal().replace(model, 'qwen3:1.7b')
    const answer = await response(stream(raw), { ...decodeOptions, model: 'qwen3:1.7b' })
    expect(
      answer.output.filter((item) => isFunctionCallItem(item)).map((item) => item.name),
    ).toEqual(['read_file', 'bash'])
  })
  it('fails missing identity, conflicting identity and non-object arguments', async () => {
    const bad = [
      (nativeCallLines()[0] ?? '').replace('"id":"call_hivkhz6u",', '').replace('"index":0,', '') +
        '\n' +
        terminal().replace(model, 'qwen3:1.7b'),
      capture('09-two-tool-chunks').response.body.replace('"index":1', '"index":0'),
      mutatedCalls((call) => {
        if (typeof call['function'] === 'object' && call['function'] !== null)
          Reflect.set(call['function'], 'arguments', 37)
      }),
    ]
    for (const raw of bad)
      await expect(
        response(stream(raw), {
          ...decodeOptions,
          model: raw.includes('qwen3:1.7b') ? 'qwen3:1.7b' : model,
        }),
      ).rejects.toThrow(UI_TEXT.ollamaMalformedFrame.split('{', 1)[0])
  })
  it.each([-1, 1.5])('rejects invalid native tool index %s', async (index) => {
    await expectMalformedCall(
      (nativeCallLines()[0] ?? '').replace('"index":0', () => `"index":${String(index)}`),
    )
  })
  it('rejects empty native tool id', async () => {
    await expectMalformedCall(
      (nativeCallLines()[0] ?? '').replace('"id":"call_hivkhz6u"', '"id":""'),
    )
  })
  it('finishes at done and closes the source without another read', async () => {
    let isClosed = false
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        let reads = 0
        return {
          next() {
            reads++
            if (reads > 1) return Promise.reject(new Error('Read after done'))
            return Promise.resolve({
              done: false,
              value: encoder.encode(capture('03-plain-stream').response.body),
            })
          },
          return() {
            isClosed = true
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    }
    const answer = await response(source)
    expect(answer.status).toBe('completed')
    expect(isClosed).toBe(true)
  })
  it('requires an explicit response identity', async () => {
    await expect(
      response(recordedStream('03-plain-stream'), { ...decodeOptions, responseId: '' }),
    ).rejects.toThrow(UI_TEXT.ollamaResponseIdRequired)
  })
  it('fails truncated, malformed, provider-error and wrong-model streams', async () => {
    await expect(
      response(
        stream(capture('03-plain-stream').response.body.split('\n').slice(0, -2).join('\n')),
      ),
    ).rejects.toThrow(UI_TEXT.ollamaMissingFinal)
    await expect(response(stream('{invalid\n'))).rejects.toThrow(
      UI_TEXT.ollamaMalformedFrame.split('{', 1)[0],
    )
    await expect(response(recordedStream('08-unknown-model'))).rejects.toThrow('no-such-model-m95')
    await expect(response(recordedStream('06-thinking-on'))).rejects.toThrow(
      UI_TEXT.ollamaMalformedFrame.split('{', 1)[0],
    )
  })
  it('validates counts and maps terminal reasons', async () => {
    for (const patch of [
      { prompt_eval_count: -1 },
      { eval_count: 1.5 },
      { prompt_eval_cached_count: 99 },
    ]) {
      const frame = { ...lines('03-plain-stream').at(-1), ...patch }
      const answer = await response(stream(JSON.stringify(frame) + '\n'))
      expect(answer.usage).toBeUndefined()
    }
    const incomplete = await response(stream(terminal().replace('"stop"', '"length"')))
    const failed = await response(stream(terminal().replace('"stop"', '"future-reason"')))
    expect(incomplete.status).toBe('incomplete')
    expect(failed.status).toBe('failed')
  })
})

async function failureMessage(operation: Promise<unknown>): Promise<string> {
  try {
    await operation
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('Ollama bounds', () => {
  it('bounds an unterminated frame before parsing including multibyte bytes', async () => {
    expect(
      await failureMessage(
        Array.fromAsync(readOllamaLines(stream('é'.repeat(OLLAMA_FRAME_MAX_BYTES / 2), 'é'))),
      ),
    ).toBe(UI_TEXT.ollamaStreamLimit)
    expect(
      await failureMessage(response(stream('x'.repeat(OLLAMA_FRAME_MAX_BYTES + 1) + '\n'))),
    ).toBe(UI_TEXT.ollamaStreamLimit)
  })
  it('bounds total stream bytes including blank lines', async () => {
    expect(await failureMessage(Array.fromAsync(readOllamaLines(keepalive())))).toBe(
      UI_TEXT.ollamaStreamLimit,
    )
  })
  it('bounds each tool argument object', async () => {
    const raw = mutatedCalls((call) => {
      if (typeof call['function'] === 'object' && call['function'] !== null)
        Reflect.set(call['function'], 'arguments', { path: 'x'.repeat(OLLAMA_ARGUMENT_MAX_BYTES) })
    })
    expect(await failureMessage(response(stream(raw)))).toBe(UI_TEXT.ollamaStreamLimit)
  })
  it.each(['content', 'thinking'])('bounds accumulated %s item bytes', async (field) => {
    const frame =
      JSON.stringify({
        ...lines('03-plain-stream')[0],
        message: { role: 'assistant', [field]: 'é'.repeat(OLLAMA_FRAME_MAX_BYTES / 4) },
      }) + '\n'
    expect(
      await failureMessage(
        response(
          stream(
            ...Array.from(
              { length: OLLAMA_ITEM_MAX_BYTES / (OLLAMA_FRAME_MAX_BYTES / 2) + 1 },
              () => frame,
            ),
            terminal(),
          ),
        ),
      ),
    ).toBe(UI_TEXT.ollamaStreamLimit)
  })
  it('bounds retained output item count', async () => {
    const raw =
      Array.from(
        { length: OLLAMA_OUTPUT_MAX_ITEMS + 1 },
        (_, index) =>
          (nativeCallLines()[0] ?? '')
            .replace('"index":0', () => `"index":${String(index)}`)
            .replace('call_hivkhz6u', () => `call-${String(index)}`) + '\n',
      ).join('') + terminal()
    expect(
      await failureMessage(response(stream(raw), { ...decodeOptions, model: 'qwen3:1.7b' })),
    ).toBe(UI_TEXT.ollamaStreamLimit)
  })
  it('keeps UTF-8 across splits and skips CRLF keep-alives', async () => {
    const bytes = encoder.encode('héllo\r\n\r\nworld')
    expect(
      await Array.fromAsync(
        readOllamaLines(stream(bytes.subarray(0, 2), bytes.subarray(2, 7), bytes.subarray(7))),
      ),
    ).toEqual(['héllo', 'world'])
  })
})

describe('parseOllamaError', () => {
  it('uses the captured unknown-model envelope and preserves status', () => {
    const receipt = capture('08-unknown-model')
    expect(
      parseOllamaError(receipt.response.status, JSON.parse(receipt.response.body), 'Not Found'),
    ).toMatchObject({ status: 404, message: "model 'no-such-model-m95' not found" })
    expect(parseOllamaError(429, { error: 'slow down' }, 'Too Many Requests')).toMatchObject({
      status: 429,
      kind: 'rate_limit_error',
      message: 'HTTP 429: slow down',
    })
    expect(parseOllamaError(500, undefined, 'Internal Server Error').message).toBe(
      'HTTP 500 Internal Server Error',
    )
  })
})
