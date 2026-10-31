// The check slots' process runner over the team's native process lifetime
// (M96c lane K): a check's shell, and the git calls that prepare its folder,
// are launched contained and journalled like every team child, so the window
// ends them with the team. `descendantsEnded` is the container's proof and
// nothing else: a Windows job proves it and a Linux scope proves it, while a
// bare process group (macOS, Linux without a delegated scope) proves nothing,
// so its folder stays held until the person decides (the M96c rule).

import type { TeamAttempt } from '../../shared/team'
import { TEAM_PROCESS_MODEL_TEXT } from '../../shared/constants'
import type { CheckProcess } from './checkSlots'
import type { Retirement, TeamProcessLifetime } from './processLifetime'

/** The journal's task id for a check's own launches. */
const CHECK_TASK_ID = 'team-check'
/** A check that ended without an exit code (stopped at its limit, or by its signal) failed. */
const EXIT_FAILED = 1

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
  return async (request) => {
    request.signal?.throwIfAborted()
    const pieces: string[] = []
    const take = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      pieces.push(text)
      request.onOutput?.(text)
    }
    const contained = await lifetime.launch({
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
    })
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
      }
    } finally {
      clearTimeout(limit)
      request.signal?.removeEventListener('abort', stop)
    }
  }
}
