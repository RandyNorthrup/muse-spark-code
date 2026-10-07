import { describe, expect, it, vi } from 'vitest'
import {
  AccountPoolStoppedError,
  accountColdCacheEstimate,
  accountReplay,
  type AccountReplayIdentity,
  type AccountPoolDeps,
} from '../../src/core/accounts/pool'
import { AccountThresholdExceededError } from '../../src/core/accounts/thresholds'
import { parseUsd } from '../../src/shared/accountUsd'
import { poolRig, poolRequest, POOL_NOW } from './helpers/accounts/pool'

const RESET = new Date(POOL_NOW + 60_000).toISOString()
const blocked = { blocked: { reason: 'rateLimited', resetAt: RESET } } as const

describe('M108 account pool request boundaries', () => {
  it('refreshes a sticky grant after policy changes or revoke and reconfirm without bypassing its reason', async () => {
    const t = poolRig('meta', 'model-api')
    t.blocks.set('a', blocked)
    expect(await t.run()).toBe('b')
    t.change({ recordVersion: 'new-version' })
    expect(await t.run()).toBe('b')
    expect(t.ask).toHaveBeenCalledTimes(2)
    await t.confirmations.revoke('meta', 'model-api')
    t.ask.mockResolvedValue('ownCapsOnly')
    await t.confirmations.obtain(t.policy(), true)
    await expect(t.run()).rejects.toMatchObject({ decision: { reason: 'ownCapsOnly' } })
    await t.confirmations.revoke('meta', 'model-api')
    t.ask.mockResolvedValue('confirm')
    await t.confirmations.obtain(t.policy(), true)
    expect(await t.run()).toBe('b')
    expect(t.pool.current('conversation', 'main')).toBe('b')
  })

  it('commits no swap for failed credentials or a final fence and adopts together with the event', async () => {
    for (const failure of ['credentials', 'fence']) {
      const t = poolRig()
      expect(await t.run()).toBe('a')
      t.blocks.set('a', blocked)
      const events = t.events.length
      await expect(
        t.pool.run(poolRequest(), async (admission) => {
          await Promise.resolve()
          expect(t.pool.current('conversation', 'main')).toBe('a')
          expect(t.events).toHaveLength(events)
          if (failure === 'credentials') throw new Error('credential unavailable')
          t.blocks.set(admission.account, blocked)
          admission.beforeSend()
          return { value: 'never', actualUsd: parseUsd(0) }
        }),
      ).rejects.toThrow()
      expect(t.events).toHaveLength(events)
      expect(t.pool.current('conversation', 'main')).toBe('a')
      expect(t.claims[1]!.actual).toBe(parseUsd(0))
    }
    const t = poolRig()
    await t.run()
    t.blocks.set('a', blocked)
    expect(await t.run()).toBe('b')
    expect(t.events).toEqual([
      expect.objectContaining({ type: 'swap', account: t.pool.current('conversation', 'main') }),
    ])
  })

  it('serializes overlapping worker consent, credential waits, revocation and atomic event fences', async () => {
    const t = poolRig('meta', 'model-api')
    await t.run()
    t.blocks.set('a', blocked)
    const credentials = Promise.withResolvers<undefined>()
    const ready = Promise.withResolvers<undefined>()
    const pending = t.pool.run(poolRequest(), async (admission) => {
      ready.resolve(undefined)
      await credentials.promise
      admission.beforeSend()
      return { value: admission.account, actualUsd: admission.estimate.costUsd }
    })
    await ready.promise
    expect(await t.run({ kind: 'worker', owner: 'worker-one' })).toBe('c')
    expect(t.ask).toHaveBeenCalledTimes(1)
    const workerEvents = [...t.events]
    await t.confirmations.revoke('meta', 'model-api')
    credentials.resolve(undefined)
    await expect(pending).rejects.toThrow()
    expect(t.pool.current('conversation', 'main')).toBe('a')
    expect(t.events).toEqual(workerEvents)
    expect(t.claims[1]!.actual).toBe(parseUsd(0))
    await t.confirmations.obtain(t.policy(), true)
    const commit = t.deps.commit
    t.deps.commit = (event, adopt) => {
      t.settings.isSwapOn = false
      commit(event, adopt)
    }
    await expect(t.run()).rejects.toThrow()
    expect(t.events).toEqual(workerEvents)
    expect(t.pool.current('conversation', 'main')).toBe('a')
    t.settings.isSwapOn = true
    t.deps.commit = (event, adopt) => {
      commit(event, adopt)
      expect(t.pool.current('conversation', 'main')).toBe(event.account)
    }
    expect(await t.run()).toBe('b')
    expect(t.events.filter((event) => event.type === 'swap')).toHaveLength(2)
  })

  it('waits for every blocking trigger per account then chooses a known recovery over unknown peers', async () => {
    const t = poolRig()
    t.rows.splice(1)
    t.rows[0]!.thresholds = { requests: { day: 1 } }
    t.counts.set('a', 1)
    t.blocks.set('a', blocked)
    const dailyReset = new Date(new Date(POOL_NOW).setHours(24, 0, 0, 0)).toISOString()
    await expect(t.run()).rejects.toMatchObject({ resetAt: dailyReset })
    t.deps.now = () => Date.parse(RESET)
    await expect(t.run()).rejects.toMatchObject({ resetAt: dailyReset })
    const peers = poolRig()
    peers.blocks.set('a', { blocked: { reason: 'quota', resetAt: null } })
    peers.blocks.set('b', blocked)
    peers.blocks.set('c', { blocked: { reason: 'quota', resetAt: null } })
    await expect(peers.run()).rejects.toMatchObject({ resetAt: RESET })
  })

  it('swaps in configured order at a user cap and stays on the new account', async () => {
    const t = poolRig()
    t.rows[0]!.thresholds = { spendUsd: { day: 1 } }
    t.settled.set('a', parseUsd(1))
    t.rows[1]!.order = 2
    t.rows[2]!.order = 1
    expect(await t.run()).toBe('c')
    expect(await t.run()).toBe('c')
    expect(t.pool.current('conversation', 'main')).toBe('c')
    expect(t.events).toEqual([
      expect.objectContaining({
        type: 'swap',
        account: 'c',
        previousAccount: 'a',
        coldCacheUsd: 0.02,
      }),
    ])
    expect(t.ask).not.toHaveBeenCalled()
  })

  it('stops when every account is full with the reset and usage link; never dispatches', async () => {
    const t = poolRig()
    for (const account of t.rows) t.blocks.set(account.id, blocked)
    let stopped: unknown
    try {
      await t.run()
    } catch (error: unknown) {
      stopped = error
    }
    expect(stopped).toBeInstanceOf(AccountPoolStoppedError)
    expect(stopped).toMatchObject({ resetAt: RESET, usageUrl: 'https://example.test/usage' })
    expect(t.dispatch).not.toHaveBeenCalled()
    expect(t.events).toEqual([expect.objectContaining({ type: 'stop', account: 'a' })])
    t.blocks.set('b', { blocked: { reason: 'quota', resetAt: null } })
    await expect(t.run()).rejects.toMatchObject({ resetAt: RESET })
  })

  it('includes every shared peer vendor trigger in account recovery', async () => {
    const t = poolRig()
    for (const row of t.rows) row.limitGroup = 'same-team'
    t.blocks.set('b', blocked)
    const later = new Date(POOL_NOW + 120_000).toISOString()
    t.blocks.set('c', { blocked: { reason: 'usageLimit', resetAt: later } })
    await expect(t.run()).rejects.toMatchObject({ resetAt: later })
    expect(t.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'before the current monthly cap', isTie: false, recovered: 'b' },
    { name: 'in configured fallback order on a tie', isTie: true, recovered: 'c' },
  ])('recovers a same-group candidate $name', async ({ isTie, recovered }) => {
    const t = poolRig()
    for (const row of t.rows) row.limitGroup = 'same-team'
    t.rows[0]!.thresholds = { requests: { month: 1 } }
    t.counts.set('a', 1)
    if (isTie) {
      t.rows[1]!.order = 2
      t.rows[2]!.order = 1
    } else {
      t.rows[2]!.thresholds = { requests: { day: 1 } }
      t.counts.set('c', 1)
    }
    t.blocks.set('b', blocked)
    await expect(t.run()).rejects.toMatchObject({ resetAt: RESET })
    expect(t.deps.sharedGroupNotice).toHaveBeenCalledWith('b')
    expect(t.deps.sharedGroupNotice).toHaveBeenCalledWith('c')
    expect(t.deps.reserve).not.toHaveBeenCalled()
    expect(t.dispatch).not.toHaveBeenCalled()
    t.deps.now = () => Date.parse(RESET) - 1
    await expect(t.run()).rejects.toMatchObject({ resetAt: RESET })
    expect(t.dispatch).not.toHaveBeenCalled()
    t.deps.now = () => Date.parse(RESET)
    expect(await t.run()).toBe(recovered)
    expect(t.pool.current('conversation', 'main')).toBe(recovered)
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: 'swap', account: recovered, previousAccount: 'a' }),
    )
    expect(await t.run()).toBe(recovered)
  })

  it('honors per-account Retry-After at each send and keeps sent uncertainty on its account', async () => {
    const t = poolRig()
    await expect(
      t.pool.run(poolRequest(), async (admission) => {
        await Promise.resolve()
        admission.beforeSend()
        t.blocks.set(admission.account, blocked)
        admission.beforeSend()
        return { value: 'never', actualUsd: parseUsd(0) }
      }),
    ).rejects.toBeInstanceOf(AccountThresholdExceededError)
    expect(t.claims[0]).toMatchObject({ account: 'a', actual: null })
    expect(await t.run()).toBe('b')
    expect(t.claims[0]!.actual).toBeNull()
  })

  it('skips a shared limit group with a notice and propagates a peer/global block', async () => {
    const t = poolRig()
    t.rows[0]!.limitGroup = 'org'
    t.rows[1]!.limitGroup = 'org'
    t.blocks.set('a', blocked)
    expect(await t.run()).toBe('c')
    expect(t.deps.sharedGroupNotice).toHaveBeenCalledWith('b')
    const peer = poolRig()
    peer.rows[0]!.limitGroup = 'org'
    peer.rows[1]!.limitGroup = 'org'
    peer.blocks.set('b', blocked)
    expect(await peer.run()).toBe('c')
    const global = poolRig('openrouter', 'api')
    global.blocks.set('a', blocked)
    await expect(global.run()).rejects.toMatchObject({ resetAt: RESET })
    expect(global.dispatch).not.toHaveBeenCalled()
  })

  it('requires policy confirmation for vendor pooling, and revocation stops the sticky assignment', async () => {
    const t = poolRig('meta', 'model-api')
    t.blocks.set('a', blocked)
    t.ask.mockResolvedValue('ownCapsOnly')
    await expect(t.run()).rejects.toMatchObject({ decision: { reason: 'ownCapsOnly' } })
    expect(t.dispatch).not.toHaveBeenCalled()
    await t.confirmations.revoke('meta', 'model-api')
    t.ask.mockResolvedValue('confirm')
    expect(await t.run()).toBe('b')
    expect(await t.run()).toBe('b')
    await t.confirmations.revoke('meta', 'model-api')
    await expect(t.run({ isInteractive: false, hasPoolFlag: true })).rejects.toMatchObject({
      decision: { reason: 'confirmation' },
    })
  })

  it('spreads by current headroom and sticks per worker without moving the conversation', async () => {
    const t = poolRig()
    expect(await t.run()).toBe('a')
    expect(await t.run({ kind: 'worker', owner: 'worker-one' })).toBe('c')
    t.scores.set('b', 10n)
    expect(await t.run({ kind: 'worker', owner: 'worker-two' })).toBe('b')
    expect(await t.run({ kind: 'worker', owner: 'worker-one' })).toBe('c')
    expect(await t.run()).toBe('a')
    expect(
      t.events.filter((event) => event.type === 'spread').map((event) => event.account),
    ).toEqual(['c', 'b'])
  })

  it('reserves before another parallel admission and skips accounts whose pending cap is full', async () => {
    const t = poolRig()
    for (const row of t.rows) row.thresholds = { requests: { day: 1 } }
    const wait = Promise.withResolvers<undefined>()
    const calls: string[] = []
    const send = async (admission: Parameters<Parameters<typeof t.pool.run>[1]>[0]) => {
      admission.beforeSend()
      calls.push(admission.account)
      await wait.promise
      return { value: admission.account, actualUsd: admission.estimate.costUsd }
    }
    const first = t.pool.run(poolRequest({ kind: 'worker', owner: 'one' }), send)
    const second = t.pool.run(poolRequest({ kind: 'worker', owner: 'two' }), send)
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2)
    })
    expect(calls).toEqual(['c', 'b'])
    wait.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual(['c', 'b'])
  })

  it('includes the exact cold-cache estimate in both the swap row and the reservation', async () => {
    expect(accountColdCacheEstimate(333, '0.1')).toBe(parseUsd('0.0000333'))
    expect(() => accountColdCacheEstimate(0.5, '0.1')).toThrow()
    const t = poolRig()
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    t.deps.coldCache = () => parseUsd('0.2')
    expect(await t.run()).toBe('b')
    expect(t.claims[0]!.estimate.costUsd).toBe(parseUsd('0.3'))
    expect(t.events[0]).toMatchObject({ type: 'swap', coldCacheUsd: 0.2 })
    const capped = poolRig()
    capped.rows[0]!.thresholds = { requests: { day: 0 } }
    capped.rows[1]!.thresholds = { spendUsd: { day: 0.11 } }
    expect(await capped.run()).toBe('c')
  })

  it('never resets the original shared budget at a swap, and refunds a known nonsend', async () => {
    const t = poolRig()
    t.settled.set('a', parseUsd('0.7'))
    t.rows[0]!.thresholds = { spendUsd: { day: 0.7 } }
    t.cap.value = parseUsd('0.8')
    await expect(t.run()).rejects.toThrow('shared budget exceeded')
    expect(t.dispatch).not.toHaveBeenCalled()
    expect(t.claims[0]!.actual).toBe(parseUsd(0))
    expect(t.settled.get('a')).toBe(parseUsd('0.7'))
    expect(vi.mocked(t.deps.reserve).mock.calls[0]![2]).toMatchObject({
      budgetOwner: 'main',
      account: 'a',
    })
  })

  it('records before sending, refuses a silent swap and rechecks after credentials are awaited', async () => {
    const t = poolRig()
    t.blocks.set('a', blocked)
    t.deps.commit = vi.fn(() => {
      throw new Error('transcript unavailable')
    })
    await expect(t.run()).rejects.toThrow('transcript unavailable')
    expect(t.pool.current('conversation', 'main')).toBeUndefined()
    expect(t.events).toEqual([])
    expect(t.claims[0]!.actual).toBe(parseUsd(0))
    const delayed = poolRig()
    await expect(
      delayed.pool.run(poolRequest(), async (admission) => {
        await Promise.resolve()
        delayed.blocks.set(admission.account, blocked)
        admission.beforeSend()
        return { value: 'never', actualUsd: parseUsd(0) }
      }),
    ).rejects.toBeInstanceOf(AccountThresholdExceededError)
    expect(delayed.claims[0]!.actual).toBe(parseUsd(0))
  })

  it('rechecks removal, policy and settings after a reservation or popup', async () => {
    for (const mutation of ['removal', 'policy', 'settings']) {
      const t = poolRig('meta', 'model-api')
      t.blocks.set('a', blocked)
      const reserve = t.deps.reserve
      t.deps.reserve = async (account, estimate, request) => {
        const claim = await reserve(account, estimate, request)
        if (mutation === 'removal') t.rows.splice(1, 1)
        else if (mutation === 'policy') await t.confirmations.revoke('meta', 'model-api')
        else t.settings.isSwapOn = false
        return claim
      }
      await expect(t.run()).rejects.toThrow()
      expect(t.dispatch).not.toHaveBeenCalled()
      expect(t.claims[0]!.actual).toBe(parseUsd(0))
    }
  })

  it('cannot bypass vendor confirmation through a nonsent swap chosen at a user cap', async () => {
    const t = poolRig('meta', 'model-api')
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    await expect(
      t.pool.run(poolRequest(), async (admission) => {
        await Promise.resolve()
        t.blocks.set('a', blocked)
        admission.beforeSend()
        return { value: 'never', actualUsd: parseUsd(0) }
      }),
    ).rejects.toBeInstanceOf(AccountThresholdExceededError)
    expect(t.ask).not.toHaveBeenCalled()
    expect(await t.run()).toBe('b')
    expect(t.ask).toHaveBeenCalledTimes(1)
  })

  it('preserves single-account behavior, defaults on, explicit off and headless opt-in', async () => {
    const t = poolRig()
    t.rows.splice(1)
    expect(await t.run()).toBe('a')
    expect(t.events).toEqual([])
    expect(t.ask).not.toHaveBeenCalled()
    expect(await t.run({ kind: 'worker', owner: 'one' })).toBe('a')
    const single = poolRig('openrouter', 'api')
    single.rows.splice(1)
    expect(await single.run({ kind: 'worker', owner: 'one' })).toBe('a')
    expect(single.ask).not.toHaveBeenCalled()
    const off = poolRig()
    off.blocks.set('a', blocked)
    off.settings.isSwapOn = false
    await expect(off.run()).rejects.toBeInstanceOf(AccountPoolStoppedError)
    off.settings.isSwapOn = true
    await expect(off.run({ isInteractive: false })).rejects.toBeInstanceOf(AccountPoolStoppedError)
    expect(await off.run({ isInteractive: false, hasPoolFlag: true })).toBe('b')
    off.settings.isParallelOn = false
    off.blocks.clear()
    expect(await off.run({ kind: 'worker', owner: 'one' })).toBe('a')
  })

  it('skips accounts without the selected model and rechecks model access before sending', async () => {
    const t = poolRig()
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    t.deps.canUseModel = (account) => account.id !== 'b'
    expect(await t.run()).toBe('c')
    await expect(
      t.pool.run(poolRequest(), async (admission) => {
        await Promise.resolve()
        t.deps.canUseModel = () => false
        admission.beforeSend()
        return { value: 'never', actualUsd: parseUsd(0) }
      }),
    ).rejects.toThrow()
    expect(t.claims[1]!.actual).toBe(parseUsd(0))
  })

  it('refuses money precision loss and negative settlements instead of releasing liability', async () => {
    const t = poolRig()
    await expect(
      t.run({
        estimate: { ...poolRequest().estimate, costUsd: parseUsd('9007199254740990.000000001') },
      }),
    ).rejects.toThrow()
    expect(t.claims).toHaveLength(0)
    await expect(
      t.pool.run(poolRequest(), async (admission) => {
        await Promise.resolve()
        admission.beforeSend()
        return { value: 'invalid', actualUsd: -1n }
      }),
    ).rejects.toThrow()
    expect(t.claims[0]!.actual).toBeNull()
  })

  it('refuses a negative cold-cache estimate or a dispatch that skipped its final guard', async () => {
    const t = poolRig()
    t.rows[0]!.thresholds = { requests: { day: 0 } }
    t.deps.coldCache = () => -1n
    await expect(t.run()).rejects.toThrow()
    expect(t.claims).toHaveLength(0)
    const noSend = poolRig()
    await expect(
      noSend.pool.run(poolRequest(), () =>
        Promise.resolve({ value: 'no send', actualUsd: parseUsd(0) }),
      ),
    ).rejects.toThrow()
    expect(noSend.claims[0]!.actual).toBe(parseUsd(0))
    expect(noSend.pool.current('conversation', 'main')).toBeUndefined()
    await expect(
      noSend.pool.run(poolRequest(), async (admission) => {
        admission.check()
        await Promise.resolve()
        throw new Error('known preflight refusal')
      }),
    ).rejects.toThrow('known preflight refusal')
    expect(noSend.claims[1]!.actual).toBe(parseUsd(0))
  })

  it('binds the model, estimate and original budget owner across asynchronous admission', async () => {
    const t = poolRig()
    const request = { ...poolRequest(), modelId: 'chosen-model' }
    t.deps.canUseModel = vi.fn<AccountPoolDeps['canUseModel']>(
      (_account, frame) => frame.modelId === 'chosen-model',
    )
    const reserve = t.deps.reserve
    t.deps.reserve = async (account, estimate, frame) => {
      const claim = await reserve(account, estimate, frame)
      request.modelId = 'different-model'
      request.budgetOwner = 'different-parent'
      request.estimate = { ...request.estimate, costUsd: parseUsd('10') }
      return claim
    }
    expect(await t.pool.run(request, t.dispatch)).toBe('a')
    expect(
      vi.mocked(t.deps.canUseModel).mock.calls.every((call) => call[1].modelId === 'chosen-model'),
    ).toBe(true)
    expect(t.claims[0]!.estimate.costUsd).toBe(parseUsd('0.1'))
  })

  it('rejects duplicate active owners, empty pools, invalid headroom and forbidden products', async () => {
    const t = poolRig()
    const finish = Promise.withResolvers<undefined>()
    const first = t.pool.run(poolRequest(), async (admission) => {
      admission.beforeSend()
      await finish.promise
      return { value: 'done', actualUsd: parseUsd(0) }
    })
    await expect(t.run()).rejects.toThrow()
    finish.resolve(undefined)
    expect(await first).toBe('done')
    expect(t.claims[0]!.actual).toBe(parseUsd(0))
    t.rows.length = 0
    await expect(t.run()).rejects.toThrow()
    const score = poolRig()
    score.scores.set('c', -1n)
    await expect(score.run({ kind: 'worker', owner: 'one' })).rejects.toThrow()
    const forbidden = poolRig('anthropic', 'claude-plan')
    await expect(forbidden.run()).rejects.toMatchObject({ decision: { reason: 'notOffered' } })
  })
})

describe('M108 account-bound replay', () => {
  it('drops foreign or unknown native reasoning while retaining text and exact producer identity', () => {
    const identity: AccountReplayIdentity = {
      provider: 'meta',
      account: 'a',
      origin: 'https://api.meta.ai',
      model: 'muse-spark-1.3',
    }
    const native = { kind: 'native', text: 'visible summary', encrypted: 'fake-native' }
    const text = { kind: 'text', text: 'visible text', encrypted: '' }
    const codec = {
      isNative: (item: typeof native) => item.kind === 'native',
      textOnly: (item: typeof native) => [{ ...text, text: item.text }],
    }
    for (const patch of [
      { account: 'b' },
      { provider: 'openai' },
      { model: 'other' },
      { origin: 'https://other.test' },
    ]) {
      const projected = accountReplay(
        [{ item: native, producer: identity }, { item: text }],
        { ...identity, ...patch },
        codec,
      )
      expect(projected).toEqual([{ ...text, text: native.text }, text])
      expect(JSON.stringify(projected)).not.toContain('fake-native')
    }
    expect(accountReplay([{ item: native }], identity, codec)).toEqual([
      { ...text, text: native.text },
    ])
    expect(
      accountReplay([{ item: native, producer: identity }, { item: text }], identity, codec),
    ).toEqual([native, text])
  })
})
