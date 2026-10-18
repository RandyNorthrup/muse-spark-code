// The key-store migration against a real VaultStore: real files under a real
// temporary root, real recovery-slot crypto, the real engine with its real
// journal rows in the same store. Needs the writer lease's process-birth
// evidence (`/bin/ps` on macOS), which the lane sandbox denies, so this file
// runs on CI and outside the sandbox; the broker-free seams it drives are
// covered in CI the same way brokerSession and writerCrashPosix are.
import { mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { NodeVaultFiles, VaultStore } from '../../../src/core/vault/store'
import type { VaultAnchorPort } from '../../../src/core/vault/broker/repository'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import { UI_TEXT, VAULT_LIMITS } from '../../../src/shared/constants'
import type { VaultItem, VaultItemMetadata } from '../../../src/shared/vault'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { Logger } from '../../../src/host/logger'
import {
  CredentialMigrationController,
  type CredentialMigrationPorts,
} from '../../../src/host/vault/migrateCredentials'

const now = () => 1_700_000_000_000
const MODEL_API_KEY = 'LLM_0123456789abcdef'
const PROVIDER_KEY = 'museSpark.provider.openrouter'
const API_KEY_RECORD = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://openrouter.ai',
  secret: 'not-a-real-key-for-tests',
}
const vaultId = 'b'.repeat(32)

function mapSecrets(initial: Readonly<Record<string, string>> = {}): {
  store: SecretStore
  saved: Map<string, string>
} {
  const saved = new Map(Object.entries(initial))
  return {
    saved,
    store: {
      get: (key) => Promise.resolve(saved.get(key)),
      store: (key, value) => {
        saved.set(key, value)
        return Promise.resolve()
      },
      delete: (key) => {
        saved.delete(key)
        return Promise.resolve()
      },
    },
  }
}

const quiet: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const openStores: { directory: string; store: VaultStore; key: Buffer }[] = []

function liveStore(): VaultStore {
  const current = openStores.at(-1)
  if (current === undefined) throw new Error('store not open')
  return current.store
}

interface FailAfter {
  /** Writes succeed until this many land; the next one throws, once. */
  failAfter: number
  seen: number
  failed: boolean
}

function ports(failWrites: FailAfter): CredentialMigrationPorts {
  return {
    snapshot: async () => ({ items: await liveStore().list() }),
    write: async (item, isEdit, authorize) => {
      failWrites.seen += 1
      if (!failWrites.failed && failWrites.seen > failWrites.failAfter) {
        failWrites.failed = true
        throw new Error('injected write failure')
      }
      authorize?.()
      await liveStore().write(item, isEdit ? 'present' : 'absent')
    },
    remove: async (id, authorize) => {
      authorize?.()
      await liveStore().remove(id)
    },
    firstPartyRead: async (request) => {
      const item = await liveStore().read(request.itemId)
      if (item.material.kind !== 'apiKey') throw new Error('peer refused')
      const value = Buffer.alloc(item.material.value.byteLength)
      value.set(item.material.value)
      return value
    },
  }
}

/** Migrated credential rows (journal rows are `migration-*`). */
async function credentialItems(): Promise<VaultItemMetadata[]> {
  const store = liveStore()
  const items = await store.list()
  return items.filter((entry) => !entry.name.startsWith('migration-'))
}

async function credentialCount(): Promise<number> {
  const items = await credentialItems()
  return items.length
}

async function readCredential(id: string): Promise<VaultItem> {
  const store = liveStore()
  return await store.read(id)
}

beforeEach(async () => {
  // The vault refuses roots under a symlinked ancestor (macOS spells its
  // temporary root through /var, a symlink to /private/var): resolve to the
  // real path, the same pattern the broker fixtures use.
  let base = tmpdir()
  try {
    base = realpathSync(base)
  } catch {
    /* The store open below reports the unusable base instead. */
  }
  const directory = await mkdtemp(path.join(base, 'v-migrate-'))
  const key = randomBytes(32)
  const files = new NodeVaultFiles(path.join(directory, 'vault'), VAULT_LIMITS.frameBytes)
  // The test's own protected anchor, like the crash fixture's: file-backed,
  // compare-and-operate, never a vault value.
  const anchorPath = path.join(directory, 'protected-anchor.json')
  const stateSchema = z.strictObject({
    generation: z.number(),
    auditGeneration: z.number(),
    auditHead: z.string(),
    stateDigest: z.string(),
  })
  type AnchorState = z.infer<typeof stateSchema>
  const anchor: VaultAnchorPort = {
    vaultId: () => Promise.resolve(vaultId),
    minimum: async (): Promise<AnchorState | null> => {
      try {
        const raw = await readFile(anchorPath)
        return stateSchema.parse(JSON.parse(raw.toString()))
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null
        throw error
      }
    },
    advance: async (id: string, state: AnchorState, prior: AnchorState | null) => {
      if (id !== vaultId || JSON.stringify(await anchor.minimum(vaultId)) !== JSON.stringify(prior))
        throw new Error('anchor mismatch')
      await writeFile(`${anchorPath}.tmp`, JSON.stringify(state), { mode: 0o600 })
      await rename(`${anchorPath}.tmp`, anchorPath)
    },
    reset: async (id: string, expected: AnchorState | null, authorize: () => void) => {
      authorize()
      if (
        id !== vaultId ||
        JSON.stringify(await anchor.minimum(vaultId)) !== JSON.stringify(expected)
      )
        throw new Error('anchor mismatch')
      await unlink(anchorPath)
    },
  }
  const recovery = createRecoverySlot(key, vaultId, { now: Date.now })
  try {
    const store = await VaultStore.create({ files, anchor, key }, vaultId, [recovery.slot])
    openStores.push({ directory, store, key })
  } finally {
    recovery.code.fill(0)
  }
})

afterEach(async () => {
  const current = openStores.pop()
  current?.store.lock()
  current?.key.fill(0)
  if (current) await rm(current.directory, { recursive: true, force: true })
})

function noFail(): FailAfter {
  return { failAfter: Number.MAX_SAFE_INTEGER, seen: 0, failed: false }
}

function controller(
  secrets: SecretStore,
  providerIds: readonly string[],
  failWrites: FailAfter,
): CredentialMigrationController {
  return new CredentialMigrationController({
    secrets,
    listProviderIds: () => Promise.resolve(providerIds),
    ports: ports(failWrites),
    minorRelease: () => 19,
    now,
    label: UI_TEXT.vault.secret,
    log: quiet,
  })
}

describe('key-store migration against a real store', () => {
  it('copies the model API key and a provider key, verified, legacy retained', async () => {
    const { store, saved } = mapSecrets({
      'museSpark.modelApiKey': MODEL_API_KEY,
      [PROVIDER_KEY]: JSON.stringify(API_KEY_RECORD),
    })
    await controller(store, ['openrouter'], noFail()).ensureMigrated()
    // The old store stays readable until the vault copy is proven.
    expect(saved.get('museSpark.modelApiKey')).toBe(MODEL_API_KEY)
    expect(saved.get(PROVIDER_KEY)).toBe(JSON.stringify(API_KEY_RECORD))
    const items = await credentialItems()
    expect(items.length).toBe(2)
    expect(items.every((entry) => entry.hidden && entry.firstParty)).toBe(true)
    // A second run repeats cleanly: nothing new, nothing lost.
    await controller(store, ['openrouter'], noFail()).ensureMigrated()
    expect(saved.get('museSpark.modelApiKey')).toBe(MODEL_API_KEY)
    expect(await credentialCount()).toBe(2)
  })

  it('finishes an interrupted copy on the next run with the legacy value whole', async () => {
    const { store, saved } = mapSecrets({ 'museSpark.modelApiKey': MODEL_API_KEY })
    // The second vault write strands a `copying` journal row, like a crash
    // between the journal commit and the vault commit.
    await controller(store, [], { failAfter: 1, seen: 0, failed: false }).ensureMigrated()
    expect(saved.get('museSpark.modelApiKey')).toBe(MODEL_API_KEY)
    expect(await credentialItems()).toEqual([])
    await controller(store, [], noFail()).ensureMigrated()
    expect(saved.get('museSpark.modelApiKey')).toBe(MODEL_API_KEY)
    expect(await credentialCount()).toBe(1)
  })

  it('rotates the vault copy when SecretStorage changed while locked', async () => {
    const { store, saved } = mapSecrets({ 'museSpark.modelApiKey': MODEL_API_KEY })
    await controller(store, [], noFail()).ensureMigrated()
    const rotated = 'LLM_fedcba9876543210'
    saved.set('museSpark.modelApiKey', rotated)
    await controller(store, [], noFail()).ensureMigrated()
    expect(saved.get('museSpark.modelApiKey')).toBe(rotated)
    const found = await credentialItems()
    const [credential] = found
    if (credential === undefined) throw new Error('missing migrated item')
    const item: VaultItem = await readCredential(credential.id)
    if (item.material.kind !== 'apiKey') throw new Error('expected the migrated apiKey row')
    expect(Buffer.from(item.material.value).toString('utf8')).toBe(rotated)
  })

  it('mirrors writes into the vault copy', async () => {
    const { store, saved } = mapSecrets({ 'museSpark.modelApiKey': MODEL_API_KEY })
    const active = controller(store, [], noFail())
    await active.ensureMigrated()
    const rotated = 'LLM_AAAAAAAAAAAAAAAA'
    saved.set('museSpark.modelApiKey', rotated)
    await active.mirrorWrite('museSpark.modelApiKey', rotated)
    const found = await credentialItems()
    const [credential] = found
    if (credential === undefined) throw new Error('missing migrated item')
    const item: VaultItem = await readCredential(credential.id)
    if (item.material.kind !== 'apiKey') throw new Error('expected the migrated apiKey row')
    expect(Buffer.from(item.material.value).toString('utf8')).toBe(rotated)
  })

  it('mirrors removals out of both copies', async () => {
    const { store, saved } = mapSecrets({ 'museSpark.modelApiKey': MODEL_API_KEY })
    const active = controller(store, [], noFail())
    await active.ensureMigrated()
    expect(await credentialCount()).toBe(1)
    saved.delete('museSpark.modelApiKey')
    await active.mirrorDelete('museSpark.modelApiKey')
    expect(await credentialCount()).toBe(0)
  })

  it('reads the migrated vault item material back with its exact bytes', async () => {
    const { store } = mapSecrets({ 'museSpark.modelApiKey': MODEL_API_KEY })
    await controller(store, [], noFail()).ensureMigrated()
    const found = await credentialItems()
    const [credential] = found
    if (credential === undefined) throw new Error('missing migrated item')
    const item: VaultItem = await readCredential(credential.id)
    if (item.material.kind !== 'apiKey') throw new Error('expected the migrated apiKey row')
    expect(Buffer.from(item.material.value).toString('utf8')).toBe(MODEL_API_KEY)
  })
})
