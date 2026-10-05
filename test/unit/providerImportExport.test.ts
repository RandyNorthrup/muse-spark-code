// M95 lane K (PLAN.md D74, M95 acceptance 17 and Tests): an export holds
// no credential, and an import is validated, previewed and confirmed
// address by address.

import { describe, expect, it, vi } from 'vitest'
import {
  exportProviders,
  importProviders,
  previewProvidersImport,
  type ImportPreview,
} from '../../src/host/providers/importExport'
import type { AddressPolicy, ProviderEntry } from '../../src/host/providers/providerPorts'
import { memoryProvidersStore, memorySecrets } from './helpers/fakes'
import { saveProviderCredential } from '../../src/host/providers/credentialRecords'

const OPENROUTER: ProviderEntry = {
  id: 'openrouter',
  presetId: 'openrouter',
  address: 'https://openrouter.ai',
  auth: 'oauth',
  models: ['openai/gpt-oss-20b'],
}

const GROQ: ProviderEntry = {
  id: 'groq',
  presetId: 'groq',
  address: 'https://api.groq.com/openai/v1',
  auth: 'apiKey',
  models: [],
}

const LOCAL: ProviderEntry = {
  id: 'ollama',
  presetId: 'ollama',
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
  it('exports the non-secret configuration with no credential field', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openrouter', {
      v: 1,
      auth: 'oauth',
      origin: 'https://openrouter.ai',
      secret: '[REDACTED]',
    })
    const text = await exportProviders(memoryStore([OPENROUTER, LOCAL]))
    // The text is this lane's own export; the cast names its document shape
    // for the field assertions (PLAN.md §8). A foreign shape is covered by
    // the malformed-import tests, which never reach this cast.
    const parsed = JSON.parse(text) as { version: number; providers: ProviderEntry[] }
    expect(parsed.version).toBe(1)
    expect(parsed.providers).toEqual([OPENROUTER, LOCAL])
    expect(credentialKeys(parsed)).toEqual([])
    for (const secret of secrets.values.values()) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('previewProvidersImport', () => {
  it('diffs an import entry by entry, each needing its key', () => {
    const changed: ProviderEntry = { ...OPENROUTER, models: ['other/model'] }
    const preview = previewProvidersImport(
      [OPENROUTER, GROQ],
      JSON.stringify({ version: 1, providers: [changed, LOCAL] }),
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
      previewProvidersImport([], JSON.stringify({ version: 2, providers: [] }), POLICY),
    ).toThrow()
    expect(() =>
      previewProvidersImport(
        [],
        JSON.stringify({ version: 1, providers: [{ ...OPENROUTER, id: '  ' }] }),
        POLICY,
      ),
    ).toThrow()
  })

  it('never skips the address check', () => {
    expect(() =>
      previewProvidersImport(
        [],
        JSON.stringify({
          version: 1,
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
      JSON.stringify({ version: 1, providers: [OPENROUTER] }),
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
        JSON.stringify({ version: 1, providers: [OPENROUTER] }),
      ),
    ).resolves.toBe(0)
    expect(store.replaced).toEqual([])
    await expect(importProviders({ store, policy: POLICY, confirm }, 'broken')).rejects.toThrow()
    await expect(
      importProviders(
        { store, policy: POLICY, confirm: () => Promise.resolve(true) },
        JSON.stringify({
          version: 1,
          providers: [{ ...GROQ, address: 'https://attacker.example' }],
        }),
      ),
    ).rejects.toThrow()
    expect(store.replaced).toEqual([])
  })
})
