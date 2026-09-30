// Where a `/review` gets its material (M70, PLAN.md D49): git in the
// workspace folder, with the review's own git options, and the pickers for a
// base branch or a commit the request did not name. The caller has already
// refused Restricted Mode; its live ownership/trust predicate is checked again
// before every git invocation, including after a picker (D13).

import { randomBytes } from 'node:crypto'
import {
  baseChoices,
  branchMaterial,
  type BaseChoices,
  type CommitChoice,
  commitChoices,
  commitMaterial,
  type MaterialOutcome,
  type ReviewGit,
  type ReviewMaterial,
  type ReviewRefusal,
  uncommittedMaterial,
} from '../../core/review/reviewMaterial'
import {
  GIT_FILTER_NAMES_ARGS,
  GIT_METADATA_OPTIONS,
  REVIEW_GIT_TIMEOUT_MS,
  REVIEW_MARKER_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import type { ReviewRequest } from '../../shared/reviewCommand'
import type { PickOne } from '../commands/pickItem'
import { gitFilterOptions } from '../git'
import { captureWorkspaceIdentity, type WorkspaceIdentity } from '../workspaceIdentity'

// A failed git call that carried no exit code (git was not found, say).
const UNKNOWN_EXIT = 'with no exit code'

/** A request that reads git: every scope but custom instructions. */
export type GitReviewRequest = Exclude<ReviewRequest, { readonly scope: 'custom' }>

export type ReviewCollection =
  | {
      readonly kind: 'material'
      readonly material: ReviewMaterial
      /** The request with the base or commit the picker chose. */
      readonly request: GitReviewRequest
      /** Host-only physical request ownership, checked again before turn admission. */
      readonly isCurrent: () => boolean
    }
  | {
      readonly kind: 'refused'
      readonly refusal: ReviewRefusal
      readonly revision?: string
      /** A failed git call by its subcommand and exit, for the log; never git's output. */
      readonly failure?: string
    }
  | { readonly kind: 'cancelled' }

export interface ReviewCollectorDeps {
  readonly workspaceRoot: string
  readonly runGit: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
  /** The host's single pick: the chosen row's id, undefined when dismissed. */
  readonly pickOne: PickOne
}

/** The base to review the branch against, the suggested one first; undefined when dismissed. */
async function pickBase(pickOne: PickOne, choices: BaseChoices): Promise<string | undefined> {
  return await pickOne(
    choices.branches.map((branch) => ({
      id: branch,
      label: branch,
      ...(branch === choices.defaultBase && { description: UI_TEXT.reviewDefaultBase }),
    })),
    UI_TEXT.reviewBranchItem,
    UI_TEXT.reviewPickBase,
  )
}

/** The commit to review, newest first; undefined when dismissed. */
async function pickCommit(
  pickOne: PickOne,
  commits: readonly CommitChoice[],
): Promise<string | undefined> {
  return await pickOne(
    commits.map((choice) => ({
      id: choice.commit,
      label: choice.shortCommit,
      description: choice.subject,
    })),
    UI_TEXT.reviewCommitItem,
    UI_TEXT.reviewPickCommit,
  )
}

function collected(
  request: GitReviewRequest,
  outcome: MaterialOutcome,
  isCurrent: () => boolean,
  revision?: string,
): ReviewCollection {
  if (outcome.ok) {
    return { kind: 'material', material: outcome.material, request, isCurrent }
  }
  return {
    kind: 'refused',
    refusal: outcome.refusal,
    ...(revision !== undefined && { revision }),
  }
}

async function collect(
  deps: ReviewCollectorDeps,
  git: ReviewGit,
  request: GitReviewRequest,
  isCurrent: () => boolean,
): Promise<ReviewCollection> {
  switch (request.scope) {
    case 'uncommitted': {
      return collected(request, await uncommittedMaterial(git), isCurrent)
    }
    case 'branch': {
      let { base } = request
      if (base === undefined) {
        const choices = await baseChoices(git)
        if (choices === undefined) {
          return { kind: 'refused', refusal: 'notRepository' }
        }
        if (choices.branches.length === 0) {
          return { kind: 'refused', refusal: 'noBase' }
        }
        base = await pickBase(deps.pickOne, choices)
      }
      return base === undefined
        ? { kind: 'cancelled' }
        : collected({ ...request, base }, await branchMaterial(git, base), isCurrent, base)
    }
    case 'commit': {
      let { commit } = request
      if (commit === undefined) {
        const choices = await commitChoices(git)
        if (choices === undefined) {
          return { kind: 'refused', refusal: 'noCommits' }
        }
        commit = await pickCommit(deps.pickOne, choices)
      }
      return commit === undefined
        ? { kind: 'cancelled' }
        : collected({ ...request, commit }, await commitMaterial(git, commit), isCurrent, commit)
    }
  }
}

/** How a failed git call reads in the log: its exit code or Node's error code, never its text. */
function exitOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error
    return typeof code === 'number' || typeof code === 'string' ? String(code) : UNKNOWN_EXIT
  }
  return UNKNOWN_EXIT
}

/** The collector the conversation asks: git's material for a request, the pickers included. */
export function createReviewCollector(
  deps: ReviewCollectorDeps,
): (request: GitReviewRequest, isStillAllowed: () => boolean) => Promise<ReviewCollection> {
  return async (request, isStillAllowed) => {
    if (!isStillAllowed() || deps.workspaceRoot.trim() === '') {
      return { kind: 'cancelled' }
    }
    let root: WorkspaceIdentity | undefined
    try {
      root = await captureWorkspaceIdentity(deps.workspaceRoot)
    } catch {
      return { kind: 'cancelled' }
    }
    if (root === undefined) {
      return { kind: 'cancelled' }
    }
    const { canonical: canonicalRoot } = root
    // Once the folder was seen to have changed, or trust withdrawn, it stays lost.
    let hasLostRoot = false
    const isCurrentRoot = () => {
      if (hasLostRoot || !isStillAllowed() || !root.isCurrent()) {
        hasLostRoot = true
        return false
      }
      return true
    }
    const assertCurrentRoot = () => {
      if (!isCurrentRoot()) {
        throw new Error(UI_TEXT.reviewCancelled)
      }
    }
    // The last git call that failed. Some fail on purpose (a branch that is
    // not there); it is named only when the review ends as git failing.
    let lastFailure: string | undefined
    const run = async (args: readonly string[], filters: readonly string[] = []) => {
      assertCurrentRoot()
      try {
        const output = await deps.runGit(
          [...GIT_METADATA_OPTIONS, ...filters, ...args],
          canonicalRoot,
          REVIEW_GIT_TIMEOUT_MS,
        )
        assertCurrentRoot()
        return output
      } catch (error: unknown) {
        lastFailure = `git ${args[0] ?? ''} exited ${exitOf(error)}`
        throw error
      }
    }
    const readFilters = async () => {
      let output: string
      try {
        output = await run(GIT_FILTER_NAMES_ARGS)
      } catch (error: unknown) {
        // `--get-regexp` exits 1 only when no matching names exist. Every
        // other failure keeps review closed, never as an empty inventory.
        if (exitOf(error) !== '1') {
          throw error
        }
        output = ''
      }
      assertCurrentRoot()
      return gitFilterOptions(output)
    }
    let filters: readonly string[] = []
    const git: ReviewGit = async (args) => {
      // Refresh after a picker and before every diff/show. A worktree diff
      // cleans file contents even with no-ext-diff/no-textconv; the review
      // compares raw saved text instead of starting those programs.
      if (args[0] === 'diff' || args[0] === 'show') {
        filters = await readFilters()
      }
      return await run(args, filters)
    }
    let collection: ReviewCollection
    try {
      filters = await readFilters()
      collection = await collect(
        {
          ...deps,
          pickOne: async (...args) => {
            assertCurrentRoot()
            const choice = await deps.pickOne(...args)
            assertCurrentRoot()
            return choice
          },
        },
        git,
        request,
        isCurrentRoot,
      )
    } catch {
      // A git call the material functions do not expect to fail (the branch
      // list, say): said as git failing, never with git's own words, which
      // can name paths under the user's profile.
      collection = { kind: 'refused', refusal: 'gitFailed' }
    }
    if (!isCurrentRoot()) {
      return { kind: 'cancelled' }
    }
    return lastFailure !== undefined &&
      collection.kind === 'refused' &&
      collection.refusal === 'gitFailed'
      ? { ...collection, failure: lastFailure }
      : collection
  }
}

/** Fresh random hexadecimal for the markers around the material under review. */
export function reviewMarker(): string {
  return randomBytes(REVIEW_MARKER_BYTES).toString('hex')
}
