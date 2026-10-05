import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { decodeLintConfig, normalizeLintRules } from '../../src/core/judge/lint/config'
import { decodeLintEvals } from '../../src/core/judge/lint/formats'
import { runLintEvals } from '../../src/core/judge/lint/evals'
import { evaluateLintUnit } from '../../src/core/judge/lint/evaluate'
import { readLintSyntax } from '../../src/core/judge/lint/syntax'
import type { LintDecision } from '../../src/core/judge/lint/cache'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { lintEvaluator, lintResponse } from './helpers/judgeLint'

const root = new URL('../fixtures/judge/lint/upstream/', import.meta.url)
const read = (name: string) => readFile(new URL(name, root), 'utf8')
const replaySchema = z.looseObject({
  total: z.int(),
  matched: z.int(),
  mismatched: z.int(),
  inconclusive: z.int(),
  cases: z.array(
    z.strictObject({
      rule: z.string(),
      file: z.string(),
      expected: z.enum(['pass', 'fail']),
      actual: z.enum(['pass', 'fail', 'inconclusive']),
      matched: z.boolean(),
      decisions: z.strictObject({
        pass: z.int(),
        fail: z.int(),
        skip: z.int(),
        abstain: z.int(),
        reported: z.int(),
        belowFloor: z.int(),
      }),
    }),
  ),
})
const replay = z
  .strictObject({ upstream: replaySchema, firstParty: replaySchema })
  .parse(JSON.parse(await read('eval-replay.json')))

describe('executed pinned upstream doctor/eval receipts', () => {
  it.each([
    {
      name: 'upstream',
      config: 'pinned-jevlint.txt',
      evals: 'pinned-jevlint-evals.txt',
      native: replay.upstream,
    },
    {
      name: 'first-party',
      config: 'jevlint.json',
      evals: 'jevlint-evals.json',
      native: replay.firstParty,
    },
  ])(
    'matches the actual $name evaluator scoring replay',
    async ({ config: configName, evals, native }) => {
      const config = decodeLintConfig(await read(configName))
      const rules = normalizeLintRules(config)
      const document = decodeLintEvals(await read(evals), config)
      expect(document.cases).toHaveLength(native.total)
      const result = await runLintEvals(
        document,
        rules,
        {
          fixture: (name) => Promise.resolve({ path: name, source: '', language: 'replay-only' }),
          evaluate: (file, rule) => {
            const item = native.cases.find(
              (item) => item.file === file.path && item.rule === rule.id,
            )
            if (item === undefined) throw new Error('missing native replay')
            const decisions: LintDecision[] = []
            for (const outcome of ['pass', 'fail', 'skip', 'abstain'] as const) {
              for (let count = 0; count < item.decisions[outcome]; count += 1)
                decisions.push({ outcome, confidence: 1 })
            }
            return Promise.resolve(decisions)
          },
        },
        new AbortController().signal,
      )
      expect(result.exitCode).toBe(0)
      expect(
        result.cases.map(({ rule, file, expected, outcome, matched }) => ({
          rule,
          file,
          expected,
          actual: outcome,
          matched,
        })),
      ).toEqual(
        native.cases.map(({ rule, file, expected, actual, matched }) => ({
          rule,
          file,
          expected,
          actual,
          matched,
        })),
      )
    },
  )

  it('evaluates all twelve first-party fixtures with real captured grammar extraction', async () => {
    const config = decodeLintConfig(await read('jevlint.json'))
    const rules = normalizeLintRules(config)
    const document = decodeLintEvals(await read('jevlint-evals.json'), config)
    const captures = z
      .array(
        z.looseObject({
          path: z.string(),
          language: z.string(),
          source: z.string(),
          raw: z.unknown(),
        }),
      )
      .parse(JSON.parse(await read('first-party-syntax-capture.json')))
    let requests = 0
    const result = await runLintEvals(
      document,
      rules,
      {
        fixture: (name) => {
          const file = captures.find(
            (file) => path.posix.basename(file.path) === path.posix.basename(name),
          )
          if (file === undefined) throw new Error('missing native fixture')
          return Promise.resolve(file)
        },
        evaluate: async (file, rule, signal) => {
          const capture = captures.find((capture) => capture.path === file.path)
          if (capture === undefined) throw new Error('missing native tree')
          const syntax = readLintSyntax(file, capture.raw, 24)
          const evaluator = {
            ...lintEvaluator(),
            judgeAdmitted: vi.fn((request: JudgeRequest) => {
              requests += 1
              return Promise.resolve(
                lintResponse(request, file.path.endsWith('-fail.txt') ? 'B' : 'A'),
              )
            }),
          }
          const decisions: LintDecision[] = []
          for (const unit of syntax.units) {
            if (!rule.kinds.includes(unit.kind)) continue
            const results = await evaluateLintUnit(file, unit, [rule], evaluator, 0, signal)
            decisions.push(...results.map((result) => result.decision))
          }
          return decisions
        },
      },
      new AbortController().signal,
    )
    expect(requests).toBe(12)
    expect(result.exitCode).toBe(0)
    expect(
      result.cases.map(({ rule, expected, outcome, matched }) => ({
        rule,
        expected,
        actual: outcome,
        matched,
      })),
    ).toEqual(
      replay.firstParty.cases.map(({ rule, expected, actual, matched }) => ({
        rule,
        expected,
        actual,
        matched,
      })),
    )
  })
})
