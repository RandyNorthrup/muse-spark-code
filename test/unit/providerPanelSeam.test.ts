import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { checkEndpointUrl } from '../../src/core/providers/endpointPolicy'
import { importProviders } from '../../src/host/providers/importExport'
import { saveWizardDraft } from '../../src/host/providers/wizardSave'
import { ProviderCredentialStore } from '../../src/host/providers/credentialRecords'
import { probeLocalServers } from '../../src/host/providers/localProbe'
import { testProvidersHost } from './helpers/m95kFixtures'
import { memorySecrets, unexpectedWarning } from './helpers/fakes'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function panel(
  resolve = vi.fn((host: string) =>
    Promise.resolve([host === 'localhost' ? '127.0.0.1' : '8.8.8.8']),
  ),
) {
  const folder = await mkdtemp(path.join(tmpdir(), 'provider-panel-'))
  folders.push(folder)
  const configFile = path.join(folder, 'providers.json')
  const seam = createModelsPanelSeam({
    configFile,
    subscriptionModels: () => Promise.resolve([]),
    resolve,
  })
  const credentials = new ProviderCredentialStore(memorySecrets(), unexpectedWarning)
  return { seam, credentials, configFile, resolve }
}

const CLOUD = {
  id: 'openai',
  preset: 'openai',
  address: 'https://api.openai.com/v1',
  auth: 'apiKey' as const,
  models: ['gpt-test'],
}
const LOCAL = {
  id: 'ollama',
  preset: 'ollama',
  address: 'http://localhost:11434',
  auth: 'none' as const,
  models: ['qwen-test'],
}

describe('production Models panel seam', () => {
  it('resolves public and loopback hosts while adding and editing providers (PR136 VA)', async () => {
    const { seam, credentials, resolve } = await panel()
    for (const provider of [CLOUD, LOCAL]) {
      const deps = {
        store: seam.store,
        policy: seam.policy,
        credentials,
        setComposerModel: () => Promise.resolve(),
      }
      const draft = {
        provider,
        credential: provider.auth === 'apiKey' ? 'synthetic-key' : undefined,
        credentialAuth: 'apiKey' as const,
        defaultModel: `${provider.id}/${provider.models[0] ?? ''}`,
        useNow: false,
      }
      await saveWizardDraft(deps, draft)
      const edited = { ...provider, models: ['edited-model'] }
      await saveWizardDraft(deps, {
        ...draft,
        provider: edited,
        editing: true,
        defaultModel: `${provider.id}/edited-model`,
      })
      expect(await seam.store.list()).toContainEqual(edited)
    }
    expect(resolve).toHaveBeenCalledWith('api.openai.com')
    expect(resolve).toHaveBeenCalledWith('localhost')
  })

  it('imports public and loopback providers through resolved address checks (PR136 VA)', async () => {
    const { seam, credentials, resolve } = await panel()
    expect(
      await importProviders(
        {
          store: seam.store,
          policy: seam.policy,
          credentials,
          confirm: () => Promise.resolve(true),
        },
        JSON.stringify({ v: 1, providers: [CLOUD, LOCAL], defaultModel: 'openai/gpt-test' }),
      ),
    ).toBe(2)
    expect(await seam.store.list()).toEqual([CLOUD, LOCAL])
    expect(await seam.store.defaultModel()).toBe('openai/gpt-test')
    expect(resolve).toHaveBeenCalledWith('api.openai.com')
    expect(resolve).toHaveBeenCalledWith('localhost')
  })

  it('distinguishes unresolved hosts and preserves private, metadata and mixed-answer guards', async () => {
    const resolve = vi.fn(() => Promise.resolve(['10.0.0.8']))
    const { seam } = await panel(resolve)
    expect(await seam.policy.check('https://lan.example')).toEqual({
      kind: 'private',
      address: 'https://lan.example',
    })
    resolve.mockResolvedValue(['169.254.169.254'])
    expect(await seam.policy.check('https://metadata.example')).toEqual({
      kind: 'refused',
      detail: 'metadata',
    })
    resolve.mockResolvedValue(['8.8.8.8', '10.0.0.8'])
    expect(await seam.policy.check(CLOUD.address)).toEqual({
      kind: 'refused',
      detail: 'mixed-answers',
    })
    resolve.mockResolvedValue([])
    expect(await seam.policy.check(CLOUD.address)).toEqual({
      kind: 'refused',
      detail: 'unresolved-address',
    })
    expect(checkEndpointUrl(CLOUD.address, [])).toEqual({
      kind: 'refused',
      reason: 'unresolved-address',
    })
    resolve.mockRejectedValue(new Error('DNS unavailable'))
    expect(await seam.policy.check(CLOUD.address)).toEqual({
      kind: 'refused',
      detail: 'unresolved-address',
    })
    resolve.mockClear()
    expect(await seam.policy.check('http://127.0.0.1:11434')).toEqual({ kind: 'ok' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('requires private-network consent before saving and refuses malformed URLs before DNS', async () => {
    const resolve = vi.fn(() => Promise.resolve(['10.0.0.8']))
    const { seam, credentials } = await panel(resolve)
    const provider = { ...CLOUD, address: 'https://lan.example', privateNetwork: true }
    const deps = {
      store: seam.store,
      policy: seam.policy,
      credentials,
      setComposerModel: () => Promise.resolve(),
    }
    const draft = {
      provider,
      credential: 'synthetic-key',
      credentialAuth: 'apiKey' as const,
      defaultModel: 'openai/gpt-test',
      useNow: false,
    }
    await expect(saveWizardDraft(deps, draft)).rejects.toThrow()
    expect(await seam.store.list()).toEqual([])
    await saveWizardDraft({ ...deps, isPrivateConfirmed: () => true }, draft)
    resolve.mockClear()
    for (const address of [
      'not a URL',
      'https://user:pass@example.com',
      'https://example.com?key=synthetic',
      'https://example.com#fragment',
    ]) {
      expect(await seam.policy.check(address)).toMatchObject({ kind: 'refused' })
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('does not offer or dispatch missing OpenRouter services (PR136 VE)', async () => {
    const { seam } = await panel()
    expect(seam.exchanger).toBeUndefined()
    expect(seam.usage).toBeUndefined()
    expect(seam.catalog.get('openrouter')?.connectLabel).toBeUndefined()
    const { providers } = testProvidersHost({ deps: seam })
    await expect(providers.connectOpenRouter(false)).resolves.toBeUndefined()
    await expect(providers.openRouterUsage('synthetic-key')).resolves.toBeUndefined()
  })

  it('contacts every local preset at its model-list path and loopback port (PR136 VJ)', async () => {
    const { seam } = await panel()
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')))
    for (const id of ['ollama', 'lmstudio', 'vllm', 'llamacpp']) {
      const preset = seam.catalog.get(id)
      expect(preset).toBeDefined()
      const probes = await probeLocalServers(preset?.localProbes ?? [], fetcher)
      expect(probes[0]?.answered).toBe(true)
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:11434/api/tags',
      'http://127.0.0.1:1234/v1/models',
      'http://127.0.0.1:8000/v1/models',
      'http://127.0.0.1:8080/v1/models',
    ])
  })

  it('rejects invalid imported defaults before confirmation or changing the production file (PR136 VZ)', async () => {
    const { seam, credentials, configFile } = await panel()
    await seam.store.add(CLOUD)
    await seam.store.setDefaultModel('openai/gpt-test')
    const before = await readFile(configFile, 'utf8')
    const confirm = vi.fn(() => Promise.resolve(true))
    for (const defaultModel of ['missing/model', 'ollama/not-selected', 'ollama/', 'bad ref']) {
      await expect(
        importProviders(
          { store: seam.store, policy: { check: () => ({ kind: 'ok' }) }, credentials, confirm },
          JSON.stringify({ v: 1, providers: [LOCAL], defaultModel }),
        ),
      ).rejects.toThrow()
      expect(await readFile(configFile, 'utf8')).toBe(before)
    }
    expect(confirm).not.toHaveBeenCalled()
  })
})
