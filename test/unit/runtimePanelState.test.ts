import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { runPanel } from '../../src/runtime/panel/runPanel'
import type { RuntimeFeatureContext } from '../../src/runtime/panel/runtimeFeatures'
import { fakePanelRuntime } from './helpers/runtimePanel'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { panelEnvelopeSchema } from '../../src/shared/hostApi/panel'
import { FakeAgentHost } from './helpers/fakeAgent'
import { buildHostBundles } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

function runGit(): Promise<never> {
  return Promise.reject(new Error('fake refuses git'))
}

const rig = { root: '' }
beforeAll(async () => {
  rig.root = await mkdtemp(path.join(tmpdir(), 'm104-state-'))
  await buildHostBundles(rig.root, {
    conversation: path.resolve('src/host/conversation/conversationEntry.ts'),
    runtimePanelPorts: path.resolve('src/runtime/panel/runtimeFeaturesEntry.ts'),
  })
})
afterAll(async () => {
  setUiText(EN, 'en')
  await removeFolder(rig.root)
})
const requestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.object({ sessionId: z.optional(z.string()), surfaceId: z.optional(z.string()) }),
})
const frameId = z.union([z.string(), z.number()])
const frameSchema = z.union([
  z.object({ id: frameId, result: z.unknown() }),
  z.object({ id: frameId, error: z.object({ code: z.number(), message: z.string() }) }),
])

async function fixture(kind: 'museCode' | 'modelApi', isTrusted = false) {
  const root = await realpath(await mkdtemp(path.join(rig.root, 'workspace-')))
  const worktree = path.join(root, 'worktree')
  await mkdir(worktree)
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const input = new PassThrough()
  const output = new PassThrough()
  const frames: unknown[] = []
  const bindings = new Map<string, { sessionId: string; surface: string }>()
  const contexts: RuntimeFeatureContext[] = []
  const profiles: { kind: string; trusted: boolean; sandbox: string }[] = []
  const options: ServeOptions = {
    backend: kind,
    trustWorkspace: true,
    museBinary: '',
    shellSandbox: 'off',
    canBypass: isTrusted,
    allowsContributorModels: false,
    paidFeatures: [],
    isVerbose: false,
  }

  let count = 0
  let isProfileFailing = false
  function backend(options: ServeOptions) {
    const base = fakePanelRuntime({
      options,
      distDir: rig.root,
      homeDir: root,
      runGit,
      log,
    })
    const host = new FakeAgentHost()
    host.info = { ...host.info, kind: options.backend }
    host.startSession.mockImplementation(async (request) => {
      const loaded = await host.resumeSession(`session-${String(++count)}`, request.modelId)
      return loaded.session
    })
    vi.spyOn(host, 'readSession').mockResolvedValue({
      mode: 'inline',
      name: undefined,
      items: [],
      todos: [],
    })
    return {
      ...base,
      backend: {
        kind: options.backend,
        readiness: () => Promise.resolve({ state: 'ready' as const }),
        hostFor: () => Promise.resolve(host),
      },
    }
  }
  const send = (frame: unknown) => {
    input.write(`${JSON.stringify(frame)}\n`)
  }
  let pending = ''
  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString()
    for (;;) {
      const index = pending.indexOf('\n')
      if (index === -1) break
      const frame: unknown = JSON.parse(pending.slice(0, index))
      pending = pending.slice(index + 1)
      frames.push(frame)
      const request = requestSchema.safeParse(frame)
      if (!request.success) continue
      const { id, method, params } = request.data
      if (method === 'surfaces/open' && params.sessionId !== undefined) {
        const surface = `surface-${String(bindings.size + 1)}`
        const binding = { sessionId: params.sessionId, surface }
        bindings.set(surface, binding)
        send({ jsonrpc: '2.0', id, result: { surfaceId: surface } })
        send({ mhp: '1.2', kind: 'surface', ...binding, surfaceKind: 'chat', event: 'opened' })
        send({ mhp: '1.2', kind: 'surface', ...binding, surfaceKind: 'chat', event: 'ready' })
        send({
          mhp: '1.2',
          kind: 'panel',
          surface,
          direction: 'toHost',
          seq: 1,
          payload: { type: 'ready' },
        })
      } else if (method === 'surfaces/close') {
        send({ jsonrpc: '2.0', id, result: null })
      }
    }
  })
  const result = runPanel({
    options,
    runtime: backend(options),
    transport: 'stdio',
    dataRoot: root,
    defaultCwd: root,
    conversationBundle: path.join(rig.root, 'conversation.js'),
    input,
    output,
    runGit,
    log,
    configureRuntime: (next) => {
      profiles.push({
        kind: next.backend,
        trusted: next.trustWorkspace,
        sandbox: next.shellSandbox,
      })
      return isProfileFailing
        ? Promise.reject(new Error('Fake profile construction failed'))
        : Promise.resolve(backend(next))
    },
    loadLanguage: () =>
      Promise.resolve({
        table: { ...EN, composerPlaceholder: 'Fake localized composer' },
        locale: 'de',
      }),
    modelCapabilities: (_runtime, modelId) =>
      Promise.resolve({
        providerId: 'fake-vendor',
        modelId,
        capabilities: new Set(['compaction']),
      }),
    factories: {
      engines: (context) => {
        contexts.push(context)
        return Promise.resolve({
          features: {},
          actions: { newWorktree: () => context.openWorkspace(worktree) },
        })
      },
    },
  })
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      host: { id: 'fake', version: '1' },
      protocolRange: { minimum: 'mhp/1.2.0', maximumExclusive: 'mhp/1.3.0' },
      capabilities: ['lifecycle', 'surfaces', 'settings', 'storage'],
      locale: 'de',
      theme: { kind: 'dark', tokens: {} },
      folders: [{ uri: pathToFileURL(root).href, name: 'fake' }],
      trusted: isTrusted,
    },
  })
  const waitReply = async (id: number) => {
    await vi.waitFor(
      () => {
        expect(
          frames.some(
            (frame) => frameSchema.safeParse(frame).success && frameSchema.parse(frame).id === id,
          ),
        ).toBe(true)
      },
      { timeout: 10_000 },
    )
  }
  await waitReply(1)
  await vi.waitFor(() => {
    expect(bindings.size).toBe(1)
  })
  return {
    root,
    worktree,
    log,
    frames,
    bindings,
    contexts,
    profiles,
    send,
    waitReply,
    failProfile: (isFailing: boolean) => {
      isProfileFailing = isFailing
    },
    close: async () => {
      input.end()
      expect(await result).toBe(0)
    },
  }
}

for (const kind of ['museCode', 'modelApi'] as const) {
  it(`${kind}: each conversation publishes only its own effective settings and revokes its own Bypass`, async () => {
    const t = await fixture(kind, true)
    try {
      const rootContext = t.contexts[0]
      if (rootContext === undefined) throw new Error('Missing fake root')
      await rootContext.openWorkspace(t.worktree)
      const worktreeContext = t.contexts.at(-1)
      if (worktreeContext === undefined) throw new Error('Missing fake worktree')
      const rootController = [...rootContext.ports.controllers()][0]
      const worktreeController = [...rootContext.ports.controllers()][1]
      if (rootController === undefined || worktreeController === undefined)
        throw new Error('Missing fake controllers')
      const worktreeBinding = t.bindings.get('surface-2')
      const rootBinding = t.bindings.get('surface-1')
      if (worktreeBinding === undefined || rootBinding === undefined)
        throw new Error('Missing fake bindings')
      const inits = (surface: string) =>
        t.frames.flatMap((frame) => {
          const parsed = panelEnvelopeSchema.safeParse(frame)
          return parsed.success &&
            parsed.data.surface === surface &&
            parsed.data.payload.type === 'init'
            ? [parsed.data.payload.settings]
            : []
        })
      let requestId = 10
      const update = async (
        context: RuntimeFeatureContext,
        key: string,
        value: boolean | number,
        scope: 'workspace' | 'user' = 'workspace',
      ) => {
        const params = { key: `museSpark.${key}`, value, scope }
        if (context === rootContext) {
          const id = ++requestId
          t.send({ jsonrpc: '2.0', id, method: 'settings/update', params })
          await t.waitReply(id)
        } else {
          await context.ports.host.request('settings/update', params)
        }
      }
      await update(worktreeContext, 'autosave', false)
      await update(worktreeContext, 'modelApiWebSearch', false)
      await update(worktreeContext, 'allowDangerouslySkipPermissions', true)
      await vi.waitFor(() => {
        expect(inits(worktreeBinding.surface).at(-1)).toMatchObject({
          autosave: false,
          allowDangerouslySkipPermissions: true,
        })
      })
      await update(rootContext, 'autosave', false)
      await update(rootContext, 'modelApiWebSearch', false)
      await update(rootContext, 'allowDangerouslySkipPermissions', true)
      await vi.waitFor(() => {
        expect(inits(rootBinding.surface).at(-1)).toMatchObject({
          autosave: false,
          allowDangerouslySkipPermissions: true,
        })
      })
      const worktreeCount = inits(worktreeBinding.surface).length
      const rootRevocation = vi.spyOn(rootController, 'revokeBypass')
      const worktreeRevocation = vi.spyOn(worktreeController, 'revokeBypass')
      await update(rootContext, 'autosave', true)
      await update(rootContext, 'modelApiWebSearch', true)
      await update(rootContext, 'allowDangerouslySkipPermissions', false)
      await vi.waitFor(() => {
        expect(inits(rootBinding.surface).at(-1)).toMatchObject({
          autosave: true,
          allowDangerouslySkipPermissions: false,
        })
      })
      expect(worktreeContext.ports.settings.current()).toMatchObject({
        autosave: false,
        modelApiWebSearch: false,
        allowDangerouslySkipPermissions: true,
      })
      expect(inits(worktreeBinding.surface)).toHaveLength(worktreeCount)
      expect(rootRevocation).toHaveBeenCalledTimes(1)
      expect(worktreeRevocation).not.toHaveBeenCalled()
      await update(worktreeContext, 'allowDangerouslySkipPermissions', false)
      await vi.waitFor(() => {
        expect(worktreeRevocation).toHaveBeenCalledTimes(1)
      })
      // A common user value affects both stores; workspace overrides still win.
      await update(rootContext, 'paidDailyBudgetUsd', 9, 'user')
      await vi.waitFor(() => {
        // 0.17 keeps money settings as exact decimal strings.
        expect(rootContext.ports.settings.current().paidDailyBudgetUsd).toBe('9')
        expect(worktreeContext.ports.settings.current().paidDailyBudgetUsd).toBe('9')
        expect(inits(worktreeBinding.surface)).toHaveLength(worktreeCount + 2)
        expect(inits(worktreeBinding.surface).at(-1)).toMatchObject({
          autosave: false,
          allowDangerouslySkipPermissions: false,
        })
      })
    } finally {
      await t.close()
    }
  })
  it(`${kind}: profile failures return a named error and a later valid change recovers a fresh root conversation`, async () => {
    const t = await fixture(kind)
    try {
      t.failProfile(true)
      const next = kind === 'museCode' ? 'modelApi' : 'museCode'
      t.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'settings/update',
        params: { key: 'museSpark.backend', value: next, scope: 'user' },
      })
      await t.waitReply(2)
      expect(t.frames).toContainEqual({
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32_603, message: 'MHP_RUNTIME_CONFIGURATION_FAILED' },
      })
      t.failProfile(false)
      t.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'settings/update',
        params: { key: 'museSpark.backend', value: kind, scope: 'user' },
      })
      await t.waitReply(3)
      expect(t.frames).toContainEqual({ jsonrpc: '2.0', id: 3, result: null })
      expect(t.bindings.size).toBe(2)
    } finally {
      await t.close()
    }
  })
  it(`${kind}: runtime settings stay authoritative, publish to views and replace backend profiles`, async () => {
    const t = await fixture(kind)
    try {
      expect(t.profiles).toEqual([{ kind, trusted: false, sandbox: 'off' }])
      t.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'settings/update',
        params: { key: 'museSpark.autosave', value: false, scope: 'workspace' },
      })
      await t.waitReply(2)
      expect(t.profiles).toHaveLength(1)
      expect(
        t.frames.some((frame) => JSON.stringify(frame).includes('Fake localized composer')),
      ).toBe(true)
      t.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'settings/get',
        params: { key: 'museSpark.autosave' },
      })
      await t.waitReply(3)
      expect(t.frames).toContainEqual({ jsonrpc: '2.0', id: 3, result: { value: false } })
      const next = kind === 'museCode' ? 'modelApi' : 'museCode'
      t.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'settings/update',
        params: { key: 'museSpark.backend', value: next, scope: 'user' },
      })
      await t.waitReply(4)
      expect(t.profiles.at(-1)).toEqual({ kind: next, trusted: false, sandbox: 'off' })
      expect(t.bindings.size).toBe(2)
      expect(t.contexts.at(-1)?.ports.runtime.backend.kind).toBe(next)
      const peerStore = new RuntimeSettingsStore(t.root, t.root)
      await peerStore.updateSetting('museSpark.autosave', true, 'workspace')
      await vi.waitFor(() => {
        expect(t.contexts.at(-1)?.ports.settings.current().autosave).toBe(true)
      })
      expect(t.profiles).toHaveLength(2)
      t.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'settings/update',
        params: { key: 'museSpark.shellSandbox', value: 'auto', scope: 'workspace' },
      })
      await t.waitReply(5)
      expect(t.profiles.at(-1)?.sandbox).toBe('auto')
    } finally {
      await t.close()
    }
  })
  it(`${kind}: host trust grant and revocation recreate sessions, and worktrees get their own store`, async () => {
    const t = await fixture(kind)
    try {
      t.send({ jsonrpc: '2.0', method: 'workspace/didChangeTrust', params: { trusted: true } })
      await vi.waitFor(
        () => {
          expect(t.bindings.size).toBe(2)
        },
        { timeout: 10_000 },
      )
      expect(t.profiles.at(-1)?.trusted).toBe(true)
      const context = t.contexts.at(-1)
      if (context === undefined) throw new Error('Missing fake composition')
      const model = await context.requireModelCapabilities()
      expect(model.providerId).toBe('fake-vendor')
      await context.openWorkspace(t.worktree)
      expect(t.contexts.at(-1)?.ports.workspaceRoot).toBe(t.worktree)
      expect(t.contexts.at(-1)?.ports.store).not.toBe(context.ports.store)
      const worktreeContext = t.contexts.at(-1)
      if (worktreeContext === undefined) throw new Error('Missing fake worktree')
      await worktreeContext.ports.host.request('settings/update', {
        key: 'museSpark.autosave',
        value: false,
        scope: 'workspace',
      })
      expect(await worktreeContext.ports.store.getSetting('museSpark.autosave')).toBe(false)
      expect(await context.ports.store.getSetting('museSpark.autosave')).toBe(true)
      await expect(
        worktreeContext.ports.host.request('settings/update', {
          key: 'museSpark.backend',
          value: 'modelApi',
          scope: 'workspace',
        }),
      ).rejects.toThrow('MHP_WORKSPACE_PROFILE_UNAVAILABLE')
      expect(await worktreeContext.ports.store.hasSetting('museSpark.backend')).toBe(false)
      t.send({ jsonrpc: '2.0', method: 'workspace/didChangeTrust', params: { trusted: false } })
      await vi.waitFor(
        () => {
          expect(t.profiles.at(-1)?.trusted).toBe(false)
        },
        { timeout: 10_000 },
      )
      await expect(context.openWorkspace(t.worktree)).rejects.toThrow('MHP_WORKSPACE_UNTRUSTED')
    } finally {
      await t.close()
    }
  })
}
