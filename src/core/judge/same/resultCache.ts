// The same-model judge's memory-only result cache (M98 lane S, PLAN.md D77):
// one window's settled batch outcomes, keyed by lane J's exact-action entry
// key, so judging the same action twice settles at once from the cache
// instead of calling again. Memory only: nothing is written anywhere, and a
// replaced session, turn or action discards the entry (lane J), which drops
// the cached outcome with it. No `vscode` import.

import { JUDGE_RESULT_CACHE_MAX } from '../../../shared/constants'
import type { JudgeAnswer } from '../judge'

/** What a settled batch leaves in the cache: its outcome and its answers. */
export interface CachedJudgeOutcome {
  readonly outcome: 'caution' | 'none'
  readonly model: string
  readonly answers: readonly JudgeAnswer[]
}

/**
 * A bounded, insertion-ordered cache: past the cap the oldest outcome is
 * evicted first. One instance per window; `clear` drops the window's
 * outcomes (a replaced session's entries are gone with it).
 */
export class JudgeResultCache {
  private readonly outcomes = new Map<string, CachedJudgeOutcome>()
  private readonly maxEntries: number

  public constructor(maxEntries: number = JUDGE_RESULT_CACHE_MAX) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('judge result caches hold at least one outcome')
    }
    this.maxEntries = maxEntries
  }

  public get size(): number {
    return this.outcomes.size
  }

  public get(key: string): CachedJudgeOutcome | undefined {
    return this.outcomes.get(key)
  }

  public set(key: string, outcome: CachedJudgeOutcome): void {
    if (!this.outcomes.has(key) && this.outcomes.size >= this.maxEntries) {
      const oldest = this.outcomes.keys().next()
      if (!oldest.done) {
        this.outcomes.delete(oldest.value)
      }
    }
    this.outcomes.set(key, outcome)
  }

  public clear(): void {
    this.outcomes.clear()
  }
}
