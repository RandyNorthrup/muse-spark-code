import { describe, expect, it } from 'vitest'
import { planJudgeBatches, type JudgePromptWording } from '../../src/core/judge/prompt'
import type { JudgeQuestion } from '../../src/core/judge/judge'

const wording: JudgePromptWording = {
  systemInstruction: 'Answer with exactly one constrained token per question.',
  stateLabel: 'State:\n',
  questionLabel: 'Question: ',
  formatAlternative: (letter, label) =>
    letter === undefined ? `- ${label}` : `${letter}. ${label}`,
}

const measureTokens = (text: string): number => Math.ceil(text.length / 4)

function noul(id: string, text = `may ${id} run?`): JudgeQuestion {
  return { id, kind: 'noul', text }
}

describe('planJudgeBatches', () => {
  it('puts the state first and the questions last in one batch', () => {
    const plan = planJudgeBatches({
      stateText: 'rm -rf /tmp/cache',
      questions: [noul('q1'), noul('q2')],
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 32_000,
      measureTokens,
    })
    expect(plan.refused).toBeUndefined()
    if (plan.batches === undefined) {
      throw new Error('expected batches')
    }
    expect(plan.batches).toHaveLength(1)
    const batch = plan.batches[0]
    if (batch === undefined) {
      throw new Error('expected a batch')
    }
    const stateAt = batch.user.indexOf('rm -rf /tmp/cache')
    const firstQuestionAt = batch.user.indexOf('Question: may q1 run?')
    expect(stateAt).toBeGreaterThanOrEqual(0)
    expect(firstQuestionAt).toBeGreaterThan(stateAt)
    expect(batch.questionIds).toEqual(['q1', 'q2'])
  })

  it('splits questions across requests, each carrying the full state', () => {
    const plan = planJudgeBatches({
      stateText: 'the full state',
      questions: [noul('q1'), noul('q2'), noul('q3')],
      wording,
      maxQuestionsPerBatch: 2,
      contextTokenLimit: 32_000,
      measureTokens,
    })
    if (plan.batches === undefined) {
      throw new Error('expected batches')
    }
    expect(plan.batches).toHaveLength(2)
    for (const batch of plan.batches) {
      expect(batch.user).toContain('the full state')
    }
    expect(plan.batches[0]?.questionIds).toEqual(['q1', 'q2'])
    expect(plan.batches[1]?.questionIds).toEqual(['q3'])
  })

  it('never sends a question id to the model', () => {
    const plan = planJudgeBatches({
      stateText: 'state',
      questions: [{ id: 'secret-id-7', kind: 'noul', text: 'is this risky?' }],
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 32_000,
      measureTokens,
    })
    if (plan.batches === undefined) {
      throw new Error('expected batches')
    }
    const batch = plan.batches[0]
    if (batch === undefined) {
      throw new Error('expected a batch')
    }
    expect(batch.system).not.toContain('secret-id-7')
    expect(batch.user).not.toContain('secret-id-7')
  })

  it('refuses an over-context state instead of trimming or splitting it', () => {
    const plan = planJudgeBatches({
      stateText: 'a very long state',
      questions: [noul('q1', 'a short question')],
      wording,
      maxQuestionsPerBatch: 64,
      // Less than the state alone: no batching can fix this.
      contextTokenLimit: 1,
      measureTokens,
    })
    expect(plan).toEqual({ refused: 'over-context' })
  })

  it('still refuses when only the longest question overflows with the state', () => {
    const plan = planJudgeBatches({
      stateText: 'state',
      questions: [noul('short', 'ok?'), noul('long', `no${'o'.repeat(400)}`)],
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 10,
      measureTokens,
    })
    expect(plan).toEqual({ refused: 'over-context' })
  })

  it('renders choice options as letters and score levels as digits', () => {
    const plan = planJudgeBatches({
      stateText: 'state',
      questions: [
        { id: 'c', kind: 'choice', text: 'pick one', options: ['alpha', 'beta'] },
        { id: 's', kind: 'score', text: 'rate it', options: ['low', 'mid', 'high'] },
      ],
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 32_000,
      measureTokens,
    })
    if (plan.batches === undefined) {
      throw new Error('expected batches')
    }
    const user = plan.batches[0]?.user ?? ''
    expect(user).toContain('A. alpha')
    expect(user).toContain('B. beta')
    expect(user).toContain('0. low')
    expect(user).toContain('2. high')
  })

  it('splits by the complete request size, including labels and system text', () => {
    const state = 's'.repeat(60)
    const plan = planJudgeBatches({
      stateText: state,
      questions: ['q1', 'q2', 'q3'].map((id) => noul(id, 'q'.repeat(30))),
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 170,
      measureTokens: (text) => text.length,
    })
    expect(plan.refused).toBeUndefined()
    if (plan.batches === undefined) {
      throw new Error('expected batches')
    }
    expect(plan.batches.map((batch) => batch.questionIds)).toEqual([['q1'], ['q2'], ['q3']])
    for (const batch of plan.batches) {
      expect(batch.system.length + batch.user.length).toBeLessThanOrEqual(170)
      expect(batch.user).toContain(state)
    }
  })

  it('refuses a single complete request whose overhead exceeds the context', () => {
    expect(
      planJudgeBatches({
        stateText: 's'.repeat(60),
        questions: [noul('q1', 'q'.repeat(30))],
        wording,
        maxQuestionsPerBatch: 64,
        contextTokenLimit: 100,
        measureTokens: (text) => text.length,
      }),
    ).toEqual({ refused: 'over-context' })
  })

  it('admits the exact context boundary and refuses one token below it', () => {
    const inputs = {
      stateText: 'state',
      questions: [noul('q1', 'risky?')],
      wording,
      maxQuestionsPerBatch: 64,
      measureTokens: (text: string) => text.length,
    }
    const size =
      wording.systemInstruction.length +
      `${wording.stateLabel}state\n${wording.questionLabel}risky?`.length
    expect(planJudgeBatches({ ...inputs, contextTokenLimit: size }).batches).toHaveLength(1)
    expect(planJudgeBatches({ ...inputs, contextTokenLimit: size - 1 })).toEqual({
      refused: 'over-context',
    })
  })

  it('rejects malformed questions and limits instead of guessing', () => {
    const base = {
      stateText: 'state',
      wording,
      maxQuestionsPerBatch: 64,
      contextTokenLimit: 32_000,
      measureTokens,
    }
    expect(() => planJudgeBatches({ ...base, questions: [] })).toThrow(RangeError)
    expect(() =>
      planJudgeBatches({ ...base, questions: [noul('q')], maxQuestionsPerBatch: 0 }),
    ).toThrow(RangeError)
    for (const contextTokenLimit of [NaN, Infinity, -1]) {
      expect(() =>
        planJudgeBatches({ ...base, questions: [noul('q')], contextTokenLimit }),
      ).toThrow(RangeError)
    }
    expect(() =>
      planJudgeBatches({
        ...base,
        questions: [{ id: 'q', kind: 'noul', text: 'risky?', options: ['yes', 'no'] }],
      }),
    ).toThrow(RangeError)
    expect(() =>
      planJudgeBatches({
        ...base,
        questions: [{ id: 'q', kind: 'choice', text: 'pick?' }],
      }),
    ).toThrow(RangeError)
    expect(() =>
      planJudgeBatches({
        ...base,
        questions: [
          {
            id: 'q',
            kind: 'choice',
            text: 'pick?',
            options: Array.from({ length: 27 }, (_, i) => `o${String(i)}`),
          },
        ],
      }),
    ).toThrow(RangeError)
    expect(() =>
      planJudgeBatches({ ...base, questions: [noul('q')], measureTokens: () => NaN }),
    ).toThrow(RangeError)
  })
})
