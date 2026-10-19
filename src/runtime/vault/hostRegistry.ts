import path from 'node:path'
import process from 'node:process'
import { unlinkSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import * as z from 'zod/mini'
import { lstatIdentitySync, sameFile, type FileIdentity } from '../../core/fs/fileIdentity'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import type { VaultPrivateFilesPort } from '../../core/vault/broker/files'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import { VAULT_LIMITS } from '../../shared/constants'

const vaultHostId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const vaultHostSchema = z.strictObject({
  hostId: vaultHostId,
  hostSession: vaultHostId,
  processId: z.number().check(z.int(), z.positive()),
  userId: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  startedAt: z.number().check(z.int(), z.positive()),
  executable: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})

export type VaultHostRecord = z.infer<typeof vaultHostSchema>

/** Parse one owner-only host file; the caller's read decides missing against refusal. */
export function parseVaultHostRecord(bytes: Buffer): VaultHostRecord {
  return vaultHostSchema.parse(JSON.parse(bytes.toString()))
}

/** The launch facts must equal the native identity before manage authority is granted. */
function isHostRecordMatch(
  record: VaultHostRecord,
  hostId: string,
  hostSession: string | undefined,
  identity: VaultProcessIdentity,
): boolean {
  return (
    record.hostId === hostId &&
    (hostSession === undefined || record.hostSession === hostSession) &&
    record.processId === identity.processId &&
    record.userId === identity.userId &&
    record.startedAt === identity.startedAt &&
    record.executable === identity.executable
  )
}

export interface HostRegistrations {
  track(file: string, remove: () => void): void
  untrack(file: string): void
}

/** Exit-time host cleanup, one registry per platform so POSIX and Windows never share state. */
export function createHostRegistrations(): HostRegistrations {
  const registrations = new Map<string, () => void>()
  const lifecycle = { isWatching: false }
  const removeRegistrations = (): void => {
    for (const remove of registrations.values()) remove()
  }
  return {
    track(file: string, remove: () => void): void {
      if (!lifecycle.isWatching) {
        lifecycle.isWatching = true
        process.once('exit', removeRegistrations)
      }
      registrations.set(file, remove)
    },
    untrack(file: string): void {
      registrations.delete(file)
    },
  }
}

/**
 * Track one published host file for exit cleanup. The remover unlinks only
 * while the file is still the record this call published (same device and
 * inode); a replaced file is left alone.
 */
export function trackHostFile(registrations: HostRegistrations, file: string): () => void {
  const registered: FileIdentity = lstatIdentitySync(file)
  const remove = (): void => {
    try {
      if (sameFile(registered, lstatIdentitySync(file))) unlinkSync(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    } finally {
      registrations.untrack(file)
    }
  }
  registrations.track(file, remove)
  return remove
}

/** Prune every host file whose process is provably dead or reused; unreadable records refuse. */
export async function pruneDeadHosts(options: {
  readonly directory: string
  readonly files: Pick<VaultPrivateFilesPort, 'read'>
  readonly liveStartedAt: (processId: number) => Promise<number | undefined>
  readonly retire: (file: string) => Promise<void>
}): Promise<void> {
  const names = await readdir(options.directory)
  for (const name of names) {
    // Atomic replace publishes a temporary name before rename; it is never a host record.
    if (!vaultHostId.safeParse(name).success) continue
    const file = path.join(options.directory, name)
    let bytes: Buffer
    try {
      bytes = await options.files.read(file)
    } catch (error: unknown) {
      if (isVaultFileMissing(error)) continue
      throw error
    }
    const record = parseVaultHostRecord(bytes)
    const startedAt = await options.liveStartedAt(record.processId)
    if (startedAt !== record.startedAt) await options.retire(file)
  }
}

/**
 * Publish one host record under `directory/hostId`, pruning dead hosts
 * first so a reused name never shadows a live record.
 */
export async function publishHostRecord(
  files: Pick<VaultPrivateFilesPort, 'directory' | 'replace'>,
  directory: string,
  record: VaultHostRecord,
  prune: () => Promise<void>,
): Promise<string> {
  await files.directory(directory)
  await prune()
  const file = path.join(directory, record.hostId)
  await files.replace(file, Buffer.from(JSON.stringify(record)))
  return file
}

/** Build one host record from the native identity; the ids ride the caller's own registration. */
export function hostRecordFor(
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession: string,
): VaultHostRecord {
  return vaultHostSchema.parse({ ...identity, hostId, hostSession })
}

/** Parse one host id before it names a file; a malformed id refuses instead of reading. */
export function parseHostId(hostId: string): string {
  return vaultHostId.parse(hostId)
}

/**
 * Recheck birth and image against the native identity before granting
 * manage authority. Any failure (missing file, unparsable record, mismatch)
 * refuses; only an exact match grants.
 */
export async function isVaultHost(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  runDirectory: string,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  try {
    const bytes = await files.read(path.join(runDirectory, 'hosts', parseHostId(hostId)))
    return isHostRecordMatch(parseVaultHostRecord(bytes), hostId, hostSession, identity)
  } catch {
    return false
  }
}
