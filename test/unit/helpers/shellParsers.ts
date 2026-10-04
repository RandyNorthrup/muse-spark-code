// The shells' own parsers, as the M78 command table's witnesses (PLAN.md
// D49): what Windows PowerShell 5.1's parser and bash make of each command
// line, to compare with the extension's reader (shellSyntax.ts).
//
// - PowerShell: `[System.Management.Automation.Language.Parser]::ParseInput`,
//   the AST the shell itself builds. A line is plain when it parses without
//   an error into pipelines of commands whose every element is a constant
//   word: a bare, single- or double-quoted string, a parameter, or a number
//   whose text is its value; no redirection, no call operator, no `&`.
// - Bash: each command the line names is defined as a shell function that
//   records the words it was called with (functions come before builtins
//   and programs; PATH names an empty folder, so nothing else can run).
//   Every function is run once returning 0 and once returning 1, so both
//   sides of `&&` and `||` are seen.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'

const PARSE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$lines = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = foreach ($text in $lines) {
  $tokens = $null
  $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
  $plain = $errors.Count -eq 0
  $commands = New-Object System.Collections.ArrayList
  foreach ($statement in $ast.EndBlock.Statements) {
    if (-not ($statement -is [System.Management.Automation.Language.PipelineAst]) -or $statement.Background) {
      $plain = $false
      continue
    }
    foreach ($element in $statement.PipelineElements) {
      if (-not ($element -is [System.Management.Automation.Language.CommandAst]) -or $element.InvocationOperator -ne 'Unknown' -or $element.Redirections.Count -gt 0) {
        $plain = $false
        continue
      }
      $words = New-Object System.Collections.ArrayList
      foreach ($word in $element.CommandElements) {
        if ($word -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
          [void]$words.Add($word.Value)
        } elseif ($word -is [System.Management.Automation.Language.CommandParameterAst]) {
          [void]$words.Add($word.Extent.Text)
        } elseif ($word -is [System.Management.Automation.Language.ConstantExpressionAst] -and "$($word.Value)" -eq $word.Extent.Text) {
          [void]$words.Add($word.Extent.Text)
        } else {
          $plain = $false
        }
      }
      [void]$commands.Add([object[]]$words.ToArray())
    }
  }
  [pscustomobject]@{ text = $text; plain = $plain; commands = [object[]]$commands.ToArray() }
}
ConvertTo-Json -InputObject @($results) -Depth 6 -Compress
`

export interface ParsedLine {
  readonly text: string
  readonly plain: boolean
  readonly commands: readonly (readonly string[])[]
}

const WINDOWS_POWERSHELL = String.raw`System32\WindowsPowerShell\v1.0\powershell.exe`

/** Windows PowerShell 5.1, the shell tool's own; undefined off Windows. */
export function windowsPowerShell(): string | undefined {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined || process.platform !== 'win32') {
    return undefined
  }
  const candidate = path.win32.join(systemRoot, WINDOWS_POWERSHELL)
  return existsSync(candidate) ? candidate : undefined
}

/** What PowerShell 5.1's parser makes of each line. */
export function parseWithPowerShell(
  powershell: string,
  lines: readonly string[],
): readonly ParsedLine[] {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-psast-'))
  const script = path.join(folder, 'parse.ps1')
  writeFileSync(script, PARSE_SCRIPT, 'utf8')
  const run = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { input: JSON.stringify(lines), encoding: 'utf8', windowsHide: true },
  )
  if (run.status !== 0) {
    throw new Error(`PowerShell's parser did not run: ${run.stderr}`)
  }
  const parsed: unknown = JSON.parse(run.stdout)
  return z
    .array(
      z.object({
        text: z.string(),
        plain: z.boolean(),
        commands: z.array(z.array(z.string())),
      }),
    )
    .parse(Array.isArray(parsed) ? parsed : [parsed])
}

/** bash, if this machine has one: the system's, or Git for Windows'. */
export function findBash(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [
          path.win32.join(
            process.env['ProgramFiles'] ?? String.raw`C:\Program Files`,
            'Git',
            'bin',
            'bash.exe',
          ),
        ]
      : ['/bin/bash', '/usr/bin/bash']
  return candidates.find((candidate) => existsSync(candidate))
}

const RECORD_END = '\u{1E}'
const WORD_END = '\u{1F}'
// Command names the table may run as recording functions: plain words only.
const FUNCTION_NAME = /^[A-Za-z_][\w-]*$/

/**
 * Every command bash runs for the line, as the words it was called with
 * (a set: order and repeats aside). Throws for a name that cannot be a
 * recording function, so no line of the table can reach a real program.
 */
export function commandsBashRuns(
  bash: string,
  line: string,
  names: readonly string[],
): Set<string> {
  const unique = [...new Set(names)]
  const bad = unique.find((name) => !FUNCTION_NAME.test(name))
  if (bad !== undefined) {
    throw new Error(`${bad} cannot be recorded`)
  }
  const emptyPath = mkdtempSync(path.join(tmpdir(), 'muse-bash-path-'))
  // The records go to a file: through stdout, a pipe would carry the left
  // side's records into the right side's stdin. Both sides of a pipeline run
  // at once, so each record is one append (built with `printf -v` first);
  // two appends per record let the sides' words interleave.
  const recordFile = path.join(emptyPath, 'records').replaceAll('\\', '/')
  const seen = new Set<string>()
  for (const status of [0, 1]) {
    writeFileSync(recordFile, '')
    const functions = unique
      .map((name) => `${name}() { __record ${name} "$@"; return ${String(status)}; }`)
      .join('\n')
    const script = `__record() { builtin printf -v __words '%s\\037' "$@"; builtin printf '%s\\036' "$__words" >> '${recordFile}'; }\n${functions}\n${line}\n`
    // Windows spells PATH `Path`: every spelling goes, as do bash's startup files.
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !['path', 'bash_env', 'env'].includes(name.toLowerCase()),
      ),
    )
    env['PATH'] = emptyPath
    spawnSync(bash, ['--noprofile', '--norc', '-c', script], {
      encoding: 'utf8',
      cwd: emptyPath,
      env,
      windowsHide: true,
    })
    for (const record of readFileSync(recordFile, 'utf8').split(RECORD_END)) {
      if (record !== '') {
        seen.add(JSON.stringify(record.split(WORD_END).slice(0, -1)))
      }
    }
  }
  return seen
}
