// EXECPROV round 6: exact same-body input counts shrink the run-cap
// reservation where the provider documents one. Each test fails without its
// product change: the byte-bound fake, the fallback, the billed count, the
// lying count, the untouched client and the remedy details each pin one
// behaviour of the reservation the run actually holds.
import { describe, expect, it, vi } from 'vitest'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import {
  modelPolicyFor,
  type ModelClient,
  type ModelPricedUsage,
  type ResolvedModel,
} from '../../src/core/backends/modelapi/modelPolicy'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import type {
  CreateResponseBody,
  StreamEvent,
  Usage,
} from '../../src/core/backends/modelapi/schemas'
import type { SessionBudgetClaim } from '../../src/core/backends/modelapi/sessionBudget'
import {
  reserveRequestAmount,
  settleUsageAmount,
  type PriceCard,
} from '../../src/core/providers/priceCard'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import {
  budgetRefusalDetails,
  responseReservationMessage,
  withRuntimeAccounting,
  type RuntimeResponseAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { budgetFinalMessage } from '../../src/runtime/exec/runExec'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../src/core/providers/configured'
import {
  providerEntrySchema,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { PROVIDER_SECRET_PREFIX } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// $5/M input, $20/M output, $0.50/M cached reads: the measured run's tier in
// per-token card units.
const CARD: PriceCard = { input: 0.000005, output: 0.00002, cachedInput: 0.0000005, source: 'user' }
const TIER = {
  input: Usd.from('0.000005').toAmount(),
  cachedInput: Usd.from('0.0000005').toAmount(),
  output: Usd.from('0.00002').toAmount(),
}
const REF = 'test/fake-model'

function bodyWithText(text: string): CreateResponseBody {
  return {
    model: REF,
    instructions: 'System instructions for the fake run.',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }],
    tools: [],
    tool_choice: 'auto',
    stream: true,
    store: false,
    max_output_tokens: 64,
    reasoning: { effort: 'minimal' },
    include: [],
    prompt_cache_key: 'test-prefix',
    prompt_cache_retention: '24h',
  }
}

function usageFor(input: number, output: number): Usage {
  return { input_tokens: input, output_tokens: output, total_tokens: input + output }
}

function completedEvent(usage: Usage): StreamEvent {
  return {
    type: 'response.completed',
    response: { id: 'resp-1', status: 'completed', output: [], usage },
  }
}

const price = {
  reserve: (usage: ModelPricedUsage) =>
    Usd.from(
      reserveRequestAmount(CARD, { ...usage, cacheWriteTokens: usage.inputTokens }),
    ).toAmount(),
  settle: (usage: ModelPricedUsage, reported?: { cost?: UsdAmount | undefined }) =>
    settleUsageAmount(CARD, usage, reported),
}

function dailyStub(settled: UsdAmount[]) {
  return {
    capUsd: () => Usd.from(100).toAmount(),
    reserve: (costUsd: UsdAmount, _signal: AbortSignal): Promise<SessionBudgetClaim> =>
      Promise.resolve({
        claimId: 'test-claim',
        reservedUsd: costUsd,
        check: () => ({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
        settle: (actual: UsdAmount) => {
          settled.push(actual)
          return Promise.resolve({ spentUsd: actual, hasUnknownHistoricalFees: false })
        },
      }),
  }
}

interface DriveResult {
  readonly admitted: boolean
  readonly ticket: { reserveUsd: UsdAmount; inputBound: string | undefined }
  readonly settledUsd: UsdAmount
  readonly uncertainUsd: UsdAmount
  readonly refusals: { reason: string; details: unknown }[]
  readonly dailySettled: UsdAmount[]
  readonly plainCalls: number
  readonly requests: number
}

/** One priced request through the real admission/settlement path, no sockets. */
async function driveOnce(options: {
  capUsd: string
  text: string
  detailed?: ModelClient['countInputTokensDetailed']
  replyUsage?: Usage
  withoutLedger?: boolean
}): Promise<DriveResult> {
  const countInputTokens = vi.fn(() => Promise.resolve(0))
  const inner: ModelClient = {
    currentKeyDigest: () => Promise.resolve('test'),
    countInputTokens,
    listModels: () => Promise.resolve([REF]),
    retryDelayMs: () => 0,
    waitBeforeRetry: () => Promise.resolve(),
    ...(options.detailed !== undefined && { countInputTokensDetailed: options.detailed }),
    streamResponse: async function* (_body, _signal, _onRetry, _retryBudget, guard) {
      await guard?.prepare?.()
      guard?.onRequestStarted?.()
      yield completedEvent(options.replyUsage ?? usageFor(100, 10))
    },
  }
  const resolved: ResolvedModel = {
    ref: REF,
    origin: 'https://example.test',
    contextTokens: 200_000,
    client: inner,
    policy: modelPolicyFor(REF, {
      pricing: { kind: 'priced', card: CARD },
      maxOutputTokens: 32_768,
    }),
    price,
    isCurrent: () => true,
  }
  const outer: ProviderClient = {
    currentKeyDigest: () => Promise.resolve('test'),
    countInputTokens: () => Promise.resolve(0),
    listModels: () => Promise.resolve([REF]),
    retryDelayMs: () => 0,
    waitBeforeRetry: () => Promise.resolve(),
    createImage: () => Promise.reject(new Error('unused')),
    editImage: () => Promise.reject(new Error('unused')),
    hasPaidDailyBudget: false,
    models: { resolve: () => Promise.resolve(resolved) },
    streamResponse: async function* (): AsyncGenerator<StreamEvent> {
      await Promise.resolve()
      yield* []
    },
  }
  const ledger = createRunLedger({
    capUsd: Usd.from(options.capUsd).toAmount(),
    maxRequests: 5,
    outputCap: () => 32_768,
  })
  const started: { reserveUsd: UsdAmount; inputBound: string | undefined }[] = []
  const refusals: { reason: string; details: unknown }[] = []
  const accounting: RuntimeResponseAccounting = {
    ledger,
    refuse: (reason, _message, details) => {
      refusals.push({ reason, details })
    },
    started: (_n, ticket) => {
      started.push({ reserveUsd: ticket.reserveUsd, inputBound: ticket.inputBound })
    },
    settled: () => undefined,
  }
  const dailySettled: UsdAmount[] = []
  const wrapped = withRuntimeAccounting(
    outer,
    dailyStub(dailySettled),
    options.withoutLedger === true ? undefined : accounting,
  )
  const seenModels = wrapped.models
  if (seenModels === undefined) throw new Error('missing models')
  const model = await seenModels.resolve(REF)
  const drained = await Array.fromAsync(
    model.client.streamResponse(bodyWithText(options.text), new AbortController().signal),
  )
  expect(drained).toHaveLength(1)
  const totals = ledger.totals()
  return {
    admitted: started.length > 0,
    ticket: started[0] ?? { reserveUsd: Usd.from(0).toAmount(), inputBound: undefined },
    settledUsd: totals.settledUsd,
    uncertainUsd: totals.uncertainUsd,
    refusals,
    dailySettled,
    plainCalls: countInputTokens.mock.calls.length,
    requests: totals.requests,
  }
}

const TEXT = `lorem ipsum dolor sit amet, consectetur adipiscing elit. `.repeat(50)

describe('exact same-body input counts', () => {
  it('an exact count shrinks the reservation to the counted input at list price', async () => {
    const detailed = vi.fn(
      (_body: CreateResponseBody): Promise<{ tokens: number; costUsd: UsdAmount | undefined }> =>
        Promise.resolve({ tokens: 100, costUsd: undefined }),
    )
    const run = await driveOnce({ capUsd: '10', text: TEXT, detailed })
    expect(detailed).toHaveBeenCalledTimes(1)
    // The count sees the request's own body: same model and same text.
    const seen = detailed.mock.calls[0]?.[0]
    expect(seen?.model).toBe(REF)
    expect(JSON.stringify(seen)).toContain('lorem ipsum')
    // 100 counted tokens at $5/M plus 64 output tokens at $20/M.
    expect(run.ticket.reserveUsd).toBe('0.00178')
    expect(run.ticket.inputBound).toBe('exact')
    expect(run.plainCalls).toBe(0)
    // The settled usage prices the same counted input, not the bytes.
    expect(run.settledUsd).toBe('0.0007')
    expect(run.dailySettled).toEqual(['0.0007'])
    expect(run.refusals).toEqual([])
  })

  it('a failing count falls back to exactly the byte-bound reservation', async () => {
    const failing = vi.fn((): Promise<{ tokens: number; costUsd?: UsdAmount }> =>
      Promise.reject(new Error('count unavailable')),
    )
    const text = TEXT
    const fallen = await driveOnce({ capUsd: '10', text, detailed: failing })
    const baseline = await driveOnce({ capUsd: '10', text })
    expect(fallen.ticket.reserveUsd).toBe(baseline.ticket.reserveUsd)
    expect(fallen.ticket.reserveUsd).not.toBe('0.00178')
    expect(fallen.ticket.inputBound).toBe('bytes-after-failure')
    expect(baseline.ticket.inputBound).toBeUndefined()
    expect(fallen.settledUsd).toBe(baseline.settledUsd)
  })

  it('a client without an exact count sends no count request at all', async () => {
    const run = await driveOnce({ capUsd: '10', text: TEXT })
    expect(run.plainCalls).toBe(0)
    expect(run.ticket.inputBound).toBeUndefined()
    expect(run.refusals).toEqual([])
  })

  it('an interactive run without a ledger never counts, even where offered', async () => {
    const detailed = vi.fn(
      (_body: CreateResponseBody): Promise<{ tokens: number; costUsd: UsdAmount | undefined }> =>
        Promise.resolve({ tokens: 100, costUsd: undefined }),
    )
    const run = await driveOnce({ capUsd: '10', text: TEXT, detailed, withoutLedger: true })
    expect(detailed).not.toHaveBeenCalled()
    expect(run.admitted).toBe(false)
    expect(run.dailySettled).toEqual(['0.0007'])
  })

  it('a billed count is reserved and settled in the ledger', async () => {
    const detailed = vi.fn(() =>
      Promise.resolve({ tokens: 100, costUsd: Usd.from('0.01').toAmount() }),
    )
    const run = await driveOnce({ capUsd: '10', text: TEXT, detailed })
    // The request hold covers the request plus the billed count.
    expect(run.ticket.reserveUsd).toBe('0.01178')
    // The settled usage charge keeps the count on top.
    expect(run.settledUsd).toBe('0.0107')
    expect(run.dailySettled).toEqual(['0.0107'])
  })

  it('a count lower than the real usage stops the run inside its cap', async () => {
    const detailed = vi.fn(() => Promise.resolve({ tokens: 1, costUsd: undefined }))
    const run = await driveOnce({
      capUsd: '0.05',
      text: TEXT,
      detailed,
      replyUsage: usageFor(40_000, 64),
    })
    // The lying count admitted: 1 token plus the output cap.
    expect(run.ticket.reserveUsd).toBe('0.001285')
    // The actual $0.20128 exceeds the hold: breach latches, the full hold is
    // kept as uncertain, and nothing settles past the cap.
    expect(run.refusals.map((refusal) => refusal.reason)).toContain('breach')
    expect(run.settledUsd).toBe('0')
    expect(run.uncertainUsd).toBe('0.001285')
  })
})

function requestUsd(inputTokens: number, outputTokens: number): UsdAmount {
  return Usd.from('0.000005')
    .times(inputTokens)
    .add(Usd.from('0.00002').times(outputTokens))
    .toAmount()
}

function reserveForOutput(outputTokens: number): UsdAmount {
  return requestUsd(8000, outputTokens)
}

function quoteFor(reserveUsd: UsdAmount, settled: string) {
  const ledger = createRunLedger({
    capUsd: Usd.from('0.1').toAmount(),
    maxRequests: 5,
    outputCap: () => 32_768,
  })
  const first = ledger.admitResponse({
    model: REF,
    maxOutputTokens: 1000,
    contextTokens: 200_000,
    reserveUsd,
    price: TIER,
  })
  if ('refused' in first) throw new Error('setup admission refused')
  ledger.settleResponse(
    first,
    {
      kind: 'eof',
      terminal: 'completed',
      incompleteReason: null,
      usage: usageFor(8000, 1000),
      parseInvalid: false,
    },
    { costUsd: Usd.from(settled).toAmount() },
  )
  return ledger.totals()
}

describe('budget refusal details', () => {
  it('the typed refusal names the same cap remedy as the sentence', () => {
    const totals = quoteFor(Usd.from('0.05').toAmount(), '0.05')
    const quote = {
      inputTokens: 8000,
      inputCost: Usd.from('0.04').toAmount(),
      outputTokens: 1000,
      reserveUsd: Usd.from('0.06').toAmount(),
      totals,
    }
    const details = budgetRefusalDetails(quote, reserveForOutput, 1)
    const message = responseReservationMessage(quote, 'terminal', reserveForOutput, 1)
    // $0.05 settled plus the $0.06 hold admits at $0.11; $0.04 of input
    // leaves $0.01, which fits 500 output tokens at $20/M.
    expect(details).toMatchObject({
      remainingUsd: Usd.from('0.05').toAmount(),
      admitCapUsd: Usd.from('0.11').toAmount(),
      maxOutputTokens: 500,
      inputAloneExceeds: false,
    })
    expect(message).toContain(
      `Raise --max-budget-usd to at least ${formatUsd(details.admitCapUsd, 2)} to admit it.`,
    )
    expect(message).toContain('Or retry with --max-output-tokens 500.')
  })

  it('the suggested output limit is admitted on the same ledger', () => {
    const totals = quoteFor(Usd.from('0.05').toAmount(), '0.05')
    const quote = {
      inputTokens: 8000,
      inputCost: Usd.from('0.04').toAmount(),
      outputTokens: 1000,
      reserveUsd: Usd.from('0.06').toAmount(),
      totals,
    }
    const details = budgetRefusalDetails(quote, reserveForOutput, 1)
    expect(details.maxOutputTokens).not.toBeNull()
    const ledger = createRunLedger({
      capUsd: Usd.from('0.1').toAmount(),
      maxRequests: 5,
      outputCap: () => 32_768,
    })
    const settled = ledger.admitResponse({
      model: REF,
      maxOutputTokens: 1000,
      contextTokens: 200_000,
      reserveUsd: Usd.from('0.05').toAmount(),
      price: TIER,
    })
    if ('refused' in settled) throw new Error('setup admission refused')
    ledger.settleResponse(
      settled,
      {
        kind: 'eof',
        terminal: 'completed',
        incompleteReason: null,
        usage: usageFor(8000, 1000),
        parseInvalid: false,
      },
      { costUsd: Usd.from('0.05').toAmount() },
    )
    const fitting = ledger.admitResponse({
      model: REF,
      maxOutputTokens: details.maxOutputTokens ?? 0,
      contextTokens: 200_000,
      reserveUsd: reserveForOutput(details.maxOutputTokens ?? 0),
      price: TIER,
    })
    expect('refused' in fitting).toBe(false)
    // The fitting ticket never dispatches: withdraw it before the next check.
    if (!('refused' in fitting)) ledger.releaseResponse(fitting)
    const over = ledger.admitResponse({
      model: REF,
      maxOutputTokens: (details.maxOutputTokens ?? 0) + 1,
      contextTokens: 200_000,
      reserveUsd: reserveForOutput((details.maxOutputTokens ?? 0) + 1),
      price: TIER,
    })
    // The suggestion is exact: one token more does not fit the same cap.
    expect('refused' in over).toBe(true)
  })
})

async function presetServices(
  roots: string[],
  options: { preset: string; address: string; model: string; id?: string },
  entryOverrides: Record<string, unknown>,
  send: NonNullable<ConfiguredProviderOptions['send']>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-exact-'))
  roots.push(root)
  const id = options.id ?? 'p'
  const entry = providerEntrySchema.parse({
    id,
    preset: options.preset,
    address: options.address,
    auth: 'apiKey',
    models: [options.model],
    prices: { [options.model]: { input: 0.000005, output: 0.00002 } },
    ...entryOverrides,
  })
  const configFile = path.join(root, 'providers.json')
  const written = await writeProvidersFileAtomic(configFile, { v: 1, providers: [entry] })
  expect(written.ok).toBe(true)
  const secrets = memorySecrets()
  await secrets.store(
    `${PROVIDER_SECRET_PREFIX}${id}`,
    formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: options.address }, 'test-owned-key'),
  )
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
    secrets,
    resolve: () => Promise.resolve(['8.8.8.8']),
    send,
  })
  return { services, ref: `${id}/${options.model}` }
}

describe('configured exact-count offers', () => {
  const roots: string[] = []
  const cleanup = async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }

  async function openaiServices(
    entryOverrides: Record<string, unknown>,
    send: NonNullable<ConfiguredProviderOptions['send']>,
  ) {
    const { services } = await presetServices(
      roots,
      { preset: 'openai', address: 'https://api.openai.com', model: 'gpt-x', id: 'o' },
      entryOverrides,
      send,
    )
    return services
  }

  it('an OpenAI entry offers the documented same-body count', async () => {
    const posts: { url: string; body: unknown }[] = []
    const services = await openaiServices({}, (target, bytes = '') => {
      posts.push({ url: target.url.href, body: JSON.parse(bytes) })
      const payload = JSON.stringify({ input_tokens: 42 })
      return Promise.resolve({
        status: 200,
        headers: {},
        body: (async function* () {
          yield* await Promise.resolve([Buffer.from(payload)])
        })(),
        close: () => undefined,
      })
    })
    try {
      const model = await services.registry.resolve('o/gpt-x')
      const detailed = model.client.countInputTokensDetailed
      expect(typeof detailed).toBe('function')
      if (detailed === undefined) throw new Error('missing detailed count')
      const counted = await detailed(bodyWithText('hello exact'), new AbortController().signal)
      expect(counted).toEqual({ tokens: 42, costUsd: undefined })
      expect(posts).toHaveLength(1)
      // The documented sibling of the request path, carrying the request.
      expect(posts[0]?.url).toBe('https://api.openai.com/v1/responses/input_tokens')
      expect(posts[0]?.body).toMatchObject({ model: 'gpt-x', stream: true })
      expect(JSON.stringify(posts[0]?.body)).toContain('hello exact')
      // The byte bound stays for every other caller.
      expect(await model.client.countInputTokens(bodyWithText('hello exact'))).toBeGreaterThan(42)
    } finally {
      await cleanup()
    }
  })

  it('exactInputCount false and counter-less formats keep the byte bound with no offer', async () => {
    const off = await openaiServices({ exactInputCount: false }, () =>
      Promise.reject(new Error('no request may go out')),
    )
    try {
      const model = await off.registry.resolve('o/gpt-x')
      expect(model.client.countInputTokensDetailed).toBeUndefined()
    } finally {
      await cleanup()
    }
    // OpenAI-compatible chat completions document no counting call for the
    // exact request: the byte bound stays, with the fixed reason line.
    const { services: chat } = await presetServices(
      roots,
      { preset: 'custom', address: 'https://chat.example.test', model: 'chat-x', id: 'c' },
      { modelLimits: { 'chat-x': { contextTokens: 32_768, outputTokens: 4096 } } },
      () => Promise.reject(new Error('no request may go out')),
    )
    try {
      const model = await chat.registry.resolve('c/chat-x')
      expect(model.client.countInputTokensDetailed).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('the entry switch round-trips through the providers file', () => {
    expect(
      providerEntrySchema.parse({ id: 'o', preset: 'openai', auth: 'apiKey', models: [] })
        .exactInputCount,
    ).toBeUndefined()
    expect(
      providerEntrySchema.parse({
        id: 'o',
        preset: 'openai',
        auth: 'apiKey',
        models: [],
        exactInputCount: false,
      }),
    ).toMatchObject({ exactInputCount: false })
    expect(() =>
      providerEntrySchema.parse({
        id: 'o',
        preset: 'openai',
        auth: 'apiKey',
        models: [],
        exactInputCount: 'no',
      }),
    ).toThrow()
  })
})

describe('per-wire exact counts (round 7)', () => {
  const roots: string[] = []
  const cleanup = async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  }

  interface CountPost {
    readonly url: string
    readonly host: string
    readonly address: string
    readonly headers: Record<string, string>
    readonly body: unknown
    readonly signal: AbortSignal
  }

  // Thinking-capable wires gate the encode on the model's reasoning
  // record: declare modes so the `minimal`-effort fixture request encodes.
  const ANTHROPIC_CAPS = {
    'claude-x': {
      reasoning: {
        modes: { state: 'yes', value: ['adaptive'] },
        effortLevels: { state: 'yes', value: ['low', 'medium', 'high'] },
      },
    },
  }
  const GEMINI_CAPS = {
    'gemini-x': {
      reasoning: {
        modes: { state: 'yes', value: ['level'] },
        effortLevels: { state: 'yes', value: ['minimal', 'low', 'medium', 'high'] },
      },
    },
  }

  /** A fake wire speaking one count answer, recording every post it sees. */
  function countingWire(answer: string, status = 200) {
    const posts: CountPost[] = []
    const send: NonNullable<ConfiguredProviderOptions['send']> = (
      target,
      bytes = '',
      headers,
      signal,
    ) => {
      posts.push({
        url: target.url.href,
        host: target.host,
        address: target.address,
        headers: { ...headers },
        body: JSON.parse(bytes),
        signal,
      })
      return Promise.resolve({
        status,
        headers: {},
        body: (async function* () {
          yield* await Promise.resolve([Buffer.from(answer)])
        })(),
        close: () => undefined,
      })
    }
    return { posts, send }
  }

  it('anthropic posts the message body without max_tokens and stream to count_tokens', async () => {
    const wire = countingWire(JSON.stringify({ input_tokens: 81 }))
    const { services, ref } = await presetServices(
      roots,
      { preset: 'anthropic', address: 'https://api.anthropic.com', model: 'claude-x', id: 'a' },
      { modelCapabilities: ANTHROPIC_CAPS },
      wire.send,
    )
    try {
      const model = await services.registry.resolve(ref)
      const detailed = model.client.countInputTokensDetailed
      expect(typeof detailed).toBe('function')
      if (detailed === undefined) throw new Error('missing detailed count')
      const counted = await detailed(
        { ...bodyWithText('hello exact'), model: ref },
        new AbortController().signal,
      )
      expect(counted).toEqual({ tokens: 81, costUsd: undefined })
      expect(wire.posts).toHaveLength(1)
      const post = wire.posts[0]
      if (post === undefined) throw new Error('missing count post')
      // An abort signal rides every count end to end (the count's own
      // 30 s deadline at the latest; the transport combines its own
      // stall bound too), so a hanging counter cannot stall the
      // reservation.
      expect(post.signal).not.toBeNull()
      // The request path's documented counting sibling, same origin.
      expect(post.url).toBe('https://api.anthropic.com/v1/messages/count_tokens')
      expect(post.host).toBe('api.anthropic.com')
      // The same pinned-address path as the real request: no second network.
      expect(post.address).toBe('8.8.8.8')
      // The message request's own version headers ride the count.
      expect(post.headers['anthropic-version']).toBe('2023-06-01')
      const body = post.body as Record<string, unknown>
      expect(body['model']).toBe('claude-x')
      expect(JSON.stringify(body)).toContain('hello exact')
      expect(JSON.stringify(body)).toContain('System instructions')
      expect(body).not.toHaveProperty('max_tokens')
      expect(body).not.toHaveProperty('stream')
      expect(body).not.toHaveProperty('metadata')
      // The byte bound stays for every other caller.
      expect(await model.client.countInputTokens(bodyWithText('hello exact'))).toBeGreaterThan(81)
    } finally {
      await cleanup()
    }
  })

  it('gemini posts the native body without the output cap to countTokens', async () => {
    const wire = countingWire(JSON.stringify({ totalTokens: 82 }))
    const { services, ref } = await presetServices(
      roots,
      {
        preset: 'gemini',
        address: 'https://generativelanguage.googleapis.com',
        model: 'gemini-x',
        id: 'g',
      },
      { modelCapabilities: GEMINI_CAPS },
      wire.send,
    )
    try {
      const model = await services.registry.resolve(ref)
      const detailed = model.client.countInputTokensDetailed
      expect(typeof detailed).toBe('function')
      if (detailed === undefined) throw new Error('missing detailed count')
      const counted = await detailed(
        { ...bodyWithText('hello exact'), model: ref },
        new AbortController().signal,
      )
      expect(counted).toEqual({ tokens: 82, costUsd: undefined })
      expect(wire.posts).toHaveLength(1)
      const post = wire.posts[0]
      if (post === undefined) throw new Error('missing count post')
      // The stream suffix becomes :countTokens; the SSE query never rides.
      expect(post.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:countTokens',
      )
      expect(post.host).toBe('generativelanguage.googleapis.com')
      expect(post.address).toBe('8.8.8.8')
      const body = post.body as Record<string, unknown>
      expect(JSON.stringify(body)).toContain('hello exact')
      const generation = body['generationConfig'] as Record<string, unknown> | undefined
      expect(generation).toBeDefined()
      expect(generation).not.toHaveProperty('maxOutputTokens')
    } finally {
      await cleanup()
    }
  })

  it.each<[string, number, string]>([
    ['a non-2xx answer', 500, JSON.stringify({ input_tokens: 1 })],
    ['a body without a count', 200, JSON.stringify({})],
    ['a negative count', 200, JSON.stringify({ input_tokens: -1 })],
    ['a fractional count', 200, JSON.stringify({ input_tokens: 1.5 })],
    ['a wrong-shape count', 200, JSON.stringify({ totalTokens: 1 })],
  ])(
    'an anthropic count failure (%s) throws so the byte bound returns',
    async (_name, status, answer) => {
      const wire = countingWire(answer, status)
      const { services, ref } = await presetServices(
        roots,
        { preset: 'anthropic', address: 'https://api.anthropic.com', model: 'claude-x', id: 'a' },
        { modelCapabilities: ANTHROPIC_CAPS },
        wire.send,
      )
      try {
        const model = await services.registry.resolve(ref)
        const detailed = model.client.countInputTokensDetailed
        if (detailed === undefined) throw new Error('missing detailed count')
        await expect(
          detailed({ ...bodyWithText('hello exact'), model: ref }, new AbortController().signal),
        ).rejects.toThrow()
      } finally {
        await cleanup()
      }
    },
  )

  it('a signal-less count still carries the short deadline', async () => {
    const wire = countingWire(JSON.stringify({ input_tokens: 1 }))
    const { services, ref } = await presetServices(
      roots,
      { preset: 'anthropic', address: 'https://api.anthropic.com', model: 'claude-x', id: 'a' },
      { modelCapabilities: ANTHROPIC_CAPS },
      wire.send,
    )
    try {
      const model = await services.registry.resolve(ref)
      const detailed = model.client.countInputTokensDetailed
      if (detailed === undefined) throw new Error('missing detailed count')
      // No caller signal: the product still attaches its own 30 s deadline,
      // so a hanging counter cannot stall the reservation.
      await detailed({ ...bodyWithText('hello exact'), model: ref })
      expect(wire.posts).toHaveLength(1)
      expect(wire.posts[0]?.signal).not.toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('a count is sent once and never retried', async () => {
    let calls = 0
    const { services, ref } = await presetServices(
      roots,
      { preset: 'anthropic', address: 'https://api.anthropic.com', model: 'claude-x', id: 'a' },
      { modelCapabilities: ANTHROPIC_CAPS },
      () => {
        calls += 1
        return Promise.reject(new Error('count unavailable'))
      },
    )
    try {
      const model = await services.registry.resolve(ref)
      const detailed = model.client.countInputTokensDetailed
      if (detailed === undefined) throw new Error('missing detailed count')
      await expect(
        detailed({ ...bodyWithText('hello exact'), model: ref }, new AbortController().signal),
      ).rejects.toThrow()
      expect(calls).toBe(1)
    } finally {
      await cleanup()
    }
  })

  it('a count larger than the byte bound falls back to the byte bound', async () => {
    const lying = vi.fn(() => Promise.resolve({ tokens: 1_000_000, costUsd: undefined }))
    const run = await driveOnce({ capUsd: '10', text: TEXT, detailed: lying })
    const baseline = await driveOnce({ capUsd: '10', text: TEXT })
    expect(run.ticket.reserveUsd).toBe(baseline.ticket.reserveUsd)
    expect(run.ticket.inputBound).toBe('bytes-after-failure')
    expect(run.refusals).toEqual([])
  })

  it('the measured run reserves the counted input, not the 1,828,002 bytes', async () => {
    // The round-5 review that died at its cap: 1,828,002 input bytes
    // reserved as 1,828,002 tokens at $5/M. The counter answers 80,100.
    // The byte bound counts exactly the estimated parts (instructions,
    // tools, input items as JSON), so size the text to land on it exactly.
    const emptyParts = [
      JSON.stringify(bodyWithText('').instructions),
      JSON.stringify(bodyWithText('').tools),
      ...bodyWithText('').input.map((item) => JSON.stringify(item)),
    ]
    const overhead = emptyParts.reduce((sum, part) => sum + Buffer.byteLength(part), 0)
    const text = 'x'.repeat(1_828_002 - overhead)
    const counted = vi.fn(() => Promise.resolve({ tokens: 80_100, costUsd: undefined }))
    const run = await driveOnce({ capUsd: '10', text, detailed: counted })
    const baseline = await driveOnce({ capUsd: '10', text })
    expect(counted).toHaveBeenCalledTimes(1)
    // 80,100 input tokens at $5/M plus 64 output tokens at $20/M.
    expect(run.ticket.reserveUsd).toBe('0.40178')
    expect(run.ticket.inputBound).toBe('exact')
    // The byte bound it replaces, stated: 1,828,002 at $5/M plus output.
    expect(baseline.ticket.reserveUsd).toBe('9.14129')
    expect(baseline.ticket.inputBound).toBeUndefined()
    expect(run.refusals).toEqual([])
    // The count is never recorded as a model call: one ledgered request.
    expect(run.requests).toBe(1)
    expect(baseline.requests).toBe(1)
  })

  it('a gemini failure also keeps exactly the byte-bound reservation', async () => {
    const failing = vi.fn((): Promise<{ tokens: number; costUsd?: UsdAmount }> =>
      Promise.reject(new Error('count unavailable')),
    )
    const fallen = await driveOnce({ capUsd: '10', text: TEXT, detailed: failing })
    const baseline = await driveOnce({ capUsd: '10', text: TEXT })
    expect(fallen.ticket.reserveUsd).toBe(baseline.ticket.reserveUsd)
    expect(fallen.ticket.inputBound).toBe('bytes-after-failure')
  })
})

describe('budget final sentence', () => {
  it('kept text is shown with the kept-work sentence and both remedies', () => {
    expect(
      budgetFinalMessage({
        kept: ['first progress'],
        requests: 1,
        details: {
          neededUsd: Usd.from('0.694485').toAmount(),
          remainingUsd: Usd.from('0.005515').toAmount(),
          admitCapUsd: Usd.from('0.7').toAmount(),
          maxOutputTokens: 3043,
          inputAloneExceeds: false,
          inputCostUsd: Usd.from('0.039125').toAmount(),
        },
      }),
    ).toBe(
      'first progress The budget stopped the run after 1 request; work so far is kept. Raise --max-budget-usd to at least $0.70 to admit it. Or retry with --max-output-tokens 3043.',
    )
  })

  it('a run stopped while reading says no answer exists and never suggests the flag when it cannot fit', () => {
    const message = budgetFinalMessage({
      kept: [],
      requests: 0,
      details: {
        neededUsd: Usd.from('9.79537').toAmount(),
        remainingUsd: Usd.from('8.945843').toAmount(),
        admitCapUsd: Usd.from('14.54').toAmount(),
        maxOutputTokens: null,
        inputAloneExceeds: true,
        inputCostUsd: Usd.from('9.14001').toAmount(),
      },
    })
    expect(message).toContain(
      'The budget stopped the run while it was still reading, so no answer exists yet.',
    )
    expect(message).toContain('Raise --max-budget-usd to at least $14.54 to admit it.')
    expect(message).toContain('The input alone costs')
    expect(message).not.toContain('--max-output-tokens')
  })

  it('without refusal numbers the sentence stays the kept-work line', () => {
    expect(budgetFinalMessage({ kept: ['first progress'], requests: 2, details: undefined })).toBe(
      'first progress The budget stopped the run after 2 requests; work so far is kept.',
    )
    expect(budgetFinalMessage({ kept: [], requests: 0, details: undefined })).toBe(
      'The budget stopped the run while it was still reading, so no answer exists yet.',
    )
  })
})
