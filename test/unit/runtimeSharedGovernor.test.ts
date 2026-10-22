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
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { resourceGovernorHost } from '../../src/core/resources/resourceGovernorEntry'
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
        onWorkChanged: share.workChanged,
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
