import process from 'node:process'
import path from 'node:path'
import { unlink } from 'node:fs/promises'
import { UnixVaultPrivateFiles } from '../../core/vault/broker/files'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import { UI_TEXT } from '../../shared/constants'
import { vaultProcessIdentity } from './posixNative'
import {
  createHostRegistrations,
  hostRecordFor,
  isVaultHost,
  pruneDeadHosts,
  publishHostRecord,
  trackHostFile,
} from './hostRegistry'

const hosts = createHostRegistrations()

/** Only kernel-proven dead/PID-reused hosts are pruned; unreadable records still refuse. */
async function pruneHosts(directory: string, helper: string): Promise<void> {
  await pruneDeadHosts({
    directory,
    files: new UnixVaultPrivateFiles(),
    liveStartedAt: async (processId) => {
      const live = await vaultProcessIdentity(helper, processId)
      return live?.startedAt
    },
    retire: (file) => unlink(file),
  })
}

/** Local trusted hosts publish launch facts in owner-only files, never in a wire claim. */
export async function registerPosixVaultHost(
  runDirectory: string,
  helper: string,
  hostId: string,
  hostSession: string,
): Promise<() => void> {
  const identity = await vaultProcessIdentity(helper, process.pid)
  if (identity === null) throw new Error(UI_TEXT.vault.noAccess)
  if (identity.userId !== String(process.getuid?.())) throw new Error(UI_TEXT.vault.noAccess)
  const record = hostRecordFor(identity, hostId, hostSession)
  const files = new UnixVaultPrivateFiles()
  const directory = path.join(runDirectory, 'hosts')
  const file = await publishHostRecord(files, directory, record, () =>
    pruneHosts(directory, helper),
  )
  return trackHostFile(hosts, file)
}

/** Rechecks birth and image against the native socket peer before granting manage authority. */
export async function isPosixVaultHost(
  runDirectory: string,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  return await isVaultHost(new UnixVaultPrivateFiles(), runDirectory, identity, hostId, hostSession)
}
