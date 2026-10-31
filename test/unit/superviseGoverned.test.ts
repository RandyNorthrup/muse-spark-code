// A supervised run is a governed launch (RLF-GOVFORK): with a real
// configured governor, `superviseRuntime` admits, registers, tree-owns and
// completes its child. The run's occupancy is visible to the host, the calm
// run exits 0 with its output, and no fork-protection words print. Real
// child, real host, real admission on every platform (attested on Windows).
import { mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureResources } from '../../src/core/resources/admission'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import type { ResourceClock } from '../../src/shared/resources'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { superviseRuntime } from '../../src/runtime/supervise/supervisor'
import type { Logger } from '../../src/host/logger'
import { manualClock } from './resourceHarness'
import { removeFolder } from './helpers/temporaryFolders'

const PROBE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }

function testLogger(seen: string[]): Logger {
  return {
    trace: (message) => {
      seen.push(message)
    },
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

describe('supervised runs are governed', () => {
  let root = ''
  let folder = ''
  let clock: ResourceClock
  let clearTimers: () => void
  let errors: unknown[] = []
  let host: ResourceLaunchHost | undefined
  let workChanges = 0
  let disposeResources: (() => void) | undefined

  beforeEach(async () => {
    // The stop endpoint is a socket, so the root must fit the platform's
    // short socket path: the worktree's ignored temp folder, not TMPDIR.
    await mkdir(path.join('temp', 'govfork'), { recursive: true })
    root = await realpath(await mkdtemp(path.join('temp', 'govfork', 'gsr-')))
    folder = await mkdtemp(path.join(tmpdir(), 'gsf-'))
    errors = []
    workChanges = 0
    // Frozen at zero: births never age out of their window mid-test.
    const manual = manualClock()
    clock = manual.clock
    clearTimers = manual.clear
    const events = new ResourceEvents((error: unknown) => {
      errors.push(error)
    })
    const settings = resourceSettingsSchema.parse({})
    const governor = new ResourceGovernor({
      clock,
      sampler: createMachineResourceSampler(() => settings, PROBE_LIMITS),
      settings,
      events,
      hasRelocationTarget: null,
      onError: (error: unknown) => {
        errors.push(error)
      },
    })
    host = new ResourceLaunchHost({
      governor,
      events,
      clock,
      settings: () => settings,
      bindTree: () => Promise.resolve(null),
      onError: (error: unknown) => {
        errors.push(error)
      },
      onWorkChanged: () => {
        workChanges += 1
      },
    })
    const launched = host
    disposeResources = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      runtime: () => Promise.resolve(launched),
      ...(process.platform === 'win32' && {
        windowsJob: runtimeWindowsJob(
          await mkdtemp(path.join(tmpdir(), 'govfork-supervised-jobs-')),
          path.resolve('.'),
        ),
      }),
    })
  })

  afterEach(async () => {
    disposeResources?.()
    disposeResources = undefined
    host = undefined
    clearTimers()
    await removeFolder(root)
    await removeFolder(folder)
  })

  it('registers the run and retires it at a calm exit', async () => {
    const entry = path.join(folder, 'marker.mjs')
    await writeFile(entry, 'process.stdout.write("supervised-ok\\n")\n')
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let output = ''
    let logged = ''
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    stderr.on('data', (chunk: Buffer) => {
      logged += chunk.toString('utf8')
    })
    const traces: string[] = []
    const code = await superviseRuntime({
      entry,
      args: [],
      cwd: folder,
      env: { ...process.env },
      root,
      stdin,
      stdout,
      stderr,
      log: testLogger(traces),
    })
    expect(code).toBe(0)
    expect(output).toBe('supervised-ok\n')
    // The host saw the run's whole occupancy: registered, then retired.
    expect(workChanges).toBeGreaterThanOrEqual(2)
    expect(host?.tickets()).toEqual([])
    // A calm run says nothing about fork protection.
    expect(logged).not.toContain('fork protection')
    // The run's record and endpoint left nothing behind.
    expect(await readdir(root)).toEqual([])
    expect(errors).toEqual([])
  })
})
