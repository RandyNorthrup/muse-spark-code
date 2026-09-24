import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT, WINDOWS_POWERSHELL_UTF8_PREAMBLE } from '../../src/shared/constants'
import {
  BoundedText,
  createToolIo,
  runCommand,
  shellArguments,
  shellEnvironment,
  shellInterpreter,
  terminalPlatform,
  withTerminalOverrides,
} from '../../src/host/backend/toolIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import type { RunProgram } from '../../src/host/processTree'
import { removeFolder } from './helpers/temporaryFolders'

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
      // Windows PowerShell's output switched to UTF-8 first (D27).
      `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}Get-Location; echo hi`,
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

describe('BoundedText', () => {
  it('keeps the head and the tail of a flood, with the count of what was dropped', () => {
    const text = new BoundedText(10)
    text.push(Buffer.from('0123456789abcdefghij'))
    expect(text.text()).toBe('01234\n[10 characters omitted]\nfghij')
    const small = new BoundedText(10)
    small.push(Buffer.from('short'))
    expect(small.text()).toBe('short')
  })

  it('decodes a character split across two chunks', () => {
    const text = new BoundedText(100)
    const euro = Buffer.from('€')
    text.push(euro.subarray(0, 1))
    text.push(euro.subarray(1))
    expect(text.text()).toBe('€')
  })
})

/** `${env:NAME}` and `${workspaceFolder}`, spelled without a template literal. */
function reference(name: string): string {
  return ['$', '{', name, '}'].join('')
}

describe('withTerminalOverrides', () => {
  it('applies the terminal settings as VS Code does: values, null removals, references', () => {
    const env = withTerminalOverrides(
      { PATH: '/usr/bin', HOME: '/home/u', DROP: 'x' },
      {
        PATH: `${reference('env:HOME')}/bin:${reference('env:PATH')}`,
        DROP: null,
        ROOT: `${reference('workspaceFolder')}/out`,
      },
      'linux',
      '/ws',
    )
    expect(env).toEqual({ PATH: '/home/u/bin:/usr/bin', HOME: '/home/u', ROOT: '/ws/out' })
    expect(terminalPlatform('win32')).toBe('windows')
    expect(terminalPlatform('darwin')).toBe('osx')
    expect(terminalPlatform('linux')).toBe('linux')
  })

  it('matches Windows names whatever their case', () => {
    const env = withTerminalOverrides(
      { Path: String.raw`C:\bin`, Temp: 'x' },
      { PATH: `${String.raw`D:\tools`};${reference('env:Path')}`, TEMP: null },
      'win32',
      undefined,
    )
    expect(env).toEqual({ PATH: String.raw`D:\tools;C:\bin` })
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
// Well under the 30 s the background child lives; a cold Windows PowerShell start is slow.
const BACKGROUND_BOUND_MS = 20_000
// Longer than the output drain, so an answer that did not wait would come first.
const SWEEP_DELAY_MS = 1000

// On Windows the commands run in job objects, as the extension runs them
// (M27): the helper is compiled once, into a folder of this file's own.
const jobStorage = mkdtempSync(path.join(tmpdir(), 'muse-toolio-jobs-'))
const jobAssembly =
  process.platform === 'win32'
    ? shellJobAssembly({
        storageDir: jobStorage,
        systemRoot: String(process.env['SystemRoot']),
        log: () => undefined,
      })
    : undefined

afterAll(() => removeFolder(jobStorage))

const io = () =>
  createToolIo({
    platform: process.platform,
    listFiles: () => Promise.resolve(['a.txt']),
    systemRoot: process.env['SystemRoot'],
    env: () => process.env,
    searchWorkerPath: 'unused-here',
    log: () => undefined,
    hasUnsavedChanges: () => false,
    shellJobAssembly: jobAssembly,
  })

describe('createToolIo (real file system and shell)', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-toolio-'))
  })
  afterAll(() => removeFolder(root))

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

  it('creates the folders a new file goes into (D26)', async () => {
    const target = path.join(root, 'deep', 'er', 'b.txt')
    await io().writeFile(target, 'nested\n')
    await expect(readFile(target, 'utf8')).resolves.toBe('nested\n')
  })

  it('reads only UTF-8 text, keeping its BOM, and refuses anything else (D27)', async () => {
    const folder = path.join(root, 'encodings')
    const bom = path.join(folder, 'bom.txt')
    await io().writeFile(bom, '\u{FEFF}héllo\n')
    await expect(io().readFile(bom)).resolves.toBe('\u{FEFF}héllo\n')
    const refused: Record<string, Uint8Array> = {
      'latin1.txt': Uint8Array.from([0x63, 0x61, 0x66, 0xe9]),
      'utf16le.txt': Uint8Array.from([0xff, 0xfe, 0x68, 0x00]),
      'utf16be.txt': Uint8Array.from([0xfe, 0xff, 0x00, 0x68]),
      'blob.bin': Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]),
    }
    for (const [name, bytes] of Object.entries(refused)) {
      const file = path.join(folder, name)
      await writeFile(file, bytes)
      await expect(io().readFile(file), name).rejects.toThrow(UI_TEXT.fileNotText)
    }
  })

  it('replaces a file in one step and leaves no temporary file behind (D27)', async () => {
    const folder = path.join(root, 'atomic')
    const target = path.join(folder, 'c.txt')
    await io().writeFile(target, 'one\n')
    await io().writeFile(target, 'two\n')
    await expect(readFile(target, 'utf8')).resolves.toBe('two\n')
    expect(await readdir(folder)).toEqual(['c.txt'])
  })

  it.runIf(process.platform === 'win32')(
    'gets Windows PowerShell output as UTF-8, native commands included (D27)',
    async () => {
      const result = await io().runShell(
        "Write-Output 'héllo ✓ 日本'; cmd /c echo native-é",
        root,
        SHELL_BUDGET_MS,
      )
      expect(result.stdout).toContain('héllo ✓ 日本')
      expect(result.stdout).toContain('native-é')
      expect(result.stderr).toBe('')
    },
    TEST_BUDGET_MS,
  )

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

  it('returns when the shell exits even if a background child holds the output (D25)', async () => {
    // The old runner resolved on the pipes closing, so this took the child's whole life.
    // The child runs elsewhere, so it does not lock the test folder while it lives on.
    const command =
      process.platform === 'win32'
        ? 'Start-Process -NoNewWindow -WorkingDirectory $env:SystemRoot -FilePath ping -ArgumentList "-n","30","127.0.0.1"; Write-Output started'
        : '(cd / && sleep 30) & echo started'
    const started = Date.now()
    const result = await io().runShell(command, root, SHELL_BUDGET_MS)
    expect(result.stdout).toContain('started')
    expect(result.exitCode).toBe(0)
    expect(Date.now() - started).toBeLessThan(BACKGROUND_BOUND_MS)
  }, 60_000)

  it('kills the whole tree on a timeout and on Stop (D25)', async () => {
    const command =
      process.platform === 'win32'
        ? 'Start-Process -NoNewWindow -FilePath ping -ArgumentList "-n","30","127.0.0.1"; Start-Sleep -Seconds 30'
        : 'sleep 30 & sleep 30'
    const started = Date.now()
    const timedOut = await io().runShell(command, root, 500)
    expect(timedOut.isTimedOut).toBe(true)
    // Killing only the shell left the background child holding the pipes for 30 s.
    expect(Date.now() - started).toBeLessThan(BACKGROUND_BOUND_MS)
    const stop = new AbortController()
    const pending = io().runShell(command, root, SHELL_BUDGET_MS, stop.signal)
    setTimeout(() => {
      stop.abort()
    }, 500)
    const stopped = await pending
    expect(stopped).toMatchObject({ isCancelled: true, isTimedOut: false })
    const alreadyStopped = new AbortController()
    alreadyStopped.abort()
    await expect(
      io().runShell(command, root, SHELL_BUDGET_MS, alreadyStopped.signal),
    ).resolves.toMatchObject({ isCancelled: true, exitCode: null })
  }, 60_000)

  it('answers a killed command only once the sweep for its orphans is done (M27)', async () => {
    // Windows' kill path on any OS: a stand-in taskkill ends the process, a
    // stand-in process table answers late and says when.
    let isSwept = false
    const run: RunProgram = (file, args) => {
      if (path.win32.basename(file) === 'taskkill.exe') {
        process.kill(Number(args[1]))
        return Promise.resolve('')
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          isSwept = true
          resolve('')
        }, SWEEP_DELAY_MS)
      })
    }
    const result = await runCommand({
      file: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd: root,
      env: process.env,
      timeoutMs: 300,
      signal: undefined,
      tree: { platform: 'win32', systemRoot: String.raw`C:\Windows`, log: () => undefined, run },
    })
    expect(result.isTimedOut).toBe(true)
    expect(isSwept).toBe(true)
  }, 60_000)

  it('reports an interpreter that cannot start instead of hanging', async () => {
    // A Windows layout whose PowerShell does not exist, on any host OS.
    const broken = createToolIo({
      platform: 'win32',
      listFiles: () => Promise.resolve([]),
      systemRoot: path.join(root, 'no-such-windows'),
      env: () => process.env,
      searchWorkerPath: 'unused-here',
      log: () => undefined,
      hasUnsavedChanges: () => false,
    })
    const result = await broken.runShell('echo hi', root, SHELL_BUDGET_MS)
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toMatch(/ENOENT/)
    expect(result.isTimedOut).toBe(false)
  })
})
