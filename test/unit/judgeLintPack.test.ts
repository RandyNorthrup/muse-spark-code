import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { evaluateLintUnit } from '../../src/core/judge/lint/evaluate'
import { Usd } from '../../src/shared/usd'
import {
  decodeLintConfig,
  decodeLintPackRules,
  normalizeLintRules,
} from '../../src/core/judge/lint/config'
import { decodeLintPackManifest, decodeLintEvals } from '../../src/core/judge/lint/formats'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { lintEvaluator, lintResponse, lintRule } from './helpers/judgeLint'

const root = path.resolve(import.meta.dirname, '../..')
const manifestSchema = z.strictObject({
  cases: z.array(
    z.strictObject({
      rule: z.string(),
      fixture: z.string(),
      expect: z.enum(['pass', 'fail']),
      reason: z.string(),
    }),
  ),
})
const manifest = manifestSchema.parse(
  JSON.parse(
    await readFile(path.resolve(root, 'test/fixtures/judge/lint/standard-evals.json'), 'utf8'),
  ),
)

describe('first-party lint criterion inventory', () => {
  it('ships strict upstream pack/rules/evals with the same twelve independent fixtures', async () => {
    const packDir = path.resolve(root, 'skills/judge-lint')
    const pack = decodeLintPackManifest(await readFile(path.resolve(packDir, 'pack.json'), 'utf8'))
    expect(pack).toEqual({
      version: 1,
      id: 'muse-spark-code/high-quality-projects',
      languages: ['javascript'],
      rules: 'rules.json',
      evals: 'jevlint-evals.json',
    })
    const rules = decodeLintPackRules(await readFile(path.resolve(packDir, pack.rules!), 'utf8'))
    const cfg = decodeLintConfig(
      JSON.stringify({ languages: { javascript: { extensions: ['.txt'] } }, rules }),
    )
    expect(normalizeLintRules(cfg).map((rule) => rule.id)).toEqual([
      ...new Set(manifest.cases.map((item) => item.rule)),
    ])
    const evals = decodeLintEvals(await readFile(path.resolve(packDir, pack.evals!), 'utf8'), cfg)
    expect(evals.cases).toHaveLength(12)
    for (const item of evals.cases) {
      const label = manifest.cases.find(
        (label) => label.rule === item.rule && label.expect === item.expect,
      )!
      const actual = await readFile(path.resolve(packDir, item.file), 'utf8')
      const expected = await readFile(
        path.resolve(root, 'test/fixtures/judge/lint', label.fixture),
        'utf8',
      )
      expect(actual).toBe(expected)
    }
    const offlineDir = path.resolve(root, 'test/fixtures/judge/lint/upstream')
    expect(
      decodeLintConfig(await readFile(path.resolve(offlineDir, 'jevlint.json'), 'utf8')),
    ).toEqual(cfg)
    const offlineEvals = decodeLintEvals(
      await readFile(path.resolve(offlineDir, 'jevlint-evals.json'), 'utf8'),
      cfg,
    )
    expect(offlineEvals.cases.map((item) => [item.rule, item.expect])).toEqual(
      evals.cases.map((item) => [item.rule, item.expect]),
    )
  })
  it('has all six standards and independently labelled pass/fail pairs', async () => {
    const standards = await readFile(path.resolve(root, 'skills/judge-lint/standards.md'), 'utf8')
    const expected = [
      'no-silent-fallback',
      'no-placeholder-production-code',
      'no-production-mock-data',
      'actionable-errors',
      'explained-values',
      'honest-function-names',
    ]
    expect(manifest.cases).toHaveLength(12)
    expect([...new Set(manifest.cases.map((item) => item.rule))]).toEqual(expected)
    for (const id of expected) {
      expect(standards).toContain(`## ${id}`)
      expect(manifest.cases.filter((item) => item.rule === id).map((item) => item.expect)).toEqual([
        'pass',
        'fail',
      ])
    }
  })

  it.each(manifest.cases)(
    'preserves the $rule $expect fixture through the offline evaluator',
    async (item) => {
      expect(item.fixture).toMatch(/^standards\/[a-z-]+-(pass|fail)\.txt$/)
      const source = await readFile(
        path.resolve(root, 'test/fixtures/judge/lint', item.fixture),
        'utf8',
      )
      expect(source.trim().length).toBeGreaterThan(0)
      expect(item.reason.length).toBeGreaterThan(0)
      const evaluator = lintEvaluator()
      const active = {
        ...evaluator,
        judgeAdmitted: (request: JudgeRequest) => {
          expect(JSON.stringify(request.state)).toContain(source.replaceAll('\n', String.raw`\n`))
          return Promise.resolve(lintResponse(request, item.expect === 'pass' ? 'A' : 'B'))
        },
      }
      const results = await evaluateLintUnit(
        { path: item.fixture, language: 'javascript', source },
        { kind: 'function', name: '', start: 0, end: source.length },
        [lintRule({ id: item.rule })],
        active,
        Usd.from(0).toAmount(),
        new AbortController().signal,
      )
      expect(results[0]?.decision.outcome).toBe(item.expect)
    },
  )
})
