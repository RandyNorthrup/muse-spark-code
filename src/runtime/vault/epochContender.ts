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

/**
 * The per-platform file sampling a settle round needs. POSIX samples the
 * kernel view and unlinks directly under the kernel mutex; Windows samples
 * synchronously and retires only after the relay guard verifies the file.
 * Liveness reads the platform's native identity; a throw means unprovable
 * (fail closed), while undefined means provably gone.
 */
export interface EpochRemnantPorts {
  readonly files: VaultPrivateFilesPort
  sample(file: string): Promise<Stats> | Stats
  assertRemnant(sample: Stats): void
  retire(file: string): Promise<void>
  liveStartedAt(processId: number): Promise<number | undefined>
}

async function retireStalePending(
  ports: EpochRemnantPorts,
  writer: string,
  mutexAcquiredAt: number,
): Promise<void> {
  const pending = `${writer}${VAULT_CLAIM_PENDING_SUFFIX}`
  let sample: Stats
  try {
    sample = await ports.sample(pending)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  // Never opened by a reader; still, only an owner-only remnant older than
  // the hold is retired. Anything else fails closed below, never deleted.
  ports.assertRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) throw new Error(UI_TEXT.vault.noAccess)
  await ports.retire(pending)
}

/** A writer read: its owner, a release to reclaim, or a remnant to retire. */
export type EpochWriterRead =
  | { readonly state: 'owner'; readonly owner: VaultEpochWriterOwner }
  | { readonly state: 'retry' }
  | { readonly state: 'unparsable' }

/** The writer's owner, read and parsed; releases reclaim, remnants retire. */
export async function readEpochWriterOwner(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  writer: string,
): Promise<EpochWriterRead> {
  let raw: Buffer
  try {
    raw = await files.read(writer)
  } catch (error: unknown) {
    // Released between our claim and this read: reclaim on the next round.
    if (isVaultFileMissing(error)) return { state: 'retry' }
    throw error
  }
  try {
    const parsed = vaultEpochWriterSchema.parse(JSON.parse(raw.toString('utf8')))
    return { state: 'owner', owner: { processId: parsed.processId, startedAt: parsed.startedAt } }
  } catch {
    return { state: 'unparsable' }
  }
}

/**
 * A complete record that appeared under the mutex goes back to the rule;
 * anything else stays for the remnant below to retire.
 */
export async function rereadEpochWriter(
  files: Pick<VaultPrivateFilesPort, 'read'>,
  writer: string,
): Promise<'retry' | 'unparsable'> {
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
    return 'unparsable'
  }
}

/** Only a contended writer is decided by rule; every other failure keeps its meaning. */
export function isEpochContended(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/** One settle round's wait, if the round says to wait. */
async function settleEpochRound(settled: Promise<'retry' | 'wait'>): Promise<void> {
  if ((await settled) === 'wait') await delay(EPOCH_WRITER_SETTLE_WAIT_MS)
}

/** A contended bump round: exhausted rounds refuse, settled ones wait. */
export async function settleBumpRound(
  round: number,
  cause: unknown,
  settle: () => Promise<'retry' | 'wait'>,
): Promise<void> {
  if (round + 1 >= EPOCH_WRITER_SETTLE_ROUNDS) throw new Error(UI_TEXT.vault.noAccess, { cause })
  await settleEpochRound(settle())
}

/**
 * Retire an empty or partial writer record left by a publisher killed before
 * its publication. Only while the kernel mutex is held (the sole caller
 * holds it) and only when the remnant predates the hold: a newer file waits
 * for the bounded rounds instead of being removed.
 */
async function retireUnparsableWriter(
  ports: EpochRemnantPorts,
  writer: string,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  let sample: Stats
  try {
    sample = await ports.sample(writer)
  } catch (error: unknown) {
    // Released between the read and this check: reclaim on the next round.
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  ports.assertRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) return 'wait'
  let reread: Buffer
  try {
    reread = await ports.files.read(writer)
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
    await ports.retire(writer)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  return 'retry'
}

/**
 * Decide one contended epoch writer by rule; shared by the POSIX kernel
 * mutex and the Windows claim-file mutex, which differ only in how they
 * sample and retire files and read native liveness.
 */
export async function settleEpochWriter(
  ports: EpochRemnantPorts,
  runDirectory: string,
  self: VaultEpochWriterOwner,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  const writer = vaultEpochWriterPath(runDirectory)
  await retireStalePending(ports, writer, mutexAcquiredAt)
  let raw: Buffer
  try {
    raw = await ports.files.read(writer)
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
    return await retireUnparsableWriter(ports, writer, mutexAcquiredAt)
  }
  // Our own record, or a same-process sibling's: both are alive by definition.
  if (owner.processId === self.processId && owner.startedAt === self.startedAt) return 'wait'
  let liveStartedAt: number | undefined
  try {
    liveStartedAt = await ports.liveStartedAt(owner.processId)
  } catch {
    // Unprovable (native failure): fail closed.
    return 'wait'
  }
  if (liveStartedAt !== undefined && liveStartedAt === owner.startedAt) return 'wait'
  // Provably gone: replace atomically. Owner-only checks plus a re-read of
  // the exact record precede the unlink; a release in flight surfaces as a
  // missing file and simply reclaims on the next round.
  try {
    const sample = await ports.sample(writer)
    ports.assertRemnant(sample)
    const reread = await ports.files.read(writer)
    const current = vaultEpochWriterSchema.parse(JSON.parse(reread.toString('utf8')))
    if (current.processId !== owner.processId || current.startedAt !== owner.startedAt)
      return 'retry'
    await ports.retire(writer)
    return 'retry'
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
}

/**
 * Drive one epoch bump through contended-writer rounds: a dead holder's
 * record is retired and the bump reclaimed at once, a live holder is
 * awaited briefly, and only exhausted rounds refuse. Never leaks EEXIST.
 */
export async function runEpochSettleRounds(
  bump: () => Promise<number>,
  settle: () => Promise<'retry' | 'wait'>,
): Promise<number> {
  for (let round = 0; round < EPOCH_WRITER_SETTLE_ROUNDS; round++) {
    try {
      return await bump()
    } catch (error: unknown) {
      // Only a contended writer is decided by rule; every other failure keeps its meaning.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (round + 1 >= EPOCH_WRITER_SETTLE_ROUNDS)
        throw new Error(UI_TEXT.vault.noAccess, { cause: error })
      if ((await settle()) === 'wait') await delay(EPOCH_WRITER_SETTLE_WAIT_MS)
    }
  }
  throw new Error(UI_TEXT.vault.noAccess)
}

// A live holder releases its writer within quanta: guardian loss already
// failed its authorize, so it can only unwind. Bounded always.
export const EPOCH_WRITER_SETTLE_ROUNDS = 10
export const EPOCH_WRITER_SETTLE_WAIT_MS = 50

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
  const ports: EpochRemnantPorts = {
    files,
    sample: (file) => lstat(file),
    assertRemnant: assertOwnerOnlyRemnant,
    retire: (file) => unlink(file),
    liveStartedAt: async (processId) => {
      const live = await vaultProcessIdentity(helper, processId)
      return live?.startedAt
    },
  }
  try {
    return await runEpochSettleRounds(
      () =>
        epoch.bump(() => {
          if (hasLostLock) throw new Error(UI_TEXT.vault.noAccess)
          authorize?.()
        }),
      () => settleEpochWriter(ports, runDirectory, owner, mutexAcquiredAt),
    )
  } finally {
    await held.release()
  }
}
