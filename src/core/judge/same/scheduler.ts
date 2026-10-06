// The same-model judge's background scheduling (M98 lane S, PLAN.md D77): all
// pending questions over one state go in one call, calls run in the
// background, a result that arrives after its fence has passed is dropped
// unused, and the judge is never awaited on a user path (Muse Spark is never
// awaited). The fence owns staleness through lane J's entry store: settling
// an unknown, consumed or discarded key reports false and changes nothing,
// so the scheduled task settles and then caches only while its entry stands.
// Pure scheduling; no `vscode` import.

export interface BackgroundJudgeOptions {
  /** One judge call never runs longer than this (lane 0). */
  readonly timeoutMs: number
  /** Logs the failure; the entry is settled `failed` by the task itself. */
  readonly onError: (error: unknown) => void
}

/**
 * Run one judge call in the background and return at once: the caller never
 * waits on it. The call is aborted past the timeout; a throw out of the call
 * is reported and never escapes, so a pending judge neither holds the process
 * open nor surfaces an unhandled rejection.
 */
export function runJudgeInBackground(
  call: (signal: AbortSignal) => Promise<void>,
  options: BackgroundJudgeOptions,
): void {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('judge background calls need a positive timeout')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs)
  // A pending judge never holds the process open on its own.
  const nodeTimer = timer as unknown as { unref?: () => void }
  nodeTimer.unref?.()
  void call(controller.signal)
    .catch((error: unknown) => {
      options.onError(error)
    })
    .finally(() => {
      clearTimeout(timer)
    })
}
