// Lane PROVERR Part 1: a provider's refusal at the HTTP boundary.
//
// A loopback server answers with nine recorded shapes; the product's real
// configured-provider client, codec, session and ledger run. No stand-in for
// our own code: the pinned transport posts to the loopback listener itself.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import {
  providerEntrySchema,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { isModelApiError } from '../../src/core/backends/modelapi/transport'
import {
  openAiEnvelope,
  parseRefusalError,
  refusalOf,
} from '../../src/core/backends/modelapi/providerRefusal'
import { parseAnthropicError } from '../../src/core/backends/modelapi/codecs/anthropic'
import { parseGeminiError } from '../../src/core/backends/modelapi/codecs/gemini'
import { parseOllamaError } from '../../src/core/backends/modelapi/codecs/ollama'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import type { RecordedCall, UsageRecording } from '../../src/core/usage/recording'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { Usd } from '../../src/shared/usd'
import { PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../src/shared/constants'
import { FAKE_MODEL_API_ACCOUNT_ID } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const ENTRY_ID = 'case'
const NATIVE = 'probe-model'
const REF = `${ENTRY_ID}/${NATIVE}`
const FAKE_KEY = 'test-owned-key'

const CREDIT_BODY =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'

interface Answer {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly close?: true
}

/** The nine answers Part 1 names, with the exact bytes of the measured one. */
const ANSWERS = {
  credit: {
    status: 400,
    headers: { 'content-type': 'application/json', 'request-id': 'req-credit-1' },
    body: CREDIT_BODY,
  },
  authentication: {
    status: 401,
    headers: { 'content-type': 'application/json', 'request-id': 'req-auth-1' },
    body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  },
  rateLimited: {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '1' },
    body: '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached; try again in a minute."}}',
  },
  overloaded: {
    status: 529,
    headers: { 'content-type': 'application/json' },
    body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded; try again shortly."}}',
  },
  invalidRequest: {
    status: 400,
    headers: { 'content-type': 'application/json' },
    body: '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens 200000 exceeds the maximum for this model."}}',
  },
  notFound: {
    status: 404,
    headers: { 'content-type': 'application/json' },
    body: '{"type":"error","error":{"type":"not_found_error","message":"model: unknown-model-9"}}',
  },
  tooLarge: {
    status: 413,
    headers: { 'content-type': 'application/json' },
    body: '{"type":"error","error":{"type":"request_too_large","message":"Request is larger than 32 MB."}}',
  },
  proxyHtml: {
    status: 502,
    headers: { 'content-type': 'text/html' },
    body: '<html><body>Bad Gateway</body></html>',
  },
  closed: { status: 0, close: true as const },
} satisfies Record<string, Answer>

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'proverr-'))
  roots.push(root)
  const secrets = memorySecrets()
  const configFile = path.join(root, 'providers.json')
  return { root, secrets, configFile, catalogFile: path.resolve('vendor/models-dev/snapshot.json') }
}

async function loopbackProvider(answer: Answer, hasPrices = false) {
  const f = await fixture()
  let requests = 0
  const server: Server = createServer((request, res) => {
    requests += 1
    if (answer.close === true) {
      request.socket.destroy()
      return
    }
    res.writeHead(answer.status, answer.headers ?? { 'content-type': 'application/json' })
    res.end(answer.body ?? '')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test listener')
  const entry = providerEntrySchema.parse({
    id: ENTRY_ID,
    preset: 'custom',
    address: `http://127.0.0.1:${String(address.port)}`,
    format: 'anthropic',
    auth: 'apiKey',
    models: [NATIVE],
    modelLimits: { [NATIVE]: { contextTokens: 128_000, outputTokens: 1024 } },
    ...(hasPrices && { prices: { [NATIVE]: { input: 0.000003, output: 0.000015 } } }),
  })
  await writeProvidersFileAtomic(f.configFile, { v: 1, providers: [entry], defaultModel: REF })
  await f.secrets.store(
    `${PROVIDER_SECRET_PREFIX}${entry.id}`,
    formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: new URL(entry.address ?? '').origin },
      FAKE_KEY,
    ),
  )
  const services = createConfiguredProviderServices(undefined, {
    ...f,
    secrets: f.secrets,
  })
  const model = await services.registry.resolve(REF)
  const close = async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      }),
    )
  }
  return { services, model, close, requests: () => requests, root: f.root }
}

const body = (): CreateResponseBody => ({
  model: REF,
  instructions: 'Test',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hi.' }],
    },
  ],
  tools: [],
  tool_choice: 'auto',
  stream: true,
  store: false,
  max_output_tokens: 64,
  reasoning: { effort: 'none' },
  include: [],
  prompt_cache_key: 'test-prefix',
  prompt_cache_retention: '24h',
})

/** Drain the client stream, capturing the rejection with its stack. */
async function clientError(
  t: Awaited<ReturnType<typeof loopbackProvider>>,
  budget?: { retriesUsed: number },
): Promise<unknown> {
  try {
    await Array.fromAsync(
      t.model.client.streamResponse(
        body(),
        new AbortController().signal,
        undefined,
        budget,
        undefined,
      ),
    )
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the provider answer to refuse the turn')
}

const SINGLE = { retriesUsed: 4 }

describe('provider refusals at the HTTP boundary', () => {
  it('names the raise site for the measured credit refusal', async () => {
    const t = await loopbackProvider(ANSWERS.credit)
    try {
      const error = await clientError(t, SINGLE)
      expect(isModelApiError(error)).toBe(true)
      if (!isModelApiError(error)) throw new Error('expected a ModelApiError')
      // The closed kind and the request id the provider sent survive the
      // sentence; the parser-level test below pins the provider's own words.
      expect(refusalOf(error).kind).toBe('credit')
      expect(error.status).toBe(400)
      expect(error.requestId).toBe('req-credit-1')
      // The person reads the provider's refusal, not a missing feature.
      expect(error.message).toBe(
        'case refused the request: its account is out of credit. Add credit at case; nothing reached a model and nothing was charged for this request. case said: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      )
      expect(error.message).not.toContain(UI_TEXT.modelsPanelUnavailable)
      expect(error.message).not.toContain(FAKE_KEY)
      expect(error.stack).toContain('configured')
      // Answered once and refused before processing: never retried.
      expect(t.requests()).toBe(1)
    } finally {
      await t.close()
    }
  })

  it.each([
    ['authentication', ANSWERS.authentication, 'authentication', 'the stored key was rejected'],
    [
      'permission',
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: '{"type":"error","error":{"type":"permission_error","message":"This key cannot use this model."}}',
      },
      'permission',
      'the key has no permission',
    ],
    ['notFound', ANSWERS.notFound, 'notFound', 'it has no such model'],
    ['invalidRequest', ANSWERS.invalidRequest, 'invalidRequest', 'the request was invalid'],
    ['tooLarge', ANSWERS.tooLarge, 'tooLarge', 'it was too large'],
    ['overloaded', ANSWERS.overloaded, 'overloaded', 'it is overloaded'],
    ['rateLimited', ANSWERS.rateLimited, 'rateLimited', 'too many requests'],
    [
      'serverError',
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: '{"type":"error","error":{"type":"api_error","message":"Internal server error."}}',
      },
      'serverError',
      'a server error on its side',
    ],
    ['unrecognised', ANSWERS.proxyHtml, 'unrecognised', 'does not recognise'],
  ] as const)('tells the truth about a %s answer', async (_name, answer, kind, fragment) => {
    const t = await loopbackProvider(answer)
    try {
      const error = await clientError(t, SINGLE)
      expect(isModelApiError(error)).toBe(true)
      if (!isModelApiError(error)) throw new Error('expected a ModelApiError')
      expect(refusalOf(error).kind).toBe(kind)
      expect(error.message).toContain(fragment)
      expect(error.message).toContain('case')
      expect(error.message).not.toContain(UI_TEXT.modelsPanelUnavailable)
      expect(error.message).not.toContain(FAKE_KEY)
    } finally {
      await t.close()
    }
  })

  it('says the provider could not be reached when the connection closes first', async () => {
    const t = await loopbackProvider(ANSWERS.closed)
    try {
      const error = await clientError(t, SINGLE)
      expect(isModelApiError(error)).toBe(true)
      if (!isModelApiError(error)) throw new Error('expected a ModelApiError')
      expect(error.status).toBe(0)
      expect(error.message).toBe(
        'Could not reach case. Check the network and the provider address; nothing was sent.',
      )
      expect(t.requests()).toBe(1)
    } finally {
      await t.close()
    }
  })
})

describe('refusal retry per kind', () => {
  const FULL = { retriesUsed: 0 }
  it.each([
    ['credit', ANSWERS.credit],
    ['authentication', ANSWERS.authentication],
    [
      'permission',
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: '{"type":"error","error":{"type":"permission_error","message":"This key cannot use this model."}}',
      },
    ],
    ['notFound', ANSWERS.notFound],
    ['invalidRequest', ANSWERS.invalidRequest],
    ['tooLarge', ANSWERS.tooLarge],
  ] as const)('never retries a %s refusal', async (_name, answer) => {
    const t = await loopbackProvider(answer)
    try {
      const retries: unknown[] = []
      try {
        await Array.fromAsync(
          t.model.client.streamResponse(
            body(),
            new AbortController().signal,
            (notice) => {
              retries.push(notice)
            },
            { ...FULL },
            undefined,
          ),
        )
        throw new Error('expected the provider answer to refuse the turn')
      } catch (error: unknown) {
        expect(isModelApiError(error)).toBe(true)
      }
      expect(retries).toHaveLength(0)
      expect(t.requests()).toBe(1)
    } finally {
      await t.close()
    }
  })

  it('retries a rate-limited answer within the table that exists', async () => {
    const answer: Answer = {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '0' },
      body: '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached."}}',
    }
    const t = await loopbackProvider(answer)
    try {
      const retries: unknown[] = []
      const error = await (async () => {
        try {
          await Array.fromAsync(
            t.model.client.streamResponse(
              body(),
              new AbortController().signal,
              (notice) => {
                retries.push(notice)
              },
              { retriesUsed: 3 },
              undefined,
            ),
          )
        } catch (error_: unknown) {
          return error_
        }
        throw new Error('expected the provider answer to refuse the turn')
      })()
      expect(isModelApiError(error)).toBe(true)
      // One retry inside the attempt budget, then the refusal.
      expect(retries).toHaveLength(1)
      expect(t.requests()).toBe(2)
    } finally {
      await t.close()
    }
  })

  it('does not retry an overloaded answer the table does not list', async () => {
    const t = await loopbackProvider(ANSWERS.overloaded)
    try {
      const error = await clientError(t, { retriesUsed: 0 })
      expect(isModelApiError(error)).toBe(true)
      if (!isModelApiError(error)) throw new Error('expected a ModelApiError')
      expect(refusalOf(error).kind).toBe('overloaded')
      expect(t.requests()).toBe(1)
    } finally {
      await t.close()
    }
  })
})

describe('the typed refusal per wire format', () => {
  it('reads the Anthropic credit envelope', () => {
    const error = parseAnthropicError(400, JSON.parse(CREDIT_BODY) as unknown)
    expect(refusalOf(error)).toEqual({
      status: 400,
      kind: 'credit',
      providerMessage:
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    })
  })

  it('reads an unparsable Anthropic body as unrecognised with its first line', () => {
    const error = parseAnthropicError(502, '<html><body>Bad Gateway</body></html>')
    expect(refusalOf(error)).toEqual({
      status: 502,
      kind: 'unrecognised',
      providerMessage: 'HTTP 502: <html><body>Bad Gateway</body></html>',
    })
  })

  it('reads the OpenAI-style envelope for chat, Responses and their quirks', () => {
    const parsed = parseRefusalError(
      401,
      {
        error: {
          message: 'Incorrect API key provided.',
          type: 'invalid_api_key',
          code: 'invalid_api_key',
        },
      },
      openAiEnvelope,
    )
    expect(refusalOf({ status: 401, ...parsed })).toEqual({
      status: 401,
      kind: 'authentication',
      providerMessage: 'Incorrect API key provided.',
    })
  })

  it('reads the Gemini envelope', () => {
    const error = parseGeminiError(400, {
      error: { code: 400, message: 'Invalid value at data.contents.', status: 'INVALID_ARGUMENT' },
    })
    expect(refusalOf(error)).toEqual({
      status: 400,
      kind: 'invalidRequest',
      providerMessage: 'Invalid value at data.contents.',
    })
  })

  it('reads the Ollama envelope and bounds a long message', () => {
    const error = parseOllamaError(500, { error: 'model exploded' }, '')
    expect(refusalOf(error)).toEqual({
      status: 500,
      kind: 'serverError',
      providerMessage: 'model exploded',
    })
    const long = parseRefusalError(400, { error: { message: 'x'.repeat(600) } }, openAiEnvelope)
    expect(long.message).toHaveLength(501)
  })
})

describe('a refused turn through the session', () => {
  it('ends the turn with the refusal sentence and releases the reservation', async () => {
    const t = await loopbackProvider(ANSWERS.credit, true)
    const log = new FakeLogOutputChannel()
    const store = createFileSessionStore({
      directory: t.root,
      log,
      retentionDays: () => 0,
      now: () => 0,
      sleep: () => Promise.resolve(undefined),
    })
    if (store.budget === undefined) throw new Error('expected a budget journal')
    const reserved: unknown[] = []
    const reserve = store.budget.reserve.bind(store.budget)
    store.budget.reserve = async (...args) => {
      reserved.push(args[2])
      return await reserve(...args)
    }
    const notes: { usage: unknown; context: RecordedCall }[] = []
    const usageRecording: UsageRecording = {
      note: (usage, context) => {
        notes.push({ usage, context })
      },
      limit: () => undefined,
      today: () => Promise.resolve([]),
      flush: () => Promise.resolve(),
    }
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client: t.services.client,
        io: memoryToolIo({}, '/workspace'),
        log,
        workspaceRoot: '/workspace',
      }),
      models: t.services.client.models,
      sessionBudgetUsd: () => Usd.from(1).toAmount(),
      store,
      usageRecording,
    })
    try {
      const session = await host.startSession({
        modelId: REF,
        approvalMode: 'allowAll',
        workspaceRoot: '/workspace',
      })
      const watch = watchSessionTurns(session)
      const done = watch.turnDone()
      await session.sendTurn([{ type: 'text', text: 'Hi.' }])
      await done
      const completed = watch.events.find((event) => event.type === 'turnCompleted')
      expect(completed).toMatchObject({
        terminal: 'failed',
        reason:
          'case refused the request: its account is out of credit. Add credit at case; nothing reached a model and nothing was charged for this request. case said: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      })
      expect(t.requests()).toBe(1)
      // The reservation was taken, then released in full: nothing spent,
      // nothing uncertain, and no "ended without its usage" warning.
      expect(reserved.length).toBeGreaterThan(0)
      expect(Usd.from(reserved[0] as string).compare(Usd.from(0))).toBeGreaterThan(0)
      const totals = await store.budget.read(session.sessionId, FAKE_MODEL_API_ACCOUNT_ID)
      expect(totals.spentUsd).toBe(Usd.from(0).toAmount())
      expect(
        log.warn.mock.calls.some((call) => String(call[0]).includes('ended without its usage')),
      ).toBe(false)
      const recorded = notes.find((note) => note.context.outcome === 'refused')
      expect(recorded?.context.uncertain).toBe(false)
    } finally {
      await host.close()
      await t.close()
    }
  })
})
