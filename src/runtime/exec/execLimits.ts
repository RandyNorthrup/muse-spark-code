import {
  EXEC_FORCE_WRITE_MS,
  EXEC_SIGNAL_DEDUP_MS,
  EXEC_STOP_GRACE_MS,
  UI_TEXT,
} from '../../shared/constants'
import { exitCodeFor, type ExecSignal, type ExecStatus } from './execProtocol'

export type StopCause =
  | { kind: 'signal'; signal: ExecSignal }
  | {
      kind:
        | 'timeout'
        | 'denied'
        | 'output_closed'
        | 'output_stalled'
        | 'internal'
        | 'budget'
        | 'requests'
        | 'unpriced'
        | 'request_shape'
        | 'accounting_invalid'
        | 'breach'
    }
export interface StopLatch {
  readonly cause: StopCause | null
  latch(cause: StopCause): boolean
}
export interface Lifecycle extends StopLatch {
  readonly signal: AbortSignal
  readonly stopped: Promise<StopCause>
  readonly deadlineMs: number
  race<T>(waiting: Promise<T>): Promise<T>
  remainingGraceMs(): number
  forceExit(code: number): never
  dispose(): void
}

export function statusForStop(cause: StopCause): ExecStatus {
  switch (cause.kind) {
    case 'signal': {
      return 'cancelled'
    }
    case 'timeout': {
      return 'timeout'
    }
    case 'denied': {
      return 'denied'
    }
    case 'requests': {
      return 'request_cap'
    }
    case 'budget':
    case 'unpriced':
    case 'request_shape':
    case 'breach': {
      return 'budget_exceeded'
    }
    case 'accounting_invalid': {
      return 'accounting_unverified'
    }
    case 'output_closed':
    case 'output_stalled':
    case 'internal': {
      return 'internal'
    }
  }
}

export function createLifecycle(input: {
  processStartMs: number
  timeoutMs: number
  now: () => number
  setTimer: (ms: number, run: () => void) => () => void
  onSignal: (signal: ExecSignal, run: () => void) => () => void
  forceFinish: (cause: StopCause) => void
  exit: (code: number) => never
}): Lifecycle {
  const controller = new AbortController()
  const deadlineMs = input.processStartMs + input.timeoutMs
  let cause: StopCause | null = null
  const stopped = new Promise<StopCause>((resolve) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        if (cause !== null) resolve(cause)
      },
      { once: true },
    )
  })
  let stoppedAt: number | undefined
  let lastSignal: { signal: ExecSignal; time: number } | undefined
  let isForced = false
  const removers: (() => void)[] = []
  const latch = (next: StopCause) => {
    if (cause !== null) return false
    cause = next
    stoppedAt = input.now()
    controller.abort(next)
    return true
  }
  const receive = (signal: ExecSignal) => {
    const now = input.now()
    if (lastSignal?.signal === signal && now - lastSignal.time < EXEC_SIGNAL_DEDUP_MS) return
    if (lastSignal === undefined) {
      lastSignal = { signal, time: now }
      latch({ kind: 'signal', signal })
      return
    }
    if (isForced) return
    isForced = true
    input.forceFinish(cause ?? { kind: 'signal', signal })
    const first = cause ?? { kind: 'signal', signal }
    removers.push(
      input.setTimer(EXEC_FORCE_WRITE_MS, () =>
        input.exit(
          exitCodeFor(statusForStop(first), first.kind === 'signal' ? first.signal : null),
        ),
      ),
    )
  }
  removers.push(
    input.setTimer(Math.max(0, deadlineMs - input.now()), () => {
      latch({ kind: 'timeout' })
    }),
  )
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    removers.push(
      input.onSignal(signal, () => {
        receive(signal)
      }),
    )
  return {
    get cause() {
      return cause
    },
    signal: controller.signal,
    stopped,
    deadlineMs,
    latch,
    race(waiting) {
      // Attach to the awaited operation even when stop already won: late
      // setup failures cannot become unhandled rejections or change the latch.
      if (cause !== null) {
        void waiting.catch(() => {
          /* First stop wins; consume the late setup rejection. */
        })
        return Promise.reject(new Error(UI_TEXT.execInterrupted, { cause }))
      }
      const interruption = (async () => {
        const why = await stopped
        throw new Error(UI_TEXT.execInterrupted, { cause: why })
      })()
      return Promise.race([waiting, interruption])
    },
    remainingGraceMs() {
      return Math.max(
        0,
        EXEC_STOP_GRACE_MS - (stoppedAt === undefined ? 0 : input.now() - stoppedAt),
      )
    },
    forceExit: input.exit,
    dispose() {
      for (const remove of removers) remove()
      removers.length = 0
    },
  }
}
