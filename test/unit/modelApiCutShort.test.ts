// M101 item 8: mutations of counted M95 captures exercise each codec and
// the real host. No provider calls; stop reasons are deliberate fault input.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import { decodeAnthropicStream } from '../../src/core/backends/modelapi/codecs/anthropic'
import { decodeGeminiStream } from '../../src/core/backends/modelapi/codecs/gemini'
import { decodeChatStream } from '../../src/core/backends/modelapi/codecs/chat'
import { decodeOllamaStream } from '../../src/core/backends/modelapi/codecs/ollama'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { isFunctionCallItem, type StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const captureSchema = z.object({
  response: z.object({
    events: z.array(z.object({ event: z.optional(z.string()), data: z.unknown() })),
  }),
})
function capture(provider: string, file: string) {
  return captureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../docs/certification/m95-captures/${provider}/${file}.json`, import.meta.url),
        'utf8',
      ),
    ),
  ).response.events
}
async function* bytes(text: string) {
  await Promise.resolve()
  yield new TextEncoder().encode(text)
}

async function cutShort(codec: string): Promise<readonly StreamEvent[]> {
  if (codec === 'ollama') {
    const receipt = z
      .object({ response: z.object({ body: z.string() }) })
      .parse(
        JSON.parse(
          readFileSync(
            new URL(
              '../../docs/certification/m95-captures/ollama/04-two-tool-stream.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      )
    return await Array.fromAsync(
      decodeOllamaStream(
        bytes(receipt.response.body.replace('"done_reason":"stop"', '"done_reason":"length"')),
        { model: 'qwen3:4b-instruct-2507-q4_K_M', status: 200, responseId: 'test-turn' },
      ),
    )
  }
  let provider = codec
  if (codec === 'responses') provider = 'openai'
  else if (codec === 'chat') provider = 'groq'
  const file = codec === 'anthropic' ? '03-tool-call-stream' : '02-tool-call-stream'
  const frames = capture(provider, file)
  if (codec === 'anthropic') {
    return await Array.fromAsync(
      decodeAnthropicStream(
        frames.map((frame) => ({
          event: frame.event ?? 'message',
          data: JSON.stringify(frame.data).replace(
            '"stop_reason":"tool_use"',
            '"stop_reason":"max_tokens"',
          ),
        })),
        { model: 'test' },
      ),
    )
  }
  if (codec === 'chat') {
    const payloads = frames.map((frame) => {
      const parsed: unknown = JSON.parse(
        JSON.stringify(frame.data).replace(
          '"finish_reason":"tool_calls"',
          '"finish_reason":"length"',
        ),
      )
      return parsed
    })
    return decodeChatStream(
      payloads,
      'test',
      {
        presetId: 'groq',
        outputCap: 'max_completion_tokens',
        reasoningParam: 'effort-flat',
        sendCacheKey: false,
        includeUsage: true,
        toolStream: false,
        toolResultName: false,
        replayField: 'none',
      },
      { frameBytes: 65_536, streamBytes: 1_048_576, argumentBytes: 65_536, outputItems: 128 },
    ).events
  }
  const stream = frames
    .map((frame) => {
      let data = JSON.stringify(frame.data)
      let event = frame.event ?? 'message'
      if (codec === 'gemini')
        data = data.replace('"finishReason":"STOP"', '"finishReason":"MAX_TOKENS"')
      else if (event === 'response.completed') {
        event = 'response.incomplete'
        data = data
          .replace('"type":"response.completed"', '"type":"response.incomplete"')
          .replace('"status":"completed"', '"status":"incomplete"')
      }
      return `event: ${event}\ndata: ${data}\n\n`
    })
    .join('')
  return codec === 'gemini'
    ? await Array.fromAsync(decodeGeminiStream(bytes(stream), 'test'))
    : await Array.fromAsync(
        createResponsesCodec({
          sendPromptCacheRetention: true,
          sendPromptCacheKey: true,
        }).decodeStream(bytes(stream)),
      )
}

describe('cut-short codec replies never execute tools', () => {
  it.each(['responses', 'chat', 'anthropic', 'gemini', 'ollama'])(
    '%s refuses even completed writes with visible failure and valid replay',
    async (codec) => {
      const decoded = await cutShort(codec)
      const final = decoded.at(-1)
      expect(final?.type).toBe('response.incomplete')
      if (final?.type !== 'response.incomplete') throw new Error('expected incomplete response')
      const calls = final.response.output.filter(isFunctionCallItem)
      expect(calls.length).toBeGreaterThan(0)
      // A valid completed write inside the incomplete envelope is the P1 case.
      const response = {
        ...final.response,
        output: calls.map((call) => ({
          ...call,
          name: 'write_file',
          status: 'completed',
          arguments: '{"path":"new.txt","content":"must not write"}',
        })),
      }
      const api = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const client = fakeModelApiClient(api, log)
      const io = memoryToolIo({}, '/ws')
      const host = new ModelApiHost(fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io, log }))
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      const watched = watchSessionTurns(session)
      vi.spyOn(client, 'streamResponse').mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield { type: 'response.incomplete', response }
      })
      await session.sendTurn([{ type: 'text', text: 'write it' }])
      await watched.turnDone()
      expect(io.files.size).toBe(0)
      expect(watched.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
        reason: UI_TEXT.incompleteToolCallsNotRun,
      })
      const rows = watched.events.filter(
        (event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall',
      )
      expect(rows).toHaveLength(calls.length)
      for (const row of rows)
        expect(row).toMatchObject({
          item: { status: 'failed', failureReason: UI_TEXT.incompleteToolCallsNotRun },
        })
      api.script({ text: 'retry acknowledged' })
      await session.sendTurn([{ type: 'text', text: 'continue' }])
      await watched.turnDone()
      const input = api.responseBodies()[0]?.['input']
      for (const call of calls)
        expect(input).toContainEqual({
          type: 'function_call_output',
          call_id: call.call_id,
          output: `Error: ${MODEL_API_MODEL_TEXT.incompleteCallNotRun}`,
        })
      session.dispose()
      await host.close()
    },
  )
})
