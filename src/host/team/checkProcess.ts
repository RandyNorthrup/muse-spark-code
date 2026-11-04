// The check slots' process runner over the team's native process lifetime
// (M96c lane K): a check's shell, and the git calls that prepare its folder,
// are launched contained and journalled like every team child, so the window
// ends them with the team. `descendantsEnded` is the container's proof and
// nothing else: a Windows job proves it and a Linux scope proves it. A bare
// process group (macOS, Linux without a delegated scope) proves nothing; it says
// only `groupEnded`, enough for a folder never used again (M96c's rule stands:
// a folder whose processes are not proved ended is never reused).

import { setTimeout as delay } from 'node:timers/promises'
import type { TeamAttempt } from '../../shared/team'
import { fill } from '../../shared/l10n/text'
import { TEAM_LOAD_SAMPLE_MS, TEAM_PROCESS_MODEL_TEXT } from '../../shared/constants'
import type { CheckProcess } from './checkSlots'
import type { Retirement, TeamLaunchRequest, TeamProcessLifetime } from './processLifetime'

/** The journal's task id for a check's own launches. */
const CHECK_TASK_ID = 'team-check'
/** A check that ended without an exit code (stopped at its limit, or by its signal) failed. */
const EXIT_FAILED = 1
/** A launch that was never confirmed never ran its command; a busy machine earns it two more tries. */
const CHECK_LAUNCH_ATTEMPTS = 3

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && error.message === code

/**
A check's launch, on a machine under load. The command is held until its launch is confirmed, so one
that missed its confirmation never ran and can start again, as many as the safety limit allows.
With the host short of memory or processor time no check starts, and running work continues (M96
lane K): it waits to start for as long as it may run, or until the caller stops it.
*/
async function launchUnderLoad(
  lifetime: TeamProcessLifetime,
  launch: TeamLaunchRequest,
  timeoutMs: number,
  signal: AbortSignal | undefined,
) {
  const deadline = performance.now() + timeoutMs
  let attempts = 0
  for (;;) {
    signal?.throwIfAborted()
    try {
      attempts += 1
      return await lifetime.launch(launch)
    } catch (error: unknown) {
      if (hasCode(error, 'TEAM_HOST_BUSY')) {
        const left = deadline - performance.now()
        if (left <= 0) throw new Error(TEAM_PROCESS_MODEL_TEXT.hostCheckBusy, { cause: error })
        await delay(Math.min(left, TEAM_LOAD_SAMPLE_MS), undefined, { signal })
      } else if (
        !hasCode(error, 'TEAM_CONFIRMATION_TIMEOUT') ||
        attempts >= CHECK_LAUNCH_ATTEMPTS
      ) {
        throw error
      }
    }
  }
}

/** The lifetime's own failures are bare codes; a worker and a person read sentences. */
function checkFailureInWords(error: unknown): unknown {
  if (!(error instanceof Error) || !/^TEAM_[A-Z_]+$/u.test(error.message)) return error
  return new Error(fill(TEAM_PROCESS_MODEL_TEXT.hostCheckFailed, { code: error.message }), {
    cause: error,
  })
}

/** The proof a contained child's retirement gives the board: only a real OS container proves it. */
export function proofOf(
  confirmed: { readonly container: string },
  end: Pick<Retirement, 'descendants'>,
): TeamAttempt['retirement'] {
  if (end.descendants !== 'proved') return undefined
  if (confirmed.container === 'windowsJob') return { kind: 'proved', method: 'windowsJob' }
  return confirmed.container === 'linuxScope'
    ? { kind: 'proved', method: 'linuxCgroup' }
    : undefined
}

/** One contained run: stdout and stderr read together as the person's own terminal shows them. */
export function checkProcessOver(lifetime: TeamProcessLifetime): CheckProcess {
  const run: CheckProcess = async (request) => {
    request.signal?.throwIfAborted()
    const pieces: string[] = []
    const take = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      pieces.push(text)
      request.onOutput?.(text)
    }
    const contained = await launchUnderLoad(
      lifetime,
      {
        command: request.file,
        args: request.args,
        cwd: request.cwd,
        env: request.env,
        taskId: CHECK_TASK_ID,
        priority: 'belowNormal',
        // Read from the first byte: a check that ends at once must not lose its output.
        attach: (spawned) => {
          spawned.stdout.on('data', take)
          spawned.stderr.on('data', take)
          spawned.stdin.on('error', () => {
            // A command that never reads its input closes the pipe; the exit code speaks.
          })
          spawned.stdin.end(request.input)
        },
      },
      request.timeoutMs,
      request.signal,
    )
    const { child } = contained
    const exited = new Promise<number | null>((resolve) => {
      if (child.exitCode === null)
        child.once('exit', (exitCode) => {
          resolve(exitCode)
        })
      else resolve(child.exitCode)
    })
    // The limit and the caller's stop both end the wait for the exit; one retirement follows.
    const interrupt = new AbortController()
    const state = { isLimited: false }
    const limit = setTimeout(() => {
      state.isLimited = true
      interrupt.abort()
    }, request.timeoutMs)
    const stop = (): void => {
      interrupt.abort()
    }
    request.signal?.addEventListener('abort', stop, { once: true })
    try {
      // A caller that stopped while the launch was under way has already fired its signal.
      if (request.signal?.aborted === true) stop()
      const interrupted = new Promise<void>((resolve) => {
        if (interrupt.signal.aborted) resolve()
        else
          interrupt.signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
      })
      await Promise.race([exited, interrupted])
      const end = await contained.retire()
      const code = await exited
      const confirmation = await contained.confirmation
      if (state.isLimited) pieces.push(`\n${TEAM_PROCESS_MODEL_TEXT.hostCheckTimedOut}\n`)
      return {
        exitCode: code ?? EXIT_FAILED,
        output: pieces.join(''),
        descendantsEnded: proofOf(confirmation, end) !== undefined,
        groupEnded: end.groupGone === true,
      }
    } finally {
      clearTimeout(limit)
      request.signal?.removeEventListener('abort', stop)
    }
  }
  return async (request) => {
    try {
      return await run(request)
    } catch (error: unknown) {
      throw checkFailureInWords(error)
    }
  }
}
