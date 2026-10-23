import { PlanModeHold } from '../../core/review/planModeHold'
import { playbackTurnText } from '../../core/playback/playbackPrompt'
import { reviewTurnText } from '../../core/review/reviewPrompt'
import {
  createReviewCollector,
  reviewMarker,
  type ReviewCollectorDeps,
} from '../../host/review/reviewCollector'
import type { ReviewTurnFeatures } from '../../host/review/reviewBundle'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export interface RuntimeReviewDeps extends Omit<ReviewCollectorDeps, 'runGit'> {
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs: number | undefined,
    signal: AbortSignal,
  ) => Promise<string>
  readonly assertCurrent: () => void
  readonly isTrusted: () => boolean
  /** Selected catalog support for this backend's review path, checked at use. */
  readonly isAvailable: () => boolean
}

/** The existing Git collector, review prompt and Plan hold with portable owner lifetime. */
export function createRuntimeReview(deps: RuntimeReviewDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  const holds = new Set<PlanModeHold>()
  let closing: Promise<void> | undefined
  function isActive(): boolean {
    if (ending.signal.aborted || !deps.isTrusted() || !deps.isAvailable()) return false
    try {
      deps.assertCurrent()
      return true
    } catch {
      return false
    }
  }
  function check(): void {
    if (!isActive()) throw new Error(UI_TEXT.reviewCancelled)
  }
  const collect = createReviewCollector({
    workspaceRoot: deps.workspaceRoot,
    runGit: async (args, cwd, timeout) => {
      check()
      const output = await deps.runGit(args, cwd, timeout, ending.signal)
      check()
      return output
    },
    pickOne: async (...args) => {
      check()
      const chosen = await deps.pickOne(...args)
      check()
      return chosen
    },
  })
  const review: ReviewTurnFeatures = {
    collect: async (request, isStillAllowed) => {
      if (!isActive() || !isStillAllowed()) return { kind: 'cancelled' }
      const work = collect(request, () => isActive() && isStillAllowed())
      pending.add(work)
      try {
        const result = await work
        return !isActive() || !isStillAllowed() ? { kind: 'cancelled' } : result
      } finally {
        pending.delete(work)
      }
    },
    newMarker: () => {
      check()
      return reviewMarker()
    },
    turnText: (input) => {
      check()
      return reviewTurnText(input)
    },
    playbackText: () => {
      check()
      return playbackTurnText()
    },
    createHold: (holdDeps) => {
      check()
      const hold = new PlanModeHold({
        ...holdDeps,
        isCurrent: () => isActive() && holdDeps.isCurrent?.() !== false,
        onRestored: (outcome) => {
          holds.delete(hold)
          if (isActive()) holdDeps.onRestored(outcome)
        },
      })
      holds.add(hold)
      return hold
    },
  }
  return {
    review,
    dispose: (): Promise<void> => {
      ending.abort()
      for (const hold of holds) hold.release()
      closing ??= (async () => {
        await Promise.allSettled([
          ...pending,
          ...Array.from(holds, (hold) => hold.waitForModeChange()),
        ])
        holds.clear()
      })()
      return closing
    },
  }
}
