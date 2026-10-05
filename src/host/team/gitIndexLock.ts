import { open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import {
  handleIdentity,
  identityOf,
  lstatIdentity,
  sameFile,
  type FileIdentity,
} from '../../core/fs/fileIdentity'
import { isSamePath } from '../../core/paths'
import {
  CHECKPOINT_JOURNAL_FILE_MODE,
  TEAM_RETIRE_WAIT_MS,
  TEAM_SCHED_TICK_MS,
  TEAM_SCHED_TEXT_MAX_CHARS,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { isOwnedFile } from '../fsAtomic'

const DEFAULT_LOCK_CLOCK = { now: Date.now, sleep: delay, waitMs: TEAM_RETIRE_WAIT_MS }
const ownerSchema = z.strictObject({ landingId: z.string(), windowInstanceId: z.string() })
type LockOwner = z.infer<typeof ownerSchema>
export type RepositoryHolder =
  | { readonly kind: 'lock'; readonly path: string; readonly owner: LockOwner | null }
  | { readonly kind: 'hint'; readonly windowInstanceId: string }
  | { readonly kind: 'operation'; readonly path: string }

export interface LandingHint {
  readonly workingTree: string
  readonly windowInstanceId: string
  /** Lane K's fresh-hint reader supplies freshness; this is not liveness proof. */
  readonly fresh: boolean
}

/** A retargeted lock is never read through a new file or link. */
async function readOwnedLock(target: string, held: FileIdentity): Promise<string | undefined> {
  const handle = await open(target, 'r')
  try {
    const current = await handleIdentity(handle)
    if (
      !current.isFile() ||
      current.size > BigInt(TEAM_SCHED_TEXT_MAX_CHARS) ||
      !sameFile(current, held)
    )
      return undefined
    return (await isOwnedFile(target, held)) ? await handle.readFile('utf8') : undefined
  } finally {
    await handle.close()
  }
}

export async function indexLockHolder(gitDirectory: string): Promise<RepositoryHolder | undefined> {
  const lock = path.join(gitDirectory, 'index.lock')
  try {
    const info = await lstatIdentity(lock)
    // A foreign/symlink/large lock is opaque, never followed or interpreted as an index.
    let owner: LockOwner | null = null
    if (info.isFile() && info.size <= BigInt(TEAM_SCHED_TEXT_MAX_CHARS)) {
      try {
        const content = await readOwnedLock(lock, info)
        const value: unknown = JSON.parse(content ?? '')
        const parsed = ownerSchema.safeParse(value)
        if (parsed.success) owner = parsed.data
      } catch {
        // Git's own lock content is not this extension's owner record.
      }
    }
    return { kind: 'lock', path: lock, owner }
  } catch (error: unknown) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

/** Git operations are per-working-tree, including a linked worktree's own directory. */
export async function knownRepositoryHolder(
  root: string,
  gitDirectory: string,
  windowInstanceId: string,
  hints: readonly LandingHint[],
  platform: NodeJS.Platform = process.platform,
): Promise<RepositoryHolder | undefined> {
  const lock = await indexLockHolder(gitDirectory)
  if (lock !== undefined) return lock
  const hint = hints.find(
    (hint) =>
      hint.fresh &&
      hint.windowInstanceId !== windowInstanceId &&
      isSamePath(hint.workingTree, root, platform),
  )
  if (hint !== undefined) return { kind: 'hint', windowInstanceId: hint.windowInstanceId }
  for (const operation of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
  ]) {
    const target = path.join(gitDirectory, operation)
    try {
      await lstatIdentity(target)
      return { kind: 'operation', path: target }
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
    }
  }
  return undefined
}

export interface IndexLockLease {
  readonly path: string
  /** False if somebody removed/replaced this lock: their new file stays untouched. */
  readonly release: () => Promise<boolean>
}

/** The only deletion path is bound to the exact file this call exclusively created. */
async function hasReleasedOwnedLock(
  target: string,
  held: FileIdentity,
  content: string,
): Promise<boolean> {
  if (
    !(await isOwnedFile(target, held)) ||
    (await readOwnedLock(target, held)) !== content ||
    !(await isOwnedFile(target, held))
  )
    return false
  await unlink(target)
  return true
}

/** A lock created after the known-holder check gets a bounded wait, never stale removal. */
export async function takeIndexLock(
  gitDirectory: string,
  owner: LockOwner,
  clock: {
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
    readonly waitMs: number
  } = DEFAULT_LOCK_CLOCK,
): Promise<
  | { readonly kind: 'taken'; readonly lease: IndexLockLease }
  | { readonly kind: 'busy'; readonly holder: RepositoryHolder }
> {
  const target = path.join(gitDirectory, 'index.lock')
  const content = JSON.stringify(ownerSchema.parse(owner))
  const deadline = clock.now() + clock.waitMs
  for (;;) {
    let handle
    try {
      handle = await open(target, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
    } catch (error: unknown) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error
      const holder = await indexLockHolder(gitDirectory)
      if (clock.now() >= deadline)
        return { kind: 'busy', holder: holder ?? { kind: 'lock', path: target, owner: null } }
      await clock.sleep(Math.min(TEAM_SCHED_TICK_MS, Math.max(0, deadline - clock.now())))
      continue
    }
    const held = identityOf(await handleIdentity(handle))
    try {
      await handle.writeFile(content)
      await handle.sync()
    } catch (error: unknown) {
      await handle.close()
      // A failed create still belongs to this call, but never another incarnation.
      if (await isOwnedFile(target, held)) await unlink(target)
      throw error
    }
    await handle.close()
    let isReleased = false
    return {
      kind: 'taken',
      lease: {
        path: target,
        release: async () => {
          if (isReleased) return false
          isReleased = true
          return await hasReleasedOwnedLock(target, held, content)
        },
      },
    }
  }
}
