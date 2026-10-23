import * as z from 'zod/mini'
import { failureForLog } from '../../core/backends/musecode/logText'
import { Usd } from '../../shared/usd'
import { legacyUsdSchema } from '../../shared/usdSchema'
import type { GlobLimits } from '../../core/backends/modelapi/glob'
import type { Logger } from '../../host/logger'
import {
  evaluateLintUnit,
  type LintEvaluator,
  type LintUnitResult,
} from '../../core/judge/lint/evaluate'
import {
  formatLintReport,
  lintExitCode,
  type LintFinding,
  type LintReport,
  type LintReportWording,
} from '../../core/judge/lint/report'
import { isLintRuleApplicable, type LintRule } from '../../core/judge/lint/rules'
import {
  extractLintFile,
  unitSchema,
  type LintCoverage,
  type LintExtractors,
  type LintFile,
  type LintUnit,
} from '../../core/judge/lint/units'

export interface JudgeLintDependencies {
  readonly log?: Logger | undefined
  /** Pinned, strict config/pack decoding; no alternate Muse keys in jevlint.json. */
  rules(): Promise<readonly LintRule[]>
  files(isChanged: boolean): Promise<readonly LintFile[]>
  readonly extractors: LintExtractors
  readonly evaluator: LintEvaluator
  readonly globLimits: GlobLimits
  readonly maxLocalizedRegions: number
  readonly wording: LintReportWording
  /** An absent installed grammar/localization provider returns undefined, not empty success. */
  localize(file: LintFile, unit: LintUnit, limit: number): Promise<unknown>
  /** Independent evidence only; another Jev belief cannot corroborate a Jev finding. */
  corroborate(file: LintFile, result: LintUnitResult): Promise<boolean>
}

const optionsSchema = z.strictObject({
  changed: z.optional(z.boolean()),
  failOn: z.optional(z.enum(['error', 'warning'])),
  budgetUsd: z.optional(legacyUsdSchema),
  format: z.optional(z.enum(['text', 'json', 'sarif'])),
})

export type JudgeLintOptions = z.infer<typeof optionsSchema>

const errorCodes: ReadonlySet<string> = new Set([
  'lint-answer-alignment',
  'lint-answer-distribution',
  'lint-rule-id-duplicate',
  'lint-confidence-invalid',
  'lint-context-too-large',
  'lint-source-changed',
  'lint-no-input',
  'lint-options-invalid',
  'lint-localization-invalid',
  'lint-extraction-invalid',
  'lint-symbol-range-invalid',
  'lint-config-invalid',
  'lint-pack-path-invalid',
  'lint-pack-pin-mismatch',
  'lint-pack-language-missing',
  'lint-eval-rule-unknown',
  'lint-eval-duplicate',
  'lint-eval-no-units',
])

function position(source: string, offset: number) {
  const lines = source.slice(0, offset).split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

async function findingFor(
  file: LintFile,
  result: LintUnitResult,
  deps: JudgeLintDependencies,
  isGate: boolean,
): Promise<LintFinding> {
  const start = position(file.source, result.unit.start)
  const end = position(file.source, result.unit.end)
  const isExperimental = result.provenance === 'experimental-systemone'
  return {
    path: file.path,
    ruleId: result.rule.id,
    severity: result.rule.severity,
    unit: result.unit,
    decision: result.decision,
    advisory: !isGate || (isExperimental && !(await deps.corroborate(file, result))),
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

/** G owns parsing/dispatch. This entry neither starts a backend nor writes ACP frames. */
export async function runJudgeLint(
  rawOptions: unknown,
  deps: JudgeLintDependencies,
  signal: AbortSignal,
): Promise<{ readonly report: LintReport; readonly exitCode: 0 | 1 | 2; readonly output: string }> {
  const findings: LintFinding[] = []
  const coverage: LintCoverage[] = []
  const checkedUnits = new Map<number, number>()
  const identity = { ...deps.evaluator.identity }
  const assertCurrent = () => {
    signal.throwIfAborted()
    if (
      Object.entries(identity).some(
        ([key, value]) => Reflect.get(deps.evaluator.identity, key) !== value,
      )
    ) {
      throw new Error('lint-source-changed')
    }
  }
  let isIncomplete = false
  let error: string | undefined
  const parsed = optionsSchema.safeParse(rawOptions)
  const options: JudgeLintOptions = parsed.success ? parsed.data : {}
  try {
    if (!parsed.success) throw new Error('lint-options-invalid')
    assertCurrent()
    const rules = await deps.rules()
    assertCurrent()
    const files = await deps.files(options.changed ?? false)
    assertCurrent()
    if (files.length === 0 || rules.length === 0) throw new Error('lint-no-input')
    let judgedUnits = 0
    for (const file of files) {
      const fileRules = rules.filter((rule) =>
        rule.kinds.some((kind) => isLintRuleApplicable(rule, file.path, kind, deps.globLimits)),
      )
      if (fileRules.length === 0) continue
      const extraction = await extractLintFile(
        file,
        [...new Set(fileRules.flatMap((rule) => rule.kinds))],
        deps.extractors,
      )
      assertCurrent()
      const baseCoverage = coverage.length
      coverage.push(...extraction.coverage)
      for (const unit of extraction.units) {
        const applicable = fileRules.filter((rule) =>
          isLintRuleApplicable(rule, file.path, unit.kind, deps.globLimits),
        )
        const results = await evaluateLintUnit(
          file,
          unit,
          applicable,
          deps.evaluator,
          options.budgetUsd ?? Usd.from(0).toAmount(),
          signal,
        )
        assertCurrent()
        if (results.length === 0) continue
        judgedUnits += 1
        if (
          results.every(
            (result) =>
              result.decision.outcome !== 'inconclusive' && result.decision.outcome !== 'abstain',
          )
        ) {
          const index = coverage.findIndex(
            (row, position) => position >= baseCoverage && row.kind === unit.kind,
          )
          checkedUnits.set(index, (checkedUnits.get(index) ?? 0) + 1)
        }
        for (const result of results) {
          if (result.decision.outcome === 'inconclusive' || result.decision.outcome === 'abstain')
            isIncomplete = true
          if (result.decision.outcome !== 'fail') continue
          const finding = await findingFor(file, result, deps, options.failOn !== undefined)
          assertCurrent()
          findings.push(finding)
          if (result.rule.localize.length === 0) continue
          const rawRegions = await deps.localize(file, unit, deps.maxLocalizedRegions)
          assertCurrent()
          if (rawRegions === undefined) {
            isIncomplete = true
            coverage.push({
              path: file.path,
              language: file.language,
              kind: 'localize',
              units: 0,
              status: 'not-checked',
              reason: 'missing-localizer',
            })
            continue
          }
          const suppliedRegions = z.array(unitSchema).parse(rawRegions)
          if (
            suppliedRegions.length > deps.maxLocalizedRegions ||
            suppliedRegions.some(
              (region) =>
                region.start < unit.start || region.end > unit.end || region.end <= region.start,
            )
          ) {
            throw new Error('lint-localization-invalid')
          }
          const regions = suppliedRegions.filter((region) =>
            result.rule.localize.includes(region.kind),
          )
          if (regions.length === 0) {
            isIncomplete = true
            coverage.push({
              path: file.path,
              language: file.language,
              kind: 'localize',
              units: 0,
              status: 'not-checked',
              reason: 'no-regions',
            })
            continue
          }
          const localizedIndex = coverage.length
          coverage.push({
            path: file.path,
            language: file.language,
            kind: 'localize',
            units: regions.length,
            status: 'checked',
          })
          for (const region of regions) {
            const localized = await evaluateLintUnit(
              file,
              region,
              [result.rule],
              deps.evaluator,
              options.budgetUsd ?? Usd.from(0).toAmount(),
              signal,
              unit,
            )
            assertCurrent()
            if (
              localized.length > 0 &&
              localized.every(
                (detail) =>
                  detail.decision.outcome !== 'inconclusive' &&
                  detail.decision.outcome !== 'abstain',
              )
            ) {
              checkedUnits.set(localizedIndex, (checkedUnits.get(localizedIndex) ?? 0) + 1)
            }
            for (const detail of localized) {
              if (detail.decision.outcome === 'fail') {
                const localizedFinding = await findingFor(
                  file,
                  detail,
                  deps,
                  options.failOn !== undefined,
                )
                assertCurrent()
                findings.push(localizedFinding)
              } else if (
                detail.decision.outcome === 'inconclusive' ||
                detail.decision.outcome === 'abstain'
              )
                isIncomplete = true
            }
          }
        }
      }
    }
    if (judgedUnits === 0) isIncomplete = true
    if (coverage.some((row) => row.status === 'not-checked')) isIncomplete = true
    assertCurrent()
  } catch (error_: unknown) {
    isIncomplete = true
    // Never echo provider/tool exceptions, which can contain source or credentials.
    deps.log?.warn(`Judge lint run failed: ${failureForLog(error_)}`)
    error =
      error_ instanceof Error && errorCodes.has(error_.message) ? error_.message : 'lint-run-failed'
    if (error === 'lint-source-changed') {
      findings.length = 0
      checkedUnits.clear()
    }
  }
  const actualCoverage: LintCoverage[] = coverage.map((row, index) => {
    if (row.status === 'not-checked') return row
    const count = checkedUnits.get(index) ?? 0
    return count === row.units
      ? row
      : { ...row, units: count, status: 'not-checked', reason: 'no-answer' }
  })
  const report: LintReport = {
    findings,
    coverage: actualCoverage,
    incomplete: isIncomplete || actualCoverage.some((row) => row.status === 'not-checked'),
    ...(error !== undefined && { error }),
  }
  return {
    report,
    exitCode: lintExitCode(report, options.failOn),
    output: formatLintReport(report, options.format ?? 'text', deps.wording),
  }
}
