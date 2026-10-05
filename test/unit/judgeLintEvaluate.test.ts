import { describe, expect, it, vi } from 'vitest'
import { evaluateLintUnit } from '../../src/core/judge/lint/evaluate'
import type { LintRule } from '../../src/core/judge/lint/rules'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { lintEvaluator, lintResponse, lintRule } from './helpers/judgeLint'

const file = {
  path: 'src/unit.ts',
  language: 'typescript',
  source: 'function outer() { return inner() }',
}
const unit = { kind: 'function', name: 'outer', start: 0, end: file.source.length } as const
const signal = () => new AbortController().signal

describe('batched lint evaluation', () => {
  it('preserves localized source, complete parent context and parent callees', async () => {
    const evaluator = lintEvaluator()
    const instructions = vi.fn(
      (rule: LintRule, isLocalized: boolean) =>
        `${rule.description} localized=${String(isLocalized)}`,
    )
    const callees = vi
      .fn()
      .mockResolvedValue([{ name: 'inner', path: 'src/inner.ts', source: 'function inner() {}' }])
    const judgeAdmitted = vi.fn((request: JudgeRequest) => Promise.resolve(lintResponse(request)))
    const region = {
      kind: 'statement',
      name: 'outer:return_statement',
      start: 19,
      end: 33,
    } as const
    await evaluateLintUnit(
      file,
      region,
      [lintRule({ callees: true })],
      {
        ...evaluator,
        wording: { ...evaluator.wording, instructions },
        callees,
        judgeAdmitted,
      },
      0,
      signal(),
      unit,
    )
    expect(judgeAdmitted.mock.calls[0]?.[0].state).toEqual({
      kind: 'region',
      name: region.name,
      path: file.path,
      language: file.language,
      source: file.source.slice(region.start, region.end),
      parentSource: file.source,
      regionKind: 'statement',
      callees: [{ name: 'inner', path: 'src/inner.ts', source: 'function inner() {}' }],
    })
    expect(callees).toHaveBeenCalledWith(file, unit)
    expect(instructions).toHaveBeenCalledWith(expect.any(Object), true)
  })

  it('admits exactly the upstream source-byte callee limit without charging metadata against it', async () => {
    const evaluator = lintEvaluator()
    const result = await evaluateLintUnit(
      file,
      unit,
      [lintRule({ callees: true })],
      {
        ...evaluator,
        callees: vi
          .fn()
          .mockResolvedValue([{ name: 'inner', path: 'src/inner.ts', source: 'x'.repeat(16_384) }]),
      },
      0,
      signal(),
    )
    expect(result[0]?.decision.outcome).toBe('pass')
  })

  it('batches applicable rules per unit and context group with the complete state', async () => {
    const evaluator = lintEvaluator()
    const judge = vi.fn((request: JudgeRequest, _budgetUsd: number, _signal: AbortSignal) =>
      Promise.resolve(lintResponse(request)),
    )
    const callees = vi
      .fn()
      .mockResolvedValue([
        { name: 'inner', path: 'src/inner.ts', source: 'function inner() { return 1 }' },
      ])
    const rules = [
      lintRule({ id: 'one' }),
      lintRule({ id: 'two' }),
      lintRule({ id: 'context', callees: true }),
    ]
    const results = await evaluateLintUnit(
      file,
      unit,
      rules,
      { ...evaluator, judgeAdmitted: judge, callees },
      0,
      signal(),
    )
    expect(results).toHaveLength(3)
    expect(judge).toHaveBeenCalledTimes(2)
    expect(Object.keys(judge.mock.calls[0]![0].questions)).toEqual(['one', 'two'])
    expect(judge.mock.calls[0]![0].state).toEqual({
      language: 'typescript',
      kind: 'function',
      name: 'outer',
      source: file.source,
      path: file.path,
    })
    expect(judge.mock.calls[1]![0].state).toEqual({
      language: 'typescript',
      kind: 'function',
      name: 'outer',
      source: file.source,
      path: file.path,
      callees: [{ name: 'inner', path: 'src/inner.ts', source: 'function inner() { return 1 }' }],
    })
    expect(callees).toHaveBeenCalledTimes(1)
    expect(judge.mock.calls[0]![1]).toBe(0)
  })

  it('redacts source and rule text before dispatch and source-free caching', async () => {
    const evaluator = lintEvaluator()
    const sentinel = 'password=synthetic-password-sentinel'
    const source = `function outer() { /* ${sentinel} */ }`
    const judge = vi.fn().mockImplementation((request: JudgeRequest) => {
      expect(JSON.stringify(request)).not.toContain('synthetic-password-sentinel')
      return Promise.resolve({ ...lintResponse(request), vendorExtra: source })
    })
    const result = await evaluateLintUnit(
      { ...file, source },
      { ...unit, end: source.length },
      [lintRule({ description: sentinel })],
      { ...evaluator, judgeAdmitted: judge },
      0,
      signal(),
    )
    expect(result[0]?.decision.outcome).toBe('pass')
    expect(JSON.stringify(evaluator.cache)).not.toContain(source)
    expect(JSON.stringify(evaluator.cache)).not.toContain('synthetic-password-sentinel')
  })

  it('reuses only validated complete results and reapplies a stricter threshold', async () => {
    const evaluator = lintEvaluator()
    const judge = vi
      .fn()
      .mockImplementation((request: JudgeRequest) =>
        Promise.resolve(lintResponse(request, 'B', 0.95)),
      )
    const active = { ...evaluator, judgeAdmitted: judge }
    const first = await evaluateLintUnit(file, unit, [lintRule()], active, 0, signal())
    const second = await evaluateLintUnit(
      file,
      unit,
      [lintRule({ minConfidence: 1 })],
      active,
      0,
      signal(),
    )
    expect(first[0]?.decision.outcome).toBe('fail')
    expect(second[0]?.decision.outcome).toBe('inconclusive')
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('keeps uncertain output inconclusive despite high vendor confidence', async () => {
    const evaluator = lintEvaluator()
    const judge = vi
      .fn()
      .mockImplementation((request: JudgeRequest) =>
        Promise.resolve(lintResponse(request, 'B', 0.51)),
      )
    const result = await evaluateLintUnit(
      file,
      unit,
      [lintRule()],
      { ...evaluator, judgeAdmitted: judge },
      0,
      signal(),
    )
    expect(result[0]?.decision.outcome).toBe('inconclusive')
    expect(evaluator.cache.toJSON()).toEqual([])
  })

  it('does not treat a partial answer as a complete verdict', async () => {
    const evaluator = lintEvaluator()
    const judge = vi.fn().mockImplementation((request: JudgeRequest) => {
      const result = lintResponse(request)
      return Promise.resolve({
        ...result,
        muse: { rule: { ...result.muse['rule'], partial: true } },
      })
    })
    const results = await evaluateLintUnit(
      file,
      unit,
      [lintRule()],
      { ...evaluator, judgeAdmitted: judge },
      0,
      signal(),
    )
    expect(results[0]?.decision.outcome).toBe('inconclusive')
  })

  it.each([
    { model: 'wrong-model' },
    {
      answers: {
        wrong: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, B: 0 } },
      },
    },
    {
      answers: {
        rule: { type: 'choice', choice: 'C', confidence: 1, probabilities: { A: 1, B: 0 } },
      },
    },
    {
      answers: {
        rule: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 0.8, B: 0 } },
      },
    },
    { answers: { rule: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1 } } } },
    {
      answers: {
        rule: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, C: 0 } },
      },
    },
    {
      answers: {
        rule: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, B: 0, C: 0 } },
      },
    },
    { usage: {} },
  ])('refuses malformed or misaligned responses %#', async (change) => {
    const evaluator = lintEvaluator()
    const judge = vi
      .fn()
      .mockImplementation((request: JudgeRequest) =>
        Promise.resolve({ ...lintResponse(request), ...change }),
      )
    await expect(
      evaluateLintUnit(
        file,
        unit,
        [lintRule()],
        { ...evaluator, judgeAdmitted: judge },
        0,
        signal(),
      ),
    ).rejects.toThrow()
    expect(evaluator.cache.toJSON()).toEqual([])
  })

  it.each(['source', 'model', 'extra-answer'] as const)(
    'refuses mismatched %s metadata',
    async (mismatch) => {
      const evaluator = lintEvaluator()
      const judgeAdmitted = (request: JudgeRequest) => {
        const result = lintResponse(request)
        const meta = result.muse['rule']!
        if (mismatch === 'extra-answer') {
          return Promise.resolve({
            ...result,
            answers: { ...result.answers, extra: result.answers['rule'] },
            muse: { ...result.muse, extra: meta },
          })
        }
        const changed =
          mismatch === 'source'
            ? { ...meta, source: 'separate' }
            : { ...meta, model: 'different-model' }
        return Promise.resolve({ ...result, muse: { rule: changed } })
      }
      await expect(
        evaluateLintUnit(file, unit, [lintRule()], { ...evaluator, judgeAdmitted }, 0, signal()),
      ).rejects.toThrow('lint-answer-alignment')
    },
  )

  it('refuses an oversized complete state without splitting or sending it', async () => {
    const evaluator = lintEvaluator()
    const source = 'x'.repeat(65_536)
    await expect(
      evaluateLintUnit(
        { ...file, source },
        { ...unit, end: source.length },
        [lintRule()],
        evaluator,
        0,
        signal(),
      ),
    ).rejects.toThrow()
    expect(evaluator.judgeAdmitted).not.toHaveBeenCalled()
  })

  it.each([
    { context: [{ name: 'inner', path: 'src/inner.ts', source: 'x'.repeat(16_385) }] },
    {
      context: Array.from({ length: 13 }, () => ({
        name: 'inner',
        path: 'src/inner.ts',
        source: 'body',
      })),
    },
    { context: [{ name: 'inner', path: 'src/inner.ts', source: 'body', key: 'unexpected' }] },
  ])('refuses oversized or unvalidated callee context %#', async ({ context }) => {
    const evaluator = lintEvaluator()
    await expect(
      evaluateLintUnit(
        file,
        unit,
        [lintRule({ callees: true })],
        { ...evaluator, callees: vi.fn().mockResolvedValue(context) },
        0,
        signal(),
      ),
    ).rejects.toThrow()
    expect(evaluator.judgeAdmitted).not.toHaveBeenCalled()
  })

  it('rebinds identity and cancellation after the callee await, before dispatch', async () => {
    const evaluator = lintEvaluator()
    const changed = { ...evaluator.identity }
    const active = {
      ...evaluator,
      identity: changed,
      callees: vi.fn().mockImplementation(() => {
        changed.endpoint = 'https://changed.invalid/systemone'
        return Promise.resolve([])
      }),
    }
    await expect(
      evaluateLintUnit(file, unit, [lintRule({ callees: true })], active, 0, signal()),
    ).rejects.toThrow('lint-source-changed')
    expect(active.judgeAdmitted).not.toHaveBeenCalled()
    const controller = new AbortController()
    const cancelled = {
      ...evaluator,
      callees: vi.fn().mockImplementation(() => {
        controller.abort()
        return Promise.resolve([])
      }),
    }
    await expect(
      evaluateLintUnit(file, unit, [lintRule({ callees: true })], cancelled, 0, controller.signal),
    ).rejects.toThrow()
    expect(cancelled.judgeAdmitted).not.toHaveBeenCalled()
  })

  it('discards cancelled or rebound results before caching', async () => {
    const evaluator = lintEvaluator()
    const identity = { ...evaluator.identity }
    const judge = vi.fn().mockImplementation((request: JudgeRequest) => {
      identity.profile = 'changed-profile'
      return Promise.resolve(lintResponse(request))
    })
    await expect(
      evaluateLintUnit(
        file,
        unit,
        [lintRule()],
        { ...evaluator, identity, judgeAdmitted: judge },
        0,
        signal(),
      ),
    ).rejects.toThrow('lint-source-changed')
    expect(evaluator.cache.toJSON()).toEqual([])
    const controller = new AbortController()
    const cancelled = vi.fn().mockImplementation((request: JudgeRequest) => {
      controller.abort()
      return Promise.resolve(lintResponse(request))
    })
    await expect(
      evaluateLintUnit(
        file,
        unit,
        [lintRule()],
        { ...evaluator, judgeAdmitted: cancelled },
        0,
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(evaluator.cache.toJSON()).toEqual([])
  })

  it('does not invoke any source for empty rules and rejects duplicate ids and invalid thresholds', async () => {
    const evaluator = lintEvaluator()
    expect(await evaluateLintUnit(file, unit, [], evaluator, 0, signal())).toEqual([])
    await expect(
      evaluateLintUnit(file, unit, [lintRule(), lintRule()], evaluator, 0, signal()),
    ).rejects.toThrow('lint-rule-id-duplicate')
    await expect(
      evaluateLintUnit(file, unit, [lintRule({ minConfidence: 2 })], evaluator, 0, signal()),
    ).rejects.toThrow('lint-confidence-invalid')
    expect(evaluator.judgeAdmitted).not.toHaveBeenCalled()
  })
})
