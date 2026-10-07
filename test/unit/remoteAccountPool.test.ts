import { describe, expect, it, vi } from 'vitest'
import {
  AccountPlacements,
  AccountPlacementError,
  sendToDeviceLabel,
} from '../../src/core/team/remotePool'
import type { AccountRouteRequest, AccountPlacementStore } from '../../src/core/team/remotePool'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { placementRig, remoteDeviceRig, routeRequest } from './helpers/deviceAccounts'

const vendorLimit = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null } as const

describe('M108 D account placement', () => {
  it('pins each account to exactly one device or node and replaces its old placement', async () => {
    const rig = placementRig()
    await rig.placements.pin({ provider: 'anthropic', account: 'a', device: 'node-1' })
    const snapshot = await rig.placements.snapshot()
    expect(snapshot.rows.filter((row) => row.account === 'a')).toEqual([
      { provider: 'anthropic', account: 'a', device: 'node-1' },
    ])
  })

  it('defaults onePerDevicePerProvider on and names both ways forward on refusal', async () => {
    const rig = placementRig()
    const owner = new AccountPlacements({ store: rig.store, isKnown: rig.deps.isKnown })
    const pin = { provider: 'anthropic', account: 'b', device: 'device-0' }
    await expect(owner.pin(pin)).rejects.toThrow(AccountPlacementError)
    await expect(owner.pin(pin)).rejects.toThrow(fill(UI_TEXT.accounts.placementConflict, pin))
    expect(rig.store.write).not.toHaveBeenCalled()
    expect(rig.state.rows[1]?.device).toBe('device-1')
    rig.state.isRuleOn = false
    await rig.placements.pin(pin)
    const afterRuleOff = await rig.placements.snapshot()
    expect(afterRuleOff.rows.filter((row) => row.device === 'device-0')).toHaveLength(2)
  })

  it('allows different providers on one device and the same provider on separate devices', async () => {
    const rig = placementRig()
    await rig.placements.pin({ provider: 'meta', account: 'a', device: 'device-0' })
    const snapshot = await rig.placements.snapshot()
    expect(snapshot.rows).toHaveLength(4)
  })

  it('serializes competing pins before I/O, preserves the first, and recovers after refusal', async () => {
    const rig = placementRig()
    const operations = await Promise.allSettled([
      rig.placements.pin({ provider: 'anthropic', account: 'a', device: 'new-node' }),
      rig.placements.pin({ provider: 'anthropic', account: 'b', device: 'new-node' }),
    ])
    expect(operations.map((operation) => operation.status)).toEqual(['fulfilled', 'rejected'])
    expect(rig.state.rows.find((row) => row.account === 'b')?.device).toBe('device-1')
    await rig.placements.pin({ provider: 'anthropic', account: 'b', device: 'other-node' })
    const snapshot = await rig.placements.snapshot()
    expect(snapshot.rows).toHaveLength(3)
  })

  it('rechecks account/device membership and the rule at atomic metadata publication', async () => {
    const rig = placementRig()
    rig.state.isRuleOn = false
    rig.store.write = vi.fn<AccountPlacementStore['write']>((_rows, check) => {
      rig.state.isRuleOn = true
      check()
      return Promise.resolve()
    })
    await expect(
      rig.placements.pin({ provider: 'anthropic', account: 'b', device: 'device-0' }),
    ).rejects.toThrow(AccountPlacementError)
    rig.state.unknown.add('device-0')
    await expect(
      rig.placements.pin({ provider: 'meta', account: 'a', device: 'device-0' }),
    ).rejects.toThrow(UI_TEXT.accounts.routeUnavailable)
    rig.state.unknown.clear()
    rig.state.unknown.add('a')
    await expect(
      rig.placements.pin({ provider: 'meta', account: 'a', device: 'device-0' }),
    ).rejects.toThrow(UI_TEXT.accounts.routeUnavailable)
  })

  it('rejects malformed, duplicate or identity-bearing placement metadata', async () => {
    const rig = placementRig()
    rig.store.read = vi.fn(() => Promise.resolve([...rig.state.rows, rig.state.rows[0]]))
    await expect(rig.placements.snapshot()).rejects.toThrow()
    rig.store.read = vi.fn(() =>
      Promise.resolve([
        { provider: 'meta', account: 'a', device: 'device-0', credential: 'canary' },
      ]),
    )
    await expect(rig.placements.snapshot()).rejects.toThrow()
    await expect(
      rig.placements.pin({ provider: 'meta', account: 'a', device: '../profile' }),
    ).rejects.toThrow()
  })

  it('invalidates snapshots on pin changes, account removal and rule changes', async () => {
    const rig = placementRig()
    const snapshot = await rig.placements.snapshot()
    await rig.placements.pin({ provider: 'anthropic', account: 'a', device: 'node' })
    expect(snapshot.check).toThrow(UI_TEXT.accounts.routeUnavailable)
    const next = await rig.placements.snapshot()
    rig.state.isRuleOn = false
    expect(next.check).toThrow()
    const latest = await rig.placements.snapshot()
    rig.state.unknown.add('a')
    expect(latest.check).toThrow()
  })

  it('rejects a stale storage read during pinning and freezes published placement snapshots', async () => {
    const rig = placementRig()
    const read = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<undefined>()
    const original = rig.store.read
    rig.store.read = vi.fn(() => {
      entered.resolve(undefined)
      return read.promise
    })
    const pending = rig.placements.snapshot()
    const verdict = expect(pending).rejects.toThrow()
    await entered.promise
    rig.store.read = original
    const pin = rig.placements.pin({ provider: 'anthropic', account: 'a', device: 'node' })
    read.resolve(rig.state.rows)
    await verdict
    await pin
    const snapshot = await rig.placements.snapshot()
    expect(Object.isFrozen(snapshot.rows)).toBe(true)
    expect(snapshot.rows.every((row) => Object.isFrozen(row))).toBe(true)
    expect(Reflect.set(snapshot.rows[0]!, 'device', 'other')).toBe(false)
  })
})

describe('M108 D routing by the pinned device', () => {
  it('moves away from the live sticky account on every threshold', async () => {
    const rig = remoteDeviceRig()
    expect(await rig.run({ trigger: vendorLimit })).toBe('device-1')
    expect(await rig.run({ trigger: vendorLimit })).toBe('device-2')
    expect(await rig.run({ trigger: vendorLimit })).toBe('device-1')
  })

  it.each(['a', 'b'] as const)(
    'discards a deleted sticky account and continues routing from %s',
    async (account) => {
      const rig = remoteDeviceRig()
      await rig.run({ trigger: vendorLimit })
      rig.accounts.rows.splice(1, 1)
      rig.state.placement.rows.splice(1, 1)
      expect(await rig.run({ account })).toBe('device-0')
    },
  )

  it('rejects an unknown initial account instead of silently assigning another', async () => {
    const rig = remoteDeviceRig()
    await expect(rig.run({ account: 'unknown' })).rejects.toThrow(UI_TEXT.accounts.invalidAccount)
    expect(rig.deps.admit).not.toHaveBeenCalled()
  })

  it('keeps the selected route valid on retries after adopting its sticky account', async () => {
    const rig = remoteDeviceRig()
    await rig.run({ trigger: vendorLimit })
    expect(
      await rig.pool.run(routeRequest({ trigger: vendorLimit }), (route) => {
        route.beforeSend()
        route.beforeSend()
        return Promise.resolve(route.device)
      }),
    ).toBe('device-2')
  })

  it('reports a busy owner and a missing device with distinct typed reasons', async () => {
    const rig = remoteDeviceRig()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const first = rig.pool.run(routeRequest(), async (route) => {
      entered.resolve(undefined)
      await release.promise
      route.beforeSend()
      return route.device
    })
    await entered.promise
    await expect(rig.run()).rejects.toMatchObject({ code: 'busyOwner' })
    release.resolve(undefined)
    await first
    await expect(rig.run({ destination: 'missing' })).rejects.toMatchObject({
      code: 'missingDevice',
    })
  })

  it('reports a device lost during credential lookup as missing before dispatch', async () => {
    const rig = remoteDeviceRig()
    await expect(
      rig.pool.run(routeRequest(), (route) => {
        rig.state.remote.offers.shift()
        route.beforeSend()
        return Promise.resolve(route.device)
      }),
    ).rejects.toMatchObject({ code: 'missingDevice' })
    expect(rig.claims[0]?.finish).toHaveBeenCalledWith('notSent')
  })

  it('keeps a conversation on its pinned account, swaps by provider headroom, and sticks', async () => {
    const rig = remoteDeviceRig()
    expect(await rig.run()).toBe('device-0')
    expect(await rig.run({ trigger: vendorLimit })).toBe('device-1')
    rig.state.remote.offers[1]!.headroom.anthropic = 'some'
    rig.state.remote.offers[2]!.headroom.anthropic = 'ample'
    expect(await rig.run()).toBe('device-1')
  })

  it('spreads new workers by headroom and preserves worker stickiness and conversation ownership', async () => {
    const rig = remoteDeviceRig()
    expect(await rig.run({ kind: 'worker', owner: 'worker' })).toBe('device-1')
    rig.state.remote.offers[1]!.headroom.anthropic = 'some'
    rig.state.remote.offers[2]!.headroom.anthropic = 'ample'
    expect(await rig.run({ kind: 'worker', owner: 'worker' })).toBe('device-1')
    expect(await rig.run({ kind: 'worker', owner: 'other' })).toBe('device-2')
    expect(await rig.run()).toBe('device-0')
    expect(rig.deps.admit).toHaveBeenCalledWith(
      'device-1',
      expect.objectContaining({ budgetOwner: 'parent' }),
    )
  })

  it('respects pool order when provider buckets tie and ignores other providers headroom', async () => {
    const rig = remoteDeviceRig()
    rig.state.remote.offers[1]!.headroom.anthropic = 'some'
    expect(await rig.run({ trigger: vendorLimit })).toBe('device-1')
    rig.deps.offers = () => [{ device: 'device-2', headroom: { meta: 'ample' } }]
    await expect(rig.run()).rejects.toThrow(UI_TEXT.accounts.routeUnavailable)
  })

  it('routes manual Send to choices only to the named device, with no fallback after denial', async () => {
    const rig = remoteDeviceRig()
    expect(await rig.run({ destination: 'device-2' })).toBe('device-2')
    rig.state.remote.offers[2]!.headroom.anthropic = 'none'
    await expect(rig.run({ destination: 'device-2' })).rejects.toThrow()
    rig.deps.admit = vi.fn(() => Promise.resolve(undefined))
    await expect(rig.run({ destination: 'device-0' })).rejects.toThrow()
    expect(rig.deps.admit).toHaveBeenCalledTimes(1)
    expect(rig.dispatch).toHaveBeenCalledTimes(1)
  })

  it('sends only provider/model/trigger, never account ids, labels, confirmations or parent ids', async () => {
    const rig = remoteDeviceRig()
    await rig.run({ trigger: vendorLimit })
    const frame = rig.dispatch.mock.calls[0]?.[0].request
    expect(frame).toEqual({ provider: 'anthropic', modelId: 'fake-model', trigger: vendorLimit })
    expect(Object.keys(frame ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'modelId',
      'provider',
      'trigger',
    ])
    expect(
      rig.state.placement.rows.every((row) => !JSON.stringify(frame).includes(row.device)),
    ).toBe(true)
  })

  it('treats missing/unknown offers as unavailable and validates the authenticated fragment', async () => {
    const rig = remoteDeviceRig()
    rig.deps.offers = () => []
    await expect(rig.run()).rejects.toThrow()
    rig.deps.offers = () => [{ device: 'device-0', headroom: { anthropic: 'unknown' } }]
    await expect(rig.run()).rejects.toThrow()
    rig.deps.offers = () => [
      { device: 'device-0', headroom: { anthropic: 'ample' }, account: 'canary' },
    ]
    await expect(rig.run()).rejects.toThrow()
    rig.deps.offers = () => [rig.state.remote.offers[0], rig.state.remote.offers[0]]
    await expect(rig.run()).rejects.toThrow()
    expect(rig.deps.admit).not.toHaveBeenCalled()
  })

  it('refuses stale headroom, model/permission changes and unpairing before a send or retry', async () => {
    for (const change of ['headroom', 'permission', 'unpair', 'claim']) {
      const rig = remoteDeviceRig()
      await expect(
        rig.pool.run(routeRequest(), (route) => {
          switch (change) {
            case 'headroom': {
              rig.state.remote.offers[0]!.headroom.anthropic = 'none'
              break
            }
            case 'permission': {
              rig.state.remote.isAllowed = false
              break
            }
            case 'unpair': {
              rig.state.placement.unknown.add('device-0')
              break
            }
            case 'claim': {
              rig.claims[0]!.check.mockImplementation(() => {
                throw new Error('revoked')
              })
              break
            }
          }
          route.beforeSend()
          return Promise.resolve('sent')
        }),
      ).rejects.toThrow()
      expect(rig.claims[0]?.finish).toHaveBeenCalledWith('notSent')
    }
    const rig = remoteDeviceRig()
    await expect(
      rig.pool.run(routeRequest(), (route) => {
        route.beforeSend()
        rig.state.remote.isAllowed = false
        route.beforeSend()
        return Promise.resolve('retry')
      }),
    ).rejects.toThrow()
    expect(rig.claims[0]?.finish).toHaveBeenCalledWith('uncertain')
  })

  it('invalidates a queued route on repinning and never abandons or duplicates an uncertain send', async () => {
    const rig = remoteDeviceRig()
    await expect(
      rig.pool.run(routeRequest(), async (route) => {
        await rig.placements.pin({ provider: 'anthropic', account: 'a', device: 'new-node' })
        route.beforeSend()
        return route.device
      }),
    ).rejects.toThrow()
    expect(rig.claims[0]?.finish).toHaveBeenCalledWith('notSent')
    await expect(
      rig.pool.run(routeRequest({ account: 'b' }), (route) => {
        route.beforeSend()
        throw new Error('lost result')
      }),
    ).rejects.toThrow('lost result')
    expect(rig.claims[1]?.finish).toHaveBeenCalledWith('uncertain')
    expect(rig.deps.admit).toHaveBeenCalledTimes(2)
  })

  it('serializes admissions, rejects duplicate active owners, and requires the final send fence', async () => {
    const rig = remoteDeviceRig()
    const wait = Promise.withResolvers<undefined>()
    const first = rig.pool.run(routeRequest(), async (route) => {
      route.beforeSend()
      await wait.promise
      return route.device
    })
    await expect(rig.run()).rejects.toThrow()
    wait.resolve(undefined)
    await first
    await expect(
      rig.pool.run(routeRequest(), () => Promise.resolve('forgot the fence')),
    ).rejects.toThrow()
    expect(rig.claims[1]?.finish).toHaveBeenCalledWith('notSent')
    expect(await rig.run()).toBe('device-0')
  })

  it('holds admission ownership before awaiting consent and installs reservations before another worker', async () => {
    const rig = remoteDeviceRig()
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const original = rig.deps.admit
    let isWaiting = false
    let count = 0
    rig.deps.admit = vi.fn(async (device: string, request: AccountRouteRequest) => {
      if (isWaiting) throw new Error('overlapping admission')
      count += 1
      if (count === 1) {
        isWaiting = true
        entered.resolve(undefined)
        await resume.promise
        rig.state.remote.offers[1]!.headroom.anthropic = 'none'
        isWaiting = false
      }
      return await original(device, request)
    })
    const first = rig.pool.run(routeRequest({ owner: 'first', kind: 'worker' }), async (route) => {
      rig.state.remote.offers[1]!.headroom.anthropic = 'some'
      route.beforeSend()
      await Promise.resolve()
      return route.device
    })
    await entered.promise
    const second = rig.run({ owner: 'second', kind: 'worker' })
    // Yield one event-loop turn to drain ready promises, with no wall-clock sleep.
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(rig.deps.admit).toHaveBeenCalledTimes(1)
    resume.resolve(undefined)
    expect(await Promise.all([first, second])).toEqual(['device-1', 'device-0'])
  })

  it('binds the source request, pooling trigger and parent budget through async admission', async () => {
    const rig = remoteDeviceRig()
    const request = routeRequest({ trigger: vendorLimit })
    const original = rig.deps.admit
    rig.deps.admit = vi.fn(async (device: string, bound: AccountRouteRequest) => {
      request.budgetOwner = 'changed'
      request.modelId = 'other-model'
      expect(Reflect.set(bound, 'budgetOwner', 'changed')).toBe(false)
      expect(Reflect.set(bound.trigger!, 'kind', 'userCap')).toBe(false)
      return await original(device, bound)
    })
    await rig.pool.run(request, (route) => {
      expect(route.request.modelId).toBe('fake-model')
      expect(Reflect.set(route.request.trigger!, 'kind', 'userCap')).toBe(false)
      route.beforeSend()
      return Promise.resolve(route.device)
    })
    expect(rig.deps.admit).toHaveBeenCalledWith(
      'device-1',
      expect.objectContaining({
        budgetOwner: 'parent',
        modelId: 'fake-model',
        trigger: vendorLimit,
      }),
    )
  })

  it('reads the Send to label in the installed language at use time', () => {
    try {
      setUiText({ ...EN, accounts: { ...EN.accounts, sendToDevice: 'An {device} senden' } }, 'de')
      expect(sendToDeviceLabel('Kubuntu')).toBe('An Kubuntu senden')
    } finally {
      setUiText(EN, 'en')
    }
  })
})
