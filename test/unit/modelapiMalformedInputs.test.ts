// Malformed outside-world input on the Model API backend: a broken NDJSON
// stream line, a schema `$ref` with a bad percent-escape, memory tool
// arguments that are not JSON, a packed-output recall with unparseable
// arguments, a strict tool call whose arguments are not JSON, and a broken
// SSE data line. Each reaches the typed outcome (never a crash and never
// another fact) through the real parser.
import { realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNdjson } from '../../src/core/backends/modelapi/ndjson'
import { jsonOutput } from '../../src/core/backends/modelapi/hookFormats/core'
import { functionParameters } from '../../src/core/backends/modelapi/mcp/functions'
import { placeMemoryCall } from '../../src/core/backends/modelapi/memoryTools'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPack'
import { McpHttpTransport } from '../../src/core/backends/modelapi/mcp/http'
import { McpError } from '../../src/core/backends/modelapi/mcp/protocol'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { parseRunChecks, thenRunOf } from '../../src/core/backends/modelapi/verifyTools'
import {
  decodeGeminiStream,
  encodeGeminiRequest,
} from '../../src/core/backends/modelapi/codecs/gemini'
import { encodeOllamaRequest } from '../../src/core/backends/modelapi/codecs/ollama'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  restoreOptionalToolArguments,
  type FunctionToolDefinition,
} from '../../src/core/backends/modelapi/schemas'
import {
  createResponsesCodec,
  ResponsesDecodeError,
} from '../../src/core/backends/modelapi/codecs/responses'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { canonicalPath } from '../../src/host/canonicalPath'
import { writeFileAtomically } from '../../src/host/fsAtomic'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import {
  CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
  UI_TEXT,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const encoder = new TextEncoder()

function collected(chunks: readonly Uint8Array[]): Promise<unknown[]> {
  return Array.fromAsync(parseNdjson(chunks))
}

describe('a broken NDJSON stream line', () => {
  it('yields whole values, skips blank keep-alives, and names a malformed line', async () => {
    await expect(collected([encoder.encode('{"a":1}\n\n{"b":2}\n')])).resolves.toEqual([
      { a: 1 },
      { b: 2 },
    ])
    await expect(collected([encoder.encode('{"a":1}\n{oops}\n')])).rejects.toThrow(
      /malformed_ndjson/,
    )
  })
})

describe('unparseable hook and schema input', () => {
  it('reads non-JSON hook stdout as no output', () => {
    expect(jsonOutput('not json')).toBeUndefined()
    expect(jsonOutput('{"permissionDecision":"allow"}')).toEqual({
      permissionDecision: 'allow',
    })
  })

  it('cuts a $ref whose escape is not decodable, instead of failing the schema', () => {
    const result = functionParameters({ $ref: '#/$defs/%ZZ' })
    expect(result.isReplaced).toBe(false)
    expect(result.notes).toContain('an unresolved reference was cut')
  })
})

describe('a packed-output recall with unparseable arguments', () => {
  it('fails with the recall refusal, not with a lookup of nothing', () => {
    const outcome = new ObservationPack().recall('{not json')
    expect(outcome.output).toBe(`Error: ${MODEL_API_MODEL_TEXT.packInvalidJson}`)
    expect(outcome.failureReason).toBe(UI_TEXT.packRecallInvalid)
  })
})

describe('strict tool arguments that are not JSON', () => {
  const tool: FunctionToolDefinition = {
    type: 'function',
    name: 'read',
    description: 'read',
    parameters: {},
    strict: true,
  }

  it('pass through for the tool parser instead of becoming an empty object', () => {
    expect(restoreOptionalToolArguments('{not json', tool)).toBe('{not json')
  })
})

describe('a broken SSE data line on the responses codec', () => {
  const codec = createResponsesCodec({
    profile: 'chatgpt',
    toolNamespace: 'functions',
    toolNamespaceDescription: CHATGPT_TOOL_NAMESPACE_DESCRIPTION,
  })

  it('ends the turn with a decode error that names only the line length', async () => {
    await expect(
      Array.fromAsync(codec.decodeStream([encoder.encode('data: {oops}\n\n')])),
    ).rejects.toThrow(ResponsesDecodeError)
  })
})

describe('argument previews over unparseable input', () => {
  it('freezes malformed JSON and non-object JSON instead of throwing', () => {
    const malformed = new ArgumentPreview()
    malformed.finish('{oops')
    expect(malformed.snapshot().frozen).toBe(true)
    const scalar = new ArgumentPreview()
    scalar.finish('[1]')
    expect(scalar.snapshot().frozen).toBe(true)
    const valid = new ArgumentPreview()
    valid.finish('{"a":1}')
    expect(valid.snapshot().frozen).toBe(false)
  })
})

describe('verify tool arguments that are not JSON', () => {
  it('refuses run_checks and leaves then_run absent', () => {
    expect(parseRunChecks('{oops')).toEqual({
      ok: false,
      reason: 'arguments are not valid JSON',
    })
    expect(thenRunOf('{oops')).toEqual({ kind: 'absent' })
  })
})

describe('a broken SSE data line on the Gemini codec', () => {
  it('ends the turn naming only the frame length', async () => {
    await expect(
      Array.fromAsync(decodeGeminiStream([encoder.encode('data: {oops}\n\n')], 'gemini-2.5-flash')),
    ).rejects.toThrow(/Malformed stream frame \(6 characters\)/)
    await expect(
      Array.fromAsync(decodeGeminiStream([encoder.encode('data: {oops}\n\n')], 'gemini-2.5-flash')),
    ).rejects.toThrow(ModelApiError)
  })

  it('rides a history item with unparseable arguments as an empty object', () => {
    const body: CreateResponseBody = {
      model: 'muse-spark-1.3',
      input: [{ type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{oops' }],
      instructions: '',
      tools: [],
      tool_choice: 'auto',
      reasoning: { effort: 'none', summary: 'auto' },
      max_output_tokens: 4096,
      stream: true,
      store: false,
      include: [],
      prompt_cache_key: 'fixture',
      prompt_cache_retention: 'in_memory',
    }
    const contents = encodeGeminiRequest(body, 'gemini-2.5-flash').body['contents']
    expect(Array.isArray(contents)).toBe(true)
    const parts = (contents as readonly unknown[]).flatMap((content) =>
      typeof content === 'object' && content !== null && 'parts' in content
        ? (content.parts as readonly unknown[])
        : [],
    )
    const call = parts.find(
      (part): part is { functionCall: { name: string; args: unknown } } =>
        typeof part === 'object' && part !== null && 'functionCall' in part,
    )
    expect(call?.functionCall.args).toEqual({})
  })
})

const ollamaOptions = {
  model: 'qwen3:4b-instruct-2507-q4_K_M',
  numCtx: 32_768,
  think: false,
} as const
function ollamaBody(input: CreateResponseBody['input']): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input,
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

describe('damaged Ollama thinking envelopes and arguments', () => {
  it('drops a thinking envelope that is not JSON, keeping the request', () => {
    const damaged = encodeOllamaRequest(
      ollamaBody([
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hi' }] },
        { type: 'reasoning', id: 'r1', encrypted_content: 'ollama-thinking-v2:{oops' },
      ]),
      ollamaOptions,
    ).body
    expect(damaged).not.toContain('"thinking":')
  })

  it('passes non-JSON call arguments to the server instead of an empty object', () => {
    const passed = encodeOllamaRequest(
      ollamaBody([
        {
          type: 'function_call',
          id: 'c1',
          call_id: 'session-turn-1:call:0',
          name: 'read_file',
          arguments: '{oops',
        },
      ]),
      ollamaOptions,
    ).body
    expect(passed).toContain('{oops')
  })
})

function goneServer(logs: { info: string[]; warn: string[] }) {
  return new McpHttpTransport({
    name: 'gone',
    // Nothing listens here: the real fetch fails the send without a server.
    url: 'http://127.0.0.1:1/mcp',
    headers: {},
    fetch,
    log: {
      trace: () => undefined,
      info: (message: string) => {
        logs.info.push(message)
      },
      warn: (message: string) => {
        logs.warn.push(message)
      },
      error: () => undefined,
    },
  })
}

describe('an unreachable MCP server over HTTP', () => {
  it('refuses the send naming the server, and keeps an abort an abort', async () => {
    const logs = { info: [] as string[], warn: [] as string[] }
    const transport = goneServer(logs)
    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }, new AbortController().signal),
    ).rejects.toThrow(McpError)
    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }, new AbortController().signal),
    ).rejects.toThrow('the server could not be reached')
    const stopped = new AbortController()
    stopped.abort()
    let failure: unknown = 'sent'
    try {
      await transport.send({ jsonrpc: '2.0', id: 2, method: 'ping' }, stopped.signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DOMException)
    expect((failure as DOMException).name).toBe('AbortError')
  })
})

describe('memory tool arguments that are not JSON', () => {
  const paths = { root: '' }
  beforeAll(async () => {
    paths.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-memory-args-')))
  })
  afterAll(async () => {
    await removeFolder(paths.root)
  })

  it('refuses before placing any note', async () => {
    const store = new MemoryStore({
      io: createMemoryIo(
        {
          readFile: () => Promise.resolve(undefined),
          writeFile: (absolutePath: string, content: string) =>
            writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
          realPath: canonicalPath,
          hasUnsavedChanges: () => false,
        },
        { warn: () => undefined },
      ),
      platform: process.platform,
      dataRoot: () => path.join(paths.root, 'data'),
      workspaceRoot: path.join(paths.root, 'ws'),
      systemPath,
      warn: () => undefined,
    })
    const result = await placeMemoryCall(store, MODEL_API_TOOLS.readMemory, '{not json')
    expect(result).toEqual({ ok: false, reason: 'arguments are not valid JSON' })
  })
})
