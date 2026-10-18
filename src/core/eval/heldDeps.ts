import type { ModelApiHostDeps } from '../backends/modelapi/ModelApiHost'

/**
 * What a mechanism may not change: the client (every request must pass the
 * trace), the workspace (the empty folder), the paid-use hooks (the run
 * refuses and counts every paid use), the shared context window (M101 R2:
 * a mechanism that changed it would also change file-read truncation, so
 * the pair would not isolate the mechanism) and the memory store (absent
 * unless a test supplies one; the counted run certifies memory absent).
 * It lives in its own module so the frozen arm digest
 * (`src/core/eval/armSources.ts`) can cover it without depending on the
 * driver, which drives the production host under test: covering the driver
 * would pin `ModelApiHost` itself, which the harness measures rather than
 * freezes (review RVCM1012B). Exported so the frozen digest pins exactly
 * what the harness holds fixed.
 */
export const EVAL_HELD_DEPS = [
  'client',
  'workspaceRoot',
  'allowsPaidUse',
  'isPaidUseRemembered',
  'notePaidUse',
  'noteSubagentUsage',
  'noteReviewerUsage',
  'contextModel',
  'memory',
] as const satisfies readonly (keyof ModelApiHostDeps)[]
