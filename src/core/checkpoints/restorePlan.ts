// What "Restore files" does to each path (M72, PLAN.md D51), decided from
// what the checkpoints recorded and what is on disk now. A restore undoes
// what the conversation's turns did and nothing else: a file changed
// outside those turns (by the user, another conversation, a tool running on
// its own) is refused and listed, never overwritten, as Edit Review refuses
// an edit whose lines moved on (D27). Pure: the store gathers the inputs.

import type { BlobRef, TreeChange } from './gitListings'

/** What a scan records of a file: enough to tell that it changed. */
export interface FileStat {
  readonly size: number
  readonly mtimeMs: number
}

/**
 * What a capture left out: files over the size limit and links (by path),
 * and folders that are repositories of their own (every path below them).
 */
export interface Coverage {
  readonly skipped: readonly string[]
  readonly repositories: readonly string[]
}

/** An ignored file one turn changed, as the scans and the tool writes saw it. */
export interface IgnoredChange {
  readonly path: string
  readonly kind: 'created' | 'changed' | 'deleted'
  /**
   * The content before the turn: copied before the agent's own write (the
   * Model API's tools); `null` when the file did not exist; absent when no
   * copy was made (a shell command changed it).
   */
  readonly preImage?: BlobRef | null | undefined
  /** The file at the turn's start and at its end; `null` where there was none. */
  readonly startStat: FileStat | null
  readonly endStat: FileStat | null
}

/**
 * Why a restore left a file as it is: unsaved editor changes; changed
 * outside the turns; not held by the checkpoint (over the size limit, a
 * link, a repository of its own, ignored at the time); an ignored file a
 * command changed with no copy taken before; or the write itself failed.
 */
export type RefusalReason =
  'unsaved' | 'changedAfter' | 'notInCheckpoint' | 'noEarlierCopy' | 'failed'

export interface Refusal {
  readonly path: string
  readonly reason: RefusalReason
}

export interface RestorePlan {
  readonly writes: readonly { readonly path: string; readonly blob: BlobRef }[]
  readonly deletes: readonly string[]
  readonly refused: readonly Refusal[]
}

export interface RestoreInput {
  /** The checkpoint's tree against the tree captured now (workspace-relative). */
  readonly changes: readonly TreeChange[]
  /** Paths that changed between turns or after the last one (not by these turns). */
  readonly changedOutsideTurns: ReadonlySet<string>
  /** Each turn's ignored-file changes, oldest turn first, from the checkpoint's turn on. */
  readonly ignoredTurns: readonly (readonly IgnoredChange[])[]
  readonly coverage: { readonly checkpoint: Coverage; readonly current: Coverage }
  /** The ignored files' state now (lstat); `null` when absent. */
  readonly currentStat: ReadonlyMap<string, FileStat | null>
  readonly isUnsaved: (relativePath: string) => boolean
}

const FOLDER_SEPARATOR = '/'

/** Whether a capture with this coverage holds the path's state. */
export function isCovered(coverage: Coverage, relativePath: string): boolean {
  return (
    !coverage.skipped.includes(relativePath) &&
    coverage.repositories.every(
      (folder) =>
        !(relativePath === folder || relativePath.startsWith(`${folder}${FOLDER_SEPARATOR}`)),
    )
  )
}

export function isSameStat(left: FileStat | null, right: FileStat | null): boolean {
  return left === null || right === null
    ? left === right
    : left.size === right.size && left.mtimeMs === right.mtimeMs
}

/** One ignored path across the turns: its first change and its last state. */
interface MergedIgnored {
  readonly first: IgnoredChange
  readonly endStat: FileStat | null
  /** Something changed the file between two of the turns that did. */
  readonly isTouchedBetween: boolean
}

function mergeIgnored(
  turns: readonly (readonly IgnoredChange[])[],
): ReadonlyMap<string, MergedIgnored> {
  const merged = new Map<string, MergedIgnored>()
  for (const turn of turns) {
    for (const change of turn) {
      const earlier = merged.get(change.path)
      merged.set(
        change.path,
        earlier === undefined
          ? { first: change, endStat: change.endStat, isTouchedBetween: false }
          : {
              first: earlier.first,
              endStat: change.endStat,
              isTouchedBetween:
                earlier.isTouchedBetween || !isSameStat(earlier.endStat, change.startStat),
            },
      )
    }
  }
  return merged
}

/** The items of `from` that `other` lacks. */
function oneSided(from: readonly string[], other: readonly string[]): readonly string[] {
  return from.filter((item) => !other.includes(item))
}

/** What one capture left out and the other did not. */
function coverageDifference(left: Coverage, right: Coverage): readonly string[] {
  return [
    ...oneSided(left.skipped, right.skipped),
    ...oneSided(right.skipped, left.skipped),
    ...oneSided(left.repositories, right.repositories),
    ...oneSided(right.repositories, left.repositories),
  ].toSorted((a, b) => a.localeCompare(b))
}

/** The writes, deletions and refusals of one restore. */
export function planRestore(input: RestoreInput): RestorePlan {
  const writes: { path: string; blob: BlobRef }[] = []
  const deletes: string[] = []
  const refused: Refusal[] = []
  const handled = new Set<string>()
  for (const change of input.changes) {
    handled.add(change.path)
    if (
      !isCovered(input.coverage.checkpoint, change.path) ||
      !isCovered(input.coverage.current, change.path)
    ) {
      refused.push({ path: change.path, reason: 'notInCheckpoint' })
    } else if (input.changedOutsideTurns.has(change.path)) {
      refused.push({ path: change.path, reason: 'changedAfter' })
    } else if (input.isUnsaved(change.path)) {
      refused.push({ path: change.path, reason: 'unsaved' })
    } else if (change.before === undefined) {
      deletes.push(change.path)
    } else {
      writes.push({ path: change.path, blob: change.before })
    }
  }
  // A file that came in or went out of the captures (it grew past the size
  // limit, a repository was cloned in) is named rather than passed over.
  for (const leftOut of coverageDifference(input.coverage.checkpoint, input.coverage.current)) {
    if (handled.has(leftOut)) {
      continue
    }

    handled.add(leftOut)
    refused.push({ path: leftOut, reason: 'notInCheckpoint' })
  }
  for (const [ignoredPath, entry] of mergeIgnored(input.ignoredTurns)) {
    if (handled.has(ignoredPath)) {
      continue
    }
    const now = input.currentStat.get(ignoredPath) ?? null
    const { first } = entry
    // What the file was before the first of these turns touched it.
    const before = first.kind === 'created' ? null : first.preImage
    if (entry.isTouchedBetween || !isSameStat(now, entry.endStat)) {
      refused.push({ path: ignoredPath, reason: 'changedAfter' })
    } else if (before === undefined) {
      refused.push({ path: ignoredPath, reason: 'noEarlierCopy' })
    } else if (input.isUnsaved(ignoredPath)) {
      refused.push({ path: ignoredPath, reason: 'unsaved' })
    } else if (before === null) {
      if (now !== null) {
        deletes.push(ignoredPath)
      }
    } else {
      writes.push({ path: ignoredPath, blob: before })
    }
  }
  return { writes, deletes, refused }
}
