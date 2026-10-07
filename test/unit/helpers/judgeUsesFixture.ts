import {
  judgeCapabilitySchema,
  judgeProfileIdentitySchema,
  type JudgeMuse,
  type JudgeOutcome,
  type JudgeQuestion,
  type JudgeRequest,
  type JevAnswer,
} from '../../../src/core/judge/schema'
import {
  JUDGE_USE_DEFINITIONS,
  type JudgeUse,
  type JudgeUsePolicy,
} from '../../../src/core/judge/uses/definitions'
import { entropyConfidence } from '../../../src/core/judge/math'
import type { JudgeEntryParts } from '../../../src/core/judge/entries'

/** Synthetic receipts are for mechanics only; none can certify adoption. */
export function usePolicy(use: JudgeUse = 'review-signal'): JudgeUsePolicy {
  const identity = judgeProfileIdentitySchema.parse({
    source: 'same',
    providerId: 'fixture-provider',
    model: 'fixture-model',
    modelVersion: 'fixture-version',
    endpoint: 'fixture://judge',
    technique: 'stated',
    family: JUDGE_USE_DEFINITIONS[use].family,
    promptVersion: 'prompt-1',
    criteriaVersion: 'criteria-1',
    fitVersion: 'fit-1',
  })
  const capability = judgeCapabilitySchema.parse({
    source: identity.source,
    providerId: identity.providerId,
    model: identity.model,
    modelVersion: identity.modelVersion,
    endpoint: identity.endpoint,
    captureId: 'fixture-capture',
    logprobs: { kind: 'refused' },
    stated: true,
    systemone: false,
    reasoningForced: true,
    cache: false,
    contextWindowTokens: 32_000,
    minOutputTokens: 1,
  })
  return {
    use,
    isOn: true,
    identity,
    capability,
    hasM96: true,
    evidence: {
      use,
      identity,
      profileId: 'fixture-profile',
      pairedM75Receipt: 'fixture-paired',
      borrowedGoldenReceipt: 'fixture-golden',
      sourceVerified: true,
      noContextLoss: true,
      threshold: 0.7,
    },
  }
}

export function useQuestion(use: JudgeUse): JudgeQuestion {
  switch (JUDGE_USE_DEFINITIONS[use].type) {
    case 'noul': {
      return { type: 'noul', instructions: 'Fixture binary question.' }
    }
    case 'choice': {
      return {
        type: 'choice',
        instructions: 'Fixture choice.',
        criteria: { A: 'first', B: 'second' },
      }
    }
    case 'score': {
      return { type: 'score', instructions: 'Fixture score.', criteria: ['low', 'high'] }
    }
  }
}

export function useRequest(use: JudgeUse = 'review-signal'): JudgeRequest {
  return { state: 'Synthetic state.', questions: { fixture: useQuestion(use) } }
}

export function useAnswer(use: JudgeUse, p = 0.99): JevAnswer {
  switch (JUDGE_USE_DEFINITIONS[use].type) {
    case 'noul': {
      return { type: 'noul', noul: p, probabilities: { true: p, false: 1 - p } }
    }
    case 'choice': {
      return { type: 'choice', choice: 'A', confidence: p, probabilities: { A: p, B: 1 - p } }
    }
    case 'score': {
      return {
        type: 'score',
        score: p,
        confidence: p,
        legend: { '0': 'low', '1': 'high' },
        probabilities: { '0': 1 - p, '1': p },
      }
    }
  }
}

export function useOutput(
  policy: JudgeUsePolicy = usePolicy(),
  answer: JevAnswer = useAnswer(policy.use),
  meta: Partial<JudgeMuse> = {},
  id = 'fixture',
): JudgeOutcome {
  return {
    outcome: 'answered',
    result: {
      model: policy.identity.model,
      answers: { [id]: answer },
      muse: {
        [id]: {
          source: policy.identity.source,
          model: policy.identity.model,
          technique: policy.identity.technique,
          label: 'calibrated (stated)',
          confidence: entropyConfidence(Object.values(answer.probabilities)),
          partial: false,
          profileId: policy.evidence?.profileId,
          ...meta,
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }
}

export function useAction(overrides: Partial<JudgeEntryParts> = {}): JudgeEntryParts {
  return {
    backend: 'museCode',
    sessionId: 's1',
    turnId: 't1',
    tool: 'shell',
    args: { command: 'fixture command', dryRun: true },
    ...overrides,
  }
}

/** A complete captured-capability fixture for distribution question capacity tests. */
export function logprobUsePolicy(use: JudgeUse, topK: number): JudgeUsePolicy {
  const policy = usePolicy(use)
  if (policy.evidence === undefined) {
    throw new Error('fixture evidence missing')
  }
  const identity = { ...policy.identity, technique: 'logprob' as const }
  return {
    ...policy,
    identity,
    evidence: { ...policy.evidence, identity },
    capability: { ...policy.capability, logprobs: { kind: 'topk', topK } },
  }
}
