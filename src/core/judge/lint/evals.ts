import type { LintDecision } from './cache'
import type { LintEvals } from './formats'
import type { LintRule } from './rules'
import type { LintFile } from './units'

export interface LintEvalDependencies {
  /** Uses the existing workspace-authorized reader, validates existence and grammar support. */
  fixture(name: string): Promise<LintFile>
  evaluate(file: LintFile, rule: LintRule, signal: AbortSignal): Promise<readonly LintDecision[]>
}

/** Reported failure wins; uncertainty beats pass; skip/abstain alone never pass. */
function outcomeFor(
  decisions: readonly LintDecision[],
  floor: number,
): 'pass' | 'fail' | 'inconclusive' {
  if (decisions.some((decision) => decision.outcome === 'fail' && decision.confidence >= floor))
    return 'fail'
  if (
    decisions.some(
      (decision) =>
        decision.outcome === 'inconclusive' ||
        (decision.outcome === 'fail' && decision.confidence < floor),
    )
  )
    return 'inconclusive'
  return decisions.some((decision) => decision.outcome === 'pass') ? 'pass' : 'inconclusive'
}

/** Offline replays prove scoring mechanics, never model accuracy or calibration. */
export async function runLintEvals(
  document: LintEvals,
  rules: readonly LintRule[],
  deps: LintEvalDependencies,
  signal: AbortSignal,
) {
  const cases: {
    rule: string
    file: string
    expected: 'pass' | 'fail'
    outcome: 'pass' | 'fail' | 'inconclusive'
    matched: boolean
  }[] = []
  for (const item of document.cases) {
    signal.throwIfAborted()
    const rule = rules.find((rule) => rule.id === item.rule)
    if (rule === undefined) throw new Error('lint-eval-rule-unknown')
    const file = await deps.fixture(item.file)
    signal.throwIfAborted()
    const decisions = await deps.evaluate(file, rule, signal)
    signal.throwIfAborted()
    if (decisions.length === 0) throw new Error('lint-eval-no-units')
    const outcome = outcomeFor(decisions, rule.minConfidence)
    cases.push({
      rule: item.rule,
      file: item.file,
      expected: item.expect,
      outcome,
      matched: outcome === item.expect,
    })
  }
  return { cases, exitCode: cases.length > 0 && cases.every((item) => item.matched) ? 0 : 1 }
}
