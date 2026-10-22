// M108 policy consent: the real gate and confirmations over the real
// bundled policy rows, with grants in real files. No fakes.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileConfirmationStore, scriptedAsker } from './helpers/accountConfirmationStore'
import { AccountPolicyGate } from '../../src/core/accounts/policyGate'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { usdAmountSchema } from '../../src/shared/usd'
import type { AccountTrigger } from '../../src/shared/accounts'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const RESET = new Date(NOW + 3_600_000).toISOString()
const USER_CAP: AccountTrigger = {
  kind: 'userCap',
  metric: 'spendUsd',
  period: 'day',
  value: usdAmountSchema.parse('20'),
  threshold: usdAmountSchema.parse('20'),
  resetAt: RESET,
}
const VENDOR_LIMIT: AccountTrigger = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: RESET }

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function setup() {
  const machineId = 'consent-test-machine'
  const dir = await mkdtemp(path.join(tmpdir(), 'account-consent-'))
  folders.push(dir)
  const asked = { count: 0, answers: [] as unknown[] }
  const store = fileConfirmationStore(dir)
  const confirmations = (id: string) =>
    new AccountConfirmations({
      machineId: id,
      now: () => NOW,
      ask: scriptedAsker(asked),
      store,
    })
  return { dir, asked, confirmations: confirmations(machineId), confirmationsAs: confirmations }
}

function row(provider: string, product: string) {
  const found = accountPolicyFor(provider, product)
  if (found === undefined) throw new Error(`missing policy row ${provider}/${product}`)
  return found
}

describe('M108 account policy consent', () => {
  it('allows an on row without asking, and binds the grant to the exact record', async () => {
    const harness = await setup()
    const gate = new AccountPolicyGate(harness.confirmations)
    const policy = row('anthropic', 'api')
    const decision = await gate.authorize({
      policy: () => policy,
      trigger: USER_CAP,
      isInteractive: true,
    })
    expect(harness.asked.count).toBe(0)
    if (decision.kind !== 'allow') throw new Error('expected an allow decision')
    expect(decision.isCurrent(policy)).toBe(true)
    expect(decision.isCurrent(undefined)).toBe(false)
    expect(decision.isCurrent({ ...policy, pooling: 'confirm' })).toBe(false)
    expect(decision.isCurrent({ ...policy, checkedAt: '2026-10-06' })).toBe(false)
  })

  it('asks once, persists the answer, and reuses it across restarts on the same machine', async () => {
    const harness = await setup()
    const gate = new AccountPolicyGate(harness.confirmations)
    const policy = row('meta', 'model-api')
    harness.asked.answers.push('confirm')
    const first = await gate.authorize({
      policy: () => policy,
      trigger: VENDOR_LIMIT,
      isInteractive: true,
    })
    expect(first.kind).toBe('allow')
    expect(harness.asked.count).toBe(1)
    expect(await readdir(harness.dir)).toContain('confirmation-meta-model-api.json')
    const restarted = new AccountPolicyGate(harness.confirmationsAs('consent-test-machine'))
    const second = await restarted.authorize({
      policy: () => policy,
      trigger: VENDOR_LIMIT,
      isInteractive: true,
    })
    expect(second.kind).toBe('allow')
    expect(harness.asked.count).toBe(1)
    // Another machine cannot reuse this machine's answer.
    const foreign = new AccountPolicyGate(harness.confirmationsAs('another-machine'))
    harness.asked.answers.push('cancel')
    const third = await foreign.authorize({
      policy: () => policy,
      trigger: VENDOR_LIMIT,
      isInteractive: true,
    })
    expect(third).toEqual({ kind: 'stop', reason: 'cancel' })
    expect(harness.asked.count).toBe(2)
  })

  it('honours cancel and own-caps-only at a vendor limit', async () => {
    const cancelled = await setup()
    cancelled.asked.answers.push('cancel')
    const policy = row('meta', 'model-api')
    await expect(
      new AccountPolicyGate(cancelled.confirmations).authorize({
        policy: () => policy,
        trigger: VENDOR_LIMIT,
        isInteractive: true,
      }),
    ).resolves.toEqual({ kind: 'stop', reason: 'cancel' })
    const limited = await setup()
    limited.asked.answers.push('ownCapsOnly')
    await expect(
      new AccountPolicyGate(limited.confirmations).authorize({
        policy: () => policy,
        trigger: VENDOR_LIMIT,
        isInteractive: true,
      }),
    ).resolves.toEqual({ kind: 'stop', reason: 'ownCapsOnly' })
  })

  it('keeps headless runs read-only: no stored grant stops without asking', async () => {
    const harness = await setup()
    const gate = new AccountPolicyGate(harness.confirmations)
    const policy = row('meta', 'model-api')
    await expect(
      gate.authorize({ policy: () => policy, trigger: VENDOR_LIMIT, isInteractive: false }),
    ).resolves.toEqual({ kind: 'stop', reason: 'confirmation' })
    expect(harness.asked.count).toBe(0)
    // A grant confirmed interactively authorizes the headless run.
    harness.asked.answers.push('confirm')
    await expect(
      gate.authorize({ policy: () => policy, trigger: VENDOR_LIMIT, isInteractive: true }),
    ).resolves.toMatchObject({ kind: 'allow' })
    await expect(
      gate.authorize({ policy: () => policy, trigger: VENDOR_LIMIT, isInteractive: false }),
    ).resolves.toMatchObject({ kind: 'allow' })
    expect(harness.asked.count).toBe(1)
  })

  it('takes revocation effect before its disk write and removes the file', async () => {
    const harness = await setup()
    const policy = row('meta', 'model-api')
    harness.asked.answers.push('confirm')
    const grant = await harness.confirmations.obtain(policy, true)
    if (grant === undefined) throw new Error('expected a stored grant')
    expect(grant.isCurrent(policy)).toBe(true)
    await harness.confirmations.revoke('meta', 'model-api')
    expect(grant.isCurrent(policy)).toBe(false)
    await expect(harness.confirmations.read(policy)).resolves.toBeUndefined()
    expect(await readdir(harness.dir)).not.toContain('confirmation-meta-model-api.json')
  })

  it('names vendor recovery before subscription pooling, then honours the offered choice', async () => {
    const harness = await setup()
    const gate = new AccountPolicyGate(harness.confirmations)
    const policy = row('openai', 'chatgpt-plan')
    await expect(
      gate.authorize({ policy: () => policy, trigger: VENDOR_LIMIT, isInteractive: true }),
    ).resolves.toEqual({ kind: 'recovery', recovery: 'chatgptPlan' })
    expect(harness.asked.count).toBe(0)
    harness.asked.answers.push('confirm')
    await expect(
      gate.authorize({
        policy: () => policy,
        trigger: VENDOR_LIMIT,
        isInteractive: true,
        hasOfferedRecovery: true,
      }),
    ).resolves.toMatchObject({ kind: 'allow' })
  })
})
