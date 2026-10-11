// M95 Responses stream shapes with synthetic cap mutations. No successful
// ChatGPT tool-call capture or model-tokenizer implementation is claimed here.
import { describe, expect, it, vi } from 'vitest'
import {
  createResponsesCodec,
  ResponsesDecodeError,
  ResponsesOutputCapError,
  type ResponsesDecodeSink,
  type ResponsesOutputCap,
} from '../../src/core/backends/modelapi/codecs/responses'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const codec = createResponsesCodec({ profile: 'chatgpt', toolNamespace: 'functions' })
const encoder = new TextEncoder()

async function* chunks(
  events: readonly unknown[],
  close: () => void | Promise<void> = () => undefined,
) {
  try {
    for (const event of events) {
      yield encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    }
  } finally {
    await close()
  }
}

function delta(text: string, type = 'response.output_text.delta') {
  return { type, item_id: 'item_1', delta: text }
}

function cap(maxOutputTokens = 2) {
  let count = 0
  const controller = new AbortController()
  const abort = vi.fn(() => {
    controller.abort()
  })
  const outputCap: ResponsesOutputCap = {
    maxOutputTokens,
    // One character represents one token in these injected-counter tests.
    countOutputTokens(event) {
      if ('delta' in event) count += event.delta.length
      return count
    },
    abort,
  }
  return { outputCap, controller, abort }
}

describe('chatgpt Responses client-side output cap', () => {
  it.each([
    'response.output_text.delta',
    'response.function_call_arguments.delta',
    'response.reasoning_summary_text.delta',
  ])('aborts before yielding an over-cap %s and closes the source', async (type) => {
    const control = cap()
    const closed = vi.fn()
    const iterator = codec.decodeStream(
      chunks([delta('ab', type), delta('c', type)], closed),
      control,
    )
    const admitted = await iterator.next()
    expect(admitted.value).toMatchObject({ type, delta: 'ab' })
    expect(control.abort).not.toHaveBeenCalled()
    await expect(iterator.next()).rejects.toMatchObject({
      name: 'ResponsesOutputCapError',
      maxOutputTokens: 2,
      outputTokens: 3,
    })
    expect(control.abort).toHaveBeenCalledTimes(1)
    expect(control.controller.signal.aborted).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(await iterator.next()).toMatchObject({ done: true })
  })

  it('allows exactly the cap without aborting', async () => {
    const control = cap()
    const events = await Array.fromAsync(
      codec.decodeStream(chunks([delta('a'), delta('b')]), control),
    )
    expect(events).toHaveLength(2)
    expect(control.controller.signal.aborted).toBe(false)
    expect(control.abort).not.toHaveBeenCalled()
  })

  it('uses reported output usage to bound invisible reasoning before yielding completion', async () => {
    const control = cap()
    await expect(
      Array.fromAsync(
        codec.decodeStream(
          chunks([
            {
              type: 'response.completed',
              response: {
                id: 'resp_1',
                status: 'completed',
                output: [],
                usage: {
                  input_tokens: 1,
                  output_tokens: 3,
                  output_tokens_details: { reasoning_tokens: 3 },
                },
              },
            },
          ]),
          control,
        ),
      ),
    ).rejects.toMatchObject({ name: 'ResponsesOutputCapError', outputTokens: 3 })
    expect(control.abort).toHaveBeenCalledTimes(1)
  })

  it.each(['response.completed', 'response.incomplete', 'response.failed'])(
    'settles reported usage from an over-cap %s through ModelApiHost without excess replay',
    async (type) => {
      const control = cap()
      const closed = vi.fn()
      const log = new FakeLogOutputChannel()
      const client = fakeModelApiClient(fakeModelApi(), log)
      const usage = {
        input_tokens: 5,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 3,
        output_tokens_details: { reasoning_tokens: 1 },
      }
      const capErrors: ResponsesOutputCapError[] = []
      // The transport/host adapter settles a typed cap error as an ordinary
      // canonical failure. Its output is empty: no rejected item is replayed.
      vi.spyOn(client, 'streamResponse').mockImplementation(async function* () {
        try {
          yield* codec.decodeStream(
            chunks(
              [
                delta('ab'),
                {
                  type,
                  response: {
                    id: 'resp_1',
                    status: type.slice('response.'.length),
                    output: [
                      {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'excess output' }],
                      },
                      {
                        type: 'function_call',
                        call_id: 'call_excess',
                        name: 'write_file',
                        arguments: '{"path":"excess.txt","content":"excess output"}',
                      },
                    ],
                    usage,
                  },
                },
              ],
              closed,
            ),
            control,
          )
        } catch (error: unknown) {
          if (!(error instanceof ResponsesOutputCapError) || error.usage === undefined) {
            throw error
          }
          capErrors.push(error)
          yield {
            type: 'response.failed',
            response: {
              id: 'resp_1',
              status: 'failed',
              output: [],
              usage: error.usage,
              error: { code: error.name, message: error.message },
            },
          }
        }
      })
      const io = memoryToolIo({}, '/ws')
      const noteResponseUsage = vi.fn()
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io, log }),
        noteResponseUsage,
      })
      try {
        const session = await host.startSession({
          workspaceRoot: '/ws',
          modelId: 'muse-spark-1.3',
          approvalMode: 'promptUnmatched',
        })
        if (!(session instanceof ModelApiSession)) throw new Error('Missing ModelApiSession')
        const { events, turnDone } = watchSessionTurns(session)
        const done = turnDone()
        await session.sendTurn([{ type: 'text', text: 'Reply briefly.' }])
        await done
        expect(events.filter((event) => event.type === 'tokenUsage')).toEqual([
          expect.objectContaining({
            inputTokens: 5,
            cachedTokens: 2,
            outputTokens: 3,
            reasoningTokens: 1,
          }),
        ])
        expect(noteResponseUsage).toHaveBeenCalledExactlyOnceWith(session.modelId, {
          inputTokens: 5,
          cachedTokens: 2,
          outputTokens: 3,
        })
        expect(capErrors).toHaveLength(1)
        expect(capErrors[0]?.usage).toEqual(usage)
        expect(session.snapshot().replay).toHaveLength(1)
        expect(session.snapshot().replay[0]?.item).toMatchObject({ role: 'user' })
        expect(events.filter((event) => event.type === 'textDelta')).toEqual([
          expect.objectContaining({ delta: 'ab' }),
        ])
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'turnCompleted', terminal: 'failed' }),
        )
        expect(io.files.has('/ws/excess.txt')).toBe(false)
        expect(control.abort).toHaveBeenCalledTimes(1)
        expect(closed).toHaveBeenCalledTimes(1)
      } finally {
        await host.close()
      }
    },
  )

  it('checks a final item without deltas through the host counter', async () => {
    const control = cap()
    const sink: ResponsesDecodeSink = {
      outputCap: { ...control.outputCap, countOutputTokens: () => 3 },
    }
    await expect(
      Array.fromAsync(
        codec.decodeStream(
          chunks([
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'abc' }],
              },
            },
          ]),
          sink,
        ),
      ),
    ).rejects.toMatchObject({ name: 'ResponsesOutputCapError', outputTokens: 3 })
    expect(control.abort).toHaveBeenCalledTimes(1)
  })

  it('requires a host cap rather than silently allowing an unbounded reply', async () => {
    await expect(Array.fromAsync(codec.decodeStream(chunks([delta('abc')])))).rejects.toThrow(
      ResponsesDecodeError,
    )
  })

  it.each([0, -1, NaN, Infinity, 1.5])(
    'refuses an invalid host cap (%s)',
    async (maxOutputTokens) => {
      await expect(
        Array.fromAsync(codec.decodeStream(chunks([delta('a')]), cap(maxOutputTokens))),
      ).rejects.toThrow(ResponsesDecodeError)
    },
  )

  it.each([-1, NaN, Infinity, 1.5])('refuses an invalid counter result (%s)', async (count) => {
    const control = cap()
    const sink: ResponsesDecodeSink = {
      outputCap: { ...control.outputCap, countOutputTokens: () => count },
    }
    await expect(Array.fromAsync(codec.decodeStream(chunks([delta('a')]), sink))).rejects.toThrow(
      ResponsesDecodeError,
    )
  })

  it('applies the cap independently to concurrent decodes of the same pure codec', async () => {
    const first = cap(1)
    const second = cap(2)
    const firstStream = codec.decodeStream(chunks([delta('a'), delta('b')]), first)
    const secondStream = codec.decodeStream(chunks([delta('a'), delta('b')]), second)
    await firstStream.next()
    await secondStream.next()
    await expect(firstStream.next()).rejects.toMatchObject({ name: 'ResponsesOutputCapError' })
    const admitted = await secondStream.next()
    expect(admitted.value).toMatchObject({ delta: 'b' })
    expect(second.abort).not.toHaveBeenCalled()
    await secondStream.return(undefined)
  })

  it('does not enforce the ChatGPT cap on an API-key profile', async () => {
    const api = createResponsesCodec({ sendPromptCacheKey: true, sendPromptCacheRetention: true })
    const control = cap(1)
    expect(await Array.fromAsync(api.decodeStream(chunks([delta('abc')]), control))).toHaveLength(1)
    expect(control.abort).not.toHaveBeenCalled()
  })

  it('passes each validated event once to the counter, preserving event identity', async () => {
    const seen: StreamEvent[] = []
    const control = cap()
    const outputCap: ResponsesOutputCap = {
      ...control.outputCap,
      countOutputTokens: (event) => {
        seen.push(event)
        return 0
      },
    }
    const events = await Array.fromAsync(
      codec.decodeStream(chunks([delta('a'), delta('b')]), { outputCap }),
    )
    expect(seen).toEqual(events)
    expect(seen[0]).toBe(events[0])
    expect(seen[1]).toBe(events[1])
  })
})
