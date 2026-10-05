// The team's merge (M96 lane I, PLAN.md D75): a per-file three-way merge of
// a finished task's branch into the user's working tree, with `git
// merge-file`, conflicts with markers, protected paths, the `write-paths`
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
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isProtectedPath } from '../protectedPaths'
import { isBelow, resolveWorkspacePath } from '../workspacePath'
import { pathModule } from '../workspaceRoot'
import { checkAgentsRef, type AgentsRefCheck } from './refFence'
import { isTeamGitError, type TeamGit } from './teamWorkspaces'

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
      | 'mergeFailed',
    message: string,
    public readonly files: readonly string[] = [],
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
const EXEC_FILE_MODE = 0o755
const PERMISSION_MASK = 0o777
/** An added file compares against a non-executable default. */
const ADDED_BASE_MODE = 0o10_0644

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
}

export interface TeamMergeUndo {
  readonly files: readonly TeamMergeUndoFile[]
}

export interface TeamMergeResult {
  /** Paths written cleanly (added, updated or deleted). */
  readonly written: readonly string[]
  /** Paths written with conflict markers (or, for binary, left in place). */
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
  io: TeamMergeIo,
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
  // Walk up to the deepest existing ancestor: an added file does not exist
  // yet, so its own real path cannot resolve. Any link on the chain is
  // refused, as M77's take checks refuse it.
  let current = textual.absolute
  const suffix: string[] = []
  for (;;) {
    const stat = await linkOf(current)
    if (stat !== undefined) {
      if (stat.isSymbolicLink()) {
        throw new TeamMergeError(
          'linkEscape',
          `The team merge refused a path through a link ${file}`,
          [file],
        )
      }
      break
    }
    suffix.unshift(p.basename(current))
    const parent = p.dirname(current)
    if (parent === current) {
      throw new TeamMergeError(
        'linkEscape',
        `The team merge refused a path outside the tree ${file}`,
        [file],
      )
    }
    current = parent
  }
  let realRoot: string
  let realAncestor: string
  try {
    ;[realRoot, realAncestor] = await Promise.all([io.realPath(root), io.realPath(current)])
  } catch {
    throw new TeamMergeError(
      'linkEscape',
      `The team merge refused a path outside the tree ${file}`,
      [file],
    )
  }
  const below = p.relative(realRoot, realAncestor)
  if (below !== '' && !isBelow(below, p)) {
    throw new TeamMergeError(
      'linkEscape',
      `The team merge refused a path outside the tree ${file}`,
      [file],
    )
  }
  const canonical = [...(below === '' ? [] : below.split(p.sep)), ...suffix].join('/')
  if (canonical !== textual.relative) {
    throw new TeamMergeError('linkEscape', `The team merge refused a path through a link ${file}`, [
      file,
    ])
  }
  return textual.relative
}

function isWithinWritePaths(relative: string, writePaths: readonly string[]): boolean {
  const lower = relative.toLowerCase()
  return writePaths.some((entry) => {
    const prefix = entry.toLowerCase().replace(/\/+$/, '')
    return lower === prefix || lower.startsWith(`${prefix}/`)
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
 * then each file merges per-file three-way through `git merge-file`, with
 * markers and the file listed on conflict.
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
  try {
    for (const file of planned) {
      const outcome = await mergeOneFile(io, spec, file, scratch, platform)
      written.push(...outcome.written)
      conflicts.push(...outcome.conflicts)
      modeChanged.push(...outcome.modeChanged)
      undoFiles.push(...outcome.undo)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  return {
    written,
    conflicts,
    modeChanged,
    protectedWritten: options.allowProtected === true ? protectedFiles : [],
    undo: { files: undoFiles },
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
  } catch {
    return undefined
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
  const oursBytes = await readWorktreeFile(spec.repositoryRoot, file.path)

  // Nothing to do: the tree already holds the branch's result.
  if (areBytesEqual(oursBytes, theirsBytes)) {
    return { written: [], conflicts: [], modeChanged: [], undo: [] }
  }
  const undo: TeamMergeUndoFile[] = [{ path: file.path, before: oursBytes, after: undefined }]
  const absolute = path.join(spec.repositoryRoot, file.path)

  // Only the branch changed it: take theirs whole.
  if (areBytesEqual(oursBytes, baseBytes)) {
    if (theirsBytes === undefined) {
      if (oursBytes !== undefined) {
        await unlink(absolute)
      }
      undo[0] = { path: file.path, before: oursBytes, after: undefined }
      return { written: [file.path], conflicts: [], modeChanged: [], undo }
    }
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, theirsBytes)
    const modes = await syncExecBit(
      absolute,
      file.path,
      baseBlob?.mode ?? ADDED_BASE_MODE,
      theirsBlob?.mode,
      platform,
    )
    undo[0] = { path: file.path, before: oursBytes, after: theirsBytes }
    return { written: [file.path], conflicts: [], modeChanged: modes, undo }
  }

  // Binary files merge explicitly: both sides changed one is a conflict,
  // and the tree keeps its own bytes for the orchestrator to resolve.
  if (file.isBinary) {
    undo[0] = { path: file.path, before: oursBytes, after: oursBytes }
    return {
      written: [],
      conflicts: [{ path: file.path, isBinary: true }],
      modeChanged: [],
      undo,
    }
  }

  // Three-way through `git merge-file`: exit 0 is clean, exit 1 wrote
  // markers into the first file. It runs on scratch files outside any
  // repository with a pinned conflict style, so no repository program or
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
    if (!isTeamGitError(error) || error.exitCode !== 1) {
      throw error
    }
    isConflicted = true
  }
  const merged = await readFile(oursTmp)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, merged)
  const modes = isConflicted
    ? []
    : await syncExecBit(
        absolute,
        file.path,
        baseBlob?.mode ?? ADDED_BASE_MODE,
        theirsBlob?.mode,
        platform,
      )
  undo[0] = { path: file.path, before: oursBytes, after: merged }
  if (isConflicted) {
    return {
      written: [],
      conflicts: [{ path: file.path, isBinary: false }],
      modeChanged: [],
      undo,
    }
  }
  return { written: [file.path], conflicts: [], modeChanged: modes, undo }
}

/** Flip the executable bit when the branch flipped it: the file, or nothing. */
async function syncExecBit(
  absolute: string,
  relative: string,
  baseMode: number | undefined,
  theirsMode: number | undefined,
  platform: NodeJS.Platform,
): Promise<readonly string[]> {
  if (
    platform === 'win32' ||
    baseMode === undefined ||
    theirsMode === undefined ||
    (baseMode & EXECUTABLE_BIT) === (theirsMode & EXECUTABLE_BIT)
  ) {
    return []
  }
  const stat = await lstat(absolute)
  const bit = (theirsMode & EXECUTABLE_BIT) === 0 ? PLAIN_FILE_MODE : EXEC_FILE_MODE
  await chmod(absolute, (stat.mode & ~PERMISSION_MASK) | bit)
  return [relative]
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
  for (const file of undo.files) {
    const current = await readWorktreeFile(repositoryRoot, file.path)
    if (!areBytesEqual(current, file.after)) {
      refused.push(file.path)
      continue
    }
    const absolute = path.join(repositoryRoot, file.path)
    if (file.before === undefined) {
      if (current !== undefined) {
        await unlink(absolute)
      }
    } else {
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, file.before)
    }
    restored.push(file.path)
  }
  return { restored, refused }
}
