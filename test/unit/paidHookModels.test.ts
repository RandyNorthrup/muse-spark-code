// M91 prompt/agent hook handlers (PLAN.md D70, lane H): the paid feature
// `hookModels` is available by default (OWNER RULING 2026-10-04): no turn-on
// confirmation, and the first charge asks once in the paid-use popup. Its
// runs are tallied on their own usage line.

import { describe, expect, it } from 'vitest'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { PaidUseConsent, paidUseQuestion } from '../../src/core/paid/paidConsent'
import { UI_TEXT, type PaidFeature } from '../../src/shared/constants'
import {
  EMPTY_PAID_TALLY,
  hookModelPrice,
  listedPaidFeatures,
  paidCostUsd,
  paidFeatureName,
  paidFeaturePrice,
  paidTallySchema,
  paidTotalUsd,
  type PaidUseRequest,
} from '../../src/shared/paid'
import { FakeLogOutputChannel } from './helpers/fakes'

const MODEL_ID = 'muse-spark-1.3'

/** A gate over in-memory settings and acceptances, with a scripted modal. */
function gateWith(options: { settings?: readonly PaidFeature[] } = {}) {
  const settings = new Set<PaidFeature>(options.settings)
  const asked: PaidFeature[] = []
  const gate = new PaidFeatureGate({
    isSettingOn: (feature) => settings.has(feature),
    setSetting: (feature, isOn) => {
      if (isOn) settings.add(feature)
      else settings.delete(feature)
      return Promise.resolve()
    },
    readAccepted: () => new Set(),
    writeAccepted: () => Promise.resolve(),
    confirm: (feature) => {
      asked.push(feature)
      return Promise.resolve(false)
    },
    isWindowFocused: () => true,
    log: new FakeLogOutputChannel(),
  })
  return { gate, asked }
}

function hookRequest(): Extract<PaidUseRequest, { feature: 'hookModels' }> {
  return { feature: 'hookModels', event: 'PreToolUse', kind: 'prompt', modelId: MODEL_ID }
}

function consentWith(
  answer: 'once' | 'always' | 'deny',
  options: { canRemember?: boolean; isOn?: boolean } = {},
) {
  const gate = gateWith({ settings: options.isOn === false ? [] : ['hookModels'] }).gate
  const asked: PaidUseRequest[] = []
  const grants = new Set<PaidFeature>()
  const consent = new PaidUseConsent({
    isOn: (feature) => gate.isOn(feature),
    canRemember: () => options.canRemember ?? true,
    readGrants: () => grants,
    writeGrants: (next) => {
      grants.clear()
      for (const feature of next) grants.add(feature)
      return Promise.resolve()
    },
    ask: (request) => {
      asked.push(request)
      return Promise.resolve(answer)
    },
    log: new FakeLogOutputChannel(),
  })
  return { consent, asked, grants }
}

describe('hookModels is available by default (M91, OWNER RULING 2026-10-04)', () => {
  it('is on with the setting on and no accepted price, and review asks nothing', async () => {
    const t = gateWith({ settings: ['hookModels'] })
    expect(t.gate.isOn('hookModels')).toBe(true)
    await t.gate.review()
    expect(t.asked).toEqual([])
    expect(t.gate.features()).toEqual(['hookModels'])
  })

  it('is off when the setting is off, and other features still need acceptance', async () => {
    const off = gateWith({})
    expect(off.gate.isOn('hookModels')).toBe(false)
    await off.gate.review()
    expect(off.asked).toEqual([])

    const other = gateWith({ settings: ['webSearch'] })
    expect(other.gate.isOn('webSearch')).toBe(false)
    await other.gate.review()
    expect(other.asked).toEqual(['webSearch'])
  })
})

describe('hookModels asks once per run in the paid-use popup (M91, D48)', () => {
  it('names the event, kind, model and price in the popup', async () => {
    const { title, detail } = await paidUseQuestion(hookRequest())
    expect(title).toContain('PreToolUse')
    expect(detail).toContain('prompt')
    expect(detail).toContain(MODEL_ID)
    expect(detail).toContain(hookModelPrice(MODEL_ID))
    const budgetQuestion = await paidUseQuestion({ ...hookRequest(), dailyBudgetUsd: 2 })
    expect(budgetQuestion.detail).toContain('Shared daily paid budget: $2.00')
  })

  it('denies without asking when the feature is off', async () => {
    const off = consentWith('once', { isOn: false })
    expect(await off.consent.allows(hookRequest())).toBe(false)
    expect(off.asked).toEqual([])
  })

  it('asks before the use: deny stops it, allow once covers one run', async () => {
    const denied = consentWith('deny')
    expect(await denied.consent.allows(hookRequest())).toBe(false)
    expect(denied.asked).toHaveLength(1)

    const once = consentWith('once')
    expect(await once.consent.allows(hookRequest())).toBe(true)
    expect(await once.consent.allows(hookRequest())).toBe(true)
    expect(once.asked).toHaveLength(2)
  })

  it('allow always asks once, then asks nothing more in this workspace', async () => {
    const t = consentWith('always')
    expect(await t.consent.allows(hookRequest())).toBe(true)
    expect(await t.consent.allows(hookRequest())).toBe(true)
    expect(t.asked).toHaveLength(1)
    expect(t.consent.isRemembered('hookModels')).toBe(true)
    await t.consent.forget()
    expect(await t.consent.allows(hookRequest())).toBe(true)
    expect(t.asked).toHaveLength(2)
  })
})

describe('hookModels is tallied on its own usage line (M91)', () => {
  it('counts runs before any usage is reported, with no invented cost', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.addHookModelRun()
    expect(usage.current).toMatchObject({ hookModelRuns: 1, hookModelUnknownRequests: 1 })
    expect(paidCostUsd('hookModels', usage.current)).toBe(0)
    expect(paidTotalUsd(usage.current)).toBe(0)
    expect(listedPaidFeatures([], usage.current)).toEqual(['hookModels'])
    expect(paidFeatureName('hookModels')).toBe(UI_TEXT.paidHookModelName)
  })

  it('settles reported usage into tokens and cost, once per run', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('hookModels', 1)
    usage.addHookModelRun()
    usage.addHookModelUsage(MODEL_ID, {
      inputTokens: 1_000_000,
      cachedTokens: 200_000,
      outputTokens: 100_000,
    })
    expect(usage.current).toMatchObject({
      hookModelRuns: 2,
      hookModelUnknownRequests: 1,
      hookModelTokens: 1_100_000,
    })
    expect(paidCostUsd('hookModels', usage.current)).toBeCloseTo(1.455)
    expect(paidTotalUsd(usage.current)).toBeCloseTo(1.455)
    expect(() => {
      usage.addHookModelUsage(MODEL_ID, { inputTokens: 1, cachedTokens: 2, outputTokens: 0 })
    }).toThrow('valid nonnegative token counts')
    expect(() => {
      usage.addHookModelUsage('unpriced', { inputTokens: 1, cachedTokens: 0, outputTokens: 0 })
    }).toThrow('unpriced model')
    expect(usage.current.hookModelUnknownRequests).toBe(1)
  })

  it('validates the new tally fields at the panel boundary', () => {
    expect(paidTallySchema.safeParse(EMPTY_PAID_TALLY).success).toBe(true)
    expect(paidTallySchema.safeParse({ ...EMPTY_PAID_TALLY, hookModelRuns: -1 }).success).toBe(
      false,
    )
    expect(
      paidTallySchema.safeParse({ ...EMPTY_PAID_TALLY, hookModelUnknownRequests: 0.5 }).success,
    ).toBe(false)
  })

  it('quotes the token rates, and refuses an unpriced model', () => {
    const price = hookModelPrice(MODEL_ID)
    expect(price).toContain('$1.250')
    expect(price).toContain('$0.150')
    expect(hookModelPrice('muse-spark-future')).toBe(UI_TEXT.subagentTariffUnknown)
    expect(paidFeaturePrice('hookModels')).toContain('$1.250/1M input')
  })
})
