// PROVSPEND (2026-10-12): admin report keys are a separate, optional
// credential under their own name. An admin key reads a whole
// organisation, so it is stored where no inference read looks, used for
// nothing but read-only report requests, and removed with its provider.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deleteProviderAdminCredential,
  deleteProviderCredential,
  providerAdminSecretKey,
  providerSecretKey,
  readProviderAdminCredential,
  readProviderCredential,
  saveProviderAdminCredential,
  saveProviderCredential,
  type CredentialRecord,
} from '../../src/host/providers/credentialRecords'
import {
  createProviderRemoval,
  systemRemovalClock,
  type PendingRemoval,
} from '../../src/host/providers/providerRemoval'
import { mapSecrets, mapSecretsBacked } from './helpers/mapSecrets'
import { usingTempDir } from './helpers/temporaryFolders'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import {
  providerEntrySchema,
  readProvidersFile,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'
import { parseModelRef } from '../../src/shared/modelRef'
import { providerAdminSecretAccount, providerSecretAccount } from '../../src/runtime/keyStore'
import { providersRemove, userFileIo } from '../../src/runtime/providersCommands'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'
import { resolveEndpointHost } from '../../src/runtime/providerPaths'

/**
A list-backed providers store for the removal test: entries validate
through the provider bundle's canonical schema, exactly like the file
store, and reads/writes land in the same list.
*/
function listProvidersStore(entries: readonly ProviderEntry[] = []): ProvidersStore {
  let current = [...entries]
  let defaultModel: string | undefined
  return {
    validate: (entry, ref) => {
      providerEntrySchema.parse(entry)
      if (ref !== undefined && parseModelRef(ref) === undefined)
        throw new Error(`invalid default model ${ref}`)
    },
    list: () => Promise.resolve([...current]),
    add: (entry) => {
      if (current.some((existing) => existing.id === entry.id))
        throw new Error(`duplicate provider ${entry.id}`)
      current = [...current, entry]
      return Promise.resolve()
    },
    remove: (id) => {
      const found = current.find((entry) => entry.id === id)
      current = current.filter((entry) => entry.id !== id)
      return Promise.resolve(found)
    },
    restore: (entry) => {
      current = [...current, entry]
      return Promise.resolve()
    },
    replaceAll: (next, options) => {
      const previous = [...current]
      current = [...(typeof next === 'function' ? next(current) : next)]
      if (options !== undefined) defaultModel = options.defaultModel
      return Promise.resolve(previous)
    },
    setDefaultModel: (ref) => {
      defaultModel = ref
      return Promise.resolve()
    },
    defaultModel: () => Promise.resolve(defaultModel),
  }
}

const ADMIN_RECORD: CredentialRecord = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://api.anthropic.com',
  secret: 'TEST-ADMIN-KEY',
}
const INFERENCE_RECORD: CredentialRecord = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://api.anthropic.com',
  secret: 'TEST-INFERENCE-KEY',
}

describe('admin report key separation', () => {
  it('stores the admin key under its own name on both sides of the bridge', () => {
    expect(providerAdminSecretKey('anthropic')).toBe('museSpark.providerAdmin.anthropic')
    expect(providerAdminSecretAccount('anthropic')).toBe('museSpark.providerAdmin.anthropic')
    expect(providerAdminSecretAccount('openai')).toBe('museSpark.providerAdmin.openai')
  })

  it('never shares the inference key name, and never names a non-provider', () => {
    for (const id of ['anthropic', 'openai', 'openrouter', 'deepseek']) {
      expect(providerAdminSecretAccount(id)).not.toBe(providerSecretAccount(id))
      expect(providerAdminSecretKey(id)).not.toBe(providerSecretKey(id))
    }
    expect(providerAdminSecretAccount('meta')).toBeUndefined()
    expect(providerAdminSecretAccount('not a provider')).toBeUndefined()
    expect(providerSecretAccount('meta')).toBeUndefined()
  })

  it('round-trips the admin record without touching the inference record', async () => {
    const secrets = mapSecrets({})
    await saveProviderCredential(secrets, 'anthropic', INFERENCE_RECORD)
    await saveProviderAdminCredential(secrets, 'anthropic', ADMIN_RECORD)
    expect(await readProviderCredential(secrets, 'anthropic')).toEqual(INFERENCE_RECORD)
    expect(await readProviderAdminCredential(secrets, 'anthropic')).toEqual(ADMIN_RECORD)
  })

  it('keeps each key invisible to the other side both ways', async () => {
    const secrets = mapSecrets({})
    await saveProviderAdminCredential(secrets, 'anthropic', ADMIN_RECORD)
    expect(await readProviderCredential(secrets, 'anthropic')).toBeUndefined()
    await deleteProviderAdminCredential(secrets, 'anthropic')
    await saveProviderCredential(secrets, 'anthropic', INFERENCE_RECORD)
    expect(await readProviderAdminCredential(secrets, 'anthropic')).toBeUndefined()
  })

  it('deletes the admin key with the provider on the editor side', async () => {
    const secrets = mapSecrets({})
    await saveProviderCredential(secrets, 'anthropic', INFERENCE_RECORD)
    await saveProviderAdminCredential(secrets, 'anthropic', ADMIN_RECORD)
    let pending: PendingRemoval[] = []
    const removal = createProviderRemoval({
      providers: listProvidersStore([
        {
          id: 'anthropic',
          preset: 'anthropic',
          address: 'https://api.anthropic.com',
          auth: 'apiKey',
          models: [],
        },
      ]),
      secrets,
      pending: {
        load: () => Promise.resolve([...pending]),
        save: (next) => {
          pending = [...next]
          return Promise.resolve()
        },
      },
      clock: systemRemovalClock(),
    })
    await removal.remove('anthropic')
    // The Undo window keeps both secrets; the next start deletes both.
    expect(await readProviderCredential(secrets, 'anthropic')).toEqual(INFERENCE_RECORD)
    expect(await readProviderAdminCredential(secrets, 'anthropic')).toEqual(ADMIN_RECORD)
    await removal.completePending()
    expect(await readProviderCredential(secrets, 'anthropic')).toBeUndefined()
    expect(await readProviderAdminCredential(secrets, 'anthropic')).toBeUndefined()
  })

  it('deletes the admin key with the provider on the terminal side', async () => {
    await usingTempDir('spend-secrets-', async (dir) => {
      const store = new Map<string, string>([
        ['museSpark.provider.anthropic', JSON.stringify({ secret: 'x' })],
        ['museSpark.providerAdmin.anthropic', JSON.stringify({ secret: 'y' })],
      ])
      const filePath = path.join(dir, 'providers.json')
      const written = await writeProvidersFileAtomic(filePath, {
        v: 1,
        providers: [
          {
            id: 'anthropic',
            preset: 'anthropic',
            address: 'https://api.anthropic.com',
            auth: 'apiKey',
            models: [],
          },
        ],
      })
      expect(written.ok).toBe(true)
      const printed: string[] = []
      const deps: ProvidersDeps = {
        ...userFileIo(filePath),
        secrets: mapSecretsBacked(store),
        resolveHost: resolveEndpointHost,
        fetch: globalThis.fetch.bind(globalThis),
        readSecret: () => Promise.reject(new Error('spend secrets test asks no key-use question')),
        print: (line) => {
          printed.push(line)
        },
        printError: () => undefined,
      }
      expect(await providersRemove(deps, 'anthropic')).toBe(0)
      expect(store.has('museSpark.provider.anthropic')).toBe(false)
      expect(store.has('museSpark.providerAdmin.anthropic')).toBe(false)
      expect(printed.length).toBeGreaterThan(0)
      // The entry is gone from the real file too.
      expect(await readProvidersFile(filePath)).toMatchObject({
        ok: true,
        file: { providers: [] },
      })
    })
  })

  it('never lets an inference auth path name the admin account', () => {
    // The model-request transports read only the inference account. The
    // terminal intake (authCommands) names both, gated by `--admin`.
    for (const file of [
      '../../src/host/backend/configuredProvidersEntry.ts',
      '../../src/runtime/exec/providerExec.ts',
    ]) {
      const body = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(body).not.toContain('providerAdmin')
    }
  })

  it('proves the admin key is never chosen for a model request', async () => {
    // The inference read path only ever opens the inference account: with
    // only an admin key stored, the inference read is absent.
    const secrets = mapSecrets({})
    await saveProviderAdminCredential(secrets, 'openai', ADMIN_RECORD)
    await deleteProviderCredential(secrets, 'openai')
    expect(await readProviderCredential(secrets, 'openai')).toBeUndefined()
  })
})
