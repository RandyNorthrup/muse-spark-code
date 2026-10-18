import process from 'node:process'
import path from 'node:path'
import { unlinkSync } from 'node:fs'
import { readdir, unlink } from 'node:fs/promises'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import * as z from 'zod/mini'
import { lstatIdentitySync, sameFile } from '../../core/fs/fileIdentity'
import { UnixVaultPrivateFiles } from '../../core/vault/broker/files'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { vaultProcessIdentity } from './posixNative'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const hostSchema = z.strictObject({
  hostId: id,
  hostSession: id,
  processId: z.number().check(z.int(), z.positive()),
  userId: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  startedAt: z.number().check(z.int(), z.positive()),
  executable: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})

const registrations = new Map<string, () => void>()
const lifecycle = { isWatching: false }
function removeRegistrations(): void {
  for (const remove of registrations.values()) remove()
}

/** Only kernel-proven dead/PID-reused hosts are pruned; unreadable records still refuse. */
async function pruneHosts(directory: string, helper: string): Promise<void> {
  const files = new UnixVaultPrivateFiles()
  const names = await readdir(directory)
  for (const name of names) {
    // Atomic replace publishes a temporary name before rename; it is never a host record.
    if (!id.safeParse(name).success) continue
    const file = path.join(directory, name)
    let bytes: Buffer
    try {
      bytes = await files.read(file)
    } catch (error: unknown) {
      if (isVaultFileMissing(error)) continue
      throw error
    }
    const record = hostSchema.parse(JSON.parse(bytes.toString()))
    const live = await vaultProcessIdentity(helper, record.processId)
    if (live?.startedAt !== record.startedAt) {
      try {
        await unlink(file)
      } catch (error: unknown) {
        if (!isVaultFileMissing(error)) throw error
      }
    }
  }
}

/** Local trusted hosts publish launch facts in owner-only files, never in a wire claim. */
export async function registerPosixVaultHost(
  runDirectory: string,
  helper: string,
  hostId: string,
  hostSession: string,
): Promise<() => void> {
  const identity = await vaultProcessIdentity(helper, process.pid)
  if (identity?.userId !== String(process.getuid?.())) throw new Error(UI_TEXT.vault.noAccess)
  const record = hostSchema.parse({ ...identity, hostId, hostSession })
  const files = new UnixVaultPrivateFiles()
  const directory = path.join(runDirectory, 'hosts')
  await files.directory(directory)
  await pruneHosts(directory, helper)
  const file = path.join(directory, record.hostId)
  await files.replace(file, Buffer.from(JSON.stringify(record)))
  const registered = lstatIdentitySync(file)
  const remove = (): void => {
    try {
      if (sameFile(registered, lstatIdentitySync(file))) unlinkSync(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    } finally {
      registrations.delete(file)
    }
  }
  if (!lifecycle.isWatching) {
    lifecycle.isWatching = true
    process.once('exit', removeRegistrations)
  }
  registrations.set(file, remove)
  return remove
}

/** Rechecks birth and image against the native socket peer before granting manage authority. */
export async function isPosixVaultHost(
  runDirectory: string,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  try {
    const files = new UnixVaultPrivateFiles()
    const bytes = await files.read(path.join(runDirectory, 'hosts', id.parse(hostId)))
    const record = hostSchema.parse(JSON.parse(bytes.toString()))
    return (
      record.hostId === hostId &&
      (hostSession === undefined || record.hostSession === hostSession) &&
      record.processId === identity.processId &&
      record.userId === identity.userId &&
      record.startedAt === identity.startedAt &&
      record.executable === identity.executable
    )
  } catch {
    return false
  }
}
