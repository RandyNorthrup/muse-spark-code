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
import { memoryProvidersStore, memorySecrets } from './helpers/fakes'
import { saveProviderCredential } from '../../src/host/providers/credentialRecords'
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
  it('preserves custom compat through export and confirmed re-import (F3)', async () => {
    expect(providerEntrySchema.parse(CUSTOM)).toEqual(CUSTOM)
    const exported = await exportProviders(memoryStore([CUSTOM]))
    expect(JSON.parse(exported)).toEqual({ v: 1, providers: [CUSTOM] })
    const target = memoryStore()
    await importProviders(
      { store: target, policy: POLICY, confirm: () => Promise.resolve(true) },
      exported,
    )
    expect(target.current).toEqual([CUSTOM])
    expect(providerEntrySchema.parse(target.current[0])).toEqual(CUSTOM)
  })

  it('round-trips canonical provider options and the default model', async () => {
    const entry: ProviderEntry = {
      ...OPENROUTER,
      format: 'chat',
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
      { store: target, policy: POLICY, confirm: () => Promise.resolve(true) },
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
  it('preserves direct-import compat and previews compat-only edits (F3)', () => {
    const document = { v: 1, providers: [CUSTOM] }
    expect(parseProvidersDocument(document).providers).toEqual([CUSTOM])
    const changed = { ...CUSTOM, compat: { ...CUSTOM.compat, toolChoice: 'auto' as const } }
    expect(
      previewProvidersImport([CUSTOM], JSON.stringify({ v: 1, providers: [changed] }), POLICY).rows,
    ).toEqual([{ change: 'changed', entry: changed, needsKey: false, address: { kind: 'ok' } }])
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

  it('diffs an import entry by entry, each needing its key', () => {
    const changed: ProviderEntry = { ...OPENROUTER, models: ['other/model'] }
    const preview = previewProvidersImport(
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

  it('refuses an unreadable file, a bad shape and an empty id', () => {
    expect(() => previewProvidersImport([], 'not json{', POLICY)).toThrow()
    expect(() =>
      previewProvidersImport([], JSON.stringify({ v: 2, providers: [] }), POLICY),
    ).toThrow()
    expect(() =>
      previewProvidersImport(
        [],
        JSON.stringify({ v: 1, providers: [{ ...OPENROUTER, id: '  ' }] }),
        POLICY,
      ),
    ).toThrow()
  })

  it('never skips the address check', () => {
    expect(() =>
      previewProvidersImport(
        [],
        JSON.stringify({
          v: 1,
          providers: [{ ...GROQ, address: 'https://attacker.example' }],
        }),
        POLICY,
      ),
    ).toThrow('groq')
  })
})

describe('importProviders', () => {
  it('replaces the file after confirmation', async () => {
    const store = memoryStore([GROQ])
    const confirm = vi.fn((_preview: ImportPreview) => Promise.resolve(true))
    const count = await importProviders(
      { store, policy: POLICY, confirm },
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
        { store, policy: POLICY, confirm },
        JSON.stringify({ v: 1, providers: [OPENROUTER] }),
      ),
    ).resolves.toBe(0)
    expect(store.replaced).toEqual([])
    await expect(importProviders({ store, policy: POLICY, confirm }, 'broken')).rejects.toThrow()
    await expect(
      importProviders(
        { store, policy: POLICY, confirm: () => Promise.resolve(true) },
        JSON.stringify({
          v: 1,
          providers: [{ ...GROQ, address: 'https://attacker.example' }],
        }),
      ),
    ).rejects.toThrow()
    expect(store.replaced).toEqual([])
  })
})
