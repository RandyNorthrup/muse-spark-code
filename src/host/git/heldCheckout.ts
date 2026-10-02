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

import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { foldName, heldTree, type HeldEntry, unsafePathReason } from '../../core/git/heldTree'
import { isSamePath } from '../../core/paths'
import { confineWorkspacePath } from '../../core/workspacePath'
import { worktreeAddHeldArgs } from '../../core/worktrees'
import {
  GIT_WORKTREE_TIMEOUT_MS,
  HELD_EXECUTABLE_MODE,
  HELD_FILE_MODE,
  UI_TEXT,
} from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { canonicalPath } from '../canonicalPath'
import { createFileExclusively } from '../fsAtomic'
import { type GitProcess, quietGitEnvironment, UNTRUSTED_CHECKOUT_OPTIONS } from '../git'
import type { Logger } from '../logger'
import { GitUnavailableError } from './gitExtension'

export interface HeldCheckoutDeps {
  readonly platform: NodeJS.Platform
  /** The extension's git in its untrusted lane (git.ts, `isUntrustedCheckout`). */
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs?: number,
    beforeRun?: () => void,
  ) => Promise<string>
  /** git with binary stdout (git.ts `createGitProcess`), for the one `cat-file --batch`. */
  readonly gitProcess: GitProcess
  /** What git runs with: the window's environment. */
  readonly env: NodeJS.ProcessEnv
  readonly log: Logger
}

/**
 * Adds `commit` at `folder`, held, from the repository at `cwd`; `check`
 * (trust and the repository's owner) speaks before every git and every
 * write. Rejects with the reason in words.
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

const LINE_FEED = 0x0a
const BATCH_ARGS = ['cat-file', '--batch']

function unreadable(): Error {
  return new GitUnavailableError(UI_TEXT.openPullRequestUnreadable)
}

/**
 * `git cat-file --batch`'s answers, in the order asked: `<oid> blob <size>`,
 * LF, the bytes and LF for each blob. Anything else (a missing object,
 * another size, a byte past the last answer) refuses the checkout.
 */
class BlobAnswers {
  private chunks: Buffer[] = []
  private length = 0
  private next = 0

  public constructor(
    private readonly blobs: readonly HeldEntry[],
    private readonly write: (entry: HeldEntry, bytes: Buffer) => Promise<void>,
  ) {}

  /** One chunk of stdout: every answer it completes is written before git goes on. */
  public async take(chunk: Buffer): Promise<void> {
    this.chunks.push(chunk)
    this.length += chunk.length
    const waiting = this.blobs[this.next]
    if (waiting === undefined) {
      throw unreadable()
    }
    if (this.length <= headerOf(waiting).length + waiting.size) {
      return
    }
    const answers = Buffer.concat(this.chunks, this.length)
    let offset = 0
    for (let blob = this.blobs[this.next]; blob !== undefined; blob = this.blobs[this.next]) {
      const header = headerOf(blob)
      const end = offset + header.length + blob.size
      if (answers.length <= end) {
        break
      }
      if (
        !answers.subarray(offset, offset + header.length).equals(header) ||
        answers[end] !== LINE_FEED
      ) {
        throw unreadable()
      }
      await this.write(blob, answers.subarray(offset + header.length, end))
      offset = end + 1
      this.next += 1
    }
    const rest = answers.subarray(offset)
    this.chunks = rest.length === 0 ? [] : [rest]
    this.length = rest.length
    if (this.next === this.blobs.length && this.length > 0) {
      throw unreadable()
    }
  }

  /** Every blob was answered, and nothing more came. */
  public finish(): void {
    if (this.next !== this.blobs.length || this.length !== 0) {
      throw unreadable()
    }
  }
}

function headerOf(blob: HeldEntry): Buffer {
  return Buffer.from(`${blob.oid} blob ${String(blob.size)}\n`)
}

/**
 * Where a path of the commit lands: inside the worktree, with nothing on the
 * way that leads elsewhere. Every folder on the way was made by this
 * checkout with the commit's spelling, so any other canonical spelling is a
 * link, a junction or a name the volume reads as another (a short name).
 */
async function destinationOf(platform: NodeJS.Platform, folder: string, entryPath: string) {
  const resolution = await confineWorkspacePath(folder, entryPath, platform, {
    realPath: canonicalPath,
  })
  if (
    !resolution.ok ||
    foldName(resolution.canonical, platform) !== foldName(resolution.relative, platform)
  ) {
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
  const answers = new BlobAnswers(blobs, (entry, bytes) => writeBlob(deps, target, entry, bytes))
  target.check()
  await deps.gitProcess([...UNTRUSTED_CHECKOUT_OPTIONS, ...BATCH_ARGS], {
    cwd: target.cwd,
    env: quietGitEnvironment(deps.env),
    input: blobs.map((entry) => `${entry.oid}\n`).join(''),
    timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
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
      GIT_WORKTREE_TIMEOUT_MS,
      target.check,
    )
  } catch (error: unknown) {
    deps.log.warn(`A held checkout's worktree was left after it failed: ${failureForLog(error)}`)
  }
}

export function createHeldCheckout(deps: HeldCheckoutDeps): HeldCheckout {
  return async (folder, commit, cwd, check) => {
    const target: Target = { folder, cwd, check }
    const tree = heldTree(
      await deps.runGit(
        ['ls-tree', '-r', '-z', '--full-tree', '--long', commit],
        cwd,
        GIT_WORKTREE_TIMEOUT_MS,
        check,
      ),
      deps.platform,
    )
    if (!tree.ok) {
      throw new GitUnavailableError(tree.reason)
    }
    await deps.runGit(worktreeAddHeldArgs(folder, commit), cwd, GIT_WORKTREE_TIMEOUT_MS, check)
    try {
      // In the worktree, so named hooks its own configuration defines are found and switched off.
      await deps.runGit(['read-tree', commit], folder, GIT_WORKTREE_TIMEOUT_MS, check)
      await writeEntries(deps, target, tree.entries)
    } catch (error: unknown) {
      await removeWorktree(deps, target)
      throw error
    }
  }
}
