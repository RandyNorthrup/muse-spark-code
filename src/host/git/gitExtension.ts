// VS Code's built-in git extension, the way M71 commits, pushes and fetches
// (PLAN.md D49): through it, the user's credential helpers and VS Code's
// own sign-in prompts apply, which the extension's own git (no prompt,
// PLAN.md D24) could not offer a push.
//
// The types below are the part of its API (version 1,
// microsoft/vscode extensions/git/src/api/git.d.ts, the same in 1.99 and
// since) that the extension calls. `push` is declared without its fourth,
// force parameter, so no code here can pass one.

import * as vscode from 'vscode'
import {
  fileIdentityKey,
  sameFile,
  statIdentity,
  statIdentitySync,
} from '../../core/fs/fileIdentity'
import { GIT_API_VERSION, GIT_EXTENSION_ID, UI_TEXT } from '../../shared/constants'
import { isSameFolder } from '../../core/worktrees'
import { canonicalPath } from '../canonicalPath'

export interface GitChange {
  readonly uri: { readonly fsPath: string }
  /** VS Code's `Status`; GIT_STATUS_UNTRACKED is a new file. */
  readonly status?: number
}

export interface GitBranch {
  readonly name?: string
  readonly commit?: string
  readonly upstream?: { readonly remote: string; readonly name: string }
  readonly ahead?: number
  readonly behind?: number
}

export interface GitRemote {
  readonly name: string
  readonly fetchUrl?: string
  readonly pushUrl?: string
}

export interface GitCommit {
  readonly hash: string
  readonly message: string
}

export interface GitRepository {
  readonly rootUri: { readonly fsPath: string }
  readonly state: {
    readonly HEAD: GitBranch | undefined
    readonly remotes: readonly GitRemote[]
    readonly indexChanges: readonly GitChange[]
    readonly workingTreeChanges: readonly GitChange[]
    readonly untrackedChanges: readonly GitChange[]
  }
  status(): Promise<void>
  /** The staged changes with `cached`, else the unstaged ones. */
  diff(isCached?: boolean): Promise<string>
  /**
   * `all: true` stages every change first; `postCommitCommand: null` runs
   * nothing after (VS Code's `git.postCommitCommand` could push or sync).
   */
  commit(
    message: string,
    options: { readonly all?: boolean; readonly postCommitCommand: null },
  ): Promise<void>
  push(remoteName: string, refspec: string, isSettingUpstream: boolean): Promise<void>
  fetch(options: { readonly remote: string; readonly ref: string }): Promise<void>
  log(options: { readonly range: string }): Promise<readonly GitCommit[]>
  diffBetween(ref1: string, ref2: string): Promise<readonly GitChange[]>
}

/** A request's physical directory; observing loss never rebinds it to a later root. */
export interface GitRepositoryOwner {
  readonly cwd: string
  readonly isCurrent: () => boolean
}

export type CaptureGitOwner = (root: string, check: () => void) => Promise<GitRepositoryOwner>

/** Resolve once, then check both names synchronously beside every Git entry. */
export const captureGitOwner: CaptureGitOwner = async (root, check) => {
  check()
  const cwd = await canonicalPath(root)
  check()
  const identity = await statIdentity(cwd)
  check()
  if (!identity.isDirectory() || fileIdentityKey(identity) === undefined) {
    throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
  }
  let isOwned = true
  const owner: GitRepositoryOwner = {
    cwd,
    isCurrent: () => {
      if (!isOwned) {
        return false
      }
      try {
        check()
        isOwned = [root, cwd].every((directory) => {
          const current = statIdentitySync(directory)
          return current.isDirectory() && sameFile(current, identity)
        })
      } catch {
        isOwned = false
      }
      return isOwned
    },
  }
  if (!owner.isCurrent()) {
    throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
  }
  return owner
}

/** The selected directory and a cached Git API repository must keep the same physical owner. */
export async function openOwnedRepository(
  root: string,
  platform: NodeJS.Platform,
  repositoryAtRoot: (root: string) => Promise<GitRepository>,
  captureOwner: CaptureGitOwner,
  check: () => void,
) {
  const selected = await captureOwner(root, check)
  const checkSelected = () => {
    check()
    if (!selected.isCurrent()) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
  }
  checkSelected()
  const repository = await repositoryAtRoot(selected.cwd)
  checkSelected()
  const repositoryRoot = repository.rootUri.fsPath
  const actual = await captureOwner(repositoryRoot, checkSelected)
  const checkOwned = () => {
    checkSelected()
    if (
      !actual.isCurrent() ||
      !isSameFolder(repository.rootUri.fsPath, repositoryRoot, platform) ||
      !isSameFolder(actual.cwd, selected.cwd, platform)
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
  }
  checkOwned()
  await repository.status()
  checkOwned()
  return { repository, cwd: selected.cwd, check: checkOwned }
}

/** A workspace may name its repository through a link; an ancestor repository is still refused. */
export async function isRepositoryRoot(
  repository: GitRepository,
  root: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  if (isSameFolder(repository.rootUri.fsPath, root, platform)) {
    return true
  }
  const [actual, selected] = await Promise.all([
    canonicalPath(repository.rootUri.fsPath),
    canonicalPath(root),
  ])
  return isSameFolder(actual, selected, platform)
}

/** What `getAPI(1)` returns, as far as it is read: repositories are checked where they are taken. */
export interface GitApi {
  getRepository(uri: vscode.Uri): unknown
  openRepository(root: vscode.Uri): Promise<unknown>
}

const REPOSITORY_METHODS = [
  'status',
  'diff',
  'commit',
  'push',
  'fetch',
  'log',
  'diffBetween',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The extension's exports: `enabled` and `getAPI` (git.d.ts `GitExtension`). */
function isGitExtension(
  value: unknown,
): value is { readonly enabled: boolean; getAPI(version: number): unknown } {
  return (
    isRecord(value) &&
    typeof value['enabled'] === 'boolean' &&
    typeof value['getAPI'] === 'function'
  )
}

function isGitApi(value: unknown): value is GitApi {
  return (
    isRecord(value) &&
    typeof value['getRepository'] === 'function' &&
    typeof value['openRepository'] === 'function'
  )
}

// Escape hatch (PLAN.md §8): this guard checks that each member the
// extension calls is there (the methods are functions, the lists arrays),
// not the methods' parameter and result types, which no run-time check can
// see. It is VS Code's own API, the same since 1.99, and the integration
// test checks the real one against it.
function isGitRepository(value: unknown): value is GitRepository {
  if (!isRecord(value) || !isRecord(value['rootUri']) || !isRecord(value['state'])) {
    return false
  }
  const state = value['state']
  return (
    REPOSITORY_METHODS.every((method) => typeof value[method] === 'function') &&
    Array.isArray(state['remotes']) &&
    Array.isArray(state['indexChanges']) &&
    Array.isArray(state['workingTreeChanges']) &&
    Array.isArray(state['untrackedChanges'])
  )
}

/** Why git cannot be used here, in words for the user. */
export class GitUnavailableError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'GitUnavailableError'
  }
}

/** The git extension's API, activating it if needed; throws `GitUnavailableError` with the reason. */
export async function loadGitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension(GIT_EXTENSION_ID)
  if (extension === undefined) {
    throw new GitUnavailableError(UI_TEXT.gitExtensionMissing)
  }
  const exports: unknown = extension.isActive ? extension.exports : await extension.activate()
  if (!isGitExtension(exports)) {
    throw new GitUnavailableError(UI_TEXT.gitExtensionMissing)
  }
  if (!exports.enabled) {
    throw new GitUnavailableError(UI_TEXT.gitExtensionDisabled)
  }
  const api = exports.getAPI(GIT_API_VERSION)
  if (!isGitApi(api)) {
    throw new GitUnavailableError(UI_TEXT.gitExtensionMissing)
  }
  return api
}

/** The repository holding `root`, opened in the git extension if it has not yet. */
export async function repositoryAt(api: GitApi, root: string): Promise<GitRepository> {
  const uri = vscode.Uri.file(root)
  const repository: unknown = api.getRepository(uri) ?? (await api.openRepository(uri))
  if (!isGitRepository(repository)) {
    throw new GitUnavailableError(UI_TEXT.gitNoRepository)
  }
  return repository
}
