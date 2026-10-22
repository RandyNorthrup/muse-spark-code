// Best-of-N parallel attempts (M77, PLAN.md D49): the same prompt runs in N
// worktrees on the Model API backend, and the user takes one. Shared by
// host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'
import { nonnegativeUsdSchema } from './usdSchema'
import { BEST_OF_N_DEFAULT_ATTEMPTS, BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT } from './constants'

export const BEST_OF_N_ATTEMPT_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export type BestOfNAttemptStatus = (typeof BEST_OF_N_ATTEMPT_STATUSES)[number]

/** One file an attempt changed, from `git diff --numstat`. */
export const bestOfNChangedFileSchema = z.object({
  path: z.string(),
  insertions: z.int().check(z.nonnegative()),
  deletions: z.int().check(z.nonnegative()),
})
export type BestOfNChangedFile = z.infer<typeof bestOfNChangedFileSchema>

/** One attempt: M71's conversation in a worktree, confined to it. */
export const bestOfNAttemptSchema = z.object({
  attemptId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  /** True once `git worktree add` made the folder and until a failed start removed it. */
  hasWorktree: z.optional(z.boolean()),
  sessionId: z.optional(z.string()),
  status: z.enum(BEST_OF_N_ATTEMPT_STATUSES),
  /** Completed model requests; the run cancels the attempt past its ceiling. */
  requestsMade: z.int().check(z.nonnegative()),
  /** True when the ceiling, not the model, ended the attempt. */
  ceilingReached: z.boolean(),
  /** Approval cards and questions the run declined: no surface could ask. */
  approvalsDenied: z.int().check(z.nonnegative()),
  /**
  Reported model use so far, summed over this attempt's validated
  per-response deltas (C-M77-2): input plus output tokens, the reported
  cost only when the provider reported one, and whether some delta came
  without a reported cost. Absent until the first delta arrives; unknown
  HTTP tries never become an invented zero.
  */
  reportedInputTokens: z.optional(z.int().check(z.nonnegative())),
  reportedOutputTokens: z.optional(z.int().check(z.nonnegative())),
  reportedCostUsd: z.optional(nonnegativeUsdSchema),
  hasUnreportedCost: z.optional(z.boolean()),
  /** Why a failed attempt failed, as its backend described it. */
  failureReason: z.optional(z.string()),
  files: z.array(bestOfNChangedFileSchema),
  /** Insertions plus deletions over `files`. */
  changedLines: z.int().check(z.nonnegative()),
  /** The full unified diff against the run's base, clipped for the panel. */
  diff: z.optional(z.string()),
  /** True when the text above was clipped at the cap. */
  isDiffClipped: z.optional(z.boolean()),
})
export type BestOfNAttempt = z.infer<typeof bestOfNAttemptSchema>

export const BEST_OF_N_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const
export type BestOfNRunStatus = (typeof BEST_OF_N_RUN_STATUSES)[number]

export interface BestOfNRequest {
  readonly prompt: string
  readonly attempts: number
  readonly requestCeilingPerAttempt: number
}

/** Which field refuses a run, in the order the dialog checks them. */
export type BestOfNValidationError = 'prompt' | 'attempts' | 'ceiling'

/**
The fields that refuse this run; empty means it may start. D121: the
attempt count and the per-attempt request ceiling are the person's own
per-run choice with no ceiling of ours, so only a whole number below 1
refuses.
*/
export function validateBestOfNRequest(request: BestOfNRequest): readonly BestOfNValidationError[] {
  const errors: BestOfNValidationError[] = []
  if (request.prompt.trim() === '') {
    errors.push('prompt')
  }
  if (!Number.isSafeInteger(request.attempts) || request.attempts < 1) {
    errors.push('attempts')
  }
  if (
    !Number.isSafeInteger(request.requestCeilingPerAttempt) ||
    request.requestCeilingPerAttempt < 1
  ) {
    errors.push('ceiling')
  }
  return errors
}

/** The defaults the dialog opens with. */
export function defaultBestOfNRequest(prompt: string): BestOfNRequest {
  return {
    prompt,
    attempts: BEST_OF_N_DEFAULT_ATTEMPTS,
    requestCeilingPerAttempt: BEST_OF_N_DEFAULT_REQUESTS_PER_ATTEMPT,
  }
}

/** A best-of-N run: the prompt, its attempts and how it ended. */
export const bestOfNRunSchema = z.object({
  runId: z.string(),
  prompt: z.string(),
  modelId: z.string(),
  baseRef: z.string(),
  attempts: z.int(),
  requestCeilingPerAttempt: z.int(),
  status: z.enum(BEST_OF_N_RUN_STATUSES),
  /** The attempt branch whose immutable preview was applied and staged. */
  takenBranch: z.optional(z.string()),
  runAttempts: z.array(bestOfNAttemptSchema),
})
export type BestOfNRun = z.infer<typeof bestOfNRunSchema>
