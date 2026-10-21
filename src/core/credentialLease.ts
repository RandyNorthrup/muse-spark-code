// One owner for a provider credential (M95, PLAN.md D74, RVCM952D): the
// cross-process file lease every provider-credential write or removal runs
// inside, and the staging journal that makes a Connect crash recoverable.
//
// The lease is a directory beside the providers file (`providers.json.lock`)
// holding one `owner.json`: the holder's process id, its start time and a
// nonce. A directory creation is atomic, so exactly one process wins it.
// Takeover happens only when the owner is proven gone (`isProcessAlive`
// false for its pid): a live owner's lock is never stolen, moved or
// removed, and a crashed owner's lock never wedges the next command. The
// start time tells a process its own lock apart (a nested acquire refuses
// instead of deadlocking); pid reuse can only refuse a takeover, never
// steal a live lock. Paths are normalised to `/` before comparing so
// Windows checkouts agree with POSIX ones.
//
// A takeover renames the crashed owner's directory to a tombstone named by
// that dead record (`providers.json.lock.retired-<sha256 of its pid, start
// time and nonce>`), proves the moved record is the one it observed, keeps
// the tombstone and claims the lock fresh. The tombstone is what makes the
// move safe: it always holds the dead owner's record, and a directory
// rename onto an existing non-empty directory fails on every platform, so
// once the dead record has left the lock's name, every slower contender
// that saw it fails its own move and looks again. None can move a later
// live lock aside: there is no fence check here, so a displaced live lock
// would let two holders write the credential store at once.
//
// The journal lives in the credential store beside the primary record
// (`<account>.connect`). Before the primary is touched it durably holds the
// phase, the previous record (or the fact that there was none) and the new
// record. Recovery compares staged with primary and decides; it never
// deletes another live attempt's record, because recovery itself runs
// inside the same lease.
import { mkdir, readFile, rename, rmdir, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { MILLISECONDS_PER_SECOND, PROVIDER_SECRET_PREFIX } from '../shared/constants'

/** The owner record inside a credential lease directory (shared with the CLI producer). */
export const OWNER_FILE = 'owner.json'
const TAKEOVER_SETTLE_MS = 50

/** Who holds a credential lease. */
export interface CredentialLockOwner {
  readonly pid: number
  /** The holder's own process start (epoch ms); disambiguates re-entry. */
  readonly startTime: number
  readonly nonce: string
}

const ownerSchema = z.object({
  pid: z.number(),
  startTime: z.number(),
  nonce: z.string().check(z.minLength(1)),
})

/** This process's start (epoch ms), the identity half a takeover cannot see. */
export function currentProcessStartTime(): number {
  return Date.now() - Math.floor(process.uptime() * MILLISECONDS_PER_SECOND)
}

/** Whether a process id is still alive (a process we may not signal counts). */
export function isOwnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      String(error.code) !== 'ESRCH'
    )
  }
}

/**
The OpenRouter Connect journal binding (the only vendor Connect): where
its journal lives, and the label and removal page the recovery notice
names. Mirrors the Connect flow's own constants in
`host/providers/openRouter` (kept separate so activation can report
without loading the OAuth flow): keep the three strings identical.
*/
export const OPENROUTER_JOURNAL_KEY_LABEL = 'Muse Spark Code (Unofficial)'
export const OPENROUTER_JOURNAL_KEYS_URL = 'https://openrouter.ai/settings/keys'

export function openRouterJournalKeys(): {
  readonly account: string
  readonly staging: string
} {
  const account = `${PROVIDER_SECRET_PREFIX}openrouter`
  return { account, staging: `${account}.connect` }
}

function lockErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
The tombstone a crashed owner's lock is retired to: one name per dead
record, never per attempt, so every contender that saw the same dead
record aims at the same name and only the first move can land. The name
carries a digest of the record, never its text.
*/
function tombstoneFor(lockDir: string, dead: CredentialLockOwner): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([dead.pid, dead.startTime, dead.nonce]))
    .digest('hex')
  return `${lockDir}.retired-${digest}`
}

/**
A takeover's move lost, on every platform: the lock already left its name
(ENOENT), or another contender retired this dead record first and its
tombstone holds the record (POSIX refuses a directory rename onto a
non-empty directory with ENOTEMPTY or EEXIST).
*/
const LOST_MOVE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'EEXIST', 'ENOTEMPTY'])

/**
A takeover's move lost, on Windows only: a directory rename onto an
existing directory (the tombstone) fails with EPERM, and a handle open
inside the lock (a contender reading its owner file, a scanner) fails it
with EPERM, EACCES or EBUSY; nothing moved either way. Elsewhere these
codes mean the folder itself refuses this process (no write permission, a
sticky folder whose entry belongs to someone else, a mount point): looking
again cannot change that, so there they are thrown.
*/
const WINDOWS_LOST_MOVE_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** Whether a takeover's move to the tombstone lost, so the contender looks again. */
function isLostTakeoverMove(error: unknown): boolean {
  const code = lockErrorCode(error) ?? ''
  return (
    LOST_MOVE_CODES.has(code) || (process.platform === 'win32' && WINDOWS_LOST_MOVE_CODES.has(code))
  )
}

async function readOwner(lockDir: string): Promise<CredentialLockOwner | undefined> {
  let text: string
  try {
    text = await readFile(`${lockDir}/${OWNER_FILE}`, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const owner = ownerSchema.safeParse(parsed)
  return owner.success ? owner.data : undefined
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export interface CredentialLockOptions {
  readonly pid?: number
  readonly startTime?: number
  readonly nonce?: () => string
  readonly isProcessAlive?: (pid: number) => boolean
}

/**
Another live process holds the credential lease, or a lock this attempt
moved could not be put back (`cause` says why). Callers report and retry.
*/
export class CredentialLockBusyError extends Error {
  public constructor(lockDir: string, options?: { readonly cause?: unknown }) {
    super(`credential lock busy: ${lockDir}`, options)
    this.name = 'CredentialLockBusyError'
  }
}

/**
Creates the directory and writes the owner's record when nobody owns it
now. Returns undefined when a fellow contender owns it instead, so the
caller re-observes rather than failing: the ownerless reclaim below may
remove a directory this mkdir just won before its record lands, so a
missing (or already present) owner file means someone else owns the
directory now, never a wedged lock.
*/
async function claimFreshLock(
  lockDir: string,
  owner: CredentialLockOwner,
): Promise<(() => Promise<void>) | undefined> {
  try {
    await mkdir(lockDir, { recursive: false })
  } catch (error: unknown) {
    if (lockErrorCode(error) !== 'EEXIST') throw error
    return undefined
  }
  try {
    await writeFile(`${lockDir}/${OWNER_FILE}`, JSON.stringify(owner), { flag: 'wx' })
  } catch (error: unknown) {
    if (lockErrorCode(error) === 'ENOENT' || lockErrorCode(error) === 'EEXIST') return undefined
    throw error
  }
  return async () => {
    // Only our own acquisition removes the directory: a takeover that
    // replaced it meanwhile must survive our exit path.
    const current = await readOwner(lockDir)
    const isOurs =
      current?.pid === owner.pid &&
      current.startTime === owner.startTime &&
      current.nonce === owner.nonce
    if (!isOurs) return
    try {
      await rm(`${lockDir}/${OWNER_FILE}`, { force: true })
    } catch {
      // Our acquisition is over either way; a leftover owner file is
      // reclaimed by the next acquire's takeover path.
    }
    try {
      await rmdir(lockDir)
    } catch {
      // Same: the next acquire reclaims it.
    }
  }
}

/**
Holds the credential lease until `release` runs. Refuses (rather than
queues) when another live process owns it, and takes over only a lock
whose owner is proven gone. A process's own surviving lock refuses too:
credential transactions never nest.
*/
export async function acquireCredentialLock(
  lockDir: string,
  options: CredentialLockOptions = {},
): Promise<() => Promise<void>> {
  const pid = options.pid ?? process.pid
  const startTime = options.startTime ?? currentProcessStartTime()
  const nonce = (options.nonce ?? randomUUID)()
  const isProcessAlive = options.isProcessAlive ?? isOwnerAlive
  const owner: CredentialLockOwner = { pid, startTime, nonce }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await claimFreshLock(lockDir, owner)
    if (claimed !== undefined) return claimed
    const observed = await readOwner(lockDir)
    if (observed === undefined) {
      // Ownerless: a live holder writes its owner record immediately
      // after the mkdir (both producers do), so after a settle only a
      // crash between the two leaves this state. Reclaim only while it
      // is still ownerless: a non-recursive rmdir fails once a fresh
      // owner.json lands, so a live lock is never removed.
      await pause(TAKEOVER_SETTLE_MS)
      if ((await readOwner(lockDir)) !== undefined) {
        throw new CredentialLockBusyError(lockDir)
      }
      try {
        await rmdir(lockDir)
      } catch {
        // A contender claimed it meanwhile; re-observe below.
      }
      // Retake in this same pass: a remove-only round-trip per takeover
      // lets two colliding contenders burn the attempt budget on removes
      // while nobody holds the lock, and both refuse a lock nobody owns.
      const retaken = await claimFreshLock(lockDir, owner)
      if (retaken !== undefined) return retaken
      continue
    }
    if (observed.pid === pid && observed.startTime === startTime) {
      throw new CredentialLockBusyError(lockDir)
    }
    if (isProcessAlive(observed.pid)) {
      throw new CredentialLockBusyError(lockDir)
    }
    // The owner is proven gone, but a fellow contender may have taken
    // over since the read above. Move the lock to the dead record's own
    // tombstone with one atomic rename: whoever moves it first wins, and
    // every later move aimed at that name fails because the tombstone
    // exists and holds the record, even when the lock's name holds a
    // newer live lock by then. A lost move looks again below.
    const tombstone = tombstoneFor(lockDir, observed)
    try {
      await rename(lockDir, tombstone)
    } catch (error: unknown) {
      if (isLostTakeoverMove(error)) continue
      throw error
    }
    const moved = await readOwner(tombstone)
    const isDeadTakeover =
      moved?.pid === observed.pid &&
      moved.startTime === observed.startTime &&
      moved.nonce === observed.nonce &&
      !isProcessAlive(observed.pid)
    if (!isDeadTakeover) {
      // Not the dead record (or its pid lives again). Between this build's
      // contenders the dead record leaves the lock's name only into its
      // tombstone, so only a build from before the tombstone, whose
      // takeover removed the dead lock, running at the same time can swap
      // the lock between the read and the move. Put it back while the
      // name is free; when it cannot go back, refuse with the cause, as
      // the vault's lease does, never as if nothing had moved.
      try {
        await rename(tombstone, lockDir)
      } catch (error: unknown) {
        throw new CredentialLockBusyError(lockDir, { cause: error })
      }
      continue
    }
    // Proven: the tombstone stays where it is, with the dead owner's
    // record inside, and is never removed, by age or otherwise. It is
    // never an empty directory, so a slower contender's rename onto it
    // fails on every platform (POSIX would let a rename replace an empty
    // directory); removing it would let that contender move the live lock
    // claimed next out of the way. Each one is a few bytes, left only by
    // an owner that crashed inside a credential write. Retake in this
    // same pass, for the same attempt-budget reason as the ownerless
    // branch above.
    const retaken = await claimFreshLock(lockDir, owner)
    if (retaken !== undefined) return retaken
  }
  throw new CredentialLockBusyError(lockDir)
}

/**
Runs `operation` inside the credential lease. Every provider-credential
write or removal (Connect, its recovery and rollback, `auth set/clear
--provider`, the panel wizard save and the removal finish) enters through
here with the same lock directory, so no two replace or remove the same
credential at once.
*/
export async function withCredentialLock<T>(
  lockDir: string,
  operation: () => Promise<T>,
  options: CredentialLockOptions = {},
): Promise<T> {
  const release = await acquireCredentialLock(lockDir, options)
  try {
    return await operation()
  } finally {
    await release()
  }
}

/** A staged credential journal: the phase, the previous record (or none) and the new one. */
export const credentialJournalSchema = z.object({
  v: z.literal(1),
  phase: z.enum(['started', 'staged']),
  /** The exact primary bytes before this attempt, or null when none was stored. */
  previous: z.nullable(z.string()),
  /** The exact bytes staged for the primary, once the vendor key exists. */
  next: z.nullable(z.string()),
})

export type CredentialJournal = z.infer<typeof credentialJournalSchema>

/** Parses an untrusted staging slot; undefined for anything but the journal. */
export function parseCredentialJournal(value: unknown): CredentialJournal | undefined {
  const journal = credentialJournalSchema.safeParse(value)
  return journal.success ? journal.data : undefined
}

/** The staging slot bytes for a journal. */
export function formatCredentialJournal(journal: CredentialJournal): string {
  return JSON.stringify(journal)
}

export interface CredentialStorePort {
  get(key: string): Promise<string | undefined>
  store(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export type CredentialRecoveryKind =
  | { readonly kind: 'none' }
  /** The primary already holds the staged record: a committed attempt. */
  | { readonly kind: 'committed' }
  /** The staged key is not the primary: its vendor copy was not kept here. */
  | { readonly kind: 'discarded'; readonly phase: CredentialJournal['phase'] }
  /** The primary belongs to someone else now: drop the stale journal. */
  | { readonly kind: 'stale' }
  /** An older attempt's raw record, not a journal: report it, never keep it silently. */
  | { readonly kind: 'legacy' }

export interface CredentialRecovery {
  readonly decision: CredentialRecoveryKind
  /** True when the journal slot still holds a record (a refusing store). */
  readonly journalKept: boolean
}

function journalText(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
Recovers one crashed attempt. Call with the credential lease held, so no
other attempt's staging record can be deleted from under it. Compares the
staged journal with the primary and decides: primary equals staged next
means committed (delete the journal); primary equals previous, or the
previous was absent and the primary still is, means the created key was
not kept; anything else is stale. A refused journal delete keeps the
journal: the only copy of the previous record is never deleted.
*/
export async function recoverCredentialJournal(
  secrets: Pick<CredentialStorePort, 'get' | 'delete'>,
  account: string,
  staging: string,
): Promise<CredentialRecovery> {
  // A store failure rides through as the store's own error, so a caller
  // that names a dead store keeps naming it instead of meeting an internal
  // sentence here.
  const staged = await secrets.get(staging)
  if (staged === undefined || staged === '')
    return { decision: { kind: 'none' }, journalKept: false }
  const journal =
    journalText(staged) === undefined ? undefined : parseCredentialJournal(journalText(staged))
  // As above: the store's own failure, not an internal sentence.
  const primary = await secrets.get(account)
  let isJournalKept = false
  const deleteStaging = async (): Promise<void> => {
    try {
      await secrets.delete(staging)
    } catch {
      isJournalKept = true
    }
  }
  if (journal === undefined) {
    // A previous version staged the raw record here. It came from a vendor
    // exchange, so a key may exist there; report it, never absorb it.
    await deleteStaging()
    return { decision: { kind: 'legacy' }, journalKept: isJournalKept }
  }
  if (journal.next !== null && primary === journal.next) {
    // The primary already holds the staged record: a committed attempt.
    await deleteStaging()
    return { decision: { kind: 'committed' }, journalKept: isJournalKept }
  }
  const isPrimaryAbsent = primary === undefined || primary === ''
  const isPreviousIntact =
    journal.previous === null ? isPrimaryAbsent : primary === journal.previous
  if (isPreviousIntact) {
    // Primary equals previous (or is still absent): the created key was not
    // kept here.
    await deleteStaging()
    return { decision: { kind: 'discarded', phase: journal.phase }, journalKept: isJournalKept }
  }
  if (journal.next === null) {
    // A bare intent whose primary someone else stored meanwhile: our
    // exchange may never have run, so say nothing about removing a key.
    await deleteStaging()
    return { decision: { kind: 'stale' }, journalKept: isJournalKept }
  }
  // Staged, but the primary is neither previous nor staged: whoever stores
  // there now is not our key, so ours was not kept here.
  await deleteStaging()
  return { decision: { kind: 'discarded', phase: journal.phase }, journalKept: isJournalKept }
}
