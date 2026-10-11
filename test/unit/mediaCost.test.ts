import { describe, expect, it, vi } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { MediaCostEstimator, MediaContributorConsent } from '../../src/core/media/mediaCost'
import type { MediaInfo } from '../../src/shared/media'
import { UI_TEXT } from '../../src/shared/constants'

// U4's available usage summary, not invented raw response frames. No seed is
// shipped: the lead must supply the remaining capture ledger before wiring.
const provider = 'meta'
const modelId = 'muse-spark-1.3-contributor'
const clip: MediaInfo = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 500_000,
  durationSeconds: 10,
  hasSoundtrack: true,
}
const summaryPoint = {
  provider,
  modelId,
  variant: { kind: 'video', fps: null },
  units: 10,
  inputTokens: 2751,
  captureId: 'U4-summary',
  upperOnly: false,
}
const secondModel = { ...summaryPoint, modelId: 'muse-spark-1.2-contributor', inputTokens: 1671 }

function estimator(points: unknown = [summaryPoint, secondModel], safetyFactor = 2) {
  const write = vi.fn((_points: readonly unknown[]) => Promise.resolve())
  return { cost: new MediaCostEstimator({ read: () => points, write, safetyFactor }), write }
}

describe('media calibration', () => {
  it('reproduces both available U4 bills and reserves above every bill', () => {
    const { cost } = estimator()
    for (const point of [summaryPoint, secondModel]) {
      const result = cost.estimate(provider, point.modelId, { info: clip }, true)!
      expect(result.estimatedInputTokens).toBe(point.inputTokens)
      expect(result.upperBoundInputTokens).toBeGreaterThanOrEqual(point.inputTokens)
    }
  })

  it('uses the largest observed rate for its upper bound, never bytes or the count route', () => {
    // Longer points are test-only projections until U17b is supplied.
    const { cost } = estimator([
      summaryPoint,
      { ...summaryPoint, units: 30, inputTokens: 12_000, captureId: 'fake-long' },
      { ...summaryPoint, units: 120, inputTokens: 30_000, captureId: 'fake-longer' },
    ])
    const result = cost.estimate(provider, modelId, { info: clip }, true)!
    expect(result.estimatedInputTokens).toBe(2751)
    expect(result.upperBoundInputTokens).toBe(8000)
    expect(
      cost.estimate(provider, modelId, { info: { ...clip, sizeBytes: 50_000_000 } }, true),
    ).toEqual(result)
    expect(result.upperBoundInputTokens).toBeGreaterThan(170)
  })

  it('keeps provider, model, explicit fps and image detail calibrations separate', () => {
    const { cost } = estimator([
      summaryPoint,
      { ...summaryPoint, variant: { kind: 'video', fps: 1 }, inputTokens: 6000 },
      {
        ...summaryPoint,
        variant: { kind: 'image', detail: 'original' },
        units: 1,
        inputTokens: 2000,
      },
      { ...summaryPoint, variant: { kind: 'document' }, units: 4, inputTokens: 1000 },
    ])
    expect(
      cost.estimate(provider, modelId, { info: clip, fps: 1 }, true)?.estimatedInputTokens,
    ).toBe(6000)
    const image: MediaInfo = { kind: 'image', mediaType: 'image/png', sizeBytes: 100 }
    expect(
      cost.estimate(provider, modelId, { info: image, detail: 'original' }, true)
        ?.estimatedInputTokens,
    ).toBe(2000)
    expect(cost.estimate(provider, modelId, { info: image, detail: 'low' }, false)).toBeUndefined()
    expect(cost.estimate('other', modelId, { info: clip }, false)).toBeUndefined()
    expect(cost.estimate(provider, 'other-model', { info: clip }, false)).toBeUndefined()
    expect(cost.estimate(provider, modelId, { info: clip, fps: 2 }, false)).toBeUndefined()
    expect(
      cost.estimate(
        provider,
        modelId,
        { info: { kind: 'document', mediaType: 'application/pdf', sizeBytes: 200, pageCount: 8 } },
        true,
      )?.estimatedInputTokens,
    ).toBe(2000)
  })

  it('refuses unknown rate or duration in a capped session and preserves unknown otherwise', () => {
    const { cost } = estimator()
    expect(() => cost.estimate(provider, 'uncalibrated', { info: clip }, true)).toThrow(
      'calibrated media rate',
    )
    const unknown = { info: { ...clip, durationSeconds: null } }
    expect(() => cost.estimate(provider, modelId, unknown, true)).toThrow(
      UI_TEXT.media.cappedDurationUnknown,
    )
    expect(cost.estimate(provider, modelId, unknown, false)).toBeUndefined()
    expect(() =>
      cost.estimate(
        provider,
        modelId,
        { info: { kind: 'document', mediaType: 'application/pdf', sizeBytes: 100 } },
        true,
      ),
    ).toThrow('calibrated media rate')
    expect(() =>
      cost.estimate(
        provider,
        modelId,
        { info: { kind: 'text', mediaType: 'text/plain', sizeBytes: 100 } },
        true,
      ),
    ).toThrow('text estimator')
  })

  it('validates persisted evidence, variant options and the safety factor', () => {
    for (const invalid of [
      null,
      [{}],
      [{ ...summaryPoint, units: 0 }],
      [{ ...summaryPoint, inputTokens: Infinity }],
      [{ ...summaryPoint, inputTokens: -1 }],
      [{ ...summaryPoint, captureId: '' }],
    ]) {
      expect(() => estimator(invalid)).toThrow()
    }
    expect(() => estimator([], 0.9)).toThrow()
    expect(() => estimator([], NaN)).toThrow()
    expect(() =>
      estimator().cost.estimate(provider, modelId, { info: clip, fps: -1 }, false),
    ).toThrow()
  })

  it('adds settled usage locally and reloads that evidence', async () => {
    const t = estimator()
    await t.cost.observe(
      provider,
      modelId,
      [{ info: clip }],
      { input_tokens: 4000, output_tokens: 20, total_tokens: 4020 },
      'settled-turn',
    )
    expect(t.write).toHaveBeenCalledOnce()
    const saved = t.write.mock.calls[0]?.[0]
    expect(
      estimator(saved).cost.estimate(provider, modelId, { info: clip }, true)
        ?.upperBoundInputTokens,
    ).toBe(8000)
  })

  it('uses an indivisible mixed bill only to raise upper bounds', async () => {
    const t = estimator()
    await t.cost.observe(
      provider,
      modelId,
      [{ info: clip }, { info: clip }],
      { input_tokens: 9000, output_tokens: 1, total_tokens: 9001 },
      'mixed',
    )
    expect(t.cost.estimate(provider, modelId, { info: clip }, true)).toEqual({
      estimatedInputTokens: 2751,
      upperBoundInputTokens: 18_000,
    })
    const blank = estimator([])
    await blank.cost.observe(
      provider,
      modelId,
      [{ info: clip }, { info: clip }],
      { input_tokens: 9000, output_tokens: 1, total_tokens: 9001 },
      'mixed',
    )
    expect(blank.cost.estimate(provider, modelId, { info: clip }, false)).toBeUndefined()
  })

  it('keeps generated chip prices exact against integer nano-USD tariffs', () => {
    const { cost } = estimator()
    for (const durationSeconds of [1, 2, 10, 30, 120]) {
      for (const [price, nanoPerToken] of [
        [0.1, 100n],
        [0.025, 25n],
        [1.25, 1250n],
      ] as const) {
        const estimate = cost.chipEstimate(
          provider,
          modelId,
          { info: { ...clip, durationSeconds } },
          { standardInput: price, contributorInput: price },
          true,
        )
        expect(estimate).toBeDefined()
        for (const amount of [estimate?.standardCostUsd, estimate?.contributorCostUsd]) {
          expect(
            Usd.from(amount ?? '0')
              .times(1_000_000_000)
              .toString(),
          ).toBe(String(BigInt(estimate?.estimatedInputTokens ?? 0) * nanoPerToken))
        }
      }
    }
  })

  it('prices the chip from verified tier tariffs while preserving an unknown estimate', () => {
    const { cost } = estimator()
    expect(
      cost.chipEstimate(
        provider,
        modelId,
        { info: clip },
        {
          standardInput: 1.25,
          contributorInput: 0.1,
        },
        true,
      ),
    ).toEqual({
      estimatedInputTokens: 2751,
      upperBoundInputTokens: 5502,
      standardCostUsd: '0.00343875',
      contributorCostUsd: '0.0002751',
    })
    expect(
      cost.chipEstimate(provider, modelId, { info: clip }, { standardInput: 1 }, false),
    ).not.toHaveProperty('contributorCostUsd')
    expect(
      cost.chipEstimate(provider, 'uncalibrated', { info: clip }, { standardInput: 1 }, false),
    ).toBeUndefined()
    expect(() =>
      cost.chipEstimate(provider, modelId, { info: clip }, { standardInput: -1 }, false),
    ).toThrow()
  })

  it('keeps concurrent settlement observations and can save after a failed store write', async () => {
    const t = estimator()
    t.write.mockRejectedValueOnce(new Error('store busy'))
    const observe = (captureId: string) =>
      t.cost.observe(
        provider,
        modelId,
        [{ info: clip }],
        { input_tokens: 4000, output_tokens: 20 },
        captureId,
      )
    const results = await Promise.allSettled([
      observe('first'),
      observe('second'),
      observe('third'),
    ])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(t.write.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ captureId: 'second' }),
        expect.objectContaining({ captureId: 'third' }),
      ]),
    )
  })

  it('keeps old rates when the local store fails to save a settlement', async () => {
    const t = estimator()
    t.write.mockRejectedValueOnce(new Error('store unavailable'))
    await expect(
      t.cost.observe(
        provider,
        modelId,
        [{ info: clip }],
        { input_tokens: 9000, output_tokens: 1, total_tokens: 9001 },
        'turn',
      ),
    ).rejects.toThrow('store unavailable')
    expect(t.cost.estimate(provider, modelId, { info: clip }, true)?.upperBoundInputTokens).toBe(
      5502,
    )
  })
})

describe('contributor question', () => {
  const request = {
    conversationId: 'c1',
    name: 'clip.mp4',
    info: clip,
    contributor: true,
    isScreenRecording: false,
  }

  it('asks once per conversation after Send, and keeps different conversations independent', async () => {
    const ask = vi.fn((_question: unknown) => Promise.resolve<'send'>('send'))
    const consent = new MediaContributorConsent(ask)
    expect(await consent.choose(request)).toBe('send')
    expect(await consent.choose(request)).toBe('send')
    expect(ask).toHaveBeenCalledOnce()
    await consent.choose({ ...request, conversationId: 'c2' })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      title: expect.stringContaining('clip.mp4'),
      choices: ['send', 'useStandard', 'remove'],
    })
  })

  it.each(['useStandard', 'remove'] as const)(
    'does not remember %s as permission to send',
    async (choice) => {
      const ask = vi.fn((_question: unknown) => Promise.resolve(choice))
      const consent = new MediaContributorConsent(ask)
      expect(await consent.choose(request)).toBe(choice)
      expect(await consent.choose(request)).toBe(choice)
      expect(ask).toHaveBeenCalledTimes(2)
    },
  )

  it('asks every time for a screen recording, even after Send and on Standard', async () => {
    const ask = vi.fn((_question: unknown) => Promise.resolve<'send'>('send'))
    const consent = new MediaContributorConsent(ask)
    await consent.choose(request)
    await consent.choose({ ...request, isScreenRecording: true })
    await consent.choose({ ...request, isScreenRecording: true })
    await consent.choose({ ...request, isScreenRecording: true, contributor: false })
    expect(ask).toHaveBeenCalledTimes(4)
    expect(ask.mock.calls.at(-1)?.[0]).toMatchObject({ detail: UI_TEXT.media.recordingWarning })
  })

  it('remembers a Contributor recording Send for later ordinary media, without granting from Standard', async () => {
    for (const isContributor of [true, false]) {
      const ask = vi.fn((_question: unknown) => Promise.resolve<'send'>('send'))
      const consent = new MediaContributorConsent(ask)
      await consent.choose({ ...request, contributor: isContributor, isScreenRecording: true })
      await consent.choose(request)
      expect(ask).toHaveBeenCalledTimes(isContributor ? 1 : 2)
    }
  })

  it('includes audio but leaves ordinary Standard and image chips unchanged', async () => {
    const ask = vi.fn((_question: unknown) => Promise.resolve<'send'>('send'))
    const consent = new MediaContributorConsent(ask)
    await consent.choose({ ...request, contributor: false })
    await consent.choose({
      ...request,
      info: { kind: 'image', mediaType: 'image/png', sizeBytes: 50 },
    })
    expect(ask).not.toHaveBeenCalled()
    await consent.choose({
      ...request,
      info: { kind: 'audio', mediaType: 'audio/mpeg', sizeBytes: 50, durationSeconds: 1 },
    })
    expect(ask).toHaveBeenCalledOnce()
  })

  it('shares concurrent ordinary questions, but gives each recording its own question', async () => {
    const ask = vi.fn((_question: unknown) => Promise.resolve<'send'>('send'))
    const consent = new MediaContributorConsent(ask)
    await Promise.all([consent.choose(request), consent.choose(request)])
    expect(ask).toHaveBeenCalledOnce()
    await Promise.all([
      consent.choose({ ...request, isScreenRecording: true }),
      consent.choose({ ...request, isScreenRecording: true }),
    ])
    expect(ask).toHaveBeenCalledTimes(3)
  })
})
