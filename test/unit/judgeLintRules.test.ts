import { describe, expect, it } from 'vitest'
import { lintQuestion, isLintRuleApplicable } from '../../src/core/judge/lint/rules'
import { lintEvaluator, lintRule } from './helpers/judgeLint'

describe('lint rule routing and choices', () => {
  it.each([
    [false, false, ['pass', 'fail']],
    [true, false, ['pass', 'fail', 'skip']],
    [false, true, ['pass', 'fail', 'abstain']],
    [true, true, ['pass', 'fail', 'skip', 'abstain']],
  ] as const)(
    'offers only enabled skip and abstain (%s, %s)',
    (allowSkip, allowAbstain, expected) => {
      const { wording } = lintEvaluator()
      const question = lintQuestion(lintRule({ allowSkip, allowAbstain }), wording)
      expect(Object.values(question.outcomes)).toEqual(expected)
      expect(question.question).toEqual({
        type: 'choice',
        instructions: 'Fixture rule',
        criteria: Object.fromEntries(
          Object.keys(question.outcomes).map((letter, index) => [
            letter,
            `fixture ${expected[index] ?? ''}`,
          ]),
        ),
      })
    },
  )

  it('passes exceptions and the full rule to the injected pinned wording', () => {
    const rule = lintRule({ exceptions: ['fixture exception'] })
    const { wording } = lintEvaluator()
    const question = lintQuestion(rule, {
      ...wording,
      instructions: (value) => `${value.description}: ${value.exceptions.join('; ')}`,
    })
    expect(question.question.instructions).toBe('Fixture rule: fixture exception')
  })

  it.each([
    ['src/main.ts', 'function', true],
    ['src/nested/main.ts', 'function', true],
    ['src/test/main.ts', 'function', false],
    ['src/main.js', 'function', false],
    ['src/main.ts', 'comment', false],
  ] as const)('routes %s %s to %s', (path, kind, expected) => {
    const rule = lintRule({ include: ['src/**/*.ts'], exclude: ['src/test/**'] })
    expect(isLintRuleApplicable(rule, path, kind, { maxLength: 256, maxAlternatives: 256 })).toBe(
      expected,
    )
  })

  it('allows any file when include is empty but preserves excludes and glob bounds', () => {
    expect(
      isLintRuleApplicable(lintRule(), 'any.ts', 'function', {
        maxLength: 256,
        maxAlternatives: 256,
      }),
    ).toBe(true)
    expect(() =>
      isLintRuleApplicable(lintRule({ include: ['a'.repeat(257)] }), 'any.ts', 'function', {
        maxLength: 256,
        maxAlternatives: 256,
      }),
    ).toThrow()
  })
})
