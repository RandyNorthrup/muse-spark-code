// The key-store migration against a real VaultStore and a real persisted
// secret store: real files under real temporary roots, real recovery-slot
// crypto, the real shell, the real controller and its real journal rows in
// the same store. Key values are generated at runtime (pattern-valid, never
// issued, never sent), so no secret-shaped literal sits in the tree.
//
// One test forces an interleaving the real world produces at random, with
// a gate on the persisted secret writes: every byte still lands in the real
// files, the gate only decides when. Every crash below is a real filesystem
// refusal (the vault directory or one secret file made unwritable the
// platform's real way, then restored): no port or helper in this file throws
// on the store's behalf. The vault commits around each refusal are all real,
// and so is the retry after the restore.
import { mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { NodeVaultFiles, VaultStore } from '../../../src/core/vault/store'
import type { VaultAnchorPort } from '../../../src/core/vault/broker/repository'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import { eraseItem, itemDigest } from '../../../src/core/vault/migrate/material'
import { VaultMigrationFault } from '../../../src/core/vault/migrate/ports'
import { SECRET_KEYS, UI_TEXT, VAULT_KEY_BYTES, VAULT_LIMITS } from '../../../src/shared/constants'
import type { VaultItem, VaultItemMetadata } from '../../../src/shared/vault'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { Logger } from '../../../src/host/logger'
import { capturingLog, closeSecrets, fileSecrets } from '../helpers/vault/migrationFixtures'
import { metadata as baseMetadata } from '../helpers/vault/fixtures'
import {
  buildMigrationCredentials,
  CredentialMigrationController,
  type CredentialMigrationPorts,
} from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell, type MigrationMirror } from '../../../src/host/vault/migrationShell'

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
/** The default-account overlay: same slot, six keys, never an apiKey row. */
const accountRecord = (secret: string) => ({
  provider: 'openrouter',
  account: 'default',
  origin: 'https://openrouter.ai',
  v: 1,
  auth: 'apiKey',
  secret,
})
const vaultId = 'b'.repeat(32)

const quiet: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const openStores: {
  directory: string
  store: VaultStore
  key: Buffer
  files: NodeVaultFiles
  anchor: VaultAnchorPort
}[] = []
const secretDirs: string[] = []

function liveStore(): VaultStore {
  const current = openStores.at(-1)
  if (current === undefined) throw new Error('store not open')
  return current.store
}

/** The live store's real vault file: the refusal below acts on it, never on a wrapper. */
function vaultFilePath(): string {
  const current = openStores.at(-1)
  if (current === undefined) throw new Error('store not open')
  return path.join(current.directory, 'vault', 'vault.v1')
}

/**
Make the real VaultStore refuse its next remove, the way a real
filesystem refusal does. POSIX-only (this suite does not run on Windows):
mode `0444` trips the store's own verify (owner-only `0600`), so the
`liveStore().remove` below runs and fails at verify, before the unlink —
nothing throws on its behalf.
*/
async function refuseVaultFile(): Promise<void> {
  await chmod(vaultFilePath(), 0o444)
}

/** Give the vault file back after a refused remove, so the retry runs real too. */
async function restoreVaultFile(): Promise<void> {
  await chmod(vaultFilePath(), 0o600)
}

/** The live store's real vault directory: refusing it refuses every store op. */
function vaultDirPath(): string {
  const current = openStores.at(-1)
  if (current === undefined) throw new Error('store not open')
  return path.join(current.directory, 'vault')
}

/**
Make the real VaultStore refuse its next write, the way a real
filesystem refusal does. POSIX-only: mode `0555` trips the store's own
directory verify (owner-only `0700`), so the `liveStore().write` below
runs and fails inside the store — nothing throws on its behalf. A
read-only vault *file* would not refuse a write (the publish renames over
it), which is why this refuses the directory instead.
*/
async function refuseVaultDir(): Promise<void> {
  await chmod(vaultDirPath(), 0o555)
}

/** Give the vault directory back after a refused write, so the retry runs real too. */
async function restoreVaultDir(): Promise<void> {
  await chmod(vaultDirPath(), 0o700)
}

function ports(
  refuseSecondWriteOnce?: { current: boolean },
  failRemoveOnce?: { current: boolean },
): CredentialMigrationPorts {
  let writes = 0
  return {
    snapshot: async () => ({ items: await liveStore().list() }),
    write: async (item, isEdit, authorize) => {
      writes += 1
      // A crash between a journal commit and the vault commit that follows
      // it: the first write (the journal row) lands, the second runs
      // against the refused real directory and fails inside the store.
      // Consuming the flag proves the refusal ran; the stranded journal row
      // the test asserts next proves the write itself failed.
      if (writes === 2 && refuseSecondWriteOnce?.current === true) {
        refuseSecondWriteOnce.current = false
        await refuseVaultDir()
        try {
          authorize?.()
          await liveStore().write(item, isEdit ? 'present' : 'absent')
        } finally {
          await restoreVaultDir()
        }
        return
      }
      authorize?.()
      await liveStore().write(item, isEdit ? 'present' : 'absent')
    },
    remove: async (id, authorize) => {
      // A crash between the journal commit and the vault remove: the engine
      // already journaled `deleting` before this runs, so refusing the real
      // file now strands the old vault item the way the real world does.
      // The remove below is the real one, against the refused file; the
      // restore runs before the error reaches the engine, so the retry the
      // test runs next is real too.
      if (failRemoveOnce?.current === true) {
        failRemoveOnce.current = false
        await refuseVaultFile()
        try {
          authorize?.()
          await liveStore().remove(id)
        } finally {
          await restoreVaultFile()
        }
        return
      }
      authorize?.()
      await liveStore().remove(id)
    },
    firstPartyRead: async (request) => {
      // The engine refuses non-apiKey rows before this port is reached, so
      // only the apiKey shape arrives here; the bytes below are the real
      // committed ones, never a refusal. Anything else fails the test
      // instead of failing on the store's behalf.
      const item = await liveStore().read(request.itemId)
      if (item.material.kind === 'apiKey') {
        const value = Buffer.alloc(item.material.value.byteLength)
        value.set(item.material.value)
        return value
      }
      expect.unreachable('first-party reads serve apiKey rows only')
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
Pause one persisted secret write until released. Every byte still lands
in the real files; the gate only holds the commit so a save can land
mid-migration, the way a save during unlock does.
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

// The test's own protected anchor, like the crash fixture's: file-backed,
// compare-and-operate, never a vault value. Rebuilt from the same path, so a
// test can reopen its store after locking it, the way an unlock reopens the
// vault.
function fileAnchor(directory: string): VaultAnchorPort {
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
  return anchor
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
  const anchor = fileAnchor(directory)
  const recovery = createRecoverySlot(key, vaultId, { now: Date.now })
  try {
    const store = await VaultStore.create({ files, anchor, key }, vaultId, [recovery.slot])
    openStores.push({ directory, store, key, files, anchor })
  } finally {
    recovery.code.fill(0)
  }
})

/** Lock the store and reopen it from the same files, key and anchor: an unlock. */
async function reopenStore(): Promise<void> {
  const current = openStores.at(-1)
  if (current === undefined) throw new Error('store not open')
  current.store.lock()
  current.store = await VaultStore.open(
    { files: current.files, anchor: current.anchor, key: current.key },
    vaultId,
  )
}

afterEach(async () => {
  const current = openStores.pop()
  current?.store.lock()
  current?.key.fill(0)
  if (current) await rm(current.directory, { recursive: true, force: true })
  while (secretDirs.length > 0) await closeSecrets(secretDirs.pop()!)
})

/**
The stranded journal row's phase, read back through the real store. The
crash tests migrate exactly one key, so the single `migration-` row is
unambiguous; its phase tells which side of the crash the engine stopped
on (`copying`/`writing` past the journal commit, `deleting` past the
vault remove). A crash the refusal did not really cause would have moved
the row on, so this is the proof the refusal fired.
*/
async function strandedJournalPhase(): Promise<string | null> {
  const items = await liveStore().list()
  const rows = items.filter((entry) => entry.name.startsWith('migration-'))
  if (rows.length !== 1) throw new Error('expected the one stranded journal row')
  const [row] = rows
  if (row === undefined) throw new Error('expected the one stranded journal row')
  const journal = await liveStore().read(row.id)
  try {
    if (journal.material.kind !== 'apiKey') throw new Error('expected the journal row')
    return (JSON.parse(Buffer.from(journal.material.value).toString('utf8')) as { phase: string })
      .phase
  } finally {
    eraseItem(journal)
  }
}

function controller(
  secrets: SecretStore,
  providerIds: readonly string[],
  refuseSecondWriteOnce?: { current: boolean },
  log: Logger = quiet,
  failRemoveOnce?: { current: boolean },
): CredentialMigrationController {
  return new CredentialMigrationController({
    secrets,
    listProviderIds: () => Promise.resolve(providerIds),
    ports: ports(refuseSecondWriteOnce, failRemoveOnce),
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

/**
The real persisted secret file for one key: refusing it refuses the one
legacy write the crashed-mirror test targets. File-backed like the
fixture's store, which names one `${encodeURIComponent(key)}.secret` file
per key under its directory.
*/
async function refuseSecretFile(dir: string, key: string): Promise<void> {
  await chmod(path.join(dir, `${encodeURIComponent(key)}.secret`), 0o444)
}

/** Give the secret file back after a refused write, so the healing runs real too. */
async function restoreSecretFile(dir: string, key: string): Promise<void> {
  await chmod(path.join(dir, `${encodeURIComponent(key)}.secret`), 0o600)
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
  const active = controller(store, providerIds)
  shell.bind(active)
  await active.ensureMigrated()
  return { shell, active }
}

/** A migrated model API key with the vault locked, as an idle lock leaves it. */
async function migratedThenLocked(): Promise<{
  shell: ReturnType<typeof createMigrationShell>
  store: SecretStore
  first: string
}> {
  const first = modelApiKey()
  const store = await persistedSecrets({ [MODEL_API_KEY]: first })
  // The shell bound to the real migration controller, as the unlock edge
  // leaves it: no hand-written mirror anywhere in this path.
  const { shell } = await migratedShell(store, [])
  expect(await readMigratedSecret()).toBe(first)
  liveStore().lock()
  return { shell, store, first }
}

/** Remove the migrated key through the shell, asserting both copies drop. */
async function removeMigratedKey(shell: ReturnType<typeof createMigrationShell>): Promise<void> {
  expect(await credentialCount()).toBe(1)
  await shell.store.delete(MODEL_API_KEY)
  expect(await credentialCount()).toBe(0)
}

/**
A sign-out crashed mid-delete through the real shell and controller.
Refusing the real vault file strands the old vault item with the journal
saying `deleting`; refusing the second journal write strands the state
past the vault remove instead. Each refusal is the real filesystem one,
and the assertions below prove it fired: a consumed flag alone could
still pass had the refused op succeeded, but the stranded row's phase and
the vault's contents cannot.
*/
async function crashedSignOut(
  store: SecretStore,
  refuseSecondWriteOnce?: { current: boolean },
  failRemoveOnce?: { current: boolean },
): Promise<ReturnType<typeof createMigrationShell>> {
  const { shell } = await migratedShell(store, [])
  await store.delete(MODEL_API_KEY)
  const crash = controller(store, [], refuseSecondWriteOnce, quiet, failRemoveOnce)
  await expect(crash.mirrorDelete(MODEL_API_KEY)).rejects.toThrow(VaultMigrationFault)
  if (failRemoveOnce !== undefined) {
    // The flag is consumed only by the refusal branch, and the vault item
    // the refused remove left behind is still there.
    expect(failRemoveOnce.current).toBe(false)
    expect(await credentialCount()).toBe(1)
  }
  if (refuseSecondWriteOnce !== undefined) {
    // The journal commit landed, the vault remove landed, and only the
    // final journal write failed: the row still says `deleting` with both
    // copies already gone.
    expect(refuseSecondWriteOnce.current).toBe(false)
    expect(await credentialCount()).toBe(0)
    expect(await strandedJournalPhase()).toBe('deleting')
  }
  return shell
}

/**
An opaque save stays in SecretStorage: nothing reaches the vault on save,
and the next unlock leaves it alone too, with the record working where it is.
*/
async function expectOpaqueSaveKept(
  shell: ReturnType<typeof createMigrationShell>,
  store: SecretStore,
  providerIds: readonly string[],
  record: string,
): Promise<void> {
  await shell.store.store(PROVIDER_KEY, record)
  expect(await store.get(PROVIDER_KEY)).toBe(record)
  expect(await credentialCount()).toBe(0)
  await controller(store, providerIds).ensureMigrated()
  expect(await credentialCount()).toBe(0)
  expect(await store.get(PROVIDER_KEY)).toBe(record)
}

// POSIX-only, like the session-owned broker suite: on Windows the product
// opens the vault store only through the broker's C# pipe helper (a
// WindowsPipeFiles security port over the helper relay,
// src/runtime/vault/vaultBrokerEntry.ts), which a unit test cannot supply
// without a stand-in — and stand-ins are forbidden. Here the store opens
// directly with no security port, which the constructor refuses on win32, so
// these proofs run where that direct open is the real product path.
describe.skipIf(process.platform === 'win32')('key-store migration against a real store', () => {
  beforeAll(async () => {
    // Warm the product's per-process birth evidence once, outside any
    // test's timeout: the first VaultStore open in this worker reads the
    // boot identity, the process start and the machine identity, and that
    // first test would otherwise pay those spawns under the parallel
    // setup load of the neighbouring suites. A real store on a throwaway
    // root, locked and removed — the same setup each test below builds.
    let base = tmpdir()
    try {
      base = realpathSync(base)
    } catch {
      /* The store open below reports the unusable base instead. */
    }
    const directory = await mkdtemp(path.join(base, 'v-migrate-warm-'))
    try {
      const key = randomBytes(32)
      try {
        const files = new NodeVaultFiles(path.join(directory, 'vault'), VAULT_LIMITS.frameBytes)
        const anchor = fileAnchor(directory)
        const recovery = createRecoverySlot(key, vaultId, { now: Date.now })
        try {
          const store = await VaultStore.create({ files, anchor, key }, vaultId, [recovery.slot])
          store.lock()
        } finally {
          recovery.code.fill(0)
        }
      } finally {
        key.fill(0)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('copies the model API key and a provider key, verified, legacy retained', async () => {
    const first = modelApiKey()
    const secret = providerSecret()
    const store = await persistedSecrets({
      [MODEL_API_KEY]: first,
      [PROVIDER_KEY]: JSON.stringify(apiKeyRecord(secret)),
    })
    await controller(store, ['openrouter']).ensureMigrated()
    // The old store stays readable until the vault copy is proven.
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await store.get(PROVIDER_KEY)).toBe(JSON.stringify(apiKeyRecord(secret)))
    const items = await credentialItems()
    expect(items.length).toBe(2)
    expect(items.every((entry) => entry.hidden && entry.firstParty)).toBe(true)
    // A second run repeats cleanly: nothing new, nothing lost.
    await controller(store, ['openrouter']).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialCount()).toBe(2)
  })

  it('finishes an interrupted copy on the next run with the legacy value whole', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    // The second vault write runs against the refused real directory, like
    // a crash between the journal commit and the vault commit: the journal
    // row strands at `copying` with no vault item and the legacy whole.
    const crashWrite = { current: true }
    await controller(store, [], crashWrite).ensureMigrated()
    expect(crashWrite.current).toBe(false)
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialItems()).toEqual([])
    expect(await strandedJournalPhase()).toBe('copying')
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialCount()).toBe(1)
  })

  it('rotates the vault copy when SecretStorage changed while locked', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    await controller(store, []).ensureMigrated()
    const rotated = modelApiKey()
    await store.store(MODEL_API_KEY, rotated)
    await controller(store, []).ensureMigrated()
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
    await controller(store, []).ensureMigrated()
    const [item] = await credentialItems()
    if (item === undefined) throw new Error('missing migrated item')
    await liveStore().remove(item.id)
    expect(await credentialItems()).toEqual([])
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await readMigratedSecret()).toBe(first)
  })

  it('an unlock after a crashed mirror keeps the newer save', async () => {
    const first = modelApiKey()
    const second = modelApiKey()
    const third = modelApiKey()
    const { store: inner, dir } = await fileSecrets()
    secretDirs.push(dir)
    await inner.store(MODEL_API_KEY, first)
    // Refuse the real secret file for the mirror's legacy write once: the
    // save's own SecretStorage write lands, the mirror's legacy write runs
    // against the refused file and fails with its own access error — the
    // crash between the vault commit and the legacy write. The vault
    // commits around it are all real.
    let writes = 0
    const crashStore: SecretStore = {
      get: (key) => inner.get(key),
      delete: (key) => inner.delete(key),
      store: async (key, value) => {
        if (key === MODEL_API_KEY && value === second) {
          writes += 1
          if (writes === 2) {
            await refuseSecretFile(dir, key)
            try {
              await inner.store(key, value)
            } finally {
              await restoreSecretFile(dir, key)
            }
            return
          }
        }
        await inner.store(key, value)
      },
    }
    const shell = createMigrationShell(crashStore)
    shell.bind(controller(crashStore, []))
    await controller(crashStore, []).ensureMigrated()
    await shell.store.store(MODEL_API_KEY, second)
    expect(await inner.get(MODEL_API_KEY)).toBe(second)
    // The mirror's legacy write really failed: the journal strands at
    // `writing` with the vault copy committed, which a write that had gone
    // through would have moved on to `active`.
    expect(await strandedJournalPhase()).toBe('writing')
    // A save while the vault is unreachable lands in SecretStorage only.
    await inner.store(MODEL_API_KEY, third)
    await controller(crashStore, []).ensureMigrated()
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
    await controller(store, ['openrouter'], undefined, log).ensureMigrated()
    expect(await credentialCount()).toBe(0)
    expect(logged.some((line) => line.includes(PROVIDER_KEY) && line.includes('opaque'))).toBe(true)
  })

  it('reads the migrated vault item material back with its exact bytes', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    await controller(store, []).ensureMigrated()
    expect(await readMigratedSecret()).toBe(first)
  })

  it('an interrupted sign-out keeps a key saved afterwards', async () => {
    const first = modelApiKey()
    const newer = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    // The crash lands between the journal commit and the vault remove: the
    // old vault item is still in place with SecretStorage empty.
    const shell = await crashedSignOut(store, undefined, { current: true })
    // The person saves a new key while the vault is locked; the save lands
    // in SecretStorage, and its mirror is refused on the `deleting` row.
    await shell.store.store(MODEL_API_KEY, newer)
    expect(await store.get(MODEL_API_KEY)).toBe(newer)
    await controller(store, []).ensureMigrated()
    // Recovery keeps the newer key: it survives in both stores, migrated.
    expect(await store.get(MODEL_API_KEY)).toBe(newer)
    expect(await readMigratedSecret()).toBe(newer)
  })

  it('finishing a sign-out past the vault remove keeps a newer save', async () => {
    const first = modelApiKey()
    const newer = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    // The crash lands between the vault remove and the final journal commit:
    // the old vault item is already gone with SecretStorage empty.
    const shell = await crashedSignOut(store, { current: true })
    expect(await credentialCount()).toBe(0)
    await shell.store.store(MODEL_API_KEY, newer)
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(newer)
    expect(await readMigratedSecret()).toBe(newer)
  })

  it('completing a sign-out past the vault remove leaves no stuck row', async () => {
    const first = modelApiKey()
    const later = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    const shell = await crashedSignOut(store, { current: true })
    // No newer save: recovery completes the sign-out instead of throwing on
    // the already-removed vault item at every unlock.
    await controller(store, []).ensureMigrated()
    // With no `deleting` row left, a later save migrates straight through.
    await shell.store.store(MODEL_API_KEY, later)
    expect(await store.get(MODEL_API_KEY)).toBe(later)
    expect(await readMigratedSecret()).toBe(later)
  })

  it('an oauth save after unlock never reaches the vault', async () => {
    const oauth = JSON.stringify(oauthRecord(providerSecret()))
    const store = await persistedSecrets({ [PROVIDER_KEY]: oauth })
    const { shell } = await migratedShell(store, ['openrouter'])
    expect(await credentialCount()).toBe(0)
    // The next unlock leaves it alone too: no vault item, no journal row to
    // strand, the record working in SecretStorage.
    await expectOpaqueSaveKept(shell, store, ['openrouter'], oauth)
  })

  it('an oauth save after sign-out never reaches the vault', async () => {
    const secret = providerSecret()
    const oauth = JSON.stringify(oauthRecord(providerSecret()))
    const store = await persistedSecrets({ [PROVIDER_KEY]: JSON.stringify(apiKeyRecord(secret)) })
    const { shell } = await migratedShell(store, ['openrouter'])
    expect(await readMigratedSecret()).toBe(secret)
    await shell.store.delete(PROVIDER_KEY)
    expect(await credentialCount()).toBe(0)
    await expectOpaqueSaveKept(shell, store, ['openrouter'], oauth)
  })

  it('rolls back a stranded non-apiKey copy on unlock', async () => {
    const oauth = JSON.stringify(oauthRecord(providerSecret()))
    const store = await persistedSecrets({ [PROVIDER_KEY]: oauth })
    // A save that predates the apiKey gate stranded this state: a journal
    // `copying` row with a `secret` vault item the private channel can never
    // read back. Planted with the real codecs through the real store.
    const entry = buildMigrationCredentials(['openrouter'], now).find(
      (candidate) => candidate.key === PROVIDER_KEY,
    )
    if (entry === undefined) throw new Error('missing provider credential')
    const planted = entry.decode(Buffer.from(oauth, 'utf8'))
    try {
      const journalId = createHash('sha256')
        .update(`vault-migration-journal:${PROVIDER_KEY}`)
        .digest('hex')
        .slice(0, VAULT_KEY_BYTES)
      const journalName = `migration-${createHash('sha256').update(PROVIDER_KEY).digest('hex').slice(0, 24)}`
      const journalBytes = Buffer.from(
        JSON.stringify({
          key: PROVIDER_KEY,
          sourceId: 'vscode-secret-storage',
          itemId: entry.itemId,
          startedRelease: 19,
          retainLegacy: true,
          phase: 'copying',
          digest: itemDigest(planted),
        }),
        'utf8',
      )
      await liveStore().write(
        {
          // The journal row's hidden first-party shape, over the shared
          // metadata fixture: only the migration's own fields differ.
          metadata: {
            ...baseMetadata(),
            id: journalId,
            name: journalName,
            handle: `secret://${journalName}`,
            label: UI_TEXT.vault.secret,
            kind: 'apiKey',
            bindings: [{ kind: 'origin', origin: 'https://vault.internal' }],
            hidden: true,
            firstParty: true,
            policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
            dates: { createdAt: now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
          },
          material: {
            kind: 'apiKey',
            value: journalBytes,
            auth: 'bearer',
            origin: 'https://vault.internal',
          },
        },
        'absent',
      )
      await liveStore().write(planted, 'absent')
    } finally {
      eraseItem(planted)
    }
    expect(await credentialCount()).toBe(1)
    const { log, logged } = capturingLog()
    await controller(store, ['openrouter'], undefined, log).ensureMigrated()
    // The stuck item and its journal row are gone; the record keeps working
    // in SecretStorage, with the reason logged.
    expect(await credentialCount()).toBe(0)
    const remaining = await liveStore().list()
    expect(remaining.some((item) => item.name.startsWith('migration-'))).toBe(false)
    expect(await store.get(PROVIDER_KEY)).toBe(oauth)
    expect(logged.some((line) => line.includes(PROVIDER_KEY) && line.includes('opaque'))).toBe(true)
  })

  it('a save that lands during a sign-out survives it, in both copies', async () => {
    const first = modelApiKey()
    const newer = modelApiKey()
    const inner = await persistedSecrets({ [MODEL_API_KEY]: first })
    const active = controller(inner, [])
    // Hold the sign-out's engine delete open before it touches either copy:
    // the save below lands in that window, the way a save racing a fresh
    // sign-out does. Every byte still goes through the real controller and
    // the real store; the gate only decides when, like the persisted-write
    // gate above.
    const gateHit: (() => void)[] = []
    const gateOpen: (() => void)[] = []
    const removalReached = new Promise<void>((resolve) => {
      gateHit.push(resolve)
    })
    const removalHold = new Promise<void>((resolve) => {
      gateOpen.push(resolve)
    })
    const shell = createMigrationShell(inner)
    const gated: MigrationMirror = {
      mirrorWrite: (key, value) => active.mirrorWrite(key, value),
      mirrorDelete: async (key) => {
        for (const notify of gateHit.splice(0)) notify()
        await removalHold
        return await active.mirrorDelete(key)
      },
    }
    shell.bind(gated)
    await active.ensureMigrated()
    expect(await readMigratedSecret()).toBe(first)
    // The sign-out stalls inside its engine delete before it touches either
    // copy — SecretStorage still holds the old key, so a failure here can
    // never strand it empty; the lane queues by arrival, so the save below
    // is ordered second even though it starts before the release.
    const signOut = shell.store.delete(MODEL_API_KEY)
    await removalReached
    expect(await inner.get(MODEL_API_KEY)).toBe(first)
    const save = shell.store.store(MODEL_API_KEY, newer)
    for (const release of gateOpen.splice(0)) release()
    await signOut
    await save
    // The save came second, so it wins in both copies: the sign-out is over
    // and the newer key stands migrated. Before each save and each sign-out
    // held the shared lane as one atomic op, the sign-out's trailing engine
    // delete wiped the newer key the old removeLegacy way and it never came
    // back. A later unlock keeps it, never resurrecting the signed-out one.
    expect(await inner.get(MODEL_API_KEY)).toBe(newer)
    expect(await readMigratedSecret()).toBe(newer)
    await controller(inner, []).ensureMigrated()
    expect(await inner.get(MODEL_API_KEY)).toBe(newer)
    expect(await readMigratedSecret()).toBe(newer)
  })

  it('a non-apiKey save after unlock removes the stale vault copy', async () => {
    const secret = providerSecret()
    const store = await persistedSecrets({ [PROVIDER_KEY]: JSON.stringify(apiKeyRecord(secret)) })
    const { shell } = await migratedShell(store, ['openrouter'])
    expect(await readMigratedSecret()).toBe(secret)
    // A later save on the same slot overwrites SecretStorage with an oauth
    // record, the way the provider wizard writes one: the old vault copy
    // must go, while the new record keeps working where it is.
    const oauth = JSON.stringify(oauthRecord(providerSecret()))
    await shell.store.store(PROVIDER_KEY, oauth)
    expect(await store.get(PROVIDER_KEY)).toBe(oauth)
    expect(await credentialCount()).toBe(0)
    await controller(store, ['openrouter']).ensureMigrated()
    expect(await credentialCount()).toBe(0)
    expect(await store.get(PROVIDER_KEY)).toBe(oauth)
    // The slot is not stuck: an apiKey save migrates straight through, and
    // the default-account overlay over it clears the vault copy the same way.
    const rotated = providerSecret()
    await shell.store.store(PROVIDER_KEY, JSON.stringify(apiKeyRecord(rotated)))
    expect(await readMigratedSecret()).toBe(rotated)
    const overlaid = JSON.stringify(accountRecord(providerSecret()))
    await shell.store.store(PROVIDER_KEY, overlaid)
    expect(await store.get(PROVIDER_KEY)).toBe(overlaid)
    expect(await credentialCount()).toBe(0)
    await controller(store, ['openrouter']).ensureMigrated()
    expect(await credentialCount()).toBe(0)
    expect(await store.get(PROVIDER_KEY)).toBe(overlaid)
  })

  it('a sign-out that fails its vault remove finishes on retry and on unlock', async () => {
    const first = modelApiKey()
    const store = await persistedSecrets({ [MODEL_API_KEY]: first })
    const shell = createMigrationShell(store)
    const failRemoveOnce = { current: true }
    shell.bind(controller(store, [], undefined, quiet, failRemoveOnce))
    await controller(store, []).ensureMigrated()
    expect(await readMigratedSecret()).toBe(first)
    // The journal writes `deleting`, then the vault remove fails against
    // the refused real file: the call throws with the original key still
    // readable in both stores.
    await expect(shell.store.delete(MODEL_API_KEY)).rejects.toThrow()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await credentialCount()).toBe(1)
    // A retry finishes the sign-out the person asked for — the live copy is
    // the journaled one, not a newer save — so both copies go.
    await shell.store.delete(MODEL_API_KEY)
    expect(await store.get(MODEL_API_KEY)).toBe(undefined)
    expect(await credentialCount()).toBe(0)
    // The unlock path heals the same way: a failure after `deleting` is
    // journaled finishes the sign-out instead of restoring the key.
    const second = modelApiKey()
    await shell.store.store(MODEL_API_KEY, second)
    expect(await readMigratedSecret()).toBe(second)
    failRemoveOnce.current = true
    await expect(shell.store.delete(MODEL_API_KEY)).rejects.toThrow()
    expect(await store.get(MODEL_API_KEY)).toBe(second)
    expect(await credentialCount()).toBe(1)
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(undefined)
    expect(await credentialCount()).toBe(0)
  })

  it('a sign-out that cannot reach the vault keeps the key readable', async () => {
    const { shell, store, first } = await migratedThenLocked()
    // The removal must fail loudly with the key still readable, never
    // resolve with SecretStorage empty and the vault copy stranded.
    await expect(shell.store.delete(MODEL_API_KEY)).rejects.toThrow()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    await reopenStore()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await readMigratedSecret()).toBe(first)
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(first)
    expect(await readMigratedSecret()).toBe(first)
    // Once the vault is back, the same sign-out removes both copies.
    await shell.store.delete(MODEL_API_KEY)
    expect(await store.get(MODEL_API_KEY)).toBe(undefined)
    expect(await credentialCount()).toBe(0)
  })

  it('keeps a save made while the vault is locked, and mirrors it on unlock', async () => {
    const rotated = modelApiKey()
    const { shell, store } = await migratedThenLocked()
    await shell.store.store(MODEL_API_KEY, rotated)
    expect(await store.get(MODEL_API_KEY)).toBe(rotated)
    await reopenStore()
    await controller(store, []).ensureMigrated()
    expect(await store.get(MODEL_API_KEY)).toBe(rotated)
    expect(await readMigratedSecret()).toBe(rotated)
  })
})
