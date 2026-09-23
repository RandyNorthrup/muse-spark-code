import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createToolIo,
  shellArguments,
  shellEnvironment,
  shellInterpreter,
} from '../../src/host/backend/toolIo'

const INSTALLED_SHELLS: ReadonlySet<string> = new Set([
  '/usr/bin/bash',
  String.raw`D:\ps\powershell.exe`,
])

function isInstalledShell(file: string): boolean {
  return INSTALLED_SHELLS.has(file)
}

function isNothingInstalled(): boolean {
  return false
}

function isAnythingInstalled(): boolean {
  return true
}

describe('shellInterpreter / shellArguments', () => {
  it('names the interpreter by absolute path and passes the command line as one argument', () => {
    expect(shellInterpreter('win32', String.raw`C:\Windows`, {}, isNothingInstalled)).toBe(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    )
    expect(shellArguments('win32', 'Get-Location; echo hi')).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-Location; echo hi',
    ])
    expect(shellArguments('linux', 'ls; echo hi')).toEqual(['-lc', 'ls; echo hi'])
  })

  it('finds bash (or PowerShell without SystemRoot) on absolute PATH entries only (D24)', () => {
    // The empty and relative entries would be the workspace; they are skipped.
    expect(
      shellInterpreter('linux', undefined, { PATH: ':.:bin:/usr/bin' }, isInstalledShell),
    ).toBe('/usr/bin/bash')
    expect(
      shellInterpreter('linux', undefined, { PATH: '.:bin' }, isAnythingInstalled),
    ).toBeUndefined()
    expect(
      shellInterpreter('win32', undefined, { Path: String.raw`.;D:\ps` }, isInstalledShell),
    ).toBe(String.raw`D:\ps\powershell.exe`)
  })
})

describe('shellEnvironment', () => {
  it("drops the extension host's own variables as VS Code's terminal does, keeps the user's", () => {
    const env = shellEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/u',
        META_API_KEY: 'LLM|1|x',
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_IPC_HOOK_CLI: '/tmp/x.sock',
        VSCODE_PID: '4',
        VSCODE_SHELL_LOGIN: '1',
        SNAP: '/snap/code',
        SNAP_NAME: 'code',
        SNAPSHOT_DIR: 'kept',
        GDK_PIXBUF_MODULE_FILE: '/x',
      },
      'linux',
      undefined,
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      META_API_KEY: 'LLM|1|x',
      VSCODE_SHELL_LOGIN: '1',
      SNAPSHOT_DIR: 'kept',
    })
  })

  it('points Windows PowerShell at its own modules, whatever spelling was inherited', () => {
    const env = shellEnvironment(
      { PSMODULEPATH: String.raw`C:\pwsh7\Modules`, ProgramFiles: String.raw`C:\Program Files` },
      'win32',
      String.raw`C:\Windows`,
    )
    expect(env).toEqual({
      ProgramFiles: String.raw`C:\Program Files`,
      PSModulePath: String.raw`C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
    })
  })
})

const SHELL_BUDGET_MS = 120_000
const TEST_BUDGET_MS = 3 * SHELL_BUDGET_MS

const io = () =>
  createToolIo({
    platform: process.platform,
    listFiles: () => Promise.resolve(['a.txt']),
    systemRoot: process.env['SystemRoot'],
    env: process.env,
    searchWorkerPath: 'unused-here',
  })

describe('createToolIo (real file system and shell)', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-toolio-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads undefined for a missing file, writes and reads back, lists through the lister', async () => {
    const target = path.join(root, 'a.txt')
    await expect(io().readFile(target)).resolves.toBeUndefined()
    await io().writeFile(target, 'hello\n')
    await expect(io().readFile(target)).resolves.toBe('hello\n')
    await expect(readFile(target, 'utf8')).resolves.toBe('hello\n')
    await expect(io().listFiles()).resolves.toEqual(['a.txt'])
    // A directory is neither missing nor readable: the error surfaces.
    await expect(io().readFile(root)).rejects.toThrow()
  })

  it(
    'runs one command line in the given directory and reports its exit',
    async () => {
      const command =
        process.platform === 'win32'
          ? 'Write-Output ok; Get-Location | Select-Object -ExpandProperty Path'
          : 'echo ok; pwd'
      // A cold GitHub Windows runner has taken over 30 s for its first
      // PowerShell start (CI on f5831a0), so the budget is generous.
      const result = await io().runShell(command, root, SHELL_BUDGET_MS)
      expect(result.exitCode).toBe(0)
      expect(result.isTimedOut).toBe(false)
      const lines = result.stdout.trim().split(/\r?\n/)
      expect(lines[0]).toBe('ok')
      // Canonical on both sides: macOS temp dirs sit behind /private symlinks
      // and Windows runners hand out 8.3 short names for the temp folder.
      expect(realpathSync.native(lines[1] ?? '')).toBe(realpathSync.native(root))
      const failing = await io().runShell('exit 3', root, SHELL_BUDGET_MS)
      expect(failing.exitCode).toBe(3)
    },
    TEST_BUDGET_MS,
  )

  it('stops a command that outlives its timeout', async () => {
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30'
    const result = await io().runShell(command, root, 500)
    expect(result.isTimedOut).toBe(true)
  }, 60_000)

  it('captures stderr and the exit code of a failing command', async () => {
    const command =
      process.platform === 'win32'
        ? '[Console]::Error.WriteLine("bad news"); exit 7'
        : 'echo bad news >&2; exit 7'
    const result = await io().runShell(command, root, SHELL_BUDGET_MS)
    expect(result.stderr).toContain('bad news')
    expect(result.exitCode).toBe(7)
    expect(result.isTimedOut).toBe(false)
  })

  it('reports an interpreter that cannot start instead of hanging', async () => {
    // A Windows layout whose PowerShell does not exist, on any host OS.
    const broken = createToolIo({
      platform: 'win32',
      listFiles: () => Promise.resolve([]),
      systemRoot: path.join(root, 'no-such-windows'),
      env: process.env,
      searchWorkerPath: 'unused-here',
    })
    const result = await broken.runShell('echo hi', root, SHELL_BUDGET_MS)
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toMatch(/ENOENT/)
    expect(result.isTimedOut).toBe(false)
  })
})
