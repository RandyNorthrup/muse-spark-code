import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import * as disk from 'node:fs/promises'
import path from 'node:path'
import * as ts from 'typescript'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ScheduleFsPort, ScheduleLeaseGuard } from '../../src/core/schedules/journal'
import { scheduleStorageHash } from '../../src/core/schedules/store'
import {
  createNodeScheduleFs,
  createScheduleLeaseLock,
  canRunScheduleFsOperation,
  OwnedScheduleFence,
  releaseScheduleFence,
} from '../../src/runtime/schedules/nodeScheduleFs'
import * as nodeSchedules from '../../src/runtime/schedules/nodeScheduleFs'
import { SCHEDULE_LEASE_EXPIRES_MS } from '../../src/shared/constants'
import { createSchedulesReportReader } from '../../src/runtime/reporting/playbookSchedulesInputs'
import { localFailureOf } from '../../src/core/reporting/sources/local'
import { FIXTURE_WORKSPACE_KEY } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { accelerateLeaseHeartbeat } from './helpers/schedules/heartbeatAcceleration'
import { temporaryDir, removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (importOriginal) => {
  const { mockedDiskModule } = await import('./helpers/schedules/mockDiskWrites')
  return await mockedDiskModule(() => importOriginal<typeof disk>(), ['link', 'readFile', 'unlink'])
})
const actualDisk = await vi.importActual<typeof disk>('node:fs/promises')

const portFile = path.resolve('src/runtime/schedules/nodeScheduleFs.ts')
const source = await readFile(portFile, 'utf8')
const tree = ts.createSourceFile(portFile, source, ts.ScriptTarget.Latest, true)
const sites: { label: string; first: number; last: number; isReleaseOnly: boolean }[] = []
const rawAwaits: string[] = []
const primitiveNames = new Set([
  'open',
  'mkdir',
  'lstat',
  'link',
  'rename',
  'unlink',
  'rmdir',
  'readdir',
  'readFile',
  'lstatIdentity',
])
function isReleaseOnly(node: ts.Node, syntax: ts.SourceFile): boolean {
  let parent = node
  while (!ts.isSourceFile(parent)) {
    if (ts.isMethodDeclaration(parent) && parent.name.getText(syntax) === 'remove') return true
    parent = parent.parent
  }
  return false
}
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'scheduleFsOperation') {
    const label = node.arguments[0]
    if (label !== undefined && ts.isStringLiteral(label))
      sites.push({
        label: label.text,
        first: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        last: tree.getLineAndCharacterOfPosition(node.end).line + 1,
        isReleaseOnly: isReleaseOnly(node, tree),
      })
    else rawAwaits.push('Wrapper call has no enumerable operation label')
  }
  if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
    const call = node.expression.expression
    const isPort =
      ts.isPropertyAccessExpression(call) &&
      (call.expression.getText(tree) === 'fs' ||
        ['writeFile', 'sync', 'close'].includes(call.name.text))
    if (isPort || primitiveNames.has(call.getText(tree))) {
      let parent = node.parent
      let isWrapped = false
      for (;;) {
        if (
          ts.isCallExpression(parent) &&
          parent.expression.getText(tree) === 'scheduleFsOperation'
        ) {
          isWrapped = true
          break
        }
        if (ts.isSourceFile(parent)) break
        parent = parent.parent
      }
      if (!isWrapped) rawAwaits.push(node.getText(tree))
    }
  }
  ts.forEachChild(node, visit)
}
visit(tree)
const twinFile = path.resolve('test/unit/helpers/schedules/storage.ts')
const twinSource = await readFile(twinFile, 'utf8')
const twinTree = ts.createSourceFile(twinFile, twinSource, ts.ScriptTarget.Latest, true)
const twinSites: typeof sites = []
function visitTwin(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(twinTree) === 'scheduleFsOperation') {
    const label = node.arguments[0]
    if (label !== undefined && ts.isStringLiteral(label))
      twinSites.push({
        label: label.text,
        first: twinTree.getLineAndCharacterOfPosition(node.getStart(twinTree)).line + 1,
        last: twinTree.getLineAndCharacterOfPosition(node.end).line + 1,
        isReleaseOnly: isReleaseOnly(node, twinTree),
      })
  }
  ts.forEachChild(node, visitTwin)
}
visitTwin(twinTree)
function siteFor(stack: string): (typeof sites)[number] | undefined {
  for (const match of stack
    .replaceAll('\\', '/')
    .matchAll(/(nodeScheduleFs|storage)\.ts:(\d+):\d+/g)) {
    const line = Number(match[2])
    const site = (match[1] === 'storage' ? twinSites : sites).find(
      ({ first, last }) => line >= first && line <= last,
    )
    if (site !== undefined) return site
  }
  return undefined
}
const root = await temporaryDir('lease-lifecycle-')
afterAll(() => removeFolder(root))
const ports = [
  { name: 'disk', make: () => createNodeScheduleFs(path.join(root, crypto.randomUUID())) },
  { name: 'memory', make: () => new MemoryScheduleFs() },
]
const key = `${FIXTURE_WORKSPACE_KEY}/index`
const file = `leases/${scheduleStorageHash(key)}.json`
const header = `leaseFences/${scheduleStorageHash(key)}/0/0.json`
const owner = {
  pid: process.pid,
  start: 1,
  token: '11111111-1111-4111-8111-111111111111',
  heartbeat: Date.now(),
  heartbeatSequence: 0,
  fencingToken: 0,
}

async function seed(fs: ScheduleFsPort, state: 'fresh' | 'released' | 'held') {
  if (state === 'fresh') return
  await fs.publish(header, JSON.stringify({ ...owner, heartbeat: Date.now() }))
  if (state === 'released') await fs.publish(`${header}.released`, '')
}

async function expectReleasedForNextWriter(fs: ScheduleFsPort) {
  expect(await fs.read(`${header}.released`)).toBe('')
  expect(await fs.lock(key, () => Promise.resolve('next'), { deadlineMs: Date.now() + 100 })).toBe(
    'next',
  )
}

// Derive the lifecycle scenario rows from the wrapper calls. A new awaited
// step adds a row automatically; an unexercised branch fails its injection check.
const steps = sites.filter(({ label }) => label.startsWith('lease.'))
function stateFor(step: string): 'fresh' | 'released' | 'held' {
  if (step === 'lease.legacy') return 'fresh'
  return step === 'lease.poll' ? 'held' : 'released'
}

// Interpose only the central stop check, using the real async-local scope. The
// second invocation is the precise post-await barrier; no sleeps or relaxed
// deadlines are needed. Cleanup has a different scope and stays observable.
function stopAt(
  target: (typeof sites)[number],
  stop: 'abort' | 'deadline',
  controller: AbortController,
  deadlineMs: number,
) {
  const getStore = AsyncLocalStorage.prototype.getStore
  let scope: unknown
  let isInjected = false
  const later: string[] = []
  const now = Date.now
  let stoppedNow: number | undefined
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => stoppedNow ?? now())
  const spy = vi.spyOn(AsyncLocalStorage.prototype, 'getStore').mockImplementation(function (
    this: AsyncLocalStorage<unknown>,
  ) {
    const check: unknown = getStore.call(this)
    const stack = new Error('operation barrier').stack ?? ''
    // AsyncLocalStorage.run itself calls getStore to restore its scope. Never
    // replace that value: only the operation wrapper receives the interposition.
    const caller = stack.split('\n').find((frame) => frame.includes('nodeScheduleFs.ts'))
    if (!caller?.includes('scheduleFsOperation')) return check
    const site = siteFor(stack)
    const label = site?.label
    if (typeof check !== 'function' || label === undefined) return check
    // First observed lease step establishes the caller's acquisition scope.
    if (scope === undefined && label.startsWith('lease.')) scope = check
    if (check !== scope) return check
    const isStartedAfterStop = isInjected
    let calls = 0
    return () => {
      calls += 1
      if (calls === 2 && !isInjected && label === target.label && site?.first === target.first) {
        isInjected = true
        if (stop === 'abort') controller.abort()
        else stoppedNow = deadlineMs
      }
      Reflect.apply(check, undefined, [])
      if (calls === 1 && isStartedAfterStop) later.push(label)
    }
  })
  return {
    later,
    injected: () => isInjected,
    restore: () => {
      spy.mockRestore()
      clock.mockRestore()
    },
  }
}

async function primitiveScenario(fs: ScheduleFsPort, step: string) {
  if (step === 'disk.unlink') {
    vi.mocked(disk.unlink).mockRejectedValue(
      Object.assign(new Error('temporary cleanup debt'), { code: 'EPERM' }),
    )
    await fs.publish('data/debt.json', 'debt')
    vi.mocked(disk.unlink).mockImplementation(actualDisk.unlink)
  }
  if (step === 'disk.retryWait')
    vi.mocked(disk.readFile).mockRejectedValueOnce(
      Object.assign(new Error('transient read'), { code: 'EPERM' }),
    )
  else if (['disk.destinationIdentity', 'disk.temporaryIdentity', 'disk.confirm'].includes(step))
    vi.mocked(disk.link).mockImplementationOnce(async (...args) => {
      await actualDisk.link(...args)
      throw Object.assign(new Error('committed publication'), {
        code: step === 'disk.confirm' ? 'EPERM' : 'EEXIST',
      })
    })
}

function fastHeartbeat() {
  return accelerateLeaseHeartbeat(1)
}

describe.each(ports)('$name structural lease lifecycle', ({ name, make }) => {
  // Folder fsync rows follow the same predicate production gates on, so the
  // matrix runs exactly the rows that can occur on this platform: Windows runs
  // the rows that exist there, and no row is silently lost elsewhere.
  const primitiveSteps = (name === 'disk' ? sites : twinSites).filter(
    ({ label, isReleaseOnly }) =>
      label.startsWith(name === 'disk' ? 'disk.' : 'memory.') &&
      !isReleaseOnly &&
      (name !== 'disk' || canRunScheduleFsOperation(label)),
  )
  // rmdir/remove are release-only operations; the raw-await guard still covers them.
  const allSteps = [...steps, ...primitiveSteps]
  it.each(
    allSteps.flatMap((site) =>
      ['abort', 'deadline'].map((stop) => ({ step: site.label, site, stop })),
    ),
  )(
    'stops $stop behind $step and releases for an ordinary writer',
    async ({ step, site, stop }) => {
      if (stop !== 'abort' && stop !== 'deadline') throw new Error('unknown stop')
      // Heartbeats run after acquisition; only abort remains binding then.
      let expected = 'AbortError'
      if (stop === 'deadline')
        expected = ['lease.heartbeat', 'lease.work'].includes(step) ? 'done' : 'scheduleLeaseBusy'
      const fs = make()
      await seed(fs, stateFor(step))
      await primitiveScenario(fs, step)
      const controller = new AbortController()
      const deadlineMs = Date.now() + 60_000
      const monitor = stopAt(site, stop, controller, deadlineMs)
      const timer = fastHeartbeat()
      try {
        let result: string
        try {
          result = await fs.lock(
            key,
            async () => {
              if (step === 'lease.heartbeat')
                await new Promise((resolve) => setTimeout(resolve, 20))
              return 'done'
            },
            { signal: controller.signal, deadlineMs },
          )
        } catch (error: unknown) {
          if (error instanceof Error)
            result = error.name === 'AbortError' ? error.name : error.message
          else result = 'unknown'
        }
        expect(monitor.injected(), `operation ${step} was gated`).toBe(true)
        expect(result).toBe(expected)
        if (expected !== 'done') expect(monitor.later).toEqual([])
      } finally {
        monitor.restore()
        timer.mockRestore()
        vi.mocked(disk.link).mockImplementation(actualDisk.link)
        vi.mocked(disk.readFile).mockImplementation(actualDisk.readFile)
        vi.mocked(disk.unlink).mockImplementation(actualDisk.unlink)
      }
      // A pre-publication stop has no artifact to release. Once ours can exist,
      // every owned fence must have its immutable marker, including late linking.
      const segments = await fs.names(`leaseFences/${scheduleStorageHash(key)}`)
      for (const segment of segments) {
        const names = await fs.names(`leaseFences/${scheduleStorageHash(key)}/${segment}`)
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const candidate = `leaseFences/${scheduleStorageHash(key)}/${segment}/${name}`
          if (candidate === header && stateFor(step) === 'held') {
            await fs.publish(`${candidate}.released`, '') // release the seeded external holder
          } else expect(await fs.read(`${candidate}.released`)).toBe('')
        }
      }
      expect(
        await fs.lock(key, () => Promise.resolve('next'), { deadlineMs: Date.now() + 100 }),
      ).toBe('next')
    },
  )

  it.each(['token', 'pid', 'start', 'fencingToken'])(
    'rejects an immutable heartbeat %s contradiction on one lock call',
    async (field) => {
      const fs = make()
      await seed(fs, 'released')
      const value: unknown = Reflect.get(owner, field)
      const bad = {
        ...owner,
        [field]: typeof value === 'number' ? value + 1 : '22222222-2222-4222-8222-222222222222',
      }
      await fs.publish(`${file}.${owner.token}.heartbeat`, JSON.stringify(bad))
      const lock = vi.spyOn(fs, 'lock')
      const factory = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
      try {
        let failure: string | undefined
        try {
          await createSchedulesReportReader({
            storeRoot: 'matrix',
            workspaceKey: FIXTURE_WORKSPACE_KEY,
          }).read({
            asOf: REPORT_FIXTURE_AS_OF,
            workspaceKey: FIXTURE_WORKSPACE_KEY,
            options: reportOptions('schedules'),
            signal: new AbortController().signal,
          })
        } catch (error: unknown) {
          failure = localFailureOf(error)
        }
        expect(failure).toBe('invalid')
        expect(lock).toHaveBeenCalledTimes(1)
      } finally {
        factory.mockRestore()
      }
    },
  )

  it('drains a paused heartbeat before completion can decide success', async () => {
    const fs = make()
    const controller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const resumed = Promise.withResolvers<undefined>()
    const throughReplace = fs.replace.bind(fs)
    const throughNames = fs.names.bind(fs)
    let isWorkReturning = false
    let completionReads = 0
    const replace = vi.spyOn(fs, 'replace').mockImplementation(async (file, content, guard) => {
      if (file.endsWith('.heartbeat')) {
        entered.resolve(undefined)
        await resumed.promise
      }
      await throughReplace(file, content, guard)
    })
    const names = vi.spyOn(fs, 'names').mockImplementation(async (folder) => {
      if (isWorkReturning) completionReads += 1
      return await throughNames(folder)
    })
    const timer = fastHeartbeat()
    const pending = fs.lock(
      key,
      async () => {
        await entered.promise
        isWorkReturning = true
        return 'completed'
      },
      { signal: controller.signal },
    )
    try {
      await entered.promise
      // Flush the work's completion microtasks while its pulse remains held.
      await delay(0)
      expect(completionReads).toBe(0)
    } finally {
      const rejected = expect(pending).rejects.toThrow('aborted')
      controller.abort()
      resumed.resolve(undefined)
      await rejected
      timer.mockRestore()
      replace.mockRestore()
      names.mockRestore()
    }
    await expectReleasedForNextWriter(fs)
  })

  it('rejects held work that aborts itself without calling its guard and releases', async () => {
    const fs = make()
    const controller = new AbortController()
    await expect(
      fs.lock(
        key,
        () => {
          controller.abort()
          return Promise.resolve('completed')
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('aborted')
    await expectReleasedForNextWriter(fs)
  })
})

describe.each([
  {
    name: 'disk',
    make: () => {
      const directory = path.join(root, `collision-${crypto.randomUUID()}`)
      const fsA = createNodeScheduleFs(directory)
      const fsB = createNodeScheduleFs(directory)
      const fsC = createNodeScheduleFs(directory)
      return { fsA, fsB, fsC }
    },
  },
  {
    name: 'memory',
    make: () => {
      const shared = new MemoryScheduleFs()
      const fsA = new MemoryScheduleFs(shared)
      const fsB = new MemoryScheduleFs(shared)
      const fsC = new MemoryScheduleFs(shared)
      return { fsA, fsB, fsC }
    },
  },
])('cancelled loser releases nothing ($name)', ({ make }) => {
  it('never releases the live winner fence', async () => {
    const { fsA, fsB, fsC } = make()
    const lockA = createScheduleLeaseLock(fsA)
    const lockB = createScheduleLeaseLock(fsB)
    const lockC = createScheduleLeaseLock(fsC)
    const collisionKey = 'schedule-collision/loser-cancelled'
    const candidate = `leaseFences/${scheduleStorageHash(collisionKey)}/0/0.json`
    const controlA = new AbortController()
    const releaseB = Promise.withResolvers<undefined>()
    const enteredB = Promise.withResolvers<undefined>()
    let guardB: ScheduleLeaseGuard | undefined
    let heldB: Promise<string> | undefined
    const throughPublish = fsA.publish.bind(fsA)
    const publish = vi
      .spyOn(fsA, 'publish')
      .mockImplementationOnce(async (file, content, guard) => {
        // A prepared candidate 0 first: B publishes the same slot and holds it.
        heldB = lockB(collisionKey, async (held) => {
          guardB = held
          enteredB.resolve(undefined)
          await releaseB.promise
          return 'b'
        })
        await enteredB.promise
        // A's exclusive publication loses (EEXIST with a foreign identity on
        // the disk port, a plain loss in memory), then cancellation lands
        // before the wrapper settlement can clear the attempt.
        const isPublished = await throughPublish(file, content, guard)
        expect(file).toBe(candidate)
        expect(isPublished).toBe(false)
        controlA.abort()
        return isPublished
      })
    try {
      await expect(
        lockA(collisionKey, () => Promise.resolve('a'), { signal: controlA.signal }),
      ).rejects.toThrow('aborted')
    } finally {
      publish.mockRestore()
    }
    // The lost publication owns nothing: no release marker, the winner still
    // holds, and a third writer cannot enter behind it.
    expect(await fsA.read(`${candidate}.released`)).toBeUndefined()
    if (guardB === undefined) throw new Error('winner never entered its critical section')
    await guardB()
    await expect(
      lockC(collisionKey, () => Promise.resolve('c'), { deadlineMs: Date.now() + 50 }),
    ).rejects.toThrow('scheduleLeaseBusy')
    releaseB.resolve(undefined)
    if (heldB === undefined) throw new Error('winner never held the fence')
    await heldB
    await expect(
      lockC(collisionKey, () => Promise.resolve('c'), { deadlineMs: Date.now() + 1000 }),
    ).resolves.toBe('c')
  })
})

describe.each([
  {
    name: 'disk',
    make: () => createNodeScheduleFs(path.join(root, `legacy-${crypto.randomUUID()}`)),
  },
  { name: 'memory', make: () => new MemoryScheduleFs() },
])('previous-version heartbeat ($name)', ({ make }) => {
  it.each(['fence', 'hint'] as const)(
    'acquires past an expired previous-version heartbeat under a %s header',
    async (headerKind) => {
      const fs = make()
      const legacyKey = `schedule-legacy/${headerKind}`
      const token = '33333333-3333-4333-8333-333333333333'
      const aged = Date.now() - SCHEDULE_LEASE_EXPIRES_MS - 1000
      // Byte capture of the base-commit port's pulse: 03d5d6607 wrote the
      // pulse as JSON.stringify(owner) with owner { pid, start, token,
      // heartbeat, heartbeatSequence } (no fencingToken). A missing pulse
      // token is legacy and compatible; a present contradicting token stays
      // invalid. The fence row (header fenced, pulse not) is the regression
      // row: without absence-fills-header it fails. The hint row (neither
      // fenced) passes either way and documents compatibility on each port.
      const header = {
        pid: process.pid,
        start: 7,
        token,
        heartbeat: aged,
        heartbeatSequence: 2,
      }
      if (headerKind === 'hint')
        await fs.publish(`leases/${scheduleStorageHash(legacyKey)}.json`, JSON.stringify(header))
      else
        await fs.publish(
          `leaseFences/${scheduleStorageHash(legacyKey)}/0/0.json`,
          JSON.stringify({ ...header, fencingToken: 0 }),
        )
      await fs.publish(
        `leases/${scheduleStorageHash(legacyKey)}.json.${token}.heartbeat`,
        JSON.stringify(header),
      )
      await expect(fs.lock(legacyKey, () => Promise.resolve('recovered'))).resolves.toBe(
        'recovered',
      )
    },
  )
})

it('refuses a forged, re-released or foreign fence handle with the ownership word', async () => {
  const fs = new MemoryScheduleFs()
  const candidateA = 'leaseFences/forge/0/0.json'
  const candidateB = 'leaseFences/forge/0/1.json'
  const ownedA = OwnedScheduleFence.issue(candidateA)
  // A structural copy of an issued handle was never issued: cloning drops
  // the module-private registration, so release refuses it.
  await expect(releaseScheduleFence(fs, structuredClone(ownedA), candidateA)).rejects.toThrow(
    'scheduleQueueOwnershipLost',
  )
  expect(await fs.read(`${candidateA}.released`)).toBeUndefined()
  // A handle issued for another candidate cannot release this one, and the
  // refusal does not consume it: it still releases its own candidate.
  const ownedB = OwnedScheduleFence.issue(candidateB)
  await expect(releaseScheduleFence(fs, ownedB, candidateA)).rejects.toThrow(
    'scheduleQueueOwnershipLost',
  )
  await releaseScheduleFence(fs, ownedB, candidateB)
  expect(await fs.read(`${candidateB}.released`)).toBe('')
  // A released handle is single-use: the second release is refused.
  await releaseScheduleFence(fs, ownedA, candidateA)
  expect(await fs.read(`${candidateA}.released`)).toBe('')
  await expect(releaseScheduleFence(fs, ownedA, candidateA)).rejects.toThrow(
    'scheduleQueueOwnershipLost',
  )
})

describe.each([
  {
    name: 'disk',
    make: () => createNodeScheduleFs(path.join(root, `successor-${crypto.randomUUID()}`)),
  },
  { name: 'memory', make: () => new MemoryScheduleFs() },
])('loser cleanup beside a live successor ($name)', ({ make }) => {
  it('retires the hint before publishing its own release', async () => {
    const fs = make()
    const key = 'schedule-successor/hint-order'
    const file = `leases/${scheduleStorageHash(key)}.json`
    const candidate = `leaseFences/${scheduleStorageHash(key)}/0/0.json`
    const operations: string[] = []
    const throughPublish = fs.publish.bind(fs)
    const publish = vi.spyOn(fs, 'publish').mockImplementation(async (relative, content, guard) => {
      operations.push(`publish:${relative}`)
      return await throughPublish(relative, content, guard)
    })
    const throughRemove = fs.remove.bind(fs)
    const remove = vi.spyOn(fs, 'remove').mockImplementation(async (relative) => {
      operations.push(`remove:${relative}`)
      await throughRemove(relative)
    })
    try {
      await expect(fs.lock(key, () => Promise.resolve('done'))).resolves.toBe('done')
    } finally {
      publish.mockRestore()
      remove.mockRestore()
    }
    // The hint is retired while no successor can exist, before the release
    // marker lets one in. The old order published the release first and
    // removed the hint after a re-read, leaving the gap this row closes.
    const hintRetired = operations.indexOf(`remove:${file}`)
    const released = operations.indexOf(`publish:${candidate}.released`)
    expect(hintRetired).toBeGreaterThanOrEqual(0)
    expect(released).toBeGreaterThanOrEqual(0)
    expect(hintRetired).toBeLessThan(released)
  })
  it('keeps its own hint when the work never completed', async () => {
    const fs = make()
    const key = 'schedule-successor/abort-keeps-hint'
    const file = `leases/${scheduleStorageHash(key)}.json`
    const candidate = `leaseFences/${scheduleStorageHash(key)}/0/0.json`
    const control = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const held = fs.lock(
      key,
      async () => {
        entered.resolve(undefined)
        await new Promise<undefined>((_resolve, reject) => {
          control.signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      },
      { signal: control.signal },
    )
    await entered.promise
    control.abort()
    await expect(held).rejects.toThrow()
    // An aborted acquisition leaves its hint to expiry (a successor
    // overwrites it) rather than risk removing a hint that is no longer its
    // own; its own release marker is still published.
    expect(await fs.read(file)).toBeDefined()
    expect(await fs.read(`${candidate}.released`)).toBe('')
  })
  it('never removes the successor hint but still publishes its own release', async () => {
    const fs = make()
    const key = 'schedule-successor/hint-kept'
    const file = `leases/${scheduleStorageHash(key)}.json`
    const entered = Promise.withResolvers<undefined>()
    const releaseOld = Promise.withResolvers<undefined>()
    const held = fs.lock(key, async () => {
      entered.resolve(undefined)
      await releaseOld.promise
    })
    await entered.promise
    // A successor takes over while the old holder is parked: its fence and
    // its hint carry a foreign token.
    const successorToken = '44444444-4444-4444-8444-444444444444'
    const successor = {
      pid: process.pid,
      start: 1,
      token: successorToken,
      heartbeat: Date.now(),
      heartbeatSequence: 0,
      fencingToken: 1,
    }
    await fs.publish(`leaseFences/${scheduleStorageHash(key)}/0/1.json`, JSON.stringify(successor))
    await fs.replace(file, JSON.stringify(successor))
    releaseOld.resolve(undefined)
    await expect(held).rejects.toThrow('scheduleQueueOwnershipLost')
    // The loser's release marker is published for its own fence, and the
    // successor's hint bytes are untouched.
    expect(await fs.read(`leaseFences/${scheduleStorageHash(key)}/0/0.json.released`)).toBe('')
    expect(JSON.parse((await fs.read(file)) ?? 'null')).toMatchObject({ token: successorToken })
  })
})

it('allows no raw awaited filesystem call outside the structural wrapper', () => {
  expect(rawAwaits).toEqual([])
  expect(steps.map(({ label }) => label)).toContain('lease.fence')
})

it('removes the last expired memory tail after its predecessor settles without a repair read', async () => {
  const fs = new MemoryScheduleFs()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const held = fs.lock(key, () => {
    entered.resolve(undefined)
    return release.promise
  })
  await entered.promise
  try {
    await expect(
      fs.lock(key, () => Promise.resolve(), { deadlineMs: Date.now() + 10 }),
    ).rejects.toThrow('scheduleLeaseBusy')
  } finally {
    release.resolve(undefined)
    await held
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fs.tails.size).toBe(0)
})

it('certification identifies the actual filesystem-port bytes', async () => {
  const record = await readFile('docs/certification/m113-playbook-schedules-c-m113-4.md', 'utf8')
  const recorded = /<!-- CM1134AR8 port SHA-256: ([a-f0-9]{64}) -->/.exec(record)?.[1]
  const actual = createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex')
  expect(recorded).toBe(actual)
})
