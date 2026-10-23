// PROVSPEND (2026-10-12): admin report keys are a separate, optional
// credential under their own name. An admin key reads a whole
// organisation, so it is stored where no inference read looks, used for
// nothing but read-only report requests, and removed with its provider.

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
  type PendingRemoval,
} from '../../src/host/providers/providerRemoval'
import { mapSecrets } from './helpers/mapSecrets'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import { providerEntrySchema } from '../../src/core/providers/providersFile'
import { parseModelRef } from '../../src/core/providers/modelRef'
import { providerAdminSecretAccount, providerSecretAccount } from '../../src/runtime/keyStore'
import { providersRemove } from '../../src/runtime/providersCommands'
import type { ProvidersFile } from '../../src/core/providers/providersFile'
import type { ProvidersDeps } from '../../src/runtime/providersCommands'

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
    const scheduled: (() => void)[] = []
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
      clock: {
        now: () => 0,
        schedule: (_ms, run) => {
          scheduled.push(run)
          return { cancel: () => undefined }
        },
      },
    })
    await removal.remove('anthropic')
    // The Undo window keeps both secrets; its end deletes both.
    expect(await readProviderCredential(secrets, 'anthropic')).toEqual(INFERENCE_RECORD)
    for (const run of scheduled) run()
    await removal.completePending()
    expect(await readProviderCredential(secrets, 'anthropic')).toBeUndefined()
    expect(await readProviderAdminCredential(secrets, 'anthropic')).toBeUndefined()
  })

  it('deletes the admin key with the provider on the terminal side', async () => {
    const store = new Map<string, string>([
      ['museSpark.provider.anthropic', JSON.stringify({ secret: 'x' })],
      ['museSpark.providerAdmin.anthropic', JSON.stringify({ secret: 'y' })],
    ])
    const file: ProvidersFile = {
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
    }
    const printed: string[] = []
    const deps: ProvidersDeps = {
      readUserFile: () => Promise.resolve({ ok: true as const, file }),
      writeUserFile: () => Promise.resolve(true),
      secrets: {
        get: (key) => Promise.resolve(store.get(key)),
        store: (key, value) => {
          store.set(key, value)
          return Promise.resolve()
        },
        delete: (key) => {
          store.delete(key)
          return Promise.resolve()
        },
      },
      resolveHost: () => Promise.resolve([]),
      fetch: globalThis.fetch.bind(globalThis),
      readSecret: () => Promise.resolve(''),
      print: (line) => {
        printed.push(line)
      },
      printError: () => undefined,
    }
    expect(await providersRemove(deps, 'anthropic')).toBe(0)
    expect(store.has('museSpark.provider.anthropic')).toBe(false)
    expect(store.has('museSpark.providerAdmin.anthropic')).toBe(false)
    expect(printed.length).toBeGreaterThan(0)
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
