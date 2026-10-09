import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResources } from '../../src/runtime/resources/entry'
import { createRuntimeResourceHost } from '../../src/runtime/resources/host'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import { resourceMachineStore } from '../../src/runtime/resources/settings'
import { resourceNoticeText, resourceStatusText } from '../../src/runtime/resources/text'
import { resourceHistoryText } from '../../src/core/usage/resourceText'
import { aggregateResources } from '../../src/core/usage/aggregate'
import type {
  ResourceMachineStore,
  RuntimeResources,
  RuntimeResourceNotice,
} from '../../src/runtime/resources/port'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  RESOURCE_FOREGROUND_WAIT_MS,
  RESOURCE_GIB_BYTES,
  RESOURCE_OVERRIDE_MS,
  RESOURCE_SAMPLE_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  resourceRecordSchema,
  resourceSettingsSchema,
  resourceStatusSchema,
} from '../../src/shared/resources'
import { fill, formatBytes, formatPercent } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { FakeResourceMachine, runtimeResources } from './helpers/resources/runtime'
import { removeFolder } from './helpers/temporaryFolders'

const hosts: RuntimeResources[] = []
const folders: string[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose()
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})
async function setup() {
  const fixture = await runtimeResources()
  hosts.push(fixture.host)
  return fixture
}

describe('M107 H runtime host', () => {
  it('preserves prototype machine-store methods and their receiver through the real entry', async () => {
    class PrototypeMachine implements ResourceMachineStore {
      settings = resourceSettingsSchema.parse({ enabled: false })
      until: number | null = null
      readSettings() {
        return Promise.resolve(this.settings)
      }
      readResumeUntil() {
        return Promise.resolve(this.until)
      }
      writeResumeUntil(untilMs: number) {
        this.until = untilMs
        return Promise.resolve()
      }
    }
    const machine = new PrototypeMachine()
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      const host = await createResources(
        {
          machineDir: process.cwd(),
          machine,
          sleep: () => Promise.resolve(),
          onError: vi.fn(),
          overrides: { cpuMaxPercent: 75 },
        },
        EN,
        'en',
      )
      hosts.push(host)
      expect(Object.hasOwn(machine, 'readResumeUntil')).toBe(false)
      expect(Object.hasOwn(machine, 'writeResumeUntil')).toBe(false)
      expect(await host.status()).toMatchObject({
        level: 'normal',
        settings: { enabled: false, cpuMaxPercent: 75 },
      })
      machine.settings.enabled = true
      machine.until = RESOURCE_OVERRIDE_MS
      expect(await host.status()).toMatchObject({ overrideUntilMs: RESOURCE_OVERRIDE_MS })
      machine.settings.memoryMaxPercent = 80
      now.mockReturnValue(1)
      expect(await host.resume()).toMatchObject({
        level: 'normal',
        settings: { enabled: true, memoryMaxPercent: 80 },
        overrideUntilMs: RESOURCE_OVERRIDE_MS + 1,
      })
      expect(machine.until).toBe(RESOURCE_OVERRIDE_MS + 1)
      const admission = await host.admit({ kind: 'check', class: 'background', priority: 0 })
      const permit = await admission.ready
      permit.release()
    } finally {
      now.mockRestore()
    }
  })

  it('starts no sampling on construction or subscription, and starts at first admission', async () => {
    const { host, sampler, clock } = await setup()
    const timers = vi.spyOn(clock, 'setTimeout')
    const notice = vi.fn()
    host.subscribe('session', notice)
    host.subscribeEvents(notice)
    clock.advance(RESOURCE_SAMPLE_MS)
    expect(sampler.sample).not.toHaveBeenCalled()
    const admission = await host.admit(
      { kind: 'check', class: 'background', priority: 0 },
      { sessionId: 'session' },
    )
    const permit = await admission.ready
    expect(timers).toHaveBeenCalled()
    clock.advance(0)
    await host.status()
    expect(sampler.sample).toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
    permit.release()
  })

  it('shares machine overrides, preserves their original deadline, then takes a fresh reading', async () => {
    const machine = new FakeResourceMachine()
    const first = await runtimeResources({}, machine)
    const second = await runtimeResources({}, machine)
    hosts.push(first.host, second.host)
    for (const fixture of [first, second]) {
      fixture.reading.memoryAvailableBytes = 1
      const paused = await fixture.host.status()
      expect(paused.level).toBe('pause')
    }
    const resumed = await first.host.resume()
    expect(resumed.overrideUntilMs).toBe(RESOURCE_OVERRIDE_MS)
    second.clock.advance(RESOURCE_SAMPLE_MS)
    const peer = await second.host.status()
    expect(peer.level).toBe('normal')
    expect(peer.overrideUntilMs).toBe(resumed.overrideUntilMs)
    second.clock.advance(RESOURCE_OVERRIDE_MS - RESOURCE_SAMPLE_MS)
    const expired = await second.host.status()
    expect(expired.level).toBe('pause')
    expect(second.sampler.sample).toHaveBeenCalledTimes(3)
  })

  it('does not consume expired or future-dated resume markers', async () => {
    const { host, machine, reading, clock } = await setup()
    reading.memoryAvailableBytes = 1
    machine.until = 0
    clock.advance(1)
    const paused = await host.status()
    expect(paused.level).toBe('pause')
    machine.until = clock.now() + RESOURCE_OVERRIDE_MS + 1
    await expect(host.status()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    machine.until = null
    const retained = await host.status()
    expect(retained.level).toBe('pause')
  })

  it('retains explicit machine off and rejects invalid overrides', async () => {
    const { host, machine, reading } = await setup()
    reading.memoryAvailableBytes = 1
    machine.settings.enabled = false
    const status = await host.status()
    expect(status.level).toBe('normal')
    expect(status.settings.enabled).toBe(false)
    const { clock, sampler, running, onError } = await setup()
    await expect(
      createRuntimeResourceHost({
        clock,
        sampler,
        running,
        onError,
        machine,
        overrides: { cpuMaxPercent: 29 },
      }),
    ).rejects.toThrow()
  })

  it('consumes a marker once, renews it explicitly, and cancels it when the machine disables governance', async () => {
    const { host, machine, clock } = await setup()
    const events = vi.fn()
    host.subscribeEvents(events)
    await host.resume()
    await host.status()
    await host.status()
    expect(events).toHaveBeenCalledTimes(1)
    clock.advance(1)
    await host.resume()
    expect(events).toHaveBeenCalledTimes(2)
    machine.settings.enabled = false
    const disabled = await host.status()
    expect(disabled.overrideUntilMs).toBeNull()
    expect(disabled.settings.enabled).toBe(false)
    clock.advance(1)
    const stillOff = await host.resume()
    expect(stillOff.overrideUntilMs).toBeNull()
  })

  it('refuses aborted admissions before settings reads and before starting any governor timer', async () => {
    const { host, machine, clock } = await setup()
    const timer = vi.spyOn(clock, 'setTimeout')
    const controller = new AbortController()
    controller.abort()
    const before = machine.readSettings.mock.calls.length
    await expect(
      host.admit({ kind: 'check', class: 'background', priority: 0 }, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(machine.readSettings).toHaveBeenCalledTimes(before)
    expect(timer).not.toHaveBeenCalled()
    const late = new AbortController()
    machine.readResumeUntil.mockImplementationOnce(() => {
      late.abort()
      return Promise.resolve(null)
    })
    await expect(
      host.admit({ kind: 'check', class: 'background', priority: 0 }, undefined, late.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(timer).not.toHaveBeenCalled()
  })

  it('forgets cancelled session work, isolates listener failures, and wakes when occupancy becomes known', async () => {
    const { host, reading, running, onError } = await setup()
    reading.memoryUsedPercent = 95
    await host.status()
    await host.status()
    running.backgroundCount.mockReturnValue(null)
    const notice = vi.fn()
    host.subscribe('waiting', () => {
      throw new Error('observer failure')
    })
    host.subscribe('waiting', notice)
    const controller = new AbortController()
    const waiting = await host.admit(
      { kind: 'check', class: 'background', priority: 0 },
      { sessionId: 'waiting' },
      controller.signal,
    )
    expect(notice).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    let isReady = false
    const ready = (async () => {
      const permit = await waiting.ready
      isReady = true
      return permit
    })()
    await Promise.resolve()
    expect(isReady).toBe(false)
    running.backgroundCount.mockReturnValue(0)
    host.workChanged()
    await vi.waitFor(() => {
      expect(isReady).toBe(true)
    })
    const permit = await ready
    permit.release()
    const cancelled = await host.admit(
      { kind: 'worker', class: 'background', priority: 0 },
      { sessionId: 'cancelled' },
      controller.signal,
    )
    // Hold that kind with a real local permit so the next launch actually waits.
    const worker = await cancelled.ready
    const blocked = await host.admit(
      { kind: 'worker', class: 'background', priority: 0 },
      { sessionId: 'waiting' },
      controller.signal,
    )
    const rejected = expect(blocked.ready).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    worker.release()
    notice.mockClear()
    await host.resume()
    expect(notice).not.toHaveBeenCalled()
  })

  it('notifies only sessions with affected work and gives the deferred tool its own metadata', async () => {
    const { host, reading } = await setup()
    const first: RuntimeResourceNotice[] = []
    const second = vi.fn()
    host.subscribe('first', (notice) => {
      first.push(notice)
    })
    host.subscribe('other', second)
    const admitted = await host.admit(
      { kind: 'check', class: 'background', priority: 0 },
      { sessionId: 'first', toolCallId: 'running-tool' },
    )
    const permit = await admitted.ready
    const another = await host.admit(
      { kind: 'mcpServer', class: 'foreground', priority: 0 },
      { sessionId: 'first' },
    )
    const anotherPermit = await another.ready
    reading.memoryAvailableBytes = 1
    await host.status()
    expect(first.filter((notice) => notice.event.type === 'levelChanged')).toHaveLength(1)
    expect(second).not.toHaveBeenCalled()
    const waiting = await host.admit(
      { kind: 'toolShell', class: 'foreground', priority: 0 },
      { sessionId: 'first', toolCallId: 'waiting-tool' },
    )
    const deferred = first.find((notice) => notice.event.type === 'deferred')
    expect(deferred?.toolCallId).toBe('waiting-tool')
    expect(deferred?.status.queued).toContainEqual({
      kind: 'toolShell',
      class: 'foreground',
      count: 1,
    })
    expect(first[0]?.text).toContain(UI_TEXT.resourcePauseNotice.split(':', 1)[0])
    expect(waiting.runNow()).toBe(true)
    const foreground = await waiting.ready
    foreground.release()
    permit.release()
    anotherPermit.release()
    first.length = 0
    await host.resume()
    expect(first).toHaveLength(0)
  })

  it('keeps foreground deadline and cancellation independent of unknown occupancy', async () => {
    const { host, reading, clock, running } = await setup()
    reading.memoryAvailableBytes = 1
    await host.status()
    running.backgroundCount.mockReturnValue(null)
    const controller = new AbortController()
    const background = await host.admit(
      { kind: 'check', class: 'background', priority: 0 },
      undefined,
      controller.signal,
    )
    const rejected = expect(background.ready).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    const foreground = await host.admit({ kind: 'toolShell', class: 'foreground', priority: 0 })
    clock.advance(RESOURCE_FOREGROUND_WAIT_MS)
    const permit = await foreground.ready
    permit.release()
    expect(running.backgroundCount).not.toHaveBeenCalled()
  })

  it('retains the original queue identity for a delegating parent permit', async () => {
    const { host, reading } = await setup()
    const admission = await host.admit({ kind: 'worker', class: 'background', priority: 0 })
    const parent = await admission.ready
    reading.memoryUsedPercent = 95
    await host.status()
    await host.status()
    const child = await host.admit({ kind: 'worker', class: 'background', priority: 0, parent })
    await expect(child.ready).rejects.toThrow('Resource child cannot wait on its parent slot')
    parent.release()
  })

  it('forgets the context of an admission rejected before the queue returns a handle', async () => {
    const { host } = await setup()
    const notice = vi.fn()
    host.subscribe('invalid', notice)
    await expect(
      host.admit({ kind: 'check', class: 'background', priority: 0.5 }, { sessionId: 'invalid' }),
    ).rejects.toThrow('Invalid resource priority')
    await host.resume()
    expect(notice).not.toHaveBeenCalled()
  })

  it('refuses absent history and private record fields, rather than returning empty success', async () => {
    const { host, clock, sampler, machine, running, onError } = await setup()
    await expect(host.history()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    const record = resourceRecordSchema.parse({
      type: 'resource',
      atMs: 0,
      minute: null,
      event: { type: 'override', atMs: 0, untilMs: 1 },
      work: [],
    })
    const history = { read: vi.fn(() => Promise.resolve(aggregateResources([record]))) }
    const journal = await createRuntimeResourceHost({
      clock,
      sampler,
      machine,
      running,
      onError,
      history,
    })
    hosts.push(journal)
    expect(await journal.command('history', true)).toBe(
      JSON.stringify({
        minutes: [],
        events: [record.event],
        counts: [{ type: 'override', kind: null, count: 1 }],
        work: [],
      }),
    )
    // The fake journal lies after validation, without a production cast or bypass.
    const lying = aggregateResources([record])
    history.read.mockResolvedValue(lying)
    for (const event of lying.events) {
      Reflect.set(event, 'pid', 10)
      Reflect.set(event, 'command', 'canary')
      Reflect.set(event, 'path', '/canary')
      Reflect.set(event, 'env', { CANARY: 'private' })
    }
    await expect(journal.history()).rejects.toThrow()
  })

  it('cancels queued work on disposal and ignores a late sample', async () => {
    const { host, reading, sampler } = await setup()
    reading.memoryAvailableBytes = 1
    await host.status()
    const waiting = await host.admit({ kind: 'check', class: 'background', priority: 0 })
    let wasCancelled = false
    const rejected = (async () => {
      try {
        await waiting.ready
        throw new Error('cancelled work was admitted')
      } catch (error) {
        wasCancelled = true
        expect(error).toMatchObject({ name: 'AbortError' })
      }
    })()
    let resolve: (() => void) | undefined
    sampler.sample.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = () => {
            done({
              ...reading,
              atMs: 0,
              cpuPercent: 0,
              memoryUsedPercent: 0,
              memoryAvailableBytes: 1,
              memoryTotalBytes: 2,
              gpuPercent: null,
              diskBusyPercent: null,
              pressure: null,
            })
          }
        }),
    )
    const pending = host.status()
    await vi.waitFor(() => {
      expect(resolve).toBeTypeOf('function')
    })
    host.dispose()
    resolve?.()
    await expect(pending).rejects.toThrow(UI_TEXT.resourceUnavailable)
    await vi.waitFor(() => {
      expect(wasCancelled).toBe(true)
    })
    await rejected
    await expect(host.admit({ kind: 'check', class: 'background', priority: 0 })).rejects.toThrow(
      UI_TEXT.resourceUnavailable,
    )
  })
})

describe('machine files and lazy runtime facade', () => {
  it('uses only machine values, defaults only missing files, and validates every range', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm107h-settings-'))
    folders.push(folder)
    const settingsFile = path.join(folder, 'resources.json')
    const resumeFile = path.join(folder, 'resume.json')
    const store = resourceMachineStore({
      settingsFile,
      resumeFile,
      sleep: async () => {
        await Promise.resolve()
      },
    })
    expect(await store.readSettings()).toEqual(resourceSettingsSchema.parse({}))
    await writeFile(
      settingsFile,
      JSON.stringify({
        'museSpark.resourceGovernor': false,
        'museSpark.resourceCpuMaxPercent': 75,
        workspaceValue: { 'museSpark.resourceGovernor': true },
      }),
    )
    expect(await store.readSettings()).toMatchObject({ enabled: false, cpuMaxPercent: 75 })
    for (const [key, value] of [
      ['resourceCpuMaxPercent', 29],
      ['resourceCpuMaxPercent', 101],
      ['resourceMemoryMaxPercent', 39],
      ['resourceMemoryMaxPercent', 99],
      ['resourceMemoryMinFreeGiB', 0.49],
      ['resourceMemoryMinFreeGiB', 65],
      ['resourceGpuMaxPercent', 0],
      ['resourceDiskBusyMaxPercent', 101],
      ['resourceRelocate', 'remote'],
      ['resourceGovernor', 'on'],
    ]) {
      await writeFile(settingsFile, JSON.stringify({ [`museSpark.${String(key)}`]: value }))
      await expect(store.readSettings()).rejects.toThrow()
    }
    for (const malformed of ['null', '[]', '{bad', '"table"']) {
      await writeFile(settingsFile, malformed)
      await expect(store.readSettings()).rejects.toThrow()
    }
    await writeFile(settingsFile, '{}'.padEnd(BOUNDED_FILE_READ_CHUNK_BYTES + 2, ' '))
    await expect(store.readSettings()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    await writeFile(
      settingsFile,
      Buffer.from([123, 34, 110, 111, 116, 101, 34, 58, 34, 255, 34, 125]),
    )
    await expect(store.readSettings()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    const inaccessible = resourceMachineStore({
      settingsFile: folder,
      resumeFile,
      sleep: () => Promise.resolve(),
    })
    await expect(inaccessible.readSettings()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    expect(await store.readResumeUntil()).toBeNull()
    await store.writeResumeUntil(RESOURCE_OVERRIDE_MS)
    expect(await store.readResumeUntil()).toBe(RESOURCE_OVERRIDE_MS)
    const marker: unknown = JSON.parse(await readFile(resumeFile, 'utf8'))
    expect(marker).toEqual({ untilMs: RESOURCE_OVERRIDE_MS })
    await writeFile(resumeFile, '{"untilMs":-1}')
    await expect(store.readResumeUntil()).rejects.toThrow()
    await expect(store.writeResumeUntil(-1)).rejects.toThrow()
  })

  it('loads once on demand, retries a failed load and removes pre-load subscriptions', async () => {
    const { host, sampler } = await setup()
    const subscribe = vi.spyOn(host, 'subscribe')
    const factory = vi.fn(() => Promise.resolve(host))
    const loadBundle = vi.fn((): unknown => ({ createResources: factory }))
    loadBundle.mockImplementationOnce(() => {
      throw new Error('absent')
    })
    const invalidModules = [null, 2, {}, { createResources: false }]
    for (const invalid of invalidModules) loadBundle.mockReturnValueOnce(invalid)
    const facade = lazyRuntimeResources({
      machineDir: '/machine',
      distDir: '/dist',
      sleep: async () => {
        await Promise.resolve()
      },
      onError: vi.fn(),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadBundle,
    })
    hosts.push(facade)
    const listener = vi.fn()
    const unsubscribe = facade.subscribe('gone', listener)
    facade.subscribeEvents(listener)
    unsubscribe()
    expect(loadBundle).not.toHaveBeenCalled()
    expect(sampler.sample).not.toHaveBeenCalled()
    for (let attempt = 0; attempt < invalidModules.length + 1; attempt++)
      await expect(facade.status()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    await Promise.all([facade.status(), facade.command('status', false)])
    expect(factory).toHaveBeenCalledTimes(1)
    expect(loadBundle).toHaveBeenCalledTimes(invalidModules.length + 2)
    expect(subscribe).not.toHaveBeenCalled()
    facade.dispose()
    await expect(facade.status()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    await expect(host.status()).rejects.toThrow(UI_TEXT.resourceUnavailable)
    expect(() => facade.subscribe('late', listener)).toThrow(UI_TEXT.resourceUnavailable)
  })

  it('disposes a module that finishes loading after its facade closes', async () => {
    const { host } = await setup()
    const created = Promise.withResolvers<RuntimeResources>()
    const factory = vi.fn(() => created.promise)
    const facade = lazyRuntimeResources({
      machineDir: '/machine',
      distDir: '/dist',
      sleep: () => Promise.resolve(),
      onError: vi.fn(),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadBundle: () => ({ createResources: factory }),
    })
    hosts.push(facade)
    const pending = facade.status()
    const rejected = expect(pending).rejects.toThrow(UI_TEXT.resourceUnavailable)
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalled()
    })
    const dispose = vi.spyOn(host, 'dispose')
    facade.dispose()
    created.resolve(host)
    await rejected
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reports each unavailable reading as unknown, including pause notices', () => {
    const status = resourceStatusSchema.parse({
      level: 'pause',
      sample: null,
      settings: { gpuMaxPercent: 80, diskBusyMaxPercent: 80 },
      queued: [],
      overrideUntilMs: null,
    })
    const text = resourceStatusText(status)
    expect(text.match(new RegExp(UI_TEXT.resourceUnknown, 'g'))).toHaveLength(5)
    expect(
      resourceNoticeText(
        { type: 'levelChanged', atMs: 0, from: 'normal', to: 'pause', reason: 'cpu' },
        status,
      ),
    ).toContain(`CPU use is ${UI_TEXT.resourceUnknown}`)
    expect(text).not.toMatch(/:\s*0%/)
    expect(resourceHistoryText(aggregateResources([]))).toBe(
      [UI_TEXT.resourceTitle, UI_TEXT.resourceHistoryObserved, UI_TEXT.resourceHistoryEmpty].join(
        '\n',
      ),
    )
  })

  it('names the actual critical threshold, including a CPU limit higher than the emergency limit', async () => {
    const { host, reading } = await setup()
    reading.memoryAvailableBytes = 1
    const status = await host.status()
    const event = {
      type: 'levelChanged',
      atMs: 0,
      from: 'normal',
      to: 'pause',
      reason: 'critical',
    } as const
    expect(resourceNoticeText(event, status)).toContain(
      fill(UI_TEXT.resourcePauseNotice, {
        metric: UI_TEXT.resourceAvailableMemory,
        reading: formatBytes(1),
        threshold: formatBytes(RESOURCE_GIB_BYTES),
      }),
    )
    const cpu = resourceStatusSchema.parse({
      ...status,
      settings: { ...status.settings, cpuMaxPercent: 100 },
      sample: { ...status.sample, cpuPercent: 97, memoryAvailableBytes: 2 * RESOURCE_GIB_BYTES },
    })
    expect(resourceNoticeText(event, cpu)).toContain(
      fill(UI_TEXT.resourcePauseNotice, {
        metric: UI_TEXT.resourceCpu,
        reading: formatPercent(97),
        threshold: formatPercent(97),
      }),
    )
    const optional = resourceStatusSchema.parse({
      ...status,
      settings: { ...status.settings, gpuMaxPercent: 80, diskBusyMaxPercent: 80 },
    })
    for (const [reason, metric, value, threshold] of [
      ['memoryUsed', UI_TEXT.resourceMemory, formatPercent(40), formatPercent(90)],
      ['gpu', UI_TEXT.resourceGpu, UI_TEXT.resourceUnknown, formatPercent(80)],
      ['disk', UI_TEXT.resourceDisk, UI_TEXT.resourceUnknown, formatPercent(80)],
      [
        'memoryFree',
        UI_TEXT.resourceAvailableMemory,
        formatBytes(1),
        formatBytes(2 * RESOURCE_GIB_BYTES),
      ],
    ] as const)
      expect(resourceNoticeText({ ...event, reason }, optional)).toContain(
        fill(UI_TEXT.resourcePauseNotice, { metric, reading: value, threshold }),
      )
  })

  it('shows deferral without inventing a trigger metric and retains every journal metric and work total', async () => {
    const { host, reading } = await setup()
    reading.memoryAvailableBytes = 1
    const status = await host.status()
    const waiting = resourceNoticeText({ type: 'paused', atMs: 0, kind: 'check' }, status)
    expect(waiting).toContain(UI_TEXT.resourceWaiting)
    expect(waiting).not.toContain(UI_TEXT.resourcePauseNotice.split(':', 1)[0])
    const record = resourceRecordSchema.parse({
      type: 'resource',
      atMs: 0,
      event: null,
      minute: {
        cpuPercent: 0,
        memoryUsedPercent: 40,
        availableMemory: 'unknown',
        gpuPercent: 80,
        diskBusyPercent: 0,
        level: 'normal',
        thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
      },
      work: [{ kind: 'check', cpuSeconds: 10, peakMemoryBytes: 1000 }],
    })
    const text = resourceHistoryText(aggregateResources([record]))
    for (const label of [
      UI_TEXT.resourceCpu,
      UI_TEXT.resourceMemory,
      UI_TEXT.resourceAvailableMemory,
      UI_TEXT.resourceGpu,
      UI_TEXT.resourceDisk,
      UI_TEXT.resourceCpuTime,
      UI_TEXT.resourcePeakMemory,
    ])
      expect(text).toContain(label)
    expect(text).toContain(UI_TEXT.resourceUnknown)
    expect(text).toContain('85%')
    expect(text).toContain('90%')
    expect(text).toContain('check')
  })
})
