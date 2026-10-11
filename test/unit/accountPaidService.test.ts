import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccountPaidService, paidUseTariff } from '../../src/host/paid/accountPaidEntry'
import type { AccountPaidHostAsk, PaidBilling } from '../../src/core/paid/accountPaidRoute'
import type { PaidUseAnswer } from '../../src/core/paid/paidConsent'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { PaidFeature } from '../../src/shared/constants'
import type { PaidUseRequest } from '../../src/shared/paid'
import { Usd } from '../../src/shared/usd'
import { FakeLogOutputChannel } from './helpers/fakes'
import { quotedSearch } from './helpers/paidQuote'

// M108 lane P: the lazy service both editors load on the first use billed to
// another account (dist/accountPaid.js), over the real file store.

const WORK: PaidBilling = { provider: 'meta', account: 'work' }
const PERSONAL: PaidBilling = { provider: 'meta', account: 'personal' }
const VOICE: PaidUseRequest = { feature: 'voice' }

const folders: string[] = []
beforeEach(() => {
  setUiText(EN, 'en')
})
afterEach(() => {
  setUiText(EN, 'en')
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function rig() {
  const folder = mkdtempSync(path.join(tmpdir(), 'm108p-account-service-'))
  folders.push(folder)
  const state = {
    billing: WORK as PaidBilling | undefined,
    budget: Usd.from(5).toAmount(),
    repositoryBudget: false,
    canRemember: true,
    generation: 'g1',
    on: new Set<PaidFeature>(['voice', 'webSearch', 'imageGeneration']),
  }
  const ask = vi.fn<AccountPaidHostAsk>(() => Promise.resolve<PaidUseAnswer>('once'))
  const create = () =>
    createAccountPaidService(EN, 'en', {
      base: {
        isOn: (feature) => state.on.has(feature),
        canRemember: () => state.canRemember,
        quoteGeneration: () => 'host-1',
        log: new FakeLogOutputChannel(),
      },
      billing: () => state.billing,
      folder,
      featureGeneration: () => state.generation,
      dailyBudgetUsd: () => state.budget,
      isRepositoryBudget: () => state.repositoryBudget,
      ask,
      sleep: () => Promise.resolve(),
    })
  return { folder, state, ask, create, service: create() }
}

/** A revoked binding must ask in the current service and after reopening its files. */
async function expectRefusedAcrossRestart(t: ReturnType<typeof rig>): Promise<void> {
  t.ask.mockResolvedValue('deny')
  expect(await t.service.decide(WORK, VOICE, false)).toBe(false)
  expect(await t.create().decide(WORK, VOICE, false)).toBe(false)
  expect(t.ask).toHaveBeenCalledTimes(3)
}

describe('M108 lane P account paid service', () => {
  it('ends kept account consent after credential revision changes, including restart', async () => {
    const t = rig()
    const first = { ...WORK, credentialRevision: 'revision-one' }
    t.state.billing = first
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(first, VOICE, false)).toBe(true)
    const replacement = { ...WORK, credentialRevision: 'revision-two' }
    t.state.billing = replacement
    t.ask.mockResolvedValue('deny')
    expect(await t.service.decide(replacement, VOICE, false)).toBe(false)
    expect(await t.create().decide(replacement, VOICE, false)).toBe(false)
    expect(t.ask).toHaveBeenCalledTimes(3)
  })

  it('refuses a held answer when its payer credential is revoked and stores no grant', async () => {
    const t = rig()
    let isCurrent = true
    const billing = { ...WORK, credentialRevision: 'held-revision', isCurrent: () => isCurrent }
    t.state.billing = billing
    t.ask.mockImplementationOnce(() => {
      isCurrent = false
      return Promise.resolve('always')
    })
    expect(await t.service.decide(billing, VOICE, false)).toBe(false)
    expect(readdirSync(t.folder)).toEqual([])
  })

  it('keys a grant by language-neutral tariff data, never by the display price', () => {
    const search = quotedSearch('0.0025', 'muse-spark-1.3')
    const english = paidUseTariff(search)
    setUiText(EN, 'de')
    const german = paidUseTariff(search)
    expect(german.tariff).toBe(english.tariff)
    expect(german.price).not.toBe(english.price)
    expect(JSON.parse(english.tariff)).toEqual(['webSearch', '0.0025'])
    const scheduled = paidUseTariff({
      feature: 'scheduledPrompts',
      prompt: 'p',
      modelId: 'muse-spark-1.3',
    })
    expect(JSON.parse(scheduled.tariff)).toEqual([
      'scheduledPrompts',
      'muse-spark-1.3',
      'standard',
      expect.objectContaining({ input: expect.any(String), output: expect.any(String) }),
    ])
  })

  it('asks once before the first charge, naming the account, its tariff and the shared budget', async () => {
    const t = rig()
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    expect(t.ask).toHaveBeenCalledOnce()
    const [request, canRemember, line] = t.ask.mock.calls[0] ?? []
    expect(request).toEqual(VOICE)
    expect(canRemember).toBe(true)
    expect(line).toContain('meta · work')
    expect(line).toContain(paidUseTariff(VOICE).price)
    expect(line).toContain('Shared daily budget: $5.00')
  })

  it('keeps Always per account across a restart, and asks for another account', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    const restarted = t.create()
    expect(await restarted.decide(WORK, VOICE, false)).toBe(true)
    expect(t.ask).toHaveBeenCalledOnce()
    t.state.billing = PERSONAL
    t.ask.mockResolvedValue('deny')
    expect(await restarted.decide(PERSONAL, VOICE, false)).toBe(false)
    expect(t.ask).toHaveBeenCalledTimes(2)
    expect(t.ask.mock.calls[1]?.[2]).toContain('meta · personal')
  })

  it('keeps user-owned Once when its shared budget changes and names the current budget on a forced question', async () => {
    const t = rig()
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    t.state.budget = Usd.from(7).toAmount()
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    expect(t.ask).toHaveBeenCalledOnce()
    expect(await t.service.decide(WORK, VOICE, true)).toBe(true)
    expect(t.ask).toHaveBeenCalledTimes(2)
    expect(t.ask.mock.calls[1]?.[2]).toContain('Shared daily budget: $7.00')
  })

  it('keeps user-owned Always after a budget change in memory and after restart', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    t.state.budget = Usd.from(7).toAmount()
    t.ask.mockResolvedValue('deny')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    expect(await t.create().decide(WORK, VOICE, false)).toBe(true)
    expect(t.ask).toHaveBeenCalledOnce()
  })

  it.each(['once', 'always'] as const)(
    're-quotes repository-owned %s after a budget change in memory and after restart',
    async (answer) => {
      const t = rig()
      t.state.repositoryBudget = true
      t.ask.mockResolvedValue(answer)
      expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
      t.state.budget = Usd.from(7).toAmount()
      await expectRefusedAcrossRestart(t)
      expect(t.ask.mock.calls[1]?.[2]).toContain('Shared daily budget: $7.00')
      expect(t.ask.mock.calls[2]?.[2]).toContain('Shared daily budget: $7.00')
    },
  )

  it('re-asks when a user-owned budget becomes repository-owned at the same amount', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    t.state.repositoryBudget = true
    await expectRefusedAcrossRestart(t)
  })

  it('refuses a use whose account stopped billing while the question was open', async () => {
    const t = rig()
    t.ask.mockImplementationOnce(() => {
      t.state.billing = PERSONAL
      return Promise.resolve('always')
    })
    expect(await t.service.decide(WORK, VOICE, false)).toBe(false)
    // Nothing was kept for the account that no longer bills.
    expect(readdirSync(t.folder)).toEqual([])
    t.state.billing = WORK
    t.ask.mockResolvedValue('deny')
    expect(await t.create().decide(WORK, VOICE, false)).toBe(false)
    expect(t.ask).toHaveBeenCalledTimes(2)
  })

  it('lapses an account’s Always with its feature’s price acceptance', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    t.state.generation = 'g2'
    t.ask.mockResolvedValue('deny')
    expect(await t.create().decide(WORK, VOICE, false)).toBe(false)
    expect(t.ask).toHaveBeenCalledTimes(2)
  })

  it('takes back every account consent the window holds with Ask again', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(true)
    await t.service.revokeAll()
    await expectRefusedAcrossRestart(t)
  })

  it('returns the frozen quote for an account search and keeps its Always by quote', async () => {
    const t = rig()
    t.ask.mockResolvedValue('always')
    const search = quotedSearch('0.0025', 'muse-spark-1.3')
    expect(await t.service.decide(WORK, search, false)).toEqual(search.quote)
    expect(await t.create().decide(WORK, search, false)).toEqual(search.quote)
    expect(t.ask).toHaveBeenCalledOnce()
    // A higher tariff is another binding: it asks.
    t.ask.mockResolvedValue('deny')
    expect(await t.create().decide(WORK, quotedSearch('0.01', 'muse-spark-1.3'), false)).toBe(
      undefined,
    )
    expect(t.ask).toHaveBeenCalledTimes(2)
  })

  it('asks through the use’s own prompt when the host passes one', async () => {
    const t = rig()
    const session = vi.fn<AccountPaidHostAsk>(() => Promise.resolve<PaidUseAnswer>('once'))
    expect(await t.service.decide(WORK, VOICE, true, session)).toBe(true)
    expect(t.ask).not.toHaveBeenCalled()
    expect(session).toHaveBeenCalledOnce()
    expect(session.mock.calls[0]?.[2]).toContain('meta · work')
  })

  it('refuses a feature that is off without asking', async () => {
    const t = rig()
    t.state.on.delete('voice')
    expect(await t.service.decide(WORK, VOICE, false)).toBe(false)
    expect(t.ask).not.toHaveBeenCalled()
  })
})
