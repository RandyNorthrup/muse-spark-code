import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { encodeGeminiRequest } from '../../src/core/backends/modelapi/codecs/gemini'
import { encodeOllamaRequest } from '../../src/core/backends/modelapi/codecs/ollama'
import {
  functionCallItemSchema,
  type CreateResponseBody,
  type FunctionCallOutputItem,
  type InputMessageItem,
} from '../../src/core/backends/modelapi/schemas'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { PROMPT_CACHE_RETENTIONS } from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

const CHAT: ChatPresetQuirks = {
  presetId: 'openrouter',
  outputCap: 'max_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
  toolChoice: 'auto',
}
const object = z.record(z.string(), z.unknown())

const inputMessageItemSchema = z.object({
  type: z.literal('message'),
  role: z.union([z.literal('user'), z.literal('assistant'), z.literal('developer')]),
  content: z.array(
    z.union([
      z.object({ type: z.literal('input_text'), text: z.string() }),
      z.object({
        type: z.literal('input_image'),
        image_url: z.string(),
        detail: z.literal('auto'),
      }),
      z.object({ type: z.literal('input_file'), filename: z.string(), file_data: z.string() }),
    ]),
  ),
  phase: z.optional(z.nullable(z.string())),
})

const functionCallOutputItemSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  output: z.union([
    z.string(),
    z.array(
      z.union([
        z.object({ type: z.literal('input_text'), text: z.string() }),
        z.object({
          type: z.literal('input_image'),
          image_url: z.string(),
          detail: z.literal('auto'),
        }),
      ]),
    ),
  ]),
})

/**
 * The wrap-up body the host builder actually sends, validated field by
 * field: the codecs below encode this body, never a hand-built one.
 */
function parseHostWrapUp(body: unknown): CreateResponseBody {
  const envelope = z
    .object({
      model: z.string(),
      input: z.array(z.unknown()),
      instructions: z.string(),
      tools: z.array(z.unknown()),
      tool_choice: z.union([z.literal('auto'), z.literal('none')]),
      reasoning: z.object({
        effort: z.string(),
        summary: z.optional(z.literal('auto')),
      }),
      stream: z.literal(true),
      store: z.literal(false),
      include: z.array(z.string()),
      max_output_tokens: z.number(),
      prompt_cache_key: z.string(),
      prompt_cache_retention: z.enum(PROMPT_CACHE_RETENTIONS),
    })
    .parse(body)
  if (envelope.tools.length > 0) throw new Error('expected the wrap-up to declare no tools')
  const input: CreateResponseBody['input'] = envelope.input.map((item) => {
    const tagged = z.object({ type: z.string() }).parse(item)
    switch (tagged.type) {
      case 'message': {
        const parsed: InputMessageItem = inputMessageItemSchema.parse(item)
        return parsed
      }
      case 'function_call': {
        return functionCallItemSchema.parse(item)
      }
      case 'function_call_output': {
        const parsed: FunctionCallOutputItem = functionCallOutputItemSchema.parse(item)
        return parsed
      }
      default: {
        throw new Error(`unexpected wrap-up input item: ${tagged.type}`)
      }
    }
  })
  return {
    model: envelope.model,
    input,
    instructions: envelope.instructions,
    tools: [],
    tool_choice: envelope.tool_choice,
    reasoning: {
      effort: envelope.reasoning.effort,
      ...(envelope.reasoning.summary === 'auto' && { summary: 'auto' as const }),
    },
    stream: envelope.stream,
    store: envelope.store,
    include: [],
    max_output_tokens: envelope.max_output_tokens,
    prompt_cache_key: envelope.prompt_cache_key,
    prompt_cache_retention: envelope.prompt_cache_retention,
  }
}

const shared: {
  wrap?: CreateResponseBody
  ordinaryInstructions?: string
} = {}

function wrapBody(): CreateResponseBody {
  if (shared.wrap === undefined) throw new Error('wrap-up body not captured')
  return shared.wrap
}

function ordinaryInstructions(): string {
  if (shared.ordinaryInstructions === undefined) throw new Error('ordinary body not captured')
  return shared.ordinaryInstructions
}

beforeAll(async () => {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: () => 2,
  })
  try {
    const { session, turnDone } = await startWatchedSession(
      host,
      '/ws',
      mspApprovalMode('acceptEdits'),
    )
    api.script(
      { calls: [{ name: 'get_goal', arguments: '{}' }] },
      { text: 'Done; found; remaining.' },
    )
    await session.sendTurn([{ type: 'text', text: 'Review' }])
    await turnDone()
    const bodies = api.responseBodies()
    if (bodies.length !== 2) throw new Error('expected one ordinary call and its wrap-up')
    const ordinary = z.object({ instructions: z.string() }).parse(bodies[0])
    shared.ordinaryInstructions = ordinary.instructions
    shared.wrap = parseHostWrapUp(bodies[1])
  } finally {
    await host.close()
  }
})

describe('wrap-up requests across codec families', () => {
  it('keeps instructions byte-identical and carries the note as trailing input', () => {
    const wrap = wrapBody()
    expect(wrap.instructions).toBe(ordinaryInstructions())
    expect(JSON.stringify(wrap.input)).toContain('limit of 2 model calls')
    const last = wrap.input.at(-1)
    expect(last).toMatchObject({ type: 'message', role: 'developer' })
  })
  it.each(['api', 'chatgpt'] as const)(
    'Responses %s keeps empty tools with the choice, the captured wire shape',
    (profile) => {
      const codec = createResponsesCodec(
        profile === 'chatgpt'
          ? { profile, toolNamespace: 'functions' }
          : { sendPromptCacheKey: false, sendPromptCacheRetention: false },
      )
      const request = codec.encodeRequest(wrapBody())
      // Deliberately kept: no live capture of an omitted choice exists on
      // this family, while empty tools with the choice is what the wire
      // (Meta golden, git-draft and tools-less compaction side calls) sends.
      expect(request['tool_choice']).toBe('auto')
      if (profile === 'chatgpt') {
        expect(request['tools']).toEqual([
          expect.objectContaining({ type: 'namespace', tools: [] }),
        ])
      } else {
        expect(request['tools']).toEqual([])
      }
      expect(JSON.stringify(request)).toContain('limit of 2 model calls')
    },
  )
  it.each(['auto', 'omit', undefined] as const)(
    'Chat omits declarations and choice for a tool-less request (%s)',
    (toolChoice) => {
      const request = encodeChatRequest(wrapBody(), 'review-model', { ...CHAT, toolChoice }).body
      expect(request.tools).toBeUndefined()
      expect(request.tool_choice).toBeUndefined()
      expect(JSON.stringify(request.messages)).toContain('limit of 2 model calls')
    },
  )
  it('Anthropic omits declarations and choice while retaining tool-result history', () => {
    const request = encodeAnthropicRequest(wrapBody(), {
      model: 'claude-sonnet-5-5',
      maxTokens: 256,
      effort: 'low',
    }).body
    expect(request.tools).toBeUndefined()
    expect(request.tool_choice).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 2 model calls')
    const output = wrapBody().input.find((item) => item.type === 'function_call_output')
    if (output?.type !== 'function_call_output' || typeof output.output !== 'string')
      throw new Error('expected the host-built tool result')
    // The tool result survives encoding (matched unescaped: the wire
    // stringifies it, so a raw substring would miss its quotes).
    expect(JSON.stringify(request.messages)).toContain(JSON.stringify(output.output).slice(1, -1))
  })
  it('Gemini omits declarations and tool config', () => {
    const request = encodeGeminiRequest(wrapBody(), 'gemini-3.5-flash-lite').body
    expect(request['tools']).toBeUndefined()
    expect(request['toolConfig']).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 2 model calls')
  })
  it('Ollama omits tools and unsupported tool choice', () => {
    const request = object.parse(
      JSON.parse(
        encodeOllamaRequest(wrapBody(), {
          model: 'qwen3:4b-instruct-2507-q4_K_M',
          numCtx: 32_768,
          think: false,
        }).body,
      ),
    )
    expect(request['tools']).toBeUndefined()
    expect(request['tool_choice']).toBeUndefined()
    expect(JSON.stringify(request)).toContain('limit of 2 model calls')
  })
})
