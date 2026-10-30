import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS } from '../../src/shared/constants'
import {
  createTabEngine,
  type TabEngine,
  type TabEngineRequest,
  type TabStream,
} from '../../src/core/tab/tabEngine'

// The engine's send paths (M94 acceptance 7): what a cancelled trigger,
// a failed transport, an empty answer and a mid-flight cancellation do.
// The streams below stub the transport's shape only — empty answers and
// thrown failures — and invent no provider content: every assertion is
// about the engine's own settlement (sent or not, usage or none).

async function* emptyStream(): AsyncGenerator<StreamEvent> {
  await Promise.resolve()
  yield* []
}

const throwingStream: TabStream = () => {
  throw new Error('socket failed')
}

const silentStream: TabStream = () => emptyStream()

// The transport's shape only: a stream that yields nothing and ends when
// aborted, as the key client does on its signal.
const hungStream: TabStream = (_body, signal) => {
  const hung = (async function* (): AsyncGenerator<StreamEvent> {
    await new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new Error('The hung stream ended on abort'))
        },
        { once: true },
      )
    })
    yield* []
  })()
  return hung
}

function requestOf(isCancelled: () => boolean): TabEngineRequest {
  return {
    model: 'muse-spark-1.3',
    absolutePath: '/workspace/src/example.ts',
    relativePath: 'src/example.ts',
    languageId: 'typescript',
    prefix: 'export function add(a: number, b: number) {\n  return ',
    suffix: '\n}\n',
    snippets: '',
    mode: 'fast',
    maxOutputTokens: MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    isInvoke: true,
    cursorLineBefore: '  return ',
    lineAbove: 'export function add(a: number, b: number) {',
    linesBelow: ['}', ''],
    isCancelled,
  }
}

function engineOf(stream: TabStream, requestTimeoutMs?: number): TabEngine {
  return createTabEngine({
    stream,
    onSent: () => undefined,
    onUsage: () => undefined,
    ...(requestTimeoutMs !== undefined && { requestTimeoutMs }),
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createTabEngine send paths (M94 acceptance 7)', () => {
  it('sends nothing for a trigger cancelled before the send', async () => {
    let streamCalls = 0
    const stream: TabStream = () => {
      streamCalls += 1
      return emptyStream()
    }
    const answer = await engineOf(stream).complete(requestOf(() => true))
    expect(streamCalls).toBe(0)
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).resolves.toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    })
  })

  it('settles at zero when the gate refuses at the send (nothing POSTed)', async () => {
    let streamCalls = 0
    let isCancelled = false
    const stream: TabStream = (_body, _signal, _budget, admit) => {
      streamCalls += 1
      // The TabStream contract: the client runs the guard last,
      // synchronously, before the HTTP send. The keystroke lands after
      // the scheduler flushed but before that guard runs.
      isCancelled = true
      admit.check?.()
      return emptyStream()
    }
    const answer = await engineOf(stream).complete(requestOf(() => isCancelled))
    expect(streamCalls).toBe(1)
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).resolves.toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    })
  })

  it('fails the trigger when the transport fails', async () => {
    await expect(engineOf(throwingStream).complete(requestOf(() => false))).rejects.toThrow(
      'socket failed',
    )
  })

  it('rejects the usage when a sent request reports none (its reservation stands)', async () => {
    const answer = await engineOf(silentStream).complete(requestOf(() => false))
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).rejects.toThrow('reported no usage')
  })

  it('runs a sent request to its end past a mid-flight cancellation (never aborts)', async () => {
    let isCancelled = false
    const stream: TabStream = () => {
      const slow = (async function* (): AsyncGenerator<StreamEvent> {
        await sleep(200)
        yield* []
      })()
      return slow
    }
    const engine = engineOf(stream)
    const answered = engine.complete(requestOf(() => isCancelled))
    await sleep(50)
    isCancelled = true
    const answer = await answered
    // The stream ran to its end instead of aborting: no suggestion, and
    // the usage rejects for want of usage rather than failing abandoned.
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).rejects.toThrow('reported no usage')
  })

  it('ends a hung request at the backstop with words (safety limit, RLF-SAFELIMITS)', async () => {
    // The engine's own settlement — the trigger fails with words — is
    // the assertion. Unbounded code would wait here past the suite's own
    // timeout; the backstop fails the trigger after 200 ms with its words.
    await expect(engineOf(hungStream, 200).complete(requestOf(() => false))).rejects.toThrow(
      'timed out waiting for the provider',
    )
  })
})
