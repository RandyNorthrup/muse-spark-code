import { JUDGE_REQUEST_TIMEOUT_MS } from '../../../shared/constants'
import { type JudgeEntryHandle, type JudgeEntryStore, type JudgeReadyOutcome } from '../entries'

/** M91/Z provide real captures or separately measured deadlines, never guessed wire fields. */
export interface JudgeFenceEvidence {
  readonly kind: 'captured-pre-execution' | 'measured-deadline'
  readonly receipt: string
  readonly pairedM75Receipt: string
  readonly deadlineMs: number
}

export type JudgeFencePosition = 'reviewer-held' | 'card-held' | 'immediate' | 'native'

/** Phase-1 positions never wait. Immediate/native actions need their own certified fence. */
export function canStartJudgeAtFence(
  position: JudgeFencePosition,
  evidence: JudgeFenceEvidence | undefined,
): boolean {
  return (
    position === 'reviewer-held' ||
    position === 'card-held' ||
    (evidence !== undefined &&
      evidence.receipt.trim() !== '' &&
      evidence.pairedM75Receipt.trim() !== '' &&
      Number.isSafeInteger(evidence.deadlineMs) &&
      evidence.deadlineMs > 0 &&
      evidence.deadlineMs <= JUDGE_REQUEST_TIMEOUT_MS)
  )
}

export interface JudgeDeadlineDeps {
  readonly evidence: JudgeFenceEvidence | undefined
  readonly signal: AbortSignal
  /** Rebind exact action, owner, source and policy after the wait. */
  readonly isCurrent: () => boolean
  readonly run: (signal: AbortSignal) => Promise<unknown>
}

/**
Future pre-execution seam. Never wired on this base. A hard timer wins
even when a source ignores abort; the generation-bound store drops late
callbacks. A missing/failed/expired result is no opinion, never ALLOW.
*/
export async function readJudgeAtDeadline(
  store: JudgeEntryStore,
  handle: JudgeEntryHandle,
  deps: JudgeDeadlineDeps,
): Promise<JudgeReadyOutcome | undefined> {
  if (
    !canStartJudgeAtFence('immediate', deps.evidence) ||
    deps.evidence === undefined ||
    deps.signal.aborted ||
    !deps.isCurrent()
  ) {
    store.discard(handle)
    return undefined
  }
  const timeoutMs = deps.evidence.deadlineMs
  const deadline = Date.now() + timeoutMs
  const stop = new AbortController()
  return await new Promise<JudgeReadyOutcome | undefined>((resolve) => {
    const finish = (outcome: JudgeReadyOutcome | undefined): void => {
      clearTimeout(timer)
      deps.signal.removeEventListener('abort', cancelled)
      store.discard(handle)
      stop.abort()
      resolve(outcome)
    }
    const cancelled = (): void => {
      finish(undefined)
    }
    const timer = setTimeout(cancelled, timeoutMs)
    deps.signal.addEventListener('abort', cancelled, { once: true })
    const receive = (outcome: unknown): void => {
      if (stop.signal.aborted) {
        return
      }
      if (Date.now() >= deadline || deps.signal.aborted || !deps.isCurrent()) {
        finish(undefined)
        return
      }
      store.settle(handle, outcome === 'caution' || outcome === 'none' ? outcome : 'failed')
      finish(store.readLatch(handle))
    }
    // A synchronous source failure follows the same no-opinion path.
    try {
      void deps.run(stop.signal).then(receive).catch(cancelled)
    } catch {
      cancelled()
    }
  })
}
