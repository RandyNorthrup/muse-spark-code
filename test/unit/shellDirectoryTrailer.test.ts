// The shell tool's directory trailer keeps the command's own exit (M91 lane
// S, PLAN.md D70; CCFIX1). Windows PowerShell 5.1 sets `$?` to true after
// any statement, an assignment included, so a trailer that saved
// `$LASTEXITCODE` before it read `$?` turned every failure into exit 0 for
// the model. Each case runs a command and the real trailer through a real
// shell: the product's own, through the shell tool's ToolIo (Windows
// PowerShell 5.1 on Windows, bash elsewhere), and on Windows PowerShell 7
// with the same arguments, so the trailer holds in either PowerShell. The
// side file must still report the call's sequence and directory.
import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  parseShellDirectoryReport,
  shellDirectoryTrailer,
} from '../../src/core/backends/modelapi/tools'
import { workspaceChildEnvironment } from '../../src/core/execGuard'
import type { ShellResult } from '../../src/core/shellResult'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { runCommand, shellArguments } from '../../src/host/backend/toolIo'
import { headlessToolIo } from './helpers/headlessToolIo'
import { temporaryTracker } from './helpers/temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'
const SEQUENCE = 7
const folders = temporaryTracker()
afterAll(folders.cleanup)

interface TrailerCase {
  readonly name: string
  /** The user's command; `missing` names a path that does not exist. */
  readonly command: (missing: string) => string
  readonly exitCode: number
}

const POWERSHELL_CASES: readonly TrailerCase[] = [
  {
    name: 'a failing native command keeps its own code',
    command: () => 'cmd /c exit 3',
    exitCode: 3,
  },
  {
    name: 'a failing cmdlet fails as 1',
    command: (missing) => `Get-Item -LiteralPath ${powerShellQuoted(missing)}`,
    exitCode: 1,
  },
  {
    name: 'a native failure that a later success follows exits 0',
    command: () => 'cmd /c exit 3; Write-Output ok',
    exitCode: 0,
  },
  { name: 'a success stays 0', command: () => 'Write-Output ok', exitCode: 0 },
]

const BASH_CASES: readonly TrailerCase[] = [
  {
    name: 'a failing program keeps its own code',
    command: () => "sh -c 'exit 3'",
    exitCode: 3,
  },
  { name: 'a failing builtin fails as 1', command: () => 'false', exitCode: 1 },
  { name: 'a success stays 0', command: () => 'echo ok', exitCode: 0 },
]

/** A fresh working directory and the side file the trailer writes into it. */
async function workspace(): Promise<{ cwd: string; sideFile: string; missing: string }> {
  const cwd = realpathSync.native(await folders.make('ccfix1-trailer-'))
  return {
    cwd,
    sideFile: path.join(cwd, 'report.cwd'),
    missing: path.join(cwd, 'no-such-entry'),
  }
}

async function expectReport(result: ShellResult, sideFile: string, cwd: string, exitCode: number) {
  expect(result.exitCode, result.stderr).toBe(exitCode)
  const reported = parseShellDirectoryReport(await readFile(sideFile, 'utf8'), SEQUENCE)
  expect(reported).toBeDefined()
  expect(realpathSync.native(reported ?? '')).toBe(cwd)
}

/** The product's own shell: Windows PowerShell 5.1 on Windows, bash elsewhere. */
const PRODUCT_CASES = IS_WINDOWS ? POWERSHELL_CASES : BASH_CASES

describe("the shell trailer keeps the command's exit through the product's own shell", () => {
  for (const testCase of PRODUCT_CASES) {
    it(testCase.name, async () => {
      const { cwd, sideFile, missing } = await workspace()
      const trailer = shellDirectoryTrailer(process.platform, sideFile, SEQUENCE)
      const result = await headlessToolIo(cwd).runShell(
        `${testCase.command(missing)}${trailer}`,
        cwd,
        undefined,
      )
      await expectReport(result, sideFile, cwd, testCase.exitCode)
    })
  }
})

/** PowerShell 7 where Windows installs it, named when it is missing. */
function powerShell7(): string {
  const programFiles = process.env['ProgramFiles']
  if (programFiles === undefined) throw new Error('ProgramFiles is not set')
  const pwsh = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe')
  if (!existsSync(pwsh)) throw new Error(`PowerShell 7 is not installed at ${pwsh}`)
  return pwsh
}

describe.runIf(IS_WINDOWS)("the shell trailer keeps the command's exit in PowerShell 7", () => {
  for (const testCase of POWERSHELL_CASES) {
    it(testCase.name, async () => {
      const { cwd, sideFile, missing } = await workspace()
      const trailer = shellDirectoryTrailer('win32', sideFile, SEQUENCE)
      const result = await runCommand({
        file: powerShell7(),
        args: shellArguments('win32', `${testCase.command(missing)}${trailer}`),
        cwd,
        env: workspaceChildEnvironment(process.platform, process.env, {
          workspaceRoot: cwd,
          realpath: realpathSync,
        }),
        timeoutMs: undefined,
        signal: undefined,
        tree: {
          platform: process.platform,
          systemRoot: process.env['SystemRoot'],
          log: () => undefined,
        },
      })
      await expectReport(result, sideFile, cwd, testCase.exitCode)
    })
  }
})
