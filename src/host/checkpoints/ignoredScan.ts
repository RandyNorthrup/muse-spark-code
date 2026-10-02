// The bounded scan of ignored files a checkpoint takes at a turn's start and
// end (M72, PLAN.md D51): size and modification time only, never content.
// Comparing the two shows the ignored files the turn created, changed or
// deleted, including a shell command's, which the extension only sees
// afterwards. A folder an ignore rule names whole is walked up to
// CHECKPOINT_IGNORED_FOLDER_MAX_FILES files and left out whole beyond that
// (node_modules); the scan stops at CHECKPOINT_IGNORED_SCAN_MAX_FILES. A
// repository of its own met on the walk is left out whole, as git leaves
// out an untracked one.

import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { FileStat, IgnoredChange } from '../../core/checkpoints/restorePlan'
import {
  CHECKPOINT_IGNORED_FOLDER_MAX_FILES,
  CHECKPOINT_IGNORED_SCAN_MAX_FILES,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { hasGit } from './checkpointFiles'

const GIT_FOLDER = '.git'
const SEPARATOR = '/'

export interface IgnoredInventory {
  /** Workspace-relative path to its size and modification time. */
  readonly files: ReadonlyMap<string, FileStat>
  /**
   * Folders left out whole: over the folder limit, past the scan's limit, or
   * a repository of its own.
   */
  readonly skippedFolders: readonly string[]
  /** The scan reached its limit: files past it are not known either way. */
  readonly isPartial: boolean
}

/** What one walk of the ignored files found. */
interface IgnoredScan {
  readonly inventory: IgnoredInventory
  /**
   * The ignored folders, or folders inside them, that are repositories of
   * their own: an ignore rule hides them from git's listing, so the walk
   * finds them, and a checkpoint leaves them out.
   */
  readonly repositories: readonly string[]
}

/** A folder's walk: its regular files, and the repositories of their own below it. */
interface FolderWalk {
  readonly files: ReadonlyMap<string, FileStat>
  readonly repositories: readonly string[]
}

/** A regular file's stat; undefined for anything else or nothing. */
export async function regularFileStat(absolutePath: string): Promise<FileStat | undefined> {
  try {
    const stats = await lstat(absolutePath)
    return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : undefined
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

/**
 * A folder's regular files (links not followed, `.git` skipped), the folder
 * itself or any below it that holds `.git` named as a repository and not
 * walked; undefined past `limit`.
 */
async function folderFiles(
  root: string,
  folder: string,
  limit: number,
): Promise<FolderWalk | undefined> {
  const found = new Map<string, FileStat>()
  const repositories: string[] = []
  const pending = [folder]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (await hasGit(path.join(root, next))) {
      repositories.push(next)
      continue
    }
    let entries
    try {
      entries = await readdir(path.join(root, next), { withFileTypes: true })
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        continue
      }
      throw error
    }
    for (const entry of entries) {
      const relative = `${next}${SEPARATOR}${entry.name}`
      if (entry.isDirectory() && entry.name !== GIT_FOLDER) {
        pending.push(relative)
      } else if (entry.isFile()) {
        const stats = await regularFileStat(path.join(root, relative))
        if (stats !== undefined) {
          found.set(relative, stats)
        }
        if (found.size > limit) {
          return undefined
        }
      }
    }
  }
  return { files: found, repositories }
}

/**
 * The ignored files `git status` listed, the files of the folders it named
 * whole, and the repositories of their own among and inside those folders.
 */
export async function scanIgnored(
  root: string,
  ignoredFiles: readonly string[],
  ignoredFolders: readonly string[],
): Promise<IgnoredScan> {
  const files = new Map<string, FileStat>()
  const skippedFolders: string[] = []
  const repositories: string[] = []
  let isPartial = false
  const sortedFiles = ignoredFiles.toSorted((a, b) => a.localeCompare(b))
  for (const relative of sortedFiles) {
    if (files.size >= CHECKPOINT_IGNORED_SCAN_MAX_FILES) {
      isPartial = true
      break
    }
    const stats = await regularFileStat(path.join(root, relative))
    if (stats !== undefined) {
      files.set(relative, stats)
    }
  }
  const folders = ignoredFolders.toSorted((a, b) => a.localeCompare(b))
  for (const folder of folders) {
    const room = CHECKPOINT_IGNORED_SCAN_MAX_FILES - files.size
    const found = isPartial
      ? undefined
      : await folderFiles(root, folder, Math.min(room, CHECKPOINT_IGNORED_FOLDER_MAX_FILES))
    if (found === undefined) {
      skippedFolders.push(folder)
      isPartial ||= room < CHECKPOINT_IGNORED_FOLDER_MAX_FILES
      continue
    }
    for (const [relative, stats] of found.files) {
      files.set(relative, stats)
    }
    repositories.push(...found.repositories)
  }
  // The scan does not know a repository's files either way: none of them
  // reads as created or deleted when a folder becomes or stops being one.
  return {
    inventory: { files, skippedFolders: [...skippedFolders, ...repositories], isPartial },
    repositories,
  }
}

function isInFolders(relative: string, folders: readonly string[]): boolean {
  return folders.some((folder) => relative.startsWith(`${folder}${SEPARATOR}`))
}

/** Whether the scan knows this path's state: it looked there. */
export function isScanned(inventory: IgnoredInventory, relative: string): boolean {
  return (
    inventory.files.has(relative) ||
    (!inventory.isPartial && !isInFolders(relative, inventory.skippedFolders))
  )
}

function isSame(left: FileStat, right: FileStat): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
}

/** What changed among the ignored files between a turn's start and end scans. */
export function ignoredChanges(
  start: IgnoredInventory,
  end: IgnoredInventory,
): readonly IgnoredChange[] {
  const changes: IgnoredChange[] = []
  for (const [relative, endStat] of end.files) {
    const startStat = start.files.get(relative)
    if (startStat === undefined) {
      if (isScanned(start, relative)) {
        changes.push({ path: relative, kind: 'created', startStat: null, endStat })
      }
    } else if (!isSame(startStat, endStat)) {
      changes.push({ path: relative, kind: 'changed', startStat, endStat })
    }
  }
  for (const [relative, startStat] of start.files) {
    if (!end.files.has(relative) && isScanned(end, relative)) {
      changes.push({ path: relative, kind: 'deleted', startStat, endStat: null })
    }
  }
  return changes.toSorted((left, right) => left.path.localeCompare(right.path))
}
