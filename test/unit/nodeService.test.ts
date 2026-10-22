import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, vi } from 'vitest'
import { NodeService, type NodeResources } from '../../src/runtime/node/service'
import { NodeStateStore } from '../../src/runtime/node/state'
import { NODE_ZERO_DIGEST, NODE_STOP_TIMEOUT_MS } from '../../src/shared/constants'
import { nodeState, nodeSession } from './helpers/node/records'
import { FakeNodeClock } from './helpers/node/clock'
import { FakeNodeToolHost } from './helpers/node/toolHost'
import { FixtureCodec } from './helpers/nodeVaultCodec'

const directories: string[] = []
const policy = {
  mode: 'acceptEdits',
  paid: false,
  budgetUsd: undefined,
  protectedPath: false,
  requiresAsking: false,
  makerAction: 'offline',
} as const
async function setup() {
  const root = await nodeTempRoot('m110-service-')
  directories.push(root)
  const state = new NodeStateStore(root)
  const initial = nodeState()
  initial.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
  await state.initialize(initial)
  const clock = new FakeNodeClock()
  clock.shiftWall(1 - clock.now())
  const tools = new FakeNodeToolHost(new Set(['workspace']))
  const stop = vi.fn(() => Promise.resolve())
  const endSessions = vi.fn(() => Promise.resolve())
  const createResources = vi.fn((_signal: AbortSignal): Promise<NodeResources> =>
    Promise.resolve({ tools, stops: [{ stop }] }),
  )
  const ports = { clock, vaultCodec: new FixtureCodec(), createResources, endSessions }
  const service = new NodeService(state, ports)
  await service.boot()
  return { service, state, tools, ports, stop, endSessions, createResources }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N shared service binding', () => {
  nodeNativeTest('H15 boots sealed and unattended and never dispatches a bypass run', async () => {
    const { service, createResources } = await setup()
    expect(service.keys.isSealed).toBe(true)
    expect(service.attendance.sessions()).toEqual([])
    const work = vi.fn(() => Promise.resolve('done'))
    await expect(
      service.run('unsafe', { ...policy, mode: 'bypass' }, new AbortController().signal, work),
    ).rejects.toThrow()
    expect(work).not.toHaveBeenCalled()
    expect(await service.run('safe', policy, new AbortController().signal, work)).toBe('done')
    expect(createResources).toHaveBeenCalledOnce()
    await service.shutdown()
  })
  nodeNativeTest(
    'H08 lock cancels every running attempt, seals keys and invalidates actual auth sessions',
    async () => {
      const { service, stop, endSessions } = await setup()
      await service.keys.initialize('fixture passphrase')
      await service.unlock('fixture passphrase')
      service.attach(nodeSession())
      const started = Promise.withResolvers<undefined>()
      const running = expect(
        service.run('running', policy, new AbortController().signal, async (_tools, signal) => {
          started.resolve(undefined)
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('test aborted'))
              },
              { once: true },
            )
          })
          return 'unreachable'
        }),
      ).rejects.toThrow()
      await started.promise
      const locked = service.lock()
      expect(service.keys.isSealed).toBe(true)
      expect(service.isLocked).toBe(true)
      expect(service.attendance.sessions()).toEqual([])
      await locked
      await running
      expect(stop).toHaveBeenCalledOnce()
      expect(endSessions).toHaveBeenCalledOnce()
      expect(service.attempts.blocked()).toEqual(['running'])
      expect(() => {
        service.attach(nodeSession())
      }).toThrow()
    },
  )
  nodeNativeTest(
    'H08 lock while resources are still opening disposes the late resources without starting work',
    async () => {
      const { service, ports, tools, stop } = await setup()
      const started = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<NodeResources>()
      ports.createResources.mockImplementation(() => {
        started.resolve(undefined)
        return release.promise
      })
      const work = vi.fn(() => Promise.resolve('done'))
      const running = expect(
        service.run('late', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      await started.promise
      const locked = service.lock()
      release.resolve({ tools, stops: [{ stop }] })
      await running
      await locked
      expect(work).not.toHaveBeenCalled()
      expect(stop).toHaveBeenCalledOnce()
    },
  )
  nodeNativeTest(
    'H08 failed unlock stays locked; explicit unlock restores work with fresh resources',
    async () => {
      const { service, createResources } = await setup()
      await service.keys.initialize('fixture passphrase')
      await service.run('first', policy, new AbortController().signal, () => Promise.resolve())
      await service.lock()
      await expect(service.unlock('wrong')).rejects.toThrow()
      expect(service.isLocked).toBe(true)
      await service.unlock('fixture passphrase')
      expect(service.isLocked).toBe(false)
      expect(service.keys.isSealed).toBe(false)
      await service.run('second', policy, new AbortController().signal, () => Promise.resolve())
      expect(createResources).toHaveBeenCalledTimes(2)
      await service.wipe()
    },
  )
  nodeNativeTest(
    'H08 cleanup failure refuses fresh work and unlock until a process restart',
    async () => {
      const { service, stop } = await setup()
      await service.keys.initialize('fixture passphrase')
      await service.run('first', policy, new AbortController().signal, () => Promise.resolve())
      stop.mockRejectedValue(new Error('test cleanup failure'))
      await expect(service.stop()).rejects.toThrow()
      expect(service.isLocked).toBe(true)
      const work = vi.fn(() => Promise.resolve())
      await expect(
        service.run('second', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      await expect(service.unlock('fixture passphrase')).rejects.toThrow()
      expect(work).not.toHaveBeenCalled()
    },
  )
  nodeNativeTest('H08 authentication cleanup shares the kill deadline', async () => {
    const { service, endSessions } = await setup()
    endSessions.mockImplementation(
      () =>
        new Promise(() => {
          /* Wedged auth adapter. */
        }),
    )
    vi.useFakeTimers()
    try {
      const locked = expect(service.lock()).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(NODE_STOP_TIMEOUT_MS)
      await locked
      expect(service.isLocked).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  nodeNativeTest(
    'H08 a wedged resource opener is aborted and lock fails within the kill deadline',
    async () => {
      const { service, ports } = await setup()
      const started = Promise.withResolvers<AbortSignal>()
      ports.createResources.mockImplementation((signal) => {
        started.resolve(signal)
        return new Promise(() => {
          /* Wedged factory. */
        })
      })
      const work = vi.fn(() => Promise.resolve())
      void service.run('wedged', policy, new AbortController().signal, work)
      const opening = await started.promise
      vi.useFakeTimers()
      try {
        const locked = expect(service.lock()).rejects.toThrow()
        expect(opening.aborted).toBe(true)
        await vi.advanceTimersByTimeAsync(NODE_STOP_TIMEOUT_MS)
        await locked
        expect(service.isLocked).toBe(true)
        expect(service.keys.isSealed).toBe(true)
        expect(work).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    },
  )
  nodeNativeTest('H08 a queued unlock cannot reverse a later lock', async () => {
    const { service, ports, tools, stop } = await setup()
    await service.keys.initialize('fixture passphrase')
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<NodeResources>()
    ports.createResources.mockImplementation(() => {
      started.resolve(undefined)
      return release.promise
    })
    const running = expect(
      service.run('opening', policy, new AbortController().signal, () => Promise.resolve()),
    ).rejects.toThrow()
    await started.promise
    const unlock = expect(service.unlock('fixture passphrase')).rejects.toThrow()
    const lock = service.lock()
    release.resolve({ tools, stops: [{ stop }] })
    await running
    await unlock
    await lock
    expect(service.isLocked).toBe(true)
    expect(service.keys.isSealed).toBe(true)
  })
  nodeNativeTest(
    'H15 a service cannot accept work before reconciliation or boot twice',
    async () => {
      const { state, ports } = await setup()
      const service = new NodeService(state, ports)
      const work = vi.fn(() => Promise.resolve())
      await expect(
        service.run('before-boot', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      expect(work).not.toHaveBeenCalled()
      await service.boot()
      await expect(service.boot()).rejects.toThrow()
      await service.shutdown()
    },
  )
})
