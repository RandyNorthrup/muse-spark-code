// How a Windows job helper's C# (`jobSource.ts`) becomes a file in the
// extension's storage: named by the source's digest, compiled once by
// Windows' .NET Framework compiler, moved into place, and the builds of
// earlier sources removed. M27's shell job assembly and M50's MCP launcher
// take the same steps with their own names and compiler options.

import path from 'node:path'
import type { RunProgram } from '../processTree'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { runBootstrap } from '../../core/bootstrapCommand'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { sameFile, statIdentity } from '../../core/fs/fileIdentity'
import { describeStoreError, isStoreErrorCode } from './storeErrors'
import { WINDOWS_FRAMEWORK_RELATIVE_PATH } from '../../shared/constants'

const SOURCE_EXTENSION = '.cs'
const DIGEST_LENGTH = 16

/** What the filesystem says about a helper a live process still has loaded. */
const HELD_JOB_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** A removal failure worth retiring later, once the holding process ends. */
function isHeldJobFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    HELD_JOB_CODES.has(error.code)
  )
}

/** One helper's build. */
export interface JobBuild {
  /** The file name before the source's digest. */
  readonly stem: string
  /** The compiled file's extension. */
  readonly extension: string
  /** The compiler's output type. */
  readonly outputType: 'exe' | 'library'
  /** Additional framework assemblies, resolved only under Windows' framework directory. */
  readonly references: readonly string[]
  /** Inbox WinRT metadata; never a downloaded SDK or a workspace assembly. */
  readonly windowsMetadata?: readonly string[]
  /** Recorder compilation receives only the OS root, never credentials. */
  readonly compilerEnvironment?: NodeJS.ProcessEnv
  /** What the log calls the built file. */
  readonly label: string
  /** Whether a built file is already at a path. */
  readonly isPresent: (file: string) => Promise<boolean>
}

// Add-Type starts PowerShell and discovers its Utility module before running
// this same compiler. On loaded Windows runners that startup can consume the
// process deadline. Compile directly, keeping that deadline and reporting
// stdout (where csc writes diagnostics), stderr and termination metadata.
const runCompiler: RunProgram = (file, args, env) =>
  runBootstrap(file, args, env, { isOutputReported: true })

/** The built file's name for this source (the whole C#, the shared half included). */
export function jobFileName(build: JobBuild, csharp: string): string {
  const digest = createHash('sha256').update(csharp).digest('hex').slice(0, DIGEST_LENGTH)
  return `${build.stem}${digest}${build.extension}`
}

/** Expand Windows 8.3 names without trusting a different object returned by resolution. */
export async function nativeJobPath(file: string): Promise<string> {
  const expected = await statIdentity(file)
  const resolved = await realpath(file)
  if (!sameFile(expected, await statIdentity(resolved)))
    throw new Error('Windows job helper native identity changed')
  return resolved
}

/** Compiles `csharp` to `target`. */
export async function compileJob(
  build: JobBuild,
  target: string,
  csharp: string,
  systemRoot: string,
  run: RunProgram = runCompiler,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const directory = await nativeJobPath(path.dirname(target))
  const destination = path.join(directory, path.basename(target))
  // Unique names, so two windows compiling at once never share a file.
  const stem = path.join(directory, randomUUID())
  const source = `${stem}${SOURCE_EXTENSION}`
  const output = `${stem}${build.extension}`
  const framework = path.win32.join(systemRoot, WINDOWS_FRAMEWORK_RELATIVE_PATH)
  try {
    await writeFile(source, csharp, 'utf8')
    await run(
      path.win32.join(framework, 'csc.exe'),
      [
        '/nologo',
        '/noconfig',
        '/utf8output',
        `/target:${build.outputType}`,
        ...['System.dll', 'System.Core.dll', ...build.references].map(
          (reference) => `/reference:${path.win32.join(framework, reference)}`,
        ),
        ...(build.windowsMetadata ?? []).map(
          (reference) =>
            `/reference:${path.win32.join(systemRoot, 'System32', 'WinMetadata', reference)}`,
        ),
        `/out:${output}`,
        source,
      ],
      // The framework compiler builds a helper of its own: absolute entries only, links followed.
      noWorkspaceChildEnvironment(
        'win32',
        build.compilerEnvironment ?? withoutCredentials(process.env),
        realpathSync,
      ),
    )
    try {
      await rename(output, destination)
    } catch (error: unknown) {
      // Another window put the same file in place first.
      if (!(await build.isPresent(destination))) {
        throw error
      }
    }
  } finally {
    await rm(source, { force: true })
    await rm(output, { force: true })
  }
}

/** M105 R2's lazy entry; callers read the shipped C# only on first recording use. */
export function screenRecordExecutable(deps: {
  readonly storageDir: string
  readonly systemRoot: string
  readonly readSource: () => Promise<string>
  readonly verifyTrustedPath: (file: string) => Promise<boolean>
  readonly run?: RunProgram
}): () => Promise<string | undefined> {
  const build: JobBuild = {
    stem: 'MuseSparkScreenRecord-',
    extension: '.exe',
    outputType: 'exe',
    references: [
      'System.Drawing.dll',
      'System.Windows.Forms.dll',
      'System.Runtime.dll',
      'System.Runtime.InteropServices.WindowsRuntime.dll',
    ],
    windowsMetadata: [
      'Windows.Foundation.winmd',
      'Windows.Graphics.winmd',
      'Windows.Media.winmd',
      'Windows.Storage.winmd',
    ],
    label: 'screen recorder',
    compilerEnvironment: { SystemRoot: deps.systemRoot },
    isPresent: async (file) => {
      try {
        const info = await stat(file)
        return info.isFile()
      } catch (error: unknown) {
        // Anything but a missing file is not this probe's to swallow.
        if (isStoreErrorCode(error, 'ENOENT')) {
          return false
        }
        throw error
      }
    },
  }
  let ready: Promise<string | undefined> | undefined
  return () =>
    (ready ??= (async () => {
      try {
        const source = await deps.readSource()
        const target = path.join(deps.storageDir, jobFileName(build, source))
        const compiler = path.win32.join(
          deps.systemRoot,
          WINDOWS_FRAMEWORK_RELATIVE_PATH,
          'csc.exe',
        )
        if (!(await deps.verifyTrustedPath(compiler))) return
        if (!(await build.isPresent(target))) {
          await compileJob(build, target, source, deps.systemRoot, deps.run)
        }
        if (!(await deps.verifyTrustedPath(target))) return
        // This identity check does not request a screen or open a microphone.
        // Recording availability is probed separately: latest-file import still
        // works on machines whose capture service is unavailable.
        const answer = await (deps.run ?? runCompiler)(
          target,
          ['--self-test'],
          // The self-test answers for its own binary: absolute entries only, links followed.
          noWorkspaceChildEnvironment('win32', { SystemRoot: deps.systemRoot }, realpathSync),
        )
        return answer.trim() === 'muse-spark-screen-record-ready' ? target : undefined
      } catch {
        // A compiler whose self-test fails offers no binary: no target.
        return
      }
    })())
}

/** A stale build waiting for its holding process to end. */
interface PendingStaleJob {
  readonly build: JobBuild
  readonly path: string
  /** The helper's current C#, so a downgrade never retires the live build. */
  readonly readSource: () => Promise<string>
}

const pendingStaleJobs = new Map<string, PendingStaleJob>()
const warnedStaleJobs = new Set<string>()

/**
The sweep's first failure that is not a held file, if any. A held file
goes pending for its process's exit instead of stopping the sweep.
*/
async function sweepStaleJobs(
  build: JobBuild,
  current: string,
  readSource: () => Promise<string>,
): Promise<unknown> {
  const directory = path.dirname(current)
  const currentName = path.basename(current)
  try {
    const names = await readdir(directory)
    for (const name of names) {
      if (name === currentName || !name.startsWith(build.stem) || !name.endsWith(build.extension)) {
        continue
      }
      const stale = path.join(directory, name)
      try {
        await rm(stale, { force: true })
      } catch (error: unknown) {
        // A build a live process has loaded retires when that process
        // ends; anything else stops the sweep and is said once below.
        if (!isHeldJobFile(error)) throw error
        pendingStaleJobs.set(stale, { build, path: stale, readSource })
      }
    }
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/**
Removes the builds of earlier sources beside `current`. One that a live
process still has loaded goes pending and retires when that process ends
(`retireStaleJobs`, on every job-helper child exit) instead of warning on
every start; anything else is said once and the helper still stands.
*/
export async function removeStaleJobs(
  build: JobBuild,
  current: string,
  log: (message: string) => void,
  readSource: () => Promise<string>,
): Promise<void> {
  const failure = await sweepStaleJobs(build, current, readSource)
  if (failure !== undefined) {
    log(`an earlier ${build.label} could not be removed yet (${describeStoreError(failure)})`)
  }
}

/** One pending build's retirement: undefined once retired or current again. */
async function retireOneSettled(pending: PendingStaleJob): Promise<unknown> {
  try {
    const source = await pending.readSource()
    if (jobFileName(pending.build, source) === path.basename(pending.path)) return undefined
    await rm(pending.path, { force: true })
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/**
Retires the builds a sweep found loaded: a freed file is removed, a file
still loaded waits for a later exit, and a file whose bytes are current
again is never removed. Silent, except one warning per file that fails
unforgivably.
*/
export async function retireStaleJobs(log: (message: string) => void): Promise<void> {
  const retired: PendingStaleJob[] = []
  for (const pending of pendingStaleJobs.values()) {
    const failure = await retireOneSettled(pending)
    const isUnforgiven = failure !== undefined && !isHeldJobFile(failure)
    if (failure === undefined || isUnforgiven) {
      retired.push(pending)
    }
    if (!isUnforgiven || warnedStaleJobs.has(pending.path)) {
      continue
    }
    warnedStaleJobs.add(pending.path)
    log(
      `an earlier ${pending.build.label} could not be removed yet (${describeStoreError(failure)})`,
    )
  }
  for (const pending of retired) {
    // A registration that landed mid-sweep is not ours to drop.
    if (pendingStaleJobs.get(pending.path) === pending) {
      pendingStaleJobs.delete(pending.path)
    }
  }
}
