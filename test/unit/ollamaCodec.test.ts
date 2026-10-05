// The Ollama native `/api/chat` codec (M95 lane O, PLAN.md D74).
//
// No live Ollama capture exists yet (M95 step 1 is still to capture on the
// rigs), so the decode fixtures below are written from the documented wire
// shapes (m95-research.md §1.9, from docs.ollama.com read 2026-09-29,
// Ollama v0.35.1: NDJSON lines, `think`, `options.num_ctx`, `thinking` on
// messages, `tool_calls[].function.arguments` as an object, usage on the
// final line, `{"error": "…"}` errors). The encode goldens are the exact
// bytes this codec sends.

import { describe, expect, it } from 'vitest'

import {
  OLLAMA_CHAT_PATH,
  decodeOllamaStream,
  encodeOllamaRequest,
  parseOllamaError,
  readOllamaLines,
  thinkForEffort,
} from '../../src/core/backends/modelapi/codecs/ollama'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'

const encoder = new TextEncoder()

/** The parts as one byte stream, one chunk each (a ReadableStream is async-iterable). */
function stream(...parts: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part)
      }
      controller.close()
    },
  })
}

function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  return Array.fromAsync(events)
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

describe('encodeOllamaRequest', () => {
  it('encodes a first turn to the exact native bytes', () => {
    const request = encodeOllamaRequest(firstTurn(), { model: 'qwen3:8b', numCtx: 32_768 })
    expect(request.path).toBe(OLLAMA_CHAT_PATH)
    expect(request.body).toBe(
      '{"model":"qwen3:8b","messages":[{"role":"system","content":"Be brief."},' +
        '{"role":"user","content":"Say hi"}],' +
        '"tools":[{"type":"function","function":{"name":"read_file","description":"Read a file",' +
        '"parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}],' +
        '"options":{"num_ctx":32768,"num_predict":1024},"think":"low","stream":true}',
    )
  })

  it('encodes a tool loop with replayed thinking, calls and results', () => {
    const body: CreateResponseBody = {
      ...firstTurn(),
      reasoning: { effort: 'medium', summary: 'auto' },
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read notes.md' }] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: "I'll check." }],
        },
        {
          type: 'reasoning',
          id: 'r1',
          summary: [{ type: 'summary_text', text: 'Check the file first' }],
          encrypted_content: 'ollama-thinking-v1:Check the file first',
        },
        {
          type: 'function_call',
          id: 'c1',
          call_id: 'call-1',
          name: 'read_file',
          arguments: '{"path":"notes.md"}',
        },
        { type: 'function_call_output', call_id: 'call-1', output: 'hello' },
      ],
    }
    const request = encodeOllamaRequest(body, { model: 'qwen3:8b', numCtx: 65_536 })
    expect(request.body).toBe(
      '{"model":"qwen3:8b","messages":[{"role":"system","content":"Be brief."},' +
        '{"role":"user","content":"Read notes.md"},' +
        '{"role":"assistant","content":"I\'ll check.","thinking":"Check the file first"},' +
        '{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read_file",' +
        '"arguments":{"path":"notes.md"}}}]}' +
        ',{"role":"tool","content":"hello","tool_name":"read_file"}],' +
        '"tools":[{"type":"function","function":{"name":"read_file","description":"Read a file",' +
        '"parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}],' +
        '"options":{"num_ctx":65536,"num_predict":1024},"think":"medium","stream":true}',
    )
  })

  it('sends images as base64 payloads and drops web search', () => {
    const body: CreateResponseBody = {
      ...firstTurn(),
      tools: [{ type: 'web_search' }],
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this?' },
            { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'auto' },
          ],
        },
        { type: 'web_search_call', id: 's1', status: 'completed' },
      ],
    }
    const request = encodeOllamaRequest(body, { model: 'qwen3:8b', numCtx: 32_768, think: false })
    expect(request.body).toBe(
      '{"model":"qwen3:8b","messages":[{"role":"system","content":"Be brief."},' +
        '{"role":"user","content":"What is this?","images":["aGVsbG8="]}],' +
        '"options":{"num_ctx":32768,"num_predict":1024},"think":false,"stream":true}',
    )
  })

  it('keeps earlier native bytes when the session grows', () => {
    const first = encodeOllamaRequest(firstTurn(), { model: 'qwen3:8b', numCtx: 32_768 })
    const grown = encodeOllamaRequest(
      {
        ...firstTurn(),
        input: [
          ...firstTurn().input,
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi.' }],
            phase: 'final_answer',
          },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Again' }] },
        ],
      },
      { model: 'qwen3:8b', numCtx: 32_768 },
    )
    const sharedPrefix = first.body.slice(0, first.body.indexOf('],"tools"'))
    expect(sharedPrefix.endsWith('{"role":"user","content":"Say hi"}')).toBe(true)
    expect(grown.body.startsWith(sharedPrefix)).toBe(true)
  })

  it('maps developer to system and omits tool_name without a known call', () => {
    const body: CreateResponseBody = {
      ...firstTurn(),
      tools: [],
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] },
        { type: 'function_call_output', call_id: 'unknown', output: 'out' },
      ],
    }
    const request = encodeOllamaRequest(body, { model: 'qwen3:8b', numCtx: 131_072 })
    expect(JSON.parse(request.body)).toEqual({
      model: 'qwen3:8b',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'system', content: 'rules' },
        { role: 'tool', content: 'out' },
      ],
      options: { num_ctx: 131_072, num_predict: 1024 },
      think: 'low',
      stream: true,
    })
  })

  it('drops foreign reasoning and passes non-JSON arguments through', () => {
    const body: CreateResponseBody = {
      ...firstTurn(),
      input: [
        { type: 'reasoning', id: 'r9', encrypted_content: 'someone-elses-blob' },
        {
          type: 'function_call',
          id: 'c9',
          call_id: 'call-9',
          name: 'read_file',
          arguments: 'not json {',
        },
      ],
    }
    expect(
      JSON.parse(encodeOllamaRequest(body, { model: 'qwen3:8b', numCtx: 32_768 }).body),
    ).toEqual({
      model: 'qwen3:8b',
      messages: [
        { role: 'system', content: 'Be brief.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'read_file', arguments: 'not json {' } }],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      options: { num_ctx: 32_768, num_predict: 1024 },
      think: 'low',
      stream: true,
    })
  })

  it('refuses what the native API cannot carry', () => {
    expect(() => encodeOllamaRequest(firstTurn(), { model: '', numCtx: 32_768 })).toThrow(
      'Ollama needs a model id',
    )
    for (const numCtx of [0, -1, 1.5, NaN]) {
      expect(() => encodeOllamaRequest(firstTurn(), { model: 'qwen3:8b', numCtx })).toThrow(
        'positive integer num_ctx',
      )
    }
    expect(() =>
      encodeOllamaRequest(
        {
          ...firstTurn(),
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_file', filename: 'a.pdf', file_data: 'data:;base64,AA==' }],
            },
          ],
        },
        { model: 'qwen3:8b', numCtx: 32_768 },
      ),
    ).toThrow('does not take PDFs')
    expect(() =>
      encodeOllamaRequest(
        {
          ...firstTurn(),
          input: [
            {
              type: 'function_call_output',
              call_id: 'c1',
              output: [
                { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
              ],
            },
          ],
        },
        { model: 'qwen3:8b', numCtx: 32_768 },
      ),
    ).toThrow('does not take pictures')
  })

  it('maps effort tiers to think levels', () => {
    expect([
      thinkForEffort('none'),
      thinkForEffort('minimal'),
      thinkForEffort('low'),
      thinkForEffort('medium'),
      thinkForEffort('high'),
      thinkForEffort('xhigh'),
      thinkForEffort('max'),
      thinkForEffort('something-new'),
    ]).toEqual([false, 'low', 'low', 'medium', 'high', 'high', 'high', true])
  })
})

describe('readOllamaLines', () => {
  it('splits lines across chunks, keeps multi-byte characters and skips keep-alives', async () => {
    const bytes = encoder.encode('{"a":1}\n\n{"b":"héllo"}\n{"c"')
    // The second cut lands inside the two-byte "é".
    const lines = await collect(
      readOllamaLines(
        stream(
          bytes.subarray(0, 9),
          bytes.subarray(9, 17),
          bytes.subarray(17, 24),
          bytes.subarray(24),
          ':3}\r\n',
        ),
      ),
    )
    expect(lines).toEqual(['{"a":1}', '{"b":"héllo"}', '{"c":3}'])
  })
})

const TEXT_STREAM = [
  '{"model":"qwen3:8b","message":{"role":"assistant","content":"Hel"},"done":false}\n',
  '\n',
  '{"model":"qwen3:8b","message":{"role":"assistant","content":"lo wörld"},"done":false}\n',
  '{"model":"qwen3:8b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop",',
  '"prompt_eval_count":18,"prompt_eval_cached_count":4,"eval_count":3}\n',
]

describe('decodeOllamaStream', () => {
  it('decodes text, usage and the final response across split chunks', async () => {
    const chunks = TEXT_STREAM.flatMap((line) => {
      const bytes = encoder.encode(line)
      const mid = Math.floor(bytes.length / 2)
      return [bytes.subarray(0, mid), bytes.subarray(mid)]
    })
    const events = await collect(
      decodeOllamaStream(stream(...chunks), { model: 'qwen3:8b', status: 200 }),
    )
    expect(events).toEqual([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'ollama-message', role: 'assistant', content: [] },
      },
      { type: 'response.output_text.delta', item_id: 'ollama-message', delta: 'Hel' },
      { type: 'response.output_text.delta', item_id: 'ollama-message', delta: 'lo wörld' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'ollama-message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello wörld' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'ollama-response',
          status: 'completed',
          model: 'qwen3:8b',
          output: [
            {
              type: 'message',
              id: 'ollama-message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Hello wörld' }],
            },
          ],
          usage: {
            input_tokens: 18,
            output_tokens: 3,
            total_tokens: 21,
            input_tokens_details: { cached_tokens: 4 },
          },
        },
      },
    ])
  })

  it('decodes thinking into a reasoning item that replays through encode', async () => {
    const events = await collect(
      decodeOllamaStream(
        stream(
          '{"message":{"role":"assistant","thinking":"Let me "},"done":false}\n',
          '{"message":{"role":"assistant","thinking":"think…","content":"Done"},"done":false}\n',
          '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop",',
          '"prompt_eval_count":9,"eval_count":6}\n',
        ),
        { model: 'qwen3:8b', status: 200 },
      ),
    )
    const completed = events.find((event) => event.type === 'response.completed')
    expect(completed).toBeDefined()
    const reasoning =
      completed?.type === 'response.completed'
        ? completed.response.output.find((item) => item.type === 'reasoning')
        : undefined
    expect(reasoning).toEqual({
      type: 'reasoning',
      id: 'ollama-reasoning',
      summary: [{ type: 'summary_text', text: 'Let me think…' }],
      encrypted_content: 'ollama-thinking-v1:Let me think…',
    })
    // The opaque payload replays as native thinking on the same provider.
    expect(
      JSON.parse(
        encodeOllamaRequest(
          {
            ...firstTurn(),
            tools: [],
            input: [
              { type: 'reasoning', id: 'r', encrypted_content: 'ollama-thinking-v1:Let me think…' },
            ],
          },
          { model: 'qwen3:8b', numCtx: 32_768 },
        ).body,
      ),
    ).toEqual({
      model: 'qwen3:8b',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'assistant', content: '', thinking: 'Let me think…' },
      ],
      options: { num_ctx: 32_768, num_predict: 1024 },
      think: 'low',
      stream: true,
    })
  })

  it('decodes parallel whole tool calls with server and fallback ids', async () => {
    const events = await collect(
      decodeOllamaStream(
        stream(
          '{"message":{"role":"assistant","content":"Checking"},"done":false}\n',
          '{"message":{"role":"assistant","tool_calls":[{"id":"a1","function":{"name":"read_file","arguments":{"path":"a"}}},{"function":{"name":"bash","arguments":{"path":"b"}}}]},"done":false}\n',
          '{"done":true,"done_reason":"stop","prompt_eval_count":30,"eval_count":12}\n',
        ),
        { model: 'qwen3:8b', status: 200 },
      ),
    )
    const completed = events.find((event) => event.type === 'response.completed')
    expect(completed?.type === 'response.completed' ? completed.response.output : []).toEqual([
      {
        type: 'message',
        id: 'ollama-message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Checking' }],
      },
      {
        type: 'function_call',
        id: 'ollama-tool-0',
        call_id: 'a1',
        name: 'read_file',
        arguments: '{"path":"a"}',
      },
      {
        type: 'function_call',
        id: 'ollama-tool-1',
        call_id: 'ollama-call-1',
        name: 'bash',
        arguments: '{"path":"b"}',
      },
    ])
  })

  it('appends string argument fragments of one call across lines', async () => {
    const events = await collect(
      decodeOllamaStream(
        stream(
          '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"bash","arguments":"{\\"cmd\\":"}}]},"done":false}\n',
          '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"bash","arguments":"\\"ls\\"}"}}]},"done":false}\n',
          '{"done":true,"done_reason":"stop","prompt_eval_count":30,"eval_count":12}\n',
        ),
        { model: 'qwen3:8b', status: 200 },
      ),
    )
    const completed = events.find((event) => event.type === 'response.completed')
    const call =
      completed?.type === 'response.completed'
        ? completed.response.output.find((item) => item.type === 'function_call')
        : undefined
    expect(call).toEqual({
      type: 'function_call',
      id: 'ollama-tool-0',
      call_id: 'ollama-call-0',
      name: 'bash',
      arguments: '{"cmd":"ls"}',
    })
  })

  it('leaves usage unknown when the counts are invalid', async () => {
    for (const final of [
      '{"done":true,"done_reason":"stop","prompt_eval_count":-1,"eval_count":2}\n',
      '{"done":true,"done_reason":"stop","prompt_eval_count":5,"prompt_eval_cached_count":9,"eval_count":2}\n',
      '{"done":true,"done_reason":"stop","eval_count":2}\n',
    ]) {
      const events = await collect(
        decodeOllamaStream(stream(final), { model: 'qwen3:8b', status: 200 }),
      )
      const completed = events.find((event) => event.type === 'response.completed')
      expect(
        completed?.type === 'response.completed' ? completed.response.usage : 'present',
      ).toBeUndefined()
    }
  })

  it('ends incomplete on length and failed on an unknown reason', async () => {
    const short = await collect(
      decodeOllamaStream(
        stream('{"done":true,"done_reason":"length","prompt_eval_count":5,"eval_count":5}\n'),
        {
          model: 'qwen3:8b',
          status: 200,
        },
      ),
    )
    const incomplete = short.find((event) => event.type === 'response.incomplete')
    expect(
      incomplete?.type === 'response.incomplete'
        ? incomplete.response.incomplete_details
        : undefined,
    ).toEqual({
      reason: 'length',
    })
    const strange = await collect(
      decodeOllamaStream(
        stream('{"done":true,"done_reason":"ejected","prompt_eval_count":5,"eval_count":5}\n'),
        {
          model: 'qwen3:8b',
          status: 200,
        },
      ),
    )
    const failed = strange.find((event) => event.type === 'response.failed')
    expect(failed?.type === 'response.failed' ? failed.response.error : undefined).toEqual({
      message: 'Ollama finished with reason "ejected"',
    })
  })

  it('fails the turn on a mid-stream error with the server text', async () => {
    await expect(
      collect(
        decodeOllamaStream(
          stream(
            '{"message":{"role":"assistant","content":"Hi"},"done":false}\n',
            '{"error":"model went away"}\n',
          ),
          { model: 'qwen3:8b', status: 200 },
        ),
      ),
    ).rejects.toMatchObject({ message: 'model went away', status: 200 })
  })

  it('fails malformed frames with their length, never their text', async () => {
    const bad = '{"message": {"content": "oops"}\n'
    await expect(
      collect(decodeOllamaStream(stream(bad), { model: 'qwen3:8b', status: 200 })),
    ).rejects.toMatchObject({
      message: `Malformed stream frame (${String(bad.length - 1)} characters)`,
    })
    await expect(
      collect(decodeOllamaStream(stream('"just a string"\n'), { model: 'qwen3:8b', status: 200 })),
    ).rejects.toMatchObject({ message: expect.stringContaining('Malformed stream frame') })
  })

  it('fails a stream that closes without a final line', async () => {
    await expect(
      collect(
        decodeOllamaStream(
          stream('{"message":{"role":"assistant","content":"half"},"done":false}\n'),
          {
            model: 'qwen3:8b',
            status: 200,
          },
        ),
      ),
    ).rejects.toMatchObject({ message: 'Ollama closed the stream without a final answer' })
  })

  it('completes an empty reply with an empty message item', async () => {
    const events = await collect(
      decodeOllamaStream(
        stream('{"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":0}\n'),
        {
          model: 'qwen3:8b',
          status: 200,
        },
      ),
    )
    expect(events.map((event) => event.type)).toEqual([
      'response.output_item.added',
      'response.output_item.done',
      'response.completed',
    ])
  })
})

describe('parseOllamaError', () => {
  it('keeps the server message and the status', () => {
    const error = parseOllamaError(404, { error: 'model "nope" not found' }, 'Not Found')
    expect(error.name).toBe('ModelApiError')
    expect({ message: error.message, status: error.status, kind: error.kind }).toEqual({
      message: 'model "nope" not found',
      status: 404,
      kind: undefined,
    })
  })

  it('marks a 429 with the HTTP 429 reason', () => {
    const error = parseOllamaError(429, { error: 'slow down' }, 'Too Many Requests')
    expect({ message: error.message, status: error.status, kind: error.kind }).toEqual({
      message: 'HTTP 429: slow down',
      status: 429,
      kind: 'rate_limit_error',
    })
  })

  it('falls back to the status line when the body is not an envelope', () => {
    expect(parseOllamaError(500, undefined, 'Internal Server Error').message).toBe(
      'HTTP 500 Internal Server Error',
    )
    expect(parseOllamaError(500, { error: '' }, 'Internal Server Error').message).toBe(
      'HTTP 500 Internal Server Error',
    )
  })
})
