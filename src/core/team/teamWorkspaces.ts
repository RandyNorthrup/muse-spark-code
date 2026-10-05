// Team workspaces (M96 lane I, PLAN.md D75): the base commit, shared clones
// under the extension's storage with no remote, the `agents/<role>/<task-id>`
// branches and the extension's own `agents/` refs in the user's repository,
// scratch copies for every read-only worker, the end-of-task commit and
// fetch, and cleanup.
//
// Built on `src/core/bestOfN/` (the lead's call on the owner's "reuse the
// Best-of-N infrastructure"): the take checks' shape (`validatePaths`-style
// confinement) is reused by `teamMerge.ts`, and the branch/ref naming lives
// in `refFence.ts`. The host runs git and owns storage; workers never touch
// these functions. No `vscode` here.

import { lstat, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isBelow } from '../workspacePath'
import {
  GIT_PATH_MAX_DARWIN,
  GIT_PATH_MAX_DEFAULT,
  GIT_PATH_MAX_WINDOWS,
} from '../../shared/constants'
import { pathModule } from '../workspaceRoot'
import { teamAgentsRef, teamBranchName } from './refFence'

/** git ended non-zero: the code and what it said. */
export class TeamGitError extends Error {
  public constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
    command: string,
  ) {
    super(`git ${command} exited with code ${String(exitCode)}: ${stderr.trim()}`)
    this.name = 'TeamGitError'
  }
}

export function isTeamGitError(value: unknown): value is TeamGitError {
  return (
    value instanceof Error &&
    value.name === 'TeamGitError' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    Number.isSafeInteger(value.exitCode)
  )
}

/**
 * One git command's stdout as bytes (binary-safe for blobs); rejects with
 * `TeamGitError` on a non-zero exit. The host adapts its git process to
 * this; tests run real git through `execFile`.
 */
export type TeamGit = (args: readonly string[], cwd: string, input?: string) => Promise<Uint8Array>

/** A workspace failure: the stable code travels with the error. */
export class TeamWorkspaceError extends Error {
  public constructor(
    public readonly code:
      'badName' | 'pathTooLong' | 'noRepository' | 'refMoved' | 'workspaceFailed',
    message: string,
  ) {
    super(message)
    this.name = 'TeamWorkspaceError'
  }
}

export function isTeamWorkspaceError(value: unknown): value is TeamWorkspaceError {
  return value instanceof Error && value.name === 'TeamWorkspaceError'
}

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true })
/** The extension's own commits name the role, the entry and the task. */
const COMMIT_AUTHOR_NAME = 'muse-spark-team'
const COMMIT_AUTHOR_EMAIL = 'team@localhost'

function decodeText(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes)
}

function objectId(output: Uint8Array, what: string): string {
  const value = decodeText(output).trim()
  if (!OBJECT_ID.test(value)) {
    throw new TeamWorkspaceError('workspaceFailed', `The team workspace has no ${what}`)
  }
  return value
}

/** git's PATH_MAX on a platform, terminator included (M72's numbers). */
export function teamGitPathMax(platform: NodeJS.Platform): number {
  if (platform === 'win32') {
    return GIT_PATH_MAX_WINDOWS
  }
  return platform === 'darwin' ? GIT_PATH_MAX_DARWIN : GIT_PATH_MAX_DEFAULT
}

/** Clones live under `<storage>/agents/`, never beside the repository. */
const TEAM_STORAGE_DIRNAME = 'agents'

export type TeamWorkspaceMode = 'own-branch' | 'read-only' | 'in-place'

export interface TeamWorkspaceSpec {
  readonly repositoryRoot: string
  readonly role: string
  readonly taskId: string
  readonly mode: TeamWorkspaceMode
  /** From `resolveBaseCommit`, below. */
  readonly baseCommit: string
}

export interface TeamWorkspace {
  /** The folder the worker runs in: its clone, scratch copy, or the tree. */
  readonly folder: string
  /** Set for `own-branch`: the branch in the clone and the user's repo. */
  readonly branch?: string | undefined
  /** Set for `own-branch`: the extension-owned ref in the user's repo. */
  readonly agentsRef?: string | undefined
}

/** The folder name inside storage: short, lowercase, branch-safe. */
export function teamCloneFolderName(role: string, taskId: string, mode: TeamWorkspaceMode): string {
  // Throws on bad names, so the folder can never escape its parent.
  teamBranchName(role, taskId)
  const raw = `${mode === 'read-only' ? 'ro-' : ''}${role}-${taskId}`.toLowerCase()
  return raw.replaceAll(/[^a-z0-9-]+/g, '-')
}

/** The clone's folder under storage, refused past the platform's limit. */
export function teamCloneFolder(
  storageRoot: string,
  role: string,
  taskId: string,
  mode: TeamWorkspaceMode,
  platform: NodeJS.Platform,
): string {
  const p = pathModule(platform)
  const folder = p.join(storageRoot, TEAM_STORAGE_DIRNAME, teamCloneFolderName(role, taskId, mode))
  const limit = teamGitPathMax(platform)
  if (folder.length + 1 >= limit) {
    throw new TeamWorkspaceError(
      'pathTooLong',
      `the storage path is ${String(folder.length + 1)} characters long and git takes at most ${String(limit)}`,
    )
  }
  return folder
}

async function revParse(runGit: TeamGit, repo: string, rev: string): Promise<string> {
  return objectId(await runGit(['rev-parse', '--verify', rev + '^{commit}'], repo), 'base')
}

/**
 * The base commit: the orchestrator's `HEAD` when the working tree is
 * clean, else a commit made from the current tree with `HEAD` as its
 * parent (`git commit-tree` through a private index, which writes no user ref), so the
 * worker sees the uncommitted work. Nothing is committed to the user's
 * branch either way.
 */
export async function resolveBaseCommit(runGit: TeamGit, repositoryRoot: string): Promise<string> {
  const status = await runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=normal'],
    repositoryRoot,
  )
  if (status.length === 0) {
    return await revParse(runGit, repositoryRoot, 'HEAD')
  }
  const head = await revParse(runGit, repositoryRoot, 'HEAD')
  // A private repository/index captures tracked and untracked work without
  // touching the user's index, refs, hooks or repository filter configuration.
  const scratch = await mkdtemp(path.join(tmpdir(), 'muse-team-base-'))
  try {
    await runGit(['init', '--bare', scratch], repositoryRoot)
    const objects = decodeText(
      await runGit(
        ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
        repositoryRoot,
      ),
    ).trim()
    await writeFile(path.join(scratch, 'objects', 'info', 'alternates'), `${objects}\n`)
    const prefix = [`--git-dir=${scratch}`, `--work-tree=${repositoryRoot}`]
    await runGit([...prefix, 'read-tree', head], repositoryRoot)
    await runGit([...prefix, 'add', '--all', '--'], repositoryRoot)
    const tree = objectId(await runGit([...prefix, 'write-tree'], repositoryRoot), 'tree')
    const created = objectId(
      await runGit(
        [
          ...prefix,
          '-c',
          `user.name=${COMMIT_AUTHOR_NAME}`,
          '-c',
          `user.email=${COMMIT_AUTHOR_EMAIL}`,
          'commit-tree',
          tree,
          '-p',
          head,
          '-m',
          'team base with uncommitted work',
        ],
        repositoryRoot,
      ),
      'base',
    )
    await runGit(['fetch', '--no-write-fetch-head', '--no-tags', scratch, created], repositoryRoot)
    return created
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function removeRemote(runGit: TeamGit, folder: string): Promise<void> {
  await runGit(['remote', 'remove', 'origin'], folder)
}

/**
 * Start a task's workspace. `own-branch` gets its own shared clone (objects
 * borrowed from the user's repository, refs of its own, no remote) on
 * `agents/<role>/<task-id>` from the base, and the extension writes that
 * same ref into the user's repository so Review diff and git tools see it.
 * Every `read-only` worker gets a scratch copy instead (detached, no
 * `agents/` ref: there is nothing to merge). `in-place` runs in the user's
 * tree; its lock is lane T's.
 */
export async function startTeamWorkspace(
  runGit: TeamGit,
  storageRoot: string,
  platform: NodeJS.Platform,
  spec: TeamWorkspaceSpec,
): Promise<TeamWorkspace> {
  const branch = teamBranchName(spec.role, spec.taskId)
  if (spec.mode === 'in-place') {
    return { folder: spec.repositoryRoot }
  }
  const folder = teamCloneFolder(storageRoot, spec.role, spec.taskId, spec.mode, platform)
  const p = pathModule(platform)
  await mkdir(storageRoot, { recursive: true })
  await validateTeamFolder(storageRoot, folder)
  await mkdir(p.dirname(folder), { recursive: true })
  await validateTeamFolder(storageRoot, folder)
  await runGit(
    ['clone', '--shared', '--no-checkout', spec.repositoryRoot, folder],
    p.dirname(folder),
  )
  try {
    await removeRemote(runGit, folder)
    if (spec.mode === 'own-branch') {
      await runGit(['checkout', '-b', branch, spec.baseCommit], folder)
      const agentsRef = teamAgentsRef(branch)
      await runGit(
        ['update-ref', agentsRef, spec.baseCommit, '0'.repeat(spec.baseCommit.length)],
        spec.repositoryRoot,
      )
      return { folder, branch, agentsRef }
    }
    await runGit(['checkout', '--detach', spec.baseCommit], folder)
    return { folder }
  } catch (error: unknown) {
    await removeTeamWorkspace(runGit, spec.repositoryRoot, storageRoot, folder)
    throw error
  }
}

/** One-line commit subject: the role, the task and the entry that wrote it. */
export function teamCommitSubject(role: string, taskId: string, entryId: string): string {
  const clean = entryId.replaceAll(/[\r\n]+/g, ' ').trim()
  return `team(${role}/${taskId}): ${clean}`
}

/**
 * The end-of-task commit: the working copy's state on the clone's branch,
 * as one commit naming the role, the entry and the task. The worker never
 * commits; the extension does. Returns the branch head (the base when
 * nothing changed, without an empty commit).
 */
export async function commitTaskBranch(
  runGit: TeamGit,
  folder: string,
  spec: { branch: string; role: string; taskId: string; entryId: string },
): Promise<{ readonly committed: boolean; readonly head: string }> {
  const status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], folder)
  if (status.length === 0) {
    return { committed: false, head: await revParse(runGit, folder, spec.branch) }
  }
  await runGit(['add', '--all', '--'], folder)
  await runGit(
    [
      '-c',
      `user.name=${COMMIT_AUTHOR_NAME}`,
      '-c',
      `user.email=${COMMIT_AUTHOR_EMAIL}`,
      'commit',
      '-m',
      teamCommitSubject(spec.role, spec.taskId, spec.entryId),
    ],
    folder,
  )
  return { committed: true, head: await revParse(runGit, folder, spec.branch) }
}

async function readAgentsRef(
  runGit: TeamGit,
  repositoryRoot: string,
  agentsRef: string,
): Promise<string | undefined> {
  try {
    return objectId(await runGit(['rev-parse', '--verify', agentsRef], repositoryRoot), 'ref')
  } catch {
    return undefined
  }
}

/** Import objects without updating a ref, then publish with Git's atomic CAS. */
export async function publishTaskRef(
  runGit: TeamGit,
  repositoryRoot: string,
  cloneFolder: string,
  branch: string,
  agentsRef: string,
  expected?: string,
): Promise<void> {
  if (agentsRef !== teamAgentsRef(branch)) {
    throw new TeamWorkspaceError('badName', 'The task branch and ref do not match')
  }
  const actual = await readAgentsRef(runGit, repositoryRoot, agentsRef)
  if (actual !== expected) {
    throw new TeamWorkspaceError(
      'refMoved',
      `The team ref ${agentsRef} moved from ${expected ?? '(absent)'} to ${actual ?? '(absent)'}`,
    )
  }
  const head = await revParse(runGit, cloneFolder, branch)
  await runGit(['fetch', '--no-write-fetch-head', '--no-tags', cloneFolder, head], repositoryRoot)
  try {
    await runGit(
      ['update-ref', agentsRef, head, expected ?? '0'.repeat(head.length)],
      repositoryRoot,
    )
  } catch (error: unknown) {
    if (!isTeamGitError(error)) {
      throw error
    }
    const moved = await readAgentsRef(runGit, repositoryRoot, agentsRef)
    throw new TeamWorkspaceError(
      'refMoved',
      `The team ref ${agentsRef} moved from ${expected ?? '(absent)'} to ${moved ?? '(absent)'}`,
    )
  }
}

/** Every existing ancestor must be canonical and remain inside trusted storage. */
async function validateTeamFolder(storageRoot: string, folder: string): Promise<void> {
  const root = path.resolve(storageRoot)
  const target = path.resolve(folder)
  if (!isBelow(path.relative(root, target), path) || (await realpath(root)) !== root) {
    throw new TeamWorkspaceError('workspaceFailed', 'The team copy is outside canonical storage')
  }
  let current = path.dirname(target)
  for (;;) {
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || (await realpath(current)) !== current) {
        throw new TeamWorkspaceError(
          'workspaceFailed',
          'The team copy has a linked storage ancestor',
        )
      }
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error
      }
    }
    if (current === root) {
      return
    }
    current = path.dirname(current)
  }
}

/**
 * Cleanup: the working copy is removed when its task is merged or
 * discarded, and the branch goes with it. A finished task that is neither
 * keeps both until the user acts: this function is only called for merge
 * or discard.
 */
export async function removeTeamWorkspace(
  runGit: TeamGit,
  repositoryRoot: string,
  storageRoot: string,
  folder: string,
  agentsRef?: string,
): Promise<void> {
  await validateTeamFolder(storageRoot, folder)
  try {
    const stat = await lstat(folder)
    if (stat.isSymbolicLink()) {
      await unlink(folder)
    } else {
      if ((await realpath(folder)) !== path.resolve(folder)) {
        throw new TeamWorkspaceError(
          'workspaceFailed',
          'The team copy is outside canonical storage',
        )
      }
      await rm(folder, { recursive: true, force: true })
    }
  } catch (error: unknown) {
    if (!(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw error
    }
  }
  if (agentsRef !== undefined) {
    try {
      await runGit(['update-ref', '-d', agentsRef], repositoryRoot)
    } catch (error: unknown) {
      if (!isTeamGitError(error)) {
        throw error
      }
      // Already gone (a discard racing its own cleanup): nothing to do.
    }
  }
}

/** A porcelain v1 `-z` record holds its two status bytes, a blank, the path. */
const PORCELAIN_STATUS_BYTES = 2
const PORCELAIN_PATH_OFFSET = PORCELAIN_STATUS_BYTES + 1

/** Scratch-copy breach: every path that changed or appeared, or undefined when clean. */
export function parseScratchStatus(porcelain: Uint8Array): readonly string[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(porcelain)
  const tokens = text.split('\0')
  const paths: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index] ?? ''
    if (record === '') {
      continue
    }
    const status = record.slice(0, PORCELAIN_STATUS_BYTES)
    const file = record.slice(PORCELAIN_PATH_OFFSET)
    if (file === '') {
      continue
    }
    paths.push(file)
    // A rename record carries the original path as the next NUL token.
    if (status.startsWith('R')) {
      index += 1
    }
  }
  return paths
}

/**
 * A read-only worker's change found in its scratch copy fails the task:
 * any change or new file there is a breach of its role.
 */
export async function scratchBreach(runGit: TeamGit, folder: string): Promise<readonly string[]> {
  const status = await runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'],
    folder,
  )
  return parseScratchStatus(status)
}
