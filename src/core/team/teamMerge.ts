// The team's merge (M96 lane I, PLAN.md D75): a per-file three-way merge of
// a finished task's branch into the user's working tree, with `git
// merge-file`, conflicts returned for rework, protected paths, the `write-paths`
// check, the breach check, and Undo merge.
//
// The merge brings the change in as uncommitted working-tree changes: no
// commit, no merge state, no ref change on the user's branch. It keeps the
// tree's own uncommitted changes (ours is the file as it stands), uses only
// `git merge-file` (which reads no repository attributes, drivers or
// filters, so no repository program runs), and repeats the take checks
// before writing: canonical targets, no path through a link out of the
// workspace, protected paths (asked in every mode: the merge reports them
// and writes nothing until the caller re-runs with `allowProtected`), and
// the ref fence clean. No `vscode` here.

import type { Stats } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isGlobMatch } from '../backends/modelapi/globLimits'
import { isProtectedPath } from '../protectedPaths'
import { isBelow, resolveWorkspacePath } from '../workspacePath'
import { pathModule } from '../workspaceRoot'
import { checkAgentsRef, type AgentsRefCheck } from './refFence'
import { isTeamGitError, isSameTeamPath, teamProgramFreeGit, type TeamGit } from './teamWorkspaces'

/** A merge failure: the stable code travels with the error. */
export class TeamMergeError extends Error {
  public constructor(
    public readonly code:
      | 'badCommit'
      | 'unsafePath'
      | 'linkEscape'
      | 'writePaths'
      | 'protected'
      | 'refBreach'
      | 'treeChanged'
      | 'mergeFailed',
    message: string,
    public readonly files: readonly string[] = [],
    public readonly undo: TeamMergeUndo = { files: [] },
    public readonly rollback?: {
      readonly restored: readonly string[]
      readonly refused: readonly string[]
    },
  ) {
    super(message)
    this.name = 'TeamMergeError'
  }
}

export function isTeamMergeError(value: unknown): value is TeamMergeError {
  return value instanceof Error && value.name === 'TeamMergeError'
}

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const LOSSY_DECODER = new TextDecoder('utf-8', { fatal: false })
const NUL = 0
const EXECUTABLE_BIT = 0o100
const PLAIN_FILE_MODE = 0o644
const EXECUTABLE_MASK = 0o111
const READABLE_MASK = 0o444
const PERMISSION_MASK = 0o777
/** An added file compares against a non-executable default. */
const ADDED_BASE_MODE = 0o10_0644
/** merge-file caps its positive conflict count at 127; negative errors surface as 255. */
const MAX_CONFLICT_EXIT = 127

function checkCommit(value: string, what: string): string {
  if (!OBJECT_ID.test(value)) {
    throw new TeamMergeError('badCommit', `The team merge needs a commit as ${what}`)
  }
  return value
}

/** An `agents/` ref the merge re-checks before writing. */
export interface TeamMergeAgentRef {
  readonly ref: string
  readonly expected: string | undefined
  readonly actual: string | undefined
}

export interface TeamMergeSpec {
  readonly repositoryRoot: string
  readonly baseCommit: string
  readonly branchHead: string
  /** The role's `write-paths`: absent means the role may write anywhere. */
  readonly writePaths?: readonly string[] | undefined
  readonly agentRefs: readonly TeamMergeAgentRef[]
  /** The task's separate clone: conflicts are returned there for rework. */
  readonly taskFolder?: string | undefined
}

export interface TeamMergeOptions {
  /** The user approved the protected paths (asked in every mode). */
  readonly allowProtected?: boolean | undefined
  readonly platform?: NodeJS.Platform | undefined
}

export interface TeamMergeIo {
  readonly runGit: TeamGit
  readonly realPath: (candidate: string) => Promise<string>
}

export type TeamMergeChange = 'added' | 'deleted' | 'modified'

export interface TeamMergePlannedFile {
  readonly path: string
  readonly change: TeamMergeChange
  readonly isBinary: boolean
  readonly isProtected: boolean
  readonly outsideWritePaths: boolean
}

export interface TeamMergeConflict {
  readonly path: string
  readonly isBinary: boolean
}

export interface TeamMergeUndoFile {
  readonly path: string
  /** Absent when the merge created the file. */
  readonly before: Uint8Array | undefined
  /** Absent when the merge deleted the file. */
  readonly after: Uint8Array | undefined
  readonly beforeMode: number | undefined
  readonly afterMode: number | undefined
}

export interface TeamMergeUndo {
  readonly files: readonly TeamMergeUndoFile[]
}

export interface TeamMergeResult {
  readonly status: 'merged' | 'rework'
  /** Paths written cleanly (added, updated or deleted). */
  readonly written: readonly string[]
  /** Conflicts returned to the task copy; the user tree stays untouched. */
  readonly conflicts: readonly TeamMergeConflict[]
  /** Files whose executable bit the merge flipped. */
  readonly modeChanged: readonly string[]
  /** Protected paths the user approved and the merge wrote. */
  readonly protectedWritten: readonly string[]
  /** For Undo merge (M86's rule). */
  readonly undo: TeamMergeUndo
}

interface RawChange {
  readonly path: string
  readonly change: TeamMergeChange
  readonly baseMode: number | undefined
  readonly theirsMode: number | undefined
}

function hasNul(bytes: Uint8Array): boolean {
  return bytes.includes(NUL)
}

/**
 * Raw `--raw -z` records: `:oldmode newmode oldsha newsha STATUS`, NUL,
 * path, NUL. `--no-renames` is always passed, so every record is one header
 * and one path: anything else (a rename, a copy, a second path) is refused
 * rather than guessed.
 */
function parseRawDiff(output: Uint8Array): readonly RawChange[] {
  const text = LOSSY_DECODER.decode(output)
  const tokens = text.split('\0').filter((token) => token !== '')
  if (tokens.length % 2 !== 0) {
    throw new TeamMergeError('mergeFailed', 'The team merge could not read the change')
  }
  const changes: RawChange[] = []
  const RECORD = /^:(\d+) (\d+) [a-f0-9]+ [a-f0-9]+ ([ACDMRTUXB])$/
  for (let index = 0; index < tokens.length; index += 2) {
    const header = tokens[index] ?? ''
    const file = tokens[index + 1] ?? ''
    const match = RECORD.exec(header)
    const status = match?.[3] ?? ''
    if (match === null || file === '' || status === 'R' || status === 'C') {
      throw new TeamMergeError('mergeFailed', 'The team merge could not read the change')
    }
    const baseMode = Number.parseInt(match[1] ?? '', 8)
    const theirsMode = Number.parseInt(match[2] ?? '', 8)
    let change: TeamMergeChange = 'modified'
    if (status === 'A') {
      change = 'added'
    } else if (status === 'D') {
      change = 'deleted'
    }
    changes.push({
      path: file,
      change,
      baseMode: Number.isSafeInteger(baseMode) ? baseMode : undefined,
      theirsMode: Number.isSafeInteger(theirsMode) ? theirsMode : undefined,
    })
  }
  return changes
}

function checkUnsafePath(file: string): void {
  if (file.includes('\0') || file.startsWith(':') || file.includes('\\')) {
    throw new TeamMergeError('unsafePath', `The team merge refused an unsafe path ${file}`, [file])
  }
}

async function confinedRelative(
  io: Pick<TeamMergeIo, 'realPath'>,
  root: string,
  file: string,
  platform: NodeJS.Platform,
): Promise<string> {
  checkUnsafePath(file)
  const p = pathModule(platform)
  const textual = resolveWorkspacePath(root, file, platform)
  if (!textual.ok) {
    throw new TeamMergeError(
      'linkEscape',
      `The team merge refused a path outside the tree ${file}`,
      [file],
    )
  }
  let realRoot: string
  try {
    realRoot = await io.realPath(root)
  } catch {
    throw new TeamMergeError('linkEscape', `The team merge cannot resolve its root ${file}`, [file])
  }
  if (!isSameTeamPath(root, realRoot, platform)) {
    throw new TeamMergeError('linkEscape', `The team merge has a linked root ${file}`, [file])
  }
  // Check every ancestor, even when the leaf already exists. A leaf-only
  // realpath check misses an ancestor link to another in-workspace folder.
  let current = textual.absolute
  for (;;) {
    const stat = await linkOf(current)
    if (
      stat !== undefined &&
      (stat.isSymbolicLink() || !isSameTeamPath(await io.realPath(current), current, platform))
    ) {
      throw new TeamMergeError(
        'linkEscape',
        `The team merge refused a path through a link ${file}`,
        [file],
      )
    }
    if (isSameTeamPath(current, realRoot, platform)) {
      return textual.relative
    }
    current = p.dirname(current)
    if (
      !isSameTeamPath(current, realRoot, platform) &&
      !isBelow(p.relative(p.toNamespacedPath(realRoot), p.toNamespacedPath(current)), p)
    ) {
      throw new TeamMergeError('linkEscape', `The team merge refused an outside ancestor ${file}`, [
        file,
      ])
    }
  }
}

function isWithinWritePaths(relative: string, writePaths: readonly string[]): boolean {
  return writePaths.some((entry) => {
    const pattern = entry.replace(/\/+$/, '')
    // Retain literal directory entries; wildcard entries use charter globs.
    return /[*?{[]/.test(pattern)
      ? isGlobMatch(relative, pattern)
      : relative === pattern || relative.startsWith(`${pattern}/`)
  })
}

/** `git ls-tree -z <rev> -- <path>`: the blob sha and mode, if the path is a file. */
async function treeBlob(
  runGit: TeamGit,
  repositoryRoot: string,
  rev: string,
  file: string,
): Promise<{ readonly sha: string; readonly mode: number } | undefined> {
  const output = LOSSY_DECODER.decode(
    await runGit(['ls-tree', '-z', rev, '--', file], repositoryRoot),
  )
  const record = output.split('\0', 1)[0] ?? ''
  if (record === '') {
    return undefined
  }
  const match = /^(\d+) blob ([a-f0-9]+)\t/.exec(record)
  if (match === null) {
    // A tree or submodule where a file was expected: the merge refuses it
    // as unsafe rather than guessing (fail-closed).
    return undefined
  }
  const mode = Number.parseInt(match[1] ?? '', 8)
  if ((mode & ~EXECUTABLE_MASK) !== ADDED_BASE_MODE) {
    throw new TeamMergeError('unsafePath', `The team merge refused a non-regular file ${file}`, [
      file,
    ])
  }
  return Number.isSafeInteger(mode) ? { sha: match[2] ?? '', mode } : undefined
}

async function readBlob(runGit: TeamGit, repositoryRoot: string, sha: string): Promise<Uint8Array> {
  return await runGit(['cat-file', 'blob', sha], repositoryRoot)
}

function areBytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }
  if (left.length !== right.length) {
    return false
  }
  for (const [index, element] of left.entries()) {
    if (element !== right[index]) {
      return false
    }
  }
  return true
}

/**
 * What the merge would do, without writing: the files, which are binary,
 * which need the protected-path approval, and which fall outside
 * `write-paths`. Throws for unsafe paths, link escapes and ref breaches.
 */
export async function planTeamMerge(
  io: TeamMergeIo,
  spec: TeamMergeSpec,
  platform: NodeJS.Platform = process.platform,
): Promise<readonly TeamMergePlannedFile[]> {
  const base = checkCommit(spec.baseCommit, 'base')
  const head = checkCommit(spec.branchHead, 'branch head')
  for (const agentRef of spec.agentRefs) {
    const check: AgentsRefCheck = checkAgentsRef(agentRef.ref, agentRef.expected, agentRef.actual)
    if (check.breach) {
      throw new TeamMergeError(
        'refBreach',
        `The team merge refused a moved ref ${check.ref} (${check.oldValue} to ${check.newValue})`,
        [check.ref],
      )
    }
  }
  const raw = await io.runGit(
    [
      'diff',
      '--raw',
      '-z',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      base,
      head,
      '--',
    ],
    spec.repositoryRoot,
  )
  const planned: TeamMergePlannedFile[] = []
  for (const change of parseRawDiff(raw)) {
    const relative = await confinedRelative(io, spec.repositoryRoot, change.path, platform)
    const baseBlob =
      change.change === 'added'
        ? undefined
        : await treeBlob(io.runGit, spec.repositoryRoot, base, change.path)
    // A tree, submodule or mode-only record the raw parse kept: the merge
    // takes the branch's file explicitly below, or refuses a non-file.
    const theirsBlob =
      change.change === 'deleted'
        ? undefined
        : await treeBlob(io.runGit, spec.repositoryRoot, head, change.path)
    if (theirsBlob === undefined && change.change !== 'deleted') {
      throw new TeamMergeError(
        'unsafePath',
        `The team merge refused a non-file path ${change.path}`,
        [change.path],
      )
    }
    const baseBytes =
      baseBlob === undefined
        ? undefined
        : await readBlob(io.runGit, spec.repositoryRoot, baseBlob.sha)
    const theirsBytes =
      theirsBlob === undefined
        ? undefined
        : await readBlob(io.runGit, spec.repositoryRoot, theirsBlob.sha)
    const isBinary =
      (baseBytes !== undefined && hasNul(baseBytes)) ||
      (theirsBytes !== undefined && hasNul(theirsBytes))
    planned.push({
      path: relative,
      change: change.change,
      isBinary,
      isProtected: isProtectedPath(relative.toLowerCase()),
      outsideWritePaths:
        spec.writePaths !== undefined && !isWithinWritePaths(relative, spec.writePaths),
    })
  }
  return planned
}

/**
 * The merge itself. Re-derives the plan (a preview can go stale while the
 * card asks), then: `write-paths` violations refuse the whole merge; a ref
 * breach refuses it; protected paths refuse it unless `allowProtected`;
 * then derives every file through `git merge-file`. Conflicts go to the
 * task copy under rework; no result lands in the user tree until clean.
 */
export async function applyTeamMerge(
  io: TeamMergeIo,
  spec: TeamMergeSpec,
  options: TeamMergeOptions = {},
): Promise<TeamMergeResult> {
  const platform = options.platform ?? process.platform
  const planned = await planTeamMerge(io, spec, platform)
  const outside = planned.filter((file) => file.outsideWritePaths).map((file) => file.path)
  if (outside.length > 0) {
    throw new TeamMergeError(
      'writePaths',
      `The team merge refused files outside write-paths: ${outside.join(', ')}`,
      outside,
    )
  }
  const protectedFiles = planned.filter((file) => file.isProtected).map((file) => file.path)
  if (protectedFiles.length > 0 && options.allowProtected !== true) {
    throw new TeamMergeError(
      'protected',
      `The team merge needs approval for protected paths: ${protectedFiles.join(', ')}`,
      protectedFiles,
    )
  }
  const scratch = await mkdtemp(path.join(tmpdir(), 'muse-team-merge-'))
  const written: string[] = []
  const conflicts: TeamMergeConflict[] = []
  const modeChanged: string[] = []
  const undoFiles: TeamMergeUndoFile[] = []
  const landed: TeamMergeUndoFile[] = []
  let landingRoot = spec.repositoryRoot
  try {
    try {
      for (const file of planned) {
        const outcome = await mergeOneFile(io, spec, file, scratch, platform)
        written.push(...outcome.written)
        conflicts.push(...outcome.conflicts)
        modeChanged.push(...outcome.modeChanged)
        undoFiles.push(...outcome.undo)
      }
      if (conflicts.length > 0) {
        const taskFolder = spec.taskFolder
        const p = pathModule(platform)
        if (
          taskFolder === undefined ||
          isSameTeamPath(taskFolder, spec.repositoryRoot, platform) ||
          isBelow(
            p.relative(p.toNamespacedPath(spec.repositoryRoot), p.toNamespacedPath(taskFolder)),
            p,
          ) ||
          isBelow(
            p.relative(p.toNamespacedPath(taskFolder), p.toNamespacedPath(spec.repositoryRoot)),
            p,
          )
        ) {
          throw new TeamMergeError(
            'mergeFailed',
            'Conflicts need the task copy for rework',
            conflicts.map((file) => file.path),
          )
        }
        const taskHead = checkCommit(
          LOSSY_DECODER.decode(
            await teamProgramFreeGit(io.runGit)(
              ['rev-parse', '--verify', 'HEAD^{commit}'],
              taskFolder,
            ),
          ).trim(),
          'task head',
        )
        if (taskHead !== spec.branchHead) {
          throw new TeamMergeError('refBreach', 'The rework task copy moved since its preview')
        }
        await checkLiveRefs(io, spec)
        landingRoot = taskFolder
        for (const file of undoFiles) {
          // Binary conflicts keep the worker's version intact for rework.
          if (conflicts.some((conflict) => conflict.path === file.path && conflict.isBinary)) {
            continue
          }
          await confinedRelative(io, taskFolder, file.path, platform)
          const taskBefore = await readWorktreeFile(taskFolder, file.path)
          const taskMode = await worktreeMode(taskFolder, file.path, platform)
          const rework = { ...file, before: taskBefore, beforeMode: taskMode }
          await landFile(
            io,
            taskFolder,
            rework,
            platform,
            () => checkLiveRefs(io, spec),
            () => {
              landed.push(rework)
            },
          )
        }
        return {
          status: 'rework',
          written: [],
          conflicts,
          modeChanged: [],
          protectedWritten: [],
          undo: { files: [] },
        }
      }
      for (const file of undoFiles) {
        await checkLiveRefs(io, spec)
        await landFile(
          io,
          spec.repositoryRoot,
          file,
          platform,
          () => checkLiveRefs(io, spec),
          () => {
            landed.push(file)
          },
        )
      }
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  } catch (error: unknown) {
    const undo = { files: landed }
    const rollback = await undoTeamMerge(landingRoot, undo)
    throw new TeamMergeError(
      isTeamMergeError(error) ? error.code : 'mergeFailed',
      error instanceof Error ? error.message : 'The team merge failed',
      isTeamMergeError(error) ? error.files : [],
      undo,
      rollback,
    )
  }
  return {
    status: 'merged',
    written,
    conflicts,
    modeChanged,
    protectedWritten: options.allowProtected === true ? protectedFiles : [],
    undo: { files: undoFiles },
  }
}

/** Re-read the real ref after asynchronous planning and immediately before each write. */
async function checkLiveRefs(io: TeamMergeIo, spec: TeamMergeSpec): Promise<void> {
  for (const agentRef of spec.agentRefs) {
    let actual: string | undefined
    try {
      actual = checkCommit(
        LOSSY_DECODER.decode(
          await io.runGit(['rev-parse', '--verify', agentRef.ref], spec.repositoryRoot),
        ).trim(),
        'live ref',
      )
    } catch (error: unknown) {
      if (!isTeamGitError(error)) {
        throw error
      }
    }
    const check = checkAgentsRef(agentRef.ref, agentRef.expected, actual)
    if (check.breach) {
      throw new TeamMergeError(
        'refBreach',
        `The team merge refused a moved ref ${check.ref} (${check.oldValue} to ${check.newValue})`,
        [check.ref],
      )
    }
  }
}

/** Confine again at each mutation, including every parent of an existing leaf. */
async function landFile(
  io: Pick<TeamMergeIo, 'realPath'>,
  root: string,
  file: TeamMergeUndoFile,
  platform: NodeJS.Platform,
  beforeWrite?: () => Promise<void>,
  onLanded?: () => void,
): Promise<void> {
  await confinedRelative(io, root, file.path, platform)
  const absolute = path.join(root, file.path)
  if (file.after === undefined) {
    await verifyWorktreeFile(
      io,
      root,
      file.path,
      file.before,
      file.beforeMode,
      platform,
      beforeWrite,
    )
    if ((await linkOf(absolute)) !== undefined) {
      await unlink(absolute)
      onLanded?.()
    }
    return
  }
  await mkdir(path.dirname(absolute), { recursive: true })
  // Prepare bytes and mode before touching the target. A failed write or
  // chmod cannot leave a truncated target outside the transaction journal.
  const staging = await mkdtemp(path.join(path.dirname(absolute), '.muse-team-land-'))
  try {
    const staged = path.join(staging, 'file')
    await writeFile(staged, file.after)
    if (platform !== 'win32' && file.afterMode !== undefined) {
      await chmod(staged, file.afterMode)
    }
    await verifyWorktreeFile(
      io,
      root,
      file.path,
      file.before,
      file.beforeMode,
      platform,
      beforeWrite,
    )
    await rename(staged, absolute)
    onLanded?.()
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function worktreeMode(
  root: string,
  file: string,
  platform: NodeJS.Platform,
): Promise<number | undefined> {
  const stat = await linkOf(path.join(root, file))
  return platform === 'win32' || stat === undefined ? undefined : stat.mode & PERMISSION_MASK
}

/** Compare-and-swap admission, also used to verify Undo's restored bytes. */
async function verifyWorktreeFile(
  io: Pick<TeamMergeIo, 'realPath'>,
  root: string,
  file: string,
  bytes: Uint8Array | undefined,
  mode: number | undefined,
  platform: NodeJS.Platform,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await confinedRelative(io, root, file, platform)
  await beforeWrite?.()
  if (
    !areBytesEqual(await readWorktreeFile(root, file), bytes) ||
    (await worktreeMode(root, file, platform)) !== mode
  ) {
    throw new TeamMergeError('treeChanged', `The team merge refused a changed file ${file}`, [file])
  }
}

interface FileOutcome {
  readonly written: readonly string[]
  readonly conflicts: readonly TeamMergeConflict[]
  readonly modeChanged: readonly string[]
  readonly undo: readonly TeamMergeUndoFile[]
}

/** The stat at a path; a missing path is not a link. Other errors throw. */
async function linkOf(absolute: string): Promise<Stats | undefined> {
  try {
    return await lstat(absolute)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function readWorktreeFile(root: string, relative: string): Promise<Uint8Array | undefined> {
  const absolute = path.join(root, relative)
  // A link where a file belongs would write through it: refuse, never follow.
  const link = await linkOf(absolute)
  if (link?.isSymbolicLink() === true) {
    throw new TeamMergeError('linkEscape', `The team merge refused a link ${relative}`, [relative])
  }
  try {
    return await readFile(absolute)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/** An errno-style code, if the failure carries one. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

async function mergeOneFile(
  io: TeamMergeIo,
  spec: TeamMergeSpec,
  file: TeamMergePlannedFile,
  scratch: string,
  platform: NodeJS.Platform,
): Promise<FileOutcome> {
  const base = spec.baseCommit
  const head = spec.branchHead
  const baseBlob =
    file.change === 'added'
      ? undefined
      : await treeBlob(io.runGit, spec.repositoryRoot, base, file.path)
  const theirsBlob =
    file.change === 'deleted'
      ? undefined
      : await treeBlob(io.runGit, spec.repositoryRoot, head, file.path)
  const baseBytes =
    baseBlob === undefined
      ? undefined
      : await readBlob(io.runGit, spec.repositoryRoot, baseBlob.sha)
  const theirsBytes =
    theirsBlob === undefined
      ? undefined
      : await readBlob(io.runGit, spec.repositoryRoot, theirsBlob.sha)
  await confinedRelative(io, spec.repositoryRoot, file.path, platform)
  const oursBytes = await readWorktreeFile(spec.repositoryRoot, file.path)
  const absolute = path.join(spec.repositoryRoot, file.path)
  const oursStat = await linkOf(absolute)
  const oursMode = platform === 'win32' ? undefined : oursStat?.mode
  const beforeMode = oursMode === undefined ? undefined : oursMode & PERMISSION_MASK
  const baseMode = baseBlob?.mode ?? ADDED_BASE_MODE
  const hasModeFlip =
    platform !== 'win32' &&
    theirsBlob !== undefined &&
    (baseMode & EXECUTABLE_BIT) !== (theirsBlob.mode & EXECUTABLE_BIT)
  let afterMode: number | undefined
  if (platform !== 'win32' && theirsBytes !== undefined) {
    afterMode = beforeMode
    if (afterMode === undefined) {
      // A real file creation honours the process umask without reading it
      // through Node's deprecated, process-wide read/change/restore API.
      const modeFolder = await mkdtemp(path.join(scratch, 'mode-'))
      const modeFile = path.join(modeFolder, 'file')
      await writeFile(modeFile, new Uint8Array(), { mode: PLAIN_FILE_MODE })
      const modeStat = await lstat(modeFile)
      afterMode = modeStat.mode & PERMISSION_MASK
    }
    if (hasModeFlip) {
      afterMode =
        (theirsBlob.mode & EXECUTABLE_BIT) === 0
          ? afterMode & ~EXECUTABLE_MASK
          : afterMode | ((afterMode & READABLE_MASK) >> 2)
    }
  }
  const modes = beforeMode !== afterMode && hasModeFlip ? [file.path] : []
  const outcome = (after: Uint8Array | undefined, isConflict = false): FileOutcome => ({
    written: isConflict ? [] : [file.path],
    conflicts: isConflict ? [{ path: file.path, isBinary: file.isBinary }] : [],
    modeChanged: isConflict ? [] : modes,
    undo: [
      {
        path: file.path,
        before: oursBytes,
        after,
        beforeMode,
        afterMode: isConflict ? beforeMode : afterMode,
      },
    ],
  })
  if (areBytesEqual(oursBytes, theirsBytes)) {
    return beforeMode === afterMode
      ? { written: [], conflicts: [], modeChanged: [], undo: [] }
      : outcome(theirsBytes)
  }
  if (areBytesEqual(oursBytes, baseBytes)) {
    return outcome(theirsBytes)
  }
  if (file.isBinary) {
    return outcome(oursBytes, true)
  }

  // Three-way through `git merge-file`: exit 0 is clean, positive
  // conflict counts write markers into the first scratch file. Scratch is
  // outside any repository with a pinned style, so no repository program or
  // configuration shapes the result.
  const oursTmp = path.join(scratch, 'ours')
  const baseTmp = path.join(scratch, 'base')
  const theirsTmp = path.join(scratch, 'theirs')
  await writeFile(oursTmp, oursBytes ?? new Uint8Array())
  await writeFile(baseTmp, baseBytes ?? new Uint8Array())
  await writeFile(theirsTmp, theirsBytes ?? new Uint8Array())
  let isConflicted = false
  try {
    await io.runGit(
      [
        '-c',
        'merge.conflictstyle=merge',
        'merge-file',
        '-L',
        `ours:${file.path}`,
        '-L',
        `base:${file.path}`,
        '-L',
        `theirs:${file.path}`,
        oursTmp,
        baseTmp,
        theirsTmp,
      ],
      scratch,
    )
  } catch (error: unknown) {
    if (!isTeamGitError(error) || error.exitCode < 1 || error.exitCode > MAX_CONFLICT_EXIT) {
      throw error
    }
    isConflicted = true
  }
  const merged = await readFile(oursTmp)
  return outcome(merged, isConflicted)
}

/**
 * Undo merge (M86's rule): restore each touched file to its bytes before
 * the merge, but only while the file still holds exactly what the merge
 * wrote. A file the user has since edited is refused and named; the rest
 * still restore.
 */
export async function undoTeamMerge(
  repositoryRoot: string,
  undo: TeamMergeUndo,
): Promise<{ readonly restored: readonly string[]; readonly refused: readonly string[] }> {
  const restored: string[] = []
  const refused: string[] = []
  const io = { realPath: realpath }
  for (const file of undo.files) {
    try {
      await confinedRelative(io, repositoryRoot, file.path, process.platform)
      const current = await readWorktreeFile(repositoryRoot, file.path)
      const currentStat = await linkOf(path.join(repositoryRoot, file.path))
      const currentMode = process.platform === 'win32' ? undefined : currentStat?.mode
      if (
        !areBytesEqual(current, file.after) ||
        (currentMode === undefined ? undefined : currentMode & PERMISSION_MASK) !== file.afterMode
      ) {
        refused.push(file.path)
        continue
      }
      await landFile(
        io,
        repositoryRoot,
        {
          ...file,
          before: file.after,
          beforeMode: file.afterMode,
          after: file.before,
          afterMode: file.beforeMode,
        },
        process.platform,
      )
      await verifyWorktreeFile(
        io,
        repositoryRoot,
        file.path,
        file.before,
        file.beforeMode,
        process.platform,
      )
      restored.push(file.path)
    } catch {
      // An I/O error or read-back mismatch must not be reported as restored.
      refused.push(file.path)
    }
  }
  return { restored, refused }
}
