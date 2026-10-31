// The Model API key outside VS Code (PLAN.md D61): the operating system's
// credential store, reached in this process. Windows Credential Manager,
// the macOS login Keychain, and on Linux the Secret Service only (the
// kernel keyring would forget the key at reboot, so it is never used).
// The entry is opened per call through an injected factory, so the tests
// run against a map and the process against `@napi-rs/keyring`. A missing
// entry reads as null from the native binding, whatever its typings say
// (found against GNOME Keyring, docs/certification/m63.md), and as
// undefined everywhere past this file.

import { createHash } from 'node:crypto'
import { modelRef, credentialRecord } from '../host/backend/providerPolicyEntry'
import {
  createSingleFlightSecretStore,
  type SecretStore,
  type SingleFlightSecretStore,
} from '../host/auth/credentialStore'
import {
  HTTP_STATUS,
  KEYRING_GENERATIONS_SUFFIX,
  KEYRING_GENERATIONS_TAG,
  KEYRING_PART_CHARS,
  KEYRING_PARTS_ID_CHARS,
  KEYRING_PARTS_TAG,
  KEYRING_SERVICE,
  KEYSTORE_LOCK_ACCOUNT_CHARS,
  KEYSTORE_LOCK_DIR,
  KEYSTORE_LOCK_PIPE,
  PROVIDER_ADMIN_SECRET_PREFIX,
  UI_TEXT,
} from '../shared/constants'
import type { CredentialRecord } from '../core/providers/credentialRecord'
import { personScope, withNamedLock } from './namedLock'
const { parseCredentialRecord } = credentialRecord
const { isProviderId } = modelRef

/** The three calls the agent makes on one credential (`@napi-rs/keyring`'s `AsyncEntry`). */
export interface KeyringEntry {
  getPassword(): Promise<string | null | undefined>
  setPassword(password: string): Promise<void>
  deletePassword(): Promise<boolean>
}

/** Opens the entry for a service and account; throws when the store cannot be used. */
export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry

/**
Native failures may contain account or credential text: the message stays
the fixed word and the failure rides only on `cause`, which no log or
sentence renders.
*/
export class StoreUnavailableError extends Error {
  public constructor(options?: { readonly cause?: unknown }) {
    super('store-unavailable', options)
    this.name = 'StoreUnavailableError'
  }
}

/**
Whether the store cannot be used. Name-based, not `instanceof`: lazy
bundles carry their own copy of this module, so an error thrown by one
copy is not an instance of another's class.
*/
export function isStoreUnavailable(error: unknown): boolean {
  return (
    error instanceof StoreUnavailableError ||
    (error instanceof Error && error.name === 'StoreUnavailableError')
  )
}

export async function storeOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    // Includes Windows logon-session failures, locked/denied Keychains and
    // absent Linux Secret Service. The cause is kept for the caller, never
    // for a log or a sentence.
    throw new StoreUnavailableError({ cause: error })
  }
}

/** The HTTP statuses that answer "this key is not accepted": 401 and 403. */
function isRejectionStatus(status: number): boolean {
  return status === HTTP_STATUS.unauthorized || status === HTTP_STATUS.forbidden
}

/**
The one choke point for a rejected key: when a provider answers HTTP 401
or 403 to a request carrying an entry's key, forget exactly that entry,
so the next use reads the OS store once more (the key may have been
replaced elsewhere). The decision reads the answer's status only —
never a message, which can carry provider or credential text. Anything
else (rate limits, outages, local failures) is not a rejection and must
not drop the remembered secret. When the store returns the same value,
the provider's own sentence is shown and nothing loops: no retry and
no further re-read lives here. A store without a `forget` (never the
process's owned store) is a no-op.
*/
export function noteKeyRejectedStatus(
  store: SecretStore & Partial<Pick<SingleFlightSecretStore, 'forget'>>,
  key: string,
  status: number | undefined,
): void {
  if (status !== undefined && isRejectionStatus(status)) store.forget?.(key)
}

/** A value kept as parts: how many, and the whole value's SHA-256 (hex). */
interface PartsHeader {
  readonly count: number
  readonly sha256: string
}

/** One generation of parts: the hash prefix naming it, and how many parts it has. */
interface Generation {
  readonly id: string
  readonly count: number
}

const PARTS_HEADER = new RegExp(`^${KEYRING_PARTS_TAG}([1-9][0-9]{0,5}):([0-9a-f]{64})$`, 'u')
const GENERATION = new RegExp(
  String.raw`^([0-9a-f]{${String(KEYRING_PARTS_ID_CHARS)}})\.([1-9][0-9]{0,5})$`,
  'u',
)

function partsHeader(value: string | undefined): PartsHeader | undefined {
  const match = value === undefined ? null : PARTS_HEADER.exec(value)
  return match === null ? undefined : { count: Number(match[1]), sha256: match[2] ?? '' }
}

function generationOf(header: PartsHeader): Generation {
  return { id: header.sha256.slice(0, KEYRING_PARTS_ID_CHARS), count: header.count }
}

/** The generations a record names; undefined when the value is not a record of ours. */
function recordedGenerations(value: string): readonly Generation[] | undefined {
  if (!value.startsWith(KEYRING_GENERATIONS_TAG)) return undefined
  const generations: Generation[] = []
  for (const text of value.slice(KEYRING_GENERATIONS_TAG.length).split(',')) {
    const match = GENERATION.exec(text)
    if (match === null) return undefined
    generations.push({ id: match[1] ?? '', count: Number(match[2]) })
  }
  return generations
}

function generationRecord(generations: readonly Generation[]): string {
  const named = generations.map((generation) => `${generation.id}.${String(generation.count)}`)
  return `${KEYRING_GENERATIONS_TAG}${named.join(',')}`
}

/** The account of a long value's generation record. */
function recordAccount(key: string): string {
  return `${key}${KEYRING_GENERATIONS_SUFFIX}`
}

/** One generation's part account: the hash prefix keeps a rewrite from touching the parts it replaces. */
function partAccount(key: string, id: string, index: number): string {
  return `${key}#${id}.${String(index)}`
}

/** The lock of one account, on the person's scope: one name per account, so unrelated accounts never wait. */
function accountLock(key: string, scope: string) {
  const id = createHash('sha256').update(key).digest('hex').slice(0, KEYSTORE_LOCK_ACCOUNT_CHARS)
  return {
    pipe: `${KEYSTORE_LOCK_PIPE}-${scope}-${id}`,
    folder: `${KEYSTORE_LOCK_DIR}-${scope}`,
    file: `${id}.lock`,
  }
}

/** Where a store's locks live; tests give their own scope so they never share a name with a real account. */
interface KeyringStoreOptions {
  readonly lockScope?: string
}

/**
The credential store as the key's `SecretStore`, each call on a freshly
opened entry. A value longer than one entry holds on every platform
(Windows: 1,280 characters), or one that starts with the parts tag, is
kept as parts behind a header; a short value is read and written exactly
as before.

One owner per account, across processes (docs/certification/
chatgpt-grant-lock.md, "PLANFIX R1 + R5"): every write and delete, and the
read, runs under that account's named lock. A long write first
records every generation of parts that may exist, writes the new parts,
then publishes the header (the one point a reader can see), then removes
the generation the header stopped naming, then deletes the record. Each
owner, before its own work, removes what a crashed or failed owner left:
the parts of every recorded generation the header does not name. A read of
any value also reclaims before returning, even when the primary is absent.
*/
export function keyringSecretStore(
  openEntry: KeyringEntryFactory,
  options: KeyringStoreOptions = {},
): SecretStore {
  const read = async (account: string): Promise<string | undefined> =>
    await storeOperation(
      async () => (await openEntry(KEYRING_SERVICE, account).getPassword()) ?? undefined,
    )
  const write = async (account: string, value: string): Promise<void> => {
    await storeOperation(() => openEntry(KEYRING_SERVICE, account).setPassword(value))
  }
  const remove = async (account: string): Promise<void> => {
    await storeOperation(() => openEntry(KEYRING_SERVICE, account).deletePassword())
  }
  /** The owner of one account; a lock that cannot be had is a store that cannot be used. */
  const owned = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    try {
      return await withNamedLock(work, accountLock(key, options.lockScope ?? personScope()))
    } catch (error) {
      throw error instanceof StoreUnavailableError
        ? error
        : new StoreUnavailableError({ cause: error })
    }
  }
  const removeGeneration = async (key: string, generation: Generation): Promise<void> => {
    for (let index = 0; index < generation.count; index += 1) {
      await remove(partAccount(key, generation.id, index))
    }
  }
  /** Removes what no header names: the parts of every recorded generation but the live one. */
  const reclaim = async (key: string): Promise<void> => {
    const recorded = await read(recordAccount(key))
    if (recorded === undefined) return
    const header = partsHeader(await read(key))
    const live = header === undefined ? undefined : generationOf(header).id
    const named = recordedGenerations(recorded) ?? []
    for (const generation of named) {
      if (generation.id !== live) await removeGeneration(key, generation)
    }
    await remove(recordAccount(key))
  }
  /** Best effort: the record still names the generations, so the next owner removes them. */
  const reclaimQuietly = async (key: string): Promise<void> => {
    try {
      await reclaim(key)
    } catch {
      // The record still names the generations: the next owner removes them.
    }
  }
  /** A failed owner leaves nothing it can remove; what it cannot is the next owner's. */
  const guarded = async (key: string, work: () => Promise<void>): Promise<void> => {
    await reclaim(key)
    try {
      await work()
    } catch (error) {
      await reclaimQuietly(key)
      throw error
    }
  }
  return {
    get: async (key) => {
      return await owned(key, async () => {
        // Reads can be the only next operation after a crash, including a
        // first write that died before publishing any primary entry.
        await reclaim(key)
        const current = await read(key)
        const header = partsHeader(current)
        if (header === undefined) return current
        const id = generationOf(header).id
        const parts: string[] = []
        for (let index = 0; index < header.count; index += 1) {
          const part = await read(partAccount(key, id, index))
          if (part === undefined) throw new StoreUnavailableError()
          parts.push(part)
        }
        const value = parts.join('')
        if (createHash('sha256').update(value).digest('hex') !== header.sha256) {
          throw new StoreUnavailableError()
        }
        return value
      })
    },
    store: async (key, value) => {
      await owned(key, async () => {
        await guarded(key, async () => {
          const header = partsHeader(await read(key))
          const previous = header === undefined ? undefined : generationOf(header)
          if (value.length <= KEYRING_PART_CHARS && !value.startsWith(KEYRING_PARTS_TAG)) {
            if (previous !== undefined)
              await write(recordAccount(key), generationRecord([previous]))
            await write(key, value)
            if (previous !== undefined) {
              await removeGeneration(key, previous)
              await remove(recordAccount(key))
            }
            return
          }
          const sha256 = createHash('sha256').update(value).digest('hex')
          const next: Generation = {
            id: sha256.slice(0, KEYRING_PARTS_ID_CHARS),
            count: Math.ceil(value.length / KEYRING_PART_CHARS),
          }
          const named =
            previous === undefined || previous.id === next.id ? [next] : [previous, next]
          await write(recordAccount(key), generationRecord(named))
          for (let index = 0; index < next.count; index += 1) {
            const start = index * KEYRING_PART_CHARS
            await write(
              partAccount(key, next.id, index),
              value.slice(start, start + KEYRING_PART_CHARS),
            )
          }
          await write(key, `${KEYRING_PARTS_TAG}${String(next.count)}:${sha256}`)
          if (previous !== undefined && previous.id !== next.id)
            await removeGeneration(key, previous)
          await remove(recordAccount(key))
        })
      })
    },
    delete: async (key) => {
      await owned(key, async () => {
        await guarded(key, async () => {
          const header = partsHeader(await read(key))
          if (header === undefined) {
            await remove(key)
            return
          }
          const previous = generationOf(header)
          await write(recordAccount(key), generationRecord([previous]))
          await remove(key)
          await removeGeneration(key, previous)
          await remove(recordAccount(key))
        })
      })
    },
  }
}

/**
The OS credential store under this process's one read owner: the
multipart store above, read through the single-flight wrapper, so each
entry is read from the OS store once per process until a rejection or a
change forgets it. Composition sites share one instance per process;
the raw store stays available for the migration's verifying re-reads.
*/
export function ownedKeyringSecretStore(
  openEntry: KeyringEntryFactory,
  options: KeyringStoreOptions = {},
): SingleFlightSecretStore {
  return createSingleFlightSecretStore(keyringSecretStore(openEntry, options))
}

/**
The OS store / SecretStorage account holding a provider's secret (M95,
PLAN.md D74): named after the provider's id. Undefined for anything but
a provider id (`meta` is reserved and never valid).
*/
export function providerSecretAccount(providerId: string): string | undefined {
  return isProviderId(providerId) ? `museSpark.provider.${providerId}` : undefined
}

/**
The OS store account holding a provider's admin report key (PROVSPEND):
its own name under the same service, so an inference read never finds
it and the admin key is used for nothing but read-only report requests.
Undefined for anything but a provider id, exactly like the inference key.
*/
export function providerAdminSecretAccount(providerId: string): string | undefined {
  return isProviderId(providerId) ? `${PROVIDER_ADMIN_SECRET_PREFIX}${providerId}` : undefined
}

/**
A stored provider secret: lane P's credential record (the origin the
credential was obtained for) plus the secret itself under `secret`. D74's
record is `{v, auth, origin, …}`; the `…` is the secret, which lane K
writes beside the record on the VS Code side and this file reads on the
agent's. Parsed by composing lane P's parser (never a divergent schema).
*/
export interface StoredProviderSecret {
  readonly record: CredentialRecord
  readonly key: string
}

/** Parse an untrusted stored value; undefined for anything but the envelope. */
export function parseStoredProviderSecret(value: unknown): StoredProviderSecret | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = parseCredentialRecord(value)
  // The envelope carries the secret beside lane P's record; the read is
  // checked below (a non-empty string) before anything trusts it.
  let key: unknown
  if ('secret' in value) key = value.secret
  else if ('key' in value) key = value.key
  return record === undefined || typeof key !== 'string' || key === '' ? undefined : { record, key }
}

/** The envelope to store: the record with the secret beside it, encoded once. */
export function formatStoredProviderSecret(record: CredentialRecord, key: string): string {
  return JSON.stringify({ ...record, secret: key })
}

/** Where the key lives on this platform, as the user knows it. */
export function credentialStoreName(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32': {
      return UI_TEXT.acpStoreNames.windows
    }
    case 'darwin': {
      return UI_TEXT.acpStoreNames.macos
    }
    default: {
      return UI_TEXT.acpStoreNames.linux
    }
  }
}
