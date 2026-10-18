import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEDIA_ESTIMATE_SAFETY_FACTOR, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { MediaCostEstimator } from '../../src/core/media/mediaCost'
import { productionCalibrationSeeds } from '../../src/core/media/mediaCalibration'

const seeds = productionCalibrationSeeds()

function estimator(points = seeds) {
  const writes: unknown[] = []
  const write = (value: unknown) => {
    writes.push(value)
    return Promise.resolve()
  }
  return {
    cost: new MediaCostEstimator({
      read: () => structuredClone(points),
      write,
      safetyFactor: MEDIA_ESTIMATE_SAFETY_FACTOR,
    }),
    writes,
  }
}

const video10s = {
  info: {
    kind: 'video' as const,
    mediaType: 'video/mp4' as const,
    sizeBytes: 512_000,
    durationSeconds: 10,
    hasSoundtrack: false,
    width: 320,
    height: 240,
  },
}

describe('production media calibration (M105 captures)', () => {
  it('carries the 23 capture points in the estimator stored shape', () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '../../docs/research/m105-captures/media-calibration-seeds.json',
        ),
        'utf8',
      ),
    )
    expect(seeds).toEqual(raw)
    expect(seeds).toHaveLength(23)
    expect(new Set(seeds.map((point) => point.captureId)).size).toBe(23)
  })

  it.each([
    ['muse-spark-1.3-contributor', { kind: 'video', fps: null }, 10, 2751],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: null }, 30, 8207],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: 1 }, 30, 8207],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: 2 }, 30, 8207],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: null }, 120, 32_731],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: 1 }, 120, 32_731],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: null }, 600, 85_531],
    ['muse-spark-1.3-contributor', { kind: 'video', fps: 1 }, 600, 85_531],
    ['muse-spark-1.2-contributor', { kind: 'video', fps: null }, 10, 1671],
    ['muse-spark-1.2-contributor', { kind: 'video', fps: null }, 120, 19_771],
    ['muse-spark-1.2-contributor', { kind: 'video', fps: 1 }, 120, 10_651],
    ['muse-spark-1.2-contributor', { kind: 'video', fps: null }, 600, 53_131],
    ['muse-spark-1.2-contributor', { kind: 'video', fps: 1 }, 600, 53_131],
  ] as const)(
    'reproduces its own bill exactly (%s %s %ss)',
    (modelId, variant: { kind: string; fps: number | null }, seconds: number, bill: number) => {
      const { cost } = estimator()
      // Uncapped: these seeded points reproduce their own bills either way.
      const estimate = cost.estimate(
        'meta',
        modelId,
        {
          info: { ...video10s.info, durationSeconds: seconds },
          ...(variant.kind === 'video' && variant.fps !== null && { fps: variant.fps }),
        },
        false,
      )
      expect(estimate?.estimatedInputTokens).toBe(bill)
      expect(estimate!.upperBoundInputTokens).toBeGreaterThanOrEqual(bill)
    },
  )

  it.each(['auto', 'low', 'high', 'original'] as const)(
    'estimates the same tokens at image detail %s on both models',
    (detail) => {
      const { cost } = estimator()
      for (const modelId of ['muse-spark-1.3-contributor', 'muse-spark-1.2-contributor']) {
        const estimate = cost.estimate(
          'meta',
          modelId,
          {
            info: { kind: 'image', mediaType: 'image/png', sizeBytes: 52_940 },
            detail,
          },
          false,
        )
        expect(estimate?.estimatedInputTokens).toBe(4086)
      }
    },
  )

  it('keeps the 1.2 120-second default reserve above its bill (largest rate)', () => {
    const { cost } = estimator()
    const estimate = cost.estimate(
      'meta',
      'muse-spark-1.2-contributor',
      {
        info: { ...video10s.info, durationSeconds: 120 },
      },
      false,
    )
    // Largest 1.2 default rate (275.1/s at 10 s) times the safety factor.
    expect(estimate?.estimatedInputTokens).toBe(19_771)
    expect(estimate!.upperBoundInputTokens).toBeGreaterThanOrEqual(19_771)
  })

  it('keeps mixed round-2 bills under the summed per-item bounds', () => {
    const { cost } = estimator()
    const image = (detail: 'auto' | 'low' | 'high' | 'original') =>
      cost.estimate(
        'meta',
        'muse-spark-1.3-contributor',
        {
          info: { kind: 'image', mediaType: 'image/png', sizeBytes: 100 },
          detail,
        },
        false,
      )!.upperBoundInputTokens
    // R02's 51 images billed 4,636; R08's 50 items billed 4,625 each.
    expect(image('auto')).toBe(4086 * MEDIA_ESTIMATE_SAFETY_FACTOR)
    expect(51 * image('low')).toBeGreaterThanOrEqual(4636)
    expect(50 * image('high')).toBeGreaterThanOrEqual(4625)
  })

  it.each([
    {
      label: 'document without a captured page bill',
      modelId: 'muse-spark-1.3-contributor',
      item: {
        info: {
          kind: 'document' as const,
          mediaType: 'application/pdf' as const,
          sizeBytes: 1000,
          pageCount: 3,
        },
      },
    },
    {
      label: 'Meta audio, billed by seconds elsewhere',
      modelId: 'muse-spark-1.3-contributor',
      item: {
        info: {
          kind: 'audio' as const,
          mediaType: 'audio/wav' as const,
          sizeBytes: 1000,
          durationSeconds: 30,
        },
      },
    },
    {
      label: 'fps above the measured 2',
      modelId: 'muse-spark-1.3-contributor',
      item: { info: { ...video10s.info }, fps: 3 },
    },
    {
      label: 'an image larger than 3000x2000',
      modelId: 'muse-spark-1.3-contributor',
      item: {
        info: {
          kind: 'image' as const,
          mediaType: 'image/png' as const,
          sizeBytes: 100_000,
          width: 4000,
          height: 3000,
        },
      },
    },
    {
      label: 'video past the measured 600 seconds',
      modelId: 'muse-spark-1.3-contributor',
      item: { info: { ...video10s.info, durationSeconds: 601 } },
    },
    {
      label: 'a model with no captures',
      modelId: 'muse-spark-1.1',
      item: { info: { ...video10s.info } },
    },
  ])('refuses $label under a cap with the honest reason', ({ modelId, item }) => {
    const { cost } = estimator()
    expect(() => cost.estimate('meta', modelId, item, true)).toThrow(
      fill(UI_TEXT.media.cappedRateUnknown, { model: modelId }),
    )
  })

  it('returns unknown without throwing where nothing is capped', () => {
    const { cost } = estimator()
    expect(
      cost.estimate(
        'meta',
        'muse-spark-1.3-contributor',
        {
          info: { kind: 'document', mediaType: 'application/pdf', sizeBytes: 1000 },
        },
        false,
      ),
    ).toBeUndefined()
  })

  it('keeps a settled turn as a new local observation', async () => {
    const { cost, writes } = estimator([])
    expect(() =>
      cost.estimate('meta', 'muse-spark-1.3-contributor', { info: video10s.info }, true),
    ).toThrow(fill(UI_TEXT.media.cappedRateUnknown, { model: 'muse-spark-1.3-contributor' }))
    await cost.observe(
      'meta',
      'muse-spark-1.3-contributor',
      [{ info: video10s.info }],
      { input_tokens: 2751, output_tokens: 64 },
      'local-settlement',
    )
    expect(writes).toHaveLength(1)
    expect(
      cost.estimate('meta', 'muse-spark-1.3-contributor', { info: video10s.info }, true)
        ?.estimatedInputTokens,
    ).toBe(2751)
  })

  it('records one remaining item of a mixed bill as an upper observation', async () => {
    const { cost, writes } = estimator([])
    await cost.observe(
      'meta',
      'muse-spark-1.3-contributor',
      [{ info: video10s.info }],
      { input_tokens: 2751, output_tokens: 64 },
      'local-mixed-settlement',
      { mixed: true },
    )
    expect(writes).toHaveLength(1)
    const points = writes[0] as readonly { upperOnly: boolean }[]
    expect(points).toHaveLength(1)
    expect(points[0]?.upperOnly).toBe(true)
    // An upper-only point never becomes the capped rate: the turn still
    // refuses instead of reserving the mixed bill as the video's typical cost.
    expect(() =>
      cost.estimate('meta', 'muse-spark-1.3-contributor', { info: video10s.info }, true),
    ).toThrow(fill(UI_TEXT.media.cappedRateUnknown, { model: 'muse-spark-1.3-contributor' }))
  })
})
