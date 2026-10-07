import { execFile, spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { runnerEnvironment } from '../../src/core/runners/runnerConfig'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { runnerTestGit as git } from './helpers/runnerProcesses'

// This case compiles and launches the native job helper for setup and check transactions.
const NATIVE_RUNNER_TRANSACTION_TIMEOUT_MS = 60_000

const execute = promisify(execFile)
const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const env = runnerEnvironment(process.env)
const hasParser =
  spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
    env,
    timeout: 10_000,
  }).status === 0
const helper = path.join(process.cwd(), 'native', 'runner', 'runner-helper.ps1')

describe('native Windows runner certification', () => {
  // FIXM96CO requires the real parser when installed; native execution requires Windows APIs.
  it.runIf(hasParser)(
    'parses the helper and keeps Initialize-RunnerJob separate from argument assignment',
    async () => {
      const script = `
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) { throw ($errors | Out-String) }
$commands=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Initialize-RunnerJob'},$true)
if ($commands.Count -lt 1) { throw 'missing native initialization' }
foreach ($command in $commands) { if ($command.CommandElements.Count -ne 1) { throw 'initialization consumed the arguments assignment' } }
`
      const answer = await execute(
        powerShell,
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { env },
      )
      expect(answer.stderr).toBe('')
    },
  )
  it.runIf(process.platform === 'win32')(
    'runs setup and checks through the native job branch and publishes the exit marker',
    async () => {
      await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
      const folder = await mkdtemp(path.join(process.cwd(), 'temp', 'm96-native-'))
      let hasRetirement = true
      try {
        const source = path.join(folder, 'source')
        const root = path.join(folder, 'runner')
        await mkdir(source)
        await git(source, 'init')
        await writeFile(path.join(source, 'tracked.txt'), 'fixture')
        await git(source, 'add', '.')
        await git(
          source,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@localhost',
          'commit',
          '-m',
          'base',
        )
        const snapshot = await git(source, 'rev-parse', 'HEAD')
        const invoke = async (args: readonly string[]) =>
          await execute(
            powerShell,
            [...WINDOWS_POWERSHELL_COMMAND_ARGS.slice(0, -1), '-File', helper, ...args],
            { env },
          )
        await invoke(['init', root])
        await git(
          source,
          'push',
          path.join(root, 'repository.git'),
          'HEAD:refs/muse-spark/runs/native-run',
        )
        const encode = (command: string) => Buffer.from(command).toString('base64')
        hasRetirement = false
        const started = await invoke([
          'start',
          root,
          'native-run',
          '1',
          snapshot,
          'native-cache',
          encode("[IO.File]::WriteAllText((Join-Path (Get-Location) 'setup-ran'),'ready')"),
          encode(
            "if (!(Test-Path -LiteralPath 'setup-ran')) { exit 9 }; [Console]::Write('native-check-ran'); exit 0",
          ),
          '10',
        ])
        expect(JSON.parse(started.stdout)).toMatchObject({ runId: 'native-run', state: 'running' })
        const deadline = Date.now() + 30_000
        let result: { state: string; exitCode?: number | undefined } = { state: 'running' }
        while (result.state === 'running' && Date.now() < deadline) {
          const status = await invoke(['status', root, 'native-run'])
          result = z
            .object({ state: z.string(), exitCode: z.optional(z.number()) })
            .parse(JSON.parse(status.stdout))
          if (result.state === 'running') await delay(100)
        }
        hasRetirement = result.state === 'ended'
        expect(result).toMatchObject({ state: 'ended', exitCode: 0 })
        expect(await readFile(path.join(root, 'runs', 'native-run', 'output'), 'utf8')).toContain(
          'native-check-ran',
        )
      } finally {
        // Preserve uncertain native jobs and their evidence rather than deleting a live copy.
        if (hasRetirement) await rm(folder, { recursive: true, force: true })
      }
    },
    NATIVE_RUNNER_TRANSACTION_TIMEOUT_MS,
  )
})
