import { describe, expect, it, vi } from 'vitest'
import { runLintEvals } from '../../src/core/judge/lint/evals'
import type { LintDecision } from '../../src/core/judge/lint/cache'
import { lintRule } from './helpers/judgeLint'

const document = {
  version: 1,
  cases: [{ rule: 'rule', file: 'fixture.js', expect: 'pass' }],
} as const
const file = { path: 'fixture.js', language: 'javascript', source: 'function f() {}' }
const deps = (outcomes: readonly LintDecision['outcome'][]) => ({
  fixture: vi.fn().mockResolvedValue(file),
  evaluate: vi.fn().mockResolvedValue(outcomes.map((outcome) => ({ outcome, confidence: 1 }))),
})

describe('upstream eval scoring mechanics', () => {
  it.each([
    [['pass'], 'pass', 0],
    [['pass', 'pass'], 'pass', 0],
    [['pass', 'fail'], 'fail', 1],
    [['fail', 'abstain'], 'fail', 1],
    [['pass', 'skip'], 'pass', 0],
    [['pass', 'abstain'], 'pass', 0],
    [['inconclusive'], 'inconclusive', 1],
    [['skip'], 'inconclusive', 1],
    [['abstain'], 'inconclusive', 1],
  ] as const)('scores %j as %s', async (outcomes, outcome, exitCode) => {
    const result = await runLintEvals(
      document,
      [lintRule()],
      deps(outcomes),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ exitCode, cases: [{ outcome, matched: exitCode === 0 }] })
  })

  it('matches an independently labelled failure and never matches inconclusive', async () => {
    const fail = { ...document, cases: [{ ...document.cases[0], expect: 'fail' as const }] }
    const matched = await runLintEvals(
      fail,
      [lintRule()],
      deps(['fail']),
      new AbortController().signal,
    )
    const unsure = await runLintEvals(
      fail,
      [lintRule()],
      deps(['inconclusive']),
      new AbortController().signal,
    )
    const empty = await runLintEvals(
      { version: 1, cases: [] },
      [],
      deps([]),
      new AbortController().signal,
    )
    expect(matched.exitCode).toBe(0)
    expect(unsure.exitCode).toBe(1)
    expect(empty.exitCode).toBe(1)
  })

  it('rejects missing rules and propagates failed fixture reads', async () => {
    await expect(
      runLintEvals(document, [lintRule()], deps([]), new AbortController().signal),
    ).rejects.toThrow('lint-eval-no-units')
    await expect(
      runLintEvals(document, [], deps(['pass']), new AbortController().signal),
    ).rejects.toThrow('lint-eval-rule-unknown')
    await expect(
      runLintEvals(
        document,
        [lintRule()],
        { ...deps(['pass']), fixture: vi.fn().mockRejectedValue(new Error('fixture unavailable')) },
        new AbortController().signal,
      ),
    ).rejects.toThrow('fixture unavailable')
  })

  it.each(['before', 'fixture', 'evaluate'])('checks cancellation at %s', async (stage) => {
    const controller = new AbortController()
    const active = deps(['pass'])
    switch (stage) {
      case 'before': {
        controller.abort()
        break
      }
      case 'fixture': {
        active.fixture.mockImplementation(() => {
          controller.abort()
          return Promise.resolve(file)
        })
        break
      }
      case 'evaluate': {
        active.evaluate.mockImplementation(() => {
          controller.abort()
          return Promise.resolve([{ outcome: 'pass', confidence: 1 }])
        })
        break
      }
    }
    await expect(runLintEvals(document, [lintRule()], active, controller.signal)).rejects.toThrow()
  })

  it('keeps below-floor failures inconclusive even with an explicit pass', async () => {
    const active = deps(['pass'])
    active.evaluate.mockResolvedValue([
      { outcome: 'pass', confidence: 1 },
      { outcome: 'fail', confidence: 0.4 },
    ])
    const result = await runLintEvals(
      document,
      [lintRule({ minConfidence: 0.5 })],
      active,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      exitCode: 1,
      cases: [{ outcome: 'inconclusive', matched: false }],
    })
    active.evaluate.mockResolvedValue([
      { outcome: 'pass', confidence: 1 },
      { outcome: 'inconclusive', confidence: 0.4 },
    ])
    const unsure = await runLintEvals(document, [lintRule()], active, new AbortController().signal)
    expect(unsure.cases[0]?.outcome).toBe('inconclusive')
  })
})
