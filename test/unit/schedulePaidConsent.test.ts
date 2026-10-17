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
import { canonicalUsd } from '../../src/shared/usdSchema'

const NOW = 1_790_000_000_000
const AT = 1_800_000_000_000

const identity: SchedulePaidIdentity = {
  modelId: 'test-model-a',
  accountId: 'test-account',
  priceTier: 'standard',
  price: '$1.00 per run',
  sharedDailyBudgetUsd: canonicalUsd('2'),
}

function consentFor(modelId: string): ScheduleConsent {
  return {
    modelId,
    accountId: identity.accountId,
    priceTier: identity.priceTier,
    grantedAtMs: NOW,
    dailyCapUsd: canonicalUsd('1'),
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
    grant: { rules: [], destinationIds: [], paidCapUsd: canonicalUsd('1') },
    paidCapUsd: canonicalUsd('1'),
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

/** A port that must never be reached: throws instead of standing in. */
function neverReached(name: string): () => never {
  return () => {
    throw new Error(`must not reach ${name}`)
  }
}

function answerWith(answer: PaidUseAnswer, asked: { count: number }): () => Promise<PaidUseAnswer> {
  return () => {
    asked.count += 1
    return Promise.resolve(answer)
  }
}

function askDeps(schedule: ScheduleV2, ask: () => Promise<PaidUseAnswer>, isOn = true) {
  return {
    schedule,
    identity,
    cadence: 'once',
    extras: [],
    now: () => NOW,
    isOn: () => isOn,
    isCurrent: () => true,
    ask,
    remember: neverReached('remember'),
  }
}

function scopeDeps(schedule: ScheduleV2, current: SchedulePaidIdentity) {
  return {
    backend: 'modelApi' as const,
    schedule,
    identity,
    currentIdentity: () => current,
    isCurrent: () => true,
    isOn: () => true,
    estimate: neverReached('estimate'),
    reserve: neverReached('reserve'),
  }
}

describe('schedule paid consent is fail-closed (M58/D140)', () => {
  it('a denied answer stores no consent', async () => {
    const asked = { count: 0 }
    const consent = await askSchedulePaidConsent(
      askDeps(scheduleWith(undefined), answerWith('deny', asked)),
    )
    expect(consent).toBeUndefined()
    expect(asked.count).toBe(1)
  })

  it('a current consent is reused without asking again', async () => {
    const stored = consentFor(identity.modelId)
    const consent = await askSchedulePaidConsent(askDeps(scheduleWith(stored), neverReached('ask')))
    expect(consent).toEqual(stored)
  })

  it('a changed model asks again and consents the new one', async () => {
    const asked = { count: 0 }
    const next: SchedulePaidIdentity = { ...identity, modelId: 'test-model-b' }
    const consent = await askSchedulePaidConsent({
      ...askDeps(scheduleWith(consentFor(identity.modelId)), answerWith('once', asked)),
      identity: next,
    })
    expect(asked.count).toBe(1)
    expect(consent?.modelId).toBe('test-model-b')
    expect(isScheduleConsentCurrent(scheduleWith(consent), next)).toBe(true)
  })

  it('no popup opens while the paid gate is off', async () => {
    const consent = await askSchedulePaidConsent(
      askDeps(scheduleWith(undefined), neverReached('ask'), false),
    )
    expect(consent).toBeUndefined()
  })

  it('a run without consent is refused before any reservation', async () => {
    const scope = createSchedulePaidScope(scopeDeps(scheduleWith(undefined), identity))
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
    const scope = createSchedulePaidScope(
      scopeDeps(scheduleWith(consentFor(identity.modelId)), next),
    )
    expect(scope.allows('scheduledPrompts')).toBe(false)
  })

  it('a current consent allows only the prompt run, not unconsented extras', () => {
    const scope = createSchedulePaidScope(
      scopeDeps(scheduleWith(consentFor(identity.modelId)), identity),
    )
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
      dailyBudgetUsd: canonicalUsd('2'),
    })
    expect(question).toContain('test-provider')
    expect(question).toContain('test-account')
    expect(question).toContain('$1.00 per run')
    expect(question).toContain('$2.00')
  })
})
