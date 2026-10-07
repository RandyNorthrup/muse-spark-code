import { describe, expect, it, vi } from 'vitest'
import { DeviceAccountAdmissionError } from '../../src/host/devices/deviceReceiver'
import { deviceAccountRequestSchema } from '../../src/core/team/remotePool'
import { parseUsd } from '../../src/shared/usd'
import { receiverRig } from './helpers/deviceAccounts'
import { policyRig } from './helpers/accounts/policy'
import { poolRequest } from './helpers/accounts/pool'

const vendor = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null } as const

describe('M108 D receiver-owned account admission', () => {
  it('scans vendor limits across unpinned siblings in the full limit group', async () => {
    const rig = receiverRig('anthropic', 'api')
    for (const row of rig.rows) row.limitGroup = 'shared'
    rig.here.delete('b')
    rig.blocks.set('c', { blocked: { reason: 'rateLimited', resetAt: null } })
    expect(rig.receiver.offer()).toEqual({ anthropic: 'none' })
    await expect(rig.receive()).rejects.toThrow()
    expect(rig.deps.reserve).not.toHaveBeenCalled()
    expect(rig.dispatch).not.toHaveBeenCalled()
  })

  it('admits the credential with advertised room and refuses a sole empty bucket', async () => {
    const rig = receiverRig('anthropic', 'api')
    rig.headroom.set('a', 'none')
    expect(rig.receiver.offer()).toEqual({ anthropic: 'ample' })
    expect(await rig.receive()).toBe('b')
    rig.here.delete('b')
    rig.receiverDeps.request = (fragment) =>
      poolRequest({ owner: 'other', modelId: fragment.modelId })
    await expect(rig.receive()).rejects.toThrow()
    expect(rig.dispatch).toHaveBeenCalledTimes(1)
  })

  it('uses the advertised ample bucket even while the current credential has some room', async () => {
    const rig = receiverRig('anthropic', 'api')
    rig.headroom.set('a', 'some')
    expect(rig.receiver.offer()).toEqual({ anthropic: 'ample' })
    expect(await rig.receive()).toBe('b')
  })

  it('rejects a shared busy owner with a typed refusal', async () => {
    const rig = receiverRig('anthropic', 'api')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const local = rig.pool.run(poolRequest(), async (admission) => {
      entered.resolve(undefined)
      await release.promise
      admission.beforeSend()
      return { value: admission.account, actualUsd: admission.estimate.costUsd }
    })
    await entered.promise
    const refusal = rig.receive()
    try {
      await expect(refusal).rejects.toMatchObject({ code: 'busyOwner' })
    } finally {
      release.resolve(undefined)
      await local
    }
    expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
  })

  it('rechecks advertised capacity and unpinned group limits after credential waits', async () => {
    for (const cause of ['bucket', 'group']) {
      const rig = receiverRig('anthropic', 'api')
      for (const row of rig.rows) row.limitGroup = 'shared'
      await expect(
        rig.receiver.receive({ provider: 'anthropic', modelId: 'fake-model' }, (admission) => {
          if (cause === 'bucket') rig.headroom.set(admission.account, 'none')
          else rig.blocks.set('c', { blocked: { reason: 'rateLimited', resetAt: null } })
          admission.beforeSend()
          return Promise.resolve({ value: 'sent', actualUsd: admission.estimate.costUsd })
        }),
      ).rejects.toThrow()
      expect(rig.claims[0]?.actual).toBe(parseUsd(0))
      expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
    }
  })

  it('joins local and receiver admission before either reservation completes', async () => {
    const rig = receiverRig('anthropic', 'api')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const reserve = rig.deps.reserve
    rig.deps.reserve = vi.fn(async (...args: Parameters<typeof reserve>) => {
      entered.resolve(undefined)
      await release.promise
      return await reserve(...args)
    })
    const local = rig.run({ owner: 'local' })
    await entered.promise
    const remote = rig.receive()
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(rig.deps.reserve).toHaveBeenCalledTimes(1)
    release.resolve(undefined)
    await Promise.all([local, remote])
    expect(rig.deps.reserve).toHaveBeenCalledTimes(2)
  })

  it.each(['ownCapsOnly', 'cancel'] as const)('distinguishes the %s refusal', async (choice) => {
    const rig = receiverRig()
    rig.ask.mockResolvedValue(choice)
    await expect(rig.receive(vendor)).rejects.toMatchObject({ code: choice })
  })

  it('distinguishes recovery from unavailable admission', async () => {
    const rig = receiverRig('openai', 'chatgpt-plan')
    await expect(rig.receive(vendor)).rejects.toMatchObject({ code: 'recovery' })
  })

  it('offers only per-provider buckets, computed from local pins without account data', () => {
    const rig = receiverRig()
    rig.headroom.set('a', 'some')
    rig.rows[0]!.label = 'private-label-canary'
    rig.rows[0]!.limitGroup = 'private-group-canary'
    expect(rig.receiver.offer()).toEqual({ meta: 'ample' })
    rig.here.delete('b')
    expect(rig.receiver.offer()).toEqual({ meta: 'some' })
    rig.headroom.set('a', 'none')
    expect(rig.receiver.offer()).toEqual({ meta: 'none' })
    rig.headroom.set('c', 'ample')
    expect(rig.receiver.offer()).toEqual({ meta: 'none' })
    expect(JSON.stringify(rig.receiver.offer())).not.toMatch(/canary|label|account|group|confirm/)
    expect(Object.keys(rig.receiver.offer())).toEqual(['meta'])
  })

  it('rejects invalid headroom and reports unavailable policies/providers with no capacity', () => {
    const rig = receiverRig()
    rig.headroom.set('a', 'unknown')
    expect(() => rig.receiver.offer()).toThrow()
    rig.change({ pooling: 'notOffered' })
    expect(rig.receiver.offer()).toEqual({ meta: 'none' })
    rig.change({ pooling: 'confirm', isCredentialHeld: false })
    expect(rig.receiver.offer()).toEqual({ meta: 'none' })
    rig.receiverDeps.pool = () => undefined
    expect(rig.receiver.offer()).toEqual({ meta: 'none' })
  })

  it('uses its own pinned account, local budgets and verified estimate for a single-model user', async () => {
    const rig = receiverRig()
    expect(await rig.receive()).toBe('a')
    expect(rig.ask).not.toHaveBeenCalled()
    expect(rig.claims[0]?.account).toBe('a')
    expect(rig.deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ costUsd: parseUsd('0.1') }),
      expect.objectContaining({ budgetOwner: 'main', account: 'a', modelId: 'fake-model' }),
    )
    expect(rig.claim.finish).toHaveBeenCalledWith('returned')
  })

  it('asks the receiver before vendor-limit routing even when its own account has room', async () => {
    const rig = receiverRig()
    expect(rig.receiver.offer()).toEqual({ meta: 'ample' })
    expect(await rig.receive(vendor)).toBe('a')
    expect(rig.ask).toHaveBeenCalledTimes(1)
    expect(await rig.receive(vendor)).toBe('a')
    expect(rig.ask).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a sender machine confirmation or ask in a noninteractive receiver', async () => {
    const sender = policyRig()
    sender.deps.machineId = 'sender-machine'
    await sender.confirmations.obtain(sender.policy(), true)
    const rig = receiverRig()
    for (const [key, value] of sender.data) rig.data.set(key, value)
    rig.mode.isInteractive = false
    await expect(rig.receive(vendor)).rejects.toThrow(DeviceAccountAdmissionError)
    expect(rig.ask).not.toHaveBeenCalled()
    expect(rig.dispatch).not.toHaveBeenCalled()
    expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
    rig.mode.isInteractive = true
    expect(await rig.receive(vendor)).toBe('a')
    expect(rig.ask).toHaveBeenCalledTimes(1)
  })

  it('honors Only at my own caps and Cancel, and respects on and one-person rows', async () => {
    for (const choice of ['ownCapsOnly', 'cancel']) {
      const rig = receiverRig()
      rig.ask.mockResolvedValue(choice)
      await expect(rig.receive(vendor)).rejects.toMatchObject({
        decision: { kind: 'stop', reason: choice },
      })
      expect(rig.dispatch).not.toHaveBeenCalled()
    }
    const on = receiverRig('anthropic', 'api')
    expect(await on.receive(vendor)).toBe('a')
    expect(on.ask).not.toHaveBeenCalled()
    const one = receiverRig('openrouter', 'api')
    await one.receive()
    expect(one.ask).toHaveBeenCalledTimes(1)
  })

  it('offers documented plan recovery before pooling and never forwards sender recovery approval', async () => {
    for (const [provider, product, recovery] of [
      ['openai', 'chatgpt-plan', 'chatgptPlan'],
      ['meta', 'muse-code', 'museCodeSubscription'],
    ]) {
      const rig = receiverRig(provider, product)
      await expect(rig.receive(vendor)).rejects.toMatchObject({
        decision: { kind: 'recovery', recovery },
      })
      expect(rig.ask).not.toHaveBeenCalled()
      expect(rig.dispatch).not.toHaveBeenCalled()
      expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
    }
  })

  it('rejects sender accounts, secrets, policy answers, modes, flags, prices and unknown fields', async () => {
    const rig = receiverRig()
    const frame = { provider: 'meta', modelId: 'fake-model' }
    const forbidden = Object.entries({
      account: 'sender-account',
      label: 'canary',
      credential: 'canary',
      confirmation: 'confirm',
      machineId: 'sender',
      isInteractive: true,
      hasPoolFlag: true,
      hasOfferedRecovery: true,
      costUsd: 0,
    })
    for (const [field, value] of forbidden) {
      expect(deviceAccountRequestSchema.safeParse({ ...frame, [field]: value }).success).toBe(false)
      await expect(
        rig.receiver.receive({ ...frame, [field]: value }, rig.dispatch),
      ).rejects.toThrow()
    }
    expect(rig.receiverDeps.admit).not.toHaveBeenCalled()
    await expect(
      rig.receiver.receive({ provider: 'unknown', modelId: 'fake-model' }, rig.dispatch),
    ).rejects.toThrow()
    rig.receiverDeps.request = () => ({
      owner: 'local',
      budgetOwner: 'local',
      modelId: 'other-model',
      kind: 'conversation',
      account: 'a',
      estimate: { costUsd: parseUsd(0), inputTokens: 0, outputTokens: 0, requests: 1 },
      isInteractive: true,
    })
    await expect(rig.receive()).rejects.toThrow()
  })

  it('refuses missing receiver consent or a removed provider before policy spending', async () => {
    const rig = receiverRig()
    rig.receiverDeps.admit = vi.fn(() => Promise.resolve(undefined))
    await expect(rig.receive(vendor)).rejects.toThrow()
    expect(rig.ask).not.toHaveBeenCalled()
    expect(rig.deps.reserve).not.toHaveBeenCalled()
    rig.receiverDeps.pool = () => undefined
    await expect(rig.receive()).rejects.toThrow()
  })

  it('fences revocation, policy edits and receiver grants after credential waits and on retries', async () => {
    for (const change of ['revoke', 'policy', 'claim', 'provider']) {
      const rig = receiverRig()
      const frame = { provider: 'meta', modelId: 'fake-model', trigger: vendor }
      await expect(
        rig.receiver.receive(frame, async (admission) => {
          switch (change) {
            case 'revoke': {
              await rig.confirmations.revoke('meta', 'model-api')
              break
            }
            case 'policy': {
              rig.change({ recordVersion: 'changed' })
              break
            }
            case 'claim': {
              rig.claim.check.mockImplementation(() => {
                throw new Error('revoked')
              })
              break
            }
            case 'provider': {
              rig.receiverDeps.pool = () => undefined
              break
            }
          }
          admission.check()
          admission.beforeSend()
          return { value: 'sent', actualUsd: admission.estimate.costUsd }
        }),
      ).rejects.toThrow()
      expect(rig.claims[0]?.actual).toBe(parseUsd(0))
      expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
    }
    const rig = receiverRig()
    await expect(
      rig.receiver.receive(
        { provider: 'meta', modelId: 'fake-model', trigger: vendor },
        async (admission) => {
          admission.beforeSend()
          await rig.confirmations.revoke('meta', 'model-api')
          admission.beforeSend()
          return { value: 'retry', actualUsd: admission.estimate.costUsd }
        },
      ),
    ).rejects.toThrow()
    expect(rig.claims[0]?.actual).toBeNull()
    expect(rig.claim.finish).toHaveBeenCalledWith('uncertain')
  })

  it('filters remote pins during selection and rechecks removal, model access and re-pinning before send', async () => {
    const rig = receiverRig('anthropic', 'api')
    rig.receiverDeps.request = (fragment) =>
      poolRequest({ owner: 'worker', kind: 'worker', modelId: fragment.modelId })
    expect(await rig.receive()).toBe('b')
    for (const change of ['pin', 'model', 'remove']) {
      const receiver = receiverRig()
      await expect(
        receiver.receiver.receive({ provider: 'meta', modelId: 'fake-model' }, (admission) => {
          switch (change) {
            case 'pin': {
              receiver.here.delete(admission.account)
              break
            }
            case 'model': {
              receiver.deps.canUseModel = () => false
              break
            }
            case 'remove': {
              receiver.rows.shift()
              break
            }
          }
          admission.beforeSend()
          return Promise.resolve({ value: 'sent', actualUsd: admission.estimate.costUsd })
        }),
      ).rejects.toThrow()
      expect(receiver.claim.finish).toHaveBeenCalledWith('notSent')
    }
  })

  it('invalidates an admission when its account is re-pinned away and back during credential lookup', async () => {
    const rig = receiverRig()
    await expect(
      rig.receiver.receive({ provider: 'meta', modelId: 'fake-model' }, (admission) => {
        rig.here.delete('a')
        rig.placement.generation += 1
        rig.here.add('a')
        rig.placement.generation += 1
        admission.beforeSend()
        return Promise.resolve({ value: 'sent', actualUsd: admission.estimate.costUsd })
      }),
    ).rejects.toThrow('Placement changed')
    expect(rig.claim.finish).toHaveBeenCalledWith('notSent')
    expect(rig.claims[0]?.actual).toBe(parseUsd(0))
  })

  it('keeps receiver thresholds, Retry-After and the original shared budget in force', async () => {
    const rig = receiverRig('anthropic', 'api')
    rig.here.delete('b')
    rig.blocks.set('a', { blocked: { reason: 'rateLimited', resetAt: '2026-10-06T13:00:00Z' } })
    await expect(rig.receive()).rejects.toThrow()
    expect(rig.dispatch).not.toHaveBeenCalled()
    rig.blocks.clear()
    rig.cap.value = parseUsd('0.05')
    await expect(rig.receive()).rejects.toThrow('shared budget exceeded')
    expect(rig.dispatch).not.toHaveBeenCalled()
    expect(rig.claim.finish).toHaveBeenLastCalledWith('notSent')
  })

  it('preserves uncertain receiver liability and refunds only a known nonsend', async () => {
    const rig = receiverRig()
    await expect(
      rig.receiver.receive({ provider: 'meta', modelId: 'fake-model' }, () =>
        Promise.resolve({ value: 'missing fence', actualUsd: parseUsd(0) }),
      ),
    ).rejects.toThrow()
    expect(rig.claims[0]?.actual).toBe(parseUsd(0))
    await expect(
      rig.receiver.receive({ provider: 'meta', modelId: 'fake-model' }, (admission) => {
        admission.beforeSend()
        throw new Error('unknown result')
      }),
    ).rejects.toThrow('unknown result')
    expect(rig.claims[1]?.actual).toBeNull()
    expect(rig.claim.finish).toHaveBeenLastCalledWith('uncertain')
  })
})
