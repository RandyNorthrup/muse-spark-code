import { describe, expect, it, vi } from 'vitest'
import {
  runJudgeLint,
  type JudgeLintDependencies,
  type JudgeLintOptions,
} from '../../src/runtime/judge/lint'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { lintResponse, lintRule, lintRunDependencies } from './helpers/judgeLint'

const signal = () => new AbortController().signal
function localizedResponse(request: JudgeRequest) {
  return Promise.resolve(
    lintResponse(request, 'B', JSON.stringify(request.state).includes('function f') ? 1 : 0.51),
  )
}
function failing(deps = lintRunDependencies()): JudgeLintDependencies {
  return {
    ...deps,
    evaluator: {
      ...deps.evaluator,
      judgeAdmitted: vi.fn((request: JudgeRequest) => Promise.resolve(lintResponse(request, 'B'))),
    },
  }
}

describe('judge lint runtime entry', () => {
  it('keeps findings advisory by default and forwards changed and zero budget', async () => {
    const deps = failing()
    const options: JudgeLintOptions = { changed: true }
    const result = await runJudgeLint(options, deps, signal())
    expect(result.exitCode).toBe(0)
    expect(result.report.findings).toHaveLength(1)
    expect(result.report.findings[0]?.advisory).toBe(true)
    expect(deps.files).toHaveBeenCalledWith(true)
    expect(deps.evaluator.judgeAdmitted).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixture-model' }),
      0,
      expect.any(AbortSignal),
    )
    expect(deps.corroborate).not.toHaveBeenCalled()
  })

  it('fails only the explicitly selected independently supported severity gate', async () => {
    const deps = failing()
    await expect(runJudgeLint({ failOn: 'error' }, deps, signal())).resolves.toMatchObject({
      exitCode: 1,
    })
    const warning = {
      ...failing(),
      rules: vi.fn().mockResolvedValue([lintRule({ severity: 'warning' })]),
    }
    await expect(runJudgeLint({ failOn: 'error' }, warning, signal())).resolves.toMatchObject({
      exitCode: 0,
    })
    await expect(runJudgeLint({ failOn: 'warning' }, warning, signal())).resolves.toMatchObject({
      exitCode: 1,
    })
  })

  it('does not fail a gate solely on Jev or TypeSafe', async () => {
    const deps = failing()
    const experimental = {
      ...deps,
      evaluator: {
        ...deps.evaluator,
        identity: { ...deps.evaluator.identity, provenance: 'experimental-systemone' as const },
      },
    }
    const result = await runJudgeLint({ failOn: 'error' }, experimental, signal())
    expect(result.exitCode).toBe(0)
    expect(result.report.findings[0]?.advisory).toBe(true)
    expect(experimental.corroborate).toHaveBeenCalledTimes(1)
    const supported = { ...experimental, corroborate: vi.fn().mockResolvedValue(true) }
    await expect(runJudgeLint({ failOn: 'error' }, supported, signal())).resolves.toMatchObject({
      exitCode: 1,
    })
  })

  it.each(['json', 'sarif'] as const)('preserves findings and coverage in %s', async (format) => {
    const result = await runJudgeLint({ format }, failing(), signal())
    const parsed: unknown = JSON.parse(result.output)
    if (format === 'json') {
      expect(parsed).toEqual(result.report)
    } else {
      expect(parsed).toMatchObject({
        version: '2.1.0',
        runs: [
          {
            results: [
              {
                level: 'error',
                properties: { advisory: true },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: 'src/unit.ts' },
                      region: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 26 },
                    },
                  },
                ],
              },
            ],
            properties: { coverage: result.report.coverage, incomplete: false },
          },
        ],
      })
    }
  })

  it('reports unsupported languages, missing grammars and empty extraction without clean success', async () => {
    const deps = lintRunDependencies()
    const unsupported = {
      ...deps,
      files: vi
        .fn()
        .mockResolvedValue([{ path: 'unit.cs', language: 'csharp', source: 'class C {}' }]),
    }
    const result = await runJudgeLint({}, unsupported, signal())
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('csharp function: not-checked')
    expect(result.report.coverage[0]?.reason).toBe('unsupported-language')
    const empty = {
      ...deps,
      extractors: {
        ...deps.extractors,
        symbols: vi.fn().mockResolvedValue({ units: [], coveredKinds: ['function'] }),
      },
    }
    const noUnits = await runJudgeLint({}, empty, signal())
    expect(noUnits.exitCode).toBe(2)
    expect(noUnits.report.coverage[0]?.reason).toBe('no-units')
    const absent = {
      ...deps,
      extractors: {
        symbols: vi.fn().mockResolvedValue(undefined),
        syntax: vi.fn().mockResolvedValue(undefined),
      },
    }
    const missing = await runJudgeLint({}, absent, signal())
    expect(missing.report.coverage[0]?.reason).toBe('missing-extractor')
  })

  it('reports inconclusive and abstained judgments as incomplete', async () => {
    const deps = lintRunDependencies()
    const uncertain = {
      ...deps,
      evaluator: {
        ...deps.evaluator,
        judgeAdmitted: vi.fn((request: JudgeRequest) =>
          Promise.resolve(lintResponse(request, 'B', 0.51)),
        ),
      },
    }
    await expect(runJudgeLint({}, uncertain, signal())).resolves.toMatchObject({
      exitCode: 2,
      report: { coverage: [{ status: 'not-checked', units: 0, reason: 'no-answer' }] },
    })
    const abstained = {
      ...deps,
      rules: vi.fn().mockResolvedValue([lintRule({ allowAbstain: true })]),
      evaluator: {
        ...deps.evaluator,
        judgeAdmitted: vi.fn((request: JudgeRequest) =>
          Promise.resolve(lintResponse(request, 'C')),
        ),
      },
    }
    await expect(runJudgeLint({}, abstained, signal())).resolves.toMatchObject({ exitCode: 2 })
  })

  it('keeps a partially checked file incomplete when a comment grammar is missing', async () => {
    const deps = lintRunDependencies()
    const result = await runJudgeLint(
      {},
      {
        ...deps,
        rules: vi
          .fn()
          .mockResolvedValue([lintRule(), lintRule({ id: 'comments', kinds: ['comment'] })]),
      },
      signal(),
    )
    expect(result.report.coverage).toHaveLength(2)
    expect(result.report.coverage.map((row) => row.status)).toEqual(['checked', 'not-checked'])
    expect(result.exitCode).toBe(2)
  })

  it('counts only completely judged localized regions', async () => {
    const deps = lintRunDependencies()
    const result = await runJudgeLint(
      {},
      {
        ...deps,
        rules: vi.fn().mockResolvedValue([lintRule({ localize: true })]),
        evaluator: { ...deps.evaluator, judgeAdmitted: localizedResponse },
        localize: vi.fn().mockResolvedValue([{ kind: 'statement', name: '', start: 15, end: 23 }]),
      },
      signal(),
    )
    expect(result.exitCode).toBe(2)
    expect(result.report.coverage.at(-1)).toMatchObject({
      kind: 'localize',
      units: 0,
      status: 'not-checked',
      reason: 'no-answer',
    })
  })

  it('never echoes a provider message that merely looks like an internal reason code', async () => {
    const deps = lintRunDependencies()
    const result = await runJudgeLint(
      {},
      {
        ...deps,
        evaluator: {
          ...deps.evaluator,
          judgeAdmitted: vi.fn().mockRejectedValue(new Error('lint-private-source-sentinel')),
        },
      },
      signal(),
    )
    expect(result.report.error).toBe('lint-run-failed')
    expect(result.report.coverage[0]).toMatchObject({
      units: 0,
      status: 'not-checked',
      reason: 'no-answer',
    })
    expect(result.output).not.toContain('lint-private-source-sentinel')
  })

  it('evaluates bounded localized regions only after a failed rule', async () => {
    const deps = failing()
    const localize = vi
      .fn()
      .mockResolvedValue([{ kind: 'statement', name: '', start: 15, end: 23 }])
    const result = await runJudgeLint(
      { budgetUsd: 1 },
      { ...deps, rules: vi.fn().mockResolvedValue([lintRule({ localize: true })]), localize },
      signal(),
    )
    expect(result.exitCode).toBe(0)
    expect(result.report.findings).toHaveLength(2)
    expect(result.report.findings[1]?.unit).toEqual({
      kind: 'statement',
      name: '',
      start: 15,
      end: 23,
    })
    expect(result.report.coverage.at(-1)).toMatchObject({
      kind: 'localize',
      units: 1,
      status: 'checked',
    })
    expect(localize).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), 24)
    expect(deps.evaluator.judgeAdmitted).toHaveBeenCalledTimes(2)
  })

  it('does not localize passing rules and shows unavailable localization', async () => {
    const deps = lintRunDependencies()
    const rules = vi.fn().mockResolvedValue([lintRule({ localize: true })])
    await expect(runJudgeLint({}, { ...deps, rules }, signal())).resolves.toMatchObject({
      exitCode: 0,
    })
    expect(deps.localize).not.toHaveBeenCalled()
    const missing = await runJudgeLint({}, { ...failing(), rules }, signal())
    expect(missing.exitCode).toBe(2)
    expect(missing.report.coverage.at(-1)?.reason).toBe('missing-localizer')
    const empty = await runJudgeLint(
      {},
      { ...failing(), rules, localize: vi.fn().mockResolvedValue([]) },
      signal(),
    )
    expect(empty.exitCode).toBe(2)
    expect(empty.report.coverage.at(-1)?.reason).toBe('no-regions')
  })

  it.each([
    { regions: [{ kind: 'statement', name: '', start: 0, end: 999 }] },
    { regions: [{ kind: 'statement', name: '', start: 15, end: 15 }] },
    {
      regions: Array.from({ length: 25 }, () => ({
        kind: 'statement',
        name: '',
        start: 15,
        end: 23,
      })),
    },
  ])('rejects invalid or unbounded localization %#', async ({ regions }) => {
    const deps = {
      ...failing(),
      rules: vi.fn().mockResolvedValue([lintRule({ localize: true })]),
      localize: vi.fn().mockResolvedValue(regions),
    }
    const result = await runJudgeLint({}, deps, signal())
    expect(result.exitCode).toBe(2)
    expect(result.report.error).toBe('lint-localization-invalid')
    expect(deps.evaluator.judgeAdmitted).toHaveBeenCalledTimes(1)
  })

  it('keeps provider failures explicit without echoing their source or credential surroundings', async () => {
    const deps = lintRunDependencies()
    const failure = {
      ...deps,
      evaluator: {
        ...deps.evaluator,
        judgeAdmitted: vi.fn().mockRejectedValue(new Error('private source sentinel')),
      },
    }
    const result = await runJudgeLint({ format: 'sarif' }, failure, signal())
    expect(result.exitCode).toBe(2)
    expect(result.report.error).toBe('lint-run-failed')
    expect(result.output).not.toContain('private source sentinel')
    expect(JSON.parse(result.output)).toMatchObject({
      runs: [{ invocations: [{ executionSuccessful: false }] }],
    })
  })

  it.each([
    { budgetUsd: -1 },
    { budgetUsd: Infinity },
    { format: 'unknown' },
    { changed: 'yes' },
    { museSpark: true },
  ])('rejects invalid run options %# before reading files', async (options) => {
    const deps = lintRunDependencies()
    const result = await runJudgeLint(options, deps, signal())
    expect(result.exitCode).toBe(2)
    expect(result.report.error).toBe('lint-options-invalid')
    expect(deps.files).not.toHaveBeenCalled()
  })

  it('returns an error for empty or excluded input, rather than an empty successful run', async () => {
    const deps = lintRunDependencies()
    await expect(
      runJudgeLint({}, { ...deps, files: vi.fn().mockResolvedValue([]) }, signal()),
    ).resolves.toMatchObject({ exitCode: 2, report: { error: 'lint-no-input' } })
    await expect(
      runJudgeLint(
        {},
        { ...deps, rules: vi.fn().mockResolvedValue([lintRule({ exclude: ['**'] })]) },
        signal(),
      ),
    ).resolves.toMatchObject({ exitCode: 2 })
  })

  it('honors cancellation before configuration and after a held corroboration', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = lintRunDependencies()
    await expect(runJudgeLint({}, deps, controller.signal)).resolves.toMatchObject({ exitCode: 2 })
    expect(deps.rules).not.toHaveBeenCalled()
    const during = new AbortController()
    const active = failing()
    const experimental = {
      ...active,
      evaluator: {
        ...active.evaluator,
        identity: { ...active.evaluator.identity, provenance: 'experimental-systemone' as const },
      },
      corroborate: vi.fn().mockImplementation(() => {
        during.abort()
        return Promise.resolve(true)
      }),
    }
    await expect(
      runJudgeLint({ failOn: 'error' }, experimental, during.signal),
    ).resolves.toMatchObject({ exitCode: 2 })
  })
})
