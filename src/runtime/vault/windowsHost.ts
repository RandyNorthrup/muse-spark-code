import path from 'node:path'
import process from 'node:process'
import { unlinkSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { lstatSync, type Stats } from 'node:fs'
import {
  VAULT_CLAIM_PENDING_SUFFIX,
  isVaultFileMissing,
  type VaultPrivateFilesPort,
} from '../../core/vault/broker/files'
import {
  vaultEpochWriterPath,
  vaultEpochWriterSchema,
  VaultLockEpoch,
  type VaultEpochWriterOwner,
} from '../../core/vault/broker/epoch'
import {
  EPOCH_WRITER_SETTLE_ROUNDS,
  isEpochContended,
  readEpochWriterOwner,
  rereadEpochWriter,
  settleBumpRound,
} from './epochContender'
import {
  hostRecordFiles,
  hostRecordRemover,
  hostRegistrationTracker,
  isHostRecordCurrent,
  readHostRecord,
  vaultHostRecordSchema,
} from './hostRecords'
import type { VaultProcessIdentity } from '../../core/vault/broker/peer'
import type {
  windowsVaultPipeProcessResultSchema,
  WindowsVaultPipeProcess,
} from '../../core/vault/broker/windowsPipe'
import { UI_TEXT } from '../../shared/constants'
import {
  WindowsVaultPrivateFiles,
  WindowsPipeFiles,
  inspectWindowsProcess,
  type PipeRelay,
} from './windowsPipeRelay'

const tracker = hostRegistrationTracker()

/**
 * The broker's native read of one process, shaped like the POSIX peer
 * answer. Trust rides in the answer itself (the helper's owner must equal
 * the process user): files mode has no ready frame, so there is no relay
 * owner to compare against.
 */
/** This process's native identity for the broker's host record. */
export async function windowsSelfIdentity(relay: PipeRelay): Promise<VaultProcessIdentity> {
  const self = await windowsProcessIdentity(relay, process.pid)
  if (!self) throw new Error(UI_TEXT.vault.noAccess)
  return {
    processId: self.process.processId,
    userId: self.process.userId,
    startedAt: self.process.startedAt,
    executable: self.process.executable,
  }
}

export async function windowsProcessIdentity(
  relay: PipeRelay,
  processId: number,
): Promise<{ process: WindowsVaultPipeProcess; ownerSid: string } | null> {
  if (!Number.isSafeInteger(processId) || processId <= 0) return null
  let answer: z.infer<typeof windowsVaultPipeProcessResultSchema>
  try {
    answer = await inspectWindowsProcess(relay, processId)
  } catch {
    // An unprovable process is no host: identity needs proof, never a guess.
    return null
  }
  return answer.result !== 'ok' || answer.process?.userId !== answer.ownerSid
    ? null
    : { process: answer.process, ownerSid: answer.ownerSid }
}

/** Only kernel-proven dead/PID-reused hosts are pruned; unreadable records still refuse. */
async function pruneHosts(
  directory: string,
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
): Promise<void> {
  for await (const { file, record } of hostRecordFiles(files, directory)) {
    const live = await windowsProcessIdentity(relay, record.processId)
    if (live?.process.startedAt === record.startedAt) continue
    await guard.verify(file, 'file')
    try {
      unlinkSync(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    }
  }
}

/**
 * Local trusted hosts publish launch facts in owner-only files, never in a wire claim.
 * @unwired M109 Windows host registration (waits on the Windows broker join)
 */
export async function registerWindowsVaultHost(
  runDirectory: string,
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
  hostId: string,
  hostSession: string,
): Promise<() => void> {
  const identity = await windowsSelfIdentity(relay)
  const record = vaultHostRecordSchema.parse({ ...identity, hostId, hostSession })
  const directory = path.join(runDirectory, 'hosts')
  await files.directory(directory)
  await pruneHosts(directory, files, guard, relay)
  const file = path.join(directory, record.hostId)
  await files.replace(file, Buffer.from(JSON.stringify(record)))
  return hostRecordRemover(tracker, file)
}

/** Rechecks birth and image against the native pipe identity before granting manage authority. */
export async function isWindowsVaultHost(
  runDirectory: string,
  files: VaultPrivateFilesPort,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  try {
    const record = await readHostRecord(files, runDirectory, hostId)
    return isHostRecordCurrent(record, identity, hostId, hostSession)
  } catch {
    return false
  }
}

const holderSchema = z.strictObject({
  processId: z.number().check(z.int(), z.positive()),
  startedAt: z.number().check(z.int(), z.nonnegative()),
})

const CLAIM_LOCK_ROUNDS = 100
const CLAIM_LOCK_WAIT_MS = 50

/**
 * A claim file as a mutex for the audit and epoch lanes: the holder's
 * identity rides in the claim bytes, so a provably dead holder is retired
 * and a live one is awaited, bounded always. The kernel mutex this replaces
 * cannot be stolen either: only the holder releases, anyone retires the dead.
 */
export async function withWindowsClaimLock<T>(
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
  file: string,
  work: () => Promise<T>,
): Promise<T> {
  const self = await windowsProcessIdentity(relay, process.pid)
  if (!self) throw new Error(UI_TEXT.vault.noAccess)
  const holder = Buffer.from(
    JSON.stringify({ processId: self.process.processId, startedAt: self.process.startedAt }),
  )
  for (let round = 0; round < CLAIM_LOCK_ROUNDS; round++) {
    try {
      const release = await files.claim(file, holder)
      try {
        return await work()
      } finally {
        await release()
      }
    } catch (error: unknown) {
      if (!isVaultClaimConflict(error)) throw error
    }
    if (await didRetireDeadClaimLock(files, guard, relay, file)) continue
    await delay(CLAIM_LOCK_WAIT_MS)
  }
  throw new Error(UI_TEXT.vault.noAccess)
}

function isVaultClaimConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/**
 * Unlink a claim whose holder is provably gone; a live or unidentifiable
 * holder is left alone for the caller to await. The verify before the unlink
 * refuses reparse points and non-owner DACLs, like every other file command.
 */
async function didRetireDeadClaimLock(
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
  file: string,
): Promise<boolean> {
  let raw: Buffer
  try {
    raw = await files.read(file)
  } catch (error: unknown) {
    // Released between the claim and this read: reclaim on the next round.
    if (isVaultFileMissing(error)) return true
    throw error
  }
  let holder: z.infer<typeof holderSchema>
  try {
    holder = holderSchema.parse(JSON.parse(raw.toString('utf8')))
  } catch {
    // Not our shape: never delete what we cannot identify.
    return false
  }
  const live = await windowsProcessIdentity(relay, holder.processId)
  if (live !== null && live.process.startedAt === holder.startedAt) return false
  try {
    const reread = await files.read(file)
    const current = holderSchema.parse(JSON.parse(reread.toString('utf8')))
    if (current.processId !== holder.processId || current.startedAt !== holder.startedAt)
      return true
    await guard.verify(file, 'file')
    unlinkSync(file)
    return true
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return true
    throw error
  }
}

/**
 * Everything the broker entry and its bindings need from Windows that POSIX
 * reads from the peer binary and the kernel: one serve relay's files, guard
 * and native identity, plus the claim-file mutexes for the audit and epoch
 * lanes. Built once per broker start, from the starter's serve helper.
 */
export interface WindowsBrokerPlatform {
  readonly relay: PipeRelay
  readonly guard: WindowsPipeFiles
  readonly files: VaultPrivateFilesPort
  readonly ownerSid: string
  identify(pid: number): Promise<VaultProcessIdentity | null>
  isHost(
    runDirectory: string,
    identity: VaultProcessIdentity,
    hostId: string,
    hostSession?: string,
  ): Promise<boolean>
  withAuditLock<T>(dataDir: string, work: () => Promise<T>): Promise<T>
  bumpEpoch(
    runDirectory: string,
    owner: VaultEpochWriterOwner,
    authorize?: () => void,
  ): Promise<number>
}

/**
 * Only an owner-only non-link single-link file may be retired by these
 * rounds: anything else fails closed with no access, never deleted. The DACL
 * and reparse checks ride the helper's verify; Node reads the link count and
 * type around it. Same-user hardlink games are outside D89.15's scope.
 */
function assertWindowsRemnant(sample: Stats): void {
  if (sample.isSymbolicLink() || !sample.isFile() || sample.nlink !== 1)
    throw new Error(UI_TEXT.vault.noAccess)
}

async function retireWindowsStalePending(
  guard: WindowsPipeFiles,
  writer: string,
  mutexAcquiredAt: number,
): Promise<void> {
  const pending = `${writer}${VAULT_CLAIM_PENDING_SUFFIX}`
  let sample: Stats
  try {
    sample = lstatSync(pending)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  assertWindowsRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) throw new Error(UI_TEXT.vault.noAccess)
  await guard.verify(pending, 'file')
  unlinkSync(pending)
}

async function retireWindowsUnparsableWriter(
  ports: { files: VaultPrivateFilesPort; guard: WindowsPipeFiles },
  writer: string,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  let sample: Stats
  try {
    sample = lstatSync(writer)
  } catch (error: unknown) {
    // Released between the read and this check: reclaim on the next round.
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  assertWindowsRemnant(sample)
  if (sample.mtimeMs > mutexAcquiredAt) return 'wait'
  if ((await rereadEpochWriter(ports.files, writer)) === 'retry') return 'retry'
  try {
    await ports.guard.verify(writer, 'file')
    unlinkSync(writer)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
  return 'retry'
}

async function settleWindowsEpochWriter(
  ports: { files: VaultPrivateFilesPort; guard: WindowsPipeFiles; relay: PipeRelay },
  runDirectory: string,
  self: VaultEpochWriterOwner,
  mutexAcquiredAt: number,
): Promise<'retry' | 'wait'> {
  const writer = vaultEpochWriterPath(runDirectory)
  await retireWindowsStalePending(ports.guard, writer, mutexAcquiredAt)
  const read = await readEpochWriterOwner(ports.files, writer)
  if (read.state === 'retry') return 'retry'
  if (read.state === 'unparsable')
    return await retireWindowsUnparsableWriter(ports, writer, mutexAcquiredAt)
  const owner = read.owner
  // Our own record, or a same-process sibling's: both are alive by definition.
  if (owner.processId === self.processId && owner.startedAt === self.startedAt) return 'wait'
  let live: { startedAt: number } | null
  try {
    const identity = await windowsProcessIdentity(ports.relay, owner.processId)
    live = identity === null ? null : { startedAt: identity.process.startedAt }
  } catch {
    // Unprovable (native failure): fail closed.
    return 'wait'
  }
  if (live !== null && live.startedAt === owner.startedAt) return 'wait'
  // Provably gone: replace atomically. Owner-only checks plus a re-read of
  // the exact record precede the unlink; a release in flight surfaces as a
  // missing file and simply reclaims on the next round.
  try {
    const sample = lstatSync(writer)
    assertWindowsRemnant(sample)
    const reread = await ports.files.read(writer)
    const current = vaultEpochWriterSchema.parse(JSON.parse(reread.toString('utf8')))
    if (current.processId !== owner.processId || current.startedAt !== owner.startedAt)
      return 'retry'
    await ports.guard.verify(writer, 'file')
    unlinkSync(writer)
    return 'retry'
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return 'retry'
    throw error
  }
}

/**
 * Publish one epoch under the claim-file mutex: the Windows twin of
 * bumpVaultEpoch, with the same rounds, the same rule and the same bounded
 * refusal. The mutex cannot be stolen (only the holder releases, anyone
 * retires the dead), so there is no lost-lock unwind.
 */
export async function bumpWindowsVaultEpoch(
  ports: { files: VaultPrivateFilesPort; guard: WindowsPipeFiles; relay: PipeRelay },
  runDirectory: string,
  owner: VaultEpochWriterOwner,
  authorize?: () => void,
): Promise<number> {
  const epoch = new VaultLockEpoch(runDirectory, ports.files, owner)
  return await withWindowsClaimLock(
    ports.files,
    ports.guard,
    ports.relay,
    path.join(runDirectory, 'lock-epoch.lock'),
    async () => {
      // The recovery age rule retires only remnants older than this hold.
      const mutexAcquiredAt = Date.now()
      for (let round = 0; round < EPOCH_WRITER_SETTLE_ROUNDS; round++) {
        try {
          return await epoch.bump(() => {
            authorize?.()
          })
        } catch (error: unknown) {
          if (!isEpochContended(error)) throw error
          await settleBumpRound(round, error, () =>
            settleWindowsEpochWriter(ports, runDirectory, owner, mutexAcquiredAt),
          )
        }
      }
      throw new Error(UI_TEXT.vault.noAccess)
    },
  )
}

export function windowsBrokerPlatform(
  relay: PipeRelay,
  ownerSid: string,
  helperFile: string,
): WindowsBrokerPlatform {
  const guard = new WindowsPipeFiles(relay, () => new Error(UI_TEXT.vault.noAccess))
  const files: VaultPrivateFilesPort = new WindowsVaultPrivateFiles(guard, helperFile)
  const identify = async (pid: number): Promise<VaultProcessIdentity | null> => {
    const found = await windowsProcessIdentity(relay, pid)
    return found === null
      ? null
      : {
          processId: found.process.processId,
          userId: found.process.userId,
          startedAt: found.process.startedAt,
          executable: found.process.executable,
        }
  }
  return {
    relay,
    guard,
    files,
    ownerSid,
    identify,
    isHost: (runDirectory, identity, hostId, hostSession) =>
      isWindowsVaultHost(runDirectory, files, identity, hostId, hostSession),
    withAuditLock: (dataDir, work) =>
      withWindowsClaimLock(files, guard, relay, path.join(dataDir, 'audit.lock'), work),
    bumpEpoch: (runDirectory, owner, authorize) =>
      bumpWindowsVaultEpoch({ files, guard, relay }, runDirectory, owner, authorize),
  }
}
