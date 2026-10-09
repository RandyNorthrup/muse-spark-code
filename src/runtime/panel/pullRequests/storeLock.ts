// The worktree records' cross-process lock (M123, PLAN.md M123's lock
// protocol). It keeps windows from racing each other's read-modify-write;
// it is not what keeps the records safe. The generations are: every write
// is the exclusive creation of the next generation (recordGenerations.ts),
// so an owner that lost this lock without knowing it can never land a
// write over the new owner's.
//
// - Acquire: one lock file, created exclusively (O_EXCL), holding its
//   owner's note: the host, the process id and start time, a random id,
//   and a lease.
// - Expired: the lease ran out (never later than the lease after the
//   file was last written, whatever the note claims); or the owner is gone
//   (on this host: no such process, or this process's id with another
//   start time); or the note is missing or torn and the file was last
//   written longer ago than a short bound (a crash between create and
//   write).
// - Takeover and release move the exact instance aside with one atomic
//   rename, then compare the moved file's native identity with the one
//   judged expired (or owned). A newer lock moved by mistake is linked
//   back where its owner looks, only while that name is free; a new lock is
//   only ever made by the exclusive create. So no waiter ever deletes
//   another window's fresh lock.

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import * as z from 'zod/mini'
import { identityOf, sameFile, type FileIdentity } from '../../../core/fs/fileIdentity'
import {
  MILLISECONDS_PER_SECOND,
  PROCESS_START_TOLERANCE_MS,
  WORKTREE_RECORD_LOCK_POLL_MS,
  WORKTREE_RECORD_LOCK_UNREADABLE_MS,
} from '../../../shared/constants'
import { errorCode, isBusy, RETIRED_LOCK_SUFFIX, type RecordStoreFs } from './recordStoreFs'

const NO_SUCH_PROCESS = 'ESRCH'

const processOwnerSchema = z.object({
  host: z.string(),
  pid: z.number(),
  processStart: z.number(),
})

/** A process, as a lock or a pending checkout names its owner. */
export type ProcessOwner = z.infer<typeof processOwnerSchema>

const lockNoteSchema = z.object({
  owner: processOwnerSchema,
  id: z.string(),
  acquiredAt: z.number(),
  leaseUntil: z.number(),
})

type LockNote = z.infer<typeof lockNoteSchema>

// Sampled once: the uptime arithmetic moves by a few milliseconds per call.
const PROCESS_START = Math.round(Date.now() - process.uptime() * MILLISECONDS_PER_SECOND)

/** This process: its host, its id and its start time. */
export function currentProcessOwner(): ProcessOwner {
  return { host: hostname(), pid: process.pid, processStart: PROCESS_START }
}

/** Whether a process with this id exists (one we may not signal still does). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return errorCode(error) !== NO_SUCH_PROCESS
  }
}

/**
 * Whether `owner` is provably gone: on this host, no process has its id,
 * or this process has its id with another start time (an earlier process
 * the system reused the id from). Another host's process, or a live id
 * (possibly reused), is never provably gone: its lease decides.
 */
export function isProcessOwnerGone(
  owner: ProcessOwner,
  self: ProcessOwner = currentProcessOwner(),
  isAlive: (pid: number) => boolean = isProcessAlive,
): boolean {
  if (owner.host !== self.host) {
    return false
  }
  return owner.pid === self.pid
    ? Math.abs(owner.processStart - self.processStart) > PROCESS_START_TOLERANCE_MS
    : !isAlive(owner.pid)
}

export interface StoreLockEnv {
  readonly fs: RecordStoreFs
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly owner: ProcessOwner
  readonly isOwnerGone: (owner: ProcessOwner) => boolean
  readonly leaseMs: number
  readonly timeoutMs: number
}

/** The lock, held: this exact file instance, with this note. */
export interface StoreLease {
  /** Still this very instance, its lease running: checked before every publish. */
  isHeld(): Promise<boolean>
  /** Removes this instance only; a lock someone took over stays theirs. Never throws. */
  release(): Promise<void>
}

/** The records are busy past the wait: nothing was written. */
export class StoreBusyError extends Error {
  public constructor() {
    super('The worktree records are busy')
    this.name = 'StoreBusyError'
  }
}

type Observation =
  | { readonly kind: 'gone' }
  | { readonly kind: 'changing' }
  | {
      readonly kind: 'seen'
      readonly identity: FileIdentity
      /** The file's last write, epoch ms. */
      readonly writtenAt: number
      readonly note: LockNote | undefined
    }

function parseNote(bytes: Buffer): LockNote | undefined {
  try {
    const parsed = lockNoteSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** The lock as it is: one instance, read whole between two identical samples. */
async function observe(fs: RecordStoreFs, lockPath: string): Promise<Observation> {
  try {
    const before = await fs.lstat(lockPath)
    const bytes = await fs.readFile(lockPath)
    const after = await fs.lstat(lockPath)
    if (
      !sameFile(before, after) ||
      before.mtimeNs !== after.mtimeNs ||
      before.size !== after.size ||
      !after.isFile()
    ) {
      return { kind: 'changing' }
    }
    return {
      kind: 'seen',
      identity: identityOf(after),
      writtenAt: Number(after.mtimeMs),
      note: parseNote(bytes),
    }
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return { kind: 'gone' }
    }
    throw error
  }
}

/** Whether the instance seen may be taken over. */
function isExpired(
  seen: Extract<Observation, { kind: 'seen' }>,
  env: Pick<StoreLockEnv, 'now' | 'isOwnerGone' | 'leaseMs'>,
): boolean {
  const now = env.now()
  if (seen.note === undefined) {
    // Missing or torn: its writer died between create and write, or wrote
    // something no version reads. Live writers finish in microseconds.
    return now - seen.writtenAt > WORKTREE_RECORD_LOCK_UNREADABLE_MS
  }
  // No note pins the lock past the lease after its file was last written.
  const until = Math.min(seen.note.leaseUntil, seen.writtenAt + env.leaseMs)
  return now >= until || env.isOwnerGone(seen.note.owner)
}

/**
 * Moves the instance `identity` out of the lock's name with one atomic
 * rename. True when that very instance left the name (or the name was
 * already free); a newer instance moved by mistake goes back, only while
 * the name is free, and the answer is false.
 */
async function hasRetiredInstance(
  fs: RecordStoreFs,
  lockPath: string,
  identity: FileIdentity,
): Promise<boolean> {
  const aside = `${lockPath}.${randomUUID()}${RETIRED_LOCK_SUFFIX}`
  try {
    await fs.rename(lockPath, aside)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return true
    }
    if (isBusy(error)) {
      return false
    }
    throw error
  }
  let moved: FileIdentity | undefined
  try {
    moved = identityOf(await fs.lstat(aside))
  } catch {
    moved = undefined
  }
  const isThatInstance = moved !== undefined && sameFile(moved, identity)
  if (moved !== undefined && !isThatInstance) {
    try {
      // The same inode back under the name: its owner's identity check
      // still holds. Only while the name is free: never over a third lock.
      await fs.link(aside, lockPath)
    } catch {
      // The name was taken again meanwhile: that owner's next isHeld
      // fails and it stops before publishing; the generations fence it.
    }
  }
  try {
    await fs.unlink(aside)
  } catch {
    // Swept later with the generations' leftovers.
  }
  return isThatInstance
}

function lease(
  fs: RecordStoreFs,
  lockPath: string,
  identity: FileIdentity,
  note: LockNote,
  now: () => number,
): StoreLease {
  let isReleased = false
  const isHeld = async (): Promise<boolean> => {
    if (isReleased || now() >= note.leaseUntil) {
      return false
    }
    const seen = await observe(fs, lockPath)
    return seen.kind === 'seen' && sameFile(seen.identity, identity) && seen.note?.id === note.id
  }
  return {
    isHeld,
    release: async () => {
      if (isReleased) {
        return
      }
      try {
        const seen = await observe(fs, lockPath)
        isReleased = true
        if (seen.kind === 'seen' && sameFile(seen.identity, identity)) {
          await hasRetiredInstance(fs, lockPath, identity)
        }
      } catch {
        // Unreleased, it expires with its lease; nothing else depends on it.
        isReleased = true
      }
    },
  }
}

/**
 * Takes the lock at `lockPath` (its folder exists): created exclusively,
 * or, once the instance there expired, taken over as above. Throws
 * `StoreBusyError` past the wait, never writing uncoordinated.
 */
export async function acquireStoreLock(lockPath: string, env: StoreLockEnv): Promise<StoreLease> {
  const deadline = env.now() + env.timeoutMs
  for (;;) {
    const acquiredAt = env.now()
    const note: LockNote = {
      owner: env.owner,
      id: randomUUID(),
      acquiredAt,
      leaseUntil: acquiredAt + env.leaseMs,
    }
    let isCreated = false
    try {
      await env.fs.createExclusive(lockPath, JSON.stringify(note))
      isCreated = true
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') {
        throw error
      }
    }
    const seen = await observe(env.fs, lockPath)
    if (isCreated && seen.kind === 'seen' && seen.note?.id === note.id) {
      return lease(env.fs, lockPath, seen.identity, note, env.now)
    }
    if (seen.kind === 'gone') {
      continue
    }
    if (
      !isCreated &&
      seen.kind === 'seen' &&
      isExpired(seen, env) &&
      (await hasRetiredInstance(env.fs, lockPath, seen.identity))
    ) {
      continue
    }
    if (env.now() >= deadline) {
      throw new StoreBusyError()
    }
    await env.sleep(WORKTREE_RECORD_LOCK_POLL_MS)
  }
}
