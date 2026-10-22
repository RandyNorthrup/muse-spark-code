// SHAREDGOVERNOR: one governor per runtime process (M107 H–C1). The real
// runtime host, the real launch host and the real admission module run here
// against this machine's live sampler; launches are admitted for real and
// the only scripted partner is a held promise standing in for a slow
// first-use initialization. Cancelling, failing and retiring are observed
// through real process table reads (pgrep) and real rejections.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admitResource, configureResources } from '../../src/core/resources/admission'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { resourceGovernorHost } from '../../src/core/resources/resourceGovernorEntry'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'
import { MachineResourceSampler } from '../../src/core/resources/sampler/machineSampler'
import { createOptionalResourceProbes } from '../../src/core/resources/sampler/optionalProbes'
import { createSamplerIo } from '../../src/core/resources/sampler/system'
import { createRuntimeResourceHost } from '../../src/runtime/resources/host'
import { resourceHistoryRecorder } from '../../src/runtime/resources/history'
import { resourceMachineStore } from '../../src/runtime/resources/settings'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

setUiText(EN, 'en')

const limits = { timeoutMs: 1000, maxOutputBytes: 128 }
const helper = { folder: '', binary: '' }
const state = { machineDir: '' }

function granted<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`resource ${what} did not settle`))
      }, 2000)
    }),
  ])
}

function manualClock() {
  const nowMs = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clock: ResourceClock = {
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  return {
    clock,
    clear: () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}

/** Real governor sampler: live OS counters, with the helper child on Darwin. */
function sharedSampler(settings: () => ResourceSettings, reader?: DarwinMemoryReader) {
  const io = createSamplerIo({ timeoutMs: 1000, maxOutputBytes: 64 * 1024 })
  const compatibleProcess: { availableMemory?: () => number } = process
  return new MachineResourceSampler(
    {
      platform: process.platform,
      now: () => Date.now(),
      cpus: () => os.cpus().map((cpu) => cpu.times),
      totalMemory: () => os.totalmem(),
      freeMemory: () => os.freemem(),
      availableMemory: () =>
        reader === undefined ? (compatibleProcess.availableMemory?.() ?? null) : reader.read(),
      dispose: () => {
        reader?.dispose()
      },
      read: io.read,
      loadOptionalProbes: () => Promise.resolve(createOptionalResourceProbes(io)),
    },
    settings,
  )
}

function helperPids(): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', helper.binary], (error, stdout) => {
      if (error === null) {
        resolve(
          stdout
            .split('\n')
            .map(Number)
            .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
        )
      } else {
        resolve([])
      }
    })
  })
}

async function settledGone(): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    const running = await helperPids()
    if (running.length === 0) return
    if (Date.now() - startedAt > 5000) throw new Error('helper child outlived disposal')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  state.machineDir = mkdtempSync(path.resolve('temp', 'hc1-machine-'))
  if (process.platform !== 'darwin') return
  helper.folder = await mkdtemp(path.join(tmpdir(), 'm107-shared-governor-'))
  helper.binary = path.join(helper.folder, 'memory')
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      '-arch',
      'x86_64',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      path.resolve('native/darwin/MuseSparkCreated.c'),
      '-o',
      helper.binary,
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        TMPDIR: helper.folder,
        // The toolchain lookup (not the helper) may need this: without it a
        // machine whose xcode-select names a missing Xcode cannot drive cc.
        ...(process.env['DEVELOPER_DIR'] !== undefined && {
          DEVELOPER_DIR: process.env['DEVELOPER_DIR'],
        }),
      },
    },
  )
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', helper.binary], { env: {} })
})

afterAll(async () => {
  if (helper.folder) await rm(helper.folder, { recursive: true, force: true })
})

function runtimeHost(options: {
  clock: ResourceClock
  settings: () => ResourceSettings
  onError: (error: unknown) => void
  builds: { count: number }
  reader?: DarwinMemoryReader
}) {
  const machine = resourceMachineStore({
    settingsFile: path.join(state.machineDir, 'resources.json'),
    resumeFile: path.join(state.machineDir, 'resource-resume.json'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  return createRuntimeResourceHost({
    clock: options.clock,
    sampler: sharedSampler(options.settings, options.reader),
    machine,
    running: { backgroundCount: () => 0 },
    onError: options.onError,
    launches: (share) => {
      options.builds.count += 1
      return new ResourceLaunchHost({
        governor: share.governor,
        events: share.events,
        clock: options.clock,
        settings: share.settings,
        bindTree: () => Promise.resolve(null),
        onError: options.onError,
        isGovernorShared: true,
        onWorkChanged: share.workChanged,
      })
    },
  })
}

describe('one governor per runtime process', () => {
  it('builds the process launches once and shares them', async () => {
    const { clock, clear } = manualClock()
    const errors: unknown[] = []
    const settings = resourceSettingsSchema.parse({})
    const builds = { count: 0 }
    const host = await runtimeHost({
      clock,
      settings: () => settings,
      onError: (e) => {
        errors.push(e)
      },
      builds,
    })
    try {
      expect(host.launchRows()).toEqual([])
      expect(host.launches?.()).toBe(host.launches?.())
      expect(builds.count).toBe(1)
      expect(errors).toEqual([])
    } finally {
      host.dispose()
      clear()
    }
  })

  it('counts an admitted launch as occupancy until it completes', async () => {
    const { clock, clear } = manualClock()
    const errors: unknown[] = []
    const settings = resourceSettingsSchema.parse({})
    const builds = { count: 0 }
    const host = await runtimeHost({
      clock,
      settings: () => settings,
      onError: (e) => {
        errors.push(e)
      },
      builds,
    })
    try {
      const launches = host.launches?.()
      if (launches === undefined) throw new Error('process launches were not built')
      expect(launches.backgroundCount('check')).toBe(0)
      const lease = await granted(
        launches.admit('check', undefined, 'background', false, undefined, true),
        'launch admission',
      )
      expect(launches.backgroundCount('check')).toBe(1)
      lease.complete(true)
      expect(launches.backgroundCount('check')).toBe(0)
      expect(errors).toEqual([])
    } finally {
      host.dispose()
      clear()
    }
  })

  it('stops launches on dispose and refuses further use', async () => {
    const { clock, clear } = manualClock()
    const errors: unknown[] = []
    const settings = resourceSettingsSchema.parse({})
    const builds = { count: 0 }
    const host = await runtimeHost({
      clock,
      settings: () => settings,
      onError: (e) => {
        errors.push(e)
      },
      builds,
    })
    try {
      host.launches?.()
      host.dispose()
      expect(() => host.launches?.()).toThrow()
      expect(errors).toEqual([])
    } finally {
      clear()
    }
  })

  it.runIf(process.platform === 'darwin')(
    'retires the sampler helper with the process',
    async () => {
      const { clock, clear } = manualClock()
      const errors: unknown[] = []
      const settings = resourceSettingsSchema.parse({})
      const builds = { count: 0 }
      // This host owns its reader: sampling spawns the helper, and only this
      // host's disposal retires it.
      const reader = new DarwinMemoryReader(limits, helper.binary)
      const host = await runtimeHost({
        clock,
        settings: () => settings,
        onError: (e) => {
          errors.push(e)
        },
        builds,
        reader,
      })
      try {
        const status = await host.status()
        expect(status.sample?.memoryAvailableBytes).toBeTypeOf('number')
        const running = await helperPids()
        expect(running).toHaveLength(1)
        host.dispose()
        await settledGone()
        expect(errors).toEqual([])
      } finally {
        reader.dispose()
        clear()
      }
    },
  )
})

describe('first-use admission waits', () => {
  it('lets a caller stop waiting without cancelling shared initialization', async () => {
    const shared = Promise.withResolvers<ResourceLaunchHost>()
    const errors: unknown[] = []
    const dispose = configureResources({
      inspect: () => ({}),
      onError: (error?: unknown) => {
        errors.push(error)
      },
      runtime: () => shared.promise,
    })
    try {
      const controller = new AbortController()
      const waiting = admitResource(
        'check',
        controller.signal,
        'background',
        false,
        undefined,
        true,
      )
      controller.abort()
      await expect(waiting).rejects.toThrow()
      // The shared initialization was not cancelled: resolving it admits later callers.
      shared.resolve(resourceGovernorHost({ inspect: () => ({}), onError: () => undefined }))
      const lease = await granted(
        admitResource('check', undefined, 'background', false, undefined, true),
        'admission after abort',
      )
      expect(lease).not.toBeUndefined()
      lease?.complete(true)
    } finally {
      dispose()
    }
  })

  it('refuses a failed load and retries the next launch', async () => {
    const failures: unknown[] = []
    let attempts = 0
    const dispose = configureResources({
      inspect: () => ({}),
      onError: (error?: unknown) => {
        failures.push(error)
      },
      runtime: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('first load fails'))
          : Promise.resolve(resourceGovernorHost({ inspect: () => ({}), onError: () => undefined }))
      },
    })
    try {
      await expect(
        admitResource('check', undefined, 'background', false, undefined, true),
      ).rejects.toThrow('first load fails')
      const lease = await granted(
        admitResource('check', undefined, 'background', false, undefined, true),
        'admission after failure',
      )
      expect(lease).not.toBeUndefined()
      expect(attempts).toBe(2)
      lease?.complete(true)
    } finally {
      dispose()
    }
  })
})

describe('shared history consent', () => {
  it('tracks the recording flag and flushes an empty journal', async () => {
    let isRecording = false
    const errors: unknown[] = []
    const recorder = resourceHistoryRecorder(
      { dataFolder: state.machineDir, isEnabled: () => isRecording },
      { read: () => Promise.resolve([]) },
      (error?: unknown) => {
        errors.push(error)
      },
    )
    expect(recorder.isConsented()).toBe(false)
    isRecording = true
    expect(recorder.isConsented()).toBe(true)
    await recorder.flush()
    expect(errors).toEqual([])
  })
})
