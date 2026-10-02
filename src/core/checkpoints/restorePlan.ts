// What "Restore files" does to each path (M72, PLAN.md D51), decided from
// what the checkpoints recorded and what is on disk now. A restore undoes
// what the conversation's turns did and nothing else: a file changed
// outside those turns (by the user, another conversation, a tool running on
// its own) is refused and listed, never overwritten, as Edit Review refuses
// an edit whose lines moved on (D27). Each step carries what the file must
// still be just before it is written or deleted, so a change made while the
// restore runs is refused too. Pure: the store gathers the inputs.

import type { BlobRef, TreeChange } from './gitListings'

/** What a scan records of a file: enough to tell that it changed. */
export interface FileStat {
  readonly size: number
  readonly mtimeMs: number
}

/**
 * What a capture left out: files over the size limit, links and folders
 * reached through a link (by path, everything below a folder included),
 * and folders that are repositories of their own (everything below them).
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
   * copy was made (a shell command or Muse Code's own tools changed it).
   */
  readonly preImage?: BlobRef | null | undefined
  /** The file at the turn's start and at its end; `null` where there was none. */
  readonly startStat: FileStat | null
  readonly endStat: FileStat | null
}

/**
 * Why a restore left a file as it is: unsaved editor changes; changed by
 * something else in the meantime (outside the turns, by another
 * conversation, or while the restore ran); not held by the checkpoint (over
 * the size limit, a link, a repository of its own, ignored at the time); an
 * ignored file changed with no copy kept from before; or the change itself
 * failed.
 */
export type RefusalReason =
  'unsaved' | 'changedAfter' | 'notInCheckpoint' | 'noEarlierCopy' | 'failed'

export interface Refusal {
  readonly path: string
  readonly reason: RefusalReason
}

/**
 * What a file must still be just before a step changes it. A blob's mode
 * counts as much as its bytes: the step writes the checkpoint's execute bit,
 * so a chmod since the capture would be undone.
 */
export type Expectation =
  | { readonly kind: 'blob'; readonly oid: string; readonly mode: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'stat'; readonly stat: FileStat }

/** One file a restore changes: to a blob, or deleted (`null`). */
export interface RestoreStep {
  readonly path: string
  readonly target: BlobRef | null
  readonly expect: Expectation
  /**
   * A file added since the checkpoint outside the ignore rules: the rules
   * as restored decide whether it goes (an ignored file then may have been
   * there all along).
   */
  readonly isIgnoreChecked: boolean
}

export interface RestorePlan {
  readonly steps: readonly RestoreStep[]
  readonly refused: readonly Refusal[]
  /** Restored paths a turn with no recorded end may not have changed itself. */
  readonly unsure: readonly string[]
}

export interface RestoreInput {
  /** The checkpoint's tree against the tree captured now (workspace-relative). */
  readonly changes: readonly TreeChange[]
  /**
   * Paths changed by something other than these turns: between them, after
   * the last, and by another conversation's turns that overlapped them.
   */
  readonly changedOutsideTurns: ReadonlySet<string>
  /** Paths a turn with no recorded end counted as its own up to the next capture. */
  readonly uncertain: ReadonlySet<string>
  /** Each turn's ignored-file changes, oldest turn first, from the checkpoint's turn on. */
  readonly ignoredTurns: readonly (readonly IgnoredChange[])[]
  readonly coverage: { readonly checkpoint: Coverage; readonly current: Coverage }
  /** The ignored files' state now (lstat); `null` when absent. */
  readonly currentStat: ReadonlyMap<string, FileStat | null>
  readonly isUnsaved: (relativePath: string) => boolean
}

const FOLDER_SEPARATOR = '/'

function isAtOrBelow(relativePath: string, folder: string): boolean {
  return relativePath === folder || relativePath.startsWith(`${folder}${FOLDER_SEPARATOR}`)
}

/** Whether a capture with this coverage holds the path's state. */
export function isCovered(coverage: Coverage, relativePath: string): boolean {
  return [...coverage.skipped, ...coverage.repositories].every(
    (leftOut) => !isAtOrBelow(relativePath, leftOut),
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

/** The step for a tracked or untracked file the turns changed. */
function workTreeStep(change: TreeChange): RestoreStep {
  return {
    path: change.path,
    target: change.before ?? null,
    expect:
      change.after === undefined
        ? { kind: 'absent' }
        : { kind: 'blob', oid: change.after.oid, mode: change.after.mode },
    isIgnoreChecked: change.before === undefined,
  }
}

/**
 * Whether the ignored journal shows the file existed before the first of these
 * turns. Then it is never a tree deletion: the journal restores it from the bytes
 * kept, or refuses it (`noEarlierCopy`) when a shell command changed it and none
 * were kept, rather than deleting a file that predates the turns.
 */
function wasPresentBefore(entry: MergedIgnored | undefined): boolean {
  return entry !== undefined && entry.first.kind !== 'created'
}

/** The steps and refusals for the ignored files the turns changed. */
function ignoredSteps(
  input: RestoreInput,
  handled: ReadonlySet<string>,
): { readonly steps: readonly RestoreStep[]; readonly refused: readonly Refusal[] } {
  const steps: RestoreStep[] = []
  const refused: Refusal[] = []
  for (const [ignoredPath, entry] of mergeIgnored(input.ignoredTurns)) {
    if (handled.has(ignoredPath)) {
      continue
    }
    const now = input.currentStat.get(ignoredPath) ?? null
    const { first } = entry
    // What the file was before the first of these turns touched it.
    const before = first.kind === 'created' ? null : first.preImage
    const expect: Expectation = now === null ? { kind: 'absent' } : { kind: 'stat', stat: now }
    // A tool's copy is taken wherever it writes; a repository of its own (or
    // anything else a capture left out) is still not the checkpoint's to change.
    if (
      !isCovered(input.coverage.checkpoint, ignoredPath) ||
      !isCovered(input.coverage.current, ignoredPath)
    ) {
      refused.push({ path: ignoredPath, reason: 'notInCheckpoint' })
    } else if (
      entry.isTouchedBetween ||
      !isSameStat(now, entry.endStat) ||
      input.changedOutsideTurns.has(ignoredPath)
    ) {
      refused.push({ path: ignoredPath, reason: 'changedAfter' })
    } else if (before === undefined) {
      refused.push({ path: ignoredPath, reason: 'noEarlierCopy' })
    } else if (input.isUnsaved(ignoredPath)) {
      refused.push({ path: ignoredPath, reason: 'unsaved' })
    } else if (before !== null || now !== null) {
      steps.push({ path: ignoredPath, target: before, expect, isIgnoreChecked: false })
    }
  }
  return { steps, refused }
}

/** The steps and refusals of one restore. */
export function planRestore(input: RestoreInput): RestorePlan {
  const steps: RestoreStep[] = []
  const refused: Refusal[] = []
  const handled = new Set<string>()
  const mergedIgnored = mergeIgnored(input.ignoredTurns)
  for (const change of input.changes) {
    // A file the turn made visible to git (its `.gitignore` changed) reads as added
    // in the trees, yet it existed before: the ignored journal decides it (restored
    // from kept bytes, or refused), never a deletion of a file that predates the turns.
    if (change.before === undefined && wasPresentBefore(mergedIgnored.get(change.path))) {
      continue
    }
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
    } else {
      steps.push(workTreeStep(change))
    }
  }
  // A file that came in or went out of the captures (it grew past the size
  // limit, a repository was cloned in, a folder became a link) is named
  // rather than passed over.
  for (const leftOut of coverageDifference(input.coverage.checkpoint, input.coverage.current)) {
    if (handled.has(leftOut)) {
      continue
    }
    handled.add(leftOut)
    refused.push({ path: leftOut, reason: 'notInCheckpoint' })
  }
  const ignored = ignoredSteps(input, handled)
  const allSteps = [...steps, ...ignored.steps]
  return {
    steps: allSteps,
    refused: [...refused, ...ignored.refused],
    unsure: allSteps.map((step) => step.path).filter((stepPath) => input.uncertain.has(stepPath)),
  }
}
