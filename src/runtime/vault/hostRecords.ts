import process from 'node:process'
import path from 'node:path'
import { unlinkSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import * as z from 'zod/mini'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import { lstatIdentitySync, sameFile } from '../../core/fs/fileIdentity'
import { isVaultFileMissing, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import { VAULT_LIMITS } from '../../shared/constants'

/** Host record id and schema, one shape on every platform. */
export const vaultHostId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
export const vaultHostRecordSchema = z.strictObject({
  hostId: vaultHostId,
  hostSession: vaultHostId,
  processId: z.number().check(z.int(), z.positive()),
  userId: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  startedAt: z.number().check(z.int(), z.positive()),
  executable: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})
export type VaultHostRecord = z.infer<typeof vaultHostRecordSchema>

/** A stored record read and parsed; missing files throw their absence. */
export async function readHostRecordFile(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  file: string,
): Promise<VaultHostRecord> {
  const bytes = await files.read(file)
  return vaultHostRecordSchema.parse(JSON.parse(bytes.toString()))
}

/**
Every stored host record; unreadable names and missing files are skipped,
anything else still refuses.
*/
export async function* hostRecordFiles(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  directory: string,
): AsyncGenerator<{ readonly file: string; readonly record: VaultHostRecord }> {
  const names = await readdir(directory)
  for (const name of names) {
    // Atomic replace publishes a temporary name before rename; it is never a host record.
    if (!vaultHostId.safeParse(name).success) continue
    const file = path.join(directory, name)
    try {
      yield { file, record: await readHostRecordFile(files, file) }
    } catch (error: unknown) {
      if (isVaultFileMissing(error)) continue
      throw error
    }
  }
}

/** The host record for `hostId`, read and parsed. */
export function readHostRecord(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  runDirectory: string,
  hostId: string,
): Promise<VaultHostRecord> {
  return readHostRecordFile(files, path.join(runDirectory, 'hosts', vaultHostId.parse(hostId)))
}

/** Removal that deletes only the record this registration wrote. */
export function hostRecordRemover(tracker: HostRegistrationTracker, file: string): () => void {
  const registered = lstatIdentitySync(file)
  const remove = (): void => {
    try {
      if (sameFile(registered, lstatIdentitySync(file))) unlinkSync(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    } finally {
      tracker.untrack(file)
    }
  }
  tracker.track(file, remove)
  return remove
}

/** Whether the stored record still names this host, session, birth and image. */
export function isHostRecordCurrent(
  record: VaultHostRecord,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
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

/** Removal lifecycle for a platform registrar's host records. */
export interface HostRegistrationTracker {
  track(file: string, remove: () => void): void
  untrack(file: string): void
}

/** One tracker per registrar; removals run once at process exit. */
export function hostRegistrationTracker(): HostRegistrationTracker {
  const registrations = new Map<string, () => void>()
  const lifecycle = { isWatching: false }
  return {
    track(file, remove) {
      if (!lifecycle.isWatching) {
        lifecycle.isWatching = true
        process.once('exit', () => {
          for (const tracked of registrations.values()) tracked()
        })
      }
      registrations.set(file, remove)
    },
    untrack(file) {
      registrations.delete(file)
    },
  }
}
