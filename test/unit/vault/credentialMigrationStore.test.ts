// The key-store migration against a real VaultStore and a real persisted
// secret store: real files under real temporary roots, real recovery-slot
// crypto, the real shell, the real controller and its real journal rows in
// the same store. Key values are generated at runtime (pattern-valid, never
// issued, never sent), so no secret-shaped literal sits in the tree.
//
// Two tests force an interleaving the real world produces at random, with a
// gate on the persisted secret writes: every byte still lands in the real
// files, the gate only decides when. One test simulates a crash between the
// vault commit and the legacy write by failing that single write once; the
// vault commits around it are all real.
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
import { SECRET_KEYS, UI_TEXT, VAULT_LIMITS } from '../../../src/shared/constants'
import type { VaultItem, VaultItemMetadata } from '../../../src/shared/vault'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { Logger } from '../../../src/host/logger'
import { capturingLog, closeSecrets, fileSecrets } from '../helpers/vault/migrationFixtures'
import {
  CredentialMigrationController,
  type CredentialMigrationPorts,
} from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'

const now = () => 1_700_000_000_000
const MODEL_API_KEY = SECRET_KEYS.modelApiKey
const PROVIDER_KEY = 'museSpark.provider.openrouter'
/** Pattern-valid Model API values, generated per run: never issued, never sent. */
const modelApiKey = () => `LLM_${randomBytes(12).toString('hex')}`
const providerSecret = () => randomBytes(16).toString('hex')
const apiKeyRecord = (secret: string) => ({
  v: 1,
  auth: 'apiKey',
  origin: 'https://openrouter.ai',
  secret,
})
const oauthRecord = (secret: string) => ({
  v: 1,
  auth: 'oauth',
  origin: 'https://openrouter.ai',
  secret,
})
const vaultId = 'b'.repeat(32)

const quiet: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const openStores: { directory: string; store: VaultStore; key: Buffer }[] = []
const secretDirs: string[] = []

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

/** A migrated apiKey row's bytes: the full key, or a provider record's secret. */
async function readMigratedSecret(): Promise<string> {
  const found = await credentialItems()
  const [credential] = found
  if (credential === undefined || found.length !== 1) throw new Error('missing migrated item')
  const item: VaultItem = await readCredential(credential.id)
  if (item.material.kind !== 'apiKey') throw new Error('expected the migrated apiKey row')
  return Buffer.from(item.material.value).toString('utf8')
}

/**
 * Pause one persisted secret write until released. Every byte still lands
 * in the real files; the gate only holds the commit so a save can land
 * mid-migration, the way a save during unlock does.
 */
function gateValue(
  inner: SecretStore,
  value: string,
): { store: SecretStore; hit: () => Promise<void>; release: () => void } {
  let hits = 0
  let notify: (() => void) | null = null
  const blocked: (() => void)[] = []
  return {
    store: {
      get: (key) => inner.get(key),
      delete: (key) => inner.delete(key),
      store: async (key, next) => {
        if (next === value) {
          hits += 1
          notify?.()
          await new Promise<void>((resolve) => {
            blocked.push(resolve)
          })
        }
        await inner.store(key, next)
      },
    },
    hit: () =>
      new Promise<void>((resolve) => {
        if (hits > 0) resolve()
        else notify = resolve
      }),
    release: () => {
      for (const resolve of blocked.splice(0)) {
        resolve()
      }
    },
  }
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
  while (secretDirs.length > 0) await closeSecrets(secretDirs.pop()!)
})

function noFail(): FailAfter {
  return { failAfter: Number.MAX_SAFE_INTEGER, seen: 0, failed: false }
}

function controller(
  secrets: SecretStore,
  providerIds: readonly string[],
  failWrites: FailAfter,
  log: Logger = quiet,
): CredentialMigrationController {
  return new CredentialMigrationController({
    secrets,
    listProviderIds: () => Promise.resolve(providerIds),
    ports: ports(failWrites),
    minorRelease: () => 19,
    now,
    label: UI_TEXT.vault.secret,
    log,
  })
}

async function persistedSecrets(
  initial: Readonly<Record<string, string>> = {},
): Promise<SecretStore> {
  const { store, dir } = await fileSecrets()
  secretDirs.push(dir)
  for (const [key, value] of Object.entries(initial)) await store.store(key, value)
  return store
}

/** The real shell bound to a migrated controller, as the unlock edge leaves it. */
async function migratedShell(
  store: SecretStore,
  providerIds: readonly string[],
): Promise<{
  shell: ReturnType<typeof createMigrationShell>
  active: CredentialMigrationController
}> {
  const shell = createMigrationShell(store)
  const active = controller(store, providerIds, noFail())
  shell.bind(active)
  await active.ensureMigrated()
  return { shell, active }
}

/** Remove the migrated key through the shell, asserting both copies drop. */
async function removeMigratedKey(shell: ReturnType<typeof createMigrationShell>): Promise<void> {
  expect(await credentialCount()).toBe(1)
  await shell.store.delete(MODEL_API_KEY)
  expect(await credentialCount()).toBe(0)
}

describe('key-store migration against a real store', () => {
  it('copies the model API key and a provider key, verified, legacy retained', async () => {
    const first = modelApiKey()
    const secret = providerSecret()
    const store = await persistedSecrets({
      [MODEL_API_KEY]: first,
      [PROVIDER_KEY]: JSON.stringify(apiKeyRecord(secret)),
    })
    await controller(store, ['openrouter'], noFail()).ensureMigrated()
    // The old store stays readable until the vault copy is proven.
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await store.get(PROVIDER_KEY)).toBe(JSON.stringify(apiKeyRecord(secret)))
    const items = await credentialItems()
    expect(items.length).toBe(2)
    expect(items.every((entry) => entry.hidden && entry.firstParty)).toBe(true)
    // A second run repeats cleanly: nothing new, nothing lost.
    await controller(store, ['openrouter'], noFail()).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialCount()).toBe(2)
  })

  it('finishes an interrupted copy on the next run with the legacy value whole', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    // The second vault write strands a `copying` journal row, like a crash
    // between the journal commit and the vault commit.
    await controller(store, [], { failAfter: 1, seen: 0, failed: false }).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialItems()).toEqual([])
    await controller(store, [], noFail()).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialCount()).toBe(1)
  })

  it('rotates the vault copy when SecretStorage changed while locked', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    await controller(store, [], noFail()).ensureMigrated()
    const rotated = modelApiKey()
    await store.store(MODEL_API_KEY, rotated)
    await controller(store, [], noFail()).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(rotated)
    expect(await readMigratedSecret()).toBe(rotated)
  })

  it('a save during unlock never replaces the newer key', async () => {
    const first = modelApiKey()
    const older = modelApiKey()
    const newer = modelApiKey()
    const inner = await persistedSecrets({ [MODEL_API_KEY]: first })
    const gate = gateValue(inner, older)
    const { shell, active } = await migratedShell(gate.store, [])
    // The legacy value changes while locked; the heal below reads `older`.
    await inner.store(MODEL_API_KEY, older)
    const heal = active.ensureMigrated()
    await gate.hit()
    // The person's save lands (in SecretStorage) while the heal of `older`
    // is inside its vault write; its mirror follows the heal.
    const save = shell.store.store(MODEL_API_KEY, newer)
    gate.release()
    await heal
    await save
    await active.ensureMigrated()
    expect(await gate.store.get(MODEL_API_KEY)).toBe(newer)
    expect(await readMigratedSecret()).toBe(newer)
  })

  it('a key saved after sign-out migrates on save', async () => {
    const first = modelApiKey()
    const second = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    const { shell } = await migratedShell(store, [])
    await removeMigratedKey(shell)
    await shell.store.store(MODEL_API_KEY, second)
    expect(await store.get(MODEL_API_KEY)).toBe(second)
    expect(await readMigratedSecret()).toBe(second)
  })

  it('a changed provider key reaches the vault on save', async () => {
    const first = providerSecret()
    const rotated = providerSecret()
    const store = await persistedSecrets({ [PROVIDER_KEY]: JSON.stringify(apiKeyRecord(first)) })
    const { shell } = await migratedShell(store, ['openrouter'])
    expect(await readMigratedSecret()).toBe(first)
    await shell.store.store(PROVIDER_KEY, JSON.stringify(apiKeyRecord(rotated)))
    expect(await store.get(PROVIDER_KEY)).toBe(JSON.stringify(apiKeyRecord(rotated)))
    expect(await readMigratedSecret()).toBe(rotated)
  })

  it('a removed vault copy is rebuilt from SecretStorage on unlock', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    await controller(store, [], noFail()).ensureMigrated()
    const [item] = await credentialItems()
    if (item === undefined) throw new Error('missing migrated item')
    await liveStore().remove(item.id)
    expect(await credentialItems()).toEqual([])
    await controller(store, [], noFail()).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await readMigratedSecret()).toBe(first)
  })

  it('an unlock after a crashed mirror keeps the newer save', async () => {
    const first = modelApiKey()
    const second = modelApiKey()
    const third = modelApiKey()
    const inner = await persistedSecrets({ [MODEL_API_KEY]: first })
    // Fail the second persisted write of `second` once: the save's own
    // SecretStorage write lands, the mirror's legacy write does not — the
    // crash between the vault commit and the legacy write.
    let writes = 0
    const crashStore: SecretStore = {
      get: (key) => inner.get(key),
      delete: (key) => inner.delete(key),
      store: async (key, value) => {
        if (value === second) {
          writes += 1
          if (writes === 2) throw new Error('simulated crash between vault and legacy commits')
        }
        await inner.store(key, value)
      },
    }
    const shell = createMigrationShell(crashStore)
    shell.bind(controller(crashStore, [], noFail()))
    await controller(crashStore, [], noFail()).ensureMigrated()
    await shell.store.store(MODEL_API_KEY, second)
    expect(await inner.get(MODEL_API_KEY)).toBe(second)
    // A save while the vault is unreachable lands in SecretStorage only.
    await inner.store(MODEL_API_KEY, third)
    await controller(crashStore, [], noFail()).ensureMigrated()
    expect(await inner.get(MODEL_API_KEY)).toBe(third)
    expect(await readMigratedSecret()).toBe(third)
  })

  it('mirrors removals out of both copies', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    const { shell } = await migratedShell(store, [])
    await removeMigratedKey(shell)
  })

  it('never writes the vault for opaque records, and says why', async () => {
    const store = await persistedSecrets({
      [PROVIDER_KEY]: JSON.stringify(oauthRecord(providerSecret())),
    })
    const { log, logged } = capturingLog()
    await controller(store, ['openrouter'], noFail(), log).ensureMigrated()
    expect(await credentialCount()).toBe(0)
    expect(logged.some((line) => line.includes(PROVIDER_KEY) && line.includes('opaque'))).toBe(true)
  })

  it('reads the migrated vault item material back with its exact bytes', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    await controller(store, [], noFail()).ensureMigrated()
    expect(await readMigratedSecret()).toBe(first)
  })
})
