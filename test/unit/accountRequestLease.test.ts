import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { activeAccountBilling } from '../../src/core/accounts/requestWriter'
import type { ProviderClient, ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import type { FakeModelApi } from './helpers/fakeModelApi'
import { POOL_NOW, poolRequest } from './helpers/accounts/pool'
import { paidHelperBody, writerRig } from './helpers/accounts/writer'
import { formatDateTime } from '../../src/shared/l10n/text'

const ORIGIN = 'https://provider.invalid'
const MODEL = 'muse-spark-1.3'

const rigs: { liveLeases: () => number }[] = []
function rig(configure?: (api: FakeModelApi) => void) {
  const t = writerRig(ORIGIN, configure)
  rigs.push(t)
  return t
}

// A lease leaked anywhere in this suite fails here: every rig must hold
// nothing after every test.
afterEach(() => {
  // Splice first: a failing assertion must not carry its rigs into the next test.
  const pending = rigs.splice(0)
  for (const t of pending) expect(t.liveLeases()).toBe(0)
})

const REVIEW_PAID = {
  feature: 'autoReviewer',
  modelId: MODEL,
  tool: 'ask',
  action: 'review',
} as const

function reviewerClient(t: ReturnType<typeof rig>, owner: string) {
  return t.writer.paidClient(
    t.client,
    poolRequest({ owner, modelId: MODEL }),
    ORIGIN,
    { ...REVIEW_PAID },
    false,
    () => Promise.resolve(true),
  )
}

function collectStream(wrapped: ProviderClient) {
  return Array.fromAsync(
    wrapped.streamResponse(
      paidHelperBody(),
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
    ),
  )
}

function generateImage(wrapped: ProviderClient, prompt: string) {
  return wrapped.createImage(
    {
      model: 'muse-image-1.0',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
      output_format: 'png',
    },
    new AbortController().signal,
  )
}

describe('one lease owns its paid request', () => {
  it('ranks the second worker after the first reservation instead of joining it', async () => {
    const t = rig()
    t.deps.headroom = (account) => {
      const outstanding = t.claims.filter(
        (claim) => claim.account === account.id && claim.actual === undefined,
      ).length
      return 10n - BigInt(outstanding)
    }
    const [first, second] = await Promise.all([
      t.pool.acquire(poolRequest({ kind: 'worker', owner: 'w1' })),
      t.pool.acquire(poolRequest({ kind: 'worker', owner: 'w2' })),
    ])
    expect([first.account, second.account]).toEqual(['a', 'b'])
    await first.settle(null)
    await second.settle(null)
  })

  it.each(['incomplete', 'failed'] as const)(
    'settles known cost from a paid-helper %s with usage',
    async (terminal) => {
      const t = rig((api) => {
        api.script(
          terminal === 'incomplete'
            ? { text: 'partial', incomplete: { reason: 'max_output_tokens' } }
            : {
                text: 'partial',
                failed: { code: 'x', message: 'boom' },
                usage: { input: 10, output: 2 },
              },
        )
      })
      const wrapped = reviewerClient(t, `term-${terminal}`)
      const events = await collectStream(wrapped)
      expect(events.at(-1)?.type).toBe(
        terminal === 'incomplete' ? 'response.incomplete' : 'response.failed',
      )
      expect(t.claims[0]?.actual).not.toBeNull()
    },
  )

  it('releases the inner generator when the paid-helper consumer throws mid-stream', async () => {
    const t = rig()
    let isCleanedUp = false
    const digest = createHash('sha256').update('fake-only-a').digest('hex')
    const stubClient = {
      // Transport-faithful: the fence runs before the first event, so the
      // lease has sent when the consumer throws.
      streamResponse: async function* (
        _body: CreateResponseBody,
        _signal: AbortSignal,
        _onRetry: unknown,
        _budget: unknown,
        admit: ResponseAttemptGuard | undefined,
      ): AsyncGenerator<StreamEvent> {
        try {
          await Promise.resolve()
          admit?.(digest)
          admit?.beforeRequestStarted?.()
          yield { type: 'response.output_text.delta', item_id: 'x', delta: 'hi' }
          yield { type: 'response.output_text.delta', item_id: 'x', delta: 'there' }
        } finally {
          isCleanedUp = true
        }
      },
      countInputTokens: () => Promise.resolve(1),
      listModels: () => Promise.resolve([MODEL]),
      currentKeyDigest: () => Promise.resolve(digest),
      retryDelayMs: () => 0,
      waitBeforeRetry: () => Promise.resolve(),
    }
    t.createClient.mockImplementationOnce(() =>
      Promise.resolve(
        stubClient as unknown as ProviderClient & { readonly paidClient?: ProviderClient },
      ),
    )
    const wrapped = reviewerClient(t, 'release-main')
    const stream = wrapped.streamResponse(
      paidHelperBody(),
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
    )
    await expect(
      (async () => {
        for await (const event of stream) {
          expect(event.type).toBe('response.output_text.delta')
          throw new Error('consumer blew up')
        }
      })(),
    ).rejects.toThrow('consumer blew up')
    expect(isCleanedUp).toBe(true)
    expect(t.claims[0]?.actual).toBeNull()
  })

  it('forwards a paid-helper 429 to the lease rate limit with its reset time', async () => {
    const t = rig((api) => {
      api.script(
        { httpError: { status: 429, retryAfter: '1' } },
        { text: 'recovered', usage: { input: 10, output: 2 } },
      )
    })
    const wrapped = reviewerClient(t, 'rate-main')
    const events = await collectStream(wrapped)
    expect(events.at(-1)?.type).toBe('response.completed')
    expect(t.rateLimit).toHaveBeenCalledOnce()
    expect(t.rateLimit.mock.calls[0]?.slice(0, 2)).toEqual([
      'a',
      new Date(Date.parse('2026-10-06T12:00:00Z') + 1000).toISOString(),
    ])
    expect(t.claims[0]?.actual).not.toBeNull()
  })

  it('retries an image 429 as a new send on the same lease', async () => {
    const t = rig((api) => {
      api.images.push({ httpError: { status: 429, message: 'slow down' } }, { count: 2 })
    })
    const api = t.api
    const wrapped = t.writer.paidClient(
      t.client,
      poolRequest({ owner: 'image-main', modelId: MODEL }),
      ORIGIN,
      {
        feature: 'imageGeneration',
        kind: 'generate',
        path: 'fixture.png',
        sources: [],
        prompt: 'x',
      },
      false,
      () => Promise.resolve(true),
    )
    const result = await generateImage(wrapped, 'a lease test')
    expect(result.data).toHaveLength(2)
    expect(api.imageBodies()).toHaveLength(2)
    expect(t.claims).toHaveLength(1)
    expect(t.claims[0]?.actual).not.toBeNull()
  })

  it('asks image spending consent once, inside the lease under its payer', async () => {
    const t = rig()
    const seen: (string | undefined)[] = []
    const wrapped = t.writer.paidClient(
      t.client,
      poolRequest({ owner: 'image-consent', modelId: MODEL }),
      ORIGIN,
      {
        feature: 'imageGeneration',
        kind: 'generate',
        path: 'fixture.png',
        sources: [],
        prompt: 'x',
      },
      true,
      () => {
        seen.push(activeAccountBilling()?.account)
        return Promise.resolve(true)
      },
    )
    await generateImage(wrapped, 'a consent test')
    expect(seen).toEqual(['a'])
  })

  it('names the retry payer in a stop message while another account is queued', async () => {
    const t = rig()
    const holder = await t.writer.acquire(poolRequest({ owner: 'main', modelId: MODEL }), ORIGIN)
    t.pool.useNext('conversation', 'main', 'b', () => true)
    await holder.settle(null)
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    await expect(
      t.writer.acquire(poolRequest({ owner: 'main', retryAccount: 'a', modelId: MODEL }), ORIGIN),
    ).rejects.toThrow(/· a has no room/)
  })

  it("names the earliest recovery across every limited account, not the payer's own", async () => {
    const t = rig()
    const later = new Date(POOL_NOW + 3_600_000).toISOString()
    const earlier = new Date(POOL_NOW + 60_000).toISOString()
    const middle = new Date(POOL_NOW + 1_800_000).toISOString()
    t.blocks.set('a', { blocked: { reason: 'rateLimited', resetAt: later } })
    t.blocks.set('b', { blocked: { reason: 'rateLimited', resetAt: earlier } })
    t.blocks.set('c', { blocked: { reason: 'rateLimited', resetAt: middle } })
    let message = ''
    try {
      await t.writer.acquire(poolRequest({ owner: 'main', modelId: MODEL }), ORIGIN)
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error)
    }
    // The stop names the payer but B's earlier reset: the sentence below
    // fails with the payer's own later reset in it.
    expect(message).toContain(formatDateTime(Date.parse(earlier)))
    expect(message).not.toContain(formatDateTime(Date.parse(later)))
  })

  it('holds exactly one lease per paid-helper send, stream or image', async () => {
    const t = rig((api) => {
      api.script({ text: 'reviewed', usage: { input: 10, output: 2 } })
      api.images.push({ count: 1 })
    })
    const wrapped = reviewerClient(t, 'one-lease')
    await collectStream(wrapped)
    await generateImage(wrapped, 'one lease')
    expect(t.claims).toHaveLength(2)
    expect(t.claims[0]?.actual).not.toBeNull()
    expect(t.claims[1]?.actual).not.toBeNull()
    expect(t.liveLeases()).toBe(0)
  })

  it('releases the lease when the key read fails after acquisition', async () => {
    const t = rig()
    t.client.currentKeyDigest = () => Promise.reject(new Error('signed out'))
    const wrapped = reviewerClient(t, 'key-lost')
    await expect(collectStream(wrapped)).rejects.toThrow('signed out')
    expect(t.liveLeases()).toBe(0)
    // The owner is usable again: nothing stays reserved past the failure.
    const again = reviewerClient(t, 'key-lost')
    t.client.currentKeyDigest = () =>
      Promise.resolve(createHash('sha256').update('fake-only-a').digest('hex'))
    t.api.script({ text: 'recovered', usage: { input: 10, output: 2 } })
    await collectStream(again)
    expect(t.claims).toHaveLength(2)
    expect(t.liveLeases()).toBe(0)
  })

  it('holds nothing for a paid-helper stream that is never iterated', async () => {
    const t = rig()
    const wrapped = reviewerClient(t, 'never-run')
    const stream = wrapped.streamResponse(
      paidHelperBody(),
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
    )
    expect(t.liveLeases()).toBe(0)
    await stream.return(undefined)
    expect(t.liveLeases()).toBe(0)
    expect(t.claims).toHaveLength(0)
  })

  it('releases an abandoned paid-helper stream with no settlement left open', async () => {
    const t = rig()
    const wrapped = reviewerClient(t, 'abandoned')
    const stream = wrapped.streamResponse(
      paidHelperBody(),
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
    )
    const first = await stream.next()
    expect(first.done).toBe(false)
    await stream.return(undefined)
    expect(t.liveLeases()).toBe(0)
    expect(t.claims).toHaveLength(1)
  })

  it('leaves no sticky entry or persisted selection behind for transient sends', async () => {
    const t = rig()
    for (let index = 0; index < 100; index += 1) {
      const account = await t.writer.withLease(
        poolRequest({ owner: `judge:turn:${String(index)}`, transient: true }),
        ORIGIN,
        (lease, report) => {
          lease.beforeSend()
          report(null)
          return Promise.resolve(lease.account)
        },
      )
      expect(account).toBe('a')
    }
    expect(t.selectionWrites).toHaveLength(0)
    expect(t.pool.current('conversation', 'judge:turn:42')).toBeUndefined()
    expect(t.pool.currentWithoutNext('conversation', 'judge:turn:42')).toBeUndefined()
    expect(t.liveLeases()).toBe(0)
  })
})
