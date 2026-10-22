import { LintCache, type LintIdentity } from '../../../src/core/judge/lint/cache'
import type { LintEvaluator } from '../../../src/core/judge/lint/evaluate'
import { entropyConfidence } from '../../../src/core/judge/math'
import type { JudgeRequest, JudgeMuse, JevAnswer } from '../../../src/core/judge/schema'
import type { LintRule } from '../../../src/core/judge/lint/rules'

export function lintRule(overrides: Partial<LintRule> = {}): LintRule {
  return {
    id: 'rule',
    description: 'Fixture rule',
    severity: 'error',
    kinds: ['function'],
    include: [],
    exclude: [],
    exceptions: [],
    minConfidence: 0.5,
    allowSkip: false,
    allowAbstain: false,
    localize: [],
    callees: false,
    ...overrides,
  }
}

export function lintResponse(request: JudgeRequest, choice = 'A', probability = 1) {
  const answers: Record<string, Extract<JevAnswer, { type: 'choice' }>> = {}
  const muse: Record<string, JudgeMuse> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type !== 'choice') throw new Error('fixture requires choice')
    const letters = Object.keys(question.criteria)
    const probabilities = Object.fromEntries(
      letters.map((letter) => [
        letter,
        letter === choice ? probability : (1 - probability) / (letters.length - 1),
      ]),
    )
    const confidence = entropyConfidence(Object.values(probabilities))
    answers[id] = { type: 'choice', choice, probabilities, confidence: 0.99 }
    muse[id] = {
      source: 'same',
      technique: 'stated',
      model: 'fixture-model',
      label: 'uncalibrated',
      confidence,
      partial: false,
    }
  }
  return { model: 'fixture-model', answers, muse, usage: { input_tokens: 1, output_tokens: 1 } }
}

export function lintEvaluator(): LintEvaluator {
  const identity: LintIdentity = {
    endpoint: 'https://example.invalid/systemone',
    model: 'fixture-model',
    source: 'same',
    profile: 'profile-1',
    criteriaVersion: 'criteria-1',
    credentialFingerprint: 'opaque-fingerprint',
    provenance: 'independent',
  }
  return {
    identity,
    wording: {
      pass: 'fixture pass',
      fail: 'fixture fail',
      skip: 'fixture skip',
      abstain: 'fixture abstain',
      instructions: (rule) => rule.description,
    },
    limits: { maxCallees: 12, maxCalleeBytes: 16_384, distributionTolerance: 0.000001 },
    cache: new LintCache(8),
    callees: () => Promise.resolve([]),
    judgeAdmitted: (request: JudgeRequest) => Promise.resolve(lintResponse(request)),
  }
}
