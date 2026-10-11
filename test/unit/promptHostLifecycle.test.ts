import { readFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as constants from '../../src/shared/constants'
import * as vscode from 'vscode'
import type * as VSCode from 'vscode'
import { createPromptHost, type PromptActivationPorts } from '../../src/host/prompts/promptEntry'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import { PromptStore } from '../../src/core/prompts/promptStore'
import { EN } from '../../src/shared/l10n/en'
import { PROMPT_SYNC_KEY, PROMPT_SYNC_SETTING, SETTINGS_SECTION } from '../../src/shared/constants'
import { savedPromptFixture } from './helpers/sharingFixtures'
import { inform, pickOne } from './helpers/vscodeViews'
import { fakeSurface } from './helpers/fakes'

const control = vi.hoisted(() => {
  const listeners: ((event: VSCode.ConfigurationChangeEvent) => unknown)[] = []
  return { dataRoot: '', isSyncOn: false, listeners }
})
vi.mock('../../src/runtime/dataFolder', () => ({ agentDataFolder: () => control.dataRoot }))
vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof VSCode>()
  return {
    ...actual,
    workspace: {
      ...actual.workspace,
      getConfiguration: () => ({ inspect: () => ({ globalValue: control.isSyncOn }) }),
      onDidChangeConfiguration: (listener: (event: VSCode.ConfigurationChangeEvent) => unknown) => {
        control.listeners.push(listener)
        return { dispose: () => undefined }
      },
      openTextDocument: ({ content }: { content: string }) =>
        Promise.resolve({ getText: () => content }),
    },
  }
})
const roots: string[] = []
const contexts: PromptActivationPorts['context'][] = []
afterEach(async () => {
  // Windows cannot remove the store while an admitted mirror write is still running.
  for (const context of contexts.splice(0))
    for (const item of context.subscriptions) await item.dispose()
  control.isSyncOn = false
  control.listeners.length = 0
  vi.resetAllMocks()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function rig() {
  const root = await mkdtemp(path.join(tmpdir(), 'm118-lifecycle-'))
  roots.push(root)
  control.dataRoot = root
  const surface = fakeSurface('same-chat')
  const post = vi.spyOn(surface, 'post')
  const registry = new SurfaceRegistry()
  registry.add(surface)
  const get = vi.fn()
  const update = vi.fn((_key: string, _value: unknown) => Promise.resolve())
  const setKeysForSync = vi.fn<(keys: readonly string[]) => void>()
  const state = { get, update, keys: () => [], setKeysForSync }
  const ports: PromptActivationPorts = {
    context: {
      subscriptions: [],
      extensionUri: vscode.Uri.file(root),
      globalStorageUri: vscode.Uri.file(root),
      globalState: state,
      workspaceState: state,
    },
    workspaceRoot: root,
    credentials: { getApiKey: () => Promise.resolve(undefined) },
    settings: () => ({ confidentialWorkspace: false }),
    registry,
    openConversation: () => Promise.resolve(),
    ready: new WeakSet([surface]),
    controllers: new Map(),
    webFetch: () => {
      throw new Error('No remote fetch in lifecycle tests')
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  }
  contexts.push(ports.context)
  return { root, ports, surface, post, get, update, setKeysForSync }
}

describe('M118 prompt host lifecycle', () => {
  it('cancels a prompt release while the Save dialog is open on the same active chat', async () => {
    const t = await rig()
    const host = createPromptHost(t.ports, EN, 'en')
    const file = path.join(t.root, 'cancelled.muse-prompt.md')
    const picker = Promise.withResolvers<VSCode.Uri | undefined>()
    const opened = Promise.withResolvers<undefined>()
    vi.mocked(pickOne).mockImplementation((items) =>
      Promise.resolve(items.find((item) => item.label === EN.shareFile)),
    )
    vi.mocked(inform).mockResolvedValue(EN.shareFile)
    vi.mocked(vscode.window.showSaveDialog).mockImplementation(() => {
      opened.resolve(undefined)
      return picker.promise
    })
    const releasing = host.handle(t.surface, {
      type: 'sharingAction',
      id: 'release',
      action: 'shareText',
      payload: { text: 'Reviewed public prompt' },
    })
    await opened.promise
    await host.handle(t.surface, {
      type: 'sharingAction',
      id: 'cancel',
      action: 'invalidate',
      payload: {},
    })
    expect(t.ports.registry.active).toBe(t.surface)
    picker.resolve(vscode.Uri.file(file))
    await releasing
    expect(t.post).toHaveBeenCalledWith({
      type: 'sharingResult',
      id: 'release',
      value: undefined,
      error: EN.shareCancelled,
    })
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('registers and merges the prompt mirror when Settings Sync is enabled before any sharing command', async () => {
    const t = await rig()
    const local = { ...savedPromptFixture, id: 'local', variables: [], body: 'Local prompt' }
    const remote = { ...local, id: 'remote', body: 'Remote prompt' }
    await new PromptStore(t.root, t.root).write(local)
    t.get.mockReturnValue([remote])
    const loads = vi.fn(() => ({ createPromptHost }))
    const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
    const start = source.indexOf('  const sharing = () =>')
    const end = source.indexOf('  const resolveCli = () =>', start)
    const configStart = source.indexOf(
      '    vscode.workspace.onDidChangeConfiguration((event) => {',
      end,
    )
    const configEnd = source.indexOf('    // Trust is a host-lifetime posture', configStart)
    if (start === -1 || configStart === -1 || end <= start || configEnd <= configStart)
      throw new Error('Sharing activation block not found')
    const activation =
      source.slice(start, end) +
      `context.subscriptions.push(${source.slice(configStart, configEnd)})`
    runInNewContext(transformSync(activation, { loader: 'ts' }).code, {
      ...constants,
      promptHost: undefined,
      promptBundleLoader: () => loads,
      UI_TEXT: EN,
      uiLocale: () => 'en',
      vscode,
      context: t.ports.context,
      workspaceRoot: t.root,
      credentials: t.ports.credentials,
      currentSettings: t.ports.settings,
      registry: t.ports.registry,
      openConversation: t.ports.openConversation,
      readyPromptSurfaces: t.ports.ready,
      controllers: t.ports.controllers,
      webFetchBundle: t.ports.webFetch,
      paid: { affects: () => false },
      registerLoggedCommand: vi.fn(() => ({ dispose: () => undefined })),
      logRejection: () => t.ports.log.warn,
      log: t.ports.log,
    })
    expect(loads).not.toHaveBeenCalled()
    expect(control.listeners).toHaveLength(1)
    const event = {
      affectsConfiguration: (setting: string) =>
        setting === `${SETTINGS_SECTION}.${PROMPT_SYNC_SETTING}`,
    }
    control.isSyncOn = true
    for (const listener of control.listeners) listener(event)
    await vi.waitFor(() => {
      expect(t.update).toHaveBeenCalledWith(
        PROMPT_SYNC_KEY,
        expect.arrayContaining([local, remote]),
      )
    })
    expect(loads).toHaveBeenCalledOnce()
    expect(t.setKeysForSync).toHaveBeenLastCalledWith(expect.arrayContaining([PROMPT_SYNC_KEY]))
    expect(await new PromptStore(t.root, t.root).list('user')).toEqual(
      expect.arrayContaining([local, remote]),
    )
    control.isSyncOn = false
    for (const listener of control.listeners) listener(event)
    expect(t.setKeysForSync).toHaveBeenLastCalledWith(expect.not.arrayContaining([PROMPT_SYNC_KEY]))
    expect(control.listeners).toHaveLength(1)
    for (const item of t.ports.context.subscriptions) await item.dispose()
  })

  it('owns the second mirror merge until disposal settles and rejects later operations', async () => {
    const t = await rig()
    control.isSyncOn = true
    t.get.mockReturnValue([savedPromptFixture])
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalWrite = PromptStore.prototype.write
    let isWriteFinished = false
    const write = vi
      .spyOn(PromptStore.prototype, 'write')
      .mockImplementationOnce(originalWrite)
      .mockImplementationOnce(async function (this: PromptStore, prompt, keepNewer) {
        entered.resolve(undefined)
        await release.promise
        await originalWrite.call(this, prompt, keepNewer)
        isWriteFinished = true
      })
    const host = createPromptHost(t.ports, EN, 'en')
    const syncing = host.run('synchronise')
    await entered.promise
    const disposing = host.dispose()
    let isDisposed = false
    void disposing.then(() => {
      isDisposed = true
    })
    try {
      expect(t.update).toHaveBeenCalledOnce()
      expect(t.ports.context.subscriptions).toContain(host)
      expect(host.dispose()).toBe(disposing)
      await expect(host.run('synchronise')).rejects.toThrow(EN.shareCancelled)
      await expect(
        host.handle(t.surface, {
          type: 'sharingAction',
          id: 'late-save',
          action: 'saveText',
          payload: { text: 'Late' },
        }),
      ).rejects.toThrow(EN.shareCancelled)
      host.close(t.surface)
      expect(isDisposed).toBe(false)
      expect(isWriteFinished).toBe(false)
      expect(write).toHaveBeenCalledTimes(2)
    } finally {
      release.resolve(undefined)
      await syncing
      await disposing
    }
    expect(isWriteFinished).toBe(true)
    expect(isDisposed).toBe(true)
    expect(t.update).toHaveBeenCalledTimes(2)
    expect(t.ports.log.warn).not.toHaveBeenCalled()
    // No retries: removing storage immediately after awaited disposal must succeed.
    await rm(t.root, { recursive: true, force: true })
    await expect(stat(t.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
