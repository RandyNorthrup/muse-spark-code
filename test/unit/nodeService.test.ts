import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { recordCalls, scripted } from './helpers/recordCalls'
import { NodeService, type NodeResources } from '../../src/runtime/node/service'
import { NodeStateStore } from '../../src/runtime/node/state'
import { NODE_ZERO_DIGEST } from '../../src/shared/constants'
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
  const reported = recordCalls<[unknown]>()
  const state = new NodeStateStore(root, reported.fn)
  const initial = nodeState()
  initial.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
  await state.initialize(initial)
  const clock = new FakeNodeClock()
  clock.shiftWall(1 - clock.now())
  const tools = new FakeNodeToolHost(new Set(['workspace']))
  const stop = scripted(() => Promise.resolve())
  const endSessions = scripted(() => Promise.resolve())
  const createResources = scripted((_signal: AbortSignal): Promise<NodeResources> =>
    Promise.resolve({ tools, stops: [{ stop }] }),
  )
  const ports = {
    clock,
    vaultCodec: new FixtureCodec(),
    createResources,
    endSessions,
    report: reported.fn,
  }
  const service = new NodeService(state, ports)
  await service.boot()
  return { service, state, tools, ports, stop, endSessions, createResources, reported }
}
async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      // A wedged-deadline lock can still be flushing its audit when the test
      // settles; retry the removal while that trailing write lands.
      const isBusy =
        error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY' && attempt < 5
      if (!isBusy) throw error
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })
    }
  }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await removeRoot(dir)
})

describe('M110-N shared service binding', () => {
  nodeNativeTest('H15 boots sealed and unattended and never dispatches a bypass run', async () => {
    const { service, createResources, reported } = await setup()
    expect(service.keys.isSealed).toBe(true)
    expect(service.attendance.sessions()).toEqual([])
    const work = scripted(() => Promise.resolve('done'))
    await expect(
      service.run('unsafe', { ...policy, mode: 'bypass' }, new AbortController().signal, work),
    ).rejects.toThrow()
    expect(work.calls).toHaveLength(0)
    expect(await service.run('safe', policy, new AbortController().signal, work)).toBe('done')
    expect(createResources.calls).toHaveLength(1)
    await service.shutdown()
    expect(reported.calls).toHaveLength(0)
  })
  nodeNativeTest(
    'H08 lock cancels every running attempt, seals keys and invalidates actual auth sessions',
    async () => {
      const { service, stop, endSessions, reported } = await setup()
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
      expect(stop.calls).toHaveLength(1)
      expect(endSessions.calls).toHaveLength(1)
      expect(service.attempts.blocked()).toEqual(['running'])
      expect(() => {
        service.attach(nodeSession())
      }).toThrow()
      expect(reported.calls).toHaveLength(0)
    },
  )
  nodeNativeTest(
    'H08 lock while resources are still opening disposes the late resources without starting work',
    async () => {
      const { service, ports, tools, stop, reported } = await setup()
      const started = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<NodeResources>()
      ports.createResources.use(() => {
        started.resolve(undefined)
        return release.promise
      })
      const work = scripted(() => Promise.resolve('done'))
      const running = expect(
        service.run('late', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      await started.promise
      const locked = service.lock()
      release.resolve({ tools, stops: [{ stop }] })
      await running
      await locked
      expect(work.calls).toHaveLength(0)
      expect(stop.calls).toHaveLength(1)
      expect(reported.calls).toHaveLength(0)
    },
  )
  nodeNativeTest(
    'H08 failed unlock stays locked; explicit unlock restores work with fresh resources',
    async () => {
      const { service, createResources, reported } = await setup()
      await service.keys.initialize('fixture passphrase')
      await service.run('first', policy, new AbortController().signal, () => Promise.resolve())
      await service.lock()
      await expect(service.unlock('wrong')).rejects.toThrow()
      expect(service.isLocked).toBe(true)
      await service.unlock('fixture passphrase')
      expect(service.isLocked).toBe(false)
      expect(service.keys.isSealed).toBe(false)
      await service.run('second', policy, new AbortController().signal, () => Promise.resolve())
      expect(createResources.calls).toHaveLength(2)
      await service.wipe()
      // A wrong passphrase reports through both nested queues; the edge dedupes.
      expect(reported.calls).toHaveLength(2)
    },
  )
  nodeNativeTest(
    'H08 cleanup failure refuses fresh work and unlock until a process restart',
    async () => {
      const { service, stop, reported } = await setup()
      await service.keys.initialize('fixture passphrase')
      await service.run('first', policy, new AbortController().signal, () => Promise.resolve())
      stop.use(() => Promise.reject(new Error('test cleanup failure')))
      await expect(service.stop()).rejects.toThrow()
      expect(service.isLocked).toBe(true)
      const work = scripted(() => Promise.resolve())
      await expect(
        service.run('second', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      await expect(service.unlock('fixture passphrase')).rejects.toThrow()
      expect(work.calls).toHaveLength(0)
      expect(reported.calls).toHaveLength(2)
    },
  )
  nodeNativeTest(
    'H08 authentication cleanup shares the kill deadline',
    async () => {
      const { service, endSessions, reported } = await setup()
      endSessions.use(
        () =>
          new Promise<never>(() => {
            /* Wedged auth adapter. */
          }),
      )
      const start = Date.now()
      await expect(service.lock()).rejects.toThrow()
      expect(Date.now() - start).toBeGreaterThanOrEqual(4900)
      expect(service.isLocked).toBe(true)
      // The journal observes the failure just after lock() rejects on the same deadline.
      await expect.poll(() => reported.calls.length, { timeout: 1000 }).toBe(1)
    },
    // The five-second stop deadline is the behavior under test.
    15_000,
  )
  nodeNativeTest(
    'H08 a wedged resource opener is aborted and lock fails within the kill deadline',
    async () => {
      const { service, ports, reported } = await setup()
      const started = Promise.withResolvers<AbortSignal>()
      ports.createResources.use((signal) => {
        started.resolve(signal)
        return new Promise<never>(() => {
          /* Wedged factory. */
        })
      })
      const work = scripted(() => Promise.resolve())
      void service.run('wedged', policy, new AbortController().signal, work)
      const opening = await started.promise
      const start = Date.now()
      const locked = expect(service.lock()).rejects.toThrow()
      expect(opening.aborted).toBe(true)
      await locked
      expect(Date.now() - start).toBeGreaterThanOrEqual(4900)
      expect(service.isLocked).toBe(true)
      expect(service.keys.isSealed).toBe(true)
      expect(work.calls).toHaveLength(0)
      // The deadline throws outside any queue, so nothing reports.
      expect(reported.calls).toHaveLength(0)
    },
    // The five-second stop deadline is the behavior under test.
    15_000,
  )
  nodeNativeTest('H08 a queued unlock cannot reverse a later lock', async () => {
    const { service, ports, tools, stop, reported } = await setup()
    await service.keys.initialize('fixture passphrase')
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<NodeResources>()
    ports.createResources.use(() => {
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
    expect(reported.calls).toHaveLength(0)
  })
  nodeNativeTest(
    'H15 a service cannot accept work before reconciliation or boot twice',
    async () => {
      const { state, ports, reported } = await setup()
      const service = new NodeService(state, ports)
      const work = scripted(() => Promise.resolve())
      await expect(
        service.run('before-boot', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      expect(work.calls).toHaveLength(0)
      await service.boot()
      await expect(service.boot()).rejects.toThrow()
      await service.shutdown()
      expect(reported.calls).toHaveLength(0)
    },
  )
})
