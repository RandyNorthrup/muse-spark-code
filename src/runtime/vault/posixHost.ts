import process from 'node:process'
import path from 'node:path'
import { unlink } from 'node:fs/promises'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import { UnixVaultPrivateFiles } from '../../core/vault/broker/files'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import { UI_TEXT } from '../../shared/constants'
import { vaultProcessIdentity } from './posixNative'
import {
  hostRecordFiles,
  hostRecordRemover,
  hostRegistrationTracker,
  isHostRecordCurrent,
  readHostRecord,
  vaultHostRecordSchema,
} from './hostRecords'

const tracker = hostRegistrationTracker()

/** Only kernel-proven dead/PID-reused hosts are pruned; unreadable records still refuse. */
async function pruneHosts(directory: string, helper: string): Promise<void> {
  const files = new UnixVaultPrivateFiles()
  for await (const { file, record } of hostRecordFiles(files, directory)) {
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
  const record = vaultHostRecordSchema.parse({ ...identity, hostId, hostSession })
  const files = new UnixVaultPrivateFiles()
  const directory = path.join(runDirectory, 'hosts')
  await files.directory(directory)
  await pruneHosts(directory, helper)
  const file = path.join(directory, record.hostId)
  await files.replace(file, Buffer.from(JSON.stringify(record)))
  return hostRecordRemover(tracker, file)
}

/** Rechecks birth and image against the native socket peer before granting manage authority. */
export async function isPosixVaultHost(
  runDirectory: string,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  try {
    const record = await readHostRecord(new UnixVaultPrivateFiles(), runDirectory, hostId)
    return isHostRecordCurrent(record, identity, hostId, hostSession)
  } catch {
    return false
  }
}
