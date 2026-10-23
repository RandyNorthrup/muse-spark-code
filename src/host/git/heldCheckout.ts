// Someone else's pull request, checked out without git's checkout (M71,
// PLAN.md D49; core/git/heldTree.ts says why). From the repository, in
// order: the commit's tree is listed, and refused whole when it must be; the
// worktree is added with nothing checked out; its index is filled from the
// commit (`read-tree`, which touches no working file and runs no filter);
// then each file is written from one `git cat-file --batch`, raw. Every git
// here runs in the untrusted lane (git.ts): no hooks, fsmonitor, replacement
// objects or automatic maintenance. No git runs in the worktree once a byte
// of the pull request is in it, and while it is held nothing else of the
// extension's runs git there (the hold, core/worktreeConversations.ts).
//
// Each file is created exclusively, never over another, in a folder whose
// canonical form must be the worktree's with the commit's spelling: a link
// or junction on the way, or a name the volume reads as another, refuses
// the checkout, and the half-written worktree is removed.

import path from 'node:path'
import { isCommitSha } from '../../core/git/github'
import { BlobAnswers, heldDestination } from '../../core/git/heldCheckoutCore'
import {
  ListingRecords,
  heldTreeFromRecords,
  type HeldEntry,
  unsafePathReason,
} from '../../core/git/heldTree'
import { isSamePath } from '../../core/paths'
import { worktreeAddHeldArgs } from '../../core/worktrees'
import {
  GIT_WORKTREE_TIMEOUT_MS,
  HELD_EXECUTABLE_MODE,
  HELD_FILE_MODE,
  UI_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { type GitProcess } from '../git'
import { quietGitEnvironment } from '../../core/execGuard'
import { type Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { failureForLog } from '../../core/backends/musecode/logText'
import { canonicalPath } from '../canonicalPath'
import { createFileExclusively } from '../fsAtomic'
import { GitUnavailableError } from '../vscode/git/gitExtension'
import { UNTRUSTED_CHECKOUT_OPTIONS } from './untrustedGit'

export interface HeldCheckoutDeps {
  readonly platform: NodeJS.Platform
  /** The extension's git in its untrusted lane (untrustedGit.ts). */
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs?: number,
    input?: string,
    beforeRun?: () => void,
  ) => Promise<string>
  /** git with binary stdout (git.ts `createGitProcess`), for the one `cat-file --batch`. */
  readonly gitProcess: GitProcess
  /** What git runs with: the window's environment. */
  readonly env: NodeJS.ProcessEnv
  readonly log: Logger
}

/**
Adds `commit` at `folder`, held, from the repository at `cwd`; `check`
(trust and the repository's owner) speaks before every git and every
write. Rejects with the reason in words.
*/
export type HeldCheckout = (
  folder: string,
  commit: string,
  cwd: string,
  check: () => void,
) => Promise<void>

interface Target {
  readonly folder: string
  readonly cwd: string
  readonly check: () => void
}

const BATCH_ARGS = ['cat-file', '--batch']

function unreadable(): Error {
  return new GitUnavailableError(UI_TEXT.openPullRequestUnreadable)
}

/** Where a path of the commit lands (`heldDestination`), or the refusal. */
async function destinationOf(platform: NodeJS.Platform, folder: string, entryPath: string) {
  const resolution = await heldDestination(platform, folder, entryPath, {
    realPath: canonicalPath,
  })
  if (resolution === undefined) {
    throw new GitUnavailableError(unsafePathReason(entryPath))
  }
  return resolution
}

/** A submodule: an empty folder, made where its path says and nowhere else. */
async function makeFolder(deps: HeldCheckoutDeps, target: Target, entry: HeldEntry) {
  const destination = await destinationOf(deps.platform, target.folder, entry.path)
  target.check()
  await mkdir(destination.absolute, { recursive: true })
  if (
    !isSamePath(
      await canonicalPath(destination.absolute),
      destination.checkedAbsolute,
      deps.platform,
    )
  ) {
    throw new GitUnavailableError(unsafePathReason(entry.path))
  }
}

/** A file, a link's target as a file, or an executable: created, never written over another. */
async function writeBlob(deps: HeldCheckoutDeps, target: Target, entry: HeldEntry, bytes: Buffer) {
  const destination = await destinationOf(deps.platform, target.folder, entry.path)
  target.check()
  await createFileExclusively(destination.absolute, bytes, {
    mode: entry.kind === 'executable' ? HELD_EXECUTABLE_MODE : HELD_FILE_MODE,
    expectedDirectory: path.dirname(destination.checkedAbsolute),
    assertCanWrite: target.check,
    platform: deps.platform,
    warn: (_stage, _isPublished, error) => {
      deps.log.warn(
        `A held checkout left a stage file it could not remove: ${failureForLog(error)}`,
      )
    },
  })
}

async function writeEntries(
  deps: HeldCheckoutDeps,
  target: Target,
  entries: readonly HeldEntry[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.kind === 'submodule') {
      await makeFolder(deps, target, entry)
    }
  }
  const blobs = entries.filter((entry) => entry.kind !== 'submodule')
  if (blobs.length === 0) {
    return
  }
  const answers = new BlobAnswers(
    blobs,
    (entry, bytes) => writeBlob(deps, target, entry, bytes),
    unreadable,
  )
  target.check()
  await deps.gitProcess([...UNTRUSTED_CHECKOUT_OPTIONS, ...BATCH_ARGS], {
    cwd: target.cwd,
    env: quietGitEnvironment(deps.env, {
      workspaceRoot: target.cwd,
      platform: deps.platform,
      realpath: realpathSync,
    }),
    input: blobs.map((entry) => `${entry.oid}\n`).join(''),
    // No deadline of ours (M123): the checkout's size caps bound the work.
    timeoutMs: undefined,
    onStdout: (chunk) => answers.take(chunk),
  })
  answers.finish()
}

/** A checkout that failed part way leaves no worktree, when git may still run. */
async function removeWorktree(deps: HeldCheckoutDeps, target: Target): Promise<void> {
  try {
    // --force: without it git first runs `git status` in the worktree,
    // through the filters this checkout never ran.
    await deps.runGit(
      ['worktree', 'remove', '--force', target.folder],
      target.cwd,
      Infinity,
      undefined,
      target.check,
    )
  } catch (error: unknown) {
    deps.log.warn(`A held checkout's worktree was left after it failed: ${failureForLog(error)}`)
  }
}

export function createHeldCheckout(deps: HeldCheckoutDeps): HeldCheckout {
  return async (folder, commit, cwd, check) => {
    if (!isCommitSha(commit)) {
      throw new GitUnavailableError(UI_TEXT.openPullRequestFetchFailed)
    }
    const target: Target = { folder, cwd, check }
    // The listing streams record by record, at any size: no buffered reader
    // (and its fixed ceiling) stands between git and the validator.
    check()
    const listing = new ListingRecords()
    const records: string[] = []
    await deps.gitProcess(['ls-tree', '-r', '-z', '--full-tree', '--long', commit], {
      cwd,
      env: quietGitEnvironment(deps.env, {
        workspaceRoot: cwd,
        platform: deps.platform,
        realpath: realpathSync,
      }),
      timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
      onStdout: (chunk) => {
        records.push(...listing.take(chunk))
        return Promise.resolve()
      },
    })
    records.push(...listing.finish())
    const tree = heldTreeFromRecords(records, deps.platform)
    if (!tree.ok) {
      throw new GitUnavailableError(tree.reason)
    }
    await deps.runGit(worktreeAddHeldArgs(folder, commit), cwd, Infinity, undefined, check)
    try {
      // In the worktree, so named hooks its own configuration defines are found and switched off.
      await deps.runGit(['read-tree', commit], folder, Infinity, undefined, check)
      await writeEntries(deps, target, tree.entries)
    } catch (error: unknown) {
      await removeWorktree(deps, target)
      throw error
    }
  }
}
