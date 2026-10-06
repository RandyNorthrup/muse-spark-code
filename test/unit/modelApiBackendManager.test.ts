import type { UsageRecording } from '../../src/core/usage/recording'
import { watchSessionTurns } from './helpers/sessionTurns'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import {
  ModelApiBackendManager,
  type ModelApiBackendManagerDeps,
} from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { memoryContextIo } from './helpers/fakeContextIo'
import { noopToolIo } from './helpers/fakeToolIo'
import { fakeManagerDeps } from './helpers/modelApiManager'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { EditReview } from '../../src/host/editor/editReview'

interface HookFixture {
  readonly enabled: boolean
  readonly files: Map<string, string>
  readonly runHook: NonNullable<ToolIo['runHook']>
}

it('loads the provider factory only on first BYO resolution and reuses it', async () => {
  const meta = fakeModelApi()
  const provider = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const ref = 'team/small'
  const registry = createProviderRegistry({
    models: () =>
      Promise.resolve([
        {
          ref,
          origin: 'https://example.test',
          pricing: { kind: 'local' },
          evidence: { capabilities: { toolCalling: true } },
        },
      ]),
    createClient: () => Promise.resolve(fakeModelApiClient(provider, log)),
    isCurrent: () => true,
  })
  const createProviders = vi.fn(() => Promise.resolve(registry))
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(meta, log, {
      workspaceRoot: '/ws',
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
      createProviders,
    }),
  )
  try {
    const host = await manager.ensureHost()
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(createProviders).not.toHaveBeenCalled()
    await session.setModel(ref)
    await session.setModel(ref)
    expect(createProviders).toHaveBeenCalledTimes(1)
    expect(await host.listModels(session.sessionId)).toContainEqual(
      expect.objectContaining({
        modelId: ref,
        providerId: 'team',
        isActive: true,
        pricing: 'local',
      }),
    )
  } finally {
    await manager.dispose()
  }
})

/** A manager on the fake API with no waits, over the given root and store. */
function managerOn(
  workspaceRoot: string | undefined,
  store: SessionStore | undefined,
  log = new FakeLogOutputChannel(),
  hooks?: HookFixture,
  extra: Partial<
    Pick<
      ModelApiBackendManagerDeps,
      'createMcpServers' | 'ideTools' | 'isObservationPackingOn' | 'newId' | 'browserCheck'
    >
  > = {},
) {
  const api = fakeModelApi()
  return {
    api,
    log,
    manager: new ModelApiBackendManager(
      fakeManagerDeps(api, log, {
        workspaceRoot,
        store,
        ...(hooks !== undefined && {
          io: { ...noopToolIo, runHook: hooks.runHook },
          contextIo: memoryContextIo(hooks.files),
          isHooksEnabled: () => hooks.enabled,
        }),
        // The bundle's source module, imported rather than built (M57): the
        // built dist/modelApi.js is modelApiBundle.test.ts's.
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle: () => modelApiEntry,
        ...extra,
      }),
    ),
  }
}

function manager(workspaceRoot: string | undefined) {
  return managerOn(workspaceRoot, undefined)
}

describe('ModelApiBackendManager', () => {
  it('offers the window browser check only to the window host, never a best-of-N attempt (M81)', async () => {
    const check = vi.fn<NonNullable<ModelApiBackendManagerDeps['browserCheck']>['check']>(() =>
      Promise.resolve({ ok: false, failure: { kind: 'runtimeMissing' } }),
    )
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      browserCheck: { check, extraHosts: () => [], isOffered: () => true },
    })
    const windowHost = await m.manager.ensureHost()
    const parent = await windowHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    m.api.script({ text: 'parent' })
    await parent.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(m.api.responseBodies()).toHaveLength(1)
    })
    expect(JSON.stringify(m.api.responseBodies()[0])).toContain('browser_check')
    const attemptHost = await m.manager.buildAttemptHost('/trial', () => undefined)
    const attempt = await attemptHost.startSession({
      workspaceRoot: '/trial',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const events: AgentEvent[] = []
    attempt.onEvent((event) => {
      events.push(event)
    })
    m.api.script(
      { calls: [{ name: 'browser_check', arguments: '{"url":"http://localhost:3000/"}' }] },
      { text: 'done' },
    )
    await attempt.sendTurn([{ type: 'text', text: 'check' }])
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
    })
    expect(JSON.stringify(m.api.responseBodies()[1])).not.toContain('browser_check')
    expect(check).not.toHaveBeenCalled()
    await attemptHost.close()
    await m.manager.dispose()
  })

  it('holds a manual revert across lazy startup and a same-id replacement without creating an own round', async () => {
    const m = manager('/ws')
    const entered = Promise.withResolvers<undefined>()
    const writing = Promise.withResolvers<undefined>()
    const added = vi.spyOn(m.manager.workspaceEdits, 'add')
    const review = new EditReview({
      workspaceRoot: '/ws',
      platform: 'linux',
      realPath: (file) => Promise.resolve(file),
      readFile: () => Promise.resolve('after\n'),
      hasUnsavedChanges: () => false,
      beginEdit: (file) => m.manager.beginExternalEdit(undefined, [file]),
      withAdmission: async (work) => await work(() => undefined),
      io: {
        writeFileIfUnchanged: async () => {
          entered.resolve(undefined)
          await writing.promise
          return 'written'
        },
        trashFileIfUnchanged: vi.fn(),
        createFileIfAbsent: vi.fn(),
      },
      openDiff: vi.fn(),
      log: m.log,
    })
    const patch =
      '{"files":[{"path":"notes.md","hunks":[{"oldStart":1,"newStart":1,"lines":["-before","+after"]}]}]}'
    const reverting = review.revert('i', patch)
    await entered.promise
    expect(m.manager.isRunning).toBe(false)
    expect(m.api.responseBodies()).toEqual([])
    const host = await m.manager.ensureHost()
    const options = { workspaceRoot: '/ws', modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
    const original = await host.startSession(options)
    original.dispose()
    const replacement = await host.startSession(options)
    expect(replacement.sessionId).toBe(original.sessionId)
    const ledger = added.mock.calls.at(-1)?.[0]
    if (!(ledger instanceof VerifyLedger) || !(replacement instanceof ModelApiSession)) {
      throw new TypeError('expected replacement source-module session and ledger')
    }
    const note = vi.spyOn(replacement, 'noteExternalEdit')
    ledger.resetForMessage()
    ledger.record('passed', ledger.snapshot('lint', 'project'))
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    writing.resolve(undefined)
    await reverting
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    expect(note).not.toHaveBeenCalled()
    expect(ledger.takeRoundEdits()).toEqual([])
    ledger.resetForMessage()
    ledger.record('passed', ledger.snapshot('lint', 'project'))
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(true)
    expect(m.api.responseBodies()).toEqual([])
    await m.manager.dispose()
  })

  it('M80 forwards only an explicitly provided stream idle interval to real client construction', async () => {
    const create = vi.spyOn(modelApiEntry, 'createModelApiHost')
    try {
      const api = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const manager = new ModelApiBackendManager(
        fakeManagerDeps(api, log, {
          workspaceRoot: '/ws',
          store: undefined,
          streamIdleMs: 37,
          bundlePath: 'src/host/backend/modelApiEntry.ts',
          loadBundle: () => modelApiEntry,
        }),
      )
      await manager.ensureHost()
      expect(create.mock.calls.at(-1)?.[0].client.streamIdleMs).toBe(37)
      await manager.dispose()
    } finally {
      create.mockRestore()
    }
  })
  it('keeps host-origin writes pending before the lazy host and newly live ledger exist', async () => {
    const m = manager('/ws')
    const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
    const complete = m.manager.beginExternalEdit(undefined, [file])
    expect(m.manager.isRunning).toBe(false)
    const added = vi.spyOn(m.manager.workspaceEdits, 'add')
    const host = await m.manager.ensureHost()
    await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    const ledger = added.mock.calls[0]?.[0]
    if (!(ledger instanceof VerifyLedger)) {
      throw new TypeError('new session did not join the shared ledger registry')
    }
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('cat .agents/plans/held.md')).toBe(true)
    const started = ledger.snapshot('lint', 'project')
    ledger.record('passed', started)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    complete(false)
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('cat .agents/plans/held.md')).toBe(false)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    await m.manager.dispose()
  })

  it.each([false, true])(
    'records a host-origin edit only for a true new-file result: %s',
    async (written) => {
      const m = manager('/ws')
      const host = await m.manager.ensureHost()
      const owner = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      if (!(owner instanceof ModelApiSession)) {
        throw new TypeError('expected source-module Model API owner')
      }
      const note = vi.spyOn(owner, 'noteExternalEdit')
      const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
      m.manager.beginExternalEdit(m.manager.captureExternalEditOwner(owner), [file])(written)
      expect(note).toHaveBeenCalledTimes(written ? 1 : 0)
      if (written) {
        expect(note).toHaveBeenCalledWith(file)
      }
      await m.manager.dispose()
    },
  )

  it.each([true, false])(
    'keeps the captured owner when the same id is revived (before begin: %s)',
    async (isBeforeBegin) => {
      const m = manager('/ws')
      const host = await m.manager.ensureHost()
      const options = { workspaceRoot: '/ws', modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
      const owner = await host.startSession(options)
      const captured = m.manager.captureExternalEditOwner(owner)
      expect(captured).toBeDefined()
      const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
      let complete = isBeforeBegin ? undefined : m.manager.beginExternalEdit(captured, [file])
      owner.dispose()
      const replacement = await host.startSession(options)
      if (!(replacement instanceof ModelApiSession)) {
        throw new TypeError('expected replacement Model API owner')
      }
      // The fixture reuses its id: object ownership must still distinguish the new session.
      expect(replacement.sessionId).toBe(owner.sessionId)
      const note = vi.spyOn(replacement, 'noteExternalEdit')
      complete ??= m.manager.beginExternalEdit(captured, [file])
      complete(true)
      expect(note).not.toHaveBeenCalled()
      await m.manager.dispose()
    },
  )

  it('reads hash-only account identity without a folder, bundle load or model request', async () => {
    const api = fakeModelApi()
    const loadBundle = vi.fn(() => modelApiEntry)
    const m = new ModelApiBackendManager(
      fakeManagerDeps(api, new FakeLogOutputChannel(), {
        workspaceRoot: undefined,
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle,
      }),
    )
    expect(await m.accountId()).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    expect(m.isRunning).toBe(false)
    expect(loadBundle).not.toHaveBeenCalled()
    expect(api.requests).toEqual([])
    await m.dispose()
  })

  it('loads no hook command until the machine opt-in is on', async () => {
    const files = new Map([
      [
        '/cfg/muse/settings.json',
        JSON.stringify({
          schema_version: 1,
          hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'say' }] }] },
        }),
      ],
    ])
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const disabled = managerOn('/ws', undefined, new FakeLogOutputChannel(), {
      enabled: false,
      files,
      runHook,
    })
    const disabledHost = await disabled.manager.ensureHost()
    await disabledHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(runHook).not.toHaveBeenCalled()

    const enabled = managerOn('/ws', undefined, new FakeLogOutputChannel(), {
      enabled: true,
      files,
      runHook,
    })
    const enabledHost = await enabled.manager.ensureHost()
    await enabledHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(runHook).toHaveBeenCalledOnce()
  })

  it('logs a hook file the loader refuses, under Hooks (M51)', async () => {
    const log = new FakeLogOutputChannel()
    const m = managerOn('/ws', undefined, log, {
      enabled: true,
      files: new Map([['/cfg/muse/settings.json', '{ not json']]),
      runHook: vi.fn(),
    })
    const host = await m.manager.ensureHost()
    await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(log.warn).toHaveBeenCalledWith(
      'Hooks: settings.json: invalid JSON; user and managed hooks are off',
    )
  })

  it('hands the host the packing setting, read when each conversation starts (M73)', async () => {
    let isPacking = false
    let ids = 0
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      isObservationPackingOn: () => isPacking,
      newId: () => {
        ids += 1
        return `id-${String(ids)}`
      },
    })
    const host = await m.manager.ensureHost()
    const start = async () => {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      if (!(session instanceof ModelApiSession)) {
        throw new TypeError('expected the Model API session')
      }
      return session
    }
    // A packing conversation keeps a ledger with its session; one that
    // does not pack has none.
    const before = await start()
    isPacking = true
    const after = await start()
    expect(before.snapshot().packedTokensAvoided).toBeUndefined()
    expect(after.snapshot().packedTokensAvoided).toBe(0)
    await m.manager.dispose()
    // The default, with no setting handed over, packs nothing.
    const plain = manager('/ws')
    const plainHost = await plain.manager.ensureHost()
    const session = await plainHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(session instanceof ModelApiSession ? session.snapshot().packedTokensAvoided : 0).toBe(
      undefined,
    )
    await plain.manager.dispose()
  })

  it('creates one host per window, lists its models, and forgets it on dispose', async () => {
    const m = manager('/ws')
    expect(m.manager.isRunning).toBe(false)
    const host = await m.manager.ensureHost()
    expect(await m.manager.ensureHost()).toBe(host)
    expect(m.manager.isRunning).toBe(true)
    expect(host.info).toMatchObject({ kind: 'modelApi', serverName: 'meta-model-api' })
    const models = await host.listModels()
    expect(models.map((model) => model.modelId)).toEqual([
      'muse-spark-1.3',
      'muse-spark-1.3-contributor',
      'muse-spark-1.2',
    ])
    expect(m.api.requests[0]?.headers['Authorization']).toBe('Bearer LLM|1|secret')
    await m.manager.dispose()
    expect(m.manager.isRunning).toBe(false)
    expect(m.log.info).toHaveBeenCalledWith(expect.stringContaining('Model API backend ready'))
  })

  it('gives the host its MCP servers for the workspace, shows their state, stops them (M50)', async () => {
    const servers = fakeMcpSource([])
    const roots: string[] = []
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      createMcpServers: (root) => {
        roots.push(root)
        return servers
      },
      ideTools: [],
    })
    expect(m.manager.mcpSnapshot()).toBeUndefined()
    await m.manager.ensureHost()
    expect(roots).toEqual(['/ws'])
    expect(m.manager.mcpSnapshot()).toBe(servers.snapshotValue)
    await m.manager.dispose()
    expect(servers.isClosed).toBe(true)
  })

  it("makes the host's MCP servers with the bundle's own pool (M50, M57)", async () => {
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      createMcpServers: (root, newPool) =>
        newPool({
          readSettings: () => ({ status: 'missing' }),
          lookupEnv: () => undefined,
          isWorkspaceTrusted: () => true,
          workspaceRoot: root,
          platform: 'linux',
          spawn: () => {
            throw new Error('no server is configured')
          },
          fetch: () => Promise.reject(new Error('no server is configured')),
          clientVersion: '0.0.0',
          log: new FakeLogOutputChannel(),
        }),
    })
    await m.manager.ensureHost()
    expect(m.manager.mcpSnapshot()).toEqual({ isStarted: false, fault: undefined, servers: [] })
    await m.manager.dispose()
  })

  it('refuses to start without a workspace', async () => {
    await expect(manager(undefined).manager.ensureHost()).rejects.toThrow('Open a folder first')
  })

  it('builds one host for concurrent callers, after the stored sessions are read (D25)', async () => {
    let lists = 0
    const store = {
      list: async () => {
        lists += 1
        await Promise.resolve()
        return []
      },
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    const [first, second] = await Promise.all([m.ensureHost(), m.ensureHost()])
    expect(second).toBe(first)
    expect(lists).toBe(1)
  })

  it('forgets a failed build so the next call tries again (D25)', async () => {
    let isBroken = true
    const store = {
      list: () => (isBroken ? Promise.reject(new Error('disk gone')) : Promise.resolve([])),
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    await expect(m.ensureHost()).rejects.toThrow('disk gone')
    expect(m.isRunning).toBe(false)
    isBroken = false
    await expect(m.ensureHost()).resolves.toBeDefined()
  })

  it('closes a host whose build a dispose overtook, and builds anew after (D25)', async () => {
    const listed = Promise.withResolvers<[]>()
    const servers = fakeMcpSource([])
    const m = managerOn(
      '/ws',
      {
        list: () => listed.promise,
        load: () => Promise.resolve(undefined),
        save: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      new FakeLogOutputChannel(),
      undefined,
      { createMcpServers: () => servers },
    )
    const overtaken = m.manager.ensureHost()
    await m.manager.dispose()
    expect(m.manager.isRunning).toBe(false)
    listed.resolve([])
    await expect(overtaken).rejects.toThrow('stopped while it was starting')
    expect(servers.isClosed).toBe(true)
    expect(m.manager.isRunning).toBe(false)
    await m.manager.refreshSkills()
    const host = await m.manager.ensureHost()
    await expect(m.manager.ensureHost()).resolves.toBe(host)
    await m.manager.refreshSkills()
  })
})

/** A manager over a given session store, for the build-once cases. */
function managerWith(overrides: { store: SessionStore }) {
  return managerOn('/ws', overrides.store).manager
}

it('records best-of-N requests once with the attempt kind and its own session', async () => {
  const api = fakeModelApi()
  const recording: UsageRecording = {
    note: vi.fn(),
    limit: vi.fn(),
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, new FakeLogOutputChannel(), {
      workspaceRoot: '/ws',
      sessionBudgetUsd: () => 0,
      usageRecording: recording,
      bundlePath: 'source',
      loadBundle: () => modelApiEntry,
    }),
  )
  const host = await manager.buildAttemptHost('/attempt', () => undefined)
  try {
    const session = await host.startSession({
      workspaceRoot: '/attempt',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const turns = watchSessionTurns(session)
    api.script({ text: 'attempt result' })
    await session.sendTurn([{ type: 'text', text: 'try' }])
    await turns.turnDone()
    expect(recording.note).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ kind: 'bestOfN', session: session.sessionId }),
    )
  } finally {
    await host.close()
    await manager.dispose()
  }
})
