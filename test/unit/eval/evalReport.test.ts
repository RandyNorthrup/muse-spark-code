import { describe, expect, it } from 'vitest'
import {
  evalReportSchema,
  formatEvalReportJson,
  formatEvalReportMarkdown,
  type EvalArmReport,
  type EvalReport,
  type EvalTaskResult,
} from '../../../src/core/eval/report'

function result(overrides: Partial<EvalTaskResult>): EvalTaskResult {
  return {
    taskId: 'accept-off-by-one',
    title: 'Fix the loop bound that reads past the end',
    split: 'accept',
    passed: true,
    terminal: 'completed',
    failures: [],
    attempts: 3,
    requests: 3,
    inputTokens: 600,
    cachedTokens: 200,
    outputTokens: 40,
    costUsd: 0.0001,
    toolCalls: 2,
    approvals: 0,
    questions: 0,
    paidRefusals: 0,
    ...overrides,
  }
}

function arm(name: string, results: readonly EvalTaskResult[], inputTokens: number): EvalArmReport {
  return {
    name,
    results: [...results],
    summaries: [
      {
        split: 'accept',
        tasks: 1,
        passed: 1,
        passRate: 1,
        attempts: 3,
        requests: 3,
        inputTokens,
        cachedTokens: 0,
        outputTokens: 40,
        costUsd: 0.0001,
      },
      {
        split: 'heldout',
        tasks: 1,
        passed: 0,
        passRate: 0,
        attempts: 9,
        requests: 9,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ],
  }
}

const FAILED = result({
  taskId: 'heldout-sort-numbers',
  split: 'heldout',
  passed: false,
  terminal: 'failed',
  failures: ['the turn ended failed: overloaded', 'the verifier failed: 1 !== 9'],
  attempts: 9,
})

function sample(): EvalReport {
  return {
    version: 1,
    model: 'muse-spark-1.3-contributor',
    generatedAt: '2026-09-28T00:00:00.000Z',
    arms: [arm('baseline', [result({}), FAILED], 600)],
    floors: [
      { arm: 'baseline', split: 'accept', tasks: 1, passRate: 1, floor: 0.75, held: true },
      { arm: 'baseline', split: 'heldout', tasks: 1, passRate: 0, floor: 0.75, held: false },
    ],
    verdict: 'fail',
  }
}

describe('eval report', () => {
  it('round-trips through its schema', () => {
    const rendered = formatEvalReportJson(sample())
    expect(rendered.endsWith('}\n')).toBe(true)
    expect(evalReportSchema.parse(JSON.parse(rendered))).toEqual(sample())
    expect(evalReportSchema.safeParse({ ...sample(), verdict: 'maybe' }).success).toBe(false)
  })

  it('renders the tasks, the splits, the failures and the floors', () => {
    const markdown = formatEvalReportMarkdown(sample())
    expect(markdown).toContain(
      'Model: muse-spark-1.3-contributor · generated 2026-09-28T00:00:00.000Z · verdict: fail',
    )
    expect(markdown).toContain(
      '| accept-off-by-one | accept | yes | completed | 3 | 3 | 600 | 200 | 40 | $0.0001 | 2 | 0 |',
    )
    expect(markdown).toContain(
      'accept: 1/1 passed (100%), 3 attempts in 3 requests, 600 input (0 cached) + 40 output tokens, $0.0001.',
    )
    expect(markdown).toContain(
      'heldout-sort-numbers failed:\n\n```text\nthe turn ended failed: overloaded\nthe verifier failed: 1 !== 9\n```',
    )
    expect(markdown).toContain('| baseline | heldout | 1 | 0% | 75% | no |')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('says when a split did not run and when a failure gave no reason', () => {
    const report = sample()
    const [baseline] = report.arms
    if (baseline === undefined) {
      throw new Error('the sample lost its arm')
    }
    const markdown = formatEvalReportMarkdown({
      ...report,
      arms: [
        {
          ...baseline,
          results: [{ ...FAILED, failures: [] }],
          summaries: baseline.summaries.map((summary) => ({ ...summary, tasks: 0 })),
        },
      ],
      floors: report.floors.map((floor) => ({ ...floor, tasks: 0, held: false })),
      verdict: 'incomplete',
    })
    expect(markdown).toContain('accept: not run.')
    expect(markdown).toContain('heldout-sort-numbers failed:\n\n```text\nno detail\n```')
    expect(markdown).toContain('| baseline | accept | 0 | 100% | 75% | not run |')
  })

  it('compares a mechanism with the baseline, split by split', () => {
    const report = sample()
    const markdown = formatEvalReportMarkdown({
      ...report,
      arms: [
        arm('baseline', [result({})], 600),
        { ...arm('mechanism', [result({ inputTokens: 450 })], 450), mechanism: 'packed output' },
      ],
    })
    expect(markdown).toContain('## Arm: mechanism\n\nMechanism: packed output')
    expect(markdown).toContain('## mechanism against baseline')
    expect(markdown).toContain('| accept | 100% → 100% | ±0% | -25% | ±0% | ±0% |')
    // The held-out split has no tokens on either side here.
    expect(markdown).toContain('| heldout | 0% → 0% | ±0% | ±0% | ±0% | ±0% |')
  })

  it('shows a change from nothing as such', () => {
    const report = sample()
    const grown = arm('mechanism', [result({})], 600)
    const markdown = formatEvalReportMarkdown({
      ...report,
      arms: [
        arm('baseline', [result({})], 0),
        {
          ...grown,
          summaries: grown.summaries.map((summary) => ({ ...summary, inputTokens: 10 })),
        },
      ],
    })
    expect(markdown).toContain('| accept | 100% → 100% | ±0% | from 0 |')
    expect(markdown).toContain('+')
  })

  it('leaves out a split the other arm did not run', () => {
    const report = sample()
    const baseline = arm('baseline', [result({})], 600)
    const markdown = formatEvalReportMarkdown({
      ...report,
      arms: [
        {
          ...baseline,
          summaries: baseline.summaries.map((summary) =>
            summary.split === 'heldout' ? { ...summary, tasks: 0 } : summary,
          ),
        },
        arm('mechanism', [result({})], 900),
      ],
    })
    expect(markdown).toContain('| accept | 100% → 100% | ±0% | +50% |')
    expect(markdown).not.toContain('| heldout | 0% → 0%')
  })
})
