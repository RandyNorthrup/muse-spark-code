import path from 'node:path'
import process from 'node:process'
import { constants, type Stats } from 'node:fs'
import { lstat, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import {
  vaultEpochWriterPath,
  vaultEpochWriterSchema,
  VaultLockEpoch,
  type VaultEpochWriterOwner,
} from '../../core/vault/broker/epoch'
import {
  VAULT_CLAIM_PENDING_SUFFIX,
  isVaultFileMissing,
  type VaultPrivateFilesPort,
} from '../../core/vault/broker/files'
import { UI_TEXT } from '../../shared/constants'
import { holdVaultStartupLock, vaultProcessIdentity } from './posixNative'

/**
 * Decide a contended epoch writer by rule. The caller holds lock-epoch.lock,
 * so no other epoch writer can interleave: a recorded holder that is provably
 * gone (the same native identity evidence the broker lock lane uses) is
 * unlinked so the next round claims fresh; a live, unprovable or
 * unidentified holder is left alone for the caller to wait on. Never deletes
 * what it cannot identify, never leaks EEXIST: 'retry' reclaims at once,
 * 'wait' means try again shortly, and only the caller refuses when its
 * bounded rounds run out (RVCM109JD P2-1).
 *
 * RVCM109JE P2-1: an empty or unparsable record (a publisher killed before
 * its atomic publication by an older build, which wrote the record in place)
 * is retired, but only while the kernel mutex is held — the sole caller
 * holds it — and only when the remnant predates the hold, so a concurrent
 * publication (impossible under the mutex) could never be removed. The same
 * age rule retires the fixed pending temporary first, which also restores
 * the single link a kill between publication and temporary cleanup leaves
 * behind. Empty, partial and valid-but-dead records are all covered.
 */
/**
 * Only an owner-only non-link single-link file may be retired by these
 * rounds: anything else fails closed with no access, never deleted.
 */
function assertOwnerOnlyRemnant(sample: Stats): void {
  if (
    sample.isSymbolicLink() ||
    !sample.isFile() ||
    sample.nlink !== 1 ||
    sample.uid !== process.getuid?.() ||
    (sample.mode & (constants.S_IRWXG | constants.S_IRWXO)) !== 0
  )
    throw new Error(UI_TEXT.vault.noAccess)
}
async function retireStalePending(writer: string, mutexAcquiredAt: number): Promise<void> {
  const pending = `${writer}${VAULT_CLAIM_PENDING_SUFFIX}`
  let sample
  try {
    sample = await lstat(pending)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  // Never opened by a reader; still, only an owner-only remnant older than
  // the hold is retired. Anything else fails closed below, never deleted.
  assertOwnerOnlyRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) throw new Error(UI_TEXT.vault.noAccess)
  await unlink(pending)
}

/**
 * Retire an empty or partial writer record left by a publisher killed before
 * its publication. Only while the kernel mutex is held (the sole caller
 * holds it) and only when the remnant predates the hold: a newer file waits
 * for the bounded rounds instead of being removed.
 */
async function retireUnparsableWriter(
  files: VaultPrivateFilesPort,
  writer: string,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  let sample
  try {
    sample = await lstat(writer)
  } catch (error: unknown) {
    // Released between the read and this check: reclaim on the next round.
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  assertOwnerOnlyRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) return 'wait'
  let reread: Buffer
  try {
    reread = await files.read(writer)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  try {
    vaultEpochWriterSchema.parse(JSON.parse(reread.toString('utf8')))
    // A complete record appeared under the mutex: decide it by rule next round.
    return 'retry'
  } catch {
    /* Still unparsable: the remnant below is retired. */
  }
  try {
    await unlink(writer)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  return 'retry'
}

async function settleEpochWriter(
  files: VaultPrivateFilesPort,
  helper: string,
  runDirectory: string,
  self: VaultEpochWriterOwner,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  const writer = vaultEpochWriterPath(runDirectory)
  await retireStalePending(writer, mutexAcquiredAt)
  let raw: Buffer
  try {
    raw = await files.read(writer)
  } catch (error: unknown) {
    // Released between our claim and this read: reclaim on the next round.
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  let owner: VaultEpochWriterOwner
  try {
    const parsed = vaultEpochWriterSchema.parse(JSON.parse(raw.toString('utf8')))
    owner = { processId: parsed.processId, startedAt: parsed.startedAt }
  } catch {
    return await retireUnparsableWriter(files, writer, mutexAcquiredAt)
  }
  // Our own record, or a same-process sibling's: both are alive by definition.
  if (owner.processId === self.processId && owner.startedAt === self.startedAt) return 'wait'
  let live: { startedAt: number } | null
  try {
    const identity = await vaultProcessIdentity(helper, owner.processId)
    live = identity === null ? null : { startedAt: identity.startedAt }
  } catch {
    // Unprovable (native failure): fail closed.
    return 'wait'
  }
  if (live !== null && live.startedAt === owner.startedAt) return 'wait'
  // Provably gone: replace atomically. Owner-only checks plus a re-read of
  // the exact record precede the unlink; a release in flight surfaces as a
  // missing file and simply reclaims on the next round.
  try {
    const sample = await lstat(writer)
    assertOwnerOnlyRemnant(sample)
    const reread = await files.read(writer)
    const current = vaultEpochWriterSchema.parse(JSON.parse(reread.toString('utf8')))
    if (current.processId !== owner.processId || current.startedAt !== owner.startedAt)
      return 'retry'
    await unlink(writer)
    return 'retry'
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
}

// A live holder releases its writer within quanta: guardian loss already
// failed its authorize, so it can only unwind. Bounded always.
const EPOCH_WRITER_SETTLE_ROUNDS = 10
const EPOCH_WRITER_SETTLE_WAIT_MS = 50

/**
 * Publish one epoch under the shared kernel mutex. A contender that finds the
 * writer already claimed decides by rule instead of failing EEXIST: a dead
 * holder's record is replaced and the bump proceeds; a live holder is
 * awaited briefly, then refused with the fixed reason. The caller's session
 * survives either way: it retries after a refusal, never an unhandled EEXIST.
 */
export async function bumpVaultEpoch(
  helper: string,
  runDirectory: string,
  files: VaultPrivateFilesPort,
  owner: VaultEpochWriterOwner,
  authorize?: () => void,
): Promise<number> {
  const epoch = new VaultLockEpoch(runDirectory, files, owner)
  const held = await holdVaultStartupLock(helper, path.join(runDirectory, 'lock-epoch.lock'), true)
  // The recovery age rule retires only remnants older than this hold.
  const mutexAcquiredAt = Date.now()
  let hasLostLock = false
  held.onLost(() => {
    hasLostLock = true
  })
  try {
    for (let round = 0; round < EPOCH_WRITER_SETTLE_ROUNDS; round++) {
      try {
        return await epoch.bump(() => {
          if (hasLostLock) throw new Error(UI_TEXT.vault.noAccess)
          authorize?.()
        })
      } catch (error: unknown) {
        // Only a contended writer is decided by rule; every other failure keeps its meaning.
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        if (round + 1 >= EPOCH_WRITER_SETTLE_ROUNDS)
          throw new Error(UI_TEXT.vault.noAccess, { cause: error })
        const settled = await settleEpochWriter(files, helper, runDirectory, owner, mutexAcquiredAt)
        if (settled === 'wait') await delay(EPOCH_WRITER_SETTLE_WAIT_MS)
      }
    }
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    await held.release()
  }
}
