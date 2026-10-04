// The command table of M78 (PLAN.md D49): each shell's command lines, what
// the extension's reader makes of them, and the shells' own parsers as
// witnesses (helpers/shellParsers.ts). A plain line must be read word for
// word as the shell reads it; a line the reader refuses must be one the
// shell's parser does not read as plain commands either, unless the row
// says the reader is stricter than the shell on purpose.

import { describe, expect, it } from 'vitest'
import {
  type ComplexReason,
  commandShape,
  looseWords,
  type ShellDialect,
} from '../../src/core/backends/modelapi/shellSyntax'
import {
  commandsBashRuns,
  findBash,
  parseWithPowerShell,
  windowsPowerShell,
} from './helpers/shellParsers'

type Row =
  | { readonly line: string; readonly commands: readonly (readonly string[])[] }
  | {
      readonly line: string
      readonly reason: ComplexReason
      /** The shell reads it as plain commands; the reader asks anyway. */
      readonly isStricter?: true
    }

const BASH_ROWS: readonly Row[] = [
  { line: 'git status', commands: [['git', 'status']] },
  { line: 'git log --oneline -n 5', commands: [['git', 'log', '--oneline', '-n', '5']] },
  {
    line: "git commit -m 'fix: a; b | c && d'",
    commands: [['git', 'commit', '-m', 'fix: a; b | c && d']],
  },
  { line: String.raw`git commit -m "say \"hi\""`, commands: [['git', 'commit', '-m', 'say "hi"']] },
  { line: String.raw`echo "a\b"`, commands: [['echo', String.raw`a\b`]] },
  { line: `echo 'it'"'"'s'`, commands: [['echo', "it's"]] },
  { line: 'npm run test -- --watch', commands: [['npm', 'run', 'test', '--', '--watch']] },
  {
    line: 'git status && git diff',
    commands: [
      ['git', 'status'],
      ['git', 'diff'],
    ],
  },
  {
    line: 'git status || git diff',
    commands: [
      ['git', 'status'],
      ['git', 'diff'],
    ],
  },
  {
    line: 'git status; git diff',
    commands: [
      ['git', 'status'],
      ['git', 'diff'],
    ],
  },
  {
    line: 'git status | wc -l',
    commands: [
      ['git', 'status'],
      ['wc', '-l'],
    ],
  },
  { line: 'git status;', commands: [['git', 'status']] },
  { line: "grep -n 'a|b' notes.txt", commands: [['grep', '-n', 'a|b', 'notes.txt']] },
  { line: 'echo a#b', commands: [['echo', 'a#b']] },
  { line: 'echo ""', commands: [['echo', '']] },
  { line: 'echo a=b', commands: [['echo', 'a=b']] },
  { line: '  git   status  ', commands: [['git', 'status']] },
  { line: 'git\tstatus', commands: [['git', 'status']] },
  { line: 'npm install left-pad@1.3.0', commands: [['npm', 'install', 'left-pad@1.3.0']] },
  { line: 'echo 100% a,b x:y', commands: [['echo', '100%', 'a,b', 'x:y']] },
  { line: 'eval ls', commands: [['eval', 'ls']] },
  { line: 'echo $(whoami)', reason: 'substitution' },
  { line: 'echo `whoami`', reason: 'substitution' },
  { line: 'echo $HOME', reason: 'expansion' },
  { line: 'echo "$HOME"', reason: 'expansion' },
  { line: 'echo "$(whoami)"', reason: 'substitution' },
  { line: 'echo "`whoami`"', reason: 'substitution' },
  { line: String.raw`echo $'a\nb'`, reason: 'expansion' },
  { line: 'cat <(ls)', reason: 'substitution' },
  { line: 'echo x > out.txt', reason: 'redirection' },
  { line: 'echo x >> out.txt', reason: 'redirection' },
  { line: 'cat < in.txt', reason: 'redirection' },
  { line: 'ls 2>/dev/null', reason: 'redirection' },
  { line: 'ls &> out.txt', reason: 'redirection' },
  { line: 'ls |& cat', reason: 'redirection' },
  { line: 'sleep 10 &', reason: 'background' },
  { line: 'sleep 10 & echo x', reason: 'background' },
  { line: 'git status\ngit diff', reason: 'newline' },
  { line: 'git status\r\ngit diff', reason: 'newline' },
  { line: '(cd src && ls)', reason: 'grouping' },
  { line: '{ ls; }', reason: 'expansion' },
  { line: 'ls *.ts', reason: 'expansion' },
  { line: 'ls ?.ts', reason: 'expansion' },
  { line: 'ls [ab].ts', reason: 'expansion' },
  { line: 'echo {a,b}', reason: 'expansion' },
  { line: 'cd ~', reason: 'expansion' },
  { line: '! git status', reason: 'expansion' },
  { line: String.raw`echo a\ b`, reason: 'quoting' },
  { line: String.raw`echo "a\$b"`, reason: 'quoting' },
  { line: "echo 'unterminated", reason: 'quoting' },
  { line: 'echo "unterminated', reason: 'quoting' },
  { line: 'if true; then ls; fi', reason: 'keyword' },
  { line: 'for x in a; do ls; done', reason: 'keyword' },
  { line: 'time ls', reason: 'keyword' },
  { line: 'FOO=1 ls', reason: 'expansion' },
  { line: '# a comment', reason: 'syntax' },
  { line: 'ls # a comment', reason: 'syntax' },
  { line: '; ls', reason: 'syntax' },
  { line: 'ls;; ls', reason: 'syntax' },
  { line: 'ls; ; ls', reason: 'syntax' },
  { line: 'ls |', reason: 'syntax' },
  { line: 'ls &&', reason: 'syntax' },
  { line: '', reason: 'empty' },
  { line: ' '.repeat(3), reason: 'empty' },
  { line: 'ls\u{7}', reason: 'syntax' },
]

const POWERSHELL_ROWS: readonly Row[] = [
  { line: 'git status', commands: [['git', 'status']] },
  {
    line: 'Get-ChildItem -Recurse -Filter:*.ts',
    commands: [['Get-ChildItem', '-Recurse', '-Filter:*.ts']],
  },
  {
    line: "git commit -m 'fix: a; b | c'",
    commands: [['git', 'commit', '-m', 'fix: a; b | c']],
  },
  { line: 'git commit -m "say ""hi"""', commands: [['git', 'commit', '-m', 'say "hi"']] },
  { line: "echo 'it''s'", commands: [['echo', "it's"]] },
  {
    line: 'git status; git diff',
    commands: [
      ['git', 'status'],
      ['git', 'diff'],
    ],
  },
  {
    line: 'git status | Select-String main',
    commands: [
      ['git', 'status'],
      ['Select-String', 'main'],
    ],
  },
  { line: 'npm run test -- --watch', commands: [['npm', 'run', 'test', '--', '--watch']] },
  { line: 'npm i left-pad@1.3.0', commands: [['npm', 'i', 'left-pad@1.3.0']] },
  { line: 'echo a#b', commands: [['echo', 'a#b']] },
  { line: 'git log --format=%h', commands: [['git', 'log', '--format=%h']] },
  { line: String.raw`.\build.ps1 -Release`, commands: [[String.raw`.\build.ps1`, '-Release']] },
  {
    line: String.raw`C:\tools\git.exe status`,
    commands: [[String.raw`C:\tools\git.exe`, 'status']],
  },
  { line: ';git status', commands: [['git', 'status']] },
  {
    line: 'git status;;git diff',
    commands: [
      ['git', 'status'],
      ['git', 'diff'],
    ],
  },
  { line: 'echo 5', commands: [['echo', '5']] },
  { line: 'echo ""', commands: [['echo', '']] },
  { line: "echo ''", commands: [['echo', '']] },
  { line: 'Write-Output -5', commands: [['Write-Output', '-5']] },
  { line: 'iex "calc"', commands: [['iex', 'calc']] },
  { line: 'echo $env:USERPROFILE', reason: 'expansion' },
  { line: 'echo "$HOME"', reason: 'expansion' },
  { line: 'echo $(whoami)', reason: 'expansion' },
  { line: 'echo (whoami)', reason: 'grouping' },
  { line: 'echo @(1)', reason: 'expansion' },
  { line: 'echo @x', reason: 'expansion' },
  { line: 'echo a,b', reason: 'expansion' },
  { line: 'echo x > out.txt', reason: 'redirection' },
  { line: 'echo x 2>&1', reason: 'redirection' },
  { line: 'Start-Sleep 10 &', reason: 'background' },
  { line: '& git status', reason: 'callOperator' },
  { line: String.raw`. .\profile.ps1`, reason: 'callOperator' },
  { line: 'git status && git diff', reason: 'syntax' },
  { line: 'git status || git diff', reason: 'syntax' },
  // 5.1 reads `n in a bare word as a line break inside that word.
  { line: 'git status`n', reason: 'quoting', isStricter: true },
  { line: "echo 'a'b", reason: 'quoting', isStricter: true },
  { line: 'echo "a"b', reason: 'quoting', isStricter: true },
  { line: 'echo 0x10', reason: 'syntax' },
  { line: 'echo 1kb', reason: 'syntax' },
  { line: 'echo 05', reason: 'syntax' },
  { line: 'if ($x) { ls }', reason: 'keyword' },
  { line: 'foreach x', reason: 'keyword' },
  { line: 'function f { }', reason: 'keyword' },
  { line: '# a comment', reason: 'syntax', isStricter: true },
  { line: 'git status # a comment', reason: 'syntax', isStricter: true },
  { line: 'git status |', reason: 'syntax' },
  { line: '| git status', reason: 'syntax' },
  { line: 'git status | ; git diff', reason: 'syntax' },
  { line: "'git' status", reason: 'syntax' },
  { line: 'echo a}b', reason: 'grouping' },
  // A newline asks, whatever the shell makes of it (PLAN.md M78).
  { line: 'git status\ngit diff', reason: 'newline', isStricter: true },
  { line: '', reason: 'empty' },
  // Stricter than 5.1 on purpose: each is plain to its parser.
  { line: '7z a x.zip', reason: 'syntax', isStricter: true },
  { line: '-x y', reason: 'syntax', isStricter: true },
  { line: 'echo [a]', reason: 'grouping', isStricter: true },
  { line: "echo a'b'", reason: 'quoting', isStricter: true },
  { line: 'echo --% a b', reason: 'syntax', isStricter: true },
  { line: 'echo -Path: a', reason: 'syntax', isStricter: true },
  { line: 'echo \u{201C}x\u{201D}', reason: 'syntax', isStricter: true },
  { line: 'echo x\u{2013}y', reason: 'syntax', isStricter: true },
]

const TABLES: readonly (readonly [ShellDialect, readonly Row[]])[] = [
  ['bash', BASH_ROWS],
  ['powershell', POWERSHELL_ROWS],
]

describe('commandShape: the command table (M78)', () => {
  for (const [dialect, rows] of TABLES) {
    it.each(rows.map((row) => [JSON.stringify(row.line), row] as const))(
      `${dialect}: %s`,
      (_label, row) => {
        const shape = commandShape(row.line, dialect)
        if ('commands' in row) {
          expect(shape).toEqual({ isPlain: true, commands: row.commands })
        } else {
          expect(shape).toEqual({ isPlain: false, reason: row.reason })
        }
      },
    )
  }
})

const powershell = windowsPowerShell()

describe.runIf(powershell !== undefined)(
  'the PowerShell table against 5.1’s own parser (M78)',
  () => {
    it('reads every plain line word for word, and refuses only what 5.1 does not read as plain', () => {
      const parsed = parseWithPowerShell(
        powershell ?? '',
        POWERSHELL_ROWS.map((row) => row.line),
      )
      // Every row that disagrees, so one run shows them all.
      const disagreements = POWERSHELL_ROWS.flatMap((row, index) => {
        const witness = parsed[index]
        if ('commands' in row) {
          return witness?.plain === true &&
            JSON.stringify(witness.commands) === JSON.stringify(row.commands)
            ? []
            : [{ line: row.line, witness }]
        }
        // An empty line parses to nothing, which the reader calls empty.
        if (row.line.trim() === '') {
          return []
        }
        const isPlainExpected = row.isStricter === true
        return witness?.plain === isPlainExpected ? [] : [{ line: row.line, witness }]
      })
      expect(disagreements).toEqual([])
    }, 60_000)
  },
)

const bash = findBash()

describe.runIf(bash !== undefined)('the bash table against bash itself (M78)', () => {
  const plainRows = BASH_ROWS.filter((row) => 'commands' in row)
  it.each(plainRows.map((row) => [JSON.stringify(row.line), row] as const))(
    'bash runs %s as the words the reader found',
    (_label, row) => {
      if (!('commands' in row)) {
        throw new Error('a plain row expected')
      }
      const names = row.commands.map((words) => words[0] ?? '')
      const ran = commandsBashRuns(bash ?? '', row.line, names)
      expect(ran).toEqual(new Set(row.commands.map((words) => JSON.stringify(words))))
    },
    20_000,
  )
})

describe('looseWords: what forbid and ask rules look through (M78)', () => {
  it.each([
    ['bash', 'sudo rm -rf /', [['sudo', 'rm', '-rf', '/']]],
    ['bash', 'bash -c "rm -rf /"', [['bash', '-c', 'rm', '-rf', '/']]],
    ['bash', 'echo $(rm -rf /)', [['echo'], ['rm', '-rf', '/']]],
    ['bash', 'echo `rm -rf /`', [['echo'], ['rm', '-rf', '/']]],
    ['bash', String.raw`r\m -rf /`, [['rm', '-rf', '/']]],
    ['bash', `r"m" -rf /`, [['rm', '-rf', '/']]],
    ['bash', 'ls; rm -rf / && echo', [['ls'], ['rm', '-rf', '/'], ['echo']]],
    [
      'bash',
      'git status\nrm -rf /',
      [
        ['git', 'status'],
        ['rm', '-rf', '/'],
      ],
    ],
    ['powershell', 'r`m -r x', [['rm', '-r', 'x']]],
    ['powershell', 'iex "Remove-Item -Recurse x"', [['iex', 'Remove-Item', '-Recurse', 'x']]],
    ['powershell', 'echo @(Remove-Item x)', [['echo'], ['Remove-Item', 'x']]],
    ['powershell', 'echo $(Remove-Item x)', [['echo'], ['Remove-Item', 'x']]],
  ] as const)('%s: %s', (dialect, line, runs) => {
    expect(looseWords(line, dialect)).toEqual(runs)
  })
})
