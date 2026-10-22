// M115w WV: the fix verification contract. The host re-runs the
// reproduction against the fix and brings the evidence here; this module
// proves the evidence and computes the resolution. A failed reproduction
// verifies nothing: no fixed-reply is ever posted for a fix that did not
// verify. Closing follows the repository's policy, and only the policy.
import * as z from 'zod/mini'
import type { WatchdogClosePolicy } from '../../shared/watchdog'

export const watchdogVerifyEvidenceSchema = z.strictObject({
  pullRequestNumber: z.number(),
  pullRequestUrl: z.string(),
  version: z.string(),
  passed: z.boolean(),
  notes: z.string(),
})
export type WatchdogVerifyEvidence = z.infer<typeof watchdogVerifyEvidenceSchema>

export interface VerifiedResolution {
  readonly pullRequestNumber: number
  readonly pullRequestUrl: string
  readonly version: string
  readonly close: boolean
}

export type VerificationResult =
  | { readonly verified: true; readonly resolution: VerifiedResolution }
  | { readonly verified: false; readonly notes: string }

/** The verified resolution, or the notes saying why there is none. */
export function applyVerification(
  evidence: unknown,
  closePolicy: WatchdogClosePolicy,
): VerificationResult {
  const proven = watchdogVerifyEvidenceSchema.parse(evidence)
  if (!proven.passed) return { verified: false, notes: proven.notes }
  return {
    verified: true,
    resolution: {
      pullRequestNumber: proven.pullRequestNumber,
      pullRequestUrl: proven.pullRequestUrl,
      version: proven.version,
      close: closePolicy !== 'never',
    },
  }
}
