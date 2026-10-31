// Heavy team checks under the machine governor (the M96c join). Everything
// here is real: the governor and launch host read this machine's live
// sampler under a limit the person set, the check slots run over a real git
// repository, and each check is a real node process. The test transport runs
// the process and treats a clean exit as the container's proof that nothing
// else is left running (the checks are leaf programs); one command names an
// exit without that proof.
import { execFile, type ExecFileException } from 'node:child_process'
import { appendFile, mkdtemp, readFile, rm, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runnerEnvironment } from '../../src/core/runners/runnerConfig'
import type { CheckJob } from '../../src/core/runners/routing'
import { ResourceDiskSampler } from '../../src/core/resources/disk'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { ResourceQueue } from '../../src/core/resources/queue'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import { CheckSlots, type CheckProcess } from '../../src/host/team/checkSlots'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { resolveGitBinary } from './helpers/realGit'
import { initRigFolders } from './helpers/teamRealRig'
import { fixtureGit } from './helpers/teamLandingFixture'
import { fixtureGitEnvironment } from './helpers/fixtureGit'

setUiText(EN, 'en')

const SAMPLE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }
/** The command that ends without the container's proof. */
const UNPROVED = 'process.exit(0) // unproved'
/** A check long enough that a second one is surely started while it runs when nothing holds it back. */
const CHECK_RUNS_MS = 700
/** How long "not started" is watched: well past a check's own start-up. */
const WATCH_MS = 1500

function exitCodeOf(error: ExecFileException | null): number {
  if (error === null) return 0
  return typeof error.code === 'number' ? error.code : 1
}

const run: CheckProcess = (request) =>
  new Promise((resolve) => {
    const isUnproved = request.args.some((argument) => argument.includes(UNPROVED))
    execFile(
      request.file,
      [...request.args],
      { cwd: request.cwd, env: request.env, timeout: request.timeoutMs },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        resolve({
          exitCode: exitCodeOf(error),
          output: stdout,
          descendantsEnded: !isUnproved,
          stderr,
        })
      },
    )
  })

interface Governed {
  readonly host: ResourceLaunchHost
  readonly governor: ResourceGovernor
  readonly dispose: () => void
}

/** A live governor held at throttle by a limit the person set; `host.resume()` lifts it. */
async function throttledHost(
  settings: ResourceSettings,
  errors: unknown[],
  samples: number,
): Promise<Governed> {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clock: ResourceClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  const events = new ResourceEvents((error) => {
    errors.push(error)
  })
  const disks = new ResourceDiskSampler(
    [{ role: 'workspace', path: path.resolve(process.cwd()) }],
    () => settings,
  )
  const governor = new ResourceGovernor({
    clock,
    events,
    settings,
    sampler: createMachineResourceSampler(() => settings, SAMPLE_LIMITS, disks),
    hasRelocationTarget: null,
    onError: (error) => {
      errors.push(error)
    },
  })
  const host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings: () => settings,
    bindTree: () => Promise.resolve(null),
    onError: (error) => {
      errors.push(error)
    },
  })
  for (let sample = 0; sample < samples; sample += 1) await governor.refresh()
  return {
    host,
    governor,
    dispose: () => {
      host.dispose()
      for (const timer of timers) clearTimeout(timer)
    },
  }
}

/** A check that logs when it starts and when it ends, with a pause between. */
function logged(log: string, name: string, pauseMs = CHECK_RUNS_MS): string {
  const file = JSON.stringify(log)
  const append = (word: string) =>
    `fs.appendFileSync(${file}, ${JSON.stringify(`${word} ${name}\n`)})`
  return `const fs = require('node:fs'); ${append('start')}; setTimeout(() => { ${append('end')} }, ${String(pauseMs)})`
}

async function lines(log: string): Promise<string[]> {
  const text = await readFile(log, 'utf8')
  return text.split('\n').filter((line) => line !== '')
}

/** Waits out the watch: how long a check that must not start is observed. */
function watch(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WATCH_MS)
  })
}

/** The clock of hosts that never arm a timer in the case that uses them. */
const cancelNothing = (): void => undefined
const idleClock: ResourceClock = { now: () => Date.now(), setTimeout: () => cancelNothing }

describe('heavy team checks under the machine governor', () => {
  let root: string
  let repo: string
  let git: string
  let copy: string
  let counter = 0

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'check-slots-governed-'))
    const folders = await initRigFolders(root)
    repo = folders.repo
    git = await resolveGitBinary()
    // A task's working copy: the checks run for a copy, never in the person's repository.
    copy = path.join(root, 'copy')
    await fixtureGit(root, ['clone', repo, copy])
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function slots(governor: Governed | undefined, folders: number): CheckSlots {
    counter += 1
    return new CheckSlots({
      file: git,
      run,
      env: fixtureGitEnvironment(runnerEnvironment(process.env)),
      root: path.join(root, `checks-${String(counter)}`),
      repositoryRoot: repo,
      platform: process.platform,
      count: folders,
      setupCommand: '0',
      cacheKey: 'governed',
      installPaths: [],
      shell: process.execPath,
      shellArgs: (command) => ['-e', command],
      isTrusted: () => true,
      isHostBusy: () => false,
      ...(governor !== undefined && { governor: governor.host.teamSlotPorts() }),
    })
  }

  function job(command: string, signal = new AbortController().signal): CheckJob {
    counter += 1
    return {
      runId: `run-${String(counter)}`,
      cwd: copy,
      command,
      timeoutMs: 60_000,
      commandClass: 'tests',
      labels: [],
      preferredRunners: [],
      lockfiles: [],
      signal,
      onOutput: () => undefined,
    }
  }

  // Real git clones and real processes wait on each other in these cases, so
  // each carries one named timeout well past the repository's 5 s.
  const LONG_MS = 60_000

  it(
    'a governor that holds the machine at throttle lets one check run at a time',
    async () => {
      const errors: unknown[] = []
      const governed = await throttledHost(
        resourceSettingsSchema.parse({ memoryMaxPercent: 0 }),
        errors,
        2,
      )
      try {
        expect(governed.governor.capacity('check')).toBe(1)
        const log = path.join(root, 'throttled.log')
        await appendFile(log, '')
        const checks = slots(governed, 2)
        const first = checks.run(job(logged(log, 'a')))
        const second = checks.run(job(logged(log, 'b')))
        await Promise.all([first, second])
        // Both finished, and the second began only once the first had ended.
        const order = await lines(log)
        expect(order.filter((line) => line.startsWith('start'))).toHaveLength(2)
        expect(order.filter((line) => line.startsWith('end'))).toHaveLength(2)
        expect(order.findLastIndex((line) => line.startsWith('start'))).toBeGreaterThan(
          order.findIndex((line) => line.startsWith('end')),
        )
        expect(errors).toEqual([])
      } finally {
        governed.dispose()
      }
    },
    LONG_MS,
  )

  it(
    'the same two checks overlap when no governor is lent',
    async () => {
      const log = path.join(root, 'ungoverned.log')
      await appendFile(log, '')
      const checks = slots(undefined, 2)
      await Promise.all([checks.run(job(logged(log, 'a'))), checks.run(job(logged(log, 'b')))])
      const order = await lines(log)
      const firstEnd = order.findIndex((line) => line.startsWith('end'))
      const secondStart = order.findLastIndex((line) => line.startsWith('start'))
      expect(secondStart).toBeLessThan(firstEnd)
    },
    LONG_MS,
  )

  it(
    'a disk hold from the person’s floor keeps a check waiting until it is lifted',
    async () => {
      const stats = await statfs(process.cwd(), { bigint: true })
      const freeGiB = Number(stats.bsize * stats.bavail) / RESOURCE_GIB_BYTES
      const errors: unknown[] = []
      const governed = await throttledHost(
        resourceSettingsSchema.parse({ diskMinFreeGiB: Math.ceil(freeGiB) + 10 }),
        errors,
        1,
      )
      try {
        expect(governed.governor.diskBlocked()).toBe(true)
        const log = path.join(root, 'held.log')
        await appendFile(log, '')
        const waiting = slots(governed, 1).run(job(logged(log, 'held', 10)))
        await watch()
        expect(await lines(log)).toEqual([])
        governed.host.resume()
        await waiting
        expect(await lines(log)).toContain('start held')
        expect(errors).toEqual([])
      } finally {
        governed.dispose()
      }
    },
    LONG_MS,
  )

  it(
    'a check stopped while it waits for the governor never starts',
    async () => {
      const stats = await statfs(process.cwd(), { bigint: true })
      const freeGiB = Number(stats.bsize * stats.bavail) / RESOURCE_GIB_BYTES
      const errors: unknown[] = []
      const governed = await throttledHost(
        resourceSettingsSchema.parse({ diskMinFreeGiB: Math.ceil(freeGiB) + 10 }),
        errors,
        1,
      )
      try {
        const log = path.join(root, 'stopped.log')
        await appendFile(log, '')
        const stop = new AbortController()
        const waiting = slots(governed, 1).run(job(logged(log, 'never', 10), stop.signal))
        await watch()
        stop.abort()
        await expect(waiting).rejects.toThrow()
        expect(await lines(log)).toEqual([])
      } finally {
        governed.dispose()
      }
    },
    LONG_MS,
  )

  it(
    'a check whose processes are not proved ended keeps its place',
    async () => {
      const errors: unknown[] = []
      const governed = await throttledHost(
        resourceSettingsSchema.parse({ memoryMaxPercent: 0 }),
        errors,
        2,
      )
      try {
        const checks = slots(governed, 2)
        await expect(checks.run(job(UNPROVED))).rejects.toThrow()
        // Its permit is still held, so the one `check` the throttle allows is taken.
        const log = path.join(root, 'unproved.log')
        await appendFile(log, '')
        const stop = new AbortController()
        const next = checks.run(job(logged(log, 'next', 10), stop.signal))
        await watch()
        expect(await lines(log)).toEqual([])
        stop.abort()
        await expect(next).rejects.toThrow()
      } finally {
        governed.dispose()
      }
    },
    LONG_MS,
  )

  it('a host that sends its admissions elsewhere, or is closed, lends no ports', async () => {
    const errors: unknown[] = []
    const governed = await throttledHost(resourceSettingsSchema.parse({}), errors, 1)
    expect(
      Object.keys(governed.host.teamSlotPorts()).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['governor', 'queue', 'running'])
    // The runtime's shape: this host's admissions go to another queue, so it owns none to join.
    const settings = resourceSettingsSchema.parse({})
    const events = new ResourceEvents(() => undefined)
    const elsewhere = new ResourceQueue({
      clock: idleClock,
      events,
      capacity: () => null,
      running: { backgroundCount: () => 0 },
    })
    const delegating = new ResourceLaunchHost({
      governor: governed.governor,
      events,
      clock: idleClock,
      settings: () => settings,
      bindTree: () => Promise.resolve(null),
      onError: () => undefined,
      admission: (request, signal) => Promise.resolve(elsewhere.request(request, signal)),
    })
    expect(() => delegating.teamSlotPorts()).toThrow('unavailable')
    delegating.dispose()
    elsewhere.dispose()
    governed.dispose()
    expect(() => governed.host.teamSlotPorts()).toThrow('disposed')
  })
})
