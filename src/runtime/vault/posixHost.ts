import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
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

/** Local trusted hosts publish launch facts in owner-only files, never in a wire claim. */
export async function registerPosixVaultHost(
  runDirectory: string,
  helper: string,
  hostId: string,
  hostSession: string,
): Promise<void> {
  const identity = await vaultProcessIdentity(helper, process.pid)
  if (identity?.userId !== String(process.getuid?.())) throw new Error(UI_TEXT.vault.noAccess)
  const record = hostSchema.parse({ ...identity, hostId, hostSession })
  const files = new UnixVaultPrivateFiles()
  const directory = path.join(runDirectory, 'hosts')
  await files.directory(directory)
  await files.replace(path.join(directory, record.hostId), Buffer.from(JSON.stringify(record)))
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
