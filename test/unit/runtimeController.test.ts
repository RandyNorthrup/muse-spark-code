import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type * as ConversationBundle from '../../src/host/conversation/conversationBundle'
import type { SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { ControllerRegistry } from '../../src/runtime/panel/controllerRegistry'
import { RuntimeConversation } from '../../src/runtime/panel/runtimeController'
import { runtimeConversationDeps, runtimeSettings } from '../../src/runtime/panel/runtimeFeatures'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memorySecrets } from './helpers/fakes'
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
  rig.root = await mkdtemp(path.join(tmpdir(), 'm104-lifetime-'))
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
  const runtime = createRuntimeBackend({
    options,
    version: 'fake',
    distDir: rig.root,
    platform: process.platform,
    env: {},
    homeDir: rig.root,
    secrets: memorySecrets(),
    runGit,
    museCodeCredentials: [],
    fetch: () => Promise.reject(new Error('fake refuses network')),
    sleep: () => Promise.resolve(),
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
