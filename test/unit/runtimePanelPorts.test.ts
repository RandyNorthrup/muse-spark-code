import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { runtimeConversationDeps, runtimeSettings } from '../../src/runtime/panel/runtimeFeatures'
import type {
  HostServices,
  MhpParams,
  MhpRequestMethod,
  MhpResult,
} from '../../src/shared/hostApi/methods'
import { SECRET_KEYS } from '../../src/shared/constants'
import { memorySecrets, fakeSurface } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function setup(isTrusted = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'm104-ports-'))
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const file = path.join(workspace, 'source.ts')
  await writeFile(file, 'source')
  const outside = path.join(root, 'outside')
  await writeFile(outside, 'outside')
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, 'LLM|1|secret')
  const options: ServeOptions = {
    backend: 'modelApi',
    trustWorkspace: isTrusted,
    museBinary: '',
    shellSandbox: 'off',
    canBypass: false,
    allowsContributorModels: false,
    paidFeatures: [],
    isVerbose: false,
  }
  const runtime = createRuntimeBackend({
    options,
    version: '0.0.0-fake',
    distDir: root,
    platform: process.platform,
    env: { XDG_DATA_HOME: root, XDG_CONFIG_HOME: root },
    homeDir: root,
    secrets,
    runGit: () => Promise.reject(new Error('No test git')),
    museCodeCredentials: [],
    fetch: () => Promise.reject(new Error('No test network')),
    sleep: () => Promise.resolve(),
    log,
  })
  cleanup.push(async () => {
    await runtime.close()
    await removeFolder(root)
  })
  const state: { active: MhpResult<'editor/active'> } = {
    active: {
      uri: pathToFileURL(file).href,
      version: 1,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      excerpt: 'private selection',
      truncated: false,
    },
  }
  const calls: { method: MhpRequestMethod; params: unknown }[] = []
  const handlers: { [M in MhpRequestMethod]?: (params: MhpParams<M>) => Promise<MhpResult<M>> } = {
    'editor/active': () => Promise.resolve(state.active),
    'editor/insertAtCursor': (params) =>
      Promise.resolve({ uri: params.uri, version: 2, dirty: true, languageId: 'typescript' }),
    'editor/replaceSelection': (params) =>
      Promise.resolve({ uri: params.uri, version: 2, dirty: true, languageId: 'typescript' }),
    'editor/open': () => Promise.resolve(null),
  }
  const host: HostServices = {
    request: async (method, params) => {
      calls.push({ method, params })
      const handler = handlers[method]
      if (handler === undefined) throw new Error('Unbound fake service')
      return await handler(params)
    },
    notify: () => {
      throw new Error('Unexpected notification')
    },
  }
  const store = new RuntimeSettingsStore(root, workspace)
  const deps = await runtimeConversationDeps({
    host,
    runtime,
    options,
    workspaceRoot: workspace,
    store,
    settings: await runtimeSettings(store, log),
    surface: fakeSurface('session'),
    controllers: () => [],
    runGit: () => Promise.reject(new Error('No test git')),
    selection: () => state.active,
    documents: () => [],
    log,
  })
  return { root, workspace, file, outside, deps, state, calls }
}

describe('standalone conversation ports', () => {
  it('reads a confined regular file and refuses size, expected-path and link escapes', async () => {
    const f = await setup()
    const file = await f.deps.files.readFile(f.file, 16)
    expect(new TextDecoder().decode(file.bytes)).toBe('source')
    await expect(f.deps.files.readFile(f.file, 1)).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    await expect(f.deps.files.readFile(f.file, 16, f.outside)).rejects.toThrow(
      'MHP_UNSUPPORTED_CAPABILITY',
    )
    const link = path.join(f.workspace, 'link')
    await symlink(f.outside, link)
    await expect(f.deps.files.readFile(link, 16)).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
  })
  it('uses the native document version, and refuses outside/protected or untrusted editor writes', async () => {
    const f = await setup()
    expect(await f.deps.insertCode('replacement')).toBe(true)
    expect(f.calls.at(-1)).toMatchObject({
      method: 'editor/insertAtCursor',
      params: { expectedVersion: 1, text: 'replacement' },
    })
    const active = f.state.active
    if (active === null) throw new Error('No fake active selection')
    f.state.active = { ...active, uri: pathToFileURL(f.outside).href }
    await expect(f.deps.applyCode('replacement')).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    const protectedFile = path.join(f.workspace, '.git', 'config')
    await mkdir(path.dirname(protectedFile))
    await writeFile(protectedFile, 'private')
    f.state.active = { ...active, uri: pathToFileURL(protectedFile).href }
    await expect(f.deps.insertCode('replacement')).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    const untrusted = await setup(false)
    await expect(untrusted.deps.insertCode('replacement')).rejects.toThrow(
      'MHP_UNSUPPORTED_CAPABILITY',
    )
    expect(f.deps.editorContext()?.selectedText).toBeUndefined()
    expect(f.deps.checkpoints.availability()).toBe('off')
    expect(untrusted.deps.checkpoints.availability()).toBe('restricted')
  })
  it('refuses unimplemented feature actions with explicit errors', async () => {
    const f = await setup()
    expect(() => {
      return f.deps.exports.saveMarkdown('fake.md', 'private')
    }).toThrow('MHP_UNSUPPORTED_CAPABILITY')
  })
})
