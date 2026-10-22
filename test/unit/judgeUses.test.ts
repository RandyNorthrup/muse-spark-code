import { describe, expect, it } from 'vitest'
import { appendJudgeHint, judgeUseAdvice } from '../../src/core/judge/uses/advice'
import {
  admitJudgeUse,
  JUDGE_USE_DEFINITIONS,
  type JudgeUsePolicy,
} from '../../src/core/judge/uses/definitions'
import {
  logprobUsePolicy,
  useAnswer,
  useOutput,
  usePolicy,
  useQuestion,
  useRequest,
} from './helpers/judgeUsesFixture'

describe('independent use admission', () => {
  it('defines every planned use and keeps all off without paired evidence', () => {
    expect(Object.keys(JUDGE_USE_DEFINITIONS)).toHaveLength(9)
    const uses = [
      'skill-suggestion',
      'agent-suggestion',
      'context-relevance',
      'semantic-grading',
      'orchestration-hint',
      'review-signal',
      'ci-flake-triage',
      'lane-diff-prescreen',
      'review-class-order',
    ] as const
    for (const use of uses) {
      const policy = usePolicy(use)
      expect(admitJudgeUse({ ...policy, evidence: undefined }, useQuestion(use))).toEqual({
        admitted: false,
        reason: 'evidence-missing',
      })
      const admission = admitJudgeUse(policy, useQuestion(use))
      expect(admission.admitted).toBe(true)
      expect(judgeUseAdvice(admission, useRequest(use), useOutput(policy))).toMatchObject({
        kind: 'advisory',
        effect: JUDGE_USE_DEFINITIONS[use].effect,
      })
    }
  })

  it('requires nonempty M75, borrowed golden and calibrated profile receipts separately', () => {
    const policy = usePolicy()
    if (policy.evidence === undefined) {
      throw new Error('fixture evidence missing')
    }
    for (const key of ['pairedM75Receipt', 'borrowedGoldenReceipt', 'profileId'] as const) {
      expect(
        admitJudgeUse(
          { ...policy, evidence: { ...policy.evidence, [key]: ' ' } },
          useQuestion(policy.use),
        ),
      ).toMatchObject({ admitted: false, reason: 'evidence-missing' })
    }
    expect(admitJudgeUse({ ...policy, isOn: false }, useQuestion(policy.use))).toEqual({
      admitted: false,
      reason: 'off',
    })
    expect(
      admitJudgeUse(
        { ...policy, evidence: { ...policy.evidence, sourceVerified: false } },
        useQuestion(policy.use),
      ),
    ).toEqual({ admitted: false, reason: 'source-unverified' })
  })

  it('binds each receipt to its use and every profile field', () => {
    const policy = usePolicy()
    if (policy.evidence === undefined) {
      throw new Error('fixture evidence missing')
    }
    for (const field of Object.keys(policy.identity)) {
      const identity = { ...policy.identity, [field]: 'changed' }
      expect(
        admitJudgeUse(
          { ...policy, evidence: { ...policy.evidence, identity } },
          useQuestion(policy.use),
        ),
      ).toMatchObject({ reason: 'evidence-mismatch' })
    }
    expect(
      admitJudgeUse(
        { ...policy, evidence: { ...policy.evidence, use: 'skill-suggestion' } },
        useQuestion(policy.use),
      ),
    ).toMatchObject({ reason: 'evidence-mismatch' })
    expect(
      admitJudgeUse(
        {
          ...policy,
          identity: { ...policy.identity, family: 'wrong' },
          evidence: { ...policy.evidence, identity: { ...policy.identity, family: 'wrong' } },
        },
        useQuestion(policy.use),
      ),
    ).toMatchObject({ reason: 'evidence-mismatch' })
    for (const threshold of [NaN, Infinity, 0, -1, 2]) {
      expect(
        admitJudgeUse(
          { ...policy, evidence: { ...policy.evidence, threshold } },
          useQuestion(policy.use),
        ),
      ).toMatchObject({ reason: 'evidence-mismatch' })
    }
  })

  it('requires context no-loss evidence and M96 before orchestration hints', () => {
    const context = usePolicy('context-relevance')
    if (context.evidence === undefined) {
      throw new Error('fixture evidence missing')
    }
    expect(
      admitJudgeUse(
        { ...context, evidence: { ...context.evidence, noContextLoss: false } },
        useQuestion(context.use),
      ),
    ).toEqual({ admitted: false, reason: 'context-loss' })
    const orchestration = usePolicy('orchestration-hint')
    expect(
      admitJudgeUse({ ...orchestration, hasM96: false }, useQuestion(orchestration.use)),
    ).toEqual({ admitted: false, reason: 'm96-unavailable' })
  })

  it('uses the selected model capability rather than its vendor name', () => {
    const policy = usePolicy()
    for (const field of ['source', 'providerId', 'model', 'modelVersion', 'endpoint'] as const) {
      expect(
        admitJudgeUse(
          { ...policy, capability: { ...policy.capability, [field]: 'changed' } },
          useQuestion(policy.use),
        ),
      ).toMatchObject({ reason: 'evidence-mismatch' })
    }
    expect(
      admitJudgeUse(
        { ...policy, capability: { ...policy.capability, stated: false } },
        useQuestion(policy.use),
      ),
    ).toMatchObject({ reason: 'capability-unavailable' })
    expect(admitJudgeUse(policy, useQuestion('context-relevance'))).toMatchObject({
      reason: 'capability-unavailable',
    })
    if (policy.evidence === undefined) {
      throw new Error('fixture evidence missing')
    }
    for (const technique of [
      'logprob',
      'systemone',
      'sampling',
      'contrastive',
      'cascade',
      'embedding',
    ] as const) {
      const identity = { ...policy.identity, technique }
      const current: JudgeUsePolicy = {
        ...policy,
        identity,
        evidence: { ...policy.evidence, identity },
      }
      expect(admitJudgeUse(current, useQuestion(policy.use))).toMatchObject({
        reason: 'capability-unavailable',
      })
      if (technique === 'logprob') {
        for (const kind of ['top1', 'dropped', 'refused', 'unknown'] as const) {
          expect(
            admitJudgeUse(
              { ...current, capability: { ...policy.capability, logprobs: { kind } } },
              useQuestion(policy.use),
            ).admitted,
          ).toBe(false)
        }
        expect(
          admitJudgeUse(
            {
              ...current,
              capability: { ...policy.capability, logprobs: { kind: 'topk', topK: 1 } },
            },
            useQuestion(policy.use),
          ).admitted,
        ).toBe(false)
        expect(
          admitJudgeUse(
            {
              ...current,
              capability: { ...policy.capability, logprobs: { kind: 'topk', topK: 2 } },
            },
            useQuestion(policy.use),
          ).admitted,
        ).toBe(true)
      } else if (technique === 'systemone') {
        expect(
          admitJudgeUse(
            { ...current, capability: { ...policy.capability, systemone: true } },
            useQuestion(policy.use),
          ).admitted,
        ).toBe(true)
      }
    }
  })

  it('uses captured capability records for every vendor and both distribution question kinds', () => {
    for (const providerId of [
      'meta',
      'openai',
      'anthropic',
      'gemini',
      'xai',
      'openrouter',
      'ollama',
      'custom',
    ]) {
      const policy = usePolicy()
      if (policy.evidence === undefined) {
        throw new Error('fixture evidence missing')
      }
      const identity = { ...policy.identity, providerId }
      const current = {
        ...policy,
        identity,
        capability: { ...policy.capability, providerId },
        evidence: { ...policy.evidence, identity },
      }
      expect(admitJudgeUse(current, useQuestion(current.use)).admitted).toBe(true)
      expect(
        admitJudgeUse(
          { ...current, capability: { ...current.capability, stated: false } },
          useQuestion(current.use),
        ).admitted,
      ).toBe(false)
    }
    for (const use of ['context-relevance', 'review-class-order'] as const) {
      for (const topK of [1, 2]) {
        const current = logprobUsePolicy(use, topK)
        expect(admitJudgeUse(current, useQuestion(use)).admitted).toBe(topK === 2)
      }
    }
  })
})

describe('top-k alternative bounds', () => {
  it('counts every offered choice/score alternative for top-k capability admission', () => {
    for (const use of ['context-relevance', 'review-class-order'] as const) {
      let question = useQuestion(use)
      if (question.type === 'score') {
        question = { ...question, criteria: ['low', 'middle', 'high'] }
      } else if (question.type === 'choice') {
        question = { ...question, criteria: { A: 'first', B: 'second', C: 'third' } }
      }
      for (const topK of [2, 3]) {
        const current = logprobUsePolicy(use, topK)
        expect(admitJudgeUse(current, question).admitted).toBe(topK === 3)
      }
    }
  })
})

describe('advice has no granting or verifier authority', () => {
  const policy = usePolicy()
  const admission = admitJudgeUse(policy, useQuestion(policy.use))

  it('safe, unsure, failed, empty and malformed answers leave rules unchanged', () => {
    for (const output of [
      useOutput(policy, useAnswer(policy.use, 0)),
      useOutput(policy, useAnswer(policy.use, 0.5)),
      { outcome: 'no-answer', reason: 'engine-failure' },
      { outcome: 'answered', result: { answers: {} } },
      'ALLOW: safe',
    ]) {
      expect(judgeUseAdvice(admission, useRequest(), output)).toEqual({ kind: 'no-opinion' })
    }
    expect(judgeUseAdvice({ admitted: false, reason: 'off' }, useRequest(), useOutput())).toEqual({
      kind: 'no-opinion',
    })
  })

  it('rejects partial, uncalibrated, approximate and stale source/profile metadata', () => {
    for (const meta of [
      { partial: true },
      { label: 'uncalibrated' },
      { label: 'approximate (top-1)' },
      { confidence: 0.5 },
      { profileId: 'other' },
      { model: 'other' },
      { source: 'separate' },
      { technique: 'logprob' },
    ] as const) {
      expect(
        judgeUseAdvice(admission, useRequest(), useOutput(policy, useAnswer(policy.use), meta)),
      ).toEqual({ kind: 'no-opinion' })
    }
    const mismatched = useOutput(policy, useAnswer(policy.use), { model: 'other' })
    if (mismatched.outcome !== 'answered') {
      throw new Error('fixture answer missing')
    }
    expect(
      judgeUseAdvice(admission, useRequest(), {
        ...mismatched,
        result: { ...mismatched.result, model: 'other' },
      }),
    ).toEqual({ kind: 'no-opinion' })
    const output = useOutput()
    if (output.outcome !== 'answered') {
      throw new Error('fixture answer missing')
    }
    expect(
      judgeUseAdvice(admission, useRequest(), {
        ...output,
        result: { ...output.result, model: 'other' },
      }),
    ).toEqual({ kind: 'no-opinion' })
  })

  it('rejects missing, extra, misaligned or inconsistent answers', () => {
    const request = useRequest()
    expect(
      judgeUseAdvice(admission, request, useOutput(policy, useAnswer(policy.use), {}, 'other')),
    ).toEqual({ kind: 'no-opinion' })
    expect(
      judgeUseAdvice(
        admission,
        { ...request, questions: { ...request.questions, extra: useQuestion(policy.use) } },
        useOutput(),
      ),
    ).toEqual({ kind: 'no-opinion' })
    const invalid = [
      { type: 'choice', choice: 'true', confidence: 1, probabilities: { true: 1, false: 0 } },
      useAnswer('context-relevance'),
      { type: 'noul', noul: 1, probabilities: { true: 0.99, false: 0.01 } },
      { type: 'noul', noul: 0.99, probabilities: { true: 0.5, false: 0.5 } },
      { type: 'noul', noul: 0.99, probabilities: { true: 0.99, false: 0.02 } },
    ]
    const output = useOutput()
    if (output.outcome !== 'answered') {
      throw new Error('fixture answer missing')
    }
    for (const answer of invalid) {
      expect(
        judgeUseAdvice(admission, request, {
          ...output,
          result: { ...output.result, answers: { fixture: answer } },
        }),
      ).toEqual({ kind: 'no-opinion' })
    }
    const choice = usePolicy('ci-flake-triage')
    const choiceAdmission = admitJudgeUse(choice, useQuestion(choice.use))
    expect(
      judgeUseAdvice(
        choiceAdmission,
        useRequest(choice.use),
        useOutput(choice, {
          type: 'choice',
          choice: 'C',
          confidence: 1,
          probabilities: { A: 1, B: 0 },
        }),
      ),
    ).toEqual({ kind: 'no-opinion' })
  })

  it('refuses empty, multiple and missing request answers even when the output schema is valid', () => {
    const request = useRequest()
    const output = useOutput()
    if (output.outcome !== 'answered') {
      throw new Error('fixture answer missing')
    }
    const meta = output.result.muse['fixture']
    if (meta === undefined) {
      throw new Error('fixture metadata missing')
    }
    expect(judgeUseAdvice(admission, { ...request, questions: {} }, output)).toEqual({
      kind: 'no-opinion',
    })
    expect(
      judgeUseAdvice(admission, request, {
        ...output,
        result: {
          ...output.result,
          answers: { ...output.result.answers, extra: useAnswer(policy.use) },
          muse: { ...output.result.muse, extra: meta },
        },
      }),
    ).toEqual({ kind: 'no-opinion' })
    expect(
      judgeUseAdvice(admission, request, {
        ...output,
        result: {
          ...output.result,
          answers: { other: useAnswer(policy.use) },
          muse: { other: meta },
        },
      }),
    ).toEqual({ kind: 'no-opinion' })
  })

  it('recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores', () => {
    const choice = usePolicy('ci-flake-triage')
    const choiceAdmission = admitJudgeUse(choice, useQuestion(choice.use))
    for (const answer of [
      { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 0.5, B: 0.5 } },
      { type: 'choice', choice: 'B', confidence: 1, probabilities: { A: 1, B: 0 } },
      { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, C: 0 } },
      { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, B: 0, C: 0 } },
    ] as const) {
      expect(
        judgeUseAdvice(
          choiceAdmission,
          useRequest(choice.use),
          useOutput(choice, answer, { confidence: 1 }),
        ),
      ).toEqual({ kind: 'no-opinion' })
    }
    const score = usePolicy('semantic-grading')
    const scoreAdmission = admitJudgeUse(score, useQuestion(score.use))
    for (const answer of [
      {
        type: 'score',
        score: 0,
        confidence: 1,
        probabilities: { '0': 0, '1': 1 },
        legend: { '0': 'low', '1': 'high' },
      },
      {
        type: 'score',
        score: 1,
        confidence: 1,
        probabilities: { '0': 0, '1': 1 },
        legend: { '0': 'changed', '1': 'high' },
      },
    ] as const) {
      expect(
        judgeUseAdvice(scoreAdmission, useRequest(score.use), useOutput(score, answer)),
      ).toEqual({ kind: 'no-opinion' })
    }
  })

  it('grading, relevance and testing signals never replace verifiers or drop context', () => {
    for (const use of [
      'semantic-grading',
      'context-relevance',
      'ci-flake-triage',
      'lane-diff-prescreen',
      'review-class-order',
    ] as const) {
      const current = usePolicy(use)
      const advice = judgeUseAdvice(
        admitJudgeUse(current, useQuestion(use)),
        useRequest(use),
        useOutput(current),
      )
      expect(new Set(Object.keys(advice))).toEqual(new Set(['answer', 'effect', 'kind']))
      expect(appendJudgeHint('tail', advice, 'hint', (text) => text)).toBe('tail')
    }
  })

  it('adds at most one redacted hint at the tail without touching history or the skill index', () => {
    const current = usePolicy('skill-suggestion')
    const advice = judgeUseAdvice(
      admitJudgeUse(current, useQuestion(current.use)),
      useRequest(current.use),
      useOutput(current),
    )
    const prefix = 'complete skill index\nprior history\n'
    const tail = 'latest user message'
    expect(prefix + appendJudgeHint(tail, { kind: 'no-opinion' }, 'hint', (text) => text)).toBe(
      prefix + tail,
    )
    expect(
      prefix +
        appendJudgeHint(tail, advice, 'Use skill: fixture-secret', (text) =>
          text.replace('fixture-secret', '<redacted>'),
        ),
    ).toBe(prefix + tail + '\nUse skill: <redacted>')
    for (const line of [
      ' ',
      'first\nsecond',
      'first\rsecond',
      'first\u{2028}second',
      'first\u{2029}second',
    ]) {
      expect(appendJudgeHint(tail, advice, line, (text) => text)).toBe(tail)
    }
    expect(appendJudgeHint(tail, advice, 'clean', () => 'redacted\nline')).toBe(tail)
  })
})
