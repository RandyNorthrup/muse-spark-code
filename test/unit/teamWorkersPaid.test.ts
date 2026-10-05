// The `teamWorkers` paid feature (M96 lane A, PLAN.md D75, acceptance 23):
// the tally counts started tasks and settles reported usage apart; one
// `delegate` popup names each model's prices, each task's ceiling and the
// shared daily budget; unpriced entries say the price is unknown.

import { describe, expect, it } from 'vitest'
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

  it('says the price is unknown for an unpriced key entry', () => {
    const price = teamWorkerPrice(
      [{ role: 'engineering', modelId: 'unpriced-model', taskCeilingTokens: 200_000 }],
      undefined,
    )
    expect(price).toContain('engineering')
    // No budget line while lanes 0/X land the shared budget setting.
    expect(price).not.toContain('Shared daily team budget')
  })
})
