import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createToolIo, shellInvocation } from '../../src/host/backend/toolIo'

describe('shellInvocation', () => {
  it('names the interpreter and passes the command line as one argument', () => {
    expect(shellInvocation('win32', String.raw`C:\Windows`, 'Get-Location; echo hi')).toEqual({
      file: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-Location; echo hi',
      ],
    })
    expect(shellInvocation('win32', undefined, 'x').file).toBe('powershell.exe')
    expect(shellInvocation('linux', undefined, 'ls; echo hi')).toEqual({
      file: 'bash',
      args: ['-lc', 'ls; echo hi'],
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
})
