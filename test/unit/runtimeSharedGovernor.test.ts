// SHAREDGOVERNOR: one governor per runtime process (M107 H–C1). The real
// runtime host, the real launch host and the real admission module run here
// against this machine's live sampler; launches are admitted for real and
// the only scripted partner is a held promise standing in for a slow
// first-use initialization. Cancelling, failing and retiring are observed
// through real process table reads (pgrep) and real rejections.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admitResource, configureResources } from '../../src/core/resources/admission'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import {
  createResources,
  resourceGovernorHost,
} from '../../src/core/resources/resourceGovernorEntry'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import {
  createRuntimeResourceHost,
  type RuntimeResourceProcess,
} from '../../src/runtime/resources/host'
import { resourceHistoryRecorder } from '../../src/runtime/resources/history'
import { resourceMachineStore } from '../../src/runtime/resources/settings'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { compileHelper, granted, helperPids, manualClock, settledGone } from './resourceHarness'

setUiText(EN, 'en')

const limits = { timeoutMs: 1000, maxOutputBytes: 128 }
const helper = { folder: '', binary: '' }
const state = { machineDir: '' }

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  state.machineDir = mkdtempSync(path.resolve('temp', 'hc1-machine-'))
  if (process.platform !== 'darwin') return
  const built = await compileHelper('m107-shared-governor-')
  helper.folder = built.folder
  helper.binary = built.binary
})

afterAll(async () => {
  if (helper.folder) await rm(helper.folder, { recursive: true, force: true })
})

function runtimeHost(options: {
  clock: ResourceClock
  settings: () => ResourceSettings
  onError: (error: unknown) => void
  builds: { count: number }
  reader?: DarwinMemoryReader | undefined
  tapWorkChanged?: (() => void) | undefined
}) {
  const machine = resourceMachineStore({
    settingsFile: path.join(state.machineDir, 'resources.json'),
    resumeFile: path.join(state.machineDir, 'resource-resume.json'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  return createRuntimeResourceHost({
    clock: options.clock,
    sampler: createMachineResourceSampler(
      options.settings,
      { timeoutMs: 1000, maxOutputBytes: 64 * 1024 },
      undefined,
      options.reader,
    ),
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
        onWorkChanged: () => {
          options.tapWorkChanged?.()
          share.workChanged()
        },
      })
    },
  })
}

async function withHost(
  body: (scoped: {
    host: RuntimeResourceProcess
    errors: unknown[]
    builds: { count: number }
  }) => Promise<void> | void,
  reader?: DarwinMemoryReader,
  tapWorkChanged?: () => void,
): Promise<void> {
  const { clock, clear } = manualClock()
  const errors: unknown[] = []
  const settings = resourceSettingsSchema.parse({})
  const builds = { count: 0 }
  const host = await runtimeHost({
    clock,
    settings: () => settings,
    onError: (error) => {
      errors.push(error)
    },
    builds,
    reader,
    tapWorkChanged,
  })
  try {
    await body({ host, errors, builds })
  } finally {
    host.dispose()
    reader?.dispose()
    clear()
  }
}

describe('one governor per runtime process', () => {
  it('builds the process launches once and shares them', async () => {
    await withHost(({ host, errors, builds }) => {
      expect(host.launchRows()).toEqual([])
      expect(host.launches?.()).toBe(host.launches?.())
      expect(builds.count).toBe(1)
      expect(errors).toEqual([])
    })
  })

  it('counts an admitted launch as occupancy until it completes', async () => {
    await withHost(async ({ host, errors }) => {
      const launches = host.launches?.()
      if (launches === undefined) throw new Error('process launches were not built')
      expect(launches.backgroundCount('check')).toBe(0)
      const lease = await granted(
        launches.admit('check', undefined, 'background', false, undefined, true),
        'launch admission',
        'did not settle',
      )
      expect(launches.backgroundCount('check')).toBe(1)
      lease.complete(true)
      expect(launches.backgroundCount('check')).toBe(0)
      expect(errors).toEqual([])
    })
  })

  it('stops launches on dispose and refuses further use', async () => {
    await withHost(({ host, errors }) => {
      host.launches?.()
      host.dispose()
      expect(() => host.launches?.()).toThrow()
      expect(errors).toEqual([])
    })
  })

  it.runIf(process.platform === 'darwin')(
    'retires the sampler helper with the process',
    async () => {
      // This host owns its reader: sampling spawns the helper, and only this
      // host's disposal retires it.
      const reader = new DarwinMemoryReader(limits, helper.binary)
      await withHost(async ({ host, errors }) => {
        const status = await host.status()
        expect(status.sample?.memoryAvailableBytes).toBeTypeOf('number')
        const running = await helperPids(helper.binary)
        expect(running).toHaveLength(1)
        host.dispose()
        await settledGone(helper.binary)
        expect(errors).toEqual([])
      }, reader)
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
        'did not settle',
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
        'did not settle',
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

const PROBE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }

// A real governor with a real launch host on it, shared (the runtime lends
// its governor) or owned (the window keeps its own). Nothing is sampled:
// every probe below is synchronous, so no platform helper is involved.
function sharedPair(isShared: boolean): {
  governor: ResourceGovernor
  host: ResourceLaunchHost
  errors: unknown[]
  clear: () => void
} {
  const { clock, clear } = manualClock()
  const errors: unknown[] = []
  const settings = resourceSettingsSchema.parse({ cpuMaxPercent: 90 })
  const governor = new ResourceGovernor({
    clock,
    events: new ResourceEvents((error) => {
      errors.push(error)
    }),
    settings,
    sampler: createMachineResourceSampler(() => settings, PROBE_LIMITS),
    hasRelocationTarget: null,
    onError: (error) => {
      errors.push(error)
    },
  })
  const hostSettings = resourceSettingsSchema.parse({ cpuMaxPercent: 10 })
  const host = new ResourceLaunchHost({
    governor,
    events: new ResourceEvents((error) => {
      errors.push(error)
    }),
    clock,
    settings: () => hostSettings,
    bindTree: () => Promise.resolve(null),
    onError: (error: unknown) => {
      errors.push(error)
    },
    ...(isShared && { isGovernorShared: true }),
  })
  return { governor, host, errors, clear }
}

function admitCheck(
  host: ResourceLaunchHost,
  what: string,
): Promise<{ complete: (isFailed: boolean) => void }> {
  return granted(
    host.admit('check', undefined, 'background', false, undefined, true),
    what,
    'did not settle',
  )
}

describe('the lent governor is never driven', () => {
  it('leaves a shared governor running when its launch host disposes', async () => {
    const shared = sharedPair(true)
    try {
      // Disposal happens with the admission still live, as at shutdown.
      await admitCheck(shared.host, 'shared launch admission')
      shared.host.dispose()
      // The governor is the runtime host's: starting it still works.
      expect(() => {
        shared.governor.start()
      }).not.toThrow()
      expect(shared.errors).toEqual([])
    } finally {
      shared.governor.dispose()
      shared.clear()
    }
    const owned = sharedPair(false)
    try {
      await admitCheck(owned.host, 'owned launch admission')
      owned.host.dispose()
      // An owned governor dies with its host: starting it refuses.
      expect(() => {
        owned.governor.start()
      }).toThrow('Resource governor disposed')
      expect(owned.errors).toEqual([])
    } finally {
      owned.clear()
    }
  })

  it('never pushes a shared host’s settings into the lent governor', async () => {
    const shared = sharedPair(true)
    try {
      await admitCheck(shared.host, 'shared launch admission')
      expect(shared.governor.status([]).settings.cpuMaxPercent).toBe(90)
      expect(shared.errors).toEqual([])
    } finally {
      shared.host.dispose()
      shared.governor.dispose()
      shared.clear()
    }
    const owned = sharedPair(false)
    try {
      await admitCheck(owned.host, 'owned launch admission')
      expect(owned.governor.status([]).settings.cpuMaxPercent).toBe(10)
      expect(owned.errors).toEqual([])
    } finally {
      owned.host.dispose()
      owned.governor.dispose()
      owned.clear()
    }
  })

  it('never starts the lent governor from a shared launch', async () => {
    const shared = sharedPair(true)
    let samples = 0
    shared.governor.onSample(() => {
      samples += 1
    })
    try {
      const lease = await admitCheck(shared.host, 'shared launch admission')
      // A start would schedule a sample within milliseconds; a quiet third
      // of a second means no start happened.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(samples).toBe(0)
      lease.complete(true)
      expect(shared.errors).toEqual([])
    } finally {
      shared.host.dispose()
      shared.governor.dispose()
      shared.clear()
    }
  })

  it('reports retired work to the runtime host', async () => {
    // A plain reservation needs no report on admission: the runtime queue
    // reads the launches' counts live through its running delegate, so only
    // the retirement (and tree proof) nudge it to read again.
    let changes = 0
    await withHost(
      async ({ host, errors }) => {
        const launches = host.launches?.()
        if (launches === undefined) throw new Error('process launches were not built')
        const lease = await admitCheck(launches, 'launch admission')
        const atAdmit = changes
        lease.complete(true)
        expect(changes).toBeGreaterThan(atAdmit)
        expect(errors).toEqual([])
      },
      undefined,
      () => {
        changes += 1
      },
    )
  })

  it('keeps no harness rows for a reservation the registry never proved', async () => {
    await withHost(async ({ host, errors }) => {
      const launches = host.launches?.()
      if (launches === undefined) throw new Error('process launches were not built')
      expect(host.launchRows()).toEqual([])
      const lease = await admitCheck(launches, 'launch admission')
      lease.complete(true)
      // No tree was ever bound or proved (native identity is absent on this
      // build), so history reads no estimate and no row.
      expect(host.launchRows()).toEqual([])
      expect(errors).toEqual([])
    })
  })
})

describe('the process entry builds launches around the lent governor', () => {
  it('admits through the runtime share without touching its own inspect', async () => {
    const errors: unknown[] = []
    const facade = await createResources(
      {
        machineDir: state.machineDir,
        sleep: (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          }),
        onError: (error: unknown) => {
          errors.push(error)
        },
        spawns: {
          // The lent settings must win: if the entry built its own governor
          // instead, reading settings calls this and the admission fails.
          inspect: () => {
            throw new Error('the lent settings must win')
          },
          onError: (error?: unknown) => {
            errors.push(error)
          },
          registryFile: path.join(state.machineDir, 'entry-registry.json'),
        },
      },
      EN,
      'en',
    )
    try {
      const launches = facade.launches?.()
      if (launches === undefined) throw new Error('entry built no launches')
      expect(facade.launches?.()).toBe(launches)
      expect(facade.launchRows()).toEqual([])
      const lease = await admitCheck(launches, 'entry launch admission')
      expect(launches.backgroundCount('check')).toBe(1)
      lease.complete(true)
      expect(launches.backgroundCount('check')).toBe(0)
      expect(errors).toEqual([])
    } finally {
      facade.dispose()
    }
  })
})
