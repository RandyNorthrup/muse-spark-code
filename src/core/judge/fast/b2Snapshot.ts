// M125 lane F2 (D107 §9.5): the frozen snapshot — the workspace
// copied without `.git` and without any FIFO, socket or device into
// a private folder, reflinked where available, made read-only, and
// abandoned past its budgets. The closure is validated against the
// snapshot's answers, never the live workspace. Linux only.
import { constants, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import {
  BYTES_PER_MIB,
  JUDGE_FAST_B2_SNAPSHOT_MAX_MIB,
  JUDGE_FAST_B2_SNAPSHOT_MAX_MS,
} from '../../../shared/constants'
import { isErrno } from '../../fs/errno'
import type { B2FileAnswers } from './b2Closure'

/** One frozen snapshot: its root and what the copy measured. */
export interface B2Snapshot {
  readonly root: string
  readonly bytes: number
  readonly files: number
  readonly elapsedMs: number
}

export type B2SnapshotReason = 'budgetTime' | 'budgetSize' | 'source' | 'target'

export type B2SnapshotVerdict =
  | { readonly ok: true; readonly snapshot: B2Snapshot }
  | { readonly ok: false; readonly reason: B2SnapshotReason; readonly code: string }

export interface B2SnapshotLimits {
  readonly maxMs: number
  readonly maxMib: number
}

const DEFAULT_LIMITS: B2SnapshotLimits = {
  maxMs: JUDGE_FAST_B2_SNAPSHOT_MAX_MS,
  maxMib: JUDGE_FAST_B2_SNAPSHOT_MAX_MIB,
}

const WRITE_BITS = 0o222

function byEntryName(left: { readonly name: string }, right: { readonly name: string }): number {
  if (left.name < right.name) return -1
  return left.name > right.name ? 1 : 0
}

/** Removes every write bit under the folder; links carry none to remove. */
async function lockTree(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const target = path.join(dir, entry.name)
    const stat = await lstat(target)
    await chmod(target, stat.mode & ~WRITE_BITS)
    if (entry.isDirectory()) await lockTree(target)
  }
}

/**
Copies the workspace into the target folder: regular files by
reflink where available, directories recursed, links relinked. Any
entry named `.git`, at any depth, and any FIFO, socket or device is
left out; the folder is made read-only after. Past the time or size
budget, or on any filesystem failure, the target is removed and the
run is abandoned with its reason and code.
*/
export async function copyB2Snapshot(
  workspaceRoot: string,
  targetRoot: string,
  limits: B2SnapshotLimits = DEFAULT_LIMITS,
): Promise<B2SnapshotVerdict> {
  const started = Date.now()
  let bytes = 0
  let files = 0
  let phase: 'source' | 'target' = 'source'
  const bytesBudget = limits.maxMib * BYTES_PER_MIB
  const copyTree = async (
    from: string,
    to: string,
  ): Promise<'ok' | 'budgetTime' | 'budgetSize'> => {
    phase = 'source'
    const entries = await readdir(from, { withFileTypes: true })
    for (const entry of entries.toSorted(byEntryName)) {
      if (entry.name === '.git') continue
      if (Date.now() - started > limits.maxMs) return 'budgetTime'
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isSymbolicLink()) {
        phase = 'source'
        const linkTarget = await readlink(source)
        phase = 'target'
        await symlink(linkTarget, target)
        files += 1
      } else if (entry.isDirectory()) {
        phase = 'target'
        await mkdir(target, { recursive: true })
        const done = await copyTree(source, target)
        if (done !== 'ok') return done
      } else if (entry.isFile()) {
        phase = 'source'
        const stat = await lstat(source)
        bytes += stat.size
        if (bytes > bytesBudget) return 'budgetSize'
        phase = 'target'
        await copyFile(source, target, constants.COPYFILE_FICLONE)
        files += 1
      }
    }
    return 'ok'
  }
  const removeTarget = async (): Promise<void> => {
    try {
      await rm(targetRoot, { recursive: true, force: true })
    } catch (error: unknown) {
      // Best effort: the operating system cleans its own temp dir.
      if (!isErrno(error)) throw error
    }
  }
  try {
    phase = 'target'
    await mkdir(targetRoot, { recursive: true })
    const done = await copyTree(workspaceRoot, targetRoot)
    if (done !== 'ok') {
      await removeTarget()
      return { ok: false, reason: done, code: 'snapshot' }
    }
    phase = 'target'
    await lockTree(targetRoot)
    return {
      ok: true,
      snapshot: { root: targetRoot, bytes, files, elapsedMs: Date.now() - started },
    }
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    const code = error.code ?? 'unknown'
    await removeTarget()
    return { ok: false, reason: phase, code }
  }
}

/**
The snapshot's file answers for the closure: traversal-guarded
reads that never leave the root and never follow links. Anything
unreadable answers absent.
*/
export function openB2SnapshotReader(
  snapshot: B2Snapshot,
): B2FileAnswers & { readonly root: string } {
  const inside = (relative: string): string | undefined => {
    const resolved = path.resolve(snapshot.root, relative.replaceAll('\\', '/'))
    return resolved !== snapshot.root && !resolved.startsWith(`${snapshot.root}${path.sep}`)
      ? undefined
      : resolved
  }
  return {
    root: snapshot.root,
    statEntry: (relative) => {
      const resolved = inside(relative)
      if (resolved === undefined) return 'other'
      try {
        const stat = lstatSync(resolved)
        if (stat.isSymbolicLink()) return 'link'
        return stat.isFile() ? 'file' : 'other'
      } catch (error: unknown) {
        if (!isErrno(error)) throw error
        return 'other'
      }
    },
    readEntryBytes: (relative) => {
      const resolved = inside(relative)
      if (resolved === undefined) return
      try {
        return readFileSync(resolved)
      } catch (error: unknown) {
        if (!isErrno(error)) throw error
        return
      }
    },
    readEntryLink: (relative) => {
      const resolved = inside(relative)
      if (resolved === undefined) return
      try {
        return readlinkSync(resolved)
      } catch (error: unknown) {
        if (!isErrno(error)) throw error
        return
      }
    },
  }
}
