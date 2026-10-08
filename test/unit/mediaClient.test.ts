import { Usd as PortUsd } from '../../src/shared/usd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createSchedulePaidScope } from '../../src/core/paid/paidConsent'
import { fakeSchedule, fakeRunContext } from './helpers/schedules/fixtures'
import { unattendedRun } from './helpers/schedules/unattended'
import { quotedSearch } from './helpers/paidQuote'
import { removeFolder } from './helpers/temporaryFolders'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { UI_TEXT } from '../../src/shared/constants'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { RequestTransport } from '../../src/core/backends/modelapi/transport'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { MediaCostEstimator, reserveMediaRequest } from '../../src/core/media/mediaCost'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClientSettings,
  type ScriptedReply,
} from './helpers/fakeModelApi'

async function setup(reply?: ScriptedReply) {
  const api = fakeModelApi()
  api.script(reply ?? { usage: { input: 3000, output: 40, cached: 1000 } })
  const log = new FakeLogOutputChannel()
  const sleep = vi.fn((_ms: number) => Promise.resolve())
  const settings = { ...fakeModelApiClientSettings(log), sleep }
  const client = new ModelApiClient({ ...settings, fetch: api.fetch })
  const modelId = 'muse-spark-1.3-contributor'
  const claims = [0, 1].map(() => ({
    check: vi.fn(),
    settle: vi.fn((_usd: UsdAmount, _hasUnknownCost?: boolean) => Promise.resolve()),
  }))
  const write = vi.fn((_points: readonly unknown[]) => Promise.resolve())
  const estimator = new MediaCostEstimator({
    safetyFactor: 2,
    read: () => [
      {
        provider: 'meta',
        modelId,
        variant: { kind: 'video', fps: null },
        units: 10,
        inputTokens: 2751,
        captureId: 'U4-summary',
        upperOnly: false,
      },
    ],
    write,
  })
  const accounting = await reserveMediaRequest({
    provider: 'meta',
    modelId,
    estimator,
    log,
    items: [
      {
        info: {
          kind: 'video',
          mediaType: 'video/mp4',
          sizeBytes: 500_000,
          durationSeconds: 10,
          hasSoundtrack: false,
        },
      },
    ],
    textInputTokens: 170,
    maxOutputTokens: 100,
    prices: { input: 0.1, output: 0.2, cachedInput: 0.025 },
    captureId: 'fake-terminal',
    session: { reserve: () => Promise.resolve(claims[0]!) },
    daily: { reserve: () => Promise.resolve(claims[1]!) },
  })
  // This tests accounting against the existing captured Responses envelope.
  // The future media builder supplies real parts; no wire shape is invented.
  const body: CreateResponseBody = {
    model: modelId,
    input: [],
    instructions: '',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'none', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 100,
    prompt_cache_key: 'media',
    prompt_cache_retention: '24h',
  }
  const guard = Object.assign(vi.fn(), { mediaAccounting: accounting })
  const run = (requestBody = body) =>
    Array.fromAsync(
      client.streamResponse(requestBody, new AbortController().signal, undefined, undefined, guard),
    )
  return { api, client, settings, body, accounting, claims, write, guard, run, log }
}

const scheduleDirectories: string[] = []
afterEach(async () => {
  for (const directory of scheduleDirectories.splice(0)) await removeFolder(directory)
})

async function scheduledMedia(t: Awaited<ReturnType<typeof setup>>, cap = 1, sharedCap = 5) {
  const directory = await mkdtemp(path.join(tmpdir(), 'm115-media-budget-'))
  scheduleDirectories.push(directory)
  const daily = createPaidDailyBudget({
    directory,
    now: () => new Date(2026, 9, 8, 12).getTime(),
    capUsd: () => Usd.from(sharedCap).toAmount(),
    isModelApi: () => true,
    sleep: () => Promise.resolve(),
  })
  const identity = {
    modelId: t.body.model,
    accountId: FAKE_MODEL_API_ACCOUNT_ID,
    priceTier: 'contributor',
    price: 'Captured token rates',
    sharedDailyBudgetUsd: Usd.from(sharedCap).toAmount(),
  }
  const schedule = fakeSchedule({
    paidCapUsd: Usd.from(cap).toAmount(),
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(cap).toAmount() },
    paidConsent: {
      modelId: identity.modelId,
      accountId: identity.accountId,
      priceTier: identity.priceTier,
      sharedDailyBudgetUsd: Usd.from(sharedCap).toAmount(),
      dailyCapUsd: Usd.from(cap).toAmount(),
      grantedAtMs: 0,
      extras: ['webSearch'],
    },
  })
  const reserve = vi.fn(daily.reserveSchedule)
  const scope = createSchedulePaidScope({
    backend: 'modelApi',
    schedule,
    identity,
    currentIdentity: () => identity,
    isCurrent: () => true,
    isOn: () => true,
    // Plain-text estimation cannot stand in for the admitted complete media request.
    estimate: () => Usd.from('0.00001').toAmount(),
    reserve,
  })
  const { run } = unattendedRun({ context: fakeRunContext(schedule), paid: scope })
  const client = t.client.withScheduleAuthority(() => run)
  const consume = (body = t.body) =>
    Array.fromAsync(
      client.streamResponse(body, new AbortController().signal, undefined, undefined, t.guard),
    )
  return { daily, scope, reserve, run, consume }
}

describe('media accounting at the transport', () => {
  it.each([
    { name: 'claims complete media at its exact price', hasSearch: false, spentUsd: '0.000233' },
    {
      name: 'includes hosted fees and settles both tariffs once',
      hasSearch: true,
      spentUsd: '0.002733',
    },
  ])('$name and records returned cost', async ({ hasSearch, spentUsd }) => {
    const t = await setup(
      hasSearch
        ? {
            usage: { input: 3000, output: 40, cached: 1000 },
            searches: [{ queries: ['clip'] }],
          }
        : undefined,
    )
    if (hasSearch)
      Object.assign(t.guard, { searchQuote: quotedSearch('0.0025', t.body.model).quote })
    const fire = await scheduledMedia(t)
    await fire.consume(
      hasSearch ? { ...t.body, tools: [{ type: 'web_search' }], max_tool_calls: 1 } : t.body,
    )
    expect(fire.reserve).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      hasSearch ? '0.0030872' : t.accounting.reservedUsd,
      expect.any(AbortSignal),
    )
    const latest = await fire.daily.latestDay()
    expect(latest.spentUsd).toBe(spentUsd)
    expect(fire.scope.cost()).toEqual({
      usd: Number(spentUsd),
      certainty: 'exact',
      retainedLiabilityUsd: PortUsd.from(0).toAmount(),
    })
    expect(t.claims[0]!.settle).toHaveBeenCalledExactlyOnceWith('0.000233', false)
    expect(t.claims[1]!.settle).toHaveBeenCalledExactlyOnceWith('0')
  })

  it.each(['schedule', 'shared'] as const)(
    'refuses scheduled media past the %s cap before HTTP and refunds nonsent work',
    async (cap) => {
      const t = await setup()
      const fire = await scheduledMedia(
        t,
        cap === 'schedule' ? 0.0001 : 1,
        cap === 'shared' ? 0.0001 : 5,
      )
      await expect(fire.consume()).rejects.toThrow()
      expect(t.api.requests).toHaveLength(0)
      const latest = await fire.daily.latestDay()
      expect(latest.spentUsd).toBe('0')
      expect(fire.scope.cost()).toEqual({
        usd: PortUsd.from(0).toAmount(),
        certainty: 'exact',
        retainedLiabilityUsd: PortUsd.from(0).toAmount(),
      })
      expect(fire.run.refusedActions).toHaveLength(1)
      expect(t.claims[0]!.settle).toHaveBeenCalledExactlyOnceWith('0', false)
      expect(t.claims[1]!.settle).toHaveBeenCalledExactlyOnceWith('0', false)
    },
  )

  it('retains a scheduled media liability when sent usage is missing', async () => {
    const t = await setup({ omitUsage: true })
    const fire = await scheduledMedia(t)
    await fire.consume()
    await expect(fire.daily.latestDay()).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    const today = await fire.daily.readToday()
    expect(today[0]?.budget).toMatchObject({
      spentUsd: Number(t.accounting.reservedUsd),
      uncertainUsd: Number(t.accounting.reservedUsd),
    })
    expect(fire.scope.cost()).toEqual({
      usd: PortUsd.from(0).toAmount(),
      certainty: 'unknown',
      retainedLiabilityUsd: Number(t.accounting.reservedUsd),
    })
  })

  it('delivers a successful terminal response and warns when the local calibration cache cannot be written', async () => {
    const t = await setup()
    t.write.mockRejectedValueOnce(new Error('calibration store unavailable: /private/path'))
    const events = await t.run()
    expect(events.at(-1)?.type).toBe('response.completed')
    for (const claim of t.claims)
      expect(claim.settle).toHaveBeenCalledExactlyOnceWith('0.000233', false)
    expect(t.log.warn).toHaveBeenCalledExactlyOnceWith('Media calibration cache write failed')
    expect(t.write).toHaveBeenCalledOnce()
  })

  it('uses one whole-request token claim for media with a paid feature and web search enabled', async () => {
    const t = await setup()
    const reservePaidRequest = vi.fn(() => Promise.reject(new Error('duplicate token claim')))
    const client = new ModelApiClient({
      ...t.settings,
      fetch: t.api.fetch,
      reservePaidRequest,
    })
    const guard = Object.assign(t.guard, {
      paidFeature: 'subagents' as const,
      paidEstimatedInputTokens: t.accounting.inputTokens,
    })
    const events = await Array.fromAsync(
      client.streamResponse(
        { ...t.body, tools: [{ type: 'web_search' }], max_tool_calls: 1 },
        new AbortController().signal,
        undefined,
        undefined,
        guard,
      ),
    )
    expect(events.at(-1)?.type).toBe('response.completed')
    expect(reservePaidRequest).not.toHaveBeenCalled()
    expect(t.guard).toHaveBeenCalledOnce()
    expect(t.api.requests).toHaveLength(1)
    for (const claim of t.claims)
      expect(claim.settle).toHaveBeenCalledExactlyOnceWith('0.000233', false)
  })

  it('keeps hosted-fee refusal in the final admission guard before a media request dispatches', async () => {
    const t = await setup()
    t.guard.mockImplementation(() => {
      throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
    })
    await expect(t.run({ ...t.body, tools: [{ type: 'web_search' }] })).rejects.toThrow(
      UI_TEXT.sessionBudgetSearchUnavailable,
    )
    expect(t.api.requests).toHaveLength(0)
    for (const claim of t.claims) expect(claim.settle).toHaveBeenCalledExactlyOnceWith('0', false)
  })

  it.each(['complete', 'incomplete', 'failed'])(
    'settles a verified %s terminal bill',
    async (terminal) => {
      const t = await setup({
        usage: { input: 3000, output: 40, cached: 1000 },
        ...(terminal === 'incomplete' && { incomplete: { reason: 'max_output_tokens' } }),
        ...(terminal === 'failed' && { failed: { code: 'fake', message: 'failed' } }),
      })
      await t.run()
      const actual = '0.000233'
      for (const claim of t.claims)
        expect(claim.settle).toHaveBeenCalledExactlyOnceWith(actual, false)
      expect(t.write).toHaveBeenCalledOnce()
    },
  )

  it('rechecks ledgers before fetch and refunds if a final fence refuses', async () => {
    const t = await setup()
    t.claims[1]!.check.mockImplementationOnce(() => {
      throw new Error('daily changed')
    })
    await expect(t.run()).rejects.toThrow('daily changed')
    expect(t.api.requests).toHaveLength(0)
    for (const claim of t.claims)
      expect(claim.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    expect(t.write).not.toHaveBeenCalled()
  })

  it.each(['missing', 'fractional', 'excessCached', 'absentTerminal'])(
    'retains uncertain liability for %s usage',
    async (mode) => {
      const t = await setup({
        omitUsage: mode === 'missing',
        omitTerminal: mode === 'absentTerminal',
        ...(mode === 'fractional' && { usageOverride: { input_tokens: 0.5, output_tokens: 1 } }),
        ...(mode === 'excessCached' && {
          usageOverride: {
            input_tokens: 1,
            output_tokens: 1,
            input_tokens_details: { cached_tokens: 2 },
          },
        }),
      })
      await t.run()
      for (const claim of t.claims)
        expect(claim.settle).toHaveBeenCalledExactlyOnceWith(t.accounting.reservedUsd, true)
      expect(t.write).not.toHaveBeenCalled()
    },
  )

  it.each([400, 429])('refunds an explicitly refused HTTP %s request', async (status) => {
    const t = await setup({ httpError: { status } })
    await expect(t.run()).rejects.toThrow()
    for (const claim of t.claims)
      expect(claim.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
  })

  it('retries an explicitly nonsent 429, but never an ambiguous 500 or network failure', async () => {
    const throttled = await setup({ httpError: { status: 429 } })
    throttled.api.script({ httpError: { status: 429 } }, { usage: { input: 3000, output: 40 } })
    await throttled.run()
    expect(throttled.api.requests).toHaveLength(2)
    for (const reply of [{ httpError: { status: 500 } }, { networkError: 'connection lost' }]) {
      const t = await setup(reply)
      await expect(t.run()).rejects.toThrow()
      expect(t.api.requests).toHaveLength(1)
      expect(t.settings.sleep).not.toHaveBeenCalled()
      expect(t.claims[0]!.settle).toHaveBeenCalledWith(t.accounting.reservedUsd, true)
    }
  })

  it('refunds missing-key, aborted and changed-model requests before dispatch', async () => {
    const missing = await setup()
    const noKey = new ModelApiClient({
      ...missing.settings,
      apiKey: () => Promise.resolve(undefined),
      fetch: missing.api.fetch,
    })
    await expect(
      Array.fromAsync(
        noKey.streamResponse(
          missing.body,
          new AbortController().signal,
          undefined,
          undefined,
          missing.guard,
        ),
      ),
    ).rejects.toThrow('No Model API key')
    expect(missing.claims[0]!.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0).toAmount(), false)
    const changed = await setup()
    await expect(changed.run({ ...changed.body, model: 'muse-spark-1.3' })).rejects.toThrow(
      'reservation does not match',
    )
    expect(changed.api.requests).toHaveLength(0)
    expect(changed.claims[0]!.settle).toHaveBeenCalledWith(Usd.from(0).toAmount(), false)
    const stopped = await setup()
    await expect(
      Array.fromAsync(
        stopped.client.streamResponse(
          stopped.body,
          AbortSignal.abort(),
          undefined,
          undefined,
          stopped.guard,
        ),
      ),
    ).rejects.toThrow()
    expect(stopped.api.requests).toHaveLength(0)
    expect(stopped.claims[0]!.settle).toHaveBeenCalledWith(Usd.from(0).toAmount(), false)
  })
})

describe('integrated Files transport', () => {
  it('checks the endpoint before Files dispatch and refuses without sending credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const verifyEndpoint = vi.fn(() => Promise.reject(new Error('endpoint refused')))
    const transport = new RequestTransport({
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      fetch,
      verifyEndpoint,
    })
    await expect(
      transport.requestFile('/files', 'GET', new AbortController().signal),
    ).rejects.toThrow('endpoint refused')
    expect(verifyEndpoint).toHaveBeenCalledExactlyOnceWith('https://api.example.test/v1/files')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('scrubs a Files HTTP failure with the current request credential', async () => {
    const settings = fakeModelApiClientSettings(new FakeLogOutputChannel())
    const key = await settings.apiKey()
    const transport = new RequestTransport({
      ...settings,
      fetch: () =>
        Promise.resolve(
          Response.json({ error: { message: `failure ${key ?? ''}` } }, { status: 403 }),
        ),
    })
    await expect(
      transport.requestFile('/files', 'GET', new AbortController().signal),
    ).rejects.toThrow('failure [redacted]')
  })
})
