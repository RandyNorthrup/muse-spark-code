// The session-broker launch both client platforms share: POSIX (owner-only
// run directory, peer helper) and Windows (pipe helper, pipe discovery).
// The broker child is always dist/vaultBroker.js beside the running bundle,
// handed off with only OS facts in its environment, never credentials.

import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { isVaultFileMissing, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import { handoffResourceFile } from '../../core/resources/launcher'
import { vaultBrokerLockSchema } from '../../shared/vaultProtocol'
import { UI_TEXT, VAULT_BROKER_NATIVE_TIMEOUT_MS } from '../../shared/constants'
import type { VaultClientPlatformContext } from './clientPlatform'

/** Guard the caller's folders and resolve the install root beside dist. */
export function vaultInstallRoot(context: VaultClientPlatformContext): string {
  if (!path.isAbsolute(context.dataDir) || !path.isAbsolute(context.distDir))
    throw new Error(UI_TEXT.vault.noAccess)
  return path.dirname(context.distDir)
}

/**
Re-read broker.lock after a discovery failure. True means the broker is
provably gone (orderly shutdown removed the record, or its owner is dead
or reused), so the caller treats the broker as absent; false means a live
broker is still starting and the caller keeps waiting. Missing or live
records never read as gone; anything else keeps its failure.
*/
export async function isBrokerLockGone(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  directory: string,
  userSession: string,
  liveStartedAt: (processId: number) => Promise<number | undefined>,
): Promise<boolean> {
  let bytes: Buffer
  try {
    bytes = await files.read(path.join(directory, 'broker.lock'))
  } catch (recheckError: unknown) {
    // Orderly shutdown removes token before record, even while its process is still live.
    if (isVaultFileMissing(recheckError)) return true
    throw recheckError
  }
  const lock = vaultBrokerLockSchema.parse(JSON.parse(bytes.toString()))
  const startedAt = await liveStartedAt(lock.processId)
  return lock.userSession === userSession && startedAt !== lock.startedAt
}

/**
Spawn the handed-off session broker and wait for discovery to find it.
Returns once a ready broker answers; refuses when no broker appears
within the native timeout. The payload carries only OS facts (folders,
sessions, helper digests), never credentials.
*/
export async function launchSessionBroker(options: {
  readonly script: string
  readonly payload: unknown
  readonly env: NodeJS.ProcessEnv
  readonly isReady: () => Promise<boolean>
}): Promise<void> {
  if (await options.isReady()) return
  await handoffResourceFile(process.execPath, [options.script, JSON.stringify(options.payload)], {
    env: options.env,
    until: 'spawn',
  })
  const deadline = Date.now() + VAULT_BROKER_NATIVE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await options.isReady()) return
    await delay(VAULT_BROKER_NATIVE_TIMEOUT_MS / 100)
  }
  throw new Error(UI_TEXT.vault.brokerBlocked)
}
