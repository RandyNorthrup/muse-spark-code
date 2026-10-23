// Technique choice for a bring-your-own judge (M98 phase 2, lane E).
// The model's captured capability record decides. The provider id is an
// identity key only: it never selects top-k, top-1, stated or a silent drop.
// No `vscode` import.

import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import { judgeCapabilitySchema, type JudgeCapability, type JudgeQuestion } from '../schema'

/** Structured modes the record can name. Plain text is not a stated path. */
export const BYO_STATED_FORMATS = [
  'strict_schema',
  'json_schema',
  'forced_tool',
  'json_object',
] as const
export type ByoStatedFormat = (typeof BYO_STATED_FORMATS)[number]

export type ByoLogprobKind = 'topk' | 'top1' | 'refused' | 'dropped' | 'unknown'

export interface ByoTechniqueChoice {
  readonly technique: 'logprob' | 'top1' | 'stated'
  readonly logprobs: ByoLogprobKind
  /** Set when the record captured a structured format, including beside logprobs. */
  readonly statedFormat?: ByoStatedFormat | undefined
  /** What the request may ask for. Decoding uses the returned list, not this count. */
  readonly requestTopK?: number | undefined
  readonly requiresEffortNone: boolean
  readonly minOutputTokens: number
}

export type ByoTechniqueDecision =
  | { readonly outcome: 'chosen'; readonly choice: ByoTechniqueChoice }
  | { readonly outcome: 'no-answer'; readonly reason: 'capability-unavailable' }

const unavailable: ByoTechniqueDecision = {
  outcome: 'no-answer',
  reason: 'capability-unavailable',
}

/**
The first captured structured format, in the order a stated call can use.
Unknown and text-only records have no stated path.
*/
export function capturedStatedFormat(record: ModelCapabilityRecord): ByoStatedFormat | undefined {
  const formats = record.output.formats
  return formats.state === 'yes'
    ? BYO_STATED_FORMATS.find((format) => formats.value.includes(format))
    : undefined
}

/**
Logprob kind both seams agree on. A judge claim cannot upgrade an unknown
or denied record, and a record cannot be outvoted by the provider name.
`no` plus a dropped claim is the silent-drop capture; `no` plus refused
is a refusal. Anything else is a disagreement.
*/
function agreedLogprobs(
  record: ModelCapabilityRecord,
  judge: JudgeCapability,
): ByoLogprobKind | undefined {
  const recorded = record.logprobs
  const claimed = judge.logprobs.kind
  if (recorded.state === 'unknown') return claimed === 'unknown' ? 'unknown' : undefined
  if (recorded.state === 'no') {
    return claimed === 'refused' || claimed === 'dropped' ? claimed : undefined
  }
  if (claimed === 'topk' && recorded.value.kind === 'topk') {
    const cap = recorded.value.maxTopK
    return cap !== undefined && judge.logprobs.topK > cap ? undefined : 'topk'
  }
  return claimed === 'top1' && recorded.value.kind === 'top1' ? 'top1' : undefined
}

function outputFloor(record: ModelCapabilityRecord): number | undefined {
  const captured =
    record.logprobs.state === 'yes' ? record.logprobs.value.minOutputTokens : undefined
  const floor = captured ?? record.output.minTokens ?? 1
  return Number.isSafeInteger(floor) && floor >= 1 ? floor : undefined
}

/**
Choose the technique for one question kind. Dialect strings and provider
ids are not read as capabilities. An uncaptured logprob field may state
only when a structured format was captured; otherwise there is no answer.
*/
export function chooseByoTechnique(
  record: ModelCapabilityRecord,
  judge: JudgeCapability,
  kind: JudgeQuestion['type'],
): ByoTechniqueDecision {
  if (!judgeCapabilitySchema.safeParse(judge).success) return unavailable
  if (
    judge.providerId !== record.identity.provider ||
    judge.model !== record.identity.nativeModel ||
    (record.identity.servedVersion !== undefined &&
      judge.modelVersion !== record.identity.servedVersion)
  ) {
    return unavailable
  }
  const logprobs = agreedLogprobs(record, judge)
  if (logprobs === undefined) return unavailable
  const recordedFloor = outputFloor(record)
  const minOutputTokens =
    recordedFloor === undefined
      ? undefined
      : Math.max(recordedFloor, judge.minOutputTokens, record.output.minTokens ?? 1)
  if (minOutputTokens === undefined) return unavailable
  const statedFormat = capturedStatedFormat(record)
  const captured = record.logprobs.state === 'yes' ? record.logprobs.value : undefined
  if (logprobs === 'topk' && judge.logprobs.kind === 'topk') {
    return {
      outcome: 'chosen',
      choice: {
        technique: 'logprob',
        logprobs,
        ...(statedFormat !== undefined && { statedFormat }),
        requestTopK: judge.logprobs.topK,
        requiresEffortNone: captured?.requiresEffortNone === true,
        minOutputTokens,
      },
    }
  }
  if (logprobs === 'top1' && kind === 'noul') {
    return {
      outcome: 'chosen',
      choice: {
        technique: 'top1',
        logprobs,
        ...(statedFormat !== undefined && { statedFormat }),
        requestTopK: 1,
        requiresEffortNone: captured?.requiresEffortNone === true,
        minOutputTokens,
      },
    }
  }
  if (statedFormat === undefined) return unavailable
  return {
    outcome: 'chosen',
    choice: {
      technique: 'stated',
      logprobs,
      statedFormat,
      requiresEffortNone: false,
      minOutputTokens,
    },
  }
}
