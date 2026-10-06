import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { MediaCostEstimator, reserveMediaRequest } from '../../src/core/media/mediaCost'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
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
    settle: vi.fn((_usd: number, _hasUnknownCost?: boolean) => Promise.resolve()),
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
  return { api, client, settings, body, accounting, claims, write, guard, run }
}

describe('media accounting at the transport', () => {
  it.each(['complete', 'incomplete', 'failed'])(
    'settles a verified %s terminal bill',
    async (terminal) => {
      const t = await setup({
        usage: { input: 3000, output: 40, cached: 1000 },
        ...(terminal === 'incomplete' && { incomplete: { reason: 'max_output_tokens' } }),
        ...(terminal === 'failed' && { failed: { code: 'fake', message: 'failed' } }),
      })
      await t.run()
      const actual = (2000 * 0.1 + 1000 * 0.025 + 40 * 0.2) / 1_000_000
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
    for (const claim of t.claims) expect(claim.settle).toHaveBeenCalledExactlyOnceWith(0, false)
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
    for (const claim of t.claims) expect(claim.settle).toHaveBeenCalledExactlyOnceWith(0, false)
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
    expect(missing.claims[0]!.settle).toHaveBeenCalledExactlyOnceWith(0, false)
    const changed = await setup()
    await expect(changed.run({ ...changed.body, model: 'muse-spark-1.3' })).rejects.toThrow(
      'reservation does not match',
    )
    expect(changed.api.requests).toHaveLength(0)
    expect(changed.claims[0]!.settle).toHaveBeenCalledWith(0, false)
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
    expect(stopped.claims[0]!.settle).toHaveBeenCalledWith(0, false)
  })
})
