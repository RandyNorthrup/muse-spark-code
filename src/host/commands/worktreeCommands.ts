// `Muse Spark: New Worktree…` and `Muse Spark: Remove Worktree…` (M32,
// PLAN.md D30). A worktree gets its own branch and folder beside the
// repository and opens in a new window, where a conversation works on it
// without touching the checkout in front of the user. Git runs by absolute
// path and never in Restricted Mode (D24): a repository's config can name
// programs for git to run. Every VS Code and process interaction is injected.

import path from 'node:path'
import {
  branchCheckArgs,
  branchExistsArgs,
  isDirtyWorktreeError,
  isSameFolder,
  parseWorktreeList,
  type WorktreeEntry,
  worktreeAddArgs,
  worktreeFolder,
  worktreeRemoveArgs,
} from '../../core/worktrees'
import { GIT_WORKTREE_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import type { Logger } from '../logger'
import type { PickItem, PickOne } from './pickItem'

export interface WorktreeDeps {
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  readonly isWorkspaceTrusted: () => boolean
  /** git in `cwd`: its stdout, or a rejection whose message holds git's own words. */
  readonly runGit: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
  readonly pathExists: (fsPath: string) => boolean
  /** An input box; `validate` answers undefined for a good value, else why it is not. */
  readonly askBranchName: (
    validate: (value: string) => Promise<string | undefined>,
  ) => Promise<string | undefined>
  readonly pick: PickOne
  /** A modal; true when the user chose `action`. */
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  /** Says the worktree is ready; true when the user asked to open it. */
  readonly offerOpen: (message: string) => Promise<boolean>
  /** The folder in a new window. */
  readonly openFolder: (fsPath: string) => Promise<void>
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
  readonly showError: (message: string) => void
  readonly log: Logger
}

const HEAD = 'HEAD'
const LINE_BREAK = /\r?\n/
// execFile's rejection message: "Command failed: git …" then git's stderr.
const COMMAND_FAILED = 'Command failed:'

function nativePath(fsPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.win32.normalize(fsPath) : fsPath
}

/** git's own words from a failed call: its stderr, without Node's preamble. */
function gitMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const lines = text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(COMMAND_FAILED))
  return lines.join(' ') || text
}

/** The repository the workspace is in, or undefined after saying why there is none. */
async function repositoryRoot(deps: WorktreeDeps): Promise<string | undefined> {
  const { workspaceRoot } = deps
  if (workspaceRoot === undefined) {
    deps.showWarning(UI_TEXT.worktreeNoWorkspace)
    return undefined
  }
  if (!deps.isWorkspaceTrusted()) {
    deps.showWarning(UI_TEXT.worktreeUntrusted)
    return undefined
  }
  try {
    const toplevel = await deps.runGit(['rev-parse', '--show-toplevel'], workspaceRoot)
    return toplevel.trim()
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.worktreeNotRepository}: ${gitMessage(error)}`)
    return undefined
  }
}

/** Undefined for a branch name git accepts and no branch has yet, else why not. */
async function branchProblem(
  deps: WorktreeDeps,
  root: string,
  value: string,
): Promise<string | undefined> {
  const name = value.trim()
  if (name === '') {
    return UI_TEXT.worktreeBranchEmpty
  }
  try {
    await deps.runGit(branchCheckArgs(name), root)
  } catch {
    return UI_TEXT.worktreeBranchInvalid
  }
  try {
    // `show-ref --quiet` exits 0 only when the branch exists.
    await deps.runGit(branchExistsArgs(name), root)
    return UI_TEXT.worktreeBranchExists
  } catch {
    return undefined
  }
}

async function outputOrEmpty(deps: WorktreeDeps, args: readonly string[], root: string) {
  try {
    const output = await deps.runGit(args, root)
    return output.trim()
  } catch {
    return ''
  }
}

async function pickBase(deps: WorktreeDeps, root: string): Promise<string | undefined> {
  const current = await outputOrEmpty(deps, ['rev-parse', '--abbrev-ref', HEAD], root)
  const listed = await outputOrEmpty(
    deps,
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    root,
  )
  const branches = listed.split(LINE_BREAK).filter((branch) => branch !== '' && branch !== current)
  const items: PickItem[] = [
    {
      id: HEAD,
      label: HEAD,
      description:
        current === '' || current === HEAD
          ? UI_TEXT.worktreeDetachedHead
          : `${UI_TEXT.worktreeCurrent} ${current}`,
    },
    ...branches.map((branch) => ({ id: branch, label: branch })),
  ]
  return await deps.pick(items, UI_TEXT.worktreeBaseTitle, UI_TEXT.worktreeBasePlaceholder)
}

export async function newWorktree(deps: WorktreeDeps): Promise<void> {
  const root = await repositoryRoot(deps)
  if (root === undefined) {
    return
  }
  const typed = await deps.askBranchName((value) => branchProblem(deps, root, value))
  if (typed === undefined) {
    return
  }
  const branch = typed.trim()
  const base = await pickBase(deps, root)
  if (base === undefined) {
    return
  }
  const folder = worktreeFolder(root, branch, deps.platform)
  if (deps.pathExists(folder)) {
    deps.showError(`${UI_TEXT.worktreeFolderExists} ${folder}`)
    return
  }
  try {
    await deps.runGit(worktreeAddArgs(folder, branch, base), root, GIT_WORKTREE_TIMEOUT_MS)
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.worktreeAddFailed}: ${gitMessage(error)}`)
    return
  }
  deps.log.info(`git worktree add: ${branch} from ${base} at ${folder}`)
  if (await deps.offerOpen(`${UI_TEXT.worktreeCreated} ${folder}`)) {
    await deps.openFolder(folder)
  }
}

function removalItem(entry: WorktreeEntry): PickItem {
  const notes = [
    ...(entry.isLocked ? [UI_TEXT.worktreeLocked] : []),
    ...(entry.isPrunable ? [UI_TEXT.worktreePrunable] : []),
  ]
  return {
    id: entry.path,
    label: entry.branch ?? UI_TEXT.worktreeDetached,
    description: entry.path,
    ...(notes.length > 0 && { detail: notes.join(' · ') }),
  }
}

/** `git worktree remove`, then with `--force` only after a second, explicit yes. */
async function didRemoveFolder(deps: WorktreeDeps, root: string, folder: string): Promise<boolean> {
  try {
    await deps.runGit(worktreeRemoveArgs(folder, false), root, GIT_WORKTREE_TIMEOUT_MS)
    return true
  } catch (error: unknown) {
    const message = gitMessage(error)
    if (!isDirtyWorktreeError(message)) {
      deps.showError(`${UI_TEXT.worktreeRemoveFailed}: ${message}`)
      return false
    }
  }
  const isDiscarding = await deps.confirm(
    UI_TEXT.worktreeDirtyConfirm,
    folder,
    UI_TEXT.worktreeDiscardAction,
  )
  if (!isDiscarding) {
    return false
  }
  try {
    await deps.runGit(worktreeRemoveArgs(folder, true), root, GIT_WORKTREE_TIMEOUT_MS)
    return true
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.worktreeRemoveFailed}: ${gitMessage(error)}`)
    return false
  }
}

export async function removeWorktree(deps: WorktreeDeps): Promise<void> {
  const root = await repositoryRoot(deps)
  if (root === undefined) {
    return
  }
  let entries: readonly WorktreeEntry[]
  try {
    // git prints `C:/…` on Windows; the dialogs show the platform's own form,
    // which git accepts back.
    const listing = await deps.runGit(['worktree', 'list', '--porcelain'], root)
    entries = parseWorktreeList(listing).map((entry) => ({
      ...entry,
      path: nativePath(entry.path, deps.platform),
    }))
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.worktreeListFailed}: ${gitMessage(error)}`)
    return
  }
  // The main checkout is first; the one open in this window stays too. That
  // one is git's own top level for the workspace, not the workspace path: a
  // window on a subfolder, or on a path spelled another way (an 8.3 short
  // name on Windows), is still in that worktree.
  const current = nativePath(root, deps.platform)
  const removable = entries
    .slice(1)
    .filter((entry) => !entry.isBare && !isSameFolder(entry.path, current, deps.platform))
  if (removable.length === 0) {
    deps.showInformation(UI_TEXT.worktreeNoneToRemove)
    return
  }
  const folder = await deps.pick(
    removable.map((entry) => removalItem(entry)),
    UI_TEXT.worktreeRemoveTitle,
    UI_TEXT.worktreeRemovePlaceholder,
  )
  const entry = removable.find((candidate) => candidate.path === folder)
  if (folder === undefined || entry === undefined) {
    return
  }
  const branchNote =
    entry.branch === undefined ? '' : `\n${UI_TEXT.worktreeBranchKept} ${entry.branch}`
  const isConfirmed = await deps.confirm(
    UI_TEXT.worktreeRemoveConfirm,
    `${folder}${branchNote}`,
    UI_TEXT.worktreeRemoveAction,
  )
  if (!isConfirmed || !(await didRemoveFolder(deps, root, folder))) {
    return
  }
  deps.log.info(`git worktree remove: ${folder}`)
  deps.showInformation(`${UI_TEXT.worktreeRemoved} ${folder}`)
}
