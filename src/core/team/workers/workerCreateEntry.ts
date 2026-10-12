// First-use native creation. The host retains the sole root-grant authority.
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { pathModule } from '../../workspaceRoot'
import { windowsPathProblem } from '../../windowsPathSpelling'
import { powerShellQuoted } from '../../shellQuote'
import { execResourceFile } from '../../resources/launcher'
import { resourceWindowsJob } from '../../resources/admission'
import { scrubWorkerEnv } from './workerEnv'
import type { WorkerFenceIo, WorkerFileHandle, WorkerPathInput } from './workerFence'
import type { UiText } from '../../../shared/l10n/en'
import { fill, setUiText } from '../../../shared/l10n/text'

import type * as WorkerAuthority from './workerFence'

type Authority = Pick<
  typeof WorkerAuthority,
  'confineWorkerPath' | 'isCheckedWorkerWriteAllowed' | 'recheckWorkerRoot' | 'withWorkerFile'
>
import type { WorkerRolePolicy } from './workerTypes'
import {
  UI_TEXT,
  WORKER_FILE_PATH_TIMEOUT_MS,
  WORKER_NATIVE_REPLY_MAX_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'

const receipt = z.strictObject({
  identity: z.string().check(z.regex(/^\d+:\d+$/)),
  createdFolders: z.number().check(z.int(), z.minimum(0)),
})

export interface WorkerCreateProof {
  readonly root: string
  readonly rootIdentity: string
  readonly ancestor: string
  readonly ancestorIdentity: string
  readonly remaining: string
}

/**
 * The helper runs through resource admission under the contained profile, one
 * launch per file operation: the whole operation goes to a single helper
 * invocation with its arguments as an array. No compiler, pathname fallback,
 * credential or shell payload. A refused admission is a typed refusal.
 */
async function nativeOperation(proof: WorkerCreateProof, op: string, identity = '') {
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

/** A refusal this module already typed keeps its sentence on the way out. */
function markTyped(error: Error): Error {
  return Object.assign(error, { typedCreateRefusal: true })
}

function isTyped(error: unknown): error is Error {
  return (
    error instanceof Error && 'typedCreateRefusal' in error && error.typedCreateRefusal === true
  )
}

/** Every helper or launcher failure as the typed sentence the worker reports. */
function mapNativeError(error: unknown, remaining: string): Error {
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

/** Errno failures the create path can produce, as the typed copy-relative sentence. */
const CREATE_ERRNOS = new Set([
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
])

function typedCreateError(error: unknown, relative: string): Error {
  if (isTyped(error)) return error
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    CREATE_ERRNOS.has(error.code)
  )
    return markTyped(
      new Error(fill(UI_TEXT.teamFileCannotCreate, { path: relative }), { cause: error }),
    )
  return error instanceof Error ? error : new Error(UI_TEXT.teamFileNativeFailed, { cause: error })
}

/** Counts below-ancestor folder components that do not exist, without creating anything. */
async function countMissingFolders(
  p: ReturnType<typeof pathModule>,
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
 * the below-ancestor folders bottom-up, each only if still empty. rmdir
 * removes empty folders only, and every component below the admitted
 * ancestor was absent at preflight, so nothing else can go. Never throws.
 */
async function cleanupCreated(
  run: NonNullable<WorkerFenceIo['workerNativeOperation']>,
  proof: WorkerCreateProof,
  absolute: string,
  identity: string | undefined,
  p: ReturnType<typeof pathModule>,
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
    for (let index = parts.length - 1; index > 0; index -= 1) {
      dir = p.dirname(dir)
      try {
        await rm(dir, { recursive: false })
      } catch {
        /* Still used, already gone, or out of our hands: leave it. */
      }
    }
  } catch {
    /* Never. */
  }
}

const liveHandles = new Map<string, WeakRef<WorkerFileHandle>>()

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

async function recordCreated(folder: string, relative: string, identity: string): Promise<void> {
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
  p: ReturnType<typeof pathModule>,
  io: Pick<WorkerFenceIo, 'pathIdentity'>,
  run: NonNullable<WorkerFenceIo['workerNativeOperation']>,
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

/** A missing suffix is admitted against its existing ancestor before any creation. */
export async function createWorkerFile(
  input: WorkerPathInput,
  absolute: string,
  role: WorkerRolePolicy,
  rootIdentity: string,
  authority: Authority,
  table: UiText,
  locale: string,
): Promise<WorkerFileHandle> {
  setUiText(table, locale)
  if (input.grant === undefined || input.io.openFile === undefined)
    throw new Error(UI_TEXT.teamFileHelperMissing)
  const { confineWorkerPath, isCheckedWorkerWriteAllowed, recheckWorkerRoot, withWorkerFile } =
    authority
  const grant = input.grant
  const root = await recheckWorkerRoot(input, grant)
  const p = pathModule(input.platform)
  // A reservation this process recorded but never filled or released is
  // removed here when still empty and unchanged; live ones are skipped.
  await sweepAbandonedReservations(
    input.folder,
    root,
    rootIdentity,
    p,
    input.io,
    input.io.workerNativeOperation ?? nativeOperation,
  )
  if (windowsPathProblem(absolute, input.platform, root) !== undefined)
    throw new Error(UI_TEXT.teamFileOutside)
  const relative = p.relative(root, absolute).split(p.sep).join('/')
  if (relative === '' || relative.split('/').includes('..') || p.isAbsolute(relative))
    throw new Error(UI_TEXT.teamFileOutside)
  let ancestor = p.dirname(absolute)
  for (;;) {
    const target = await confineWorkerPath(input, ancestor)
    if (target.ok) {
      if (p.relative(ancestor, target.checkedAbsolute) !== '')
        throw new Error(UI_TEXT.teamFileLinked)
      const remaining = p.relative(ancestor, absolute).split(p.sep).join('/')
      const canonical = [target.canonical, remaining].filter(Boolean).join('/')
      if (!isCheckedWorkerWriteAllowed(role, { ...target, relative, canonical }))
        throw new Error(UI_TEXT.teamFileRoleDenied)
      // A dangling symlink is not a missing path, and neither is a device.
      try {
        await lstat(absolute)
        throw new Error(UI_TEXT.teamFileExists)
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw typedCreateError(error, relative)
      }
      const proof: WorkerCreateProof = {
        root,
        rootIdentity,
        ancestor: target.canonical,
        ancestorIdentity: await input.io.pathIdentity(target.checkedAbsolute),
        remaining,
      }
      const run = input.io.workerNativeOperation ?? nativeOperation
      // Missing folders are counted without creating anything, so the write
      // guard approves the operation before any mutation. The single create
      // below is the only helper launch of this file operation.
      const predicted = await countMissingFolders(p, target.checkedAbsolute, remaining)
      await input.beforeCreate?.(predicted)
      await recheckWorkerRoot(input, grant)
      let created: { readonly identity: string; readonly createdFolders: number }
      try {
        created = receipt.parse(await run(proof, 'worker-create'))
      } catch (error: unknown) {
        await cleanupCreated(run, proof, absolute, undefined, p)
        throw mapNativeError(error, remaining)
      }
      let opened: Awaited<ReturnType<NonNullable<typeof input.io.openFile>>>
      try {
        opened = await input.io.openFile(absolute, true)
      } catch (error: unknown) {
        await cleanupCreated(run, proof, absolute, created.identity, p)
        throw typedCreateError(error, relative)
      }
      await recordCreated(input.folder, relative, created.identity)
      let isReserved = false
      const check = async () => {
        const current = await opened.identify()
        if (current.identity !== created.identity || p.relative(current.absolute, absolute) !== '')
          throw new Error(UI_TEXT.teamFileChanged)
        await recheckWorkerRoot(input, grant)
        return current
      }
      const forget = (): void => {
        liveHandles.delete(created.identity)
        void unrecordCreated(input.folder, relative, created.identity)
      }
      liveHandles.set(created.identity, new WeakRef(opened))
      try {
        await check()
      } catch (error: unknown) {
        try {
          await opened.close()
        } catch {
          /* The descriptor is already gone; cleanup still runs. */
        }
        await cleanupCreated(run, proof, absolute, created.identity, p)
        forget()
        throw error
      }
      const handle: WorkerFileHandle = {
        ...opened,
        identify: check,
        write: async (content) => {
          await check()
          try {
            await opened.write(content)
          } catch (error: unknown) {
            // A failed first write leaves no empty file or folders behind;
            // the exact-state release refuses anything with content.
            await cleanupCreated(run, proof, absolute, created.identity, p)
            forget()
            throw error
          }
        },
        close: async () => {
          if (isReserved) return
          forget()
          await opened.close()
        },
        reserve: () => {
          isReserved = true
          let isFinished = false
          let isSettled = false
          const finish = async (): Promise<void> => {
            if (isFinished) return
            isFinished = true
            // Every unsettled terminal path attempts the exact-state cleanup:
            // the release refuses a changed or nonempty file, and rmdir
            // removes only folders that are still empty.
            if (!isSettled) await cleanupCreated(run, proof, absolute, created.identity, p)
            forget()
            await opened.close()
          }
          return {
            fill: async (bytes) => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                } catch {
                  return 'changed'
                }
                const outcome = await withWorkerFile(
                  { ...input, io: { ...input.io, openFile: () => Promise.resolve(handle) } },
                  absolute,
                  false,
                  async (_file, target) => {
                    if (!isCheckedWorkerWriteAllowed(role, target))
                      throw new Error(UI_TEXT.teamFileRoleDenied)
                    if (opened.readBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    try {
                      await opened.readBytes(0)
                    } catch {
                      return 'changed'
                    }
                    // Binary bytes use a verified existing descriptor, never a path reopen.
                    if (opened.writeBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    await check()
                    await opened.writeBytes(bytes)
                    return 'done'
                  },
                  role,
                )
                if (outcome === 'done') isSettled = true
                return outcome
              } finally {
                await finish()
              }
            },
            release: async () => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                  if (opened.readBytes === undefined) throw new Error(UI_TEXT.teamFileHelperMissing)
                  await opened.readBytes(0)
                } catch {
                  return 'changed'
                }
                await run(proof, 'worker-release', created.identity)
                isSettled = true
                return 'done'
              } finally {
                await finish()
              }
            },
          }
        },
      }
      return handle
    }
    const parent = p.dirname(ancestor)
    if (parent === ancestor || ancestor === root) throw new Error(UI_TEXT.teamFileOutside)
    ancestor = parent
  }
}
