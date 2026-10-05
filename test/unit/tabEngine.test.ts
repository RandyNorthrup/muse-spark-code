// Tab's engine (M94, PLAN.md D73; the integration of lanes C and H): the
// cache answers without a request, the scheduler debounces and replaces
// waiting triggers, the suggestion is published at the closing tag while
// the request runs on for its usage, and a request gets one HTTP attempt.

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RetryBudget } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import {
  createTabEngine,
  type TabEngineRequest,
  type TabEngineUsage,
  type TabStream,
} from '../../src/core/tab/tabEngine'
import {
  MODEL_API_MAX_RETRIES,
  TAB_DEBOUNCE_MS,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
} from '../../src/shared/constants'

const MODEL = 'muse-spark-1.3'
const USAGE: TabEngineUsage = { inputTokens: 120, cachedTokens: 64, outputTokens: 9 }
const ZERO: TabEngineUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }

function request(overrides: Partial<TabEngineRequest> = {}): TabEngineRequest {
  return {
    model: MODEL,
    absolutePath: '/ws/file.ts',
    relativePath: 'file.ts',
    languageId: 'typescript',
    prefix: 'const y = ',
    suffix: '',
    snippets: '',
    mode: 'fast',
    isInvoke: true,
    cursorLineBefore: 'const y = ',
    lineAbove: '',
    linesBelow: [],
    isCancelled: () => false,
    ...overrides,
  }
}

function delta(text: string): StreamEvent {
  return { type: 'response.output_text.delta', item_id: 'item', delta: text }
}

function completed(usage: TabEngineUsage | undefined): StreamEvent {
  return {
    type: 'response.completed',
    response: {
      id: 'response',
      status: 'completed',
      output: [],
      usage:
        usage === undefined
          ? undefined
          : {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              input_tokens_details: { cached_tokens: usage.cachedTokens },
            },
    },
  }
}

interface StreamCall {
  readonly body: CreateResponseBody
  readonly budget: RetryBudget
}

/** A stream whose events after `holdAfter` wait until `release` is called. */
function scriptedStream(
  events: readonly StreamEvent[],
  holdAfter = events.length,
): { stream: TabStream; calls: StreamCall[]; release: () => void } {
  const calls: StreamCall[] = []
  const held = Promise.withResolvers<undefined>()
  const release = (): void => {
    held.resolve(undefined)
  }
  const stream: TabStream = (body, _signal, budget) => {
    calls.push({ body, budget: { ...budget } })
    return (async function* replay(): AsyncGenerator<StreamEvent> {
      for (const [index, event] of events.entries()) {
        if (index === holdAfter) {
          await held.promise
        }
        yield event
      }
    })()
  }
  return { stream, calls, release }
}

/** A stream that sends part of a reply and then fails, with no usage. */
const failingStream: TabStream = () =>
  (async function* failing(): AsyncGenerator<StreamEvent> {
    yield delta('partial')
    await Promise.resolve()
    throw new Error('network down')
  })()

afterEach(() => {
  vi.useRealTimers()
})

describe('createTabEngine', () => {
  it('publishes at the closing tag while the request runs on for its usage', async () => {
    const script = scriptedStream(
      [delta(`${TAB_REPLY_OPEN_TAG}foo`), delta(`()${TAB_REPLY_CLOSE_TAG}`), completed(USAGE)],
      2,
    )
    const onSent = vi.fn()
    const onUsage = vi.fn()
    const engine = createTabEngine({ stream: script.stream, onSent, onUsage })
    const answer = await engine.complete(request())
    expect(answer.completion).toBe('foo()')
    // The usage frame is still held: the suggestion did not wait for it.
    expect(onUsage).not.toHaveBeenCalled()
    script.release()
    await expect(answer.usage).resolves.toEqual(USAGE)
    expect(onSent).toHaveBeenCalledExactlyOnceWith(MODEL)
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(MODEL, USAGE)
  })

  it('gives each request one HTTP attempt, through its own cache key', async () => {
    const script = scriptedStream([
      delta(`${TAB_REPLY_OPEN_TAG}foo()${TAB_REPLY_CLOSE_TAG}`),
      completed(USAGE),
    ])
    const engine = createTabEngine({ stream: script.stream, onSent: vi.fn(), onUsage: vi.fn() })
    const answer = await engine.complete(request())
    await answer.usage
    expect(script.calls).toHaveLength(1)
    expect(script.calls[0]?.budget.retriesUsed).toBe(MODEL_API_MAX_RETRIES)
    expect(script.calls[0]?.body.store).toBe(false)
    expect(script.calls[0]?.body.tools).toEqual([])
  })

  it('carries the ordered context snippets into the request', async () => {
    const script = scriptedStream([completed(USAGE)])
    const engine = createTabEngine({ stream: script.stream, onSent: vi.fn(), onUsage: vi.fn() })
    const answer = await engine.complete(
      request({ mode: 'multiline', snippets: '```helper.ts\nexport const helper = 1\n```' }),
    )
    await answer.usage
    expect(JSON.stringify(script.calls[0]?.body.input)).toContain('export const helper = 1')
  })

  it('serves typing through from the cache, with no request and zero usage', async () => {
    const script = scriptedStream([
      delta(`${TAB_REPLY_OPEN_TAG}foo(bar)${TAB_REPLY_CLOSE_TAG}`),
      completed(USAGE),
    ])
    const onSent = vi.fn()
    const engine = createTabEngine({ stream: script.stream, onSent, onUsage: vi.fn() })
    const first = await engine.complete(request())
    await first.usage
    const typed = await engine.complete(
      request({ prefix: 'const y = foo', cursorLineBefore: 'const y = foo' }),
    )
    expect(typed.completion).toBe('(bar)')
    await expect(typed.usage).resolves.toEqual(ZERO)
    expect(onSent).toHaveBeenCalledOnce()
    expect(script.calls).toHaveLength(1)
  })

  it('answers a replaced waiting trigger with nothing, and sends only the newer one', async () => {
    vi.useFakeTimers()
    const script = scriptedStream([
      delta(`${TAB_REPLY_OPEN_TAG}x${TAB_REPLY_CLOSE_TAG}`),
      completed(USAGE),
    ])
    const engine = createTabEngine({ stream: script.stream, onSent: vi.fn(), onUsage: vi.fn() })
    const first = engine.complete(request({ isInvoke: false }))
    const second = engine.complete(
      request({ isInvoke: false, prefix: 'const y = 1', cursorLineBefore: 'const y = 1' }),
    )
    const replaced = await first
    expect(replaced.completion).toBeUndefined()
    await expect(replaced.usage).resolves.toEqual(ZERO)
    expect(script.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(TAB_DEBOUNCE_MS)
    const sent = await second
    await sent.usage
    expect(script.calls).toHaveLength(1)
  })

  it('sends nothing for a trigger cancelled while it waited out the debounce', async () => {
    vi.useFakeTimers()
    const script = scriptedStream([completed(USAGE)])
    const onSent = vi.fn()
    const engine = createTabEngine({ stream: script.stream, onSent, onUsage: vi.fn() })
    let isCancelled = false
    const pending = engine.complete(request({ isInvoke: false, isCancelled: () => isCancelled }))
    isCancelled = true
    await vi.advanceTimersByTimeAsync(TAB_DEBOUNCE_MS)
    const answer = await pending
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).resolves.toEqual(ZERO)
    expect(onSent).not.toHaveBeenCalled()
    expect(script.calls).toHaveLength(0)
  })

  it('settles the usage of an untagged reply, which suggests nothing', async () => {
    const script = scriptedStream([delta('Sure, here is the code: foo()'), completed(USAGE)])
    const engine = createTabEngine({ stream: script.stream, onSent: vi.fn(), onUsage: vi.fn() })
    const answer = await engine.complete(request())
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).resolves.toEqual(USAGE)
  })

  it('rejects the usage of a published request that never reported any', async () => {
    const script = scriptedStream([delta(`${TAB_REPLY_OPEN_TAG}foo()${TAB_REPLY_CLOSE_TAG}`)])
    const onUsage = vi.fn()
    const engine = createTabEngine({ stream: script.stream, onSent: vi.fn(), onUsage })
    const answer = await engine.complete(request())
    expect(answer.completion).toBe('foo()')
    await expect(answer.usage).rejects.toThrow('no usage')
    expect(onUsage).not.toHaveBeenCalled()
  })

  it('fails the trigger when the stream fails before any tag or usage', async () => {
    const engine = createTabEngine({ stream: failingStream, onSent: vi.fn(), onUsage: vi.fn() })
    await expect(engine.complete(request())).rejects.toThrow('network down')
  })
})
