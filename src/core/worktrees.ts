// Git worktrees for "New worktree…" and "Remove worktree…" (M32, PLAN.md
// D30): work on a branch in a folder of its own, the checkout in front of
// the user untouched, as Muse Code's `--worktree` does for the CLI (which
// MSP does not carry). New worktrees go beside the repository, in
// `<repository>.worktrees/<branch>`, never inside it, where the mention
// index, file watchers and the agent's own searches would see a second copy
// of every file.
//
// Pure: the host runs git.

import path from 'node:path'

export interface WorktreeEntry {
  readonly path: string
  /** `main` for `refs/heads/main`; undefined when detached or bare. */
  readonly branch: string | undefined
  readonly isBare: boolean
  readonly isDetached: boolean
  readonly isLocked: boolean
  readonly isPrunable: boolean
}

const WORKTREE_LINE = 'worktree '
const BRANCH_LINE = 'branch '
const HEADS_PREFIX = 'refs/heads/'
const BLOCK_SEPARATOR = /\r?\n\r?\n/
const LINE_BREAK = /\r?\n/
const WORKTREES_SUFFIX = '.worktrees'
// A branch like `feature/login` becomes one folder, `feature-login`.
const REF_SEPARATOR = /\//g
const FOLDER_SEPARATOR = '-'
// What `git worktree remove` says about a worktree with changes (git
// builtin/worktree.c: "contains modified or untracked files, use --force
// to delete it").
const DIRTY_WORKTREE = /contains modified or untracked files/i

function entryOf(block: string): WorktreeEntry | undefined {
  const lines = block.split(LINE_BREAK)
  const worktree = lines.find((line) => line.startsWith(WORKTREE_LINE))
  if (worktree === undefined) {
    return undefined
  }
  const branch = lines.find((line) => line.startsWith(BRANCH_LINE))?.slice(BRANCH_LINE.length)
  // An attribute line is the bare word, or the word and a reason.
  const hasAttribute = (word: string) =>
    lines.some((line) => line === word || line.startsWith(`${word} `))
  return {
    path: worktree.slice(WORKTREE_LINE.length),
    branch: branch?.startsWith(HEADS_PREFIX) === true ? branch.slice(HEADS_PREFIX.length) : branch,
    isBare: hasAttribute('bare'),
    isDetached: hasAttribute('detached'),
    isLocked: hasAttribute('locked'),
    isPrunable: hasAttribute('prunable'),
  }
}

/** `git worktree list --porcelain`: one block per worktree, the main one first. */
export function parseWorktreeList(porcelain: string): readonly WorktreeEntry[] {
  return porcelain
    .trim()
    .split(BLOCK_SEPARATOR)
    .flatMap((block) => {
      const entry = entryOf(block)
      return entry === undefined ? [] : [entry]
    })
}

/** `<parent>/<repository>.worktrees/<branch>`, the branch's slashes folded. */
export function worktreeFolder(
  repositoryRoot: string,
  branch: string,
  platform: NodeJS.Platform,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  return p.join(
    p.dirname(repositoryRoot),
    `${p.basename(repositoryRoot)}${WORKTREES_SUFFIX}`,
    branch.replaceAll(REF_SEPARATOR, () => FOLDER_SEPARATOR),
  )
}

/** Whether a path names the same folder, whatever its separators and, on Windows, its case. */
export function isSameFolder(a: string, b: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const normal = (value: string) => {
    const resolved = p.resolve(value)
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normal(a) === normal(b)
}

export function branchCheckArgs(branch: string): readonly string[] {
  return ['check-ref-format', '--branch', branch]
}

export function branchExistsArgs(branch: string): readonly string[] {
  return ['show-ref', '--verify', '--quiet', `${HEADS_PREFIX}${branch}`]
}

export function worktreeAddArgs(
  folder: string,
  branch: string,
  baseRef: string,
): readonly string[] {
  return ['worktree', 'add', '-b', branch, folder, baseRef]
}

export function worktreeRemoveArgs(folder: string, isForced: boolean): readonly string[] {
  return ['worktree', 'remove', ...(isForced ? ['--force'] : []), folder]
}

/** git refused because the worktree has changes; `--force` would discard them. */
export function isDirtyWorktreeError(message: string): boolean {
  return DIRTY_WORKTREE.test(message)
}
