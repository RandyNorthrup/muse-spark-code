// Windows conversion inside a kernel job (M105 lane VB). The encoder starts
// through M50's compiled job launcher (`spawnMcpJob`): created suspended and
// already a member of a no-breakaway, kill-on-close job (its job list at
// creation) whose JOB_OBJECT_LIMIT_JOB_MEMORY is the conversion's memory cap
// (M91b's `jobMemoryLimit`), and only then resumed, so the kernel bounds
// everything the encoder starts from its first instruction. No sampler, and
// no PowerShell per launch: the launcher is compiled once per source version.
// Ending the launcher closes the job's only handle, which ends every process
// in it. This is `convert.ts`'s `memoryLimitedRun` port; output size,
// deadline and cancellation are enforced here.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import {
  MEDIA_CONVERSION_JOB_FAILED_CODE,
  MEDIA_CONVERSION_MEMORY_CAP_CODE,
  MEDIA_CONVERSION_SAMPLE_TIMEOUT_MS,
  MEDIA_CONVERSION_WATCHDOG_INTERVAL_MS,
} from '../../shared/constants'
import { spawnMcpJob, type McpJobLaunch } from './mcpJobLaunch'
import type { GuardedChildEnv } from '../../core/executables'

/** What every encoder launch enforces (structurally `convert.ts`'s `LimitedRunOptions`). */
export interface JobEncoderRunOptions {
  readonly cwd: string
  readonly env: GuardedChildEnv
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly outputPath: string
  readonly maxOutputBytes: number
  /** The job's memory cap in bytes; it must be positive (0 would set no limit). */
  readonly maxRssBytes: number
}

export interface JobEncoderRunDeps {
  /** The prepared M50 launcher (`mcpJobExecutable`); undefined refuses, never an unbounded launch. */
  readonly jobExecutable: () => Promise<string | undefined>
  /** The launcher's spawn (tests); production uses `spawnMcpJob`. */
  readonly spawnJob?: (launch: McpJobLaunch) => ChildProcessWithoutNullStreams
  /** The output's stat (tests); production uses `lstat`. */
  readonly statOutput?: (file: string) => Promise<OutputStat>
}

/** What the output check reads of the encoder's output file. */
export interface OutputStat {
  isFile(): boolean
  readonly size: number
}

/** The limits the M109 attested launcher's RESULT record names as enforced. */
export type ConversionJobLimit = 'activeProcess' | 'jobMemory' | 'processMemory'

/** Every refusal and failure: a fixed message, no path, no OS or encoder output. */
export class ConversionJobFailed extends Error {
  constructor(
    readonly code:
      typeof MEDIA_CONVERSION_JOB_FAILED_CODE | typeof MEDIA_CONVERSION_MEMORY_CAP_CODE,
  ) {
    super(
      code === MEDIA_CONVERSION_MEMORY_CAP_CODE
        ? 'The encoder reached its memory cap'
        : 'The encoder job failed',
    )
  }
}

/**
The M109 seam: the one place a job's ending becomes media's failure. Once
the attested launcher's RESULT record reports `jobMemory`, the conversion
fails as `EMEDIA_MEMORY_CAP`; everything else is a plain job failure.
*/
export function conversionJobFailure(
  enforcedLimits: readonly ConversionJobLimit[],
): ConversionJobFailed {
  return new ConversionJobFailed(
    enforcedLimits.includes('jobMemory')
      ? MEDIA_CONVERSION_MEMORY_CAP_CODE
      : MEDIA_CONVERSION_JOB_FAILED_CODE,
  )
}

/** M50's launcher reports only the exit code, so no limit is ever named as hit (M109 adds it). */
const M50_LAUNCHER_LIMITS: readonly ConversionJobLimit[] = []

function ignore(): void {
  // Nothing to record: the launcher's close decides the outcome.
}

/** Read afresh at each call: an await can abort the signal between checks. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isLaunchable(command: string, options: JobEncoderRunOptions): boolean {
  return (
    path.win32.isAbsolute(command) &&
    path.win32.isAbsolute(options.cwd) &&
    path.win32.isAbsolute(options.outputPath) &&
    [options.maxRssBytes, options.maxOutputBytes, options.timeoutMs].every((value) =>
      isPositiveSafeInteger(value),
    )
  )
}

/**
One output check, bounded like conversion's resource samples: a stat that
does not answer in time (a stalled share, a hung redirected folder) is a
failed check, so cancellation, the deadline and close always settle.
*/
async function isOutputWithinCap(
  options: JobEncoderRunOptions,
  statOutput: (file: string) => Promise<OutputStat>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>((settle) => {
    timer = setTimeout(() => {
      settle(false)
    }, MEDIA_CONVERSION_SAMPLE_TIMEOUT_MS)
  })
  const read = (async () => {
    try {
      const output = await statOutput(options.outputPath)
      return output.isFile() && output.size <= options.maxOutputBytes
    } catch {
      return false
    }
  })()
  try {
    return await Promise.race([read, late])
  } finally {
    clearTimeout(timer)
  }
}

function runInJob(
  launch: McpJobLaunch,
  options: JobEncoderRunOptions,
  deps: Required<Pick<JobEncoderRunDeps, 'spawnJob' | 'statOutput'>>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = deps.spawnJob(launch)
    } catch {
      reject(conversionJobFailure(M50_LAUNCHER_LIMITS))
      return
    }
    let hasFailed = false
    let hasClosed = false
    let hasSettled = false
    let check: Promise<void> | undefined
    let watcher: FSWatcher | undefined
    const stop = () => {
      hasFailed = true
      // The launcher's end closes the job, and kill-on-close ends the encoder's tree.
      if (!hasClosed) child.kill()
    }
    const checkOutput = () => isOutputWithinCap(options, deps.statOutput)
    const requestCheck = () => {
      if (check !== undefined || hasClosed || hasFailed) return
      check = (async () => {
        if (!(await checkOutput())) stop()
        check = undefined
      })()
    }
    const watchdog = setInterval(requestCheck, MEDIA_CONVERSION_WATCHDOG_INTERVAL_MS)
    const deadline = setTimeout(stop, options.timeoutMs)
    const finish = (code: number | null) => {
      if (hasSettled) return
      hasSettled = true
      hasClosed = true
      watcher?.close()
      clearInterval(watchdog)
      clearTimeout(deadline)
      options.signal?.removeEventListener('abort', stop)
      void (async () => {
        // Both checks are bounded: a stalled stat cannot hold the run open.
        await check
        // A successful exit still answers for its final output.
        if (!hasFailed && code === 0 && !(await checkOutput())) hasFailed = true
        if (hasFailed || code !== 0) reject(conversionJobFailure(M50_LAUNCHER_LIMITS))
        else resolve()
      })()
    }
    // The encoder's own output never reaches a log (it can name paths); a
    // broken pipe is the close below, not an error of its own.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', ignore)
    child.stdout.resume()
    child.stderr.resume()
    child.stdin.end()
    child.once('error', () => {
      stop()
      if (child.pid === undefined) finish(null)
    })
    child.once('close', finish)
    try {
      watcher = watch(options.cwd, requestCheck)
      watcher.on('error', stop)
    } catch {
      stop()
    }
    options.signal?.addEventListener('abort', stop, { once: true })
    if (options.signal?.aborted === true) stop()
    requestCheck()
  })
}

/**
`convert.ts`'s `memoryLimitedRun` on Windows: one encoder run in a fresh
kernel job capped at `maxRssBytes`, its output size and deadline enforced,
and the launcher's close awaited. Any refusal or failure rejects with
`ConversionJobFailed`; a missing launcher refuses before anything starts.
*/
export function jobMemoryLimitedRun(
  deps: JobEncoderRunDeps,
): (command: string, args: readonly string[], options: JobEncoderRunOptions) => Promise<void> {
  const launcher = {
    spawnJob: deps.spawnJob ?? spawnMcpJob,
    statOutput: deps.statOutput ?? lstat,
  }
  return async (command, args, options) => {
    if (!isLaunchable(command, options) || isAborted(options.signal))
      throw conversionJobFailure(M50_LAUNCHER_LIMITS)
    let executablePath: string | undefined
    try {
      executablePath = await deps.jobExecutable()
    } catch {
      executablePath = undefined
    }
    // Cancellation may have arrived while the launcher was prepared.
    if (executablePath === undefined || isAborted(options.signal))
      throw conversionJobFailure(M50_LAUNCHER_LIMITS)
    await runInJob(
      {
        executablePath,
        file: command,
        args,
        isVerbatim: false,
        cwd: options.cwd,
        env: options.env,
        jobMemoryLimit: options.maxRssBytes,
        // Fixed failure only: the launcher's own error ends as a non-zero exit.
        log: ignore,
      },
      options,
      launcher,
    )
  }
}
