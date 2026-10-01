import { describe, expect, it, vi } from 'vitest'
import { PaidFeatureGate, PaidUsage, paidStateOf } from '../../src/core/paid/paidFeatures'
import { UI_TEXT, type PaidFeature } from '../../src/shared/constants'
import {
  bestOfNPrice,
  EMPTY_PAID_TALLY,
  paidCostUsd,
  paidFeatureName,
  paidFeaturePrice,
  paidTotalUsd,
  modelApiPaidTier,
  listedPaidFeatures,
  paidTallySchema,
} from '../../src/shared/paid'
import { FakeLogOutputChannel } from './helpers/fakes'

/** A gate over in-memory settings and acceptances, with a scripted modal. */
function gateWith(
  options: {
    settings?: readonly PaidFeature[]
    accepted?: readonly PaidFeature[]
    answers?: readonly boolean[]
    isFocused?: boolean
  } = {},
) {
  const settings = new Set<PaidFeature>(options.settings)
  let accepted = new Set<PaidFeature>(options.accepted)
  const answers = [...(options.answers ?? [])]
  const asked: PaidFeature[] = []
  const focus = { isFocused: options.isFocused ?? true }
  const gate = new PaidFeatureGate({
    isSettingOn: (feature) => settings.has(feature),
    setSetting: (feature, isOn) => {
      if (isOn) {
        settings.add(feature)
      } else {
        settings.delete(feature)
      }
      return Promise.resolve()
    },
    readAccepted: () => accepted,
    writeAccepted: (next) => {
      accepted = new Set(next)
      return Promise.resolve()
    },
    confirm: (feature) => {
      asked.push(feature)
      return Promise.resolve(answers.shift() ?? false)
    },
    isWindowFocused: () => focus.isFocused,
    log: new FakeLogOutputChannel(),
  })
  const changes = vi.fn()
  gate.onDidChange(changes)
  return { gate, settings, accepted: () => accepted, asked, focus, changes }
}

describe('PaidFeatureGate (M33, PLAN.md D30)', () => {
  it('has every feature off by default and never asks for one that is off', async () => {
    const t = gateWith()
    await t.gate.review()
    expect(t.gate.features()).toEqual([])
    expect(t.asked).toEqual([])
  })

  it('does not count a setting as on until its price is accepted', () => {
    const t = gateWith({ settings: ['webSearch'] })
    expect(t.gate.isOn('webSearch')).toBe(false)
    const accepted = gateWith({ settings: ['webSearch'], accepted: ['webSearch'] })
    expect(accepted.gate.isOn('webSearch')).toBe(true)
    // An acceptance without the setting is not on either.
    const stale = gateWith({ accepted: ['imageGeneration'] })
    expect(stale.gate.isOn('imageGeneration')).toBe(false)
  })

  it('asks once for a setting turned on in settings, and keeps it on when accepted', async () => {
    const t = gateWith({ settings: ['webSearch'], answers: [true] })
    await t.gate.review()
    expect(t.asked).toEqual(['webSearch'])
    expect(t.gate.features()).toEqual(['webSearch'])
    await t.gate.review()
    expect(t.asked).toEqual(['webSearch'])
    expect(t.changes).toHaveBeenCalled()
  })

  it('turns the setting back off when the confirmation is declined', async () => {
    const t = gateWith({ settings: ['voice'], answers: [false] })
    await t.gate.review()
    expect(t.asked).toEqual(['voice'])
    expect(t.settings.has('voice')).toBe(false)
    expect(t.gate.isOn('voice')).toBe(false)
  })

  it('asks in the focused window only, and asks when this one gains focus', async () => {
    const t = gateWith({ settings: ['imageGeneration'], answers: [true], isFocused: false })
    await t.gate.review()
    expect(t.asked).toEqual([])
    expect(t.gate.isOn('imageGeneration')).toBe(false)
    t.focus.isFocused = true
    await t.gate.review()
    expect(t.asked).toEqual(['imageGeneration'])
    expect(t.gate.isOn('imageGeneration')).toBe(true)
  })

  it('forgets the acceptance when the setting goes off, so turning it on asks again', async () => {
    const t = gateWith({ settings: ['webSearch'], accepted: ['webSearch'], answers: [true] })
    t.settings.delete('webSearch')
    await t.gate.review()
    expect(t.accepted().has('webSearch')).toBe(false)
    t.settings.add('webSearch')
    await t.gate.review()
    expect(t.asked).toEqual(['webSearch'])
  })

  it('does not accept a price for a setting turned off while the modal was open', async () => {
    const t = gateWith({ settings: ['webSearch'] })
    const confirmation = Promise.withResolvers<boolean>()
    const gate = new PaidFeatureGate({
      isSettingOn: (feature) => t.settings.has(feature),
      setSetting: () => Promise.resolve(),
      readAccepted: () => t.accepted(),
      writeAccepted: () => Promise.resolve(),
      confirm: () => confirmation.promise,
      isWindowFocused: () => true,
      log: new FakeLogOutputChannel(),
    })
    const review = gate.review()
    // A second review while the modal is open does not ask again.
    const again = gate.review()
    t.settings.delete('webSearch')
    confirmation.resolve(true)
    await Promise.all([review, again])
    expect(gate.isOn('webSearch')).toBe(false)
  })

  it('turns a feature on from the palette with the confirmation first, and off at once', async () => {
    const t = gateWith({ answers: [false, true] })
    await expect(t.gate.turnOn('webSearch')).resolves.toBe(false)
    expect(t.settings.has('webSearch')).toBe(false)
    await expect(t.gate.turnOn('webSearch')).resolves.toBe(true)
    expect(t.asked).toEqual(['webSearch', 'webSearch'])
    expect(t.gate.isOn('webSearch')).toBe(true)
    // The setting change the toggle made asks nothing more.
    await t.gate.review()
    expect(t.asked).toHaveLength(2)
    // Already on: no second modal.
    await expect(t.gate.turnOn('webSearch')).resolves.toBe(true)
    expect(t.asked).toHaveLength(2)
    await t.gate.turnOff('webSearch')
    expect(t.gate.isOn('webSearch')).toBe(false)
    expect(t.accepted().has('webSearch')).toBe(false)
  })
})

describe('PaidUsage and the prices (M33)', () => {
  it('counts an attempted child request as unpriced until its usage arrives', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('subagents', 1)
    expect(usage.current).toMatchObject({ subagentRequests: 1, subagentUnknownRequests: 1 })
  })

  it('shows reported child cost as a subset without pricing unresolved attempts as free', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('subagents', 2)
    usage.addSubagentUsage('muse-spark-1.3', {
      inputTokens: 1_000_000,
      cachedTokens: 200_000,
      outputTokens: 100_000,
    })
    expect(usage.current).toMatchObject({
      subagentRequests: 2,
      subagentUnknownRequests: 1,
      subagentTokens: 1_100_000,
    })
    expect(paidCostUsd('subagents', usage.current)).toBeCloseTo(1.455)
    expect(paidTotalUsd(usage.current)).toBe(0)
    usage.add('imageGeneration', 1)
    expect(paidTotalUsd(usage.current)).toBeCloseTo(0.01)
    expect(listedPaidFeatures([], usage.current)).toContain('subagents')
  })

  it('retains a failed child attempt in usage even when no token estimate exists', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('subagents', 1)
    expect(listedPaidFeatures([], usage.current)).toEqual(['subagents'])
    expect(usage.current.subagentUnknownRequests).toBe(1)
  })

  it('counts best-of-N attempts before any usage estimate is reported (M77)', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('bestOfN', 3)
    expect(usage.current).toMatchObject({ bestOfNAttempts: 3 })
    // No reported usage means no invented cost; request counts retain unknowns.
    expect(paidCostUsd('bestOfN', usage.current)).toBe(0)
    expect(paidTotalUsd(usage.current)).toBe(0)
    expect(listedPaidFeatures([], usage.current)).toEqual(['bestOfN'])
    expect(paidFeatureName('bestOfN')).toBe(UI_TEXT.paidBestOfNName)
  })

  it('prices reported best-of-N deltas separately while failed HTTP tries stay unknown', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('bestOfN', 1)
    usage.addBestOfNRequest()
    usage.addBestOfNRequest()
    usage.addBestOfNUsage('muse-spark-1.3', {
      inputTokens: 1_000_000,
      cachedTokens: 200_000,
      outputTokens: 100_000,
    })
    expect(usage.current).toMatchObject({
      bestOfNAttempts: 1,
      bestOfNRequests: 2,
      bestOfNUnknownRequests: 1,
      bestOfNTokens: 1_100_000,
    })
    expect(paidCostUsd('bestOfN', usage.current)).toBeCloseTo(1.455)
    expect(paidTotalUsd(usage.current)).toBeCloseTo(1.455)
    expect(() => {
      usage.addBestOfNUsage('muse-spark-1.3', { inputTokens: 1, cachedTokens: 2, outputTokens: 0 })
    }).toThrow('valid nonnegative token counts')
    expect(() => {
      usage.addBestOfNUsage('unpriced', { inputTokens: 1, cachedTokens: 0, outputTokens: 0 })
    }).toThrow('unpriced model')
    expect(usage.current.bestOfNUnknownRequests).toBe(1)
  })

  it('quotes a best-of-N run with the rates, N and the ceiling (M77)', () => {
    const price = bestOfNPrice('muse-spark-1.3', 3, 20)
    expect(price).toContain('muse-spark-1.3')
    expect(price).toContain('$1.250')
    expect(price).toContain('$0.150')
    expect(price).toContain('$4.250')
    expect(price).toContain('3 attempts')
    expect(price).toContain('20 requests')
    expect(bestOfNPrice('muse-spark-future', 3, 20)).toBe(UI_TEXT.subagentTariffUnknown)
    expect(paidFeaturePrice('bestOfN')).toContain('3 attempts')
  })

  it('reads older paid state and rejects invalid child counters at the panel boundary', () => {
    expect(paidTallySchema.safeParse(EMPTY_PAID_TALLY).success).toBe(true)
    expect(paidTallySchema.safeParse({ ...EMPTY_PAID_TALLY, subagentRequests: -1 }).success).toBe(
      false,
    )
    expect(
      paidTallySchema.safeParse({ ...EMPTY_PAID_TALLY, subagentUnknownRequests: 0.5 }).success,
    ).toBe(false)
  })

  it('prices only the verified models and refuses invalid child usage', () => {
    expect(modelApiPaidTier('muse-spark-1.3')).toBe('standard')
    expect(modelApiPaidTier('muse-spark-1.2-contributor')).toBe('contributor')
    expect(modelApiPaidTier('muse-spark-future-contributor')).toBeUndefined()
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('subagents', 1)
    expect(() => {
      usage.addSubagentUsage('unknown', { inputTokens: 1, outputTokens: 1, cachedTokens: 0 })
    }).toThrow('unpriced model')
    expect(() => {
      usage.addSubagentUsage('muse-spark-1.3', {
        inputTokens: -1,
        outputTokens: 1,
        cachedTokens: 0,
      })
    }).toThrow('nonnegative')
    expect(usage.current.subagentUnknownRequests).toBe(1)
  })

  it('tallies each feature, ignores nothing-used, and tells its listeners', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    const listener = vi.fn()
    const stop = usage.onDidChange(listener)
    usage.add('webSearch', 3)
    usage.add('imageGeneration', 1)
    usage.add('voice', 90)
    usage.add('scheduledPrompts', 1)
    usage.add('voice', 0)
    expect(usage.current).toEqual({ webSearches: 3, images: 1, voiceSeconds: 90, scheduledRuns: 1 })
    expect(listener).toHaveBeenCalledTimes(4)
    stop()
    usage.add('webSearch', 1)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('estimates each feature at the published prices', () => {
    const tally = { webSearches: 1000, images: 7, voiceSeconds: 7200, scheduledRuns: 0 }
    expect(paidCostUsd('webSearch', tally)).toBeCloseTo(2.5)
    expect(paidCostUsd('imageGeneration', tally)).toBeCloseTo(0.07)
    expect(paidCostUsd('voice', tally)).toBeCloseTo(0.36)
    expect(paidCostUsd('scheduledPrompts', { ...tally, scheduledRuns: 1 })).toBe(0)
    expect(paidTotalUsd(tally)).toBeCloseTo(2.93)
    expect(paidTotalUsd(EMPTY_PAID_TALLY)).toBe(0)
  })

  it('names each feature and its price', () => {
    expect(paidFeatureName('voice')).toBe('Muse Voice')
    expect(paidFeaturePrice('webSearch')).toBe('$2.50 per 1,000 searches')
    expect(paidFeaturePrice('imageGeneration')).toBe('$0.01 per image')
    expect(paidFeaturePrice('voice')).toBe('$0.18 per hour of audio')
    const schedulePrices = paidFeaturePrice('scheduledPrompts')
    expect(schedulePrices).toContain('$1.250/1M input')
    expect(schedulePrices).toContain('$0.100/1M input')
    expect(schedulePrices).toContain('$0.002/1M cached input')
  })

  it('reports the features that are on with the tally', () => {
    const t = gateWith({ settings: ['voice'], accepted: ['voice'] })
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('voice', 5)
    expect(paidStateOf(t.gate, usage, true, ['voice'])).toEqual({
      features: ['voice'],
      tally: { webSearches: 0, images: 0, voiceSeconds: 5, scheduledRuns: 0 },
      isKeyStored: true,
      alwaysAllowed: ['voice'],
    })
  })
})
