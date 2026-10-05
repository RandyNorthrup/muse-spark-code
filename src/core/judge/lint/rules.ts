import { compileGlobWithin, type GlobLimits } from '../../backends/modelapi/glob'
import { judgeOptionLetter, type JudgeQuestion } from '../schema'
import type { LintDecision } from './cache'
import type { LintKind } from './units'

/** Internal normalized rules. The pinned upstream reader owns the external JSON format. */
export interface LintRule {
  readonly id: string
  readonly description: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly kinds: readonly LintKind[]
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  readonly exceptions: readonly string[]
  readonly minConfidence: number
  readonly allowSkip: boolean
  readonly allowAbstain: boolean
  readonly localize: readonly LintKind[]
  readonly callees: boolean
}

/** Upstream's exact criteria text comes from the pinned reader/P0, never a guessed template. */
export interface LintWording {
  readonly pass: string
  readonly fail: string
  readonly skip: string
  readonly abstain: string
  instructions(rule: LintRule, isLocalized: boolean): string
}

export interface LintQuestion {
  readonly question: JudgeQuestion
  readonly outcomes: Readonly<Record<string, LintDecision['outcome']>>
}

/** P0 supplies this English model-text block to the lazy lint bundle. */
export interface LintModelText {
  readonly pass: string
  readonly fail: string
  readonly skip: string
  readonly abstain: string
  readonly instructionPrefix: string
  readonly localizedInstructionPrefix: string
  readonly exceptionsPrefix: string
}

/** Formatting from upstream client.go; model sentences themselves remain P0-owned. */
export function createLintWording(text: LintModelText): LintWording {
  return {
    pass: text.pass,
    fail: text.fail,
    skip: text.skip,
    abstain: text.abstain,
    instructions(rule, isLocalized) {
      const prefix = isLocalized ? text.localizedInstructionPrefix : text.instructionPrefix
      const exceptions =
        rule.exceptions.length === 0
          ? ''
          : text.exceptionsPrefix + rule.exceptions.map((exception) => `\n- ${exception}`).join('')
      return prefix + rule.description + exceptions
    },
  }
}

export function lintQuestion(
  rule: LintRule,
  wording: LintWording,
  isLocalized = false,
): LintQuestion {
  const options: { readonly outcome: LintDecision['outcome']; readonly text: string }[] = [
    { outcome: 'pass', text: wording.pass },
    { outcome: 'fail', text: wording.fail },
  ]
  if (rule.allowSkip) options.push({ outcome: 'skip', text: wording.skip })
  if (rule.allowAbstain) options.push({ outcome: 'abstain', text: wording.abstain })
  const criteria: Record<string, string> = {}
  const outcomes: Record<string, LintDecision['outcome']> = {}
  for (const [index, option] of options.entries()) {
    const letter = judgeOptionLetter(index)
    criteria[letter] = option.text
    outcomes[letter] = option.outcome
  }
  return {
    question: { type: 'choice', instructions: wording.instructions(rule, isLocalized), criteria },
    outcomes,
  }
}

/** Paths have already been made workspace-relative by the caller. No shell or path traversal. */
export function isLintRuleApplicable(
  rule: LintRule,
  path: string,
  kind: LintKind,
  limits: GlobLimits,
): boolean {
  const isMatch = (pattern: string) => compileGlobWithin(pattern, limits)(path)
  return (
    rule.kinds.includes(kind) &&
    (rule.include.length === 0 || rule.include.some((pattern) => isMatch(pattern))) &&
    rule.exclude.every((pattern) => !isMatch(pattern))
  )
}
