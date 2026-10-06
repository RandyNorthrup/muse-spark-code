import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askSchedulePaidConsent,
  createSchedulePaidScope,
  isScheduleConsentCurrent,
  type PaidUseAnswer,
  type SchedulePaidIdentity,
  type ScheduleConsent,
} from '../../src/core/paid/paidConsent'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { removeFolder } from './helpers/temporaryFolders'
import { window } from './mocks/vscode'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import type { CreateResponseBody, CreateImageBody } from '../../src/core/backends/modelapi/schemas'

const identity: SchedulePaidIdentity = {
  modelId: 'muse-spark-1.3',
  accountId: FAKE_MODEL_API_ACCOUNT_ID,
  priceTier: 'standard',
  price: 'Verified token rates',
  sharedDailyBudgetUsd: 5,
}
const schedule = () =>
  fakeSchedule({
    grant: { rules: [], destinationIds: [], paidCapUsd: 1 },
    paidCapUsd: 1,
    paidConsent: {
      modelId: identity.modelId,
      accountId: identity.accountId,
      priceTier: identity.priceTier,
      sharedDailyBudgetUsd: identity.sharedDailyBudgetUsd,
      grantedAtMs: 0,
      dailyCapUsd: 1,
      extras: ['imageGeneration'],
    },
  })
const body: CreateResponseBody = {
  model: identity.modelId,
  instructions: 'Test',
  input: [],
  tools: [],
  max_output_tokens: 100,
  stream: true,
  store: false,
  tool_choice: 'auto',
  reasoning: { summary: 'auto', effort: 'high' },
  include: ['reasoning.encrypted_content'],
  prompt_cache_key: 'schedule-test',
  prompt_cache_retention: 'in_memory',
}
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await removeFolder(directory)
  vi.restoreAllMocks()
})
async function ledgers(capUsd = 5) {
  const directory = await mkdtemp(path.join(tmpdir(), 'm115-u-paid-'))
  directories.push(directory)
  let now = new Date(2026, 9, 6, 12).getTime()
  const deps = {
    directory,
    now: () => now,
    capUsd: () => capUsd,
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  }
  return {
    first: createPaidDailyBudget(deps),
    second: createPaidDailyBudget(deps),
    tomorrow: () => {
      now = new Date(2026, 9, 7, 12).getTime()
    },
  }
}

describe('schedule-scoped paid consent and reservations', () => {
  it.each(['once', 'always', 'deny'] as const)(
    'asks once at creation with price, cadence and both caps: %s',
    async (answer: PaidUseAnswer) => {
      const ask = vi.fn().mockResolvedValue(answer)
      const remember = vi.fn().mockResolvedValue(true)
      const consent = await askSchedulePaidConsent({
        schedule: { ...schedule(), paidConsent: undefined },
        identity,
        cadence: 'Once tomorrow',
        extras: ['imageGeneration'],
        now: () => 1,
        isOn: () => true,
        isCurrent: () => true,
        ask,
        remember,
      })
      expect(ask).toHaveBeenCalledTimes(1)
      const detail = ask.mock.calls[0]?.[0]
      expect(detail).toMatchObject({ detail: expect.stringContaining(identity.price) })
      expect(detail).toMatchObject({ detail: expect.stringContaining('Once tomorrow') })
      expect(detail).toMatchObject({ detail: expect.stringContaining('$1.00') })
      expect(detail).toMatchObject({ detail: expect.stringContaining('$5.00') })
      expect(remember).toHaveBeenCalledTimes(answer === 'always' ? 1 : 0)
      expect(consent !== undefined).toBe(answer !== 'deny')
    },
  )
  it('refuses stale/off creation answers and cannot persist consent after a CAS conflict', async () => {
    let isCurrent = true
    const deps = {
      schedule: { ...schedule(), paidConsent: undefined },
      identity,
      cadence: 'Once',
      extras: [],
      now: () => 1,
      isOn: () => true,
      isCurrent: () => isCurrent,
      ask: () => {
        isCurrent = false
        return Promise.resolve('always' as const)
      },
      remember: vi.fn().mockResolvedValue(true),
    }
    expect(await askSchedulePaidConsent(deps)).toBeUndefined()
    expect(deps.remember).not.toHaveBeenCalled()
    isCurrent = true
    expect(
      await askSchedulePaidConsent({
        ...deps,
        ask: () => Promise.resolve('always'),
        remember: () => Promise.resolve(false),
      }),
    ).toBeUndefined()
  })
  it('reuses the same consent without a second modal, but changed extras, disabled gates and unknown prices cannot spend', async () => {
    const ask = vi.fn().mockResolvedValue('deny')
    const deps = {
      schedule: schedule(),
      identity,
      cadence: 'Once',
      extras: ['imageGeneration'] satisfies ScheduleConsent['extras'],
      now: () => 1,
      isOn: () => true,
      isCurrent: () => true,
      ask,
      remember: () => Promise.resolve(true),
    }
    expect(await askSchedulePaidConsent(deps)).toEqual(schedule().paidConsent)
    expect(ask).not.toHaveBeenCalled()
    expect(await askSchedulePaidConsent({ ...deps, isOn: () => false })).toBeUndefined()
    expect(
      await askSchedulePaidConsent({ ...deps, identity: { ...identity, price: '' } }),
    ).toBeUndefined()
    expect(ask).not.toHaveBeenCalled()
    expect(await askSchedulePaidConsent({ ...deps, extras: [] })).toBeUndefined()
    expect(ask).toHaveBeenCalledTimes(1)
  })
  it('rechecks the feature after the popup and uses the granted schedule cap for admission', async () => {
    let isOn = true
    const consent = await askSchedulePaidConsent({
      schedule: { ...schedule(), paidConsent: undefined },
      identity,
      cadence: 'Once',
      extras: [],
      now: () => 1,
      isOn: () => isOn,
      isCurrent: () => true,
      ask: () => {
        isOn = false
        return Promise.resolve('once')
      },
      remember: () => Promise.resolve(true),
    })
    expect(consent).toBeUndefined()
    expect(isScheduleConsentCurrent({ ...schedule(), paidCapUsd: 0 }, identity)).toBe(false)
    expect(
      isScheduleConsentCurrent(
        { ...schedule(), grant: { ...schedule().grant, paidCapUsd: 0 } },
        identity,
      ),
    ).toBe(false)
  })
  it('requires renewal for a changed model, key, tariff or shared budget', () => {
    expect(isScheduleConsentCurrent(schedule(), identity)).toBe(true)
    for (const change of [
      { modelId: 'different' },
      { accountId: 'other-digest' },
      { priceTier: 'new-tariff' },
      { sharedDailyBudgetUsd: 1 },
    ])
      expect(isScheduleConsentCurrent(schedule(), { ...identity, ...change })).toBe(false)
  })
  it('admits only selected enabled extras, rechecks revocation and retains uncertain liability', async () => {
    const { first } = await ledgers()
    let isCurrent = true
    let isOn = true
    const scope = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: schedule(),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => isCurrent,
      isOn: () => isOn,
      estimate: () => 0.6,
      reserve: first.reserveSchedule,
    })
    expect(scope.allows('imageGeneration')).toBe(true)
    expect(scope.allows('voice')).toBe(false)
    await expect(
      scope.reserve({ ...body, model: 'changed' }, 100, new AbortController().signal),
    ).rejects.toThrow()
    const claim = await scope.reserve(body, 100, new AbortController().signal)
    expect(scope.cost()).toEqual({ usd: 0, certainty: 'unknown', retainedLiabilityUsd: 0.6 })
    isOn = false
    expect(scope.allows('imageGeneration')).toBe(false)
    expect(() => claim.check(0)).toThrow()
    isOn = true
    isCurrent = false
    expect(() => claim.check(0)).toThrow()
    await expect(scope.reserve(body, 100, new AbortController().signal)).rejects.toThrow()
    await claim.settle(0.2)
    expect(scope.cost()).toEqual({ usd: 0.2, certainty: 'exact', retainedLiabilityUsd: 0 })
  })
  it('admits Muse Code paid extras with their own gate and retains missing-usage liability', async () => {
    const { first } = await ledgers()
    const scope = createSchedulePaidScope({
      backend: 'museCode',
      schedule: schedule(),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: (feature) => feature === 'imageGeneration',
      estimate: () => 0.6,
      reserve: first.reserveSchedule,
    })
    expect(scope.allows('scheduledPrompts')).toBe(false)
    expect(scope.allows('imageGeneration')).toBe(true)
    const image: CreateImageBody = {
      model: 'muse-image',
      prompt: 'test',
      n: 1,
      size: 'auto',
      response_format: 'b64_json',
      output_format: 'png',
    }
    const claim = await scope.reserve(image, undefined, new AbortController().signal)
    claim.check(0)
    await claim.settle(0.6, true)
    expect(scope.cost()).toEqual({ usd: 0, certainty: 'unknown', retainedLiabilityUsd: 0.6 })
    await expect(scope.reserve(image, undefined, new AbortController().signal)).rejects.toThrow()
    const unpricedReserve = vi.fn()
    const unpriced = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: schedule(),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: () => true,
      estimate: () => NaN,
      reserve: unpricedReserve,
    })
    await expect(unpriced.reserve(body, 100, new AbortController().signal)).rejects.toThrow()
    expect(unpricedReserve).not.toHaveBeenCalled()
  })
  it('keeps a disabled extra off while the scheduled prompt gate stays on', async () => {
    const reserve = vi.fn()
    const scope = createSchedulePaidScope({
      backend: 'modelApi',
      schedule: schedule(),
      identity,
      currentIdentity: () => identity,
      isCurrent: () => true,
      isOn: (feature) => feature === 'scheduledPrompts',
      estimate: () => 0.6,
      reserve,
    })
    expect(scope.allows('scheduledPrompts')).toBe(true)
    expect(scope.allows('imageGeneration')).toBe(false)
    const image: CreateImageBody = {
      model: 'muse-image',
      prompt: 'test',
      n: 1,
      size: 'auto',
      response_format: 'b64_json',
      output_format: 'png',
    }
    await expect(scope.reserve(image, undefined, new AbortController().signal)).rejects.toThrow()
    expect(reserve).not.toHaveBeenCalled()
  })
  it('enforces a schedule cap across independent processes before HTTP without a budget dialog', async () => {
    const { first, second } = await ledgers()
    const spy = vi.spyOn(window, 'showWarningMessage')
    const held = await first.reserveSchedule(schedule(), 0.6, new AbortController().signal)
    const api = fakeModelApi()
    const client = fakeModelApiClient(api, new FakeLogOutputChannel())
    const guard = Object.assign(() => undefined, {
      paidFeature: 'scheduledPrompts' as const,
      reservePaidRequest: () =>
        second.reserveSchedule(schedule(), 0.5, new AbortController().signal),
    })
    await expect(async () => {
      const stream = client.streamResponse(
        body,
        new AbortController().signal,
        undefined,
        undefined,
        guard,
      )
      for await (const _event of stream) {
        // Consume the actual client stream.
      }
    }).rejects.toThrow()
    expect(api.requests).toHaveLength(0)
    expect(spy).not.toHaveBeenCalled()
    held.check(0)
    await held.settle(0.2)
    const next = await second.reserveSchedule(schedule(), 0.5, new AbortController().signal)
    await next.settle(0)
  })
  it('enforces the shared cap across different schedules and refuses old-day claims', async () => {
    const { first, second, tomorrow } = await ledgers(0.5)
    const own = schedule()
    const firstClaim = await first.reserveSchedule(own, 0.3, new AbortController().signal)
    await expect(
      second.reserveSchedule({ ...own, id: 'other-schedule' }, 0.3, new AbortController().signal),
    ).rejects.toThrow()
    const latest = await first.latestDay()
    expect(latest.spentUsd).toBe(0.3)
    tomorrow()
    expect(() => firstClaim.check(0)).toThrow()
    const newDay = await second.reserveSchedule(own, 0.3, new AbortController().signal)
    await newDay.settle(0)
  })
  it('serializes competing reservations and refuses missing consent, invalid cost and aborted admission', async () => {
    const { first, second } = await ledgers()
    const results = await Promise.allSettled([
      first.reserveSchedule(schedule(), 0.6, new AbortController().signal),
      second.reserveSchedule(schedule(), 0.6, new AbortController().signal),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(
      first.reserveSchedule(
        { ...schedule(), paidConsent: undefined },
        0.1,
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    await expect(
      first.reserveSchedule(schedule(), NaN, new AbortController().signal),
    ).rejects.toThrow()
    await expect(first.reserveSchedule(schedule(), 0.1, AbortSignal.abort())).rejects.toThrow()
  })
})
