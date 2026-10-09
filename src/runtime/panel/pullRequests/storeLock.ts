// The worktree records' cross-process lock (M123, PLAN.md M123's lock
// protocol). It keeps windows from racing each other's read-modify-write;
// it is not what keeps the records safe. The generations are: every write
// is the exclusive creation of the next generation (recordGenerations.ts),
// so an owner that lost this lock without knowing it can never land a
// write over the new owner's.
//
// - Acquire: one lock file, created exclusively (O_EXCL), holding its
//   owner's note: the host, the process id and start time, a random id,
//   and the lease its holder keeps.
// - Time: every wait and every lease is measured on this process's
//   monotonic clock, never the wall clock, so a clock step can neither
//   extend nor cut a lease or a wait. The holder holds for its lease from
//   just before it created the file. A waiter takes over only an instance
//   it has itself watched, unchanged, for that holder's lease (never more
//   than the longest lease it honors), so it never acts before the
//   holder's own lease has ended.
// - Expired early: the owner is provably gone (on this host: no process
//   has its id, or the one that has it started at another time); or the
//   note is missing or torn (a crash between create and write) and the
//   waiter has watched the instance for a short bound.
// - Takeover and release move the exact instance aside with one atomic
//   rename, then compare the moved file's native identity with the one
//   judged expired (or owned). A newer lock moved by mistake is linked
//   back where its owner looks, only while that name is free; a new lock is
//   only ever made by the exclusive create. So no waiter ever deletes
//   another window's fresh lock.

import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { identityOf, sameFile, type FileIdentity } from '../../../core/fs/fileIdentity'
import { WORKTREE_RECORD_LOCK_POLL_MS } from '../../../shared/constants'
import { processOwnerSchema, type ProcessOwner } from './processOwner'
import { errorCode, isBusy, RETIRED_LOCK_SUFFIX, type RecordStoreFs } from './recordStoreFs'

const lockNoteSchema = z.object({
  owner: processOwnerSchema,
  id: z.string(),
  /** Wall-clock epoch ms, for people reading the file: never judged. */
  acquiredAt: z.number(),
  /** How long the holder holds, on its own monotonic clock. */
  leaseMs: z.number(),
})

type LockNote = z.infer<typeof lockNoteSchema>

export interface StoreLockEnv {
  readonly fs: RecordStoreFs
  /** The wall clock: only written into the note for people reading it. */
  readonly now: () => number
  /** Milliseconds on a clock that never steps: every wait and lease. */
  readonly monotonic: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly owner: ProcessOwner
  readonly isOwnerGone: (owner: ProcessOwner) => Promise<boolean>
  /** How long this window holds the lock. */
  readonly leaseMs: number
  /** The longest lease of another window this one waits out. */
  readonly honoredLeaseMs: number
  /** How long an instance without a readable note is watched before it is a crash's. */
  readonly unreadableMs: number
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
      readonly note: LockNote | undefined
    }

/** One instance this waiter watches: since when, on its monotonic clock. */
interface Watch {
  readonly identity: FileIdentity
  readonly noteId: string | undefined
  readonly since: number
  readonly isOwnerGone: boolean
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
    const isSteady =
      sameFile(before, after) &&
      before.mtimeNs === after.mtimeNs &&
      before.size === after.size &&
      after.isFile()
    return isSteady
      ? { kind: 'seen', identity: identityOf(after), note: parseNote(bytes) }
      : { kind: 'changing' }
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return { kind: 'gone' }
    }
    throw error
  }
}

/** Whether the watched instance may be taken over now. */
function isExpired(
  watch: Watch,
  note: LockNote | undefined,
  env: Pick<StoreLockEnv, 'monotonic' | 'honoredLeaseMs' | 'unreadableMs'>,
): boolean {
  const watchedFor = env.monotonic() - watch.since
  // Missing or torn: its writer died between create and write, or wrote
  // something no version reads. Live writers finish in microseconds.
  return note === undefined
    ? watchedFor >= env.unreadableMs
    : watch.isOwnerGone || watchedFor >= Math.min(note.leaseMs, env.honoredLeaseMs)
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
  env: StoreLockEnv,
  lockPath: string,
  identity: FileIdentity,
  note: LockNote,
  heldSince: number,
): StoreLease {
  let isReleased = false
  return {
    isHeld: async () => {
      if (isReleased || env.monotonic() - heldSince >= env.leaseMs) {
        return false
      }
      const seen = await observe(env.fs, lockPath)
      return seen.kind === 'seen' && sameFile(seen.identity, identity) && seen.note?.id === note.id
    },
    release: async () => {
      if (isReleased) {
        return
      }
      try {
        const seen = await observe(env.fs, lockPath)
        isReleased = true
        if (seen.kind === 'seen' && sameFile(seen.identity, identity)) {
          await hasRetiredInstance(env.fs, lockPath, identity)
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
  const deadline = env.monotonic() + env.timeoutMs
  let watch: Watch | undefined
  for (;;) {
    // Before the create: the holder's lease never outlasts what a waiter,
    // who can only see the file after it exists, waits out.
    const heldSince = env.monotonic()
    const note: LockNote = {
      owner: env.owner,
      id: randomUUID(),
      acquiredAt: env.now(),
      leaseMs: env.leaseMs,
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
      return lease(env, lockPath, seen.identity, note, heldSince)
    }
    if (seen.kind === 'gone') {
      continue
    }
    if (!isCreated && seen.kind === 'seen') {
      if (
        watch === undefined ||
        !sameFile(watch.identity, seen.identity) ||
        watch.noteId !== seen.note?.id
      ) {
        watch = {
          identity: seen.identity,
          noteId: seen.note?.id,
          since: env.monotonic(),
          isOwnerGone: seen.note !== undefined && (await env.isOwnerGone(seen.note.owner)),
        }
      }
      if (
        isExpired(watch, seen.note, env) &&
        (await hasRetiredInstance(env.fs, lockPath, seen.identity))
      ) {
        watch = undefined
        continue
      }
    }
    if (env.monotonic() >= deadline) {
      throw new StoreBusyError()
    }
    await env.sleep(WORKTREE_RECORD_LOCK_POLL_MS)
  }
}
