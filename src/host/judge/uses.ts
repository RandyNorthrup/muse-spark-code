// M98 FU's passive host seam. Z injects a real request-only source and
// certified B/M75 policy; absent injection performs no work or paid prompt.
import type { ReviewRequest } from '../../core/backends/modelapi/autoReviewer'
import type { JudgeRuntime } from '../../core/judge/engine'
import type { CoreLogger } from '../../core/logging'
import { entryKey, type JudgeEntryParts, type JudgeReadyOutcome } from '../../core/judge/entries'
import { judgeRequestSchema, type JudgeQuestion } from '../../core/judge/schema'
import { judgeUseAdvice } from '../../core/judge/uses/advice'
import {
  admitJudgeUse,
  isSameUseIdentity,
  type JudgeUsePolicy,
} from '../../core/judge/uses/definitions'

export interface JudgeCautionLatch {
  /** Synchronous read consuming this holder only; never a promise or an ALLOW answer. */
  read(): boolean
  discard(): void
}

export interface JudgeReviewInput {
  readonly action: JudgeEntryParts
  readonly state: ReviewRequest
}

/** Injected into the conversation/reviewer; immediate allows never call it. */
export interface JudgeReviewUses {
  startReview(input: JudgeReviewInput, signal: AbortSignal): JudgeCautionLatch | undefined
}

export interface JudgeReviewUsesDeps {
  readonly runtime: JudgeRuntime
  readonly log?: CoreLogger | undefined
  readonly policy: () => JudgeUsePolicy
  /** Fresh object on any source/owner/policy/generation change, including change-back. */
  readonly binding: () => object
  /** P0/Z supply model wording from its declared lazy MODEL_TEXT block. */
  readonly question: () => JudgeQuestion
  readonly redact: (text: string) => string
}

interface SharedReview {
  readonly stop: AbortController
  readonly isCurrent: () => boolean
  holders: number
  outcome: JudgeReadyOutcome | 'failed' | undefined
}

export class JudgeUses implements JudgeReviewUses {
  private readonly entries = new Map<string, SharedReview>()

  public constructor(private readonly deps: JudgeReviewUsesDeps) {}

  private discardEntry(key: string, entry: SharedReview): void {
    if (this.entries.get(key) === entry) {
      this.entries.delete(key)
    }
    entry.stop.abort()
  }

  public startReview(input: JudgeReviewInput, signal: AbortSignal): JudgeCautionLatch | undefined {
    const policy = this.deps.policy()
    if (signal.aborted || policy.use !== 'review-signal' || !policy.isOn) {
      return undefined
    }
    const question = this.deps.question()
    const request = judgeRequestSchema.safeParse({
      state: this.deps.redact(JSON.stringify(input.state)),
      questions: { review: question },
    })
    if (!request.success) {
      return undefined
    }
    const admission = admitJudgeUse(policy, question)
    if (!admission.admitted) {
      return undefined
    }
    const binding = this.deps.binding()
    const isCurrent = (): boolean => {
      const current = this.deps.policy()
      return (
        binding === this.deps.binding() &&
        current.use === policy.use &&
        isSameUseIdentity(current.identity, policy.identity) &&
        admitJudgeUse(current, question).admitted &&
        current.evidence?.profileId === admission.evidence.profileId &&
        current.evidence.pairedM75Receipt === admission.evidence.pairedM75Receipt &&
        current.evidence.borrowedGoldenReceipt === admission.evidence.borrowedGoldenReceipt &&
        current.evidence.threshold === admission.evidence.threshold
      )
    }
    const key = entryKey(input.action)
    let existing = this.entries.get(key)
    if (existing !== undefined && !existing.isCurrent()) {
      this.discardEntry(key, existing)
      existing = undefined
    }
    const entry: SharedReview = existing ?? {
      stop: new AbortController(),
      isCurrent,
      holders: 0,
      outcome: undefined,
    }
    if (existing === undefined) {
      this.entries.set(key, entry)
    }
    entry.holders += 1
    let isHeld = true
    const discard = (): void => {
      if (!isHeld) {
        return
      }
      isHeld = false
      signal.removeEventListener('abort', discard)
      entry.holders -= 1
      if (entry.holders === 0) {
        this.discardEntry(key, entry)
      }
    }
    signal.addEventListener('abort', discard, { once: true })
    const settle = async (): Promise<void> => {
      try {
        const output = await this.deps.runtime.judge(request.data, entry.stop.signal)
        if (entry.stop.signal.aborted || !entry.isCurrent()) {
          this.discardEntry(key, entry)
          return
        }
        const advice = judgeUseAdvice(admission, request.data, output)
        entry.outcome =
          advice.kind === 'advisory' && advice.effect === 'caution' ? 'caution' : 'none'
      } catch {
        // A failed advisory has no opinion at any remaining holder's fence.
        this.deps.log?.warn('A failed judge advisory has no opinion')
        entry.outcome = 'failed'
      }
    }
    // The shared entry owns dispatch; another approval only acquires a holder.
    if (existing === undefined) {
      void settle()
    }
    return {
      read: () => {
        // A failed policy/binding read throws to the holder's fence, which
        // treats a broken latch as no opinion for the approval.
        try {
          return (
            isHeld && !entry.stop.signal.aborted && entry.isCurrent() && entry.outcome === 'caution'
          )
        } finally {
          discard()
        }
      },
      discard,
    }
  }
}
