// Command rules on the Model API backend (M78, PLAN.md D49): prefix rules
// that allow, ask about or forbid a shell command, each with the command
// lines it must and must not match, checked whenever the rules are read.
// Codex's `prefix_rule` with its `match` / `not_match` is the model.
//
// - A forbid or an ask rule matches anywhere in the command line: its words
//   in a row, in any run between separators, quoted text included
//   (`looseWords`), and a program named by its path by its name too. This
//   reading is wider than any shell's, so these rules can only catch more.
// - An allow rule matches only one plain command (`commandShape`),
//   beginning with the words of an allow rule; anything else asks.
//   A command that runs text as code (`eval`,
//   `iex`, `-EncodedCommand`) never counts as allowed.
// - The strictest rule that matches wins: forbid, then ask, then allow.
//
// D24's session rules ("Allow for this session") stay keyed on the exact
// command line; these rules are the user's (or machine's) standing ones.

import {
  type CommandRuleDecision,
  COMMAND_RULE_SHELLS,
  COMMAND_RULES_MAX,
  EVALUATOR_COMMANDS,
  POWERSHELL_ENCODED_ALIASES,
  POWERSHELL_ENCODED_COMMAND,
  POWERSHELL_ENCODED_MIN_PREFIX,
  WINDOWS_PROGRAM_EXTENSIONS,
} from '../../../shared/constants'
import * as z from 'zod/mini'
import { commandRuleSchema } from '../../permissionSettings'
import { commandShape, looseWords, type ShellDialect } from './shellSyntax'

/** A rule as the engine applies it. */
export interface CommandRule {
  readonly pattern: readonly string[]
  readonly decision: CommandRuleDecision
  readonly dialects: readonly ShellDialect[]
  readonly justification: string | undefined
}

/** Where a rule came from: the user's (or machine's) settings, or a repository's. */
export type RuleSource = 'user' | 'repository'

/** Why a rule, or part of one, is not applied as written. */
export type RuleProblemKind =
  /** Not a rule at all: nothing of it is applied. */
  | 'invalid'
  /** Not valid, but it asks or forbids by a readable pattern: applied as that. */
  | 'invalidKept'
  /** An allow rule that fails one of its examples: not applied. */
  | 'exampleFailed'
  /** An ask or forbid rule that fails one of its examples: still applied. */
  | 'exampleFailedKept'
  /** An allow rule in a repository's settings, which can only tighten. */
  | 'allowInRepository'
  /** An allow rule for a command that runs text as code. */
  | 'allowsEvaluator'
  /** Past the most rules read; the rest are not read. */
  | 'tooMany'

export interface RuleProblem {
  readonly kind: RuleProblemKind
  /** 1-based, as the user counts the rules in the setting. */
  readonly index: number
  readonly pattern: string
  /** The example that failed, or the parse error. */
  readonly detail: string
}

export interface CompiledRules {
  readonly rules: readonly CommandRule[]
  readonly problems: readonly RuleProblem[]
}

/** What the rules say about one command line. */
export interface CommandJudgement {
  /** Undefined when no rule settles the command. */
  readonly decision: CommandRuleDecision | undefined
  /** The rule that settled it (for an allow, the first command's). */
  readonly rule: CommandRule | undefined
}

const NO_JUDGEMENT: CommandJudgement = { decision: undefined, rule: undefined }
const PATH_SEPARATORS: Readonly<Record<ShellDialect, RegExp>> = {
  bash: /\//,
  powershell: /[/\\]/,
}
const SLASH_PARAMETER = '/'
const DASH_PARAMETER = '-'
const WORD_SEPARATOR = ' '

/** Words compared as the shell treats them: PowerShell ignores case. */
function isSameWord(left: string, right: string, dialect: ShellDialect): boolean {
  return dialect === 'powershell' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** The program a word names: its last path segment, and in PowerShell without `.exe`. */
function programName(word: string, dialect: ShellDialect): string {
  const name = word.split(PATH_SEPARATORS[dialect]).at(-1) ?? word
  if (dialect === 'bash') {
    return name
  }
  const lower = name.toLowerCase()
  const extension = WINDOWS_PROGRAM_EXTENSIONS.find((suffix) => lower.endsWith(suffix))
  return extension === undefined ? lower : lower.slice(0, -extension.length)
}

/** Whether `words` from `start` begin with the pattern, the first word also by program name. */
function isMatchAt(
  pattern: readonly string[],
  words: readonly string[],
  start: number,
  dialect: ShellDialect,
): boolean {
  return pattern.every((expected, offset) => {
    const word = words[start + offset]
    return (
      word !== undefined &&
      (isSameWord(expected, word, dialect) ||
        (offset === 0 && isSameWord(expected, programName(word, dialect), dialect)))
    )
  })
}

/** A forbid or ask rule: its words in a row anywhere in the command line. */
function isMatchAnywhere(rule: CommandRule, command: string, dialect: ShellDialect): boolean {
  return looseWords(command, dialect).some((words) =>
    words.some((_word, start) => isMatchAt(rule.pattern, words, start, dialect)),
  )
}

/**
 * An allow rule over one plain command: the command begins with its words
 * exactly (the name by case alone in PowerShell, never by a path: `./git`
 * is not `git`).
 */
function isCommandAllowed(
  rule: CommandRule,
  words: readonly string[],
  dialect: ShellDialect,
): boolean {
  return (
    rule.pattern.length <= words.length &&
    rule.pattern.every((expected, offset) => {
      const word = words[offset] ?? ''
      return offset === 0 ? isSameWord(expected, word, dialect) : expected === word
    })
  )
}

/** A PowerShell word that names `-EncodedCommand` or an abbreviation it accepts. */
function isEncodedCommandFlag(word: string): boolean {
  const lower = word.toLowerCase()
  const flag = lower.startsWith(SLASH_PARAMETER) ? `${DASH_PARAMETER}${lower.slice(1)}` : lower
  return (
    POWERSHELL_ENCODED_ALIASES.has(flag) ||
    (flag.startsWith(POWERSHELL_ENCODED_MIN_PREFIX) && POWERSHELL_ENCODED_COMMAND.startsWith(flag))
  )
}

/** A command that runs text as code: no allow rule can vouch for what it runs. */
export function isEvaluator(words: readonly string[], dialect: ShellDialect): boolean {
  const evaluators: readonly string[] = EVALUATOR_COMMANDS[dialect]
  const name = programName(words[0] ?? '', dialect)
  return (
    evaluators.some((evaluator) => isSameWord(evaluator, name, dialect)) ||
    (dialect === 'powershell' && words.some((word) => isEncodedCommandFlag(word)))
  )
}

/**
 * Whether one plain command is allowed by these rules and does not run text
 * as code. Its rule, or undefined.
 */
function allowingRule(
  rules: readonly CommandRule[],
  command: string,
  dialect: ShellDialect,
): CommandRule | undefined {
  const shape = commandShape(command, dialect)
  if (!shape.isPlain || shape.commands.length !== 1) {
    return undefined
  }
  let first: CommandRule | undefined
  for (const words of shape.commands) {
    if (isEvaluator(words, dialect)) {
      return undefined
    }
    const rule = rules.find((candidate) => isCommandAllowed(candidate, words, dialect))
    if (rule === undefined) {
      return undefined
    }
    first ??= rule
  }
  return first
}

/** The rules' verdict on a command line in its shell. */
export function judgeCommand(
  rules: readonly CommandRule[],
  command: string,
  dialect: ShellDialect,
): CommandJudgement {
  const applicable = rules.filter((rule) => rule.dialects.includes(dialect))
  for (const decision of ['forbid', 'ask'] as const) {
    const rule = applicable.find(
      (candidate) =>
        candidate.decision === decision && isMatchAnywhere(candidate, command, dialect),
    )
    if (rule !== undefined) {
      return { decision, rule }
    }
  }
  const allowRules = applicable.filter((rule) => rule.decision === 'allow')
  const rule = allowRules.length === 0 ? undefined : allowingRule(allowRules, command, dialect)
  return rule === undefined ? NO_JUDGEMENT : { decision: 'allow', rule }
}

/** Whether this one rule matches an example, as its tests use it. */
export function isRuleMatch(rule: CommandRule, example: string, dialect: ShellDialect): boolean {
  return rule.decision === 'allow'
    ? allowingRule([rule], example, dialect) !== undefined
    : isMatchAnywhere(rule, example, dialect)
}

/** The first example the rule gets wrong in one of its shells, if any. */
function failedExample(
  rule: CommandRule,
  match: readonly string[],
  notMatch: readonly string[],
): string | undefined {
  for (const dialect of rule.dialects) {
    const wrong =
      match.find((example) => !isRuleMatch(rule, example, dialect)) ??
      notMatch.find((example) => isRuleMatch(rule, example, dialect))
    if (wrong !== undefined) {
      return wrong
    }
  }
  return undefined
}

// What is still read of a rule that is not valid: a pattern that tightens.
const tighteningCoreSchema = z.object({
  pattern: commandRuleSchema.shape.pattern,
  decision: z.enum(['forbid', 'ask']),
  shell: commandRuleSchema.shape.shell,
  justification: commandRuleSchema.shape.justification,
})

function patternText(value: unknown): string {
  const parsed = commandRuleSchema.shape.pattern.safeParse(
    typeof value === 'object' && value !== null && 'pattern' in value ? value.pattern : undefined,
  )
  return parsed.success ? parsed.data.join(WORD_SEPARATOR) : ''
}

/** One setting entry as a rule, or the problem that stops it. */
function compileOne(
  raw: unknown,
  index: number,
  source: RuleSource,
): { readonly rule?: CommandRule; readonly problem?: RuleProblem } {
  const parsed = commandRuleSchema.safeParse(raw)
  if (!parsed.success) {
    const problem = { index, pattern: patternText(raw), detail: z.prettifyError(parsed.error) }
    const core = tighteningCoreSchema.safeParse(raw)
    if (!core.success) {
      return { problem: { ...problem, kind: 'invalid' } }
    }
    return {
      rule: {
        pattern: core.data.pattern,
        decision: core.data.decision,
        dialects: core.data.shell === undefined ? COMMAND_RULE_SHELLS : [core.data.shell],
        justification: core.data.justification,
      },
      problem: { ...problem, kind: 'invalidKept' },
    }
  }
  const setting = parsed.data
  const rule: CommandRule = {
    pattern: setting.pattern,
    decision: setting.decision,
    dialects: setting.shell === undefined ? COMMAND_RULE_SHELLS : [setting.shell],
    justification: setting.justification,
  }
  const pattern = setting.pattern.join(WORD_SEPARATOR)
  if (rule.decision === 'allow') {
    if (source === 'repository') {
      return { problem: { kind: 'allowInRepository', index, pattern, detail: '' } }
    }
    if (rule.dialects.some((dialect) => isEvaluator(rule.pattern, dialect))) {
      return { problem: { kind: 'allowsEvaluator', index, pattern, detail: '' } }
    }
  }
  const wrong = failedExample(rule, setting.match, setting.notMatch ?? [])
  if (wrong === undefined) {
    return { rule }
  }
  return rule.decision === 'allow'
    ? { problem: { kind: 'exampleFailed', index, pattern, detail: wrong } }
    : { rule, problem: { kind: 'exampleFailedKept', index, pattern, detail: wrong } }
}

/**
 * The rules of one setting, each checked against its own examples. A rule
 * that is wrong is left out if it allows, and kept if it only tightens; a
 * repository's allow rules are always left out.
 */
export function compileCommandRules(raw: readonly unknown[], source: RuleSource): CompiledRules {
  const rules: CommandRule[] = []
  const problems: RuleProblem[] = []
  for (const [position, entry] of raw.slice(0, COMMAND_RULES_MAX).entries()) {
    const { rule, problem } = compileOne(entry, position + 1, source)
    if (rule !== undefined) {
      rules.push(rule)
    }
    if (problem !== undefined) {
      problems.push(problem)
    }
  }
  if (raw.length > COMMAND_RULES_MAX) {
    problems.push({
      kind: 'tooMany',
      index: COMMAND_RULES_MAX + 1,
      pattern: '',
      detail: String(raw.length),
    })
  }
  return { rules, problems }
}
