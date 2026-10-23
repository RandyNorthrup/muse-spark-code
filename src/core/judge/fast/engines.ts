// M125 lane P (D107 §4.1): the fast path's engine admission predicates
// over M95 capability records. Every check fails closed: an unknown,
// denied or partial record admits nothing. Hosted siblings pass the
// same predicates as local engines — feature-equivalence by
// construction, never inferred from a provider or model name.
//
// Type-only on the record: the formats below mirror M98's
// BYO_STATED_FORMATS, and the effort read mirrors
// capabilityEffortLevels; the tests pin both to their sources, so a
// drift fails loudly instead of dispatching wrong. The policy scale is
// the same shape both policies use, read never written.
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import { JUDGE_LOGPROB_TOP_K } from '../../../shared/constants'

/** Structured modes that carry a stated answer. Plain text is not a stated path. */
const STATED_FORMATS: ReadonlySet<string> = new Set([
  'strict_schema',
  'json_schema',
  'forced_tool',
  'json_object',
])

/** The record affirms top-K logprobs with room for the judge's K. */
export function hasLogprobWire(record: ModelCapabilityRecord): boolean {
  const logprobs = record.logprobs
  return (
    logprobs.state === 'yes' &&
    logprobs.value.kind === 'topk' &&
    (logprobs.value.maxTopK ?? 0) >= JUDGE_LOGPROB_TOP_K
  )
}

/** The record captured a structured format a stated call can use. */
export function hasStatedWire(record: ModelCapabilityRecord): boolean {
  const formats = record.output.formats
  return formats.state === 'yes' && formats.value.some((format) => STATED_FORMATS.has(format))
}

/** The model's own effort scale; empty when the record does not name one. */
export function judgeEffortScale(record: ModelCapabilityRecord): readonly string[] {
  const levels = record.reasoning.effortLevels
  return levels.state === 'yes' ? levels.value : []
}

export interface JudgeEngineRoles {
  readonly logprobs: boolean
  readonly stated: boolean
  readonly effort: readonly string[]
}

/** Every fast role the record admits for this model, all fail-closed. */
export function engineRoles(record: ModelCapabilityRecord): JudgeEngineRoles {
  return {
    logprobs: hasLogprobWire(record),
    stated: hasStatedWire(record),
    effort: judgeEffortScale(record),
  }
}

/** The effort scale the session policy resolved, in either policy's shape. */
export type PolicyEffortScale =
  | { readonly state: 'yes'; readonly value: readonly string[] }
  | { readonly state: 'no' | 'unknown' }

/**
The scale effort-lowering reads. The resolved model's own record wins
when its lane carried one — a record silent on effort lowers nothing,
whatever the policy claims. Without a record the policy keeps today's
same-model behaviour, byte for byte.
*/
export function fastEffortScale(
  record: ModelCapabilityRecord | undefined,
  policyLevels: PolicyEffortScale,
): readonly string[] {
  if (record !== undefined) return judgeEffortScale(record)
  return policyLevels.state === 'yes' ? policyLevels.value : []
}
