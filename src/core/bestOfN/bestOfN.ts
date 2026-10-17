// Best-of-N planning (M77, PLAN.md D49): validating a run, naming its
// branches and worktrees, and building the git and paid-use shapes around
// it. Pure: the host runs git and the conversations. No `vscode` here.

import { BEST_OF_N_BRANCH_PREFIX, BEST_OF_N_DIFF_MAX_CHARS } from '../../shared/constants'
import type { BestOfNChangedFile } from '../../shared/bestOfN'
import type { PaidUseRequest } from '../../shared/paid'
import { worktreeFolder } from '../worktrees'

// A run id is one branch segment: letters, digits and dashes, like the
// worktree folders M32 makes from branch names.
const RUN_ID_SEGMENT = /^[a-z0-9][a-z0-9-]*$/i

/** Whether a run id is safe to put in a branch name. */
export function isBestOfNRunId(runId: string): boolean {
  return RUN_ID_SEGMENT.test(runId)
}

/** `best-of-n/<runId>/<index>`: the branch the attempt works on. */
export function bestOfNBranch(runId: string, index: number): string {
  if (!isBestOfNRunId(runId)) {
    throw new Error(`Refused best-of-N branch for run id ${runId}`)
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Refused best-of-N branch for attempt index ${String(index)}`)
  }
  return `${BEST_OF_N_BRANCH_PREFIX}/${runId}/${String(index)}`
}

/** The attempt's worktree folder, beside the repository like M32's. */
export function bestOfNWorktreeFolder(
  repositoryRoot: string,
  runId: string,
  index: number,
  platform: NodeJS.Platform,
): string {
  return worktreeFolder(repositoryRoot, bestOfNBranch(runId, index), platform)
}

/** The one paid-use popup a run asks (D48): the prompt, the rates, N and the ceiling. */
export function bestOfNPaidRequest(
  modelId: string,
  prompt: string,
  attempts: number,
  requestCeilingPerAttempt: number,
): PaidUseRequest {
  return { feature: 'bestOfN', modelId, prompt, attempts, requestCeilingPerAttempt }
}

/** Null-delimited paths, comparing the captured base with the immutable tree. */
export function bestOfNDiffStatArgs(baseRef: string, tree: string): readonly string[] {
  return [
    'diff',
    '--numstat',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    baseRef,
    tree,
    '--',
  ]
}

/** The full unified diff for the side-by-side comparison. */
export function bestOfNDiffArgs(baseRef: string, tree: string): readonly string[] {
  return [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    baseRef,
    tree,
    '--',
  ]
}

/**
 * "Take this one": apply and stage the frozen binary patch from stdin.
 * Ordinary apply refuses a changed target; no force or three-way fallback.
 */
export function bestOfNTakeArgs(): readonly string[] {
  return ['apply', '--index', '--binary', '-']
}

const NUMSTAT_SEPARATOR = '\t'
// `git diff --numstat` writes `-` for a binary file's counts.
const NUMSTAT_BINARY_COUNT = '-'

function numstatCount(value: string): number {
  if (value === NUMSTAT_BINARY_COUNT) {
    return 0
  }
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Refused best-of-N diff stat line with count ${value}`)
  }
  return count
}

/** The stat's files; a binary file counts no lines but is still listed. */
export function parseBestOfNNumstat(output: string): readonly BestOfNChangedFile[] {
  if (output.trim() === '') {
    return []
  }
  return output.split(output.includes('\0') ? '\0' : '\n').flatMap((line) => {
    if (line.trim() === '') {
      return []
    }
    const parts = line.split(NUMSTAT_SEPARATOR)
    const insertions = parts[0]
    const deletions = parts[1]
    const path = parts.slice(2).join(NUMSTAT_SEPARATOR)
    if (insertions === undefined || deletions === undefined || path === '') {
      throw new Error(`Refused best-of-N diff stat line ${line}`)
    }
    return [{ path, insertions: numstatCount(insertions), deletions: numstatCount(deletions) }]
  })
}

/** Insertions plus deletions over the stat's files. */
export function bestOfNChangedLines(files: readonly BestOfNChangedFile[]): number {
  return files.reduce((total, file) => total + file.insertions + file.deletions, 0)
}

/** The comparison text, clipped at the cap with the clip marked. */
export function clipBestOfNDiff(diff: string): {
  readonly text: string
  readonly isClipped: boolean
} {
  return diff.length <= BEST_OF_N_DIFF_MAX_CHARS
    ? { text: diff, isClipped: false }
    : { text: diff.slice(0, BEST_OF_N_DIFF_MAX_CHARS), isClipped: true }
}
