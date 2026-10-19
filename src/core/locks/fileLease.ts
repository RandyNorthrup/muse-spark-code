// LOCKLIB: one cross-process lease on a file, fenced (M123, PLAN.md M123's
// lock protocol). Shared by the worktree records (runtime/panel/
// pullRequests/records.ts) and built to carry lane G's git transaction lock,
// M124's limits and the media lease. Pure over an injected port: the file
// operations, the clocks and the owner probe all come in through
// `FileLeaseEnv`, so tests stand any interleaving where it matters.
//
// - Hold: one lock file, created exclusively (O_EXCL), holding its holder's
//   note: who (host, process id and birth: processOwner.ts), a random note
//   id, a renewal count, and the lease the holder keeps.
// - Fence: on every acquisition the holder takes the next fence, a number
//   strictly greater than every earlier one, as an exclusively created file
//   `<lock>.fences/<n>`: no two holds ever share one, and none goes back.
//   The current fence is the highest such file. A holder is current only
//   while the highest fence is its own, so a holder that lost the lock
//   without knowing it is refused by everything that checks the fence (the
//   records' publication, a git dispatch).
// - Time: every wait and lease is on the monotonic clock. The holder holds
//   for its lease from just before its create or its last renewal; renewal
//   rewrites its own note in place (bound to the open file's identity). A
//   waiter takes over only an instance it has watched, unchanged (same
//   file, birth, note and renewal), for that holder's lease, never more than
//   the longest lease it honors; what a process watched is kept across its
//   attempts. The owner provably gone (no such process, or one born
//   otherwise) or a note missing or torn and watched for a short bound
//   shortens the wait.
// - Instance: file id, birth time, note id and renewal together (Linux
//   reuses a freed inode number at once).
// - Takeover and release move the instance aside with one atomic rename,
//   then prove the moved file is the instance judged (or owned). Proven, it
//   is removed. Not proven, for any reason (a read error, a mismatch), it
//   goes back under its name while that is free and the attempt waits on;
//   if it cannot go back, the attempt ends busy: an unproven instance is
//   never removed and its taker never acquires.
// - Checks: `isHeldSync()` is synchronous (the lock's instance, the highest
//   fence, the lease), so a dispatch gate can check it with no await before
//   acting; `isHeld()` is the same, asynchronously.

import type { BigIntStats } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { identityOf, sameFile, fileIdentityKey, type FileIdentity } from '../fs/fileIdentity'
import {
  FILE_LEASE_FENCES_KEPT,
  FILE_LEASE_RELEASE_ATTEMPTS,
  FILE_LEASE_RELEASE_RETRY_MS,
} from '../../shared/constants'
import { processOwnerSchema, type ProcessOwner } from './processOwner'

const RETIRED_SUFFIX = '.retired'
const FENCES_SUFFIX = '.fences'
const STAGE_SUFFIX = '.stage'
const FENCE_DIGITS = 16
const FENCE_NAME = /^\d+$/u
const FENCE_CREATE_ATTEMPTS = 8

/**
How far a created file must get before the create returns: `flushed` to
the disk (data that must outlive a crash, such as a record generation),
or only `visible` to other processes (a lease's note and fences: a crash
ends the lease anyway, and the records' own fence bounds any later one).
*/
export type Durability = 'flushed' | 'visible'

/** The file operations a lease needs: node's, or a test's that pauses one. */
export interface LeasePort {
  mkdir(folder: string): Promise<void>
  readdir(folder: string): Promise<readonly string[]>
  readFile(file: string): Promise<Buffer>
  /** Creates `file` exclusively (O_EXCL) with `content`; EEXIST when taken. */
  createExclusive(file: string, content: string, durability: Durability): Promise<void>
  /** Publishes `existing` under `target` only while `target` is free; EEXIST when taken. */
  link(existing: string, target: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(file: string): Promise<void>
  /** The entry itself (a link is not followed), with exact native ids. */
  lstat(file: string): Promise<BigIntStats>
  /**
  Rewrites `file` in place with `content` only while `isOwn` accepts the
  opened file, judged on the open handle's own stats and content (so a
  replacement at the name, even one with a reused file id, is never
  written); false otherwise, or when the file is gone. Call `isOwn`
  immediately before beginning the rewrite: acceptance lets the holder
  recognize a torn note until this call settles.
  */
  rewriteOwn(
    file: string,
    isOwn: (opened: BigIntStats, content: Buffer) => boolean,
    content: string,
  ): Promise<boolean>
  readdirSync(folder: string): readonly string[]
  readFileSync(file: string): Buffer
  lstatSync(file: string): BigIntStats
}

const noteSchema = z.object({
  owner: processOwnerSchema,
  id: z.string(),
  /** Bumped by each renewal: a waiter watches the instance afresh. Absent reads as 0. */
  renewal: z.optional(z.number()),
  /** Wall-clock epoch ms, for people reading the file: never judged. */
  acquiredAt: z.number(),
  /** How long the holder holds after each renewal, on its own monotonic clock. */
  leaseMs: z.number(),
})

type LeaseNote = z.infer<typeof noteSchema>

/** One lock instance: file id, birth, note id and renewal together. */
export interface LeaseInstance {
  readonly identity: FileIdentity
  readonly bornNs: bigint
  readonly noteId: string | undefined
  readonly renewal: number | undefined
}

/** One instance a process watches: since when, on its monotonic clock. */
export interface LeaseWatch {
  readonly instance: LeaseInstance
  readonly since: number
}

/** A process's watch book: lock path → the instance it is watching. */
export type LeaseWatches = Map<string, LeaseWatch>

const PROCESS_WATCHES: LeaseWatches = new Map()

export interface FileLeaseEnv {
  /** Vaults retain ownership until proven death; all other callers keep timed takeover. */
  readonly takeover?: 'ownerDeathOnly'
  /** Only the vault's serialized process queue may adopt its abandoned hold. */
  readonly isOwnOwner?: (owner: ProcessOwner) => boolean
  /** A confirmed destructive recovery binds the exact note shown to the user. */
  readonly confirmedReplacement?: string
  readonly authorizeReplacement?: () => void
  readonly port: LeasePort
  /** The wall clock: only written into the note for people. */
  readonly now: () => number
  /** Milliseconds on a clock that never steps: every wait and lease. */
  readonly monotonic: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly owner: ProcessOwner
  /** Whether a note's owner is provably gone (processOwner.ts). */
  readonly isOwnerGone: (owner: ProcessOwner) => Promise<boolean>
  /** How long this holder holds after each create or renewal. */
  readonly leaseMs: number
  /** The longest lease of another holder this waiter waits out. */
  readonly honoredLeaseMs: number
  /** How long an instance without a readable note is watched before it is a crash's. */
  readonly unreadableMs: number
  readonly timeoutMs: number
  readonly pollMs: number
  /** This process's watch book; one with its own clock passes its own. */
  readonly watches?: LeaseWatches
}

/** A held lease: this exact instance, with this fence. */
export interface FileLease {
  /** Strictly greater than every earlier hold's. */
  readonly fence: number
  /**
  Synchronously: the lease runs, the lock file is this very instance and
  the highest fence is this one. For a gate with no await before it acts.
  Own renewal may show either count; a torn note is owned only during
  the opened file's accepted rewrite, while the lease still runs.
  */
  isHeldSync(): boolean
  isHeld(): Promise<boolean>
  /** Extends this instance's lease; false when lost or a renewal already runs. */
  renew(): Promise<boolean>
  /** Removes this instance only, once proven; a lock taken over stays its taker's. Never throws. */
  release(): Promise<void>
}

/**
 * Atomic publication is impossible here: the filesystem refused the
 * exclusive link (FAT/exFAT, some SMB or sync folders). Never a generic
 * I/O failure: the caller names the cause instead of retrying blindly.
 */
export class LeaseLinkUnsupportedError extends Error {
  public constructor() {
    super('The filesystem cannot publish the lock')
    this.name = 'LeaseLinkUnsupportedError'
  }
}

/** Link refusals that mean hard links are unavailable, never a held lock. */
function isLinkUnsupported(error: unknown): boolean {
  return (
    isErrno(error, 'EPERM') ||
    isErrno(error, 'ENOTSUP') ||
    isErrno(error, 'EROFS') ||
    isErrno(error, 'EXDEV')
  )
}

/** The lease was not taken: busy past the wait, or a moved instance could not go back. */
export class LeaseBusyError extends Error {
  public constructor(
    message = 'The lock is busy',
    readonly holder?: { owner: ProcessOwner; acquiredAt: number },
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'LeaseBusyError'
  }
}

/**
 * Whether the failure is the named operating-system condition. A named
 * check (never a collapsed code) so the expected condition reads at the
 * handler that owns it.
 */
function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function parseNote(bytes: Buffer): LeaseNote | undefined {
  try {
    const parsed = noteSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    return parsed.success ? parsed.data : undefined
  } catch (error: unknown) {
    // JSON.parse throws only SyntaxError for text input: a torn note reads
    // as no note, and anything else is a caller bug that must surface.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

function instanceOf(stats: BigIntStats, note: LeaseNote | undefined): LeaseInstance {
  return {
    identity: identityOf(stats),
    bornNs: stats.birthtimeNs,
    noteId: note?.id,
    renewal: note?.renewal,
  }
}

function isSameInstance(left: LeaseInstance, right: LeaseInstance): boolean {
  return (
    sameFile(left.identity, right.identity) &&
    left.bornNs === right.bornNs &&
    left.noteId === right.noteId &&
    left.renewal === right.renewal
  )
}

interface Seen {
  readonly kind: 'seen'
  readonly instance: LeaseInstance
  readonly note: LeaseNote | undefined
  readonly token: string
}

type Observation = Seen | { readonly kind: 'gone' } | { readonly kind: 'changing' }

function recoveryToken(stats: BigIntStats, bytes: Buffer): string {
  return createHash('sha256')
    .update(
      [
        fileIdentityKey(identityOf(stats)),
        String(stats.birthtimeNs),
        String(stats.mtimeNs),
        String(stats.size),
        '',
      ].join(':'),
    )
    .update(bytes)
    .digest('hex')
}

/** Read-only facts for the explicit Reset/Restore confirmation. */
export async function inspectFileLease(
  port: LeasePort,
  lockPath: string,
): Promise<
  | {
      token: string
      holder?: { owner: ProcessOwner; acquiredAt: number }
    }
  | undefined
> {
  const seen = await observe(port, lockPath)
  if (seen.kind !== 'seen') return undefined
  return {
    token: seen.token,
    ...(seen.note && { holder: { owner: seen.note.owner, acquiredAt: seen.note.acquiredAt } }),
  }
}

/** The lock as it is: one instance, read whole between two identical samples. */
async function observe(port: LeasePort, lockPath: string): Promise<Observation> {
  try {
    const before = await port.lstat(lockPath)
    const bytes = await port.readFile(lockPath)
    const after = await port.lstat(lockPath)
    const isSteady =
      sameFile(before, after) &&
      before.mtimeNs === after.mtimeNs &&
      before.size === after.size &&
      after.isFile()
    const note = parseNote(bytes)
    return isSteady
      ? {
          kind: 'seen',
          instance: instanceOf(after, note),
          note,
          token: recoveryToken(after, bytes),
        }
      : { kind: 'changing' }
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      return { kind: 'gone' }
    }
    throw error
  }
}

/** Synchronous sample: steady metadata unless the holder's own rewrite is pending. */
function observeSync(
  port: LeasePort,
  lockPath: string,
  isRewriting: boolean,
): LeaseInstance | undefined {
  try {
    const before = port.lstatSync(lockPath)
    const note = parseNote(port.readFileSync(lockPath))
    const after = port.lstatSync(lockPath)
    return sameFile(before, after) && (isRewriting || before.mtimeNs === after.mtimeNs)
      ? instanceOf(after, note)
      : undefined
  } catch {
    // A sample that cannot be read proves nothing held: the synchronous
    // gate reads it as not held, never as held, and never throws.
    return undefined
  }
}

function fenceName(fence: number): string {
  return String(fence).padStart(FENCE_DIGITS, '0')
}

function highestFence(names: readonly string[]): number {
  let highest = 0
  for (const name of names) {
    if (FENCE_NAME.test(name)) {
      highest = Math.max(highest, Number(name))
    }
  }
  return highest
}

async function readHighestFence(port: LeasePort, fences: string): Promise<number> {
  try {
    return highestFence(await port.readdir(fences))
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      return 0
    }
    throw error
  }
}

function readHighestFenceSync(port: LeasePort, fences: string): number | undefined {
  try {
    return highestFence(port.readdirSync(fences))
  } catch {
    // An unreadable fences folder proves no highest fence: the holder check
    // reads it as not held, never as held, and never throws.
    return undefined
  }
}

/**
Takes the next fence: an exclusively created file one above the highest,
and above `fenceAbove` (what the caller's data already carries, should
the fences have lost their history).
*/
async function takeFence(port: LeasePort, fences: string, fenceAbove: number): Promise<number> {
  await port.mkdir(fences)
  for (let attempt = 1; ; attempt += 1) {
    const fence = Math.max(await readHighestFence(port, fences), fenceAbove) + 1
    try {
      await port.createExclusive(path.join(fences, fenceName(fence)), '', 'visible')
      return fence
    } catch (error: unknown) {
      if (!isErrno(error, 'EEXIST') || attempt >= FENCE_CREATE_ATTEMPTS) {
        throw error
      }
    }
  }
}

/** Removes fences below the kept ones. Best effort. */
async function sweepFences(port: LeasePort, fences: string, current: number): Promise<void> {
  let names: readonly string[]
  try {
    names = await port.readdir(fences)
  } catch {
    // Sweeping is best effort: the next acquisition sweeps again.
    return
  }
  for (const name of names) {
    if (FENCE_NAME.test(name) && Number(name) <= current - FILE_LEASE_FENCES_KEPT) {
      try {
        await port.unlink(path.join(fences, name))
      } catch {
        // The next acquisition sweeps again.
      }
    }
  }
}

/**
 * Removes abandoned publication stages (`<lock>.<note id>.stage`) whose
 * owner is provably gone, judged by the same evidence as a takeover. A
 * crash between the stage write and its cleanup leaves one behind; a
 * stage whose note is unreadable, or whose owner may still live, stays.
 * Best effort.
 */
async function sweepStages(
  port: LeasePort,
  lockPath: string,
  isOwnerGone: (owner: ProcessOwner) => Promise<boolean>,
): Promise<void> {
  const folder = path.dirname(lockPath)
  const base = path.basename(lockPath)
  let names: readonly string[]
  try {
    names = await port.readdir(folder)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(`${base}.`) || !name.endsWith(STAGE_SUFFIX)) continue
    const file = path.join(folder, name)
    let note: LeaseNote | undefined
    try {
      note = parseNote(await port.readFile(file))
    } catch {
      continue
    }
    if (!note) continue
    try {
      if (await isOwnerGone(note.owner)) await port.unlink(file)
    } catch {
      // The next acquisition sweeps again.
    }
  }
}

/** The instance now at `file` (moved aside), read whole; undefined when it cannot be. */
async function instanceAt(
  port: LeasePort,
  file: string,
): Promise<{ instance: LeaseInstance; token: string } | undefined> {
  try {
    const stats = await port.lstat(file)
    const bytes = await port.readFile(file)
    return { instance: instanceOf(stats, parseNote(bytes)), token: recoveryToken(stats, bytes) }
  } catch {
    // A moved instance that cannot be read is never proven: the caller puts
    // it back under its name and waits on, never removes it.
    return undefined
  }
}

/**
Moves `instance` out of the lock's name and proves what moved is it.
'retired': proven and removed (or the name was free already). 'kept':
not proven, put back under its name; the caller waits on. Throws
`LeaseBusyError` when an unproven instance cannot go back: it stays
aside, never removed, and its taker does not acquire.
*/
async function retire(
  port: LeasePort,
  lockPath: string,
  instance: LeaseInstance,
  token?: string,
  authorize?: () => void,
): Promise<'retired' | 'kept'> {
  const aside = `${lockPath}.${randomUUID()}${RETIRED_SUFFIX}`
  authorize?.()
  try {
    await port.rename(lockPath, aside)
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      return 'retired'
    }
    // Held by a scanner and the like: nothing moved; wait on.
    return 'kept'
  }
  const moved = await instanceAt(port, aside)
  if (
    moved !== undefined &&
    isSameInstance(moved.instance, instance) &&
    (token === undefined || moved.token === token)
  ) {
    try {
      await port.unlink(aside)
    } catch {
      // A proven instance left the name: what stays aside is swept later.
    }
    return 'retired'
  }
  try {
    // Unproven: the same file back under its name, only while it is free.
    await port.link(aside, lockPath)
  } catch (error: unknown) {
    throw new LeaseBusyError('A moved lock could not be put back', undefined, { cause: error })
  }
  try {
    await port.unlink(aside)
  } catch {
    // The instance is back under its name; this second name is swept later.
  }
  return 'kept'
}

/** Whether the watched instance may be taken over now. */
function isExpired(
  watch: LeaseWatch,
  note: LeaseNote | undefined,
  isOwnerGone: boolean,
  env: Pick<FileLeaseEnv, 'monotonic' | 'honoredLeaseMs' | 'unreadableMs' | 'takeover'>,
): boolean {
  if (env.takeover === 'ownerDeathOnly') return note !== undefined && isOwnerGone
  const watchedFor = env.monotonic() - watch.since
  return note === undefined
    ? watchedFor >= env.unreadableMs
    : isOwnerGone || watchedFor >= Math.min(note.leaseMs, env.honoredLeaseMs)
}

/** The watch for the instance seen: kept from earlier attempts while it is the same one. */
function watchOf(watches: LeaseWatches, lockPath: string, seen: Seen, now: number): LeaseWatch {
  const kept = watches.get(lockPath)
  if (kept !== undefined && isSameInstance(kept.instance, seen.instance)) {
    return kept
  }
  const watch: LeaseWatch = { instance: seen.instance, since: now }
  watches.set(lockPath, watch)
  return watch
}

function heldLease(
  env: FileLeaseEnv,
  lockPath: string,
  fences: string,
  fence: number,
  start: { readonly instance: LeaseInstance; readonly note: LeaseNote; readonly since: number },
): FileLease {
  let instance = start.instance
  let note = start.note
  let heldSince = start.since
  let isReleased = false
  let pending: LeaseInstance | undefined
  let isRewriting = false
  const isRunning = (): boolean =>
    !isReleased && (env.takeover === 'ownerDeathOnly' || env.monotonic() - heldSince < env.leaseMs)
  const isOwnInstance = (seen: LeaseInstance): boolean =>
    isSameInstance(seen, instance) ||
    (pending !== undefined &&
      (isSameInstance(seen, pending) ||
        (isRewriting &&
          seen.noteId === undefined &&
          sameFile(seen.identity, instance.identity) &&
          seen.bornNs === instance.bornNs)))
  const isHeldSync = (): boolean => {
    if (!isRunning()) {
      return false
    }
    const seen = observeSync(env.port, lockPath, isRewriting)
    return (
      seen !== undefined &&
      isOwnInstance(seen) &&
      readHighestFenceSync(env.port, fences) === fence &&
      isRunning()
    )
  }
  const isHeld = async (): Promise<boolean> => {
    if (!isRunning()) {
      return false
    }
    const seen = await observe(env.port, lockPath)
    return (
      seen.kind === 'seen' &&
      isOwnInstance(seen.instance) &&
      (await readHighestFence(env.port, fences)) === fence &&
      isRunning()
    )
  }
  return {
    fence,
    isHeldSync,
    isHeld,
    renew: async () => {
      // Death-only ownership never expires. Keep its published note immutable:
      // an in-place renewal could itself leave a torn note after a crash.
      if (env.takeover === 'ownerDeathOnly') return await isHeld()
      const isStillHeld = await isHeld()
      if (pending !== undefined || !isStillHeld) {
        return false
      }
      const renewedSince = env.monotonic()
      const renewed: LeaseNote = { ...note, renewal: (note.renewal ?? 0) + 1 }
      // Only this very instance is rewritten: file id, birth time, note id
      // and renewal, read through the opened handle itself.
      const owned = instance
      const expected: LeaseInstance = { ...owned, renewal: renewed.renewal }
      pending = expected
      const isOwn = (opened: BigIntStats, bytes: Buffer): boolean => {
        if (!isRunning() || !isSameInstance(instanceOf(opened, parseNote(bytes)), owned)) {
          return false
        }
        isRewriting = true
        return true
      }
      try {
        try {
          if (!(await env.port.rewriteOwn(lockPath, isOwn, JSON.stringify(renewed)))) {
            return false
          }
        } finally {
          isRewriting = false
        }
        // Renewed: this instance at the name, still within its lease and
        // with the highest fence. A delayed write cannot revive an expired hold.
        const seen = await observe(env.port, lockPath)
        if (
          seen.kind !== 'seen' ||
          !isSameInstance(seen.instance, expected) ||
          (await readHighestFence(env.port, fences)) !== fence ||
          !isRunning()
        ) {
          return false
        }
        instance = seen.instance
        note = renewed
        heldSince = renewedSince
        return true
      } finally {
        pending = undefined
      }
    },
    release: async () => {
      if (isReleased) {
        return
      }
      isReleased = true
      for (let attempt = 0; attempt < FILE_LEASE_RELEASE_ATTEMPTS; attempt += 1) {
        try {
          const seen = await observe(env.port, lockPath)
          if (
            seen.kind !== 'seen' ||
            !isSameInstance(seen.instance, instance) ||
            (await retire(env.port, lockPath, instance)) === 'retired'
          )
            return
        } catch {
          // A remaining own note is adopted on this process's next acquisition.
        }
        // A scanner holding the file defeats back-to-back retries alike:
        // pause before the next attempt (RVAPP-LEASE2 P3-4).
        if (attempt + 1 < FILE_LEASE_RELEASE_ATTEMPTS) await env.sleep(FILE_LEASE_RELEASE_RETRY_MS)
      }
    },
  }
}

/**
Takes the lease at `lockPath` (its folder exists): created exclusively,
or, once the instance there expired, taken over as above; then the next
fence, above `fenceAbove` too. Throws `LeaseBusyError` past the wait, or
when a moved instance could not be put back.
*/
export async function acquireFileLease(
  lockPath: string,
  env: FileLeaseEnv,
  fenceAbove = 0,
): Promise<FileLease> {
  const deadline = env.monotonic() + env.timeoutMs
  const watches = env.watches ?? PROCESS_WATCHES
  const fences = `${lockPath}${FENCES_SUFFIX}`
  // Whether the owner is gone is asked once per instance per attempt.
  let judged: { readonly watch: LeaseWatch; readonly isOwnerGone: boolean } | undefined
  for (;;) {
    // Before the create: the holder's lease never outlasts what a waiter,
    // who can only see the file after it exists, waits out.
    const since = env.monotonic()
    const note: LeaseNote = {
      owner: env.owner,
      id: randomUUID(),
      renewal: 0,
      acquiredAt: env.now(),
      leaseMs: env.leaseMs,
    }
    let isCreated = false
    try {
      if (env.takeover === 'ownerDeathOnly') {
        const stage = `${lockPath}.${note.id}${STAGE_SUFFIX}`
        try {
          await env.port.createExclusive(stage, JSON.stringify(note), 'flushed')
          try {
            await env.port.link(stage, lockPath)
          } catch (error: unknown) {
            // A filesystem without hard links fails every write the same
            // way: refuse with the cause, never a generic error
            // (RVAPP-LEASE2 P2-5).
            if (isLinkUnsupported(error)) throw new LeaseLinkUnsupportedError()
            throw error
          }
        } finally {
          try {
            await env.port.unlink(stage)
          } catch {
            // A complete unpublished stage cannot obstruct the lock's name.
          }
        }
      } else await env.port.createExclusive(lockPath, JSON.stringify(note), 'visible')
      isCreated = true
    } catch (error: unknown) {
      if (!isErrno(error, 'EEXIST')) {
        throw error
      }
    }
    const seen = await observe(env.port, lockPath)
    const isAdopted =
      !isCreated &&
      seen.kind === 'seen' &&
      seen.note !== undefined &&
      env.takeover === 'ownerDeathOnly' &&
      env.isOwnOwner?.(seen.note.owner) === true
    if (
      seen.kind === 'seen' &&
      seen.note &&
      (isAdopted || (isCreated && seen.note.id === note.id))
    ) {
      watches.delete(lockPath)
      const fence = await takeFence(env.port, fences, fenceAbove)
      const lease = heldLease(env, lockPath, fences, fence, {
        instance: seen.instance,
        note: seen.note,
        since,
      })
      if (await lease.isHeld()) {
        await sweepFences(env.port, fences, lease.fence)
        await sweepStages(env.port, lockPath, env.isOwnerGone)
        return lease
      }
      // Lost while taking the fence (a long pause): try again.
      await lease.release()
      continue
    }
    if (seen.kind === 'gone') {
      watches.delete(lockPath)
      continue
    }
    if (!isCreated && seen.kind === 'seen') {
      const watch = watchOf(watches, lockPath, seen, env.monotonic())
      if (judged?.watch !== watch) {
        judged = {
          watch,
          isOwnerGone: seen.note !== undefined && (await env.isOwnerGone(seen.note.owner)),
        }
      }
      if (
        (isExpired(watch, seen.note, judged.isOwnerGone, env) ||
          (env.takeover === 'ownerDeathOnly' && env.confirmedReplacement === seen.token)) &&
        (await retire(
          env.port,
          lockPath,
          seen.instance,
          env.confirmedReplacement === seen.token ? seen.token : undefined,
          env.confirmedReplacement === seen.token ? env.authorizeReplacement : undefined,
        )) === 'retired'
      ) {
        watches.delete(lockPath)
        judged = undefined
        continue
      }
    }
    if (env.monotonic() >= deadline) {
      throw new LeaseBusyError(
        undefined,
        seen.kind === 'seen' && seen.note !== undefined
          ? { owner: seen.note.owner, acquiredAt: seen.note.acquiredAt }
          : undefined,
      )
    }
    await env.sleep(env.pollMs)
  }
}
