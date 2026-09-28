// The file system side of turn checkpoints (M72, PLAN.md D51): where the
// workspace's repository starts, its own `info/exclude`, the folders a
// capture must leave out because a link leads through them, and each step
// of a restore: confined to the workspace (D24) with no link on the way,
// checked against what the file must still be just before it changes, and
// written atomically (D27).

import type { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { lstat, readFile, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { type BlobRef, gitBlobOid } from '../../core/checkpoints/gitListings'
import { type Expectation, isSameStat } from '../../core/checkpoints/restorePlan'
import { confineWorkspacePath } from '../../core/workspacePath'
import {
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_STAT_CONCURRENCY,
  GIT_MODE_EXECUTABLE,
} from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { errorDetail, type Logger } from '../logger'
import { readOptionalText } from './shadowGit'

const GIT_FOLDER = '.git'
const GITDIR_LINE = 'gitdir:'
const COMMONDIR_FILE = 'commondir'
const INFO_EXCLUDE = path.join('info', 'exclude')
const SEPARATOR = '/'
const CURRENT_FOLDER = '.'
// What `rmdir` says about a folder that still holds something.
const FOLDER_NOT_EMPTY: ReadonlySet<string> = new Set(['ENOTEMPTY', 'EEXIST', 'EPERM', 'EBUSY'])
// Platforms whose usual file systems ignore letter case in names.
const CASE_FOLDING_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['win32', 'darwin'])

export interface RestoreTarget {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly log: Logger
}

/**
 * What became of one step: done; the file was not as the restore expected
 * (changed while it ran, or an unsaved editor); a link or the workspace's
 * edge was on the way; or the change itself failed.
 */
export type StepResult = 'done' | 'changed' | 'linked' | 'failed'

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

/** Whether two workspace-relative paths name the same file on this platform. */
export function isSameRelative(left: string, right: string, platform: NodeJS.Platform): boolean {
  return CASE_FOLDING_PLATFORMS.has(platform)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
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

/** `task` over every value, CHECKPOINT_STAT_CONCURRENCY at a time, results in order. */
export async function mapInBatches<T, R>(
  values: readonly T[],
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = []
  for (let start = 0; start < values.length; start += CHECKPOINT_STAT_CONCURRENCY) {
    const batch = values.slice(start, start + CHECKPOINT_STAT_CONCURRENCY)
    const done = await Promise.all(batch.map(async (value) => await task(value)))
    results.push(...done)
  }
  return results
}

/**
 * The folders under the workspace, among those holding these paths, that
 * are links or junctions (the outermost of each chain). Git for Windows
 * walks into a junction as if it were a folder, so a capture leaves out
 * every path below one: a restore through it would change the files where
 * it leads, which no turn touched.
 */
export async function linkedFolders(
  workspaceRoot: string,
  relatives: readonly string[],
): Promise<readonly string[]> {
  const folders = new Set<string>()
  for (const relative of relatives) {
    for (
      let folder = path.posix.dirname(relative);
      folder !== CURRENT_FOLDER && !folders.has(folder);
      folder = path.posix.dirname(folder)
    ) {
      folders.add(folder)
    }
  }
  const ordered = [...folders].toSorted((a, b) => a.length - b.length || a.localeCompare(b))
  const stats = await mapInBatches(ordered, (folder) =>
    lstatOrUndefined(path.join(workspaceRoot, ...folder.split(SEPARATOR))),
  )
  const linked: string[] = []
  for (const [index, folder] of ordered.entries()) {
    const isBelowLinked = linked.some((outer) => folder.startsWith(`${outer}${SEPARATOR}`))
    if (!isBelowLinked && stats[index]?.isSymbolicLink() === true) {
      linked.push(folder)
    }
  }
  return linked
}

async function hasGit(folder: string): Promise<boolean> {
  return (await lstatOrUndefined(path.join(folder, GIT_FOLDER))) !== undefined
}

/** The nearest folder at or above the workspace holding `.git`; the workspace when none does. */
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
 * The repository's own `info/exclude`, read, never run: `.git` is the
 * folder, or a file naming it (`gitdir: …`, a worktree or a submodule),
 * whose `commondir` names the folder that holds `info`.
 */
export async function userExclude(top: string): Promise<string | undefined> {
  const dotGit = path.join(top, GIT_FOLDER)
  const stats = await lstatOrUndefined(dotGit)
  if (stats === undefined) {
    return undefined
  }
  let gitDir = dotGit
  if (stats.isFile()) {
    const content = await readFile(dotGit, 'utf8')
    const line = content.trim()
    if (!line.startsWith(GITDIR_LINE)) {
      return undefined
    }
    gitDir = path.resolve(top, line.slice(GITDIR_LINE.length).trim())
    const common = await readOptionalText(path.join(gitDir, COMMONDIR_FILE))
    if (common !== undefined) {
      gitDir = path.resolve(gitDir, common.trim())
    }
  }
  return await readOptionalText(path.join(gitDir, INFO_EXCLUDE))
}

/**
 * The path inside the workspace with no link or junction on the way (its
 * canonical form is the canonical root plus the path), or undefined with a
 * log line.
 */
async function unlinked(
  target: RestoreTarget,
  relative: string,
): Promise<{ readonly absolute: string; readonly checkedAbsolute: string } | undefined> {
  const resolution = await confineWorkspacePath(target.workspaceRoot, relative, target.platform, {
    realPath: canonicalPath,
  })
  if (!resolution.ok) {
    target.log.warn(`Checkpoint restore refused ${relative}: ${resolution.reason}`)
    return undefined
  }
  if (!isSameRelative(resolution.canonical, resolution.relative, target.platform)) {
    target.log.warn(`Checkpoint restore refused ${relative}: a link or junction is on the way`)
    return undefined
  }
  return resolution
}

/** Whether the file is still what the restore expects it to be. */
async function isAsExpected(absolute: string, expect: Expectation): Promise<boolean> {
  const stats = await lstatOrUndefined(absolute)
  if (expect.kind === 'absent') {
    return stats === undefined
  }
  if (stats?.isFile() !== true) {
    return false
  }
  return expect.kind === 'stat'
    ? isSameStat({ size: stats.size, mtimeMs: stats.mtimeMs }, expect.stat)
    : stats.size <= CHECKPOINT_FILE_MAX_BYTES && gitBlobOid(await readFile(absolute)) === expect.oid
}

/** Removes the folders a deletion left empty, up to one that was there at the checkpoint. */
async function removeEmptiedFolders(
  target: RestoreTarget,
  relative: string,
  wasFolderThere: (folder: string) => boolean,
): Promise<void> {
  for (
    let folder = path.posix.dirname(relative);
    folder !== CURRENT_FOLDER && !wasFolderThere(folder);
    folder = path.posix.dirname(folder)
  ) {
    try {
      await rmdir(path.join(target.workspaceRoot, ...folder.split(SEPARATOR)))
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

export interface FileStep {
  readonly path: string
  /** What the file becomes; `null` deletes it (a regular file, never a link or folder). */
  readonly target: BlobRef | null
  readonly expect: Expectation
}

/**
 * One step of a restore or a redo: the file changed only when it is inside
 * the workspace with no link on the way and still as expected. With
 * `wasFolderThere`, a deletion also removes each folder it leaves empty that
 * was not there at the checkpoint.
 */
export async function applyFileStep(
  target: RestoreTarget,
  step: FileStep,
  content: Buffer | undefined,
  wasFolderThere: ((folder: string) => boolean) | undefined,
): Promise<StepResult> {
  const destination = await unlinked(target, step.path)
  if (destination === undefined) {
    return 'linked'
  }
  try {
    if (!(await isAsExpected(destination.absolute, step.expect))) {
      return 'changed'
    }
    if (step.target === null) {
      await rm(destination.absolute, { force: true })
      if (wasFolderThere !== undefined) {
        await removeEmptiedFolders(target, step.path, wasFolderThere)
      }
      return 'done'
    }
    if (content === undefined) {
      return 'failed'
    }
    await writeFileAtomically(destination.absolute, content, {
      sleep: pause,
      expectedCanonicalPath: destination.checkedAbsolute,
      platform: target.platform,
      executable: step.target.mode === GIT_MODE_EXECUTABLE,
    })
    return 'done'
  } catch (error: unknown) {
    target.log.warn(`Checkpoint restore could not change ${step.path}: ${errorDetail(error)}`)
    return 'failed'
  }
}
