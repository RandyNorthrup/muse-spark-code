import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type * as ConversationBundle from '../../src/host/conversation/conversationBundle'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
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

async function setup() {
  const options: ServeOptions = {
    backend: 'museCode',
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
        kind: 'museCode' as const,
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
  vi.spyOn(t.host, 'readSession').mockImplementation(async () => {
    await reply.promise
    throw new Error('fake replay failed')
  })
  const settled = vi.spyOn(t.store, 'settled')
  const received = vi.fn<(message: HostToWebviewMessage) => void>()
  t.conversation.subscribe(received)
  const handling = expect(
    t.conversation.handle({ type: 'ready', attachmentEpoch: 1 }),
  ).rejects.toThrow('fake replay failed')
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
