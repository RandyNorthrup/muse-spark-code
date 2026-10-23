// Lane RETRYLIMITS: each provider retries by its documented maximum, and
// the person's `museSpark.modelApiMaxRetries` setting decides the rest.
// Real code and real data only (review of PR #225): the documented tables in
// `src/shared/retryPolicy.ts` and the per-preset quirks, the product's own
// `RequestTransport` with the platform's own random source and timer, and
// the agent's own logger. No server, no fake, no mock, and no provider wait
// is fed in: the repository holds no recorded real exchange with a
// `Retry-After` header, so the named-wait rule is proved by the packed
// product's real-life run. The VS Code settings read itself is not
// unit-tested here: its source is the editor's own configuration object,
// which a unit test may not stand in for (review RVRETRYLIMITS); the lead's
// real-life run sets `museSpark.modelApiMaxRetries` in the packed product.
import { createServer } from 'node:net'
import { setTimeout as timer } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { resolveAttemptBillingRoute } from '../../src/core/backends/modelapi/billingRoute'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { PLAN_KEY_PRESETS, PRESETS, presetById, quirksOf } from '../../src/core/providers/presets'
import { emptyProvidersFile } from '../../src/core/providers/providersFile'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import {
  abortableSleep,
  ModelApiError,
  noRetryBudget,
  RequestTransport,
  UNBOUNDED_RETRIES,
  type RetryNotice,
} from '../../src/core/backends/modelapi/transport'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  MODEL_API_BASE_URL,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_TIMER_MAX_MS,
} from '../../src/shared/constants'
import {
  effectiveMaxRetries,
  META_DOCUMENTED_RETRY_LIMITS,
  isPersonRetryCap,
  PROVIDER_RETRY_LIMITS,
  type RetryLimits,
} from '../../src/shared/retryPolicy'

const limitsOf = (preset: string) => quirksOf(presetById(preset)!).retryLimits

/** When the overflow test's Stop comes; any time well past 1 ms proves it. */
const STOP_AFTER_MS = 200

/**
The platform's own timer, unreferenced so a wait left pending by a Stop
never holds the test process open.
*/
const platformSleep = async (ms: number): Promise<void> => {
  await timer(ms, undefined, { ref: false })
}

/** The deps every transport in this suite shares; callers add the address and limits. */
const baseTransportDeps = (sleep: (ms: number, signal?: AbortSignal) => Promise<void>) => ({
  fetch: globalThis.fetch,
  sleep,
  now: Date.now,
  random: Math.random,
  log: stderrLogger((line) => process.stderr.write(`${line}\n`), 'warn'),
})

/** The product's transport over one provider's documented limits. */
const transportFor = (retryLimits: RetryLimits) =>
  new RequestTransport({
    ...baseTransportDeps(platformSleep),
    baseUrl: MODEL_API_BASE_URL,
    retryLimits,
  })

/** The product's transport with the chunk sleep under test. */
const transportWithSleep = (sleep: (ms: number, signal?: AbortSignal) => Promise<void>) =>
  new RequestTransport({
    ...baseTransportDeps(sleep),
    baseUrl: MODEL_API_BASE_URL,
    retryLimits: limitsOf('openrouter'),
  })

/**
A port nothing answers: bind loopback, then close it, so the
platform's own fetch fails the send with a real refused connection.
No provider and no answering server stands in for one.
*/
const closedLoopbackPort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((done) =>
    server.listen(0, '127.0.0.1', () => {
      done()
    }),
  )
  const port = (server.address() as { readonly port: number }).port
  await new Promise<void>((done) =>
    server.close(() => {
      done()
    }),
  )
  return port
}

/**
The product's transport aimed at a dead address, over one provider's
documented limits. The key is a dummy: the refused connection means no
request is ever built or sent (precedent: providerRefusals' made-up
key for its model-list path).
*/
const transportToNowhere = (
  port: number,
  retryLimits: RetryLimits,
  personCap?: () => number | undefined,
) =>
  new RequestTransport({
    ...baseTransportDeps(platformSleep),
    baseUrl: `http://127.0.0.1:${String(port)}`,
    retryLimits,
    ...(personCap !== undefined && { personCap }),
    apiKey: () => Promise.resolve('retry-limit-test-key'),
  })

const postNowhere = async (
  transport: RequestTransport,
  signal: AbortSignal | undefined,
  notices: RetryNotice[],
): Promise<unknown> => {
  return await transport.request(
    '/responses',
    {
      method: 'POST',
      body: {},
      accept: 'application/json',
      billingRoute: await resolveAttemptBillingRoute({ feature: 'ordinary', isMetaDirect: false }),
    },
    signal,
    (notice) => {
      notices.push(notice)
    },
  )
}

/**
A refused send's retry notices: posts, waits for `wanted` notices, stops
the waits, and hands back what the turn announced. The stop ends the
backoff; the attempt rejects with the send failure either way.
*/
const refusedNotices = async (
  transport: RequestTransport,
  wanted: number,
): Promise<readonly RetryNotice[]> => {
  const stop = new AbortController()
  const notices: RetryNotice[] = []
  const attempt = postNowhere(transport, stop.signal, notices)
  const start = Date.now()
  while (notices.length < wanted && Date.now() - start < 4000) {
    await timer(10, undefined, { ref: false })
  }
  stop.abort()
  await expect(attempt).rejects.toBeInstanceOf(ModelApiError)
  return notices
}

describe('each provider retries by its documented maximum', () => {
  it('pins the documented counts (anthropic.md AB13, openai SDK, gemini SDK, azure-openai.md, xai.md, dev.meta.ai)', () => {
    expect(limitsOf('anthropic').maxRetries).toBe(2)
    expect(limitsOf('openai').maxRetries).toBe(2)
    expect(limitsOf('gemini').maxRetries).toBe(4)
    expect(limitsOf('azure').maxRetries).toBe(10)
    expect(limitsOf('xai').maxRetries).toBe(4)
    expect(META_DOCUMENTED_RETRY_LIMITS.maxRetries).toBe(4)
  })
  it('pins the documented backoff bounds (gemini SDK 1 s to 60 s, xAI 1 s doubling uncapped)', () => {
    expect(limitsOf('gemini').baseMs).toBe(1000)
    expect(limitsOf('gemini').maxMs).toBe(60_000)
    expect(limitsOf('xai').baseMs).toBe(1000)
    expect(limitsOf('xai').maxMs).toBeUndefined()
    expect(limitsOf('anthropic').baseMs).toBeUndefined()
    expect(limitsOf('anthropic').maxMs).toBeUndefined()
  })
  it('leaves every undocumented provider without a limit of ours', () => {
    for (const preset of [
      'openrouter',
      'groq',
      'deepseek',
      'mistral',
      'together',
      'fireworks',
      'huggingface',
      'zai',
      'ollama',
      'lmstudio',
      'vllm',
      'llamacpp',
      'custom',
    ]) {
      expect(limitsOf(preset).maxRetries).toBeUndefined()
    }
    expect(PROVIDER_RETRY_LIMITS.responses.maxRetries).toBeUndefined()
    expect(PROVIDER_RETRY_LIMITS.chat.maxRetries).toBeUndefined()
  })
})

describe("the person's setting decides", () => {
  it('caps the documented maximum (0 never retries), never raises it, else the documented one, else the industry default', () => {
    expect(effectiveMaxRetries(1, limitsOf('xai'))).toBe(1)
    expect(effectiveMaxRetries(0, limitsOf('azure'))).toBe(0)
    expect(effectiveMaxRetries(0, limitsOf('openrouter'))).toBe(0)
    // A count left over from a generous provider never raises a stricter
    // one (PR #225: 10 set for Azure, then Anthropic selected, stays 2).
    expect(effectiveMaxRetries(10, limitsOf('anthropic'))).toBe(2)
    expect(effectiveMaxRetries(10, limitsOf('openrouter'))).toBe(10)
    expect(effectiveMaxRetries(undefined, limitsOf('anthropic'))).toBe(2)
    // D217: where the provider documents no maximum, the industry
    // default (2) governs instead of retrying unbounded.
    expect(effectiveMaxRetries(undefined, limitsOf('openrouter'))).toBe(2)
    expect(transportFor(limitsOf('gemini')).maxRetries()).toBe(4)
    expect(transportFor(limitsOf('groq')).maxRetries()).toBe(2)
  })
  it('a count above the documented maximum still stops at it on a real refused send', async () => {
    // Anthropic documents two retries: with the person at 10, the refused
    // send gets its two retries (two notices), not ten.
    const transport = transportToNowhere(
      await closedLoopbackPort(),
      limitsOf('anthropic'),
      () => 10,
    )
    expect(transport.maxRetries()).toBe(2)
    expect(await refusedNotices(transport, 2)).toHaveLength(2)
  })
})

describe('waits follow the provider', () => {
  it('doubles from the documented base up to the documented maximum, jitter on top', () => {
    const gemini = transportFor(limitsOf('gemini'))
    for (const [attempt, base] of [
      [0, 1000],
      [3, 8000],
    ] as const) {
      const wait = gemini.backoffMs(attempt)
      expect(wait).toBeGreaterThanOrEqual(base)
      expect(wait).toBeLessThan(base + MODEL_API_RETRY_JITTER_MS)
    }
    expect(gemini.backoffMs(10)).toBe(60_000)
  })
  it('caps at the industry ceiling where the provider documents no maximum wait', () => {
    // D217: xAI documents 1 s doubling with no ceiling, so the industry
    // 8 s ceiling governs (the ceiling caps the jittered wait whole);
    // OpenRouter documents no base either, so the industry 0.5 s base
    // governs its early waits.
    expect(transportFor(limitsOf('xai')).backoffMs(10)).toBe(8000)
    const wait = transportFor(limitsOf('openrouter')).backoffMs(2)
    expect(wait).toBeGreaterThanOrEqual(2000)
    expect(wait).toBeLessThan(2000 + MODEL_API_RETRY_JITTER_MS)
  })
  it('waits out a provider wait longer than one timer holds instead of asking again at once', async () => {
    // Only a provider-named wait still passes the longest delay one timer
    // holds (D217 caps the computed backoff at 8 s): the platform would
    // cut the single timer to 1 ms, so the pause must chunk the wait.
    const transport = transportFor(limitsOf('openrouter'))
    const wait = transport.backoffMs(0, MODEL_API_TIMER_MAX_MS + 1)
    expect(wait).toBeGreaterThan(MODEL_API_TIMER_MAX_MS)
    // A Stop well past the 1 ms the platform would cut the wait to: the
    // wait must still be running when it comes, so the Stop ends it.
    const stop = AbortSignal.timeout(STOP_AFTER_MS)
    await expect(transport.pause(wait, stop)).rejects.toBeInstanceOf(ModelApiError)
    expect(stop.aborted).toBe(true)
  })
})

describe('a stop cancels the wait itself', () => {
  it('hands each chunk the turn stop so its own timer can die with it', async () => {
    // A wait past what one timer holds: the stop must reach the chunk's
    // sleep, or the abandoned timer outlives the turn (PR225FIX2).
    let inner: AbortSignal | undefined
    const transport = transportWithSleep((ms, signal) => {
      inner = signal
      return abortableSleep(ms, signal)
    })
    const stop = AbortSignal.timeout(STOP_AFTER_MS)
    await expect(transport.pause(MODEL_API_TIMER_MAX_MS + 1, stop)).rejects.toBeInstanceOf(
      ModelApiError,
    )
    expect(inner).toBe(stop)
  })
  it('a sleep that ignores the stop is still abandoned promptly', async () => {
    // The race stays as the backstop: whatever is injected, Stop ends the
    // wait. Without it this test hangs past the suite timeout.
    const transport = transportWithSleep(async (ms) => {
      await timer(ms, undefined, { ref: false })
    })
    const stop = AbortSignal.timeout(STOP_AFTER_MS)
    await expect(transport.pause(MODEL_API_TIMER_MAX_MS + 1, stop)).rejects.toBeInstanceOf(
      ModelApiError,
    )
    expect(stop.aborted).toBe(true)
  })
  it('the production sleep resolves a dead wait instead of holding it', async () => {
    // An already-stopped wait never starts its timer; a wait stopped
    // mid-flight ends with the stop, about STOP_AFTER_MS, not with it.
    await abortableSleep(MODEL_API_TIMER_MAX_MS, AbortSignal.abort())
    const stop = AbortSignal.timeout(STOP_AFTER_MS)
    await abortableSleep(MODEL_API_TIMER_MAX_MS, stop)
    expect(stop.aborted).toBe(true)
  })
})

describe('ambiguous sends need an explicit cap', () => {
  it('an unanswered send with no documented maximum and no setting fails once, never replays', async () => {
    // OpenRouter documents no retry maximum: with no setting either, the
    // reset connection used to replay a possibly-executed paid send
    // without end (PR225FIX2). One fetch, no retry notice, the send
    // failure at once.
    const transport = transportToNowhere(await closedLoopbackPort(), limitsOf('openrouter'))
    // D217: the industry fallback bounds answered failures, never an
    // ambiguous send — no explicit bound here, so none is reported and
    // the send still fails once.
    expect(transport.explicitMaxRetries()).toBeUndefined()
    expect(transport.maxRetries()).toBe(2)
    const notices: RetryNotice[] = []
    await expect(postNowhere(transport, undefined, notices)).rejects.toBeInstanceOf(ModelApiError)
    expect(notices).toHaveLength(0)
  })
  it("the person's setting still bounds an unanswered send", async () => {
    // The explicit cap is honoured exactly: one retry with its notice,
    // then the send failure, not silence and not forever.
    const transport = transportToNowhere(
      await closedLoopbackPort(),
      limitsOf('openrouter'),
      () => 1,
    )
    const notices: RetryNotice[] = []
    await expect(postNowhere(transport, undefined, notices)).rejects.toBeInstanceOf(ModelApiError)
    expect(notices).toHaveLength(1)
  })
  it('a documented maximum still retries an unanswered send', async () => {
    // Anthropic documents two retries of a transient send failure: the
    // first wait starts with its notice, and the turn's Stop ends it.
    const transport = transportToNowhere(await closedLoopbackPort(), limitsOf('anthropic'))
    expect(transport.maxRetries()).toBe(2)
    expect(await refusedNotices(transport, 1)).toHaveLength(1)
  })
})

/**
The product's subscription registry in front of the product's Meta
client (PR #225: the aggregate reported Meta's four retries for
`chatgpt/...` and `copilot/...`, though neither route documents a
maximum). Sign-in, the catalogue and the account stay untouched: a limit
read never reaches them, and no send ever happens for one.
*/
const subscriptionClient = (person: number | undefined) => {
  const log = stderrLogger((line) => process.stderr.write(`${line}\n`), 'warn')
  const meta = new ModelApiClient({
    fetch: globalThis.fetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve('retry-limit-test-key'),
    sleep: platformSleep,
    now: Date.now,
    random: Math.random,
    log,
    ...(person !== undefined && { personCap: () => person }),
  })
  return createSubscriptionClient(meta, {
    fetch: globalThis.fetch,
    providers: () => Promise.resolve(emptyProvidersFile()),
    chatgpt: () => {
      throw new Error('sign-in unused by a limit read')
    },
    accountId: () => Promise.resolve(undefined),
    ...(person !== undefined && { personCap: () => person }),
  })
}

describe('each subscription route answers its own retry limit', () => {
  it('plan routes read the setting, else the industry default; off-plan stays Meta', () => {
    const unset = subscriptionClient(undefined)
    expect(unset.maxRetries('chatgpt/gpt-5.2')).toBe(2)
    expect(unset.maxRetries('copilot/gpt-4.1')).toBe(2)
    expect(unset.maxRetries('some-model')).toBe(4)
    const capped = subscriptionClient(1)
    expect(capped.maxRetries('chatgpt/gpt-5.2')).toBe(1)
    expect(capped.maxRetries('copilot/gpt-4.1')).toBe(1)
    expect(capped.maxRetries('some-model')).toBe(1)
  })
  it('a count above no documented maximum still passes through on plan routes', () => {
    // Nothing documented to keep on either plan route, so the person's 10
    // stands there, while Meta's own route stays capped at its 4.
    const generous = subscriptionClient(10)
    expect(generous.maxRetries('chatgpt/gpt-5.2')).toBe(10)
    expect(generous.maxRetries('some-model')).toBe(4)
  })
  it('the raw setting rides along for the cap stop, unset stays unset', () => {
    // The turn loop reads this (not the capped limit) to tell a person-set
    // cap stop from a provider refusal on the orchestrator's feed.
    expect(subscriptionClient(undefined).personCap()).toBeUndefined()
    expect(subscriptionClient(1).personCap()).toBe(1)
  })
})

describe("the orchestrator is told when the person's cap stops the turn", () => {
  it("fires on the person's cap, never on a provider maximum or no cap", () => {
    // Person at or under the documented maximum: their cap stopped the
    // turn (effective equals their setting), so the feed says so.
    expect(isPersonRetryCap(1, 1)).toBe(true)
    expect(isPersonRetryCap(0, 0)).toBe(true)
    expect(isPersonRetryCap(10, 10)).toBe(true)
    // Above the documented maximum the provider stopped it instead.
    expect(isPersonRetryCap(10, 2)).toBe(false)
    expect(isPersonRetryCap(10, 4)).toBe(false)
    // Nothing set, nothing fired.
    expect(isPersonRetryCap(undefined, 2)).toBe(false)
    expect(isPersonRetryCap(undefined, undefined)).toBe(false)
  })
})

describe('a live retry cap is rechecked after the wait', () => {
  it('a cap lowered to zero mid-wait stops the accepted retry from sending', async () => {
    // PR #225: the loop accepted one retry, then the person set 0 during
    // the backoff. The next request must not go out: one send, one notice,
    // then the send failure (two sends without the recheck).
    let person: number | undefined = 1
    let sends = 0
    const transport = new RequestTransport({
      ...baseTransportDeps(platformSleep),
      baseUrl: `http://127.0.0.1:${String(await closedLoopbackPort())}`,
      retryLimits: limitsOf('anthropic'),
      personCap: () => person,
      apiKey: () => Promise.resolve('retry-limit-test-key'),
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        sends += 1
        return globalThis.fetch(input, init)
      },
    })
    expect(transport.maxRetries()).toBe(1)
    const notices: RetryNotice[] = []
    const attempt = postNowhere(transport, undefined, notices)
    const start = Date.now()
    while (notices.length === 0 && Date.now() - start < 4000) {
      await timer(10, undefined, { ref: false })
    }
    person = 0
    await expect(attempt).rejects.toBeInstanceOf(ModelApiError)
    expect(notices).toHaveLength(1)
    expect(sends).toBe(1)
  })
})

describe('single-attempt paths refuse every retry', () => {
  it("starts past every provider's documented cap and every count the person can set", () => {
    const budget = noRetryBudget()
    const caps = [
      ...[...PRESETS, ...PLAN_KEY_PRESETS].map((preset) => quirksOf(preset).retryLimits.maxRetries),
      META_DOCUMENTED_RETRY_LIMITS.maxRetries,
      // The largest count the setting's schema accepts (`z.int()`: safe
      // integers only; 2 ** 60 is refused, measured 2026-10-17).
      Number.MAX_SAFE_INTEGER,
    ]
    for (const cap of caps) {
      expect(budget.retriesUsed >= (cap ?? UNBOUNDED_RETRIES)).toBe(true)
    }
  })
})
