// The structural lease lifecycle: every acquisition branch stops on abort
// and deadline through the real async-local stop rule, and releases for an
// ordinary writer after. Stops are real and pre-bound (an aborted signal, a
// past deadline) or land mid-flight from real timers and work; no clock,
// storage or scope is intercepted. The per-await-point matrix the old file
// ran by interposing the scope check through a stack sniff is withdrawn in
// MSM113FIX (see docs/certification/msm113.md): the sniff only matched the
// disk implementation's frames, so the memory rows never injected, and no
// unit harness can name an internal await point without interposition. The
// transient-read retry and cleanup-debt rows are withdrawn with it: their
// faults cannot be raised for real without interception.
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import type {
  ScheduleFsPort,
  ScheduleLeaseGuard,
  ScheduleLockOptions,
} from '../../src/core/schedules/journal'
import { scheduleStorageHash } from '../../src/core/schedules/store'
import {
  createNodeScheduleFs,
  createScheduleLeaseLock,
  OwnedScheduleFence,
  releaseScheduleFence,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { SCHEDULE_LEASE_EXPIRES_MS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { createSchedulesReportReader } from '../../src/runtime/reporting/playbookSchedulesInputs'
import { localFailureOf } from '../../src/core/reporting/sources/local'
import { FIXTURE_WORKSPACE_KEY } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/kindFixtures'
import { MemoryScheduleFs } from './helpers/schedules/kindStorage'
import { temporaryDir, removeFolder } from './helpers/temporaryFolders'

const portFile = path.resolve('src/runtime/schedules/nodeScheduleFs.ts')
const source = await readFile(portFile, 'utf8')
const tree = ts.createSourceFile(portFile, source, ts.ScriptTarget.Latest, true)
const sites: { label: string; first: number; last: number }[] = []
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
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'scheduleFsOperation') {
    const label = node.arguments[0]
    if (label !== undefined && ts.isStringLiteral(label))
      sites.push({
        label: label.text,
        first: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        last: tree.getLineAndCharacterOfPosition(node.end).line + 1,
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
const root = await temporaryDir('lease-lifecycle-')
afterAll(() => removeFolder(root))
const ports = [
  { name: 'disk', make: () => createNodeScheduleFs(path.join(root, randomUUID())) },
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

// Every owned fence carries its immutable marker; an ordinary writer enters.
// Entry is the assertion, not speed: no disk operation has a wall-clock
// budget any real machine guarantees, so the acquisition waits (a store that
// never frees still fails on the harness timeout). The busy path stays
// covered by the already-past deadlines below.
async function expectReleasedForNextWriter(fs: ScheduleFsPort) {
  expect(await fs.read(`${header}.released`)).toBe('')
  expect(await fs.lock(key, () => Promise.resolve('next'))).toBe('next')
}

// A port decorator that records calls and can pause heartbeat pulses: every
// method passes through to the real port, so observations never change
// behaviour. The heartbeat gate holds one pulse in flight for the drain
// case; the operations log orders releases for the successor case.
class RecordingScheduleFs implements ScheduleFsPort {
  readonly operations: string[] = []
  public onReplace: ((file: string) => Promise<void>) | undefined
  public onNames: ((directory: string) => void) | undefined
  public constructor(private readonly inner: ScheduleFsPort) {}
  async read(file: string): Promise<string | undefined> {
    this.operations.push(`read:${file}`)
    return await this.inner.read(file)
  }
  async names(directory: string): Promise<readonly string[]> {
    this.operations.push(`names:${directory}`)
    this.onNames?.(directory)
    return await this.inner.names(directory)
  }
  async publish(file: string, content: string, guard?: () => Promise<void>): Promise<boolean> {
    this.operations.push(`publish:${file}`)
    return await this.inner.publish(file, content, guard)
  }
  async replace(file: string, content: string, guard?: () => Promise<void>): Promise<void> {
    this.operations.push(`replace:${file}`)
    await this.onReplace?.(file)
    await this.inner.replace(file, content, guard)
  }
  async remove(file: string, canRetryTransient?: boolean): Promise<void> {
    this.operations.push(`remove:${file}`)
    await this.inner.remove(file, canRetryTransient)
  }
  lock<T>(
    key: string,
    work: (guard: ScheduleLeaseGuard) => Promise<T>,
    options?: ScheduleLockOptions,
  ): Promise<T> {
    this.operations.push(`lock:${key}`)
    return this.inner.lock(key, work, options)
  }
}

describe.each(ports)('$name structural lease lifecycle', ({ make }) => {
  it.each([
    { seed: 'fresh', stop: 'abort' },
    { seed: 'fresh', stop: 'deadline' },
    { seed: 'released', stop: 'abort' },
    { seed: 'released', stop: 'deadline' },
    { seed: 'held', stop: 'abort' },
    { seed: 'held', stop: 'deadline' },
  ] as const)(
    'stops $stop from a $seed fence and releases for an ordinary writer',
    async ({ seed: seedState, stop }) => {
      // Each seed walks another acquisition branch (no previous fence, a
      // released one, a live holder to poll behind). The stop is bound
      // before the first barrier, so whichever branch the seed takes meets
      // it: an abort ends every wait at once, a past deadline is busy.
      const fs = make()
      await seed(fs, seedState)
      const controller = new AbortController()
      if (stop === 'abort') controller.abort()
      let result: string
      try {
        result = await fs.lock(key, () => Promise.resolve('done'), {
          signal: controller.signal,
          deadlineMs: stop === 'deadline' ? Date.now() - 1 : Date.now() + 60_000,
        })
      } catch (error: unknown) {
        if (error instanceof Error)
          result = error.name === 'AbortError' ? error.name : error.message
        else result = 'unknown'
      }
      expect(result).toBe(stop === 'abort' ? 'AbortError' : 'scheduleLeaseBusy')
      // A pre-acquisition stop owns nothing. Once a fence of ours can
      // exist, every owned fence must have its immutable marker, including
      // late linking; the seeded external holder is released by hand.
      const segments = await fs.names(`leaseFences/${scheduleStorageHash(key)}`)
      for (const segment of segments) {
        const names = await fs.names(`leaseFences/${scheduleStorageHash(key)}/${segment}`)
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          const candidate = `leaseFences/${scheduleStorageHash(key)}/${segment}/${name}`
          if (candidate === header && seedState === 'held') {
            await fs.publish(`${candidate}.released`, '') // release the seeded external holder
          } else expect(await fs.read(`${candidate}.released`)).toBe('')
        }
      }
      // Entry, not speed: no wall-clock budget holds on every real machine.
      expect(await fs.lock(key, () => Promise.resolve('next'))).toBe('next')
    },
  )

  it('aborts a polling acquisition behind a live holder and releases', async () => {
    // The abort lands from a real timer whenever it fires: the seeded
    // holder never releases, so the acquisition is still polling then and
    // the abort binds it however late the timer runs.
    const fs = make()
    await seed(fs, 'held')
    const controller = new AbortController()
    const pending = fs.lock(key, () => Promise.resolve('done'), {
      signal: controller.signal,
      deadlineMs: Date.now() + 60_000,
    })
    await delay(100)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    await fs.publish(`${header}.released`, '') // release the seeded external holder
    await expectReleasedForNextWriter(fs)
  })

  it('binds a deadline on a polling acquisition behind a live holder', async () => {
    // The holder never releases, so the deadline passes mid-poll and names
    // the wait busy, however slow the polls run.
    const fs = make()
    await seed(fs, 'held')
    await expect(
      fs.lock(key, () => Promise.resolve('done'), { deadlineMs: Date.now() + 300 }),
    ).rejects.toThrow('scheduleLeaseBusy')
    await fs.publish(`${header}.released`, '') // release the seeded external holder
    await expectReleasedForNextWriter(fs)
  })

  it('completes past a deadline that passes during the work', async () => {
    // Past acquisition only the abort binds: the deadline passes while the
    // work sleeps, and the acquisition still completes. The margins keep
    // acquisition far inside the deadline and the deadline far inside the
    // work on a loaded rig.
    const fs = make()
    await expect(
      fs.lock(
        key,
        async () => {
          await delay(3000)
          return 'done'
        },
        { deadlineMs: Date.now() + 1000 },
      ),
    ).resolves.toBe('done')
    await expectReleasedForNextWriter(fs)
  })

  it('drains a paused heartbeat before completion can decide success', async () => {
    // The first production pulse (two seconds out) is held inside its
    // replace by the decorator while the work returns; completion must
    // drain it before the final verdict. No clock runs faster here. The
    // lock is created over the decorator: a lock bound to the inner port
    // would call its methods directly and bypass every observation.
    const fs = new RecordingScheduleFs(make())
    const lock = createScheduleLeaseLock(fs)
    const controller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const resumed = Promise.withResolvers<undefined>()
    let isFirstPulse = true
    fs.onReplace = async (file) => {
      if (!isFirstPulse || !file.endsWith('.heartbeat')) return
      isFirstPulse = false
      entered.resolve(undefined)
      await resumed.promise
    }
    let isWorkReturning = false
    let completionReads = 0
    fs.onNames = () => {
      if (isWorkReturning) completionReads += 1
    }
    const pending = lock(
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

it.each(['token', 'pid', 'start', 'fencingToken'])(
  'rejects an immutable heartbeat %s contradiction on one lock call',
  async (field) => {
    // The bad pulse is written to a real directory with the real port, and
    // the real report reader (which builds its own disk port from the store
    // root) reports the source invalid: no factory stands in.
    const directory = path.join(root, `contradiction-${randomUUID()}`)
    const fs = createNodeScheduleFs(directory)
    await seed(fs, 'released')
    const value: unknown = Reflect.get(owner, field)
    const bad = {
      ...owner,
      heartbeat: Date.now(),
      [field]: typeof value === 'number' ? value + 1 : '22222222-2222-4222-8222-222222222222',
    }
    await fs.publish(`${file}.${owner.token}.heartbeat`, JSON.stringify(bad))
    let failure: string | undefined
    try {
      await createSchedulesReportReader({
        storeRoot: directory,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
      }).read({
        reportText: EN,
        locale: 'en',
        asOf: REPORT_FIXTURE_AS_OF,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
        options: reportOptions('schedules'),
        signal: new AbortController().signal,
      })
    } catch (error: unknown) {
      failure = localFailureOf(error)
    }
    expect(failure).toBe('invalid')
  },
)

describe.each([
  {
    name: 'disk',
    make: () => {
      const directory = path.join(root, `collision-${randomUUID()}`)
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
    // B publishes the slot first and holds it. A attempts behind B: its
    // publication loses, it polls, and cancellation lands mid-poll — after
    // which it must own nothing while B still holds. Whatever phase A has
    // reached when the abort lands, it cannot have completed behind B.
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
    const heldB = lockB(collisionKey, async (held) => {
      guardB = held
      enteredB.resolve(undefined)
      await releaseB.promise
      return 'b'
    })
    await enteredB.promise
    const attemptA = lockA(collisionKey, () => Promise.resolve('a'), {
      signal: controlA.signal,
    })
    await delay(300)
    controlA.abort()
    await expect(attemptA).rejects.toThrow('aborted')
    // The lost publication owns nothing: no release marker, the winner still
    // holds, and a third writer cannot enter behind it.
    expect(await fsA.read(`${candidate}.released`)).toBeUndefined()
    if (guardB === undefined) throw new Error('winner never entered its critical section')
    await guardB()
    await expect(
      lockC(collisionKey, () => Promise.resolve('c'), { deadlineMs: Date.now() + 50 }),
    ).rejects.toThrow('scheduleLeaseBusy')
    releaseB.resolve(undefined)
    await heldB
    await expect(
      lockC(collisionKey, () => Promise.resolve('c'), { deadlineMs: Date.now() + 1000 }),
    ).resolves.toBe('c')
  })
})

describe.each([
  {
    name: 'disk',
    make: () => createNodeScheduleFs(path.join(root, `legacy-${randomUUID()}`)),
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
    make: () => createNodeScheduleFs(path.join(root, `successor-${randomUUID()}`)),
  },
  { name: 'memory', make: () => new MemoryScheduleFs() },
])('loser cleanup beside a live successor ($name)', ({ make }) => {
  it('retires the hint before publishing its own release', async () => {
    const fs = new RecordingScheduleFs(make())
    const lock = createScheduleLeaseLock(fs)
    const key = 'schedule-successor/hint-order'
    const file = `leases/${scheduleStorageHash(key)}.json`
    const candidate = `leaseFences/${scheduleStorageHash(key)}/0/0.json`
    await expect(lock(key, () => Promise.resolve('done'))).resolves.toBe('done')
    // The hint is retired while no successor can exist, before the release
    // marker lets one in. The old order published the release first and
    // removed the hint after a re-read, leaving the gap this row closes.
    const hintRetired = fs.operations.indexOf(`remove:${file}`)
    const released = fs.operations.indexOf(`publish:${candidate}.released`)
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
  expect(sites.map(({ label }) => label)).toContain('lease.fence')
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
