// The Grok plan legs: catalogue, failure sentences, account identity and
// subscription dispatch. Provenance, piece by piece:
// - Catalogue rows use the captured list shape (`{data: [{id,
//   context_length, ...}]}`) and captured slugs
//   (`docs/certification/m95-captures/xai/01-models-list.json`, key auth
//   2026-10-04). A subscription answer in any other shape reads
//   unreadable; the first live sign-in pins it.
// - Refusals replay xAI's captured envelopes (`{code, error}`,
//   `test/fixtures/provider-refusals/xai/`, real-life 2026-10-13).
// - The refresh refusal `{error: 'invalid_grant'}` is RFC 6749 §5.2's
//   ASCII code, a standard OAuth shape, never xAI's private wire.
// - The success stream answers an empty 200 body: zero invented xAI
//   bytes, while the request shape, clean end and usage tally are
//   asserted. xAI's SSE decode is proven by the codec's own suite over
//   its captures.
// - The signer is the real `GrokSignIn` over real grants (no network for
//   an unexpired record); every other fetch is recorded here and refused
//   anywhere else. No request reaches xAI.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import {
  GrokSignIn,
  GrokSignInError,
  type GrokHostPort,
  type GrokRecord,
} from '../../src/core/providers/subscriptions/grok'
import {
  createSubscriptionClient,
  grokAccountId,
  grokCatalog,
  grokFailureText,
  grokModels,
  grokPlanAccount,
} from '../../src/core/providers/subscriptions/registry'
import { providersFileSchema } from '../../src/core/providers/providersFile'
import { UI_TEXT } from '../../src/shared/constants'
import { captureFailure } from './helpers/captureFailure'
import { testPlanMetaClient, testPlanStreamBody, testSecretStore } from './helpers/chatGptGrant'
import {
  CLIENT_ID,
  discoveryEndpoints,
  discoveryFixture,
  discoveryOnlyFetch,
} from './helpers/grokDiscoveryFetch'
import { grokGrantRecord } from './helpers/grokGrant'

const SLUG = 'grok-4.3'
const REASONING_SLUG = 'grok-4.20-0309-reasoning'
const MODELS_URL = 'https://api.x.ai/v1/models'
const RESPONSES_URL = 'https://api.x.ai/v1/responses'

/** One captured xAI refusal's status and body, lead-masked where noted. */
function capturedRefusal(name: 'unknown-model' | 'bad-key'): { status: number; body: unknown } {
  const capture = JSON.parse(
    readFileSync(
      new URL(`../fixtures/provider-refusals/xai/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as { status: number; response: unknown }
  return { status: capture.status, body: capture.response }
}

/** The real sign-in class over the given grant: no callback or browser runs. */
function signInWith(record: GrokRecord, send: typeof fetch = discoveryOnlyFetch()): GrokSignIn {
  const host: GrokHostPort = {
    clientId: CLIENT_ID,
    scopes: undefined,
    fetch: send,
    now: Date.now,
    openBrowser: () => Promise.reject(new GrokSignInError('browser-unavailable')),
    startCallback: () => Promise.reject(new GrokSignInError('invalid-callback')),
    readRecord: () => Promise.resolve(record),
    writeRecord: () => Promise.reject(new GrokSignInError('store-unavailable')),
    deleteRecord: () => Promise.reject(new GrokSignInError('store-unavailable')),
    withRefreshLock: (work) => work(),
  }
  return new GrokSignIn(host)
}

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly headers: Headers
  readonly body: string | undefined
}

function recordingFetch(
  calls: RecordedCall[],
  answer: (call: RecordedCall) => Response,
): typeof fetch {
  const stub: typeof fetch = (url, init) => {
    const call: RecordedCall = {
      url: url instanceof Request ? url.url : String(url),
      method: init?.method ?? (url instanceof Request ? url.method : 'GET'),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(call)
    return Promise.resolve(answer(call))
  }
  return stub
}

function clientWith(options: {
  readonly models: readonly string[]
  readonly fetch: typeof fetch
  readonly grok?: () => Promise<Pick<GrokSignIn, 'accessToken'>>
  readonly loadUsage?: () => never[]
}): ProviderClient {
  const file = providersFileSchema.parse({
    v: 1,
    providers: [
      {
        id: 'grok',
        preset: 'grok',
        address: 'https://api.x.ai',
        format: 'responses',
        auth: 'subscription',
        models: [...options.models],
      },
    ],
  })
  // The shared unkeyed Meta client: every path below stays on the plan
  // legs, and with no key a regression that reaches Meta fails instead of
  // answering.
  const meta: ProviderClient = testPlanMetaClient(testSecretStore())
  const base = {
    fetch: options.fetch,
    providers: () => Promise.resolve(file),
    chatgpt: () => {
      throw new Error('chatgpt leg unused by grok plan tests')
    },
    accountId: () => Promise.resolve(undefined),
  }
  return createSubscriptionClient(
    meta,
    options.grok === undefined ? base : { ...base, grok: options.grok },
  )
}

/** The plan catalogue the registry wires; absent on a client without legs. */
async function listPlanModels(client: ProviderClient): Promise<string[]> {
  const list = client.listPlanModels
  if (list === undefined) throw new Error('plan catalogue unwired')
  return await list()
}

/** The plan usage the registry tallies; absent on a client without legs. */
function readPlanUsage(client: ProviderClient): unknown {
  const read = client.readPlanUsage
  if (read === undefined) throw new Error('plan usage unwired')
  return read()
}

describe('grok catalogue listing', () => {
  it('lists captured-shape rows with their windows, naming the list URL and bearer', async () => {
    const calls: RecordedCall[] = []
    const fetcher = recordingFetch(calls, () =>
      Response.json({
        object: 'list',
        data: [
          { id: SLUG, object: 'model', owned_by: 'xai', context_length: 1_000_000 },
          { id: REASONING_SLUG, object: 'model', owned_by: 'xai', context_length: 2_000_000 },
          { id: SLUG, object: 'model', owned_by: 'xai', context_length: 1_000_000 },
        ],
      }),
    )
    const catalog = await grokCatalog(signInWith(grokGrantRecord()), fetcher)
    expect(catalog.slugs).toEqual([SLUG, REASONING_SLUG])
    expect(catalog.windows.get(SLUG)).toBe(1_000_000)
    expect(catalog.windows.get(REASONING_SLUG)).toBe(2_000_000)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(MODELS_URL)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-access-token-placeholder')
  })

  it('reads an unknown window as unknown, and an id-less list as empty', async () => {
    const fetcher = recordingFetch([], () =>
      Response.json({ object: 'list', data: [{ id: SLUG, object: 'model', owned_by: 'xai' }] }),
    )
    const catalog = await grokCatalog(signInWith(grokGrantRecord()), fetcher)
    expect(catalog.slugs).toEqual([SLUG])
    expect(catalog.windows.get(SLUG)).toBeUndefined()
    const empty = recordingFetch([], () =>
      Response.json({ object: 'list', data: [{ object: 'model' }, { id: '' }] }),
    )
    const failure = await captureFailure(() => grokCatalog(signInWith(grokGrantRecord()), empty))
    expect(failure).toMatchObject({ code: 'catalogue-empty' })
  })

  it('reads a list in any other shape, or not JSON, as unreadable', async () => {
    const signIn = signInWith(grokGrantRecord())
    const shaped = recordingFetch([], () => Response.json({ models: [{ slug: SLUG }] }))
    const failure = await captureFailure(() => grokCatalog(signIn, shaped))
    expect(failure).toMatchObject({ code: 'catalogue-unreadable' })
    const broken = recordingFetch([], () => new Response('not json', { status: 200 }))
    const unreadable = await captureFailure(() => grokCatalog(signIn, broken))
    expect(unreadable).toMatchObject({ code: 'catalogue-unreadable' })
  })

  it('names a refused list by the HTTP status and xAI code', async () => {
    const refused = capturedRefusal('bad-key')
    const fetcher = recordingFetch([], () =>
      Response.json(refused.body, { status: refused.status }),
    )
    const failure = await captureFailure(() => grokCatalog(signInWith(grokGrantRecord()), fetcher))
    expect(failure).toMatchObject({
      code: 'catalogue-refused',
      reason: 'HTTP 400 invalid-argument',
    })
    const silent = recordingFetch([], () => new Response('boom', { status: 500 }))
    const unnamed = await captureFailure(() => grokCatalog(signInWith(grokGrantRecord()), silent))
    expect(unnamed).toMatchObject({ code: 'catalogue-refused', reason: 'HTTP 500' })
  })

  it('names a failed list fetch by the network code', async () => {
    const fetcher = recordingFetch([], () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    const failure = await captureFailure(() => grokCatalog(signInWith(grokGrantRecord()), fetcher))
    expect(failure).toMatchObject({ code: 'request-failed' })
    expect(failure).toBeInstanceOf(GrokSignInError)
    if (!(failure instanceof GrokSignInError)) throw new Error('unreachable')
    expect(failure.reason).toContain('ECONNREFUSED')
  })

  it('lists slugs through grokModels', async () => {
    const fetcher = recordingFetch([], () =>
      Response.json({ object: 'list', data: [{ id: SLUG }] }),
    )
    await expect(grokModels(signInWith(grokGrantRecord()), fetcher)).resolves.toEqual([SLUG])
  })
})

describe('grok failure text', () => {
  const CASES = [
    ['client-id-unset', undefined],
    ['invalid-discovery', undefined],
    ['invalid-callback', undefined],
    ['callback-timeout', undefined],
    ['invalid-state', undefined],
    ['invalid-token', undefined],
    ['invalid-id-token', undefined],
    ['scope-refused', undefined],
    ['origin-mismatch', undefined],
    ['device-expired', undefined],
    ['device-denied', undefined],
    ['device-refused', 'authorization_pending'],
    ['verification-refused', undefined],
    ['not-signed-in', undefined],
    ['still-signed-in', undefined],
    ['sign-in-required', 'invalid_grant'],
    ['expired', undefined],
    ['grant-unreadable', undefined],
    ['store-unavailable', undefined],
    ['lock-unavailable', 'EACCES'],
    ['lock-busy', undefined],
    ['cancelled', undefined],
    ['browser-unavailable', undefined],
    ['local-failed', 'EACCES'],
    ['providers-file-unreadable', 'unparseable'],
    ['providers-file-unwritable', 'io-error'],
    ['already-added', undefined],
    ['catalogue-refused', 'HTTP 400 invalid-argument'],
    ['catalogue-unreadable', undefined],
    ['catalogue-empty', undefined],
    ['added-models-unlisted', undefined],
    ['model-not-added', 'grok/grok-4.3'],
    ['authorize-refused', 'access_denied'],
    ['request-failed', 'TypeError: ENOTFOUND'],
  ] as const satisfies readonly (readonly [GrokSignInError['code'], string | undefined])[]

  it('covers every failure code', () => {
    type Missing = Exclude<GrokSignInError['code'], (typeof CASES)[number][0]>
    const complete: Missing extends never ? true : Missing = true
    expect(complete).toBe(true)
  })

  it.each(CASES)('%s says its own complete sentence', (code, reason) => {
    const text = grokFailureText(code, reason)
    expect(text).not.toBe(UI_TEXT.planUi.retry)
    expect(text).not.toContain('{')
    expect(text.length).toBeGreaterThan(0)
    if (reason !== undefined) expect(text).toContain(reason)
  })

  it('keeps the standing retry sentence for a bare request failure', () => {
    expect(grokFailureText('request-failed')).toBe(UI_TEXT.planUi.retry)
  })

  it('says every code distinctly', () => {
    const texts = CASES.map(([code, reason]) => grokFailureText(code, reason))
    expect(new Set(texts).size).toBe(CASES.length)
  })
})

describe('grok account identity', () => {
  it('reads the verified account hash from an object or its stored text', () => {
    const record = grokGrantRecord()
    expect(grokAccountId(record)).toBe(record.accountIdHash)
    expect(grokAccountId(JSON.stringify(record))).toBe(record.accountIdHash)
    expect(grokAccountId(undefined)).toBeUndefined()
    expect(grokPlanAccount(record)).toEqual({
      providerId: 'grok',
      accountIdHash: record.accountIdHash,
    })
  })

  it('withholds the plan account while a refresh is pending', () => {
    const record = grokGrantRecord({ pendingRefresh: {} })
    expect(grokPlanAccount(record)).toBeUndefined()
  })

  it('reads malformed stored text as an unreadable grant', async () => {
    const failure = await captureFailure(() => Promise.resolve(grokAccountId('{oops')))
    expect(failure).toMatchObject({ code: 'grant-unreadable' })
  })
})

function listedFetch(calls: RecordedCall[]): typeof fetch {
  return recordingFetch(calls, () =>
    Response.json({
      object: 'list',
      data: [
        { id: SLUG, object: 'model', owned_by: 'xai', context_length: 1_000_000 },
        { id: REASONING_SLUG, object: 'model', owned_by: 'xai' },
      ],
    }),
  )
}

async function streamEvents(client: ProviderClient, model: string): Promise<StreamEvent[]> {
  const stream = client.streamResponse(testPlanStreamBody(model), new AbortController().signal)
  return await Array.fromAsync(stream)
}

describe('grok plan dispatch', () => {
  it('lists the subscribed slugs the entry added, naming the list URL and bearer', async () => {
    const calls: RecordedCall[] = []
    const client = clientWith({
      models: [SLUG],
      fetch: listedFetch(calls),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    await expect(listPlanModels(client)).resolves.toEqual([`grok/${SLUG}`])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(MODELS_URL)
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-access-token-placeholder')
  })

  it('refuses an unwired host as signer-unavailable', async () => {
    const client = clientWith({ models: [SLUG], fetch: listedFetch([]) })
    const failure = await captureFailure(() => listPlanModels(client))
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('unreachable')
    expect(failure.message).toContain('signer-unavailable')
  })

  it('says an unlisted model as model-not-added, naming the model', async () => {
    const client = clientWith({
      models: [SLUG],
      fetch: listedFetch([]),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    const failure = await captureFailure(() =>
      client.countInputTokens(testPlanStreamBody('grok/no-such-model')),
    )
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('unreachable')
    expect(failure.message).toContain('grok/no-such-model')
    expect(failure.cause).toMatchObject({ code: 'model-not-added' })
  })

  it('says an empty subscription overlap as added-models-unlisted', async () => {
    const client = clientWith({
      models: ['grok/withdrawn'],
      fetch: listedFetch([]),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    const failure = await captureFailure(() => client.listModels())
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('unreachable')
    expect(failure.cause).toMatchObject({ code: 'added-models-unlisted' })
  })

  it('reads the context window once a listing warmed the cache', async () => {
    const client = clientWith({
      models: [SLUG, REASONING_SLUG],
      fetch: listedFetch([]),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    expect(client.modelContextLimit?.(`grok/${SLUG}`)).toBeUndefined()
    await listPlanModels(client)
    expect(client.modelContextLimit?.(`grok/${SLUG}`)).toBe(1_000_000)
    expect(client.modelContextLimit?.(`grok/${REASONING_SLUG}`)).toBeUndefined()
  })

  it('counts input tokens by the shared plan estimate', async () => {
    const client = clientWith({
      models: [SLUG],
      fetch: listedFetch([]),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    const body = testPlanStreamBody(`grok/${SLUG}`)
    await expect(client.countInputTokens(body)).resolves.toBe(
      Buffer.byteLength(JSON.stringify(body.input)) + Buffer.byteLength(body.instructions),
    )
  })

  it('sends to the xAI Responses API and tallies the subscription use', async () => {
    const calls: RecordedCall[] = []
    const client = clientWith({
      models: [SLUG],
      fetch: recordingFetch(calls, (call) =>
        call.url === MODELS_URL
          ? Response.json({ object: 'list', data: [{ id: SLUG }] })
          : new Response('', { status: 200 }),
      ),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    await expect(streamEvents(client, `grok/${SLUG}`)).resolves.toEqual([])
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${RESPONSES_URL}`])
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-access-token-placeholder')
    const sent = JSON.parse(calls[0]?.body ?? '{}') as { model?: unknown; input?: unknown }
    expect(sent.model).toBe(SLUG)
    expect(sent.input).toBeDefined()
    expect(readPlanUsage(client)).toMatchObject([{ providerId: 'grok' }])
  })

  it('surfaces an xAI refusal with xAI words and code, then ends the turn', async () => {
    const refused = capturedRefusal('unknown-model')
    const client = clientWith({
      models: [SLUG],
      fetch: recordingFetch([], () => Response.json(refused.body, { status: refused.status })),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    const events = await streamEvents(client, `grok/${SLUG}`)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'not-found' })
    expect(String((events[0] as { message?: unknown }).message)).toContain(
      'does not exist or your team',
    )
    expect(readPlanUsage(client)).toMatchObject([{ providerId: 'grok' }])
  })

  it('maps a dead grant to invalid_api_key and keeps the typed throw', async () => {
    const endpoints = discoveryEndpoints()
    const calls: RecordedCall[] = []
    const fetchToken: typeof fetch = (url, init) => {
      const href = url instanceof Request ? url.url : String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && href === endpoints.token)
        return Promise.resolve(Response.json({ error: 'invalid_grant' }))
      if (method === 'GET' && href.includes('/.well-known/openid-configuration'))
        return Promise.resolve(Response.json(discoveryFixture()))
      calls.push({
        url: href,
        method,
        headers: new Headers(init?.headers),
        body: undefined,
      })
      return Promise.reject(new Error(`no recorded answer for ${method} ${href}`))
    }
    const expired = grokGrantRecord({ expiresAt: Date.now() - 60_000 })
    const client = clientWith({
      models: [SLUG],
      fetch: fetchToken,
      grok: () => Promise.resolve(signInWith(expired, fetchToken)),
    })
    const stream = client.streamResponse(
      testPlanStreamBody(`grok/${SLUG}`),
      new AbortController().signal,
    )
    const seen: unknown[] = []
    const failure = await captureFailure(async () => {
      for await (const event of stream) seen.push(event)
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'error', code: 'invalid_api_key' })
    expect(String((seen[0] as { message?: unknown }).message)).toContain('invalid_grant')
    expect(failure).toMatchObject({ code: 'sign-in-required' })
  })

  it('says an empty success body as no reply', async () => {
    const client = clientWith({
      models: [SLUG],
      fetch: recordingFetch([], () => new Response(null, { status: 200 })),
      grok: () => Promise.resolve(signInWith(grokGrantRecord())),
    })
    const events = await streamEvents(client, `grok/${SLUG}`)
    expect(events).toEqual([
      { type: 'error', code: 'request-failed', message: UI_TEXT.planUi.noReply },
    ])
  })
})
