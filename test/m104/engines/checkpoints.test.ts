import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createRuntimeCheckpoints,
  type RuntimeCheckpointDeps,
} from '../../../src/runtime/features/checkpoints'
import {
  createRuntimeBackend,
  type RuntimeBackend,
  type RuntimeBackendDeps,
} from '../../../src/runtime/backends'
import type { VerifyHooks } from '../../../src/core/backends/modelapi/verifyLoop'
import * as checkpointBundle from '../../../src/host/checkpoints/checkpointStoreEntry'
import { MuseCodeBackendManager } from '../../../src/host/backend/museCodeBackendManager'
import { UI_TEXT, SECRET_KEYS } from '../../../src/shared/constants'
import { FakeLogOutputChannel, memorySecrets } from '../../unit/helpers/fakes'
import { FAKE_MODEL_API_KEY, fakeModelApi } from '../../unit/helpers/fakeModelApi'
import { buildModelApiBundle } from '../../unit/helpers/modelApiBundle'
import { runGit } from '../../unit/helpers/checkpointHarness'
import { watchSessionTurns } from '../../unit/helpers/sessionTurns'
import * as atomicWrites from '../../../src/host/fsAtomic'
import { createRuntimeEngines } from '../../../src/runtime/features/engines'
import { runtimeSettings } from '../../../src/runtime/panel/runtimeFeatures'
import { RuntimeSettingsStore } from '../../../src/runtime/settingsStore'
import { fakeSurface } from '../../unit/helpers/fakes'
import { createRuntimeHooks } from '../../../src/runtime/features/hooks'
import { memoryContextIo } from '../../unit/helpers/fakeContextIo'
import { hookResult } from '../../unit/helpers/fakeToolIo'
import { createFileScheduleStore } from '../../../src/host/backend/fileScheduleStore'
import { SCHEDULE_MIN_INTERVAL_MS } from '../../../src/shared/constants'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import { runtimePaidRequestAdmission } from '../../../src/runtime/features/paidRequest'
import { paidHarness } from './paidHarness'
import { createRuntimeMcp } from '../../../src/runtime/features/mcp'
import { readMcpServerEntries } from '../../../src/core/backends/musecode/museConfigView'
import { FAKE_MCP_SERVER, fixtureJobLifecycle } from '../../unit/helpers/mcpFixtures'

const folders: string[] = []
const runtimes: RuntimeBackend[] = []
const services: Awaited<ReturnType<typeof createRuntimeCheckpoints>>[] = []
const paidBudgets: ReturnType<typeof createRuntimePaidBudget>[] = []
const dist = { folder: '' }
const jobs = fixtureJobLifecycle()
beforeAll(async () => {
  await jobs.setup()
  dist.folder = await mkdtemp(path.join(tmpdir(), 'm104-pb-checkpoint-dist-'))
  await buildModelApiBundle(dist.folder)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(paidBudgets.splice(0).map((budget) => budget.dispose()))
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
afterAll(async () => {
  await jobs.dispose()
  await rm(dist.folder, { recursive: true, force: true })
})

async function setup() {
  const base = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'm104-pb-checkpoint-')))
  folders.push(base)
  const root = path.join(base, 'workspace')
  await mkdir(root)
  runGit(root, ['init', '-q', '-b', 'main'])
  const data = path.join(base, 'data')
  let isTrusted = true
  let isEnabled = true
  const log = new FakeLogOutputChannel()
  const checkpointDeps: RuntimeCheckpointDeps = {
    workspaceRoot: root,
    dataRoot: data,
    distDir: dist.folder,
    platform: process.platform,
    env: process.env,
    isTrusted: () => isTrusted,
    isEnabled: () => isEnabled,
    retentionDays: () => 0,
    log,
    loadBundle: () => checkpointBundle,
  }
  const create = async (overrides: Partial<RuntimeCheckpointDeps> = {}) => {
    const service = await createRuntimeCheckpoints(
      { ...checkpointDeps, ...overrides },
      UI_TEXT,
      'en',
    )
    services.push(service)
    return service
  }
  const api = fakeModelApi()
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const backend = (
    kind: 'museCode' | 'modelApi',
    provider: NonNullable<Parameters<typeof createRuntimeBackend>[0]['checkpoints']>,
    extra: Pick<
      RuntimeBackendDeps,
      | 'verify'
      | 'unsavedPaths'
      | 'hooks'
      | 'schedules'
      | 'isWorkspaceTrusted'
      | 'interactivePaid'
      | 'reservePaidRequest'
      | 'paidUsage'
      | 'exec'
      | 'mcp'
    > = {},
  ) => {
    const runtime = createRuntimeBackend({
      options: {
        backend: kind,
        trustWorkspace: true,
        museBinary: '',
        shellSandbox: 'auto',
        canBypass: false,
        allowsContributorModels: false,
        paidFeatures: [],
        isVerbose: false,
      },
      version: 'test',
      distDir: dist.folder,
      platform: process.platform,
      env: {},
      homeDir: data,
      secrets,
      museCodeCredentials: [],
      fetch: api.fetch,
      sleep: () => Promise.resolve(),
      runGit: () => Promise.reject(new Error('no repository metadata')),
      log,
      checkpoints: provider,
      ...extra,
    })
    runtimes.push(runtime)
    return runtime
  }
  return {
    root,
    create,
    api,
    backend,
    data,
    log,
    restrict: () => {
      isTrusted = false
    },
    disable: () => {
      isEnabled = false
    },
  }
}

async function changeNote(
  runtime: RuntimeBackend,
  root: string,
  api: ReturnType<typeof fakeModelApi>,
  onWriteRequest?: () => void,
) {
  const host = await runtime.backend.hostFor(root)
  const session = await host.startSession({
    workspaceRoot: root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  const watched = watchSessionTurns(session)
  api.script(
    { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'note.txt' }) }] },
    {
      calls: [
        { name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'after' }) },
      ],
      ...(onWriteRequest !== undefined && { onRequest: onWriteRequest }),
    },
    { text: 'done' },
  )
  const done = watched.turnDone()
  await session.sendTurn([{ type: 'text', text: 'change the note' }])
  await done
  return { session, watched }
}

describe('portable checkpoint backend recording', () => {
  it('uses the installed pool factory in the actual runtime session and exposes its live snapshot', async () => {
    const { root, create, backend, api, log } = await setup()
    const service = await create()
    const runtime = backend('modelApi', () => Promise.resolve(service), {
      mcp: (workspaceRoot, newPool) =>
        createRuntimeMcp(
          {
            workspaceRoot,
            platform: process.platform,
            clientVersion: 'test',
            log,
            jobExecutablePath: jobs.path,
            readSettings: () =>
              readMcpServerEntries(
                JSON.stringify({
                  mcpServers: { fake: { command: process.execPath, args: [FAKE_MCP_SERVER] } },
                }),
              ),
            env: () => ({ PATH: process.env['PATH'] }),
            fetch: api.fetch,
            assertCurrent: () => undefined,
            isWorkspaceTrusted: () => true,
            canUseTools: () => true,
            beforeWorkspaceProcessStart: () => service.port.markNativeBackend(),
          },
          newPool,
        ),
    })
    const host = await runtime.backend.hostFor(root)
    const session = await host.startSession({
      workspaceRoot: root,
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const watched = watchSessionTurns(session)
    api.script(
      { calls: [{ name: 'mcp__fake__echo', arguments: '{"text":"runtime"}' }] },
      { text: 'done' },
    )
    const done = watched.turnDone()
    await session.sendTurn([{ type: 'text', text: 'use the fixture MCP tool' }])
    await done
    expect(runtime.mcpSnapshotFor?.(root)?.servers).toContainEqual(
      expect.objectContaining({
        name: 'fake',
        state: expect.objectContaining({ status: 'connected' }),
      }),
    )
    expect(watched.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ tool: 'mcp__fake__echo', visibleOutput: 'echo: runtime' }),
      }),
    )
  })

  it('keeps interactive paid, hooks, checkpoints, MCP and schedules out of exec', async () => {
    const { root, create, backend } = await setup()
    const { paid } = paidHarness(['imageGeneration'])
    const checkpointFactory = vi.fn(() => create())
    const mcp = vi.fn(() => Promise.reject(new Error('exec must not start an interactive pool')))
    const runtime = backend('modelApi', checkpointFactory, {
      interactivePaid: paid,
      mcp,
      exec: { isEphemeral: true, headlessPaid: () => Promise.resolve(false), streamIdleMs: 1 },
    })
    expect(runtime.paid).not.toBe(paid)
    expect(runtime.paid.isOn('imageGeneration')).toBe(false)
    expect(runtime.checkpointsFor).toBeUndefined()
    expect(runtime.hooksFor).toBeUndefined()
    expect(runtime.mcpSnapshotFor).toBeUndefined()
    const host = await runtime.backend.hostFor(root)
    const session = await host.startSession({
      workspaceRoot: root,
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    expect(session.schedules).toBeUndefined()
    expect(mcp).not.toHaveBeenCalled()
    expect(checkpointFactory).not.toHaveBeenCalled()
    await runtime.close()
    await paid.dispose()
  })
  it('asks before a real runtime image tool, publishes its PNG and settles shared spend', async () => {
    const { root, create, backend, api, data } = await setup()
    const service = await create()
    const { paid, ask, usage } = paidHarness(['imageGeneration'])
    const budget = createRuntimePaidBudget(
      {
        directory: path.join(data, 'paid-daily'),
        now: Date.now,
        capUsd: () => 0.5,
        sleep: () => Promise.resolve(),
        assertCurrent: () => undefined,
        isLocalStorage: () => true,
      },
      UI_TEXT,
      'en',
    )
    paidBudgets.push(budget)
    const runtime = backend('modelApi', () => Promise.resolve(service), {
      interactivePaid: paid,
      paidUsage: usage,
      reservePaidRequest: runtimePaidRequestAdmission({
        budget,
        isOn: (feature) => paid.isOn(feature),
        price: () => ({ costUsd: 0.4, isCurrent: () => true }),
      }),
    })
    const host = await runtime.backend.hostFor(root)
    const session = await host.startSession({
      workspaceRoot: root,
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const watched = watchSessionTurns(session)
    const accepted = Promise.withResolvers<'once'>()
    ask.mockReturnValue(accepted.promise)
    api.script(
      {
        calls: [
          {
            name: 'generate_image',
            arguments: JSON.stringify({ prompt: 'fixture', path: 'art/image.png' }),
          },
        ],
      },
      { text: 'done' },
    )
    const done = watched.turnDone()
    await session.sendTurn([{ type: 'text', text: 'make the fixture image' }])
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledOnce()
    })
    expect(api.imageBodies()).toEqual([])
    accepted.resolve('once')
    await done
    expect(api.imageBodies()).toHaveLength(1)
    expect(await readFile(path.join(root, 'art/image.png'))).toMatchObject({ 0: 0x89, 1: 0x50 })
    expect(usage.current.images).toBe(1)
    expect(await budget.latestDay()).toMatchObject({ spentUsd: 0.4 })
    expect(watched.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ paid: 'imageGeneration' }),
      }),
    )
    expect(watched.events.some((event) => event.type === 'approvalRequested')).toBe(false)
  })
  it('uses live interactive trust before a model tool can write in Bypass', async () => {
    const { root, create, backend, api } = await setup()
    const service = await create()
    let isTrusted = true
    const runtime = backend('modelApi', () => Promise.resolve(service), {
      isWorkspaceTrusted: () => isTrusted,
    })
    await writeFile(path.join(root, 'note.txt'), 'before')
    await changeNote(runtime, root, api, () => {
      isTrusted = false
    })
    expect(await readFile(path.join(root, 'note.txt'), 'utf8')).toBe('before')
  })
  it('offers durable interactive schedules without enabling a paid dispatch', async () => {
    const { root, create, backend, api, data, log } = await setup()
    const service = await create()
    const runtime = backend('modelApi', () => Promise.resolve(service), {
      schedules: () =>
        createFileScheduleStore({ directory: path.join(data, 'schedules'), now: Date.now, log }),
    })
    const host = await runtime.backend.hostFor(root)
    const session = await host.startSession({
      workspaceRoot: root,
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    expect(session.schedules).toBeDefined()
    if (session.schedules === undefined) throw new Error('missing interactive schedules')
    const job = await session.schedules.create(
      { kind: 'interval', everyMs: SCHEDULE_MIN_INTERVAL_MS },
      'inspect changes',
    )
    expect(await session.schedules.list()).toMatchObject([
      { id: job.id, prompt: 'inspect changes' },
    ])
    await expect(
      session.schedules.run(job.id, job.nextFireAtMs, {
        sessionId: session.sessionId,
        modelId: session.modelId,
        prompt: job.prompt,
      }),
    ).rejects.toThrow(UI_TEXT.schedulePaidOff)
    expect(api.requests).toEqual([])
    expect(await session.schedules.cancel(job.id)).toBe(true)
    expect(await session.schedules.list()).toEqual([])
  })
  it('supplies real backend turns with the owned portable verifier and drains it on close', async () => {
    const { root, create, backend, api } = await setup()
    const service = await create()
    const diagnostics = vi.fn<VerifyHooks['diagnosticsAfterEdit']>((files) =>
      Promise.resolve(files.map((file) => ({ file, entries: [], unchecked: 'noReport' }))),
    )
    const dispose = vi.fn(() => Promise.resolve())
    const verifier = {
      verify: {
        isDiagnosticsOn: () => true,
        isFormatOnEdit: () => false,
        checkCommands: () => [],
        diagnosticsAfterEdit: diagnostics,
        formatAfterEdit: () => Promise.resolve(undefined),
      },
      dispose,
    }
    const runtime = backend('modelApi', () => Promise.resolve(service), { verify: () => verifier })
    await writeFile(path.join(root, 'note.txt'), 'before')
    await changeNote(runtime, root, api)
    expect(diagnostics).toHaveBeenCalled()
    expect(runtime.verifyFor?.(root)).toBe(verifier)
    await runtime.close()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('publishes the backend-owned port through A’s frozen engine factory', async () => {
    const { root, create, backend, data, log } = await setup()
    const service = await create()
    const hooks = createRuntimeHooks(
      {
        io: memoryContextIo(new Map()),
        runHook: () => Promise.resolve(hookResult('')),
        platform: process.platform,
        workspaceRoot: root,
        settingsPath: path.join(data, 'settings.json'),
        assertCurrent: () => undefined,
        isWorkspaceTrusted: () => true,
        isHooksEnabled: () => true,
        now: Date.now,
        notice: () => undefined,
        showOutput: () => undefined,
        warn: () => undefined,
      },
      UI_TEXT,
      'en',
    )
    const disposeHooks = vi.spyOn(hooks, 'dispose')
    const runtime = backend('modelApi', () => Promise.resolve(service), { hooks: () => hooks })
    const store = new RuntimeSettingsStore(data, root)
    const settings = await runtimeSettings(store, log)
    const own = vi.fn()
    try {
      const contribution = await createRuntimeEngines(
        {
          ports: {
            runtime,
            store,
            settings,
            workspaceRoot: root,
            log,
            options: {
              backend: 'modelApi',
              trustWorkspace: true,
              museBinary: '',
              shellSandbox: 'auto',
              canBypass: false,
              allowsContributorModels: false,
              paidFeatures: [],
              isVerbose: false,
            },
            host: {
              request: () => Promise.reject(new Error('unexpected editor dispatch')),
              notify: () => undefined,
            },
            surface: fakeSurface('s'),
            controllers: () => [],
            runGit: () => Promise.reject(new Error('unexpected git')),
            selection: () => null,
            documents: () => [],
          },
          requireModelCapabilities: () =>
            Promise.reject(new Error('checkpoints require no model capability')),
          openWorkspace: () => Promise.reject(new Error('unexpected workspace')),
          own,
        },
        UI_TEXT,
        'en',
      )
      expect(contribution.features.checkpoints).toBe(service.port)
      expect(await contribution.features.runManualHook?.('absent')).toMatchObject({
        matched: false,
      })
      expect(await contribution.features.rewriteMessage?.('message')).toBeUndefined()
      expect(own).not.toHaveBeenCalled()
    } finally {
      await settings.dispose()
      await runtime.close()
    }
    expect(disposeHooks).toHaveBeenCalledOnce()
  })
  it('records actual Model API tools, restores their bytes and redoes the restore', async () => {
    const { root, create, backend, api } = await setup()
    const service = await create()
    const runtime = backend('modelApi', () => Promise.resolve(service))
    const file = path.join(root, 'note.txt')
    await writeFile(file, 'before')
    const { session, watched } = await changeNote(runtime, root, api)
    expect(await readFile(file, 'utf8')).toBe('after')
    const started = watched.events.find((event) => event.type === 'turnStarted')
    if (started?.type !== 'turnStarted') throw new Error('no turn started')
    expect(await service.port.turns(session.sessionId)).toContain(started.turnId)
    expect(await runtime.checkpointsFor?.(root)).toBe(service)
    const restored = await service.port.restore({
      backend: () => 'modelApi',
      sessionId: session.sessionId,
      turnId: started.turnId,
      transcriptTurnIds: [started.turnId],
      unsavedPaths: () => [],
    })
    expect(restored).toMatchObject({ ok: true, changed: ['note.txt'] })
    expect(await readFile(file, 'utf8')).toBe('before')
    if (!restored.ok || restored.restoreId === undefined) throw new Error('no restore batch')
    const redone = await service.port.redo({
      backend: () => 'modelApi',
      sourceSessionId: session.sessionId,
      restoreId: restored.restoreId,
      transcriptTurnIds: () => Promise.resolve([started.turnId]),
      unsavedPaths: () => [],
    })
    expect(redone).toMatchObject({ ok: true, changed: ['note.txt'] })
    expect(await readFile(file, 'utf8')).toBe('after')
  })

  it('retains live setting/trust state and refuses native-backend restores', async () => {
    const { create, restrict, disable } = await setup()
    const service = await create()
    expect(service.port.availability()).toBe('on')
    disable()
    expect(service.port.availability()).toBe('off')
    restrict()
    expect(service.port.availability()).toBe('restricted')
    expect(
      await service.port.restore({
        backend: () => 'museCode',
        sessionId: 's',
        turnId: 't',
        transcriptTurnIds: ['t'],
        unsavedPaths: () => [],
      }),
    ).toEqual({ ok: false, reason: 'backendUnsupported' })
  })

  it('refuses a Muse Code process before startup when checkpoint admission fails', async () => {
    const { root, create, backend } = await setup()
    const service = await create()
    vi.spyOn(service.port, 'markNativeBackend').mockRejectedValue(new Error('restore active'))
    const start = vi
      .spyOn(MuseCodeBackendManager.prototype, 'ensureHost')
      .mockRejectedValue(new Error('unexpected native dispatch'))
    const runtime = backend('museCode', () => Promise.resolve(service))
    await expect(runtime.backend.hostFor(root)).rejects.toThrow('restore active')
    expect(start).not.toHaveBeenCalled()
  })

  it('drains a late-acquired namespace exactly once and never publishes a host after close', async () => {
    const { root, create, backend, api } = await setup()
    const service = await create()
    const disposal = vi.spyOn(service, 'dispose')
    const held = Promise.withResolvers<typeof service>()
    const reached = Promise.withResolvers<undefined>()
    const runtime = backend('modelApi', () => {
      reached.resolve(undefined)
      return held.promise
    })
    const opening = runtime.checkpointsFor?.(root)
    if (opening === undefined) throw new Error('checkpoint factory absent')
    const refused = expect(opening).rejects.toThrow('MHP_RUNTIME_CLOSED')
    await reached.promise
    const closing = runtime.close()
    expect(runtime.close()).toBe(closing)
    held.resolve(service)
    await refused
    await closing
    expect(disposal).toHaveBeenCalledOnce()
    expect(api.requests).toEqual([])
  })

  it('closes the journal even when store cleanup rejects', async () => {
    const { create } = await setup()
    const service = await create({
      loadBundle: () => ({
        ...checkpointBundle,
        createCheckpointStore: (
          ...args: Parameters<typeof checkpointBundle.createCheckpointStore>
        ) => {
          const store = checkpointBundle.createCheckpointStore(...args)
          vi.spyOn(store, 'close').mockRejectedValue(new Error('copy close failed'))
          return store
        },
      }),
    })
    const journal = vi.spyOn(service.recording.journal, 'close')
    const first = service.dispose()
    expect(service.dispose()).toBe(first)
    await expect(first).rejects.toThrow('copy close failed')
    expect(journal).toHaveBeenCalledOnce()
    services.splice(services.indexOf(service), 1)
  })

  it('waits for an admitted presence write before returning from release', async () => {
    const { create } = await setup()
    const service = await create({ hasGit: () => false })
    const reached = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const write = atomicWrites.writeFileAtomically
    vi.spyOn(atomicWrites, 'writeFileAtomically').mockImplementation(async (...args) => {
      if (args[0].replaceAll('\\', '/').includes('/windows/')) {
        reached.resolve(undefined)
        await held.promise
      }
      await write(...args)
    })
    const marking = service.port.markTurn('pending-turn', true)
    await reached.promise
    const closing = service.dispose()
    let isClosed = false
    void closing.then(() => {
      isClosed = true
    })
    try {
      await new Promise<undefined>((resolve) => {
        setImmediate(resolve, undefined)
      })
      expect(isClosed).toBe(false)
    } finally {
      held.resolve(undefined)
      await marking
      await closing
    }
    expect(isClosed).toBe(true)
  })
})
