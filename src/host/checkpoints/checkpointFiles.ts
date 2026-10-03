// The file system side of turn checkpoints (M72, M86; PLAN.md D51, D63):
// where the workspace's repository starts (only an M72 record's place reads
// it), a path's identity as a restore sees it, and each step of a restore or
// Redo: confined to the workspace (D24) with no link on the way, checked
// against what the file must still be just before it changes, and written
// atomically (D27). Bytes and presence decide; an existing file keeps its own
// mode, and a file a step recreates gets the mode it had.

import type { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { lstat, readFile, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { failureForLog } from '../../core/backends/musecode/logText'
import { type BlobRef, gitBlobOid } from '../../core/checkpoints/gitListings'
import { isSamePath } from '../../core/paths'
import { confineWorkspacePath } from '../../core/workspacePath'
import {
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_REMOVE_RETRIES,
  CHECKPOINT_REMOVE_RETRY_MS,
  GIT_MODE_EXECUTABLE,
  UI_TEXT,
} from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { writeFileIfUnchanged } from '../fsAtomic'
import type { Logger } from '../logger'

const GIT_FOLDER = '.git'
// What `rmdir` says about a folder that still holds something.
const FOLDER_NOT_EMPTY: ReadonlySet<string> = new Set(['ENOTEMPTY', 'EEXIST', 'EPERM', 'EBUSY'])
// What Windows says about a file another program (a scanner, an indexer) holds a moment.
const FILE_HELD: ReadonlySet<string> = new Set(['EBUSY', 'EPERM'])

export interface RestoreTarget {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly log: Logger
  /** A closing window stops before its next file mutation. */
  readonly signal?: AbortSignal
  /** Server-owned backend/trust admission, rechecked immediately before mutation. */
  readonly isAllowed?: () => boolean
  /** The live editor predicate, including changes after atomic staging. */
  readonly isUnsaved?: (relative: string) => boolean
  /** Removes a file (`fs.rm`); a test stands in a scanner that holds it a moment. */
  readonly remove?: (absolute: string) => Promise<void>
  /** Waits between removal attempts; injectable so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Durable intent after actual mkdir, before file publication. */
  readonly beforePublish?: (createdFolders: number) => Promise<void>
}

/** What a file must still be just before a step changes it: these bytes, or nothing. */
export type Expectation =
  { readonly kind: 'blob'; readonly oid: string } | { readonly kind: 'absent' }

export interface FileStep {
  readonly path: string
  /** What the file becomes; `null` deletes it (a regular file, never a link or folder). */
  readonly target: BlobRef | null
  readonly expect: Expectation
  /** The folders to remove, innermost first, when a deletion leaves them empty. */
  readonly removeFolders: readonly string[]
}

/**
 * What became of one step: done; the file was not as the step expected
 * (changed while it ran, or an unsaved editor); a link or the workspace's
 * edge was on the way; the file is too large to compare; or the change
 * itself failed.
 */
export type StepResult = 'done' | 'changed' | 'linked' | 'failed' | 'unsaved' | 'tooLarge'

/** Fresh reads after awaits: TypeScript's readonly narrowing is not a live abort check. */
function isDisallowed(target: RestoreTarget): boolean {
  return target.signal?.aborted === true || target.isAllowed?.() === false
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Whether a folder or the file on the requested spelling of a path is a link or
 * a junction. Letter case alone does not tell: a case-folding volume resolves
 * `readme.md` to `README.md` with no link, while on a case-sensitive one (macOS
 * offers both) `foo` may be a link to `Foo`.
 */
async function hasLinkOnTheWay(root: string, relative: string): Promise<boolean> {
  let current = root
  for (const segment of relative.split(/[\\/]/u)) {
    current = path.join(current, segment)
    const stats = await lstatOrUndefined(current)
    if (stats === undefined) {
      return false
    }
    if (stats.isSymbolicLink()) {
      return true
    }
  }
  return false
}

/** What is at the path, links not followed; undefined when nothing is. */
export async function lstatOrUndefined(absolutePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(absolutePath)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

/** Whether the folder holds `.git`: the folder, or a file naming it (a worktree or a submodule). */
async function hasGit(folder: string): Promise<boolean> {
  return (await lstatOrUndefined(path.join(folder, GIT_FOLDER))) !== undefined
}

/**
 * The nearest folder at or above the workspace holding `.git`; the workspace
 * when none does. An M72 record names its place by it.
 */
export async function repositoryTop(workspaceRoot: string): Promise<string> {
  for (let folder = workspaceRoot; ; folder = path.dirname(folder)) {
    if (await hasGit(folder)) {
      return folder
    }
    if (path.dirname(folder) === folder) {
      return workspaceRoot
    }
  }
}

/**
 * The path inside the workspace with no link or junction on the way (its
 * canonical form is the canonical root plus the path), or undefined with a
 * log line.
 */
async function unlinked(
  target: RestoreTarget,
  relative: string,
): Promise<
  | { readonly absolute: string; readonly checkedAbsolute: string; readonly canonical: string }
  | undefined
> {
  // The namespace was opened on this physical root. Never adopt a new
  // target if a root (or an ancestor) was replaced with a junction.
  if (
    !isSamePath(await canonicalPath(target.workspaceRoot), target.workspaceRoot, target.platform)
  ) {
    target.log.warn(`Checkpoint restore refused ${relative}: the workspace root moved`)
    return undefined
  }
  const root = await lstatOrUndefined(target.workspaceRoot)
  if (root?.isSymbolicLink() === true || (await hasLinkOnTheWay(target.workspaceRoot, relative))) {
    target.log.warn(`Checkpoint restore refused ${relative}: a link or junction is on the way`)
    return undefined
  }
  const resolution = await confineWorkspacePath(target.workspaceRoot, relative, target.platform, {
    realPath: canonicalPath,
  })
  if (!resolution.ok) {
    target.log.warn(`Checkpoint restore refused ${relative}: ${resolution.reason}`)
    return undefined
  }
  return resolution
}

/**
 * A recorded path as it names a file now (spec 2: re-resolved at a restore,
 * so two keys that now name one file are one path), or undefined when a link
 * or junction is on the way or it leads outside the workspace.
 */
export async function resolvedPath(
  target: RestoreTarget,
  relative: string,
): Promise<string | undefined> {
  const resolution = await unlinked(target, relative)
  return resolution?.canonical
}

/**
 * Whether the file is still what the step expects it to be, by bytes and
 * presence, never mode; or too large to tell.
 */
async function matchOf(
  absolute: string,
  expect: Expectation,
): Promise<'same' | 'changed' | 'tooLarge'> {
  const stats = await lstatOrUndefined(absolute)
  if (expect.kind === 'absent') {
    return stats === undefined ? 'same' : 'changed'
  }
  if (stats?.isFile() !== true) {
    return 'changed'
  }
  if (stats.size > CHECKPOINT_FILE_MAX_BYTES) {
    return 'tooLarge'
  }
  return gitBlobOid(await readFile(absolute)) === expect.oid ? 'same' : 'changed'
}

/** Removes the folders a deletion left empty, innermost first, stopping at the first that is not. */
async function removeEmptiedFolders(
  target: RestoreTarget,
  folders: readonly string[],
): Promise<void> {
  for (const folder of folders) {
    if (isDisallowed(target)) {
      return
    }
    try {
      const destination = await unlinked(target, folder)
      if (destination === undefined || isDisallowed(target)) {
        return
      }
      await rmdir(destination.checkedAbsolute)
    } catch (error: unknown) {
      if (FOLDER_NOT_EMPTY.has(errorCode(error) ?? '')) {
        return
      }
      if (!isMissingPath(error)) {
        throw error
      }
    }
  }
}

/**
 * Deletes the file, again while Windows says another program holds it, each
 * attempt only while the file is still as expected. True when it is gone.
 */
async function didRemoveHeld(
  target: RestoreTarget,
  absolute: string,
  isCurrent: () => Promise<boolean>,
  assertCurrent: () => void,
): Promise<boolean> {
  const remove = target.remove ?? ((file: string) => rm(file, { force: true }))
  for (let attempt = 0; ; attempt += 1) {
    if (!(await isCurrent())) {
      return false
    }
    try {
      assertCurrent()
      await remove(absolute)
      return true
    } catch (error: unknown) {
      if (!FILE_HELD.has(errorCode(error) ?? '') || attempt >= CHECKPOINT_REMOVE_RETRIES) {
        throw error
      }
    }
    await (target.sleep ?? pause)(CHECKPOINT_REMOVE_RETRY_MS)
  }
}

/**
 * One step of a restore or a Redo: the file changed only when it is inside
 * the workspace with no link on the way and still as expected. A deletion
 * also removes the folders the step names, innermost first, while they are
 * empty.
 */
export async function applyFileStep(
  target: RestoreTarget,
  step: FileStep,
  content: Buffer | undefined,
): Promise<StepResult> {
  const destination = await unlinked(target, step.path)
  if (destination === undefined) {
    return 'linked'
  }
  let refused: StepResult = 'changed'
  const currentRefusal = (): StepResult => refused
  const assertCurrent = () => {
    if (target.isUnsaved?.(step.path) === true) {
      refused = 'unsaved'
      throw new Error(UI_TEXT.restoreFailed)
    }
    if (!isDisallowed(target)) {
      return
    }
    refused = 'failed'
    throw new Error(UI_TEXT.restoreFailed)
  }
  const isCurrent = async () => {
    if ((await unlinked(target, step.path)) === undefined) {
      refused = 'linked'
      return false
    }
    const found = await matchOf(destination.checkedAbsolute, step.expect)
    if (found !== 'same') {
      refused = found
      return false
    }
    assertCurrent()
    return true
  }
  try {
    const found = await matchOf(destination.absolute, step.expect)
    if (found !== 'same') {
      return found
    }
    assertCurrent()
    if (step.target === null) {
      const current = await unlinked(target, step.path)
      if (current === undefined) {
        return 'linked'
      }
      if (!(await isCurrent())) {
        return refused
      }
      await target.beforePublish?.(0)
      if (!(await didRemoveHeld(target, current.checkedAbsolute, isCurrent, assertCurrent))) {
        return refused
      }
      try {
        await removeEmptiedFolders(target, step.removeFolders)
      } catch (error: unknown) {
        // The file deletion committed already; it keeps its applied entry
        // and Redo even if an empty folder cannot be removed.
        target.log.warn(
          `An emptied checkpoint folder was retained for ${step.path}: ${failureForLog(error)}`,
        )
      }
      return 'done'
    }
    if (content === undefined) {
      return 'failed'
    }
    const written = await writeFileIfUnchanged(destination.checkedAbsolute, isCurrent, content, {
      beforeCommit: assertCurrent,
      sleep: pause,
      expectedCanonicalPath: destination.checkedAbsolute,
      platform: target.platform,
      staged: async (file) => {
        await target.beforePublish?.(file.createdFolders)
      },
      // An existing file keeps its own mode; one recreated gets the mode it had.
      ...(step.expect.kind === 'absent' && {
        executable: step.target.mode === GIT_MODE_EXECUTABLE,
      }),
    })
    return written === 'written' ? 'done' : refused
  } catch (error: unknown) {
    target.log.warn(`Checkpoint restore could not change ${step.path}: ${failureForLog(error)}`)
    const refusal = currentRefusal()
    return refusal === 'changed' ? 'failed' : refusal
  }
}
