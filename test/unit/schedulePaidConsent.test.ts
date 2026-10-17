// Schedule paid consent stays fail-closed until M115 Lane U wires it
// (MSM58M69, PLAN.md D140): creation/renewal asks through
// `askSchedulePaidConsent`, a firing run spends only through
// `createSchedulePaidScope`, and both refuse before any popup, grant or
// ledger access when the consent is missing, stale or the gate is off.
// Real modules, values passed in as data; a dependency that must never be
// reached throws instead of standing in for the ledger or the popup.
import { describe, expect, it } from 'vitest'
import {
  askSchedulePaidConsent,
  createSchedulePaidScope,
  isScheduleConsentCurrent,
  paidAccountQuestion,
  type PaidUseAnswer,
  type ScheduleConsent,
  type SchedulePaidIdentity,
} from '../../src/core/paid/paidConsent'
import { scheduleV2Schema, type ScheduleV2 } from '../../src/shared/scheduleV2'

const NOW = 1_790_000_000_000
const AT = 1_800_000_000_000

const identity: SchedulePaidIdentity = {
  modelId: 'test-model-a',
  accountId: 'test-account',
  priceTier: 'standard',
  price: '$1.00 per run',
  sharedDailyBudgetUsd: '2',
}

function consentFor(modelId: string): ScheduleConsent {
  return {
    modelId,
    accountId: identity.accountId,
    priceTier: identity.priceTier,
    grantedAtMs: NOW,
    dailyCapUsd: '1',
    sharedDailyBudgetUsd: identity.sharedDailyBudgetUsd,
    extras: [],
  }
}

function scheduleWith(consent: ScheduleConsent | undefined): ScheduleV2 {
  return scheduleV2Schema.parse({
    version: 2,
    revision: 0,
    id: 'test-schedule',
    name: 'Test schedule',
    workspaceKey: 'test-workspace',
    action: { kind: 'prompt', prompt: 'Summarize the inbox' },
    trigger: { kind: 'once', atMs: AT },
    target: { kind: 'conversation', sessionId: 'test-session', backend: 'modelApi' },
    delivery: 'whenIdle',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: '1' },
    paidCapUsd: '1',
    ...(consent !== undefined && { paidConsent: consent }),
    parallel: false,
    creator: { kind: 'user' },
    depth: 0,
    allowAgentReschedule: false,
    pinned: false,
    zone: 'America/Los_Angeles',
    paused: false,
    createdAtMs: NOW,
    updatedAtMs: NOW,
    fireCount: 0,
    consecutiveFailures: 0,
  })
}

function unreachable(name: string): never {
  throw new Error(`must not reach ${name}`)
}

describe('schedule paid consent is fail-closed (M58/D140)', () => {
  it('a denied answer stores no consent', async () => {
    let asked = 0
    const consent = await askSchedulePaidConsent({
      schedule: scheduleWith(undefined),
      identity,
      cadence: 'once',
      extras: [],
      now: () => NOW,
      isOn: () => true,
      isCurrent: () => true,
      ask: (): Promise<PaidUseAnswer> => {
        asked += 1
        return Promise.resolve('deny')
      },
      remember: () => {
        unreachable('remember')
      },
    })
    expect(consent).toBeUndefined()
    expect(asked).toBe(1)
  })

  it('a current consent is reused without asking again', async () => {
    const stored = consentFor(identity.modelId)
    const consent = await askSchedulePaidConsent({
      schedule: scheduleWith(stored),
      identity,
      cadence: 'once',
      extras: [],
      now: () => NOW,
      isOn: () => true,
      isCurrent: () => true,
      ask: () => {
        unreachable('ask')
      },
      remember: () => {
        unreachable('remember')
      },
    })
    expect(consent).toEqual(stored)
  })

  it('a changed model asks again and consents the new one', async () => {
    let asked = 0
    const next: SchedulePaidIdentity = { ...identity, modelId: 'test-model-b' }
    const consent = await askSchedulePaidConsent({
      schedule: scheduleWith(consentFor(identity.modelId)),
      identity: next,
      cadence: 'once',
      extras: [],
      now: () => NOW,
      isOn: () => true,
      isCurrent: () => true,
      ask: (): Promise<PaidUseAnswer> => {
        asked += 1
        return Promise.resolve('once')
      },
      remember: () => {
        unreachable('remember')
      },
    })
    expect(asked).toBe(1)
    expect(consent?.modelId).toBe('test-model-b')
    expect(isScheduleConsentCurrent(scheduleWith(consent), next)).toBe(true)
  })

  it('no popup opens while the paid gate is off', async () => {
    const consent = await askSchedulePaidConsent({
      schedule: scheduleWith(undefined),
      identity,
      cadence: 'once',
      extras: [],
      now: () => NOW,
      isOn: () => false,
      isCurrent: () => true,
      ask: () => {
        unreachable('ask')
      },
      remember: () => {
        unreachable('remember')
      },
    })
    expect(consent).toBeUndefined()
  })

  it('a run without consent is refused before any reservation', async () => {
    const scope = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: scheduleWith(undefined),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: () => true,
      estimate: () => {
        unreachable('estimate')
      },
      reserve: () => {
        unreachable('reserve')
      },
    })
    expect(scope.allows('scheduledPrompts')).toBe(false)
    await expect(
      scope.reserve(
        {
          model: identity.modelId,
          prompt: 'Summarize the inbox',
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
          output_format: 'png',
        },
        undefined,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow()
  })

  it('a run past a changed model is refused before any reservation', () => {
    const next: SchedulePaidIdentity = { ...identity, modelId: 'test-model-b' }
    const scope = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: scheduleWith(consentFor(identity.modelId)),
      identity,
      currentIdentity: () => next,
      isCurrent: () => true,
      isOn: () => true,
      estimate: () => {
        unreachable('estimate')
      },
      reserve: () => {
        unreachable('reserve')
      },
    })
    expect(scope.allows('scheduledPrompts')).toBe(false)
  })

  it('a current consent allows only the prompt run, not unconsented extras', () => {
    const scope = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: scheduleWith(consentFor(identity.modelId)),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: () => true,
      estimate: () => {
        unreachable('estimate')
      },
      reserve: () => {
        unreachable('reserve')
      },
    })
    expect(scope.allows('scheduledPrompts')).toBe(true)
    expect(scope.allows('imageGeneration')).toBe(false)
  })
})

describe('account paid-use question names its own account (M58/D140)', () => {
  it('the question carries provider, account, price and budget', () => {
    const question = paidAccountQuestion({
      provider: 'test-provider',
      account: 'test-account',
      price: '$1.00 per run',
      dailyBudgetUsd: '2',
    })
    expect(question).toContain('test-provider')
    expect(question).toContain('test-account')
    expect(question).toContain('$1.00 per run')
    expect(question).toContain('$2.00')
  })
})
