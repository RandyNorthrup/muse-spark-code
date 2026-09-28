// The file system side of turn checkpoints (M72, PLAN.md D51): where the
// workspace's repository starts, its own `info/exclude`, and the writes and
// deletions of a restore, each confined to the workspace (D24) and written
// atomically (D27).

import type { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { chmod, lstat, readFile, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { confineWorkspacePath } from '../../core/workspacePath'
import { CHECKPOINT_STAT_CONCURRENCY, GIT_MODE_EXECUTABLE } from '../../shared/constants'
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
const EXECUTABLE_PERMISSIONS = 0o755
const FILE_PERMISSIONS = 0o644
// What `rmdir` says about a folder that still holds something.
const FOLDER_NOT_EMPTY: ReadonlySet<string> = new Set(['ENOTEMPTY', 'EEXIST', 'EPERM', 'EBUSY'])

export interface RestoreTarget {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly log: Logger
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
 * The path inside the workspace, and its canonical form, or undefined (and
 * a log line) when it leaves the workspace by its text or through a link.
 */
async function confined(
  target: RestoreTarget,
  relative: string,
): Promise<{ readonly absolute: string; readonly checkedAbsolute: string } | undefined> {
  const resolution = await confineWorkspacePath(target.workspaceRoot, relative, target.platform, {
    realPath: canonicalPath,
  })
  if (resolution.ok) {
    return resolution
  }
  target.log.warn(`Checkpoint restore refused ${relative}: ${resolution.reason}`)
  return undefined
}

/** Writes the bytes where the path resolves inside the workspace; false when it may not. */
export async function didWriteRestoredFile(
  target: RestoreTarget,
  relative: string,
  content: Buffer,
  mode: string,
): Promise<boolean> {
  const destination = await confined(target, relative)
  if (destination === undefined) {
    return false
  }
  try {
    await writeFileAtomically(destination.absolute, content, {
      sleep: pause,
      expectedCanonicalPath: destination.checkedAbsolute,
      platform: target.platform,
    })
    if (target.platform !== 'win32') {
      await chmod(
        destination.absolute,
        mode === GIT_MODE_EXECUTABLE ? EXECUTABLE_PERMISSIONS : FILE_PERMISSIONS,
      )
    }
    return true
  } catch (error: unknown) {
    target.log.warn(`Checkpoint restore could not write ${relative}: ${errorDetail(error)}`)
    return false
  }
}

/** Removes the folders a deletion left empty, up to one the checkpoint had. */
async function removeEmptiedFolders(
  target: RestoreTarget,
  relative: string,
  foldersThen: ReadonlySet<string>,
): Promise<void> {
  for (
    let folder = path.posix.dirname(relative);
    folder !== CURRENT_FOLDER && !foldersThen.has(folder);
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

/**
 * Deletes a regular file inside the workspace (never a link, never a
 * folder); with the checkpoint's folders, also each folder it leaves empty
 * that the checkpoint did not have. False when it may not.
 */
export async function didDeleteRestoredFile(
  target: RestoreTarget,
  relative: string,
  foldersThen: ReadonlySet<string> | undefined,
): Promise<boolean> {
  const destination = await confined(target, relative)
  if (destination === undefined) {
    return false
  }
  try {
    // The name itself, never what a link there leads to.
    const stats = await lstatOrUndefined(destination.absolute)
    if (stats !== undefined && !stats.isFile()) {
      return false
    }
    await rm(destination.absolute, { force: true })
    if (foldersThen !== undefined) {
      await removeEmptiedFolders(target, relative, foldersThen)
    }
    return true
  } catch (error: unknown) {
    target.log.warn(`Checkpoint restore could not delete ${relative}: ${errorDetail(error)}`)
    return false
  }
}
