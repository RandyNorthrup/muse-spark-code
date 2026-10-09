// H–C1 (PLAN M107, D87.2): the runtime's governed spawns are its one
// governor's launches. Each process (the ACP agent, a headless run, a terminal
// command) has one runtime host; the spawns admitted through the process's
// port share its queue, its events (and so headless's v2 sink), its occupancy
// and its history journal, where they are the harness-work rows.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { acpResourceCommand } from '../../src/acp/resources'
import {
  admitBootstrap,
  admitResource,
  resourceSafePoint,
  resourceWindowsJob,
} from '../../src/core/resources/admission'
import { spawnResourceProcess } from '../../src/core/resources/launcher'
import * as governorEntry from '../../src/core/resources/resourceGovernorEntry'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { execEventV2Schema } from '../../src/runtime/exec/execProtocol'
import { runExec } from '../../src/runtime/exec/runExec'
import { resourceHistoryReader } from '../../src/runtime/resources/history'
import { lazyRuntimeResources, type ProcessResources } from '../../src/runtime/resources/load'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { RESOURCE_GIB_BYTES, RESOURCE_HISTORY_MINUTE_MS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { resourceHistorySchema } from '../../src/shared/resourceHistory'
import type { ResourceSample, ResourceSettings } from '../../src/shared/resources'
import { FakeAgentHost } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { outputWriter } from './helpers/execContract'
import { resourcesRoot, temporaryFolders } from './helpers/resources/journalFixtures'
import { FakeResourceMachine, runtimeResources } from './helpers/resources/runtime'
import {
  fakeExecDeps,
  openAcpSession,
  resourceAcpAgent,
  turnHost,
  useRuntimeHost,
} from './helpers/resources/runtimeScenes'

// One scripted machine for every sampler the process makes; `samplers` counts them.
// With `minutes`, each reading is a minute after the last, so every sample the
// recorder takes closes the previous minute into the journal.
const machine = vi.hoisted(() => ({
  reading: undefined as Partial<ResourceSample> | undefined,
  samplers: 0,
  minutes: undefined as { atMs: number; stepMs: number } | undefined,
}))
vi.mock('../../src/core/resources/sampler/system', () => ({
  createMachineResourceSampler: () => {
    machine.samplers += 1
    return {
      sample: () => {
        const minutes = machine.minutes
        if (minutes !== undefined) minutes.atMs += minutes.stepMs
        return Promise.resolve({ ...machine.reading, atMs: minutes?.atMs ?? Date.now() })
      },
    }
  },
}))

const NORMAL: ResourceSample = {
  atMs: 0,
  cpuPercent: 10,
  memoryUsedPercent: 40,
  memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
  memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
  gpuPercent: null,
  diskBusyPercent: null,
  pressure: null,
}
const THROTTLE = { ...NORMAL, memoryUsedPercent: 95 }
// Below half the memory floor: critical, so pause at once.
const PAUSE = { ...NORMAL, memoryAvailableBytes: 1 }
/** How long a spawn that must not be admitted is watched before it counts as waiting. */
const WAITING_MS = 300
const HOUR_MS = 60 * RESOURCE_HISTORY_MINUTE_MS
/**
 * How long a journal row or a session notice may take to appear: several
 * locked, flushed journal writes on a slow VM, inside the test's own deadline.
 */
const ROW_WAIT_MS = 4000
/** Spins in short slices until its standard input closes, then exits 0. */
const HELD_PROBE =
  "process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); " +
  'const spin = () => { const end = Date.now() + 20; while (Date.now() < end); setImmediate(spin) }; spin()'
const QUERY = { range: 'today', groupBy: 'provider', metric: 'cost' } as const

const folders = temporaryFolders('m107hc1')
const facades: ProcessResources[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const facade of facades.splice(0)) facade.dispose()
  machine.samplers = 0
  machine.reading = NORMAL
  machine.minutes = undefined
  await folders.cleanup()
})

/** Readings a minute apart, starting an hour ago: inside the journal's window. */
function stepMinutes() {
  const hourAgo = Date.now() - HOUR_MS
  machine.minutes = {
    atMs: hourAgo - (hourAgo % RESOURCE_HISTORY_MINUTE_MS),
    stepMs: RESOURCE_HISTORY_MINUTE_MS,
  }
}

/** The process's one facade over the production governor entry, as `run()` makes it. */
function processFacade(
  folder: string,
  extra: Partial<Parameters<typeof lazyRuntimeResources>[0]> = {},
) {
  machine.reading = NORMAL
  const facade = lazyRuntimeResources({
    distDir: path.resolve('dist'),
    machineDir: folder,
    sleep: () => Promise.resolve(),
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onError: vi.fn(),
    machine: new FakeResourceMachine(),
    loadBundle: () => governorEntry,
    ...extra,
  })
  facades.push(facade)
  return facade
}

/** Resolves with the admission, or fails the test if it is still waiting. */
async function admitted<T>(pending: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('The governed spawn is still waiting for admission'))
        }, WAITING_MS * 10)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether `pending` is still unsettled after WAITING_MS; a rejection counts as settled. */
async function isWaiting(pending: Promise<unknown>): Promise<boolean> {
  const settled = (async () => {
    try {
      await pending
    } catch {
      // Refused or cancelled: no longer waiting.
    }
    return false
  })()
  const waiting = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, WAITING_MS)
  })
  return await Promise.race([settled, waiting])
}

/** The rejection a spawn admission ends with, or undefined if it was admitted. */
async function refusalOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/** The session's updates that carry a deferred resource event. */
function deferredUpdates(updates: readonly acp.SessionNotification[], sessionId: string) {
  return updates.filter(
    (update) =>
      update.sessionId === sessionId && JSON.stringify(update.update).includes('"type":"deferred"'),
  )
}

function ignoreSignal() {
  return undefined
}
function noSignals() {
  return ignoreSignal
}

/** A temp-free admission through the process's port, as the launcher's probes admit. */
function spawnAdmission(
  kind: 'check' | 'other' | 'toolShell',
  workClass: 'foreground' | 'background',
  signal?: AbortSignal,
) {
  return admitResource(kind, signal, workClass, false, undefined, true)
}

async function journalText(folder: string): Promise<string> {
  const root = resourcesRoot(folder)
  let names: string[] = []
  try {
    names = await readdir(root, { recursive: true })
  } catch {
    // No journal folder: nothing was recorded.
  }
  const texts = await Promise.all(
    names
      .filter((name) => name.endsWith('.json') || name.endsWith('.jsonl'))
      .map((name) => readFile(path.join(root, name), 'utf8')),
  )
  return texts.join('\n')
}

function usage(folder: string) {
  return createUsageAccess({
    dataFolder: folder,
    packageRoot: process.cwd(),
    host: 'ACP',
    locale: 'en',
    uiText: EN,
    log: new FakeLogOutputChannel(),
  })
}

describe('H–C1: the runtime spawn binding', () => {
  it.each([
    {
      name: 'spawn',
      admit: (_facade: ProcessResources, signal: AbortSignal) =>
        spawnAdmission('other', 'foreground', signal),
    },
    {
      name: 'bootstrap',
      admit: (_facade: ProcessResources, signal: AbortSignal) => admitBootstrap(signal),
    },
    {
      name: 'safe point',
      admit: (_facade: ProcessResources, signal: AbortSignal) => resourceSafePoint('check', signal),
    },
    {
      name: 'facade',
      admit: (facade: ProcessResources, signal: AbortSignal) =>
        facade.admit({ kind: 'other', class: 'foreground', priority: 0 }, undefined, signal),
    },
  ])('cancels $name within one tick while shared initialization continues', async ({ admit }) => {
    const store = new FakeResourceMachine()
    const held = Promise.withResolvers<ResourceSettings>()
    const started = Promise.withResolvers<undefined>()
    store.readSettings.mockImplementationOnce(() => {
      started.resolve(undefined)
      return held.promise
    })
    const loadBundle = vi.fn(() => governorEntry)
    const facade = processFacade(await folders.create(), { machine: store, loadBundle })
    const stop = new AbortController()
    const cancelled = refusalOf(admit(facade, stop.signal))
    const later = [spawnAdmission('other', 'foreground')]
    try {
      await started.promise
      stop.abort()
      const result = await Promise.race([
        cancelled,
        new Promise<string>((resolve) => {
          setImmediate(() => {
            resolve('still waiting for initial settings')
          })
        }),
      ])
      expect(result).toMatchObject({ name: 'AbortError' })
      // A caller arriving after cancellation still joins the same initialization.
      later.push(spawnAdmission('other', 'foreground'))
      expect(store.readSettings).toHaveBeenCalledTimes(1)
      expect(loadBundle).toHaveBeenCalledTimes(1)
      held.resolve(store.settings)
      for (const pending of later) {
        const lease = await admitted(pending)
        lease?.complete(true)
      }
      expect(machine.samplers).toBe(1)
      expect(loadBundle).toHaveBeenCalledTimes(1)
    } finally {
      // A failing assertion must also release the shared initialization.
      held.resolve(store.settings)
      await Promise.allSettled([cancelled, ...later])
    }
  })

  it('preserves a bootstrap deadline while initial settings are held', async () => {
    const store = new FakeResourceMachine()
    const held = Promise.withResolvers<ResourceSettings>()
    store.readSettings.mockReturnValueOnce(held.promise)
    processFacade(await folders.create(), { machine: store })
    const signal = AbortSignal.timeout(100)
    const deadline = refusalOf(admitBootstrap(signal))
    try {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      const result = await Promise.race([
        deadline,
        new Promise<string>((resolve) => {
          setImmediate(() => {
            resolve('still waiting past the bootstrap deadline')
          })
        }),
      ])
      expect(result).toBe(signal.reason)
      expect(result).toMatchObject({ name: 'TimeoutError' })
    } finally {
      held.resolve(store.settings)
      await deadline
    }
  })

  it('admits one background launch per kind at throttle and the next once the first retires', async () => {
    const facade = processFacade(await folders.create())
    machine.reading = THROTTLE
    await facade.status()
    const throttled = await facade.status()
    expect(throttled.level).toBe('throttle')
    const stop = new AbortController()
    try {
      // The launches prove nothing of the kind is running, so throttle admits one.
      const first = await admitted(spawnAdmission('check', 'background', stop.signal))
      const second = spawnAdmission('check', 'background', stop.signal)
      expect(await isWaiting(second)).toBe(true)
      const waiting = await facade.status()
      expect(waiting.queued).toEqual([{ kind: 'check', class: 'background', count: 1 }])
      // Its retirement is the runtime queue's occupancy change: the next one starts.
      first?.complete(true)
      const next = await admitted(second)
      const after = await facade.status()
      expect(after.level).toBe('throttle')
      next?.complete(true)
    } finally {
      stop.abort()
    }
  })

  it('records the launches as the harness-work rows every history surface reads', async () => {
    const folder = await folders.create()
    // As the ACP agent's process, with its usage-history consent.
    const facade = processFacade(folder, { isRecordingHistory: () => true })
    stepMinutes()
    const lease = await admitted(spawnAdmission('other', 'foreground'))
    // A Windows attested job's own final accounting (SPAWN017C), before its retirement.
    lease?.settle?.({
      root: { pid: 4242, startTime: '424200' },
      scope: 'm107hc1-attested-job',
      usage: { cpuSeconds: 2, residentBytes: 4096 },
    })
    lease?.complete(true)
    const row = { kind: 'other', cpuSeconds: 2, peakMemoryBytes: 4096 }
    // Three journal writes apart (the open minute, then two closed ones).
    const history = await vi.waitFor(
      async () => {
        await facade.status()
        const read = await resourceHistoryReader(folder).read()
        expect(read.work).toEqual([row])
        return read
      },
      { timeout: ROW_WAIT_MS },
    )
    // The terminal, ACP `/usage resources` and every editor's usage page agree.
    expect(resourceHistorySchema.parse(JSON.parse(await facade.command('history', true)))).toEqual(
      history,
    )
    const text = await facade.command('history', false)
    expect(
      await acpResourceCommand([{ type: 'text', text: '/usage resources' }], facade),
    ).toMatchObject({ content: { type: 'text', text } })
    const page = await usage(folder).read(QUERY)
    expect(page.resources).toEqual(history)
    // The tree's identity never reaches the journal.
    const stored = await journalText(folder)
    expect(stored).toContain('"kind":"other"')
    expect(stored).not.toMatch(/4242|m107hc1-attested-job/u)
  })

  it('builds the launches around the runtime host’s one governor, whose level holds a safe point', async () => {
    const facade = processFacade(await folders.create())
    const lease = await admitted(spawnAdmission('other', 'foreground'))
    lease?.complete(true)
    // One sampler in the process: the launches made no governor of their own.
    expect(machine.samplers).toBe(1)
    machine.reading = PAUSE
    const paused = await facade.status()
    expect(paused.level).toBe('pause')
    const safePoint = resourceSafePoint('check')
    expect(await isWaiting(safePoint)).toBe(true)
    machine.reading = NORMAL
    await facade.resume()
    await admitted(safePoint)
    expect(machine.samplers).toBe(1)
  })

  it('applies a command’s run flags and recording consent given after the first governed use', async () => {
    const folder = await folders.create()
    const facade = processFacade(folder)
    const lease = await admitted(spawnAdmission('other', 'foreground'))
    lease?.complete(true)
    await facade.status()
    // A one-shot or headless process only reads.
    expect(await journalText(folder)).toBe('')
    expect(facade.configure({ overrides: { cpuMaxPercent: 75, relocate: 'off' } })).toBe(facade)
    const flagged = await facade.status()
    expect(flagged.settings).toMatchObject({ cpuMaxPercent: 75, relocate: 'off' })
    facade.configure({ isRecordingHistory: () => true })
    await vi.waitFor(
      async () => {
        await facade.status()
        const recorded = await resourceHistoryReader(folder).read()
        expect(recorded.minutes).toHaveLength(1)
      },
      { timeout: ROW_WAIT_MS },
    )
    expect(machine.samplers).toBe(1)
    facade.dispose()
    facade.dispose()
    expect(() => facade.configure({})).toThrow(UI_TEXT.resourceUnavailable)
  })

  it('closes the process governor once though the agent and the process both close it', async () => {
    const fixture = await runtimeResources()
    const dispose = vi.spyOn(fixture.host, 'dispose')
    const facade = processFacade(await folders.create(), {
      loadBundle: () => ({ createResources: () => Promise.resolve(fixture.host) }),
    })
    await facade.status()
    facade.dispose()
    facade.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('retries the launches after a failed load instead of refusing every later spawn', async () => {
    const store = new FakeResourceMachine()
    store.readSettings.mockRejectedValueOnce(new Error('m107hc1 unreadable settings'))
    processFacade(await folders.create(), { machine: store })
    await expect(spawnAdmission('other', 'foreground')).rejects.toThrow()
    const lease = await admitted(spawnAdmission('other', 'foreground'))
    lease?.complete(true)
  })

  it('tells the ACP session whose turn starts a governed spawn, and no other session', async () => {
    const facade = processFacade(await folders.create())
    const backend = new FakeAgentHost()
    const updates: acp.SessionNotification[] = []
    const agent = resourceAcpAgent(backend, facade)
    const stop = new AbortController()
    await acp
      .client({ name: 'm107hc1' })
      .onNotification('session/update', ({ params }) => {
        updates.push(params)
      })
      .onRequest('session/request_permission', () => ({ outcome: { outcome: 'cancelled' } }))
      .connectWith(agent, async (connection) => {
        const sessionId = await openAcpSession(connection)
        const other = await connection.request('session/new', {
          cwd: process.cwd(),
          mcpServers: [],
        })
        const session = backend.sessions[0]
        if (session === undefined) throw new Error('missing fake session')
        session.sendTurn.mockImplementation(() => {
          machine.reading = PAUSE
          // The turn's own tool spawn: at pause a foreground spawn waits behind its notice.
          void refusalOf(spawnAdmission('toolShell', 'foreground', stop.signal))
          return Promise.resolve({ turnId: 'turn-1', disposition: 'started' })
        })
        const turn = connection.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'go' }],
        })
        await vi.waitFor(
          () => {
            expect(deferredUpdates(updates, sessionId)).toHaveLength(1)
          },
          { timeout: ROW_WAIT_MS },
        )
        expect(deferredUpdates(updates, other.sessionId)).toEqual([])
        stop.abort()
        session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
        await turn
      })
  })

  it('sends a headless run’s own spawns through the one process governor into its v2 sink', async () => {
    const facade = processFacade(await folders.create())
    const options = parseCommandLine(['exec', '--output', 'jsonl', 'fake task'])
    if (options.command !== 'exec') throw new Error('bad options')
    const seen: { refusal?: unknown; settings?: unknown } = {}
    const backend = turnHost(async (fake) => {
      const status = await facade.status()
      seen.settings = status.settings
      machine.reading = PAUSE
      // The run's background check, at pause: refused at once and said in the sink.
      seen.refusal = await refusalOf(spawnAdmission('check', 'background'))
      fake.emit({ type: 'turnCompleted', turnId: 'fake-turn', terminal: 'completed' })
      return { turnId: 'fake-turn', disposition: 'started' }
    })
    useRuntimeHost(backend)
    const out = outputWriter()
    const lifecycle = createLifecycle({
      processStartMs: Date.now(),
      timeoutMs: options.options.timeoutMs,
      now: () => Date.now(),
      setTimer: (ms, callback) => {
        const timer = setTimeout(callback, ms)
        return () => {
          clearTimeout(timer)
        }
      },
      onSignal: noSignals,
      forceFinish: vi.fn(),
      exit: () => {
        throw new Error('unexpected force exit')
      },
    })
    // As `main` binds it: the run's flags configure the process's one governor.
    const createResources = vi.fn((overrides: Partial<ResourceSettings>) =>
      facade.configure({ overrides }),
    )
    try {
      const code = await runExec(
        lifecycle,
        fakeExecDeps({
          options: options.options,
          stdout: out,
          stderr: outputWriter(),
          now: () => Date.now(),
          createResources,
          resourceOverrides: { cpuMaxPercent: 75 },
        }),
      )
      expect(code).toBe(0)
    } finally {
      lifecycle.dispose()
    }
    expect(createResources).toHaveBeenCalledWith({ cpuMaxPercent: 75, relocate: 'off' })
    // The run's flags govern the same process governor its spawns use.
    expect(seen.settings).toMatchObject({ cpuMaxPercent: 75, relocate: 'off' })
    expect(seen.refusal).toMatchObject({ code: 'paused' })
    const events = out.chunks
      .map((chunk) => execEventV2Schema.parse(JSON.parse(chunk)))
      .flatMap((event) => (event.type === 'resource' ? [event.event] : []))
    expect(events).toEqual([
      expect.objectContaining({ type: 'levelChanged', to: 'pause' }),
      expect.objectContaining({ type: 'paused', kind: 'check' }),
    ])
    expect(machine.samplers).toBe(1)
  })
})

// macOS has no registered tree for a portable launch yet (T–C1, the native
// identity helper), so it records no row rather than an estimate.
describe.skipIf(process.platform === 'darwin')('H–C1: a real governed spawn in the runtime', () => {
  const state: { folder?: string } = {}
  beforeAll(async () => {
    state.folder = await folders.create()
    // The ACP agent's process, recording; Windows compiles and self-tests the job
    // helpers once, before the timed case. That compile is governed work too, so
    // its readings already step through minutes in order.
    processFacade(state.folder, { isRecordingHistory: () => true })
    stepMinutes()
    if (process.platform === 'win32') expect(await resourceWindowsJob()).toBeDefined()
  }, 60_000)

  it('records a real probe’s whole-tree usage as a harness-work row', async () => {
    const folder = state.folder
    if (folder === undefined) throw new Error('missing machine folder')
    const facade = facades.at(-1)
    if (facade === undefined) throw new Error('missing process facade')
    // A busy probe that runs until its input closes.
    const held = await spawnResourceProcess('probe', process.execPath, ['-e', HELD_PROBE], {
      env: process.env,
    })
    const release = () => {
      held.child.stdin.end()
    }
    try {
      // Windows' attested job reports at its exit; Linux reads the live registered tree.
      if (process.platform === 'win32') release()
      const history = await vi.waitFor(
        async () => {
          await facade.status()
          const read = await resourceHistoryReader(folder).read()
          const work = read.work.find((row) => row.kind === 'other')
          expect(work?.cpuSeconds).toBeGreaterThan(0)
          expect(work?.peakMemoryBytes).toBeGreaterThan(0)
          return read
        },
        { timeout: ROW_WAIT_MS },
      )
      expect(history.minutes.length).toBeGreaterThan(0)
    } finally {
      release()
      await held.outcome()
    }
  })
})
