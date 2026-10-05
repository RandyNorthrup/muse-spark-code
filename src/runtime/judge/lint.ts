import * as z from 'zod/mini'
import type { GlobLimits } from '../../core/backends/modelapi/glob'
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
  lintKinds,
  type LintCoverage,
  type LintExtractors,
  type LintFile,
  type LintUnit,
} from '../../core/judge/lint/units'

export interface JudgeLintOptions {
  readonly changed?: boolean
  readonly failOn?: 'error' | 'warning'
  readonly budgetUsd?: number
  readonly format?: 'text' | 'json' | 'sarif'
}

export interface JudgeLintDependencies {
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

const regionSchema = z.strictObject({
  kind: z.enum(lintKinds),
  name: z.string(),
  start: z.int().check(z.nonnegative()),
  end: z.int().check(z.nonnegative()),
})
const optionsSchema = z.strictObject({
  changed: z.optional(z.boolean()),
  failOn: z.optional(z.enum(['error', 'warning'])),
  budgetUsd: z.optional(z.number().check(z.nonnegative())),
  format: z.optional(z.enum(['text', 'json', 'sarif'])),
})

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
  let isIncomplete = false
  let error: string | undefined
  const parsed = optionsSchema.safeParse(rawOptions)
  const options = parsed.success ? parsed.data : {}
  try {
    if (!parsed.success) throw new Error('lint-options-invalid')
    signal.throwIfAborted()
    const rules = await deps.rules()
    const files = await deps.files(options.changed ?? false)
    signal.throwIfAborted()
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
          options.budgetUsd ?? 0,
          signal,
        )
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
          signal.throwIfAborted()
          findings.push(finding)
          if (result.rule.localize.length === 0) continue
          const rawRegions = await deps.localize(file, unit, deps.maxLocalizedRegions)
          signal.throwIfAborted()
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
          const suppliedRegions = z.array(regionSchema).parse(rawRegions)
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
              options.budgetUsd ?? 0,
              signal,
              unit,
            )
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
              if (detail.decision.outcome === 'fail')
                findings.push(await findingFor(file, detail, deps, options.failOn !== undefined))
              else if (
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
    signal.throwIfAborted()
  } catch (error_: unknown) {
    isIncomplete = true
    // Never echo provider/tool exceptions, which can contain source or credentials.
    error =
      error_ instanceof Error && errorCodes.has(error_.message) ? error_.message : 'lint-run-failed'
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
