// Command rules (M78, PLAN.md D49): each rule's own examples checked when
// the rules are read, and the verdict table per shell. A chained,
// substituted or redirected command asks; a forbid matches anywhere; the
// strictest rule wins; a repository's rules can only tighten.

import { describe, expect, it } from 'vitest'
import {
  type CommandRule,
  compileCommandRules,
  isEvaluator,
  judgeCommand,
} from '../../src/core/backends/modelapi/commandRules'
import type { ShellDialect } from '../../src/core/backends/modelapi/shellSyntax'
import { COMMAND_RULES_MAX } from '../../src/shared/constants'

/** The user's rules of the table, compiled as the backend compiles them. */
const USER_RULES = compileCommandRules(
  [
    { pattern: ['git', 'status'], decision: 'allow', match: ['git status', 'git status -s'] },
    { pattern: ['git', 'diff'], decision: 'allow', match: ['git diff HEAD'] },
    { pattern: ['npm', 'test'], decision: 'allow', match: ['npm test'] },
    { pattern: ['wc'], decision: 'allow', match: ['wc -l'] },
    {
      pattern: ['Get-ChildItem'],
      decision: 'allow',
      shell: 'powershell',
      match: ['Get-ChildItem .'],
    },
    {
      pattern: ['git', 'push'],
      decision: 'ask',
      justification: 'pushes are reviewed',
      match: ['git push origin main', 'git status && git push'],
      notMatch: ['git pull'],
    },
    {
      pattern: ['rm', '-rf'],
      decision: 'forbid',
      justification: 'never delete trees',
      match: ['rm -rf build', 'sudo rm -rf /', 'bash -c "rm -rf /"', '/bin/rm -rf x'],
      notMatch: ['rm -r build'],
    },
    {
      pattern: ['Remove-Item'],
      decision: 'forbid',
      shell: 'powershell',
      match: ['remove-item x', 'Get-ChildItem | Remove-Item', 'echo $(Remove-Item x)'],
    },
  ],
  'user',
)

describe('compileCommandRules: each rule checked against its own examples (M78)', () => {
  it('reads every valid rule, with no problem', () => {
    expect(USER_RULES.problems).toEqual([])
    expect(USER_RULES.rules.map((rule) => [rule.pattern.join(' '), rule.decision])).toEqual([
      ['git status', 'allow'],
      ['git diff', 'allow'],
      ['npm test', 'allow'],
      ['wc', 'allow'],
      ['Get-ChildItem', 'allow'],
      ['git push', 'ask'],
      ['rm -rf', 'forbid'],
      ['Remove-Item', 'forbid'],
    ])
    expect(USER_RULES.rules[4]?.dialects).toEqual(['powershell'])
    expect(USER_RULES.rules[0]?.dialects).toEqual(['bash', 'powershell'])
  })

  it('leaves out an allow rule whose example it does not match, naming the example', () => {
    const compiled = compileCommandRules(
      [{ pattern: ['git', 'status'], decision: 'allow', match: ['git status > out.txt'] }],
      'user',
    )
    expect(compiled.rules).toEqual([])
    expect(compiled.problems).toEqual([
      { kind: 'exampleFailed', index: 1, pattern: 'git status', detail: 'git status > out.txt' },
    ])
  })

  it('leaves out an allow rule that matches what it says it must not', () => {
    const compiled = compileCommandRules(
      [{ pattern: ['git'], decision: 'allow', match: ['git status'], notMatch: ['git push'] }],
      'user',
    )
    expect(compiled.rules).toEqual([])
    expect(compiled.problems[0]).toMatchObject({ kind: 'exampleFailed', detail: 'git push' })
  })

  it('keeps a forbid or ask rule whose example fails: it can only tighten', () => {
    const compiled = compileCommandRules(
      [{ pattern: ['rm', '-rf'], decision: 'forbid', match: ['rm -r -f x'] }],
      'user',
    )
    expect(compiled.rules.map((rule) => rule.decision)).toEqual(['forbid'])
    expect(compiled.problems[0]).toMatchObject({ kind: 'exampleFailedKept', detail: 'rm -r -f x' })
  })

  it('keeps an invalid forbid rule by its readable pattern, and drops an invalid allow rule', () => {
    const compiled = compileCommandRules(
      [
        { pattern: ['curl'], decision: 'forbid' },
        { pattern: ['ls'], decision: 'allow' },
        'not a rule',
      ],
      'user',
    )
    expect(compiled.rules.map((rule) => [rule.pattern, rule.decision])).toEqual([
      [['curl'], 'forbid'],
    ])
    expect(compiled.problems.map((problem) => [problem.kind, problem.index])).toEqual([
      ['invalidKept', 1],
      ['invalid', 2],
      ['invalid', 3],
    ])
  })

  it('refuses a repository’s allow rule and keeps its ask and forbid rules', () => {
    const compiled = compileCommandRules(
      [
        { pattern: ['git', 'status'], decision: 'allow', match: ['git status'] },
        { pattern: ['git', 'push'], decision: 'ask', match: ['git push'] },
      ],
      'repository',
    )
    expect(compiled.rules.map((rule) => rule.decision)).toEqual(['ask'])
    expect(compiled.problems).toEqual([
      { kind: 'allowInRepository', index: 1, pattern: 'git status', detail: '' },
    ])
  })

  it('refuses an allow rule for a command that runs text as code', () => {
    const compiled = compileCommandRules(
      [
        { pattern: ['eval'], decision: 'allow', match: ['eval ls'] },
        { pattern: ['IEX'], decision: 'allow', shell: 'powershell', match: ['iex x'] },
      ],
      'user',
    )
    expect(compiled.rules).toEqual([])
    expect(compiled.problems.map((problem) => problem.kind)).toEqual([
      'allowsEvaluator',
      'allowsEvaluator',
    ])
  })

  it('reads no more than the most rules, and says so', () => {
    const rule = { pattern: ['ls'], decision: 'ask', match: ['ls'] }
    const compiled = compileCommandRules(
      Array.from({ length: COMMAND_RULES_MAX + 2 }, () => rule),
      'user',
    )
    expect(compiled.rules).toHaveLength(COMMAND_RULES_MAX)
    expect(compiled.problems).toEqual([
      {
        kind: 'tooMany',
        index: COMMAND_RULES_MAX + 1,
        pattern: '',
        detail: String(COMMAND_RULES_MAX + 2),
      },
    ])
  })
})

type Expected = 'allow' | 'ask' | 'forbid' | undefined

/** The verdict table: each line in its shell, and what the rules say (undefined: nothing). */
const VERDICTS: readonly (readonly [ShellDialect, string, Expected])[] = [
  // Plain commands each allowed alone.
  ['bash', 'git status', 'allow'],
  ['bash', 'git status -s', 'allow'],
  ['bash', 'git status && git diff', undefined],
  ['bash', 'git status; git diff HEAD', undefined],
  ['bash', 'git status | wc -l', undefined],
  ['bash', 'git status || npm test', undefined],
  // One command no rule allows: the line is not settled.
  ['bash', 'git status && ls', undefined],
  ['bash', 'git log', undefined],
  // An allow rule never covers what is not plain: these ask.
  ['bash', 'git status > out.txt', undefined],
  ['bash', 'git status $(touch x)', undefined],
  ['bash', 'git status `touch x`', undefined],
  ['bash', 'git status &', undefined],
  ['bash', 'git status\ngit diff', undefined],
  ['bash', 'FOO=1 git status', undefined],
  ['bash', '(git status)', undefined],
  ['bash', './git status', undefined],
  ['bash', 'GIT status', undefined],
  // Ask and forbid match anywhere, and the strictest wins.
  ['bash', 'git push origin main', 'ask'],
  ['bash', 'git status && git push', 'ask'],
  ['bash', 'echo $(git push)', 'ask'],
  ['bash', 'rm -rf build', 'forbid'],
  ['bash', 'git status; rm -rf /', 'forbid'],
  ['bash', 'sudo rm -rf /', 'forbid'],
  ['bash', 'bash -c "rm -rf /"', 'forbid'],
  ['bash', String.raw`r\m -rf /`, 'forbid'],
  ['bash', '/bin/rm -rf x', 'forbid'],
  ['bash', 'git push && rm -rf x', 'forbid'],
  ['bash', 'rm -r build', undefined],
  // A PowerShell-only rule is not a bash rule.
  ['bash', 'Remove-Item x', undefined],
  ['bash', 'Get-ChildItem .', undefined],
  // PowerShell: the name by case alone; its evaluators never allowed.
  ['powershell', 'git status', 'allow'],
  ['powershell', 'GIT status', 'allow'],
  ['powershell', 'get-childitem .', 'allow'],
  ['powershell', 'git status; Get-ChildItem', undefined],
  ['powershell', 'git status && git diff', undefined],
  ['powershell', '& git status', undefined],
  ['powershell', String.raw`. .\git status`, undefined],
  ['powershell', 'git status > out.txt', undefined],
  ['powershell', 'git status $(x)', undefined],
  ['powershell', 'git status -enc ZQBjAGgAbwA=', undefined],
  ['powershell', 'git status -EncodedCommand x', undefined],
  ['powershell', 'git status /ec x', undefined],
  ['powershell', 'Remove-Item -Recurse x', 'forbid'],
  ['powershell', 'remove-item x', 'forbid'],
  ['powershell', 'Get-ChildItem | Remove-Item', 'forbid'],
  ['powershell', 'iex "Remove-Item x"', 'forbid'],
  [
    'powershell',
    String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -c "rm -rf x"`,
    'forbid',
  ],
  ['powershell', String.raw`C:\tools\rm.exe -rf x`, 'forbid'],
  ['powershell', 'r`m -rf x', 'forbid'],
  ['powershell', 'GIT PUSH', 'ask'],
]

describe('judgeCommand: the verdict table per shell (M78)', () => {
  it.each(
    VERDICTS.map(
      ([dialect, line, expected]) => [dialect, JSON.stringify(line), line, expected] as const,
    ),
  )('%s: %s', (dialect, _label, line, expected) => {
    expect(judgeCommand(USER_RULES.rules, line, dialect).decision).toBe(expected)
  })

  it('names the forbid and plain-command allow while a pipeline receives no named grant', () => {
    const forbid = judgeCommand(USER_RULES.rules, 'git push && rm -rf x', 'bash')
    expect(forbid.rule?.justification).toBe('never delete trees')
    const allow = judgeCommand(USER_RULES.rules, 'git status', 'bash')
    expect(allow.rule?.pattern).toEqual(['git', 'status'])
    expect(judgeCommand(USER_RULES.rules, 'git status | wc -l', 'bash')).toEqual({
      decision: undefined,
      rule: undefined,
    })
  })

  it('settles nothing without rules', () => {
    expect(judgeCommand([], 'git status', 'bash')).toEqual({ decision: undefined, rule: undefined })
  })
})

describe('isEvaluator (M78)', () => {
  it.each([
    [['eval', 'ls'], 'bash', true],
    [['source', 'x.sh'], 'bash', true],
    [['.', 'x.sh'], 'bash', true],
    [['Eval', 'ls'], 'bash', false],
    [['Invoke-Expression', 'x'], 'powershell', true],
    [['ICM', 'x'], 'powershell', true],
    [['git', '-e', 'x'], 'powershell', true],
    [['git', '-En'], 'powershell', true],
    [['git', '-encodedcommand'], 'powershell', true],
    [['git', '-encodedcommandx'], 'powershell', false],
    [['git', '-ex', 'x'], 'powershell', false],
    [['git', '-e', 'x'], 'bash', false],
    [['xcopy', '/e'], 'powershell', true],
  ] as const)('%j in %s: %s', (words, dialect, expected) => {
    expect(isEvaluator(words, dialect)).toBe(expected)
  })
})

describe('the tests beside the rules fire (M78)', () => {
  it('a rule that would allow a redirected line is caught by its own example', () => {
    // The drill of docs/certification/m78.md: a rule written as if an
    // allow covered `> file` is refused when read, not applied.
    const rules: readonly CommandRule[] = compileCommandRules(
      [{ pattern: ['cat'], decision: 'allow', match: ['cat notes.txt > copy.txt'] }],
      'user',
    ).rules
    expect(rules).toEqual([])
  })
})
