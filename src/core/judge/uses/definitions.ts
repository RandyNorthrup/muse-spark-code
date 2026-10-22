// M98 2f: independently measured advisory uses. This is use eligibility,
// not paid dispatch admission; the injected runtime still owns D78's ledger.
import type { JudgeCapability, JudgeProfileIdentity, JudgeQuestion } from '../schema'

export const JUDGE_USE_DEFINITIONS = {
  'skill-suggestion': { family: 'skill.fit', type: 'noul', effect: 'hint' },
  'agent-suggestion': { family: 'agent.fit', type: 'noul', effect: 'hint' },
  'context-relevance': { family: 'context.relevance', type: 'score', effect: 'relevance' },
  'semantic-grading': { family: 'semantic.grade', type: 'score', effect: 'grade' },
  'orchestration-hint': { family: 'orchestration.hint', type: 'noul', effect: 'hint' },
  'review-signal': { family: 'risk.destructive', type: 'noul', effect: 'caution' },
  'ci-flake-triage': { family: 'ci.flake', type: 'choice', effect: 'triage' },
  'lane-diff-prescreen': { family: 'lane.prescreen', type: 'noul', effect: 'prescreen' },
  'review-class-order': { family: 'review.order', type: 'choice', effect: 'order' },
} as const

export type JudgeUse = keyof typeof JUDGE_USE_DEFINITIONS

/** Z supplies real B/M75/source receipts; fixtures cannot certify adoption. */
export interface JudgeUseEvidence {
  readonly use: JudgeUse
  readonly identity: JudgeProfileIdentity
  readonly profileId: string
  readonly pairedM75Receipt: string
  readonly borrowedGoldenReceipt: string
  readonly sourceVerified: boolean
  readonly noContextLoss: boolean
  /** Threshold selected on tuning groups, then independently evaluated. */
  readonly threshold: number
}

export interface JudgeUsePolicy {
  readonly use: JudgeUse
  readonly isOn: boolean
  readonly capability: JudgeCapability
  readonly identity: JudgeProfileIdentity
  readonly evidence: JudgeUseEvidence | undefined
  readonly hasM96: boolean
}

export type JudgeUseAdmission =
  | { readonly admitted: true; readonly evidence: JudgeUseEvidence }
  | {
      readonly admitted: false
      readonly reason:
        | 'off'
        | 'evidence-missing'
        | 'evidence-mismatch'
        | 'source-unverified'
        | 'context-loss'
        | 'm96-unavailable'
        | 'capability-unavailable'
    }

/** All identity fields bind evidence to the selected source, technique and wording. */
export function isSameUseIdentity(
  left: JudgeProfileIdentity,
  right: JudgeProfileIdentity,
): boolean {
  return Object.entries(left).every(([key, value]) => Reflect.get(right, key) === value)
}

function canSupportQuestion(policy: JudgeUsePolicy, question: JudgeQuestion): boolean {
  const { capability, identity, use } = policy
  if (question.type !== JUDGE_USE_DEFINITIONS[use].type) {
    return false
  }
  switch (identity.technique) {
    case 'stated': {
      return capability.stated
    }
    case 'systemone': {
      return capability.systemone
    }
    case 'logprob': {
      let alternatives = 2
      if (question.type === 'choice') {
        alternatives = Object.keys(question.criteria).length
      } else if (question.type === 'score') {
        alternatives = question.criteria.length
      }
      return capability.logprobs.kind === 'topk' && capability.logprobs.topK >= alternatives
    }
    default: {
      // D/A/I must supply their technique's measured eligibility before adoption.
      return false
    }
  }
}

/** Missing evidence never enables a use, even with explicit mode/default-on settings. */
export function admitJudgeUse(policy: JudgeUsePolicy, question: JudgeQuestion): JudgeUseAdmission {
  if (!policy.isOn) {
    return { admitted: false, reason: 'off' }
  }
  const { evidence, capability, identity, use } = policy
  if (
    evidence === undefined ||
    evidence.pairedM75Receipt.trim() === '' ||
    evidence.borrowedGoldenReceipt.trim() === '' ||
    evidence.profileId.trim() === ''
  ) {
    return { admitted: false, reason: 'evidence-missing' }
  }
  if (
    evidence.use !== use ||
    !isSameUseIdentity(evidence.identity, identity) ||
    identity.family !== JUDGE_USE_DEFINITIONS[use].family ||
    !Number.isFinite(evidence.threshold) ||
    evidence.threshold <= 0 ||
    evidence.threshold > 1 ||
    capability.source !== identity.source ||
    capability.providerId !== identity.providerId ||
    capability.model !== identity.model ||
    capability.modelVersion !== identity.modelVersion ||
    capability.endpoint !== identity.endpoint
  ) {
    return { admitted: false, reason: 'evidence-mismatch' }
  }
  if (!evidence.sourceVerified) {
    return { admitted: false, reason: 'source-unverified' }
  }
  if (use === 'context-relevance' && !evidence.noContextLoss) {
    return { admitted: false, reason: 'context-loss' }
  }
  if (use === 'orchestration-hint' && !policy.hasM96) {
    return { admitted: false, reason: 'm96-unavailable' }
  }
  return canSupportQuestion(policy, question)
    ? { admitted: true, evidence }
    : { admitted: false, reason: 'capability-unavailable' }
}
