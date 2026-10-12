// First-use worker operations, behind the create chunk: the abandoned
// reservation sweep and creation cleanup, the typed create refusals, and the
// governed worktree git runner. The host retains the sole root-grant
// authority; the only process this module starts is git through the governed
// contained launcher, never directly.
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { lstat, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import type { pathModule } from '../../workspaceRoot'
import { powerShellQuoted } from '../../shellQuote'
import {
  BYTES_PER_MIB,
  UI_TEXT,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WORKER_FILE_PATH_TIMEOUT_MS,
  WORKER_NATIVE_REPLY_MAX_BYTES,
} from '../../../shared/constants'
import type { UiText } from '../../../shared/l10n/en'
import { fill, setUiText } from '../../../shared/l10n/text'
import { execResourceFile, execResourceFileBytes } from '../../resources/launcher'
import { resourceWindowsJob } from '../../resources/admission'
import { scrubWorkerEnv } from './workerEnv'
import { TeamGitError, type TeamGit } from '../teamWorkspaces'
import type { WorkerFenceIo, WorkerFileHandle } from './workerFence'
import type { WorkerCreateProof } from './workerCreateEntry'
import { workerEnvironment } from './workerEnv'

type PlatformPath = ReturnType<typeof pathModule>
type SweepRun = NonNullable<WorkerFenceIo['workerNativeOperation']>

/** The lazy chunk installs the caller's language before use, like the host chunk does. */
export function installSweepText(table: UiText, locale: string): void {
  setUiText(table, locale)
}

/** A refusal this module already typed keeps its sentence on the way out. */
function markTyped(error: Error): Error {
  return Object.assign(error, { typedCreateRefusal: true })
}

function isTyped(error: unknown): error is Error {
  return (
    error instanceof Error && 'typedCreateRefusal' in error && error.typedCreateRefusal === true
  )
}

const receipt = z.strictObject({
  identity: z.string().check(z.regex(/^\d+:\d+$/)),
  createdFolders: z.number().check(z.int(), z.minimum(0)),
})

/**
 * The helper receipt at the trust boundary: a malformed identity or folder
 * count fails before any handle is opened, whether the operation came from
 * the production launcher or an injected one.
 */
export function parseWorkerReceipt(made: unknown): {
  readonly identity: string
  readonly createdFolders: number
} {
  return receipt.parse(made)
}

/**
 * The helper runs through resource admission under the contained profile, one
 * launch per file operation: the whole operation goes to a single helper
 * invocation with its arguments as an array. No compiler, pathname fallback,
 * credential or shell payload. A refused admission is a typed refusal.
 */
export async function nativeOperation(proof: WorkerCreateProof, op: string, identity = '') {
  const args = [
    op,
    proof.root,
    proof.rootIdentity,
    proof.ancestor,
    proof.ancestorIdentity,
    proof.remaining,
    identity,
  ]
  let file: string
  let command: readonly string[] = args
  let env: NodeJS.ProcessEnv = { LC_ALL: 'C' }
  if (process.platform === 'win32') {
    const job = await resourceWindowsJob()
    const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
    if (job === undefined || systemRoot === undefined)
      throw new Error(UI_TEXT.teamFileHelperMissing)
    await job.verify()
    file = path.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
    env = { SystemRoot: systemRoot }
    // The operation arguments reach the helper as $args: no file name is
    // quoted into the script text. Only the assembly path (our own file) is.
    command = [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `$ErrorActionPreference='Stop'; try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(job.assemblyPath)}); [MuseSparkCreated]::Execute($args) } catch { if ($_.Exception.GetBaseException().Message -eq 'worker file helper refused: target exists') { [Console]::Error.WriteLine('worker file helper refused: target exists') }; exit 1 }`,
      ...args,
    ]
  } else if (process.platform === 'darwin') {
    file = path.join(__dirname, '..', 'native', 'darwin', 'muse-dictate')
    command = ['--created-directory', ...args]
  } else if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
    file = path.join(__dirname, '..', 'native', 'linux', process.arch, 'muse-created')
  } else throw new Error(UI_TEXT.teamFileHelperMissing)
  try {
    const { stdout } = await execResourceFile('contained', file, command, {
      env: scrubWorkerEnv({ platform: process.platform, baseEnv: env }),
      timeout: WORKER_FILE_PATH_TIMEOUT_MS,
      maxBuffer: WORKER_NATIVE_REPLY_MAX_BYTES,
      windowsHide: true,
    })
    return receipt.parse(JSON.parse(stdout))
  } catch (error: unknown) {
    throw mapNativeError(error, proof.remaining)
  }
}

/** Every helper or launcher failure as the typed sentence the worker reports. */
export function mapNativeError(error: unknown, remaining: string): Error {
  if (isTyped(error)) return error
  const cause = error instanceof Error ? error : new Error(UI_TEXT.teamFileNativeFailed)
  // Production carries the helper's words on stderr; the test fixture embeds
  // them in the message. Both are the helper's fixed refusals, never paths.
  const stderr =
    error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr
      : ''
  const text = `${stderr}\n${cause.message}`
  if (text.includes('worker file helper refused: target exists'))
    return markTyped(new Error(UI_TEXT.teamFileExists, { cause }))
  if (text.includes('or linked')) return markTyped(new Error(UI_TEXT.teamFileLinked, { cause }))
  if (
    text.includes('invalid component') ||
    text.includes('invalid filename') ||
    text.includes('invalid path') ||
    text.includes('invalid request')
  )
    return markTyped(new Error(fill(UI_TEXT.teamFileCannotCreate, { path: remaining }), { cause }))
  if (
    text.includes('identity changed') ||
    text.includes('moved') ||
    text.includes('different device') ||
    text.includes('different mount') ||
    text.includes('name changed')
  )
    return markTyped(new Error(UI_TEXT.teamFileChanged, { cause }))
  const isMissing =
    cause.message === 'Governed command unavailable' ||
    (cause.cause instanceof Error && 'code' in cause.cause && cause.cause.code === 'ENOENT')
  return markTyped(
    new Error(isMissing ? UI_TEXT.teamFileHelperMissing : UI_TEXT.teamFileNativeFailed, { cause }),
  )
}

/**
 * Errno failures the create path can produce, as the typed copy-relative
 * sentence. The path's syscalls are lstat (the pre-checks), openat (the
 * helper's exclusive create and the reopen) and mkdirat (the helper's folders):
 * EEXIST means the name is occupied, every other code below means the create
 * itself cannot run. Any further string-coded failure takes the same sentence
 * through the backstop below, so no raw Node error ever reaches the worker.
 * Exported for the regression test, which pins every name.
 */
export const CREATE_ERRNOS: ReadonlySet<string> = new Set([
  'ENOTDIR',
  'ENAMETOOLONG',
  'EACCES',
  'EPERM',
  'ELOOP',
  'EINVAL',
  'ENOSPC',
  'EROFS',
  'EBUSY',
  'EISDIR',
  'EFAULT',
  'EFBIG',
  'EIO',
  'EMLINK',
  'EMFILE',
  'ENFILE',
  'ENODEV',
  'ENOMEM',
  'ENXIO',
  'EOVERFLOW',
  'ETXTBSY',
])

export function typedCreateError(error: unknown, relative: string): Error {
  if (isTyped(error)) return error
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    if (error.code === 'EEXIST')
      return markTyped(new Error(UI_TEXT.teamFileExists, { cause: error }))
    // Every name in CREATE_ERRNOS, and any coded failure beyond them.
    return markTyped(
      new Error(fill(UI_TEXT.teamFileCannotCreate, { path: relative }), { cause: error }),
    )
  }
  return error instanceof Error ? error : new Error(UI_TEXT.teamFileNativeFailed, { cause: error })
}

/** Counts below-ancestor folder components that do not exist, without creating anything. */
export async function countMissingFolders(
  p: PlatformPath,
  ancestorAbsolute: string,
  relative: string,
): Promise<number> {
  const parts = relative.split('/')
  parts.pop()
  let dir = ancestorAbsolute
  let missing = 0
  let hasSeenMissing = false
  for (const part of parts) {
    dir = p.join(dir, part)
    // Below a missing folder everything is missing; no check can change that.
    if (hasSeenMissing) {
      missing += 1
      continue
    }
    try {
      await lstat(dir)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing += 1
        hasSeenMissing = true
      } else throw typedCreateError(error, relative)
    }
  }
  return missing
}

/**
 * Best-effort removal of what a failed create made: the exact empty file
 * through the helper (which refuses anything changed or with content), then
 * at most createdFolders below-ancestor folders bottom-up with rmdir, each
 * only if still empty. Folders that predate the operation or arrived
 * concurrently are never ours to take. Never throws.
 */
export async function cleanupCreated(
  run: SweepRun,
  proof: WorkerCreateProof,
  absolute: string,
  identity: string | undefined,
  p: PlatformPath,
  createdFolders: number,
): Promise<void> {
  if (identity !== undefined) {
    try {
      await run(proof, 'worker-release', identity)
    } catch {
      /* Exact-state removal; refusal means changed, missing or gone. */
    }
  }
  try {
    const parts = proof.remaining.split('/')
    let dir = absolute
    const levels = Math.min(Math.max(createdFolders, 0), parts.length - 1)
    for (let count = 0; count < levels; count += 1) {
      dir = p.dirname(dir)
      try {
        await rmdir(dir)
      } catch {
        /* Still used, already gone, or out of our hands: leave it. */
      }
    }
  } catch {
    /* Never. */
  }
}

const liveHandles = new Map<string, WeakRef<WorkerFileHandle>>()

/** A created handle stays live while its reservation or writer holds it. */
export function trackCreated(identity: string, handle: WorkerFileHandle): void {
  liveHandles.set(identity, new WeakRef(handle))
}

export function forgetCreated(folder: string, relative: string, identity: string): void {
  liveHandles.delete(identity)
  void unrecordCreated(folder, relative, identity)
}

const reservationRecord = z.strictObject({
  folder: z.string(),
  reservations: z.array(z.strictObject({ relative: z.string(), identity: z.string() })),
})

function reservationRecordFile(folder: string): string {
  const digest = createHash('sha256').update(folder).digest('hex')
  return path.join(tmpdir(), 'muse-spark-code-worker-reservations', `${digest}.json`)
}

async function unrecordCreated(folder: string, relative: string, identity: string): Promise<void> {
  try {
    const file = reservationRecordFile(folder)
    const record = reservationRecord.parse(JSON.parse(await readFile(file, 'utf8')))
    if (record.folder !== folder) return
    const kept = record.reservations.filter(
      (entry) => !(entry.relative === relative && entry.identity === identity),
    )
    if (kept.length === record.reservations.length) return
    if (kept.length === 0) await rm(file)
    else await writeFile(file, JSON.stringify({ folder, reservations: kept }))
  } catch {
    /* Bookkeeping only; the file operation never depends on it. */
  }
}

export async function recordCreated(
  folder: string,
  relative: string,
  identity: string,
): Promise<void> {
  try {
    const file = reservationRecordFile(folder)
    let reservations: { readonly relative: string; readonly identity: string }[] = []
    try {
      const record = reservationRecord.parse(JSON.parse(await readFile(file, 'utf8')))
      if (record.folder === folder) reservations = [...record.reservations]
    } catch {
      /* A missing or foreign record starts fresh. */
    }
    if (reservations.every((entry) => entry.relative !== relative || entry.identity !== identity))
      reservations = [...reservations, { relative, identity }]
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ folder, reservations }))
  } catch {
    /* Bookkeeping only; the file operation never depends on it. */
  }
}

/**
 * Removes reservations this process recorded but never filled or released,
 * when the file is still the same empty single-link inode: the release
 * refuses anything changed or with content, and live reservations (whose
 * handle the process still holds) are never touched. Runs at the start of
 * the next file creation in the working copy. Never throws: entries it
 * cannot settle stay recorded for the next start.
 */
export async function sweepAbandonedReservations(
  folder: string,
  root: string,
  rootIdentity: string,
  p: PlatformPath,
  io: Pick<WorkerFenceIo, 'pathIdentity'>,
  run: SweepRun,
): Promise<void> {
  try {
    const file = reservationRecordFile(folder)
    const record = reservationRecord.parse(JSON.parse(await readFile(file, 'utf8')))
    if (record.folder !== folder || record.reservations.length === 0) return
    const kept: { readonly relative: string; readonly identity: string }[] = []
    for (const entry of record.reservations) {
      const parts = entry.relative.split('/')
      if (
        entry.relative === '' ||
        parts.includes('..') ||
        liveHandles.get(entry.identity)?.deref() !== undefined
      ) {
        kept.push(entry)
        continue
      }
      try {
        const absolute = p.join(root, ...parts)
        const ancestorAbsolute = p.dirname(absolute)
        const proof: WorkerCreateProof = {
          root,
          rootIdentity,
          ancestor: p.relative(root, ancestorAbsolute).split(p.sep).join('/'),
          ancestorIdentity: await io.pathIdentity(ancestorAbsolute),
          remaining: parts.at(-1) ?? '',
        }
        await run(proof, 'worker-release', entry.identity)
      } catch (error: unknown) {
        // A helper refusal means the file is changed or has content: the
        // record goes, the file stays. Anything else stays recorded.
        const failure = error instanceof Error ? error : undefined
        const stderr =
          failure !== undefined && 'stderr' in failure && typeof failure.stderr === 'string'
            ? failure.stderr
            : ''
        if (
          !stderr.includes('worker file helper refused') &&
          !(failure?.message.includes('worker file helper refused') ?? false)
        )
          kept.push(entry)
        continue
      }
      // Released, already gone, or never ours: the record goes either way.
    }
    try {
      if (kept.length === 0) await rm(file)
      else await writeFile(file, JSON.stringify({ folder, reservations: kept }))
    } catch {
      /* The next start retries what this one could not settle. */
    }
  } catch {
    /* A missing record is the common case. */
  }
}

const GIT_TIMEOUT_MS = 120_000
const GIT_MAX_BUFFER_MIB = 256

/** Binary-safe git through the governed contained launcher (first use loads it here). */
export function processTeamGit(platform: NodeJS.Platform): TeamGit {
  const fallbackEnv = workerEnvironment(process.env, platform)
  return async (args, cwd, input, env) => {
    try {
      const { stdout } = await execResourceFileBytes('contained', 'git', [...args], {
        env: env ?? fallbackEnv,
        cwd,
        input,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_MIB * BYTES_PER_MIB,
        windowsHide: true,
      })
      return new Uint8Array(stdout)
    } catch (error: unknown) {
      // A governor refusal (cap, memory, admission) stays typed; a git
      // failure becomes the TeamGitError the workspaces handle.
      if (
        error instanceof Error &&
        (('code' in error && (error.code === 'capRefused' || error.code === 'memoryLimit')) ||
          error.message === 'Resource admission unavailable')
      )
        throw error
      const stderr =
        error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : ''
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'number' ? error.code : 1
      throw new TeamGitError(code, stderr, args[0] ?? 'git')
    }
  }
}
