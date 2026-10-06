import { describe, expect, it, vi } from 'vitest'
import { MediaCostEstimator, reserveMediaRequest } from '../../src/core/media/mediaCost'
import { MODEL_API_MEDIA_PER_REQUEST } from '../../src/shared/constants'

function setup() {
  const provider = 'meta'
  const modelId = 'muse-spark-1.3-contributor'
  const item = {
    info: {
      kind: 'video' as const,
      mediaType: 'video/mp4' as const,
      sizeBytes: 500_000,
      durationSeconds: 10,
      hasSoundtrack: true,
    },
  }
  const write = vi.fn((_points: readonly unknown[]) => Promise.resolve())
  const estimator = new MediaCostEstimator({
    read: () => [
      {
        provider,
        modelId,
        variant: { kind: 'video', fps: null },
        units: 10,
        inputTokens: 2751,
        captureId: 'U4-summary',
        upperOnly: false,
      },
    ],
    write,
    safetyFactor: 2,
  })
  function ledger() {
    const claim = {
      check: vi.fn(),
      settle: vi.fn((_usd: number, _hasUnknownCost?: boolean) => Promise.resolve()),
    }
    return { claim, reserve: vi.fn((_usd: number) => Promise.resolve(claim)) }
  }
  const session = ledger()
  const daily = ledger()
  const request = {
    provider,
    modelId,
    items: [item],
    estimator,
    textInputTokens: 170,
    maxOutputTokens: 100,
    captureId: 'settled-turn',
    prices: { input: 0.1, cachedInput: 0.025, output: 0.2 },
    session,
    daily,
  }
  return { request, session, daily, write, item }
}

describe('media request accounting', () => {
  it('reserves the calibrated upper bound plus text and full output in both ledgers', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    expect(reservation.inputTokens).toBe(5672)
    expect(reservation.reservedUsd).toBeCloseTo((5672 * 0.1 + 100 * 0.2) / 1_000_000)
    expect(t.session.reserve).toHaveBeenCalledWith(reservation.reservedUsd)
    expect(t.daily.reserve).toHaveBeenCalledWith(reservation.reservedUsd)
    reservation.check()
    expect(t.session.claim.check).toHaveBeenCalledOnce()
    expect(t.daily.claim.check).toHaveBeenCalledOnce()
  })

  it('settles reported cached/input/output usage and writes a local observation exactly once', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    reservation.started()
    const usage = {
      input_tokens: 3000,
      output_tokens: 40,
      input_tokens_details: { cached_tokens: 1000 },
    }
    await reservation.settle(usage)
    await reservation.settle(usage)
    await reservation.finish()
    const cost = (2000 * 0.1 + 1000 * 0.025 + 40 * 0.2) / 1_000_000
    for (const ledger of [t.session, t.daily]) {
      expect(ledger.claim.settle).toHaveBeenCalledExactlyOnceWith(cost, false)
    }
    expect(t.write).toHaveBeenCalledOnce()
    expect(t.write.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inputTokens: 3000, captureId: 'settled-turn' }),
      ]),
    )
  })

  it('refunds a nonsent request but retains a sent request without a bill as uncertain', async () => {
    for (const isSent of [false, true]) {
      const t = setup()
      const reservation = await reserveMediaRequest(t.request)
      if (isSent) reservation.started()
      await reservation.finish()
      await reservation.finish()
      expect(t.session.claim.settle).toHaveBeenCalledExactlyOnceWith(
        isSent ? reservation.reservedUsd : 0,
        isSent,
      )
      expect(t.daily.claim.settle).toHaveBeenCalledExactlyOnceWith(
        isSent ? reservation.reservedUsd : 0,
        isSent,
      )
      expect(t.write).not.toHaveBeenCalled()
    }
  })

  it('refunds the session reservation if the daily ledger refuses admission', async () => {
    const t = setup()
    t.daily.reserve.mockRejectedValueOnce(new Error('daily cap'))
    await expect(reserveMediaRequest(t.request)).rejects.toThrow('daily cap')
    expect(t.session.claim.settle).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('refuses unknown duration, rate or more than 50 items before either ledger admits', async () => {
    const t = setup()
    for (const request of [
      { ...t.request, modelId: 'uncalibrated' },
      { ...t.request, items: [{ info: { ...t.item.info, durationSeconds: null } }] },
      {
        ...t.request,
        items: Array.from({ length: MODEL_API_MEDIA_PER_REQUEST + 1 }, () => t.item),
      },
    ])
      await expect(reserveMediaRequest(request)).rejects.toThrow()
    expect(t.session.reserve).not.toHaveBeenCalled()
    expect(t.daily.reserve).not.toHaveBeenCalled()
    const admitted = await reserveMediaRequest({
      ...t.request,
      items: Array.from({ length: MODEL_API_MEDIA_PER_REQUEST }, () => t.item),
    })
    expect(admitted.inputTokens).toBe(50 * 5502 + 170)
  })

  it('refuses malformed tariffs or token allowances before admission', async () => {
    const t = setup()
    for (const request of [
      { ...t.request, prices: { input: -1, cachedInput: 0, output: 1 } },
      { ...t.request, prices: { input: 1, cachedInput: 2, output: 1 } },
      { ...t.request, maxOutputTokens: Infinity },
      { ...t.request, textInputTokens: 0.5 },
    ])
      await expect(reserveMediaRequest(request)).rejects.toThrow()
    expect(t.daily.reserve).not.toHaveBeenCalled()
  })

  it('checks both final fences, forbids reusing dispatched claims and cannot bill unsent usage', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    await expect(reservation.settle({ input_tokens: 10, output_tokens: 1 })).rejects.toThrow(
      'Unsent',
    )
    t.daily.claim.check.mockImplementationOnce(() => {
      throw new Error('daily changed')
    })
    expect(() => {
      reservation.check()
    }).toThrow('daily changed')
    reservation.started()
    expect(() => {
      reservation.check()
    }).toThrow('retry')
    expect(() => {
      reservation.started()
    }).toThrow('retry')
  })

  it('retains liability for invalid usage and records no observation', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    reservation.started()
    await expect(
      reservation.settle({
        input_tokens: 1,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 2 },
      }),
    ).rejects.toThrow('Cached')
    await reservation.finish()
    expect(t.daily.claim.settle).toHaveBeenCalledWith(reservation.reservedUsd, true)
    expect(t.write).not.toHaveBeenCalled()
  })

  it('snapshots admitted metadata and tariffs for settlement after a UI change', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    t.request.prices.input = 999
    t.item.info.durationSeconds = 1
    reservation.started()
    await reservation.settle({ input_tokens: 3000, output_tokens: 40 })
    expect(t.daily.claim.settle).toHaveBeenCalledWith((3000 * 0.1 + 40 * 0.2) / 1_000_000, false)
    expect(t.write.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ units: 10, inputTokens: 3000 })]),
    )
  })

  it('preserves actual cost after one ledger settles and the other fails to write', async () => {
    const t = setup()
    const reservation = await reserveMediaRequest(t.request)
    reservation.started()
    t.daily.claim.settle.mockRejectedValueOnce(new Error('daily write'))
    await expect(reservation.settle({ input_tokens: 3000, output_tokens: 40 })).rejects.toThrow(
      'daily write',
    )
    await reservation.finish()
    const actual = (3000 * 0.1 + 40 * 0.2) / 1_000_000
    expect(t.session.claim.settle).toHaveBeenCalledExactlyOnceWith(actual, false)
    expect(t.daily.claim.settle).toHaveBeenLastCalledWith(actual, false)
    expect(t.write).toHaveBeenCalledOnce()
  })
})
