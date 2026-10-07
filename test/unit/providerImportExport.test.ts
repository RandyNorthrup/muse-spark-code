// M95 lane K (PLAN.md D74, M95 acceptance 17 and Tests): an export holds
// no credential, and an import is validated, previewed and confirmed
// address by address.

import { describe, expect, it, vi } from 'vitest'
import {
  exportProviders,
  importProviders,
  parseProvidersDocument,
  previewProvidersImport,
  type ImportPreview,
} from '../../src/host/providers/importExport'
import type { AddressPolicy, ProviderEntry } from '../../src/host/providers/providerPorts'
import { memoryProvidersStore, memorySecrets, unexpectedWarning } from './helpers/fakes'
import {
  ProviderCredentialStore,
  saveProviderCredential,
} from '../../src/host/providers/credentialRecords'
import { providerEntrySchema } from '../../src/core/providers/providersFile'

const OPENROUTER: ProviderEntry = {
  id: 'openrouter',
  preset: 'openrouter',
  address: 'https://openrouter.ai',
  auth: 'apiKey',
  models: ['openai/gpt-oss-20b'],
}

const GROQ: ProviderEntry = {
  id: 'groq',
  preset: 'groq',
  address: 'https://api.groq.com/openai/v1',
  auth: 'apiKey',
  models: [],
}

const LOCAL: ProviderEntry = {
  id: 'ollama',
  preset: 'ollama',
  address: 'http://127.0.0.1:11434',
  auth: 'none',
  models: ['qwen3:8b'],
}

const POLICY: AddressPolicy = {
  check: (address) =>
    address === 'https://attacker.example'
      ? { kind: 'refused', detail: 'link-local addresses are refused' }
      : { kind: 'ok' },
}

const memoryStore = memoryProvidersStore
const credentials = new ProviderCredentialStore(memorySecrets(), unexpectedWarning)

const CUSTOM = {
  id: 'custom',
  preset: 'custom',
  address: 'https://custom.example/v1',
  auth: 'none' as const,
  format: 'chat' as const,
  models: ['m'],
  modelLimits: { m: { contextTokens: 8192, outputTokens: 1024 } },
  compat: {
    toolChoice: 'omit' as const,
    outputCapParam: 'max_tokens' as const,
    supportsStrictTools: true,
  },
}

/** Every key anywhere in a parsed export that would carry a credential. */
function credentialKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child) => credentialKeys(child))
  }
  return typeof value !== 'object' || value === null
    ? []
    : Object.entries(value).flatMap(([key, child]) =>
        /key|secret|credential|token|password/i.test(key) ? [key] : credentialKeys(child),
      )
}

describe('exportProviders', () => {
  it('round-trips subscription configuration and defaults without secrets (PR136 VP)', async () => {
    const subscriptions: ProviderEntry[] = [
      {
        id: 'chatgpt',
        preset: 'chatgpt',
        address: 'https://api.openai.com',
        auth: 'subscription',
        format: 'responses',
        models: ['gpt-test'],
      },
      {
        id: 'copilot',
        preset: 'copilot',
        address: 'https://github.com/copilot',
        auth: 'subscription',
        format: 'chat',
        models: ['claude-test'],
      },
    ]
    const store = memoryStore([...subscriptions, LOCAL])
    await store.setDefaultModel('chatgpt/gpt-test')
    const exported = await exportProviders(store)
    const document = parseProvidersDocument(JSON.parse(exported))
    expect(document.providers).toEqual([...subscriptions, LOCAL])
    expect(document.defaultModel).toBe('chatgpt/gpt-test')
    expect(credentialKeys(JSON.parse(exported))).toEqual([])
  })
  it('preserves custom compat through export and confirmed re-import (F3)', async () => {
    expect(providerEntrySchema.parse(CUSTOM)).toEqual(CUSTOM)
    const exported = await exportProviders(memoryStore([CUSTOM]))
    expect(JSON.parse(exported)).toEqual({ v: 1, providers: [CUSTOM] })
    const target = memoryStore()
    await importProviders(
      { store: target, credentials, policy: POLICY, confirm: () => Promise.resolve(true) },
      exported,
    )
    expect(target.current).toEqual([CUSTOM])
    expect(providerEntrySchema.parse(target.current[0])).toEqual(CUSTOM)
  })

  it('round-trips canonical provider options and the default model', async () => {
    const entry: ProviderEntry = {
      ...OPENROUTER,
      format: 'chat',
      models: ['m'],
      pinned: ['m'],
      prices: { m: { input: 1, output: 2 } },
      routing: { privacy: 'zdr', order: ['vendor'], allowFallbacks: false },
      numCtx: { m: 32_768 },
    }
    const source = memoryStore([entry])
    await source.setDefaultModel('openrouter/m')
    const exported = await exportProviders(source)
    expect(JSON.parse(exported)).toEqual({ v: 1, defaultModel: 'openrouter/m', providers: [entry] })
    const target = memoryStore()
    await importProviders(
      { store: target, credentials, policy: POLICY, confirm: () => Promise.resolve(true) },
      exported,
    )
    expect(target.current).toEqual([entry])
    expect(await target.defaultModel()).toBe('openrouter/m')
  })
  it('exports the non-secret configuration with no credential field', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openrouter', {
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: '[REDACTED]',
    })
    const text = await exportProviders(memoryStore([OPENROUTER, LOCAL]))
    // The text is this lane's own export; the cast names its document shape
    // for the field assertions (PLAN.md §8). A foreign shape is covered by
    // the malformed-import tests, which never reach this cast.
    const parsed = JSON.parse(text) as { v: number; providers: ProviderEntry[] }
    expect(parsed.v).toBe(1)
    expect(parsed.providers).toEqual([OPENROUTER, LOCAL])
    expect(credentialKeys(parsed)).toEqual([])
    for (const secret of secrets.values.values()) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('previewProvidersImport', () => {
  it('preserves direct-import compat and previews compat-only edits (F3)', async () => {
    const document = { v: 1, providers: [CUSTOM] }
    expect(parseProvidersDocument(document).providers).toEqual([CUSTOM])
    const changed = { ...CUSTOM, compat: { ...CUSTOM.compat, toolChoice: 'auto' as const } }
    const preview = await previewProvidersImport(
      [CUSTOM],
      JSON.stringify({ v: 1, providers: [changed] }),
      POLICY,
    )
    expect(preview.rows).toEqual([
      { change: 'changed', entry: changed, needsKey: false, address: { kind: 'ok' } },
    ])
  })

  it('refuses malformed compat and compat on a fixed preset (F3)', () => {
    for (const entry of [
      { ...CUSTOM, compat: { toolChoice: 'bad' } },
      { ...CUSTOM, compat: { typo: true } },
      { ...OPENROUTER, compat: CUSTOM.compat },
    ]) {
      expect(() => parseProvidersDocument({ v: 1, providers: [entry] })).toThrow()
    }
  })

  it('diffs an import entry by entry, each needing its key', async () => {
    const changed: ProviderEntry = { ...OPENROUTER, models: ['other/model'] }
    const preview = await previewProvidersImport(
      [OPENROUTER, GROQ],
      JSON.stringify({ v: 1, providers: [changed, LOCAL] }),
      POLICY,
    )
    expect(preview.rows).toEqual([
      { change: 'changed', entry: changed, needsKey: true, address: { kind: 'ok' } },
      { change: 'added', entry: LOCAL, needsKey: false, address: { kind: 'ok' } },
      { change: 'removed', entry: GROQ, needsKey: false, address: undefined },
    ])
  })

  it('refuses an unreadable file, a bad shape and an empty id', async () => {
    await expect(previewProvidersImport([], 'not json{', POLICY)).rejects.toThrow()
    await expect(
      previewProvidersImport([], JSON.stringify({ v: 2, providers: [] }), POLICY),
    ).rejects.toThrow()
    await expect(
      previewProvidersImport(
        [],
        JSON.stringify({ v: 1, providers: [{ ...OPENROUTER, id: '  ' }] }),
        POLICY,
      ),
    ).rejects.toThrow()
  })

  it('never skips the address check', async () => {
    await expect(
      previewProvidersImport(
        [],
        JSON.stringify({
          v: 1,
          providers: [{ ...GROQ, address: 'https://attacker.example' }],
        }),
        POLICY,
      ),
    ).rejects.toThrow('groq')
  })
})

describe('importProviders', () => {
  it('rejects duplicate identities and invalid canonical fields before confirmation', async () => {
    const store = memoryStore([LOCAL])
    const confirm = vi.fn(() => Promise.resolve(true))
    const clearProviderCredential = vi.fn(() => Promise.resolve())
    for (const providers of [
      [OPENROUTER, OPENROUTER],
      [{ ...CUSTOM, modelLimits: undefined }],
      [{ ...OPENROUTER, auth: 'subscription' }],
    ]) {
      await expect(
        importProviders(
          { store, credentials: { clearProviderCredential }, policy: POLICY, confirm },
          JSON.stringify({ v: 1, providers }),
        ),
      ).rejects.toThrow()
    }
    expect(store.current).toEqual([LOCAL])
    expect(store.replaced).toEqual([])
    expect(confirm).not.toHaveBeenCalled()
    expect(clearProviderCredential).not.toHaveBeenCalled()
  })

  it('rechecks unchanged addresses and confirms private grants rather than trusting the document', async () => {
    const store = memoryStore([LOCAL])
    const check = vi.fn(() => Promise.resolve({ kind: 'refused' as const, detail: 'metadata' }))
    await expect(
      importProviders(
        { store, credentials, policy: { check }, confirm: () => Promise.resolve(true) },
        JSON.stringify({ v: 1, providers: [LOCAL] }),
      ),
    ).rejects.toThrow('metadata')
    expect(check).toHaveBeenCalledWith(LOCAL.address)
    const entry = { ...GROQ, address: 'https://lan.example' }
    const confirm = vi.fn(() => Promise.resolve(true))
    await importProviders(
      {
        store,
        credentials,
        policy: { check: () => Promise.resolve({ kind: 'private', address: entry.address }) },
        confirm,
      },
      JSON.stringify({ v: 1, providers: [entry] }),
    )
    expect(confirm.mock.calls[0]).toMatchObject([
      { rows: [{ address: { kind: 'private' } }, { change: 'removed' }] },
    ])
    expect(store.current).toEqual([{ ...entry, privateNetwork: true }])
  })

  it('keeps configuration/default intact when credential cleanup fails', async () => {
    const store = memoryStore([LOCAL])
    await store.setDefaultModel('ollama/qwen3:8b')
    const clearProviderCredential = vi.fn(() => Promise.reject(new Error('secret cleanup failed')))
    await expect(
      importProviders(
        {
          store,
          credentials: { clearProviderCredential },
          policy: POLICY,
          confirm: () => Promise.resolve(true),
        },
        JSON.stringify({ v: 1, providers: [OPENROUTER] }),
      ),
    ).rejects.toThrow('secret cleanup failed')
    expect(store.current).toEqual([LOCAL])
    expect(await store.defaultModel()).toBe('ollama/qwen3:8b')
    expect(store.replaced).toEqual([])
  })

  it('removes an old default when the replacement omits it and accepts bare Meta defaults', async () => {
    const store = memoryStore([OPENROUTER])
    await store.setDefaultModel('openrouter/openai/gpt-oss-20b')
    await importProviders(
      { store, credentials, policy: POLICY, confirm: () => Promise.resolve(true) },
      JSON.stringify({ v: 1, providers: [LOCAL] }),
    )
    expect(await store.defaultModel()).toBeUndefined()
    expect(
      parseProvidersDocument({ v: 1, providers: [LOCAL], defaultModel: 'muse-spark-1.3' })
        .defaultModel,
    ).toBe('muse-spark-1.3')
  })
  it('clears changed, unchanged and removed credentials only on confirmation (PR136 VS)', async () => {
    const secrets = memorySecrets()
    const credentials = new ProviderCredentialStore(secrets, unexpectedWarning)
    const store = memoryStore([OPENROUTER, GROQ, LOCAL])
    for (const entry of [OPENROUTER, GROQ, LOCAL]) {
      await credentials.setProviderCredential(entry.id, {
        v: 1,
        auth: 'apiKey',
        origin: new URL(entry.address).origin,
        secret: 'synthetic-old-key',
      })
    }
    const text = JSON.stringify({
      v: 1,
      providers: [{ ...OPENROUTER, models: ['changed'] }, LOCAL],
    })
    const deps = { store, policy: POLICY, credentials, confirm: () => Promise.resolve(false) }
    await importProviders(deps, text)
    expect(secrets.values.size).toBe(3)
    await importProviders({ ...deps, confirm: () => Promise.resolve(true) }, text)
    expect(secrets.values.size).toBe(0)
  })

  it('publishes providers and default together without a second default write (PR136 VZ)', async () => {
    const store = memoryStore([GROQ])
    const replace = vi.spyOn(store, 'replaceAll')
    const setDefault = vi
      .spyOn(store, 'setDefaultModel')
      .mockRejectedValue(new Error('second write'))
    const credentials = new ProviderCredentialStore(memorySecrets(), unexpectedWarning)
    await importProviders(
      { store, policy: POLICY, credentials, confirm: () => Promise.resolve(true) },
      JSON.stringify({
        v: 1,
        providers: [OPENROUTER],
        defaultModel: 'openrouter/openai/gpt-oss-20b',
      }),
    )
    expect(replace).toHaveBeenCalledExactlyOnceWith([OPENROUTER], {
      defaultModel: 'openrouter/openai/gpt-oss-20b',
    })
    expect(setDefault).not.toHaveBeenCalled()
    expect(await store.defaultModel()).toBe('openrouter/openai/gpt-oss-20b')
  })
  it('replaces the file after confirmation', async () => {
    const store = memoryStore([GROQ])
    const confirm = vi.fn((_preview: ImportPreview) => Promise.resolve(true))
    const count = await importProviders(
      { store, credentials, policy: POLICY, confirm },
      JSON.stringify({ v: 1, providers: [OPENROUTER] }),
    )
    expect(count).toBe(1)
    expect(store.replaced).toEqual([[OPENROUTER]])
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ rows: expect.any(Array) })
  })

  it('writes nothing when dismissed, unreadable or refused', async () => {
    const store = memoryStore([GROQ])
    const confirm = vi.fn(() => Promise.resolve(false))
    await expect(
      importProviders(
        { store, credentials, policy: POLICY, confirm },
        JSON.stringify({ v: 1, providers: [OPENROUTER] }),
      ),
    ).resolves.toBe(0)
    expect(store.replaced).toEqual([])
    await expect(
      importProviders({ store, credentials, policy: POLICY, confirm }, 'broken'),
    ).rejects.toThrow()
    await expect(
      importProviders(
        { store, credentials, policy: POLICY, confirm: () => Promise.resolve(true) },
        JSON.stringify({
          v: 1,
          providers: [{ ...GROQ, address: 'https://attacker.example' }],
        }),
      ),
    ).rejects.toThrow()
    expect(store.replaced).toEqual([])
  })
})
