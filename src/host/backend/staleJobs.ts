// A Windows job helper's builds beside the live one: named by the
// source's digest, swept after each preparation, and retired when the
// process holding one ends. A leaf module: the child-exit hook
// (`mcpJobLaunch.ts`) calls in here, so nothing in here may reach back
// toward the process tree.
import { createHash } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { describeStoreError } from './storeErrors'

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

/** The built file's name for this source (the whole C#, the shared half included). */
export function jobFileName(build: JobBuild, csharp: string): string {
  const digest = createHash('sha256').update(csharp).digest('hex').slice(0, DIGEST_LENGTH)
  return `${build.stem}${digest}${build.extension}`
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
