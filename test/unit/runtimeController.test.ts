import { mkdtemp, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type * as ConversationBundle from '../../src/host/conversation/conversationBundle'
import type { AuthPort, AuthSnapshot } from '../../src/host/auth/authService'
import type { SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import { pdfFixture } from './helpers/pdfFixture'
import { commandApproval } from './helpers/acpWaits'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { ControllerRegistry } from '../../src/runtime/panel/controllerRegistry'
import { RuntimeConversation } from '../../src/runtime/panel/runtimeController'
import {
  type RuntimeConversationPorts,
  runtimeConversationDeps,
  runtimeSettings,
} from '../../src/runtime/panel/runtimeFeatures'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { fakePanelRuntime } from './helpers/runtimePanel'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { FakeAgentHost } from './helpers/fakeAgent'
import { buildHostBundles } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const creation = vi.hoisted(() => ({
  dispose: vi.fn(),
  restore: vi.fn(),
  started: 0,
  release: () => {
    /* Default fake creation has no concurrent release. */
  },
}))
vi.mock('../../src/host/conversation/conversationBundle', async (original) => {
  const actual = await original<typeof ConversationBundle>()
  return {
    ...actual,
    conversationLoader: (...args: Parameters<typeof actual.conversationLoader>) => {
      const load = actual.conversationLoader(...args)
      return () => ({
        createConversation: (
          ...params: Parameters<ReturnType<typeof load>['createConversation']>
        ) => {
          const controller = load().createConversation(...params)
          creation.started += 1
          creation.dispose = vi.spyOn(controller, 'dispose')
          creation.restore = vi.spyOn(controller, 'restoreSession')
          creation.release()
          return controller
        },
      })
    },
  }
})

const rig = { root: '' }
beforeAll(async () => {
  rig.root = await realpath(await mkdtemp(path.join(tmpdir(), 'm104-lifetime-')))
  await buildHostBundles(rig.root, {
    conversation: path.resolve('src/host/conversation/conversationEntry.ts'),
  })
})
afterAll(async () => {
  await removeFolder(rig.root)
})

function runGit(): Promise<never> {
  return Promise.reject(new Error('fake refuses git'))
}

async function setup(kind: 'museCode' | 'modelApi' = 'museCode') {
  const options: ServeOptions = {
    backend: kind,
    trustWorkspace: false,
    museBinary: '',
    shellSandbox: 'off',
    canBypass: false,
    allowsContributorModels: false,
    paidFeatures: [],
    isVerbose: false,
  }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const runtime = fakePanelRuntime({
    options,
    distDir: rig.root,
    homeDir: rig.root,
    runGit,
    log,
  })
  const host = new FakeAgentHost()
  host.info = { ...host.info, kind }
  const session = await host.startSession({
    workspaceRoot: rig.root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'manual',
  })
  const loaded = { ...(await host.resumeSession(session.sessionId, session.modelId)), session }
  const store = new RuntimeSettingsStore(rig.root, rig.root)
  const settings = await runtimeSettings(store, log)
  const conversation = new RuntimeConversation(session, host, log, vi.fn())
  const ports = {
    host: {
      request: () => Promise.reject(new Error('fake host service unavailable')),
      notify: vi.fn(),
    },
    runtime: {
      ...runtime,
      backend: {
        kind,
        readiness: () => Promise.resolve({ state: 'ready' as const }),
        hostFor: () => Promise.resolve(host),
      },
    },
    options,
    store,
    settings,
    workspaceRoot: rig.root,
    ownsPaidConsent: false,
    ownsSettings: true,
    controllers: () => [],
    runGit,
    selection: () => null,
    documents: () => [],
    log,
  }
  return {
    runtime,
    host,
    session,
    loaded,
    store,
    conversation,
    ports,
    bundle: path.join(rig.root, 'conversation.js'),
  }
}

for (const kind of ['museCode', 'modelApi'] as const) {
  it(`${kind}: contributed host admission refuses preparation through the real portable controller`, async () => {
    const t = await setup(kind)
    const ensureHost = vi.fn(() => Promise.reject(new Error('Fake contributed host unavailable')))
    const registry = new ControllerRegistry<RuntimeConversation>(t.ports.log)
    t.host.listModels.mockClear()
    try {
      await expect(
        registry.adopt(
          t.host,
          t.session,
          registry.claimSession(t.session.sessionId),
          () => t.conversation,
          (controller) =>
            controller.prepare(
              {
                ...t.ports,
                factories: { engines: () => Promise.resolve({ features: { ensureHost } }) },
              },
              t.loaded,
              t.bundle,
              runtimeConversationDeps,
            ),
        ),
      ).rejects.toThrow('MHP_PANEL_SESSION_ADOPTION_FAILED')
      expect(ensureHost).toHaveBeenCalledOnce()
      expect(t.host.listModels).not.toHaveBeenCalled()
      expect(registry.held(t.session.sessionId)).toBeUndefined()
      expect(t.session.dispose).toHaveBeenCalledOnce()
      expect(t.ports.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Fake contributed host unavailable'),
      )
    } finally {
      await registry.close()
      await t.runtime.close()
    }
  })

  it(`${kind}: selected hosts reach adoption and login warm-up while ACP binding fences remain`, async () => {
    const t = await setup(kind)
    const first = new FakeAgentHost()
    first.info = { ...first.info, kind }
    const next = new FakeAgentHost()
    next.info = { ...next.info, kind }
    let selected = first
    const ensureHost = vi.fn(() => Promise.resolve(selected))
    const snapshot: AuthSnapshot = { status: 'signedIn', backend: kind, detail: undefined }
    const auth: AuthPort = {
      current: snapshot,
      backend: kind,
      admissionGeneration: 1,
      toMessage: () => ({ type: 'authState', status: snapshot.status, backend: kind }),
      signIn: vi.fn(() => Promise.resolve(snapshot)),
      installMuseCode: () => Promise.reject(new Error('Fake installer unavailable')),
      cancelSignIn: vi.fn(),
      signOut: () => Promise.reject(new Error('Fake sign-out unavailable')),
      refresh: () => Promise.resolve(snapshot),
      checkAgain: vi.fn(() => Promise.resolve(snapshot)),
      markAuthRequired: () => snapshot,
      markBackendError: () => snapshot,
    }
    const fork = vi.spyOn(first, 'forkSession')
    const list = vi.spyOn(first, 'onSessionListEvent')
    t.host.listModels.mockClear()
    try {
      await t.conversation.prepare(
        {
          ...t.ports,
          factories: { engines: () => Promise.resolve({ features: { auth, ensureHost } }) },
        },
        t.loaded,
        t.bundle,
        runtimeConversationDeps,
        'manual',
      )
      expect(ensureHost).toHaveBeenCalledOnce()
      expect(first.listModels).toHaveBeenCalledWith(t.session.sessionId)
      expect(t.host.listModels).not.toHaveBeenCalled()
      expect(t.conversation.controller?.boardSession()?.sessionId).toBe(t.session.sessionId)
      expect(first.resumeSession).not.toHaveBeenCalled()
      expect(t.conversation.host).toBe(t.host)
      await t.conversation.handle({ type: 'forkSession' })
      await t.conversation.handle({ type: 'resumeSession', sessionId: 'unowned' })
      expect(fork).not.toHaveBeenCalled()
      expect(first.resumeSession).not.toHaveBeenCalled()
      expect(list).toHaveBeenCalledTimes(2)

      await t.conversation.handle({ type: 'retryBackend' })
      selected = next
      await t.conversation.handle({ type: 'signIn', method: 'browser' })
      await vi.waitFor(() => {
        expect(next.listModels).toHaveBeenCalledOnce()
      })
      expect(auth.checkAgain).toHaveBeenCalledOnce()
      expect(auth.signIn).toHaveBeenCalledWith('browser')
      expect(t.host.listModels).not.toHaveBeenCalled()
      await expect(t.conversation.controller?.startFreshSession()).rejects.toThrow(
        'MHP_PANEL_BINDING_MISMATCH',
      )
      expect(next.startSession).not.toHaveBeenCalled()
      expect(next.resumeSession).not.toHaveBeenCalled()
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })

  it(`${kind}: absent host contributions retain the runtime's honest refusal`, async () => {
    const t = await setup(kind)
    const hostFor = vi.fn(() => Promise.reject(new Error('Fake runtime host unavailable')))
    t.host.listModels.mockClear()
    try {
      await expect(
        t.conversation.prepare(
          {
            ...t.ports,
            runtime: { ...t.ports.runtime, backend: { ...t.ports.runtime.backend, hostFor } },
          },
          t.loaded,
          t.bundle,
          runtimeConversationDeps,
        ),
      ).rejects.toThrow('MHP_PANEL_SESSION_ADOPTION_FAILED')
      expect(hostFor).toHaveBeenCalledWith(rig.root)
      expect(t.host.listModels).not.toHaveBeenCalled()
      expect(t.conversation.controller?.boardSession()).toBeUndefined()
      expect(t.ports.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Fake runtime host unavailable'),
      )
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })
}

it('release waits for contributed host admission and fences its late result before model reads', async () => {
  const t = await setup()
  const entered = Promise.withResolvers<boolean>()
  const proceed = Promise.withResolvers<boolean>()
  const settled = vi.spyOn(t.store, 'settled')
  const ensureHost = async () => {
    entered.resolve(true)
    await proceed.promise
    return t.host
  }
  t.host.listModels.mockClear()
  try {
    const preparing = t.conversation.prepare(
      {
        ...t.ports,
        factories: { engines: () => Promise.resolve({ features: { ensureHost } }) },
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    const refused = expect(preparing).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    await entered.promise
    const releasing = t.conversation.release()
    expect(settled).not.toHaveBeenCalled()
    proceed.resolve(true)
    await Promise.all([refused, releasing])
    expect(t.host.listModels).not.toHaveBeenCalled()
    expect(t.session.dispose).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  } finally {
    proceed.resolve(true)
    await t.conversation.release()
    await t.runtime.close()
  }
})

it('release fences suspended composition and concurrent callers await the final drain', async () => {
  const t = await setup()
  const entered = Promise.withResolvers<boolean>()
  const proceed = Promise.withResolvers<boolean>()
  const creations = creation.started
  const settled = vi.spyOn(t.store, 'settled')
  const preparing = t.conversation.prepare(t.ports, t.loaded, t.bundle, async (ports) => {
    entered.resolve(true)
    await proceed.promise
    return await runtimeConversationDeps(ports)
  })
  const refused = expect(preparing).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
  await entered.promise
  const released = vi.fn()
  const first = (async () => {
    await t.conversation.release()
    released()
  })()
  const second = (async () => {
    await t.conversation.release()
    released()
  })()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  expect(released).not.toHaveBeenCalled()
  expect(settled).not.toHaveBeenCalled()
  proceed.resolve(true)
  await Promise.all([refused, first, second])
  expect(creation.started).toBe(creations)
  expect(t.conversation.controller).toBeUndefined()
  expect(t.session.dispose).toHaveBeenCalledOnce()
  expect(settled).toHaveBeenCalledOnce()
  await t.runtime.close()
})

it('release waits for an admitted replay before the final storage drain', async () => {
  const t = await setup()
  await t.conversation.prepare(t.ports, t.loaded, t.bundle, runtimeConversationDeps)
  const reply = Promise.withResolvers<boolean>()
  const entered = Promise.withResolvers<boolean>()
  vi.spyOn(t.host, 'readSession').mockImplementation(async () => {
    entered.resolve(true)
    await reply.promise
    throw new Error('fake replay failed')
  })
  const settled = vi.spyOn(t.store, 'settled')
  const received = vi.fn<(message: HostToWebviewMessage) => void>()
  t.conversation.subscribe(received)
  const handling = expect(
    t.conversation.handle({ type: 'ready', attachmentEpoch: 1 }),
  ).rejects.toThrow('fake replay failed')
  await entered.promise
  const releasing = t.conversation.release()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  expect(settled).not.toHaveBeenCalled()
  reply.resolve(true)
  await Promise.all([handling, releasing])
  expect(received.mock.calls.some(([message]) => message.type === 'historyLoaded')).toBe(false)
  expect(settled).toHaveBeenCalledOnce()
  await t.runtime.close()
})

it('disposes a controller created during a reentrant release', async () => {
  const t = await setup()
  creation.release = () => {
    void t.conversation.release()
  }
  try {
    await expect(
      t.conversation.prepare(t.ports, t.loaded, t.bundle, runtimeConversationDeps),
    ).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    await t.conversation.release()
    expect(creation.restore).not.toHaveBeenCalled()
    expect(creation.dispose).toHaveBeenCalledOnce()
    expect(t.conversation.controller).toBeUndefined()
  } finally {
    creation.release = () => {
      /* No concurrent release in other fake scenarios. */
    }
    await t.runtime.close()
  }
})

for (const kind of ['museCode', 'modelApi'] as const) {
  it(`${kind}: new, fork and switch transfer ownership before new-session output`, async () => {
    const t = await setup(kind)
    const registry = new ControllerRegistry<RuntimeConversation>(t.ports.log)
    registry.watch(t.host)
    const changes: string[] = []
    const emitted: HostToWebviewMessage[] = []
    const ports = {
      ...t.ports,
      sessionChanged: (previousId: string, sessionId: string) => {
        registry.rebind(previousId, sessionId, t.conversation)
        changes.push(sessionId)
        return Promise.resolve()
      },
    }
    try {
      await registry.adopt(
        t.host,
        t.session,
        registry.claimSession(t.session.sessionId),
        () => t.conversation,
        (controller) => controller.prepare(ports, t.loaded, t.bundle, runtimeConversationDeps),
      )
      t.conversation.subscribe((message) => {
        if (message.type === 'historyLoaded')
          expect(registry.held(message.sessionId)).toBe(t.conversation)
        emitted.push(message)
      })
      await t.conversation.handle({ type: 'clearConversation' })
      const fresh = t.conversation.sessionId
      expect(fresh).not.toBe(t.session.sessionId)
      expect(registry.held(t.session.sessionId)).toBeUndefined()
      expect(registry.held(fresh)).toBe(t.conversation)
      vi.spyOn(t.host, 'forkSession').mockImplementation(() =>
        t.host.resumeSession('forked', 'muse-spark-1.3'),
      )
      await t.conversation.handle({ type: 'forkSession' })
      expect(t.conversation.sessionId).toBe('forked')
      expect(registry.held(fresh)).toBeUndefined()
      await t.conversation.handle({ type: 'resumeSession', sessionId: 'switched' })
      expect(t.conversation.sessionId).toBe('switched')
      expect(changes).toEqual([fresh, 'forked', 'switched'])
      expect(emitted.filter((message) => message.type === 'historyLoaded').length).toBe(2)
      expect(t.session.sendTurn).not.toHaveBeenCalled()
    } finally {
      await registry.close()
      await t.runtime.close()
    }
  })

  it(`${kind}: replay retains rich history, the active turn and imported restrictions`, async () => {
    const t = await setup(kind)
    const rich: SessionHistoryOutcome = {
      mode: 'inline' as const,
      name: 'restored',
      items: [
        {
          itemId: 'user',
          kind: 'userMessage',
          status: 'completed',
          text: 'hello',
          turnId: 'running',
          attachments: [{ type: 'image', mediaType: 'image/png', width: 1, height: 1 }],
        },
        {
          itemId: 'compaction',
          kind: 'compaction',
          status: 'completed',
          fallbackText: 'Restored compacted context',
        },
      ],
      todos: [],
      sideChat: true,
      goal: {
        status: 'future-status',
        objective: 'retain unknown goal status',
        percentComplete: 100,
      },
    }
    const loaded = {
      ...t.loaded,
      record: { ...t.loaded.record, imported: true },
      history: rich,
      activeTurnId: 'running',
    }
    const messages: HostToWebviewMessage[] = []
    try {
      await t.conversation.prepare(t.ports, loaded, t.bundle, runtimeConversationDeps)
      vi.spyOn(t.host, 'readSession').mockResolvedValue(rich)
      t.conversation.subscribe((message) => {
        messages.push(message)
      })
      await t.conversation.handle({ type: 'ready', attachmentEpoch: 1 })
      expect(messages.find((message) => message.type === 'historyLoaded')).toMatchObject({
        sessionId: t.session.sessionId,
        activeTurnId: 'running',
        imported: true,
        sideChat: true,
        goal: rich.goal,
        items: rich.items,
      })
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })
}

it('consumes typed engine/presentation actions and awaits their cleanup before the final drain', async () => {
  const t = await setup()
  const engine = vi.fn(() => Promise.resolve())
  const presentation = vi.fn(() => Promise.resolve())
  const disposal = Promise.withResolvers<boolean>()
  const entered = Promise.withResolvers<boolean>()
  const settled = vi.spyOn(t.store, 'settled')
  try {
    await t.conversation.prepare(
      {
        ...t.ports,
        factories: {
          engines: (context) => {
            context.own(async () => {
              entered.resolve(true)
              await disposal.promise
            })
            return Promise.resolve({ features: {}, actions: { manageSkills: engine } })
          },
          presentation: () =>
            Promise.resolve({ features: {}, actions: { showMemory: presentation } }),
        },
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    await t.conversation.handle({ type: 'hostAction', action: 'manageSkills' })
    await t.conversation.handle({ type: 'hostAction', action: 'showMemory' })
    expect(engine).toHaveBeenCalledOnce()
    expect(presentation).toHaveBeenCalledOnce()
    const releasing = t.conversation.release()
    await entered.promise
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    expect(settled).not.toHaveBeenCalled()
    disposal.resolve(true)
    await releasing
    expect(settled).toHaveBeenCalledOnce()
  } finally {
    disposal.resolve(true)
    await t.conversation.release()
    await t.runtime.close()
  }
})

it('auxiliary views share the conversation release barrier and reject stale bindings', async () => {
  const t = await setup()
  const entered = Promise.withResolvers<boolean>()
  const proceed = Promise.withResolvers<boolean>()
  const settled = vi.spyOn(t.store, 'settled')
  const binding = { sessionId: t.session.sessionId, surface: 'aux', surfaceKind: 'usage' as const }
  try {
    await t.conversation.prepare(
      {
        ...t.ports,
        factories: {
          presentation: () =>
            Promise.resolve({
              features: {},
              view: () => ({
                handle: async () => {
                  entered.resolve(true)
                  await proceed.promise
                },
                subscribe: () => vi.fn(),
              }),
            }),
        },
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    expect(t.conversation.view({ ...binding, sessionId: 'other' })).toBeUndefined()
    const view = t.conversation.view(binding)
    if (view === undefined) throw new Error('Missing fake auxiliary view')
    const handling = view.handle({ type: 'ready' })
    await entered.promise
    const releasing = t.conversation.release()
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    expect(settled).not.toHaveBeenCalled()
    await expect(view.handle({ type: 'ready' })).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    proceed.resolve(true)
    await handling
    await releasing
    expect(settled).toHaveBeenCalledOnce()
  } finally {
    proceed.resolve(true)
    await t.conversation.release()
    await t.runtime.close()
  }
})

for (const kind of ['museCode', 'modelApi'] as const)
  it(`${kind}: a portable side-chat surface retains Plan-only admission`, async () => {
    const t = await setup(kind)
    const messages: HostToWebviewMessage[] = []
    try {
      await t.conversation.prepare(
        { ...t.ports, isSideChat: true },
        {
          ...t.loaded,
          record: { ...t.loaded.record, ...(kind === 'modelApi' && { sideChat: true }) },
        },
        t.bundle,
        runtimeConversationDeps,
      )
      vi.spyOn(t.host, 'readSession').mockResolvedValue(t.loaded.history)
      t.conversation.subscribe((message) => {
        messages.push(message)
      })
      await t.conversation.handle({ type: 'setPermissionMode', mode: 'manual' })
      await t.conversation.handle({ type: 'ready' })
      expect(messages.findLast((message) => message.type === 'composerState')).toMatchObject({
        permissionMode: 'plan',
      })
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })

it('drains every factory cleanup and the store before reporting a synchronous cleanup failure', async () => {
  const t = await setup()
  const other = vi.fn(() => Promise.resolve())
  const settled = vi.spyOn(t.store, 'settled')
  try {
    await t.conversation.prepare(
      {
        ...t.ports,
        factories: {
          engines: (context) => {
            context.own(() => {
              throw new Error('Fake cleanup failure')
            })
            context.own(other)
            return Promise.resolve({ features: {} })
          },
        },
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    await expect(t.conversation.release()).rejects.toThrow('MHP_COMPOSITION_RELEASE_FAILED')
    expect(other).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  } finally {
    await t.runtime.close()
  }
})

it('refuses conflicting action ownership and missing capability records without success placeholders', async () => {
  const t = await setup()
  const action = vi.fn(() => Promise.resolve())
  const dispose = vi.fn(() => Promise.resolve())
  try {
    await expect(
      t.conversation.prepare(
        {
          ...t.ports,
          factories: {
            engines: (context) => {
              context.own(dispose)
              return Promise.resolve({ features: {}, actions: { manageSkills: action } })
            },
            presentation: async (context) => {
              await expect(context.requireModelCapabilities()).rejects.toThrow(
                'MHP_MODEL_CAPABILITIES_UNAVAILABLE',
              )
              return { features: {}, actions: { manageSkills: action } }
            },
          },
        },
        t.loaded,
        t.bundle,
        runtimeConversationDeps,
      ),
    ).rejects.toThrow('MHP_COMPOSITION_ACTION_CONFLICT')
    await t.conversation.release()
    expect(dispose).toHaveBeenCalledOnce()
  } finally {
    await t.conversation.release()
    await t.runtime.close()
  }
})

for (const kind of ['museCode', 'modelApi'] as const)
  it(`${kind}: selected-model capabilities gate compaction without a provider-name shortcut`, async () => {
    const t = await setup(kind)
    let isAllowed = false
    let isCurrentModel = false
    const selectedModel = () =>
      Promise.resolve({
        providerId: 'unrelated-vendor',
        modelId: isCurrentModel ? t.conversation.modelId : 'old-model',
        capabilities: new Set(isAllowed ? ['compaction', 'reasoningEffort'] : []),
      })
    try {
      await t.conversation.prepare(
        { ...t.ports, selectedModel },
        t.loaded,
        t.bundle,
        runtimeConversationDeps,
      )
      await t.conversation.handle({ type: 'compact' })
      await t.conversation.handle({ type: 'setThinking', enabled: false })
      expect(t.session.compact).not.toHaveBeenCalled()
      expect(t.session.setReasoningEffort).not.toHaveBeenCalled()
      isAllowed = true
      await t.conversation.handle({ type: 'compact' })
      expect(t.session.compact).not.toHaveBeenCalled()
      isCurrentModel = true
      await t.conversation.handle({ type: 'compact' })
      expect(t.session.compact).toHaveBeenCalledOnce()
      await t.conversation.handle({ type: 'setThinking', enabled: false })
      expect(t.session.setReasoningEffort).toHaveBeenCalledOnce()
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })

function pickerHost(picked: () => string[]): RuntimeConversationPorts['host'] {
  return {
    request: (method) =>
      Promise.resolve(parseMhpResult(method, { jsonrpc: '2.0', id: 1, result: picked() }).result),
    notify: vi.fn(),
  }
}

it('picks only indexed workspace files through the shared host picker and retains the resulting text part', async () => {
  const t = await setup('modelApi')
  const messages: HostToWebviewMessage[] = []
  await writeFile(path.join(rig.root, 'attach.txt'), 'Fake attached contents')
  try {
    await t.conversation.prepare(
      {
        ...t.ports,
        options: { ...t.ports.options, trustWorkspace: true },
        settings: {
          ...t.ports.settings,
          current: () => ({ ...t.ports.settings.current(), autosave: false }),
        },
        host: pickerHost(() => ['attach.txt']),
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    t.conversation.subscribe((message) => {
      messages.push(message)
    })
    await t.conversation.handle({ type: 'pickFile' })
    const added = messages.find((message) => message.type === 'attachmentAdded')
    expect(added).toMatchObject({ attachment: { name: 'attach.txt', mediaType: 'text/plain' } })
    if (added?.type !== 'attachmentAdded') throw new Error('Missing fake attachment')
    await t.conversation.handle({
      type: 'sendMessage',
      localId: 'rich',
      text: 'Use this file',
      attachmentIds: [added.attachment.id],
    })
    expect(
      t.host.sessions[0]?.sendTurn.mock.calls
        .at(-1)?.[0]
        .some((part) => part.type === 'textFile' && part.text.includes('Fake attached contents')),
    ).toBe(true)
  } finally {
    await t.conversation.release()
    await t.runtime.close()
  }
})

for (const kind of ['museCode', 'modelApi'] as const)
  it(`${kind}: a pending handoff survives portable reload until the user confirms a fresh-session transfer`, async () => {
    const t = await setup(kind)
    const messages: HostToWebviewMessage[] = []
    let isAllowed = false
    let history: SessionHistoryOutcome = {
      mode: 'inline',
      name: undefined,
      items: [{ itemId: 'user', kind: 'userMessage', status: 'completed', text: 'Earlier work' }],
      todos: [],
    }
    try {
      await t.conversation.prepare(
        {
          ...t.ports,
          selectedModel: () =>
            Promise.resolve({
              providerId: 'fake-vendor',
              modelId: t.conversation.modelId,
              capabilities: new Set(isAllowed ? ['handoff'] : []),
            }),
          sessionChanged: () => Promise.resolve(),
        },
        t.loaded,
        t.bundle,
        runtimeConversationDeps,
      )
      vi.spyOn(t.host, 'readSession').mockImplementation(() => Promise.resolve(history))
      t.conversation.subscribe((message) => {
        messages.push(message)
      })
      await t.conversation.handle({ type: 'requestHandoff', requestId: 'denied-handoff' })
      expect(messages).toContainEqual({
        type: 'handoffCommandResult',
        requestId: 'denied-handoff',
        accepted: false,
      })
      expect(t.session.sendTurn).not.toHaveBeenCalled()
      isAllowed = true
      await t.conversation.handle({ type: 'requestHandoff', requestId: 'handoff' })
      history = {
        ...history,
        items: [
          ...history.items,
          {
            itemId: 'brief',
            kind: 'agentMessage',
            status: 'completed',
            turnId: 'turn-1',
            text: '## Goal\nContinue earlier work',
          },
        ],
      }
      const session = t.host.sessions[0]
      if (session === undefined) throw new Error('Missing fake session')
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await vi.waitFor(() => {
        expect(messages.some((message) => message.type === 'handoffReady')).toBe(true)
      })
      messages.length = 0
      await t.conversation.handle({ type: 'ready', attachmentEpoch: 1 })
      expect(messages.find((message) => message.type === 'handoffReady')).toMatchObject({
        requestId: 'handoff',
        brief: '## Goal\nContinue earlier work',
      })
      await t.conversation.handle({
        type: 'confirmHandoff',
        requestId: 'handoff',
        brief: 'Confirmed brief',
      })
      expect(t.conversation.sessionId).not.toBe(t.session.sessionId)
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })

it('keeps an untrusted text selection as a path mention and rejects picker IDs outside the index', async () => {
  const t = await setup()
  await writeFile(path.join(rig.root, 'attach.txt'), 'Untrusted ordinary text\n'.repeat(1000))
  let selected = 'attach.txt'
  const messages: HostToWebviewMessage[] = []
  try {
    await t.conversation.prepare(
      {
        ...t.ports,
        host: pickerHost(() => [selected]),
      },
      t.loaded,
      t.bundle,
      runtimeConversationDeps,
    )
    t.conversation.subscribe((message) => {
      messages.push(message)
    })
    await t.conversation.handle({ type: 'pickFile' })
    expect(messages).toContainEqual({ type: 'insertText', text: '@attach.txt ' })
    expect(messages.some((message) => message.type === 'attachmentAdded')).toBe(false)
    messages.length = 0
    selected = '../outside.txt'
    await t.conversation.handle({ type: 'pickFile' })
    expect(
      messages.some(
        (message) =>
          message.type === 'notice' && message.text.includes('MHP_UNSUPPORTED_CAPABILITY'),
      ),
    ).toBe(true)
  } finally {
    await t.conversation.release()
    await t.runtime.close()
  }
})

for (const kind of ['museCode', 'modelApi'] as const) {
  it(`${kind}: vision and PDF admission use the selected capability record`, async () => {
    const t = await setup(kind)
    const messages: HostToWebviewMessage[] = []
    let canUseMedia = false
    const image = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      1, 0, 0, 0, 1,
    ])
    try {
      await t.conversation.prepare(
        {
          ...t.ports,
          selectedModel: () =>
            Promise.resolve({
              providerId: 'another-vendor',
              modelId: t.conversation.modelId,
              capabilities: new Set(canUseMedia ? ['vision', 'pdf'] : []),
            }),
        },
        t.loaded,
        t.bundle,
        runtimeConversationDeps,
      )
      t.conversation.subscribe((message) => {
        messages.push(message)
      })
      await t.conversation.handle({
        type: 'attachImageData',
        requestId: 'denied-image',
        name: 'image.png',
        mediaType: 'image/png',
        base64: Buffer.from(image).toString('base64'),
      })
      await t.conversation.handle({
        type: 'attachImageData',
        requestId: 'denied-pdf',
        name: 'document.pdf',
        mediaType: 'application/pdf',
        base64: Buffer.from(pdfFixture(1)).toString('base64'),
      })
      expect(messages.some((message) => message.type === 'attachmentAdded')).toBe(false)
      expect(
        messages
          .filter((message) => message.type === 'attachmentRejected')
          .map((message) => message.requestId),
      ).toEqual(['denied-image', 'denied-pdf'])
      canUseMedia = true
      await t.conversation.handle({
        type: 'attachImageData',
        name: 'image.png',
        mediaType: 'image/png',
        base64: Buffer.from(image).toString('base64'),
      })
      await t.conversation.handle({
        type: 'attachImageData',
        name: 'document.pdf',
        mediaType: 'application/pdf',
        base64: Buffer.from(pdfFixture(1)).toString('base64'),
      })
      expect(messages.filter((message) => message.type === 'attachmentAdded')).toHaveLength(2)
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })

  it(`${kind}: shared approvals and questions retain exact IDs and choices through the portable controller`, async () => {
    const t = await setup(kind)
    const messages: HostToWebviewMessage[] = []
    try {
      await t.conversation.prepare(t.ports, t.loaded, t.bundle, runtimeConversationDeps)
      t.conversation.subscribe((message) => {
        messages.push(message)
      })
      const session = t.host.sessions[0]
      if (session === undefined) throw new Error('Missing fake session')
      session.emit(
        commandApproval([
          { choiceId: 'allow-once', label: 'Allow once', decision: 'approved', scope: 'once' },
        ]),
      )
      expect(
        messages.some(
          (message) => message.type === 'agentEvent' && message.event.type === 'approvalRequested',
        ),
      ).toBe(true)
      await t.conversation.handle({
        type: 'decideApproval',
        approvalId: 'approval-1',
        choiceId: 'allow-once',
        requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
      })
      expect(session.decideApproval).toHaveBeenCalledWith({
        approvalId: 'approval-1',
        choiceId: 'allow-once',
        requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
      })
      session.emit({
        type: 'questionRequested',
        userInputId: 'question',
        itemId: 'question-item',
        questions: [
          {
            id: 'q',
            header: 'Fake question',
            question: 'Which option?',
            options: [],
            selection: { mode: 'single' },
          },
        ],
      })
      expect(
        messages.some(
          (message) => message.type === 'agentEvent' && message.event.type === 'questionRequested',
        ),
      ).toBe(true)
      await t.conversation.handle({ type: 'cancelQuestion', userInputId: 'question' })
      expect(session.cancelQuestions).toHaveBeenCalledWith('question')
    } finally {
      await t.conversation.release()
      await t.runtime.close()
    }
  })
}
