// The `teamWorkers` paid feature (M96 lane A, PLAN.md D75, acceptance 23):
// the tally counts started tasks and settles reported usage apart; one
// `delegate` popup names each model's prices, each task's ceiling and the
// shared daily budget; unpriced entries say the price is unknown.

import { describe, expect, it, vi } from 'vitest'
import { PaidFeatureGate, PaidUsage } from '../../src/core/paid/paidFeatures'
import { PaidUseConsent, paidUseQuestion } from '../../src/core/paid/paidConsent'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import {
  listedPaidFeatures,
  paidCostUsd,
  paidFeatureName,
  paidTotalUsd,
  teamWorkerPrice,
  usablePaidFeatures,
  type PaidTally,
  type PaidUseRequest,
} from '../../src/shared/paid'
import { FakeLogOutputChannel } from './helpers/fakes'

describe('teamWorkers paid use (M96)', () => {
  it('single-model activation asks nothing; a runnable team asks in the first paid-use popup', async () => {
    let isReady = false
    let isEnabled = true
    let confirmations = 0
    let uses = 0
    const gate = new PaidFeatureGate({
      isSettingOn: (feature) => feature === 'teamWorkers' && isEnabled,
      isTeamAvailable: () => isReady,
      setSetting: (_feature, on) => {
        isEnabled = on
        return Promise.resolve()
      },
      readAccepted: () => new Set(),
      writeAccepted: () => Promise.resolve(),
      confirm: () => {
        confirmations += 1
        return Promise.resolve(true)
      },
      isWindowFocused: () => true,
      log: new FakeLogOutputChannel(),
    })
    await gate.review()
    expect(confirmations).toBe(0)
    expect(gate.isOn('teamWorkers')).toBe(false)
    expect(gate.features()).toEqual([])
    isReady = true
    await gate.review()
    expect(confirmations).toBe(0)
    expect(gate.isOn('teamWorkers')).toBe(true)
    const consent = new PaidUseConsent({
      isOn: (feature) => gate.isOn(feature),
      canRemember: () => true,
      readGrants: () => new Set(),
      writeGrants: () => Promise.resolve(),
      ask: () => {
        uses += 1
        return Promise.resolve('once')
      },
      log: new FakeLogOutputChannel(),
    })
    const request = {
      feature: 'teamWorkers',
      tasks: [{ role: 'engineering', modelId: DEFAULT_MODEL_ID, taskCeilingTokens: 400_000 }],
      dailyBudgetUsd: 50,
    } as const
    expect(await consent.allows(request)).toBe(true)
    expect(uses).toBe(1)
    isReady = false
    expect(await consent.allows(request)).toBe(false)
    expect(uses).toBe(1)
    isReady = true
    isEnabled = false
    expect(await consent.allows(request)).toBe(false)
  })

  it('team workers stay unavailable without a host readiness dependency', async () => {
    const gate = new PaidFeatureGate({
      isSettingOn: () => true,
      setSetting: () => Promise.resolve(),
      readAccepted: () => new Set(['teamWorkers']),
      writeAccepted: () => Promise.resolve(),
      confirm: () => Promise.resolve(true),
      isWindowFocused: () => false,
      log: new FakeLogOutputChannel(),
    })
    expect(gate.isOn('teamWorkers')).toBe(false)
    await gate.review()
  })

  it('counts started tasks as unknown until reported usage settles them', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('teamWorkers', 2)
    expect(usage.current.teamWorkerRequests).toBe(2)
    expect(usage.current.teamWorkerUnknownRequests).toBe(2)
    usage.addTeamWorkerUsage(DEFAULT_MODEL_ID, {
      inputTokens: 3000,
      outputTokens: 1000,
      cachedTokens: 100,
    })
    expect(usage.current.teamWorkerUnknownRequests).toBe(1)
    expect(usage.current.teamWorkerTokens).toBe(4000)
    expect(usage.current.teamWorkerCostUsd).toBeGreaterThan(0)
    // Cost stays apart from the conversation's token estimate total.
    const tally = usage.current
    expect(paidCostUsd('teamWorkers', tally)).toBe(tally.teamWorkerCostUsd)
    expect(paidTotalUsd(tally)).toBe(0)
  })

  it('refuses usage it cannot price, and invalid counts', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('teamWorkers', 1)
    expect(() => {
      usage.addTeamWorkerUsage('unpriced-model', {
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
      })
    }).toThrow(/unpriced/)
    expect(() => {
      usage.addTeamWorkerUsage(DEFAULT_MODEL_ID, {
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 2,
      })
    }).toThrow(/nonnegative/)
  })

  it('names the feature and lists it once used', () => {
    expect(paidFeatureName('teamWorkers')).toBe('Team workers')
    const empty: PaidTally = { webSearches: 0, images: 0, voiceSeconds: 0, scheduledRuns: 0 }
    expect(listedPaidFeatures(['teamWorkers'], empty)).toEqual(['teamWorkers'])
    expect(listedPaidFeatures([], empty)).toEqual([])
  })

  it('F10 is offered on Muse Code only with a stored key', () => {
    expect(usablePaidFeatures('museCode', true)).toContain('teamWorkers')
    expect(usablePaidFeatures('museCode', false)).not.toContain('teamWorkers')
  })

  it('is offered on the Model API backend', () => {
    expect(usablePaidFeatures('modelApi', false)).toContain('teamWorkers')
  })

  it('quotes each task’s model, ceiling and the shared daily budget in one popup', () => {
    const price = teamWorkerPrice(
      [
        { role: 'engineering', modelId: DEFAULT_MODEL_ID, taskCeilingTokens: 400_000 },
        { role: 'code-review', modelId: 'unknown-model', taskCeilingTokens: 200_000 },
      ],
      50,
    )
    expect(price).toContain('engineering')
    expect(price).toContain('400,000')
    expect(price).toContain('Shared daily team budget')
    const question = paidUseQuestion({
      feature: 'teamWorkers',
      tasks: [{ role: 'engineering', modelId: DEFAULT_MODEL_ID, taskCeilingTokens: 400_000 }],
      dailyBudgetUsd: 50,
    })
    expect(question.title).toBe('Approve paid team tasks?')
    expect(question.detail).toContain('Billed to your Model API key')
    expect(question.detail).toContain('Allow once covers these tasks only')
  })

  it('F09 honestly quotes unpriced task and daily token ceilings', () => {
    const price = teamWorkerPrice(
      [{ role: 'engineering', modelId: 'unpriced-model', taskCeilingTokens: 200_000 }],
      undefined,
      25_000_000,
    )
    expect(price).toContain('engineering')
    expect(price).toContain('200,000')
    expect(price).toContain('25,000,000')
    expect(price).toContain('price is unknown')
    expect(price).not.toContain('cannot start')
    expect(
      paidUseQuestion({
        feature: 'teamWorkers',
        tasks: [{ role: 'engineering', modelId: 'unpriced-model', taskCeilingTokens: 200_000 }],
        dailyBudgetUsd: undefined,
        dailyBudgetTokens: 25_000_000,
      }).detail,
    ).toContain('25,000,000')

    // No budget line while lanes 0/X land the shared budget setting.
    expect(price).not.toContain('Shared daily team budget')
  })
})

describe('F01 scoped team Always consent', () => {
  it('asks again for a different model, provider or tariff, and forgets every scope', async () => {
    let scopes: ReadonlySet<string> = new Set()
    const ask = vi.fn((_request: PaidUseRequest, _canRemember: boolean) =>
      Promise.resolve('always' as const),
    )
    const deps = {
      isOn: () => true,
      canRemember: () => true,
      readGrants: () => new Set(['teamWorkers'] as const),
      writeGrants: () => Promise.resolve(),
      readTeamGrants: () => scopes,
      writeTeamGrants: (next: ReadonlySet<string>) => {
        scopes = next
        return Promise.resolve()
      },
      ask,
      log: new FakeLogOutputChannel(),
    }
    const consent = new PaidUseConsent(deps)
    const contributor = {
      role: 'engineering',
      modelId: `${DEFAULT_MODEL_ID}-contributor`,
      provider: 'meta',
      priceTier: 'contributor',
      taskCeilingTokens: 200_000,
    }
    const request = { feature: 'teamWorkers' as const, tasks: [contributor], dailyBudgetUsd: 50 }
    expect(await consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(await new PaidUseConsent(deps).allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    const standard = {
      ...request,
      tasks: [{ ...contributor, modelId: DEFAULT_MODEL_ID, priceTier: 'standard' }],
    }
    expect(await consent.allows(standard)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(paidUseQuestion(ask.mock.calls[1]?.[0] ?? standard).detail).toContain('$1.250')
    expect(paidUseQuestion(ask.mock.calls[1]?.[0] ?? standard).detail).toContain(
      'Shared daily team budget',
    )
    expect(
      await consent.allows({ ...request, tasks: [{ ...contributor, provider: 'other' }] }),
    ).toBe(true)
    expect(ask).toHaveBeenCalledTimes(3)
    expect(
      await consent.allows({ ...request, tasks: [{ ...contributor, priceTier: 'new-price' }] }),
    ).toBe(true)
    expect(ask).toHaveBeenCalledTimes(4)
    expect(await consent.allows({ ...request, tasks: [contributor, ...standard.tasks] })).toBe(true)
    expect(ask).toHaveBeenCalledTimes(4)
    await consent.forget()
    expect(scopes.size).toBe(0)
    expect(await consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(5)
    expect(await consent.allows(request, true)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(6)
  })

  it('never honors a legacy feature-wide grant or offers Always without the scoped store', async () => {
    const ask = vi.fn(() => Promise.resolve('always' as const))
    const consent = new PaidUseConsent({
      isOn: () => true,
      canRemember: () => true,
      readGrants: () => new Set(['teamWorkers']),
      writeGrants: () => Promise.resolve(),
      ask,
      log: new FakeLogOutputChannel(),
    })
    const request = {
      feature: 'teamWorkers' as const,
      tasks: [{ role: 'engineering', modelId: DEFAULT_MODEL_ID, taskCeilingTokens: 100 }],
      dailyBudgetUsd: 50,
    }
    expect(await consent.allows(request)).toBe(true)
    expect(await consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenLastCalledWith(request, false)
    expect(consent.isRemembered('teamWorkers')).toBe(false)
  })
})
