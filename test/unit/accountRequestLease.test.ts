import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { activeAccountBilling } from '../../src/core/accounts/requestWriter'
import type { ProviderClient, ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../src/core/backends/modelapi/schemas'
import type { FakeModelApi } from './helpers/fakeModelApi'
import { poolRequest } from './helpers/accounts/pool'
import { paidHelperBody, writerRig } from './helpers/accounts/writer'

const ORIGIN = 'https://provider.invalid'
const MODEL = 'muse-spark-1.3'

function rig(configure?: (api: FakeModelApi) => void) {
  return writerRig(ORIGIN, configure)
}

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
        { httpError: { status: 429, message: 'slow down', retryAfter: '1' } },
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

  it('sends every paid request on a lease and never on a bare client', () => {
    const writerSource = readFileSync(
      new URL('../../src/core/accounts/requestWriter.ts', import.meta.url),
      'utf8',
    )
    for (const bare of ['original.streamResponse', 'original.createImage', 'original.editImage']) {
      expect(writerSource.includes(bare), `${bare} would send a paid request outside a lease`).toBe(
        false,
      )
    }
    expect(writerSource).toContain('lease.client.streamResponse')
    expect(writerSource).toContain('lease.beforeSend()')
    expect(writerSource).toContain('lease.rateLimit(')
    const hostSource = readFileSync(
      new URL('../../src/core/backends/modelapi/ModelApiHost.ts', import.meta.url),
      'utf8',
    )
    expect(hostSource).toContain('judgeLeasedSend')
    expect(hostSource).toContain(
      'await this.judgeLeasedSend(requests, body, signal, guard, turnId, keyDigest)',
    )
    expect(hostSource).toContain('prompt_cache_key: promptCacheKey(body)')
    expect(hostSource).toContain('lease.client.streamResponse')
    const askPaidUse = hostSource.slice(hostSource.indexOf('private async askPaidUse'))
    const imageBranch = askPaidUse.slice(0, askPaidUse.indexOf('const stopNotifying'))
    expect(imageBranch).toContain('return true')
  })
})
