import path from 'node:path'
import process from 'node:process'
import { unlinkSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { lstatSync, type Stats } from 'node:fs'
import { isVaultFileMissing, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import {
  createHostRegistrations,
  hostRecordFor,
  isVaultHost,
  pruneDeadHosts,
  publishHostRecord,
  trackHostFile,
} from './hostRegistry'
import { VaultLockEpoch, type VaultEpochWriterOwner } from '../../core/vault/broker/epoch'
import { runEpochSettleRounds, settleEpochWriter, type EpochRemnantPorts } from './epochContender'
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

const hosts = createHostRegistrations()

/**
 * The broker's native read of one process, shaped like the POSIX peer
 * answer. Trust rides in the answer itself (the helper's owner must equal
 * the process user): files mode has no ready frame, so there is no relay
 * owner to compare against.
 */
export async function windowsProcessIdentity(
  relay: PipeRelay,
  processId: number,
): Promise<{ process: WindowsVaultPipeProcess; ownerSid: string } | null> {
  if (!Number.isSafeInteger(processId) || processId <= 0) return null
  let answer: z.infer<typeof windowsVaultPipeProcessResultSchema>
  try {
    answer = await inspectWindowsProcess(relay, processId)
  } catch {
    return null
  }
  return answer.result !== 'ok' || answer.process?.userId !== answer.ownerSid
    ? null
    : { process: answer.process, ownerSid: answer.ownerSid }
}

/** This process's own native identity, shaped like the POSIX peer answer. */
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

/** Only kernel-proven dead/PID-reused hosts are pruned; unreadable records still refuse. */
async function pruneHosts(
  directory: string,
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
): Promise<void> {
  await pruneDeadHosts({
    directory,
    files,
    liveStartedAt: async (processId) => {
      const live = await windowsProcessIdentity(relay, processId)
      return live?.process.startedAt
    },
    retire: async (file) => {
      await guard.verify(file, 'file')
      try {
        unlinkSync(file)
      } catch (error: unknown) {
        if (!isVaultFileMissing(error)) throw error
      }
    },
  })
}

/** Local trusted hosts publish launch facts in owner-only files, never in a wire claim. */
export async function registerWindowsVaultHost(
  runDirectory: string,
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
  hostId: string,
  hostSession: string,
): Promise<() => void> {
  const identity = await windowsSelfIdentity(relay)
  const record = hostRecordFor(identity, hostId, hostSession)
  const directory = path.join(runDirectory, 'hosts')
  const file = await publishHostRecord(files, directory, record, () =>
    pruneHosts(directory, files, guard, relay),
  )
  return trackHostFile(hosts, file)
}

/** Rechecks birth and image against the native pipe identity before granting manage authority. */
export async function isWindowsVaultHost(
  runDirectory: string,
  files: VaultPrivateFilesPort,
  identity: VaultProcessIdentity,
  hostId: string,
  hostSession?: string,
): Promise<boolean> {
  return await isVaultHost(files, runDirectory, identity, hostId, hostSession)
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

/**
 * The settle rounds sample the relay-guarded file view: synchronous stat,
 * and retirement only after the guard verifies the file, like every other
 * file command. Liveness rides the pipe identity.
 */
function windowsRemnantPorts(ports: {
  files: VaultPrivateFilesPort
  guard: WindowsPipeFiles
  relay: PipeRelay
}): EpochRemnantPorts {
  return {
    files: ports.files,
    sample: (file) => lstatSync(file),
    assertRemnant: assertWindowsRemnant,
    retire: async (file) => {
      await ports.guard.verify(file, 'file')
      unlinkSync(file)
    },
    liveStartedAt: async (processId) => {
      const live = await windowsProcessIdentity(ports.relay, processId)
      return live?.process.startedAt
    },
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
      const remnant = windowsRemnantPorts(ports)
      return await runEpochSettleRounds(
        () =>
          epoch.bump(() => {
            authorize?.()
          }),
        () => settleEpochWriter(remnant, runDirectory, owner, mutexAcquiredAt),
      )
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
