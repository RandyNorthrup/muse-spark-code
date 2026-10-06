// Lane M98-0: the judge contract (PLAN.md M98 acceptance item 2). Jev
// shapes for noul, choice and score; the bounds refuse 65 questions, 27
// options, 11 levels and an oversized body; `answers` stays byte-compatible;
// log summaries carry no content.

import { describe, expect, it } from 'vitest'
import { isJudgeEngineOn } from '../../src/core/judge/engine'
import {
  jevAnswerSchema,
  judgeLogSummary,
  judgeOptionIndex,
  judgeOptionLetter,
  judgeRequestBytes,
  judgeRequestSchema,
  judgeResultSchema,
  type JevAnswer,
  type JudgeMuse,
  type JudgeQuestion,
  type JudgeRequest,
  type JudgeResult,
} from '../../src/core/judge/schema'
import {
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_CHOICE_OPTION_MAX,
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MIN_READY_RATE,
  JUDGE_QUESTION_MAX,
  JUDGE_SCORE_LEVEL_MAX,
  JUDGE_TOP1_MIN_PROB,
  MACHINE_SCOPED_SETTINGS,
  PAID_FEATURE_SETTINGS,
  PAID_FEATURES,
  SETTING_DEFAULTS,
} from '../../src/shared/constants'

/** One question of each kind, inside every bound. */
function oneOfEach(): Record<string, JudgeQuestion> {
  return {
    risky: {
      type: 'noul',
      instructions: 'Can this command delete data irreversibly?',
      criteria: { true: 'deletes or overwrites', false: 'leaves data alone' },
    },
    status: {
      type: 'choice',
      instructions: 'What is the work state?',
      criteria: { A: 'blocked', B: 'ready' },
    },
    grade: {
      type: 'score',
      instructions: 'How bad is the miss?',
      criteria: ['Trivial', 'Minor', 'Serious'],
    },
  }
}

/** A vendor response in the documented `/v1/systemone` shapes. */
function vendorResponse(): JudgeResult {
  return {
    model: 'typesafe/jev-1.13',
    answers: {
      // P(true); a noul carries no confidence.
      risky: { type: 'noul', noul: 0.97, probabilities: { true: 0.97, false: 0.03 } },
      // `abstain` is a real vendor addition (seen live): kept, not dropped.
      status: {
        type: 'choice',
        choice: 'B',
        confidence: 0.83,
        probabilities: { A: 0.1, B: 0.9 },
        abstain: 0.085,
      },
      grade: {
        type: 'score',
        score: 3.09,
        confidence: 0.9,
        legend: { '1': 'Trivial', '2': 'Minor', '3': 'Serious' },
        probabilities: { '1': 0.01, '2': 0.09, '3': 0.9 },
      },
    },
    muse: {
      risky: {
        source: 'same',
        technique: 'stated',
        model: 'muse-spark-1.3',
        label: 'uncalibrated',
        confidence: 0.94,
        partial: false,
        reservedCostUsd: 0.001,
        settledCostUsd: 0.0004,
      },
      status: {
        source: 'same',
        technique: 'logprob',
        model: 'muse-spark-1.3',
        label: 'calibrated (logprob)',
        confidence: 0.83,
        vendorConfidence: 0.83,
        partial: false,
      },
      grade: {
        source: 'same',
        technique: 'top1',
        model: 'muse-spark-1.3',
        label: 'approximate (top-1)',
        confidence: 0.9,
        partial: true,
      },
    },
    usage: { input_tokens: 491, output_tokens: 0 },
  }
}

describe('judge request bounds', () => {
  it('takes a state with one question of each kind', () => {
    const request: JudgeRequest = { state: 'rm -rf /tmp/cache', questions: oneOfEach() }
    const parsed = judgeRequestSchema.safeParse(request)
    expect(parsed.success).toBe(true)
  })

  it('takes an object or array state, never splitting it', () => {
    for (const state of [{ command: 'rm -rf /tmp/cache' }, ['rm -rf /tmp/cache']]) {
      expect(judgeRequestSchema.safeParse({ state, questions: oneOfEach() }).success).toBe(true)
    }
  })

  it('refuses an empty question set', () => {
    expect(judgeRequestSchema.safeParse({ state: 'x', questions: {} }).success).toBe(false)
  })

  it('refuses 65 questions', () => {
    // Literal 65: this test must fail if the bound moves, not follow it.
    expect(JUDGE_QUESTION_MAX).toBe(64)
    const questions: Record<string, unknown> = {}
    for (let index = 0; index < 65; index += 1) {
      questions[`q${String(index)}`] = { type: 'noul', instructions: 'Risky?' }
    }
    expect(judgeRequestSchema.safeParse({ state: 'x', questions }).success).toBe(false)
  })

  it('takes 64 questions', () => {
    const questions: Record<string, unknown> = {}
    for (let index = 0; index < 64; index += 1) {
      questions[`q${String(index)}`] = { type: 'noul', instructions: 'Risky?' }
    }
    expect(judgeRequestSchema.safeParse({ state: 'x', questions }).success).toBe(true)
  })

  it('refuses a single-option choice', () => {
    expect(
      judgeRequestSchema.safeParse({
        state: 'x',
        questions: { pick: { type: 'choice', instructions: 'Pick.', criteria: { A: 'only' } } },
      }).success,
    ).toBe(false)
  })

  it('refuses 27 options: no 27th letter exists', () => {
    // Literal 27: A–Z plus one more. Whatever the extra key is, the alphabet
    // holds 26, and the count bound with it.
    expect(JUDGE_CHOICE_OPTION_MAX).toBe(26)
    const criteria: Record<string, null> = { AA: null }
    for (let index = 0; index < 26; index += 1) {
      criteria[judgeOptionLetter(index)] = null
    }
    expect(Object.keys(criteria)).toHaveLength(27)
    const parsed = judgeRequestSchema.safeParse({
      state: 'x',
      questions: { pick: { type: 'choice', instructions: 'Pick.', criteria } },
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses option keys outside A–Z', () => {
    for (const key of ['AA', 'a', '1', '']) {
      const parsed = judgeRequestSchema.safeParse({
        state: 'x',
        questions: {
          pick: { type: 'choice', instructions: 'Pick.', criteria: { A: 'x', [key]: 'y' } },
        },
      })
      expect(parsed.success, key).toBe(false)
    }
  })

  it('refuses 11 levels', () => {
    // Literal 11: this test must fail if the bound moves, not follow it.
    expect(JUDGE_SCORE_LEVEL_MAX).toBe(10)
    const criteria = Array.from({ length: 11 }, (_, index) => `L${String(index)}`)
    expect(
      judgeRequestSchema.safeParse({
        state: 'x',
        questions: { grade: { type: 'score', instructions: 'Grade.', criteria } },
      }).success,
    ).toBe(false)
  })

  it('refuses an oversized body', () => {
    // Literal sizes: over the 64 KiB cap, so raising the cap breaks this.
    expect(JUDGE_MAX_BODY_BYTES).toBe(65_536)
    const parsed = judgeRequestSchema.safeParse({
      state: 'x'.repeat(70_000),
      questions: oneOfEach(),
    })
    expect(parsed.success).toBe(false)
  })

  it('measures the body in bytes, as the cap does', () => {
    expect(judgeRequestBytes({ state: 'abc', questions: {} })).toBe(
      new TextEncoder().encode(JSON.stringify({ state: 'abc', questions: {} })).length,
    )
  })
})

describe('Jev answers stay byte-compatible', () => {
  it('parses the documented noul, choice and score shapes', () => {
    const response = vendorResponse()
    const answers: Record<string, JevAnswer> = response.answers
    for (const [id, answer] of Object.entries(answers)) {
      expect(jevAnswerSchema.safeParse(answer).success, id).toBe(true)
    }
  })

  it('keeps vendor additions instead of dropping them', () => {
    const parsed = jevAnswerSchema.safeParse({
      type: 'choice',
      choice: 'B',
      confidence: 0.83,
      probabilities: { A: 0.1, B: 0.9 },
      abstain: 0.085,
    })
    expect(parsed.success && parsed.data).toMatchObject({ abstain: 0.085 })
  })

  it('reads a missing field as failure, never certainty', () => {
    // No probabilities: not p(yes), a failed parse.
    expect(jevAnswerSchema.safeParse({ type: 'noul', noul: 0.97 }).success).toBe(false)
    // No confidence on a choice: a failed parse.
    expect(
      jevAnswerSchema.safeParse({ type: 'choice', choice: 'B', probabilities: { B: 1 } }).success,
    ).toBe(false)
    // An unknown question kind: a failed parse.
    expect(jevAnswerSchema.safeParse({ type: 'rank', order: ['A'] }).success).toBe(false)
  })

  it('keeps every answered id beside its muse note', () => {
    const parsed = judgeResultSchema.safeParse(vendorResponse())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.answers).toEqual(vendorResponse().answers)
    }
  })

  it('refuses a result whose muse notes do not match its answers', () => {
    const response = vendorResponse()
    const notes: Record<string, JudgeMuse> = response.muse
    expect(notes['risky']).toBeDefined()
    const muse: Record<string, JudgeMuse> = {}
    for (const [id, note] of Object.entries(notes)) {
      if (id !== 'risky') muse[id] = note
    }
    expect(judgeResultSchema.safeParse({ ...response, muse }).success).toBe(false)
    expect(
      judgeResultSchema.safeParse({
        ...response,
        muse: { ...response.muse, orphan: response.muse['risky'] },
      }).success,
    ).toBe(false)
  })
})

describe('judge option letters', () => {
  it('letters options A–Z and back', () => {
    expect(judgeOptionLetter(0)).toBe('A')
    expect(judgeOptionLetter(25)).toBe('Z')
    expect(judgeOptionIndex('A')).toBe(0)
    expect(judgeOptionIndex('Z')).toBe(25)
    for (let index = 0; index < JUDGE_CHOICE_OPTION_MAX; index += 1) {
      expect(judgeOptionIndex(judgeOptionLetter(index))).toBe(index)
    }
  })

  it('refuses anything past Z', () => {
    expect(() => judgeOptionLetter(26)).toThrow()
    expect(() => judgeOptionLetter(-1)).toThrow()
    expect(() => judgeOptionIndex('AA')).toThrow()
    expect(() => judgeOptionIndex('a')).toThrow()
  })
})

describe('judge logs carry no content', () => {
  it('summarizes ids, source, technique, model and cost only', () => {
    const parsed = judgeResultSchema.safeParse(vendorResponse())
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const summary = judgeLogSummary(parsed.data)
    expect(summary.ids).toEqual(['risky', 'status', 'grade'])
    expect(summary.model).toBe('typesafe/jev-1.13')
    const text = JSON.stringify(summary)
    for (const content of [
      'rm -rf',
      'Can this command',
      'What is the work state',
      'blocked',
      'Serious',
      'abstain',
    ]) {
      expect(text).not.toContain(content)
    }
  })
})

describe('judge feature and engine wiring', () => {
  it('is a paid feature read off the engine, on by default and machine-scoped', () => {
    expect(PAID_FEATURES).toContain('judge')
    expect(PAID_FEATURE_SETTINGS.judge).toBe('judge.engine')
    expect(SETTING_DEFAULTS['judge.engine']).toBe('auto')
    expect(MACHINE_SCOPED_SETTINGS).toContain('judge.engine')
    expect(isJudgeEngineOn('auto')).toBe(true)
    expect(isJudgeEngineOn('same')).toBe(true)
    expect(isJudgeEngineOn('off')).toBe(false)
  })

  it('holds the RVM98 counterexample under the top-1 floor', () => {
    // P(no) = 0.60 with P(yes) = 0.10 must fall back, never complement.
    expect(JUDGE_TOP1_MIN_PROB).toBeGreaterThan(0.6)
    expect(JUDGE_TOP1_MIN_PROB).toBeLessThanOrEqual(1)
    expect(JUDGE_ADVISORY_THRESHOLD).toBeGreaterThan(0)
    expect(JUDGE_ADVISORY_THRESHOLD).toBeLessThan(1)
    expect(JUDGE_MIN_READY_RATE).toBeGreaterThan(0)
    expect(JUDGE_MIN_READY_RATE).toBeLessThanOrEqual(1)
  })
})
