// The plan catalogue listing survives one entry this build cannot parse,
// and a stalled plan error body ends under the stream-idle deadline. The
// catalogue rows derive from the lead's value-blind capture of 2026-10-14
// through our own app on Windows (`test/fixtures/chatgpt-catalogue/`);
// the unparseable row is that captured entry with its `service_tiers`
// description removed, the review's example of a field shape this build
// cannot read. Sign-in is the real `ChatGptSignIn` over a real unexpired
// grant (no network: an unexpired record returns without refresh); the
// catalogue and plan answers are real `Response` objects; the stream runs
// through the real subscription client beside a real Meta client.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  verifyChatGptIdToken,
  type ChatGptHostPort,
  type ChatGptRecord,
} from '../../src/core/providers/subscriptions/chatgpt'
import { chatGptCatalogEntrySchema } from '../../src/core/providers/subscriptions/chatgptPlanFacts'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import {
  chatGptAccountId,
  chatGptCatalog,
  createSubscriptionClient,
  planRequestError,
} from '../../src/core/providers/subscriptions/registry'
import { providersFileSchema } from '../../src/core/providers/providersFile'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  testGrantRecord,
  testPlanMetaClient,
  testPlanStreamBody,
  testSecretStore,
} from './helpers/chatGptGrant'

const SLUG = 'gpt-6.1-sol'
const RESPONSES_URL = 'https://api.openai.com/v1/responses'

function capturedEntry(): unknown {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/chatgpt-catalogue/gpt-6.1-sol.json', import.meta.url),
      'utf8',
    ),
  )
}

/** The real sign-in class over an unexpired grant: no callback, browser or refresh runs. */
function signInWith(record: ChatGptRecord): ChatGptSignIn {
  const host: ChatGptHostPort = {
    hostId: record.hostId,
    fetch: globalThis.fetch,
    now: Date.now,
    openBrowser: () => Promise.reject(new ChatGptSignInError('browser-unavailable')),
    startCallback: () => Promise.reject(new ChatGptSignInError('invalid-callback')),
    readRecord: () => Promise.resolve(record),
    writeRecord: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    deleteRecord: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    readRegistration: () => Promise.resolve(undefined),
    writeRegistration: () => Promise.reject(new ChatGptSignInError('store-unavailable')),
    withRefreshLock: (work) => work(),
  }
  return new ChatGptSignIn(host)
}

describe('chatgpt catalogue listing', () => {
  it('keeps a model whose capability facts this build cannot parse', async () => {
    const entry = chatGptCatalogEntrySchema.safeParse(capturedEntry())
    if (!entry.success) throw new Error('the captured entry parses')
    const future: unknown = {
      ...entry.data,
      slug: `${SLUG}-future`,
      // The review's example: a service tier without a description, which
      // the facts schema cannot parse. The listing keeps the slug anyway.
      service_tiers: [{ id: 'priority', name: 'Fast' }],
    }
    const fetcher: typeof fetch = () =>
      Promise.resolve(Response.json({ models: [capturedEntry(), future] }))
    const catalog = await chatGptCatalog(signInWith(testGrantRecord('catalogue-account')), fetcher)
    expect(catalog.slugs).toEqual([SLUG, `${SLUG}-future`])
    expect(catalog.facts.get(SLUG)).toBeDefined()
    expect(catalog.facts.has(`${SLUG}-future`)).toBe(false)
  })
})

describe('chatgpt stalled plan error body', () => {
  it('ends the turn under the stream-idle deadline instead of hanging', async () => {
    const signIn = signInWith(testGrantRecord('stall-account'))
    // Headers arrive, the JSON error body never does.
    const stalled = new Response(new ReadableStream<Uint8Array>({}), { status: 500 })
    const fetchPlan: typeof fetch = (input) => {
      let url: string
      if (typeof input === 'string') url = input
      else if (input instanceof URL) url = input.href
      else url = input.url
      if (url === RESPONSES_URL) return Promise.resolve(stalled)
      throw new Error(`unexpected plan request to ${url}`)
    }
    const file = providersFileSchema.parse({
      v: 1,
      providers: [
        {
          id: 'chatgpt',
          preset: 'chatgpt',
          address: 'https://api.openai.com',
          format: 'responses',
          auth: 'subscription',
          models: [SLUG],
        },
      ],
    })
    const secrets = testSecretStore()
    const meta = testPlanMetaClient(secrets)
    const idleMs = 100
    const client = createSubscriptionClient(meta, {
      fetch: fetchPlan,
      providers: () => Promise.resolve(file),
      chatgpt: () => Promise.resolve(signIn),
      accountId: () => Promise.resolve(undefined),
      streamIdleMs: idleMs,
    })
    const body = testPlanStreamBody(`chatgpt/${SLUG}`)
    const events: StreamEvent[] = []
    const stream = client.streamResponse(
      body,
      AbortSignal.timeout(4000),
      undefined,
      undefined,
      undefined,
      undefined,
    )
    for await (const event of stream) {
      events.push(event)
      break
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'error',
      code: 'request-failed',
      message: fill(UI_TEXT.modelApiStalled, {
        seconds: Math.round(idleMs / MILLISECONDS_PER_SECOND),
      }),
    })
  })
})

function encodePart(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

/** A real malformed answer with this status, as the provider's wire would carry it. */
function malformedAnswer(status: number): typeof fetch {
  return () => Promise.resolve(new Response('{{{', { status }))
}

/** The rejection a catalogue read ends in, or undefined when it resolves. */
async function catalogueFailure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
    return undefined
  } catch (error) {
    return error
  }
}

describe('malformed ChatGPT bodies read as their named refusals', () => {
  it('reads token claims that decode but are not JSON as an invalid token', () => {
    // The header parses, so the claims part reaches the JSON parse: its
    // malformed bytes read as an invalid token. Reverting the SyntaxError
    // narrowing lets the parse failure escape as a SyntaxError instead.
    const token = `${encodePart('{"alg":"RS256","kid":"k1"}')}.${encodePart('{not json')}.${encodePart('sig')}`
    let failure: unknown
    try {
      verifyChatGptIdToken({ token, jwks: {}, clientId: 'x', nonce: 'y', now: 1 })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('invalid-id-token')
  })

  it('reads a catalogue answer that is not JSON as unreadable', async () => {
    const signIn = signInWith(testGrantRecord('malformed-catalogue'))
    const failure = await catalogueFailure(chatGptCatalog(signIn, malformedAnswer(200)))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('catalogue-unreadable')
  })

  it('names a refused catalogue answer without JSON by its status', async () => {
    const signIn = signInWith(testGrantRecord('refused-catalogue'))
    const failure = await catalogueFailure(chatGptCatalog(signIn, malformedAnswer(403)))
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('catalogue-refused')
    expect((failure as ChatGptSignInError).reason).toBe('HTTP 403')
  })

  it('names a plan refusal without JSON by its status', async () => {
    const refusal = await planRequestError(new Response('{{{', { status: 500 }))
    expect(refusal.message).toContain('HTTP 500')
  })

  it('reads malformed stored grant text as grant-unreadable', () => {
    let failure: unknown
    try {
      chatGptAccountId('{not json')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ChatGptSignInError)
    expect((failure as ChatGptSignInError).code).toBe('grant-unreadable')
  })
})
