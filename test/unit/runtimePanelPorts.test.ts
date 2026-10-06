import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { runtimeConversationDeps, runtimeSettings } from '../../src/runtime/panel/runtimeFeatures'
import type {
  RuntimeEngineContribution,
  RuntimeFeatureFactories,
} from '../../src/runtime/panel/runtimeFeatures'
import type { AuthPort, AuthSnapshot } from '../../src/host/auth/authService'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
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
async function setup(isTrusted = true, factories?: RuntimeFeatureFactories) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'm104-ports-')))
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
  const settings = await runtimeSettings(store, log)
  cleanup.push(() => settings.dispose())
  const deps = await runtimeConversationDeps({
    host,
    runtime,
    options,
    workspaceRoot: workspace,
    store,
    settings,
    ...(factories !== undefined && { factories }),
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
  it('delegates paid policy, accounting, account/budget/attempt hosts and authentication to the engine contribution', async () => {
    const snapshot: AuthSnapshot = { status: 'signedIn', backend: 'modelApi', detail: undefined }
    const auth: AuthPort = {
      current: snapshot,
      backend: 'modelApi',
      admissionGeneration: 7,
      toMessage: vi.fn(() => ({ type: 'authState' as const, status: snapshot.status })),
      signIn: vi.fn(() => Promise.resolve(snapshot)),
      installMuseCode: vi.fn(() => Promise.resolve(snapshot)),
      cancelSignIn: vi.fn(),
      signOut: vi.fn(() => Promise.resolve(snapshot)),
      refresh: vi.fn(() => Promise.resolve(snapshot)),
      checkAgain: vi.fn(() => Promise.resolve(snapshot)),
      markAuthRequired: vi.fn(() => snapshot),
      markBackendError: vi.fn(() => snapshot),
    }
    const host = new FakeAgentHost()
    const exhausted = new Error('Fake daily budget exhausted before dispatch')
    const owner = vi.fn()
    const finishEdit = vi.fn()
    const paid: NonNullable<RuntimeEngineContribution['paid']> = {
      gate: {
        isOn: vi.fn(() => true),
        turnOn: vi.fn(() => Promise.resolve(true)),
        turnOff: vi.fn(() => Promise.resolve()),
      },
      consent: {
        allows: vi.fn(() => Promise.resolve(false)),
        forget: vi.fn(() => Promise.resolve()),
      },
      usage: { add: vi.fn(), addBestOfNRequest: vi.fn(), addBestOfNUsage: vi.fn() },
    }
    const modelApi: NonNullable<RuntimeEngineContribution['modelApi']> = {
      accountId: vi.fn(() => Promise.resolve('fake-account-digest')),
      ensureHost: vi.fn(() => Promise.reject(exhausted)),
      captureExternalEditOwner: vi.fn(() => owner),
      beginExternalEdit: vi.fn(() => finishEdit),
      bestOfNBudgetScope: vi.fn(() => Promise.resolve(undefined)),
      buildAttemptHost: vi.fn(() => Promise.reject(exhausted)),
    }
    const ensureHost = vi.fn(() => Promise.resolve(host))
    const facts = { signInMethod: 'apiKey' as const, cliVersion: 'fake-account-facts' }
    const accountFacts = vi.fn(() => Promise.resolve(facts))
    const isKeyStored = vi.fn(() => true)
    const f = await setup(true, {
      engines: () =>
        Promise.resolve({
          features: { auth, ensureHost, accountFacts },
          paid,
          modelApi,
          isKeyStored,
        }),
    })
    expect(f.deps.auth).toBe(auth)
    expect(auth.refresh).toHaveBeenCalledOnce()
    await f.deps.auth.signIn('browser')
    await f.deps.auth.installMuseCode()
    f.deps.auth.cancelSignIn()
    await f.deps.auth.signOut()
    await f.deps.auth.checkAgain()
    f.deps.auth.markAuthRequired('fake auth required')
    f.deps.auth.markBackendError('fake backend failure')
    expect(auth.signIn).toHaveBeenCalledWith('browser')
    for (const method of [
      'installMuseCode',
      'cancelSignIn',
      'signOut',
      'checkAgain',
      'markAuthRequired',
      'markBackendError',
    ] as const)
      expect(auth[method]).toHaveBeenCalledOnce()
    expect(await f.deps.ensureHost()).toBe(host)
    expect(ensureHost).toHaveBeenCalledOnce()
    expect(await f.deps.accountFacts('modelApi')).toEqual(facts)
    expect(accountFacts).toHaveBeenCalledWith('modelApi')
    await f.deps.setPaidFeature('bestOfN', true)
    await f.deps.setPaidFeature('bestOfN', false)
    expect(paid.gate.turnOn).toHaveBeenCalledWith('bestOfN')
    expect(paid.gate.turnOff).toHaveBeenCalledWith('bestOfN')
    await f.deps.forgetPaidUse()
    expect(paid.consent.forget).toHaveBeenCalledOnce()
    const request = {
      feature: 'bestOfN' as const,
      modelId: 'fake-model',
      prompt: 'fake prompt',
      attempts: 2,
      requestCeilingPerAttempt: 1,
    }
    expect(await f.deps.allowsPaidUse(request)).toBe(false)
    expect(paid.consent.allows).toHaveBeenCalledWith(request)
    f.deps.notePaidUse('bestOfN', 2)
    f.deps.noteBestOfNRequest()
    const usage = { inputTokens: 2, outputTokens: 1, cachedTokens: 0 }
    f.deps.noteBestOfNUsage('fake-model', usage)
    expect(paid.usage.add).toHaveBeenCalledWith('bestOfN', 2)
    expect(paid.usage.addBestOfNRequest).toHaveBeenCalledOnce()
    expect(paid.usage.addBestOfNUsage).toHaveBeenCalledWith('fake-model', usage)
    expect(f.deps.isPaidFeatureOn('bestOfN')).toBe(true)
    expect(await f.deps.modelApiAccountId()).toBe('fake-account-digest')
    expect(await f.deps.voiceAccountId()).toBe('fake-account-digest')
    expect(await f.deps.bestOfNBudgetScope?.('session')).toBeUndefined()
    expect(modelApi.bestOfNBudgetScope).toHaveBeenCalledWith('session')
    await expect(f.deps.ownedVoiceBudgetScope('session')).rejects.toBe(exhausted)
    expect(modelApi.ensureHost).toHaveBeenCalledOnce()
    const session = new FakeAgentSession('session', 'fake-model')
    const edits = f.deps.bestOfNWorkspaceEdits?.(session)
    if (edits === undefined) throw new Error('Missing fake external-edit port')
    const finish = await edits(f.workspace, ['source.ts'])
    expect(modelApi.captureExternalEditOwner).toHaveBeenCalledWith(session)
    expect(modelApi.beginExternalEdit).toHaveBeenCalledWith(owner, [
      { relative: 'source.ts', absolute: f.file },
    ])
    finish(false)
    expect(finishEdit).toHaveBeenCalledWith(false)
    const admit = vi.fn()
    const note = vi.fn()
    await expect(f.deps.buildAttemptHost(f.workspace, admit, note, undefined)).rejects.toBe(
      exhausted,
    )
    expect(modelApi.buildAttemptHost).toHaveBeenCalledWith(f.workspace, admit, note, undefined)
    f.deps.museVoice()
    expect(isKeyStored).toHaveBeenCalledOnce()
  })
  it('keeps explicit refusals when engine policy/authentication groups are absent', async () => {
    const { deps } = await setup(true, { engines: () => Promise.resolve({ features: {} }) })
    await expect(deps.setPaidFeature('bestOfN', true)).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    await expect(deps.forgetPaidUse()).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    expect(() => deps.bestOfNBudgetScope?.('session')).toThrow('MHP_UNSUPPORTED_CAPABILITY')
    expect(() => deps.modelApiAccountId()).toThrow('MHP_UNSUPPORTED_CAPABILITY')
    await expect(deps.auth.installMuseCode()).rejects.toThrow()
    await expect(deps.auth.signOut()).rejects.toThrow()
  })
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
