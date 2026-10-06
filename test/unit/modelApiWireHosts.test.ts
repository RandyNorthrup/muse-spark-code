// Captured wire -> codec -> registry -> real host -> workspace tool -> native
// follow-up. This test-only client stands in for lane T's absent transport.
// Capture tool names/arguments are relabelled to exercise read_file; shapes,
// frame order, usage, signatures and terminal outcomes remain captured.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ModelClient } from '../../src/core/backends/modelapi/modelPolicy'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import {
  decodeAnthropicStream,
  encodeAnthropicRequest,
} from '../../src/core/backends/modelapi/codecs/anthropic'
import {
  decodeGeminiStream,
  encodeGeminiRequest,
} from '../../src/core/backends/modelapi/codecs/gemini'
import {
  decodeChatStream,
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import {
  decodeOllamaStream,
  encodeOllamaRequest,
} from '../../src/core/backends/modelapi/codecs/ollama'
import { parseSse } from '../../src/core/backends/modelapi/sse'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const receiptSchema = z.object({
  response: z.object({
    body: z.optional(z.string()),
    events: z.optional(z.array(z.object({ event: z.optional(z.string()), data: z.unknown() }))),
  }),
})
const chat: ChatPresetQuirks = {
  presetId: 'groq',
  outputCap: 'max_completion_tokens',
  reasoningParam: 'none',
  sendCacheKey: false,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'none',
}
const responses = createResponsesCodec({
  sendPromptCacheRetention: false,
  sendPromptCacheKey: true,
})
const formats = [
  {
    format: 'responses',
    provider: 'openai',
    native: 'gpt-5.6-luna',
    files: ['02-tool-call-stream', '03-tool-result-stream'],
  },
  {
    format: 'anthropic',
    provider: 'anthropic',
    native: 'claude-haiku-4-5-20251001',
    files: ['03-tool-call-stream', '04-tool-result-stream'],
  },
  {
    format: 'gemini',
    provider: 'gemini',
    native: 'gemini-3.5-flash-lite',
    files: ['02-tool-call-stream', '03-tool-result-stream'],
  },
  {
    format: 'chat',
    provider: 'groq',
    native: 'openai/gpt-oss-20b',
    files: ['02-tool-call-stream', '03-tool-result-stream'],
  },
  {
    format: 'ollama',
    provider: 'ollama',
    native: 'qwen3:4b-instruct-2507-q4_K_M',
    files: ['04-two-tool-stream', '05-tool-follow-up'],
  },
]

function wire(provider: string, file: string): string {
  const text = readFileSync(
    new URL(`../../docs/certification/m95-captures/${provider}/${file}.json`, import.meta.url),
    'utf8',
  )
  const receipt = receiptSchema.parse(JSON.parse(text)).response
  return (
    (
      receipt.body ??
      receipt.events
        ?.map(
          (frame) =>
            `${frame.event === undefined ? '' : `event: ${frame.event}\n`}data: ${JSON.stringify(frame.data)}\n\n`,
        )
        .join('') ??
      ''
    )
      .replaceAll('get_time', 'read_file')
      .replaceAll('timezone', 'path')
      .replaceAll('UTC', 'notes.md')
      // Anthropic's captured argument key is split between these two frames.
      .replaceAll(String.raw`partial_json":"{\"timez`, String.raw`partial_json":"{\"pa`)
      .replaceAll(String.raw`partial_json":"one\"`, String.raw`partial_json":"th\"`)
  )
}

function* chunks(text: string) {
  const bytes = new TextEncoder().encode(text)
  const middle = Math.floor(bytes.length / 2)
  yield bytes.subarray(0, middle)
  yield bytes.subarray(middle)
}

describe('captured provider wire formats through ModelApiHost', () => {
  for (const scenario of formats) {
    it(`${scenario.format}: dispatches the selected model, executes read_file, and encodes its result`, async () => {
      const ref = `${scenario.provider}/${scenario.native}`
      const nativeRequests: unknown[] = []
      let attempt = 0
      const client: ModelClient = {
        currentKeyDigest: () => Promise.resolve('provider-test-identity'),
        listModels: () => Promise.resolve([ref]),
        countInputTokens: () => Promise.reject(new Error('No count endpoint in this fixture')),
        retryDelayMs: () => 0,
        waitBeforeRetry: () => Promise.resolve(),
        async *streamResponse(body, signal, _retry, _budget, admit) {
          if (signal.aborted) throw new Error('cancelled')
          admit?.('provider-test-identity')
          admit?.onRequestStarted?.()
          const file = scenario.files[attempt]
          if (file === undefined) throw new Error('Unexpected third request')
          attempt += 1
          const stream = Array.fromAsync(chunks(wire(scenario.provider, file)))
          const source = (async function* () {
            yield* await stream
          })()
          let events: AsyncIterable<StreamEvent> | Iterable<StreamEvent>
          switch (scenario.format) {
            case 'responses': {
              nativeRequests.push(responses.encodeRequest({ ...body, model: scenario.native }))
              events = responses.decodeStream(source)
              break
            }
            case 'anthropic': {
              nativeRequests.push(
                encodeAnthropicRequest(body, {
                  model: scenario.native,
                  maxTokens: body.max_output_tokens,
                  effort: body.reasoning.effort,
                }),
              )
              events = decodeAnthropicStream(parseSse(source), { model: scenario.native })
              break
            }
            case 'gemini': {
              nativeRequests.push(encodeGeminiRequest(body, scenario.native))
              events = decodeGeminiStream(source, scenario.native)
              break
            }
            case 'chat': {
              nativeRequests.push(encodeChatRequest(body, scenario.native, chat))
              const frames = await Array.fromAsync(parseSse(source))
              events = decodeChatStream(
                frames
                  .filter((frame) => frame.data !== '[DONE]')
                  .map((frame): unknown => JSON.parse(frame.data)),
                scenario.native,
                chat,
                {
                  frameBytes: 64 * 1024,
                  streamBytes: 1024 * 1024,
                  argumentBytes: 64 * 1024,
                  outputItems: 128,
                },
              ).events
              break
            }
            case 'ollama': {
              nativeRequests.push(
                encodeOllamaRequest(body, { model: scenario.native, numCtx: 4096 }),
              )
              events = decodeOllamaStream(source, {
                model: scenario.native,
                status: 200,
                responseId: `request-${String(attempt)}`,
              })
              break
            }
            default: {
              throw new Error('Unknown format')
            }
          }
          yield* events
        },
      }
      const meta = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const io = memoryToolIo({ 'notes.md': 'workspace evidence from read_file' }, '/ws')
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({
          client: fakeModelApiClient(meta, log),
          workspaceRoot: '/ws',
          io,
          log,
        }),
        models: createProviderRegistry({
          models: () =>
            Promise.resolve([
              {
                ref,
                origin: 'https://fixture.example.test',
                pricing: { kind: 'local' },
                evidence: { capabilities: { toolCalling: true }, maxOutputTokens: 256 },
              },
            ]),
          createClient: () => Promise.resolve(client),
          isCurrent: () => true,
        }),
      })
      try {
        const session = await host.startSession({
          workspaceRoot: '/ws',
          modelId: ref,
          approvalMode: 'allowAll',
        })
        const watched = watchSessionTurns(session)
        await session.sendTurn([{ type: 'text', text: 'Read notes.md' }])
        await watched.turnDone()
        expect(nativeRequests, JSON.stringify(watched.events)).toHaveLength(2)
        expect(JSON.stringify(nativeRequests[0])).toContain(scenario.native)
        expect(JSON.stringify(nativeRequests[0])).not.toContain(`"model":"${ref}"`)
        expect(JSON.stringify(nativeRequests[1])).toContain('workspace evidence from read_file')
        expect(meta.responseBodies()).toHaveLength(0)
        expect(watched.events).toContainEqual(expect.objectContaining({ type: 'turnCompleted' }))
      } finally {
        await host.close()
      }
    })
  }
})
