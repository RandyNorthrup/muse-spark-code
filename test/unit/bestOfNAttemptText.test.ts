// Best-of-N spend sentences (M77 C-M77-2): the comparison's attempt line
// and the take notice name the same reported spend. Token and cost
// figures replay recorded provider replies (M106 u8, 2026-10-05, and the
// OR-UNSUP receipt, 2026-10-13 UTC); the attempt scaffolding around them
// is validated through the real attempt and run schemas.
import { describe, expect, it } from 'vitest'
import {
  bestOfNAttemptSchema,
  bestOfNRunSchema,
  type BestOfNAttempt,
} from '../../src/shared/bestOfN'
import { bestOfNAttemptMeta, bestOfNTakenNotice } from '../../src/shared/bestOfNAttemptText'

function attempt(overrides: Record<string, unknown> = {}): BestOfNAttempt {
  return bestOfNAttemptSchema.parse({
    attemptId: 'a1',
    branch: 'best-of-n/bon-1/0',
    worktreePath: '/tmp/bon-1-0',
    status: 'completed',
    requestsMade: 4,
    ceilingReached: false,
    approvalsDenied: 0,
    files: [],
    changedLines: 0,
    ...overrides,
  })
}

describe('best-of-N spend sentences', () => {
  it('names the recorded receipt on the comparison line', () => {
    const line = bestOfNAttemptMeta(
      attempt({
        reportedInputTokens: 6,
        reportedOutputTokens: 5,
        reportedCostUsd: '0.00000091',
        hasUnreportedCost: false,
      }),
    )
    expect(line).toBe('4 requests · 11 tokens · reported spend $0.00000091')
  })

  it('says more is pending instead of stating a partial total as the price', () => {
    const line = bestOfNAttemptMeta(
      attempt({
        reportedInputTokens: 2119,
        reportedOutputTokens: 689,
        reportedCostUsd: '0.00000091',
        hasUnreportedCost: true,
      }),
    )
    expect(line).toBe('4 requests · 2,808 tokens · $0.00000091 reported, more pending')
    expect(line.includes('more pending')).toBe(true)
  })

  it('names recorded tokens with no spend claim when no cost was reported', () => {
    const line = bestOfNAttemptMeta(
      attempt({ reportedInputTokens: 2119, reportedOutputTokens: 689 }),
    )
    expect(line).toBe('4 requests · 2,808 tokens')
    expect(line.includes('reported spend')).toBe(false)
  })

  it("names the taken attempt's complete reported spend in the take notice", () => {
    const taken = attempt({
      reportedInputTokens: 6,
      reportedOutputTokens: 5,
      reportedCostUsd: '0.00000091',
      hasUnreportedCost: false,
    })
    const run = bestOfNRunSchema.parse({
      runId: 'bon-1',
      prompt: 'Swap the precedence rows',
      modelId: 'muse-spark-1',
      baseRef: 'abc123',
      attempts: 2,
      requestCeilingPerAttempt: 8,
      status: 'completed',
      takenBranch: taken.branch,
      runAttempts: [taken, attempt({ attemptId: 'a2', branch: 'best-of-n/bon-1/1' })],
    })
    expect(bestOfNTakenNotice(run)).toBe(
      'Applied and staged the preview from best-of-n/bon-1/0. Reported use: 11 tokens, reported spend $0.00000091.',
    )
  })

  it('keeps the cost-free notice when the taken cost is partial or missing', () => {
    const partial = attempt({
      reportedInputTokens: 2119,
      reportedOutputTokens: 689,
      reportedCostUsd: '0.00000091',
      hasUnreportedCost: true,
    })
    const base = {
      runId: 'bon-1',
      prompt: 'Swap the precedence rows',
      modelId: 'muse-spark-1',
      baseRef: 'abc123',
      attempts: 1,
      requestCeilingPerAttempt: 8,
      status: 'completed',
      takenBranch: partial.branch,
    } as const
    const partialNotice = bestOfNTakenNotice(
      bestOfNRunSchema.parse({ ...base, runAttempts: [partial] }),
    )
    expect(partialNotice).toBe(
      'Applied and staged the preview from best-of-n/bon-1/0. Reported use: 2,808 tokens.',
    )
    expect(partialNotice?.includes('reported spend')).toBe(false)
    const missing = bestOfNTakenNotice(
      bestOfNRunSchema.parse({ ...base, runAttempts: [attempt()] }),
    )
    expect(missing).toBe('Applied and staged the preview from best-of-n/bon-1/0.')
  })

  it('says nothing while nothing is taken', () => {
    const run = bestOfNRunSchema.parse({
      runId: 'bon-1',
      prompt: 'Swap the precedence rows',
      modelId: 'muse-spark-1',
      baseRef: 'abc123',
      attempts: 2,
      requestCeilingPerAttempt: 8,
      status: 'running',
      runAttempts: [attempt()],
    })
    expect(bestOfNTakenNotice(run)).toBeUndefined()
  })
})
