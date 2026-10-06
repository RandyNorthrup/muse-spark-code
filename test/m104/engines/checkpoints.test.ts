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

const folders: string[] = []
const runtimes: RuntimeBackend[] = []
const services: Awaited<ReturnType<typeof createRuntimeCheckpoints>>[] = []
const dist = { folder: '' }
beforeAll(async () => {
  dist.folder = await mkdtemp(path.join(tmpdir(), 'm104-pb-checkpoint-dist-'))
  await buildModelApiBundle(dist.folder)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
afterAll(async () => {
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
    extra: Pick<RuntimeBackendDeps, 'verify' | 'unsavedPaths'> = {},
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
    },
    { text: 'done' },
  )
  const done = watched.turnDone()
  await session.sendTurn([{ type: 'text', text: 'change the note' }])
  await done
  return { session, watched }
}

describe('portable checkpoint backend recording', () => {
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
    const runtime = backend('modelApi', () => Promise.resolve(service))
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
      expect(own).not.toHaveBeenCalled()
    } finally {
      await settings.dispose()
    }
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
