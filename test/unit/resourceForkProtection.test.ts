// The per-job fork guard (D100 G13, RLF-GOVFORK): past 512 alive processes
// or 16,384 births in 15 s the offending tree is stopped with words, and
// only it; ordinary bursts pass untouched. Real hosts, real tree readers
// and real floods: POSIX registry sampling on Linux and ps-capable macOS,
// the attested job on Windows.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureResources, loadResourceWindow } from '../../src/core/resources/admission'
import { ResourceEvents } from '../../src/core/resources/events'
import { isErrno } from '../../src/core/fs/errno'
import { ResourceGovernor } from '../../src/core/resources/governor'
import {
  isResourceCapRefused,
  isResourceForkStop,
  type ResourceProcessLaunch,
  type ResourceTreeBinding,
} from '../../src/core/resources/launch'
import { execResourceFile } from '../../src/core/resources/commands'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'
import { MacResourceTreeReader } from '../../src/core/resources/trees/mac'
import { MAC_PS } from '../../src/core/resources/trees/posixTable'
import type { Logger } from '../../src/host/logger'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { superviseRuntime } from '../../src/runtime/supervise/supervisor'
import {
  RESOURCE_TREE_PROCESS_CAP,
  RESOURCE_TREE_SPAWN_WINDOW_MS,
} from '../../src/shared/constants'
import type { ResourceClock } from '../../src/shared/resources'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'
import { manualClock } from './resourceHarness'
import { removeFolder } from './helpers/temporaryFolders'

const PROBE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }

/** Trees bind on Linux always, on macOS only where the sandbox allows ps. */
function canBindTrees(): boolean {
  if (process.platform === 'linux') return true
  if (process.platform !== 'darwin') return false
  try {
    const probe = spawnSync(MAC_PS, ['-p', String(process.pid)])
    return probe.status === 0
  } catch {
    return false
  }
}

function testLogger(): Logger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

// Each wait covers one real step of a 521-process flood (fill, stop, die), several seconds on macOS.
const WAIT_DEADLINE_MS = 20_000

async function waitFor(label: string, isReady: () => boolean): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (isReady()) return
    if (Date.now() - started > WAIT_DEADLINE_MS) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
}

function isLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    return !(isErrno(error) && error.code === 'ESRCH')
  }
  return true
}

function isGroupLive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
  } catch (error: unknown) {
    return !(isErrno(error) && error.code === 'ESRCH')
  }
  return true
}

/** Members of one process group, so a test samples only a complete flood. */
function groupSize(pgid: number): number {
  try {
    const output = execFileSync('/usr/bin/pgrep', ['-g', String(pgid)], { encoding: 'utf8' })
    return output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0).length
  } catch {
    return 0
  }
}

interface BoundHost {
  readonly host: ResourceLaunchHost
  readonly errors: unknown[]
  readonly clearTimers: () => void
}

function boundHost(options: {
  helperPath: string
  forkCaps?: { processCap: number; spawnCap: number; spawnWindowMs: number }
  onWorkChanged?: () => void
}): BoundHost {
  const errors: unknown[] = []
  const report = (error: unknown): void => {
    errors.push(error)
  }
  const manual = manualClock()
  const clock: ResourceClock = manual.clock
  const events = new ResourceEvents(report)
  const settings = resourceSettingsSchema.parse({})
  const governor = new ResourceGovernor({
    clock,
    sampler: createMachineResourceSampler(() => settings, PROBE_LIMITS),
    settings,
    events,
    hasRelocationTarget: null,
    onError: report,
  })
  const reader =
    process.platform === 'darwin'
      ? new MacResourceTreeReader({ helperPath: options.helperPath })
      : new LinuxResourceTreeReader()
  const bindTree = async (launch: ResourceProcessLaunch): Promise<ResourceTreeBinding | null> => {
    if (launch.pid === undefined) return null
    const root = await reader.identity(launch.pid)
    if (root === null) return null
    const group = launch.pid
    return {
      reader,
      root,
      scope: { type: 'group', pgid: group },
      gone: () => Promise.resolve(!isGroupLive(group)),
    }
  }
  const host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings: () => settings,
    bindTree,
    onError: report,
    ...(options.forkCaps !== undefined && { forkCaps: options.forkCaps }),
    ...(options.onWorkChanged !== undefined && { onWorkChanged: options.onWorkChanged }),
  })
  return { host, errors, clearTimers: manual.clear }
}

async function floodScript(folder: string): Promise<string> {
  const file = path.join(folder, 'flood.sh')
  await writeFile(
    file,
    '#!/bin/sh\n' +
      'count="$1"\n' +
      'i=1\n' +
      'while [ "$i" -le "$count" ]; do\n' +
      '  sleep 15 &\n' +
      '  i=$((i + 1))\n' +
      'done\n' +
      'echo ready\n' +
      'wait\n',
  )
  await chmod(file, 0o755)
  return file
}

async function burstScript(folder: string): Promise<string> {
  const file = path.join(folder, 'burst.sh')
  await writeFile(
    file,
    '#!/bin/sh\n' +
      'quick="$1"\n' +
      'alive="$2"\n' +
      'i=1\n' +
      'while [ "$i" -le "$quick" ]; do\n' +
      '  /usr/bin/true\n' +
      '  i=$((i + 1))\n' +
      'done\n' +
      'i=1\n' +
      'while [ "$i" -le "$alive" ]; do\n' +
      '  sleep 15 &\n' +
      '  i=$((i + 1))\n' +
      'done\n' +
      'echo ready\n' +
      'wait\n',
  )
  await chmod(file, 0o755)
  return file
}

function spawnGroup(file: string, args: readonly string[]): ChildProcess {
  const child = spawn('/bin/sh', [file, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  return child
}

async function awaitReady(child: ChildProcess): Promise<void> {
  const output = child.stdout
  if (output === null) throw new Error('flood has no stdout')
  let seen = ''
  await new Promise<void>((resolve, reject) => {
    output.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8')
      if (seen.includes('ready')) resolve()
    })
    output.on('error', reject)
    child.once('exit', () => {
      reject(new Error('flood exited before it was ready'))
    })
  })
}

async function endGroup(child: ChildProcess): Promise<void> {
  const group = child.pid
  if (group === undefined) return
  try {
    process.kill(-group, 'SIGKILL')
  } catch (error: unknown) {
    if (!(isErrno(error) && error.code === 'ESRCH')) throw error
  }
  await waitFor('the test group to die', () => !isGroupLive(group))
}

// The flood test starts 521 real processes, waits for the sampler to stop the
// tree past the 512 bound and for the whole group to die; measured 7.7 s on a
// Mac mini (macOS starts about 300 processes a second), past the repository's
// 5 s default.
const FLOOD_FILL_TIMEOUT_MS = 30_000

describe.runIf(canBindTrees())('fork protection on bound trees', () => {
  let helperPath = ''
  let folder = ''

  beforeAll(async () => {
    // The macOS reader needs the signed helper CI builds; Linux needs none.
    if (process.platform !== 'darwin') return
    const helper = await darwinProcessHelper()
    helperPath = helper.helperPath
  }, 120_000)

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'gfp-'))
  })

  afterEach(async () => {
    await removeFolder(folder)
  })

  it(
    'stops a tree past 512 alive processes, and only that tree',
    async () => {
      const bound = boundHost({ helperPath })
      const flood = await bound.host.admit('check')
      const calmLease = await bound.host.admit('toolShell')
      let root: ChildProcess | undefined
      let calm: ChildProcess | undefined
      try {
        root = spawnGroup(await floodScript(folder), ['520'])
        flood.register({ pid: root.pid, group: true })
        calm = spawn('/bin/sleep', ['15'], { detached: true, stdio: 'ignore' })
        calmLease.register({ pid: calm.pid, group: true })
        await awaitReady(root)
        if (root.pid === undefined) throw new Error('flood has no pid')
        const floodGroup = root.pid
        // All 521 present before the first sample, so the kill cannot miss a
        // straggler that is still exec'ing.
        await waitFor('the flood to fill', () => groupSize(floodGroup) >= 521)
        await waitFor('the fork stop', () => {
          void bound.host.refreshTrees()
          return flood.stoppedForFork?.() !== undefined
        })
        expect(flood.stoppedForFork?.()).toBe('activeProcess')
        // The offending group is gone; the unrelated lease never noticed.
        await waitFor('the flood to die', () => root?.pid !== undefined && !isGroupLive(root.pid))
        expect(calm.pid !== undefined && isLive(calm.pid)).toBe(true)
        expect(calmLease.stoppedForFork?.()).toBeUndefined()
        expect(bound.host.tickets()).toHaveLength(2)
      } finally {
        if (root !== undefined) await endGroup(root)
        if (calm !== undefined) await endGroup(calm)
        flood.complete(true)
        calmLease.complete(true)
        expect(bound.errors).toEqual([])
        bound.clearTimers()
        bound.host.dispose()
      }
    },
    FLOOD_FILL_TIMEOUT_MS,
  )

  it('passes an ordinary burst: 200 quick spawns and 100 alive', async () => {
    const bound = boundHost({ helperPath })
    const burst = await bound.host.admit('check')
    let root: ChildProcess | undefined
    try {
      root = spawnGroup(await burstScript(folder), ['200', '100'])
      burst.register({ pid: root.pid, group: true })
      await awaitReady(root)
      await bound.host.refreshTrees()
      await bound.host.refreshTrees()
      expect(burst.stoppedForFork?.()).toBeUndefined()
      expect(root.pid !== undefined && isLive(root.pid)).toBe(true)
      // The sampler did see the tree: the mechanism ran, it just stayed calm.
      expect(bound.host.treeUsage()).toHaveLength(1)
    } finally {
      if (root !== undefined) await endGroup(root)
      burst.complete(true)
      expect(bound.errors).toEqual([])
      bound.clearTimers()
      bound.host.dispose()
    }
  })

  it('stops a spawn flood past the rate bound alone', async () => {
    // Only the rate narrows here, so the rate comparison fires in isolation
    // (at production values the count always trips first on sampled trees).
    const bound = boundHost({
      helperPath,
      forkCaps: {
        processCap: RESOURCE_TREE_PROCESS_CAP,
        spawnCap: 60,
        spawnWindowMs: RESOURCE_TREE_SPAWN_WINDOW_MS,
      },
    })
    const flood = await bound.host.admit('check')
    let root: ChildProcess | undefined
    try {
      root = spawnGroup(await floodScript(folder), ['100'])
      flood.register({ pid: root.pid, group: true })
      await awaitReady(root)
      if (root.pid === undefined) throw new Error('flood has no pid')
      const floodGroup = root.pid
      await waitFor('the flood to fill', () => groupSize(floodGroup) >= 101)
      await waitFor('the rate stop', () => {
        void bound.host.refreshTrees()
        return flood.stoppedForFork?.() !== undefined
      })
      expect(flood.stoppedForFork?.()).toBe('spawnRate')
      await waitFor('the flood to die', () => root?.pid !== undefined && !isGroupLive(root.pid))
    } finally {
      if (root !== undefined) await endGroup(root)
      flood.complete(true)
      expect(bound.errors).toEqual([])
      bound.clearTimers()
      bound.host.dispose()
    }
  })

  it('stops a supervised runaway with words and its exit code', async () => {
    await mkdir(path.join('temp', 'govfork'), { recursive: true })
    const root = await realpath(await mkdtemp(path.join('temp', 'govfork', 'gfr-')))
    const entry = path.join(folder, 'flood.mjs')
    await writeFile(
      entry,
      'import { spawn } from "node:child_process"\n' +
        'const alive = Number(process.argv[2] ?? "100")\n' +
        'for (let i = 0; i < alive; i++) {\n' +
        '  const sleeper = spawn("/bin/sleep", ["15"], { stdio: "ignore" })\n' +
        '  sleeper.once("error", () => {})\n' +
        '}\n' +
        'process.stdout.write("ready\\n")\n' +
        'await new Promise((resolve) => {\n' +
        '  setTimeout(resolve, 15_000)\n' +
        '})\n',
    )
    let workChanges = 0
    const bound = boundHost({
      helperPath,
      forkCaps: {
        processCap: RESOURCE_TREE_PROCESS_CAP,
        spawnCap: 60,
        spawnWindowMs: RESOURCE_TREE_SPAWN_WINDOW_MS,
      },
      onWorkChanged: () => {
        workChanges += 1
      },
    })
    const launched = bound.host
    const disposeResources = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      runtime: () => Promise.resolve(launched),
    })
    try {
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let logged = ''
      stderr.on('data', (chunk: Buffer) => {
        logged += chunk.toString('utf8')
      })
      let isReady = false
      stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('ready')) isReady = true
      })
      const run = superviseRuntime({
        entry,
        args: ['100'],
        cwd: folder,
        env: { ...process.env },
        root,
        stdin,
        stdout,
        stderr,
        log: testLogger(),
      })
      void run.catch(() => undefined)
      await waitFor('the flood to be ready', () => isReady)
      // Let the last execs land: the test cannot see the supervised
      // group's pid, so it cannot gate on the group size instead.
      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
      // Drive the sampler until the supervised tree is stopped and retired.
      await waitFor('the supervised stop', () => {
        void launched.refreshTrees()
        return launched.tickets().length === 0 && workChanges >= 2
      })
      await expect(run).resolves.toBe(137)
      // Fork protection speaks: the burst sentence on stderr.
      expect(logged).toContain('fork protection')
      expect(logged).toContain('in a burst')
      expect(workChanges).toBeGreaterThanOrEqual(2)
      expect(bound.errors).toEqual([])
    } finally {
      disposeResources()
      bound.clearTimers()
      await removeFolder(root)
    }
  })
})

describe.runIf(process.platform === 'win32')('fork protection on the attested job', () => {
  let base = ''
  let folder = ''
  let disposeResources: (() => void) | undefined

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'gfp-'))
    // The job helpers compile on first use, as CI builds them; one build
    // serves every test in this file.
    disposeResources = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob: runtimeWindowsJob(
        await mkdtemp(path.join(tmpdir(), 'gfp-jobs-')),
        path.resolve('.'),
      ),
    })
    if ((await loadResourceWindow()) === undefined)
      throw new Error('the Windows job helpers did not build')
  }, 120_000)

  afterAll(async () => {
    disposeResources?.()
    disposeResources = undefined
    await removeFolder(base)
  })

  beforeEach(async () => {
    folder = await mkdtemp(path.join(base, 't-'))
  })

  afterEach(async () => {
    await removeFolder(folder)
  })

  it('passes an ordinary burst of 200 quick spawns', async () => {
    const systemRoot = process.env['SystemRoot'] ?? String.raw`C:\Windows`
    const helper = path.join(systemRoot, 'System32', 'hostname.exe')
    const marker = path.join(folder, 'marker.txt')
    const entry = path.join(folder, 'burst.mjs')
    await writeFile(
      entry,
      'import { spawn } from "node:child_process"\n' +
        'import { writeFileSync } from "node:fs"\n' +
        'const helper = process.argv[2]\n' +
        'let done = 0\n' +
        'async function one() {\n' +
        '  await new Promise((resolve, reject) => {\n' +
        '    const child = spawn(helper, [], { stdio: "ignore" })\n' +
        '    child.once("error", reject)\n' +
        '    child.once("exit", (code) => {\n' +
        '      done += 1\n' +
        '      if (code === 0) resolve()\n' +
        '      else reject(new Error(`burst child exited ${String(code)}`))\n' +
        '    })\n' +
        '  })\n' +
        '}\n' +
        'const workers = []\n' +
        'for (let w = 0; w < 32; w++) {\n' +
        '  workers.push((async () => {\n' +
        '    while (done < 200) await one()\n' +
        '  })())\n' +
        '}\n' +
        'await Promise.all(workers)\n' +
        `writeFileSync(${JSON.stringify(marker)}, "finished\\n")\n`,
    )
    // Ordinary work resolves: no refusal, no stop, marker written.
    await execResourceFile('contained', process.execPath, [entry, helper], {
      cwd: folder,
      encoding: 'utf8',
    })
    expect(existsSync(marker)).toBe(true)
  })

  // 513 real Windows spawns plus the attested settle are genuinely long.
  it('refuses children past 512 while the job survives', { timeout: 30_000 }, async () => {
    const systemRoot = process.env['SystemRoot'] ?? String.raw`C:\Windows`
    const sleeper = path.join(systemRoot, 'System32', 'timeout.exe')
    const marker = path.join(folder, 'marker.txt')
    const entry = path.join(folder, 'flood.mjs')
    await writeFile(
      entry,
      'import { spawn } from "node:child_process"\n' +
        'import { writeFileSync } from "node:fs"\n' +
        'const sleeper = process.argv[2]\n' +
        'const total = Number(process.argv[3] ?? "513")\n' +
        'let started = 0\n' +
        'let refused = 0\n' +
        'async function one() {\n' +
        '  await new Promise((resolve) => {\n' +
        '    const child = spawn(sleeper, ["/t", "12", "/nobreak"], { stdio: "ignore" })\n' +
        '    child.once("error", () => { refused += 1; resolve() })\n' +
        '    child.once("spawn", () => { started += 1; resolve() })\n' +
        '  })\n' +
        '}\n' +
        'const workers = []\n' +
        'for (let w = 0; w < 32; w++) {\n' +
        '  workers.push((async () => {\n' +
        '    while (started + refused < total) await one()\n' +
        '  })())\n' +
        '}\n' +
        'await Promise.all(workers)\n' +
        'await new Promise((resolve) => { setTimeout(resolve, 3000) })\n' +
        `writeFileSync(${JSON.stringify(marker)}, \`started=\${started} refused=\${refused}\\n\`)\n`,
    )
    let failure: unknown
    try {
      await execResourceFile('contained', process.execPath, [entry, sleeper, '513'], {
        cwd: folder,
        encoding: 'utf8',
      })
    } catch (error: unknown) {
      failure = error
    }
    // The kernel refused the overflow softly: the error names it, and the
    // job itself finished (its marker exists).
    expect(isResourceCapRefused(failure)).toBe(true)
    if (isResourceCapRefused(failure)) expect(failure.refusals).toBeGreaterThan(0)
    expect(existsSync(marker)).toBe(true)
  })

  // 25,000 real Windows spawns are a genuinely long flood to run.
  it('ends a spawn flood past 16,384 births in 15 s', { timeout: 60_000 }, async () => {
    const systemRoot = process.env['SystemRoot'] ?? String.raw`C:\Windows`
    const helper = path.join(systemRoot, 'System32', 'hostname.exe')
    const marker = path.join(folder, 'marker.txt')
    const entry = path.join(folder, 'flood.mjs')
    await writeFile(
      entry,
      'import { spawn } from "node:child_process"\n' +
        'import { writeFileSync } from "node:fs"\n' +
        'const helper = process.argv[2]\n' +
        'const total = Number(process.argv[3] ?? "25000")\n' +
        'let done = 0\n' +
        'async function one() {\n' +
        '  await new Promise((resolve) => {\n' +
        '    const child = spawn(helper, [], { stdio: "ignore" })\n' +
        '    child.once("error", () => { done += 1; resolve() })\n' +
        '    child.once("exit", () => { done += 1; resolve() })\n' +
        '  })\n' +
        '}\n' +
        'const workers = []\n' +
        'for (let w = 0; w < 64; w++) {\n' +
        '  workers.push((async () => {\n' +
        '    while (done < total) await one()\n' +
        '  })())\n' +
        '}\n' +
        'await Promise.all(workers)\n' +
        `writeFileSync(${JSON.stringify(marker)}, "finished\\n")\n`,
    )
    let failure: unknown
    try {
      await execResourceFile('contained', process.execPath, [entry, helper, '25000'], {
        cwd: folder,
        encoding: 'utf8',
      })
    } catch (error: unknown) {
      failure = error
    }
    // The helper ended the flood: the typed stop names the spawn rate,
    // and the flood never reached its end marker.
    expect(isResourceForkStop(failure)).toBe(true)
    if (isResourceForkStop(failure)) expect(failure.stop).toBe('spawnRate')
    expect(existsSync(marker)).toBe(false)
  })
})
