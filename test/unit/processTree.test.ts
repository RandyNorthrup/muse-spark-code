// The tree kill (D25, M27). Against real processes: a shell that starts a
// child and waits, killed as a whole; on Windows, a command in its job
// object ended whole (a launcher's orphaned grandchild included) while a
// normal end leaves its background process alone, and the fallback's sweep
// finding a child that outlived taskkill; the no-op on a process already
// gone. Against scripted helpers: the job path, the fallback's rounds, the
// identity check before each kill, and what it says when it cannot.

import { execFile, spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsPowerShellModulePath } from '../../src/core/backends/musecode/launch'
import { newShellJob, shellJobAssembly } from '../../src/host/backend/shellJob'
import { shellArguments } from '../../src/host/backend/toolIo'
import {
  killTree,
  parseProcessTable,
  type RunProgram,
  type TreeRoot,
  treeSpawnOptions,
  windowsPowerShell,
} from '../../src/host/processTree'
import { ORPHAN_SWEEP_ROUNDS } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'

const deps = {
  platform: process.platform,
  systemRoot: process.env['SystemRoot'],
  log: () => undefined,
}

function shellWithChild(): ReturnType<typeof spawn> {
  // A parent whose own child keeps the output pipe open for 30 s.
  return IS_WINDOWS
    ? spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'ping -n 30 127.0.0.1; Start-Sleep 30'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...treeSpawnOptions('win32') },
      )
    : spawn('/bin/sh', ['-c', 'sleep 30 & sleep 30'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...treeSpawnOptions(process.platform),
      })
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const runForReal: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, env }, (error, stdout) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      reject(new Error(error.message))
    })
  })

// A ping started through a launcher (a second PowerShell) that prints its
// id and exits, so the ping's parent is gone: no process-table link leads
// from the shell to it. The backtick keeps the outer shell from expanding
// the launcher's `$_`.
const LAUNCHED_PING =
  "powershell -NoProfile -Command \"Start-Process -NoNewWindow -PassThru -FilePath ping -ArgumentList '-n','30','127.0.0.1' | ForEach-Object { [Console]::Out.WriteLine('PID ' + `$_.Id) }\""

/** The id a command printed as `PID <n>`; the ping writes to the same pipe. */
function printedPid(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = /PID (\d+)/.exec(output)
      if (match?.[1] !== undefined) {
        resolve(Number(match[1]))
      }
    })
  })
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Long enough for the launcher to have exited.
const LAUNCHER_EXIT_MS = 2000

describe('killTree', () => {
  const storage = { dir: '' }
  beforeAll(async () => {
    storage.dir = await mkdtemp(path.join(tmpdir(), 'muse-job-'))
  })
  afterAll(() => removeFolder(storage.dir))

  it('ends the shell and the child holding its output, so the pipes close', async () => {
    const startedAt = Date.now()
    const child = shellWithChild()
    child.stdout?.resume()
    child.stderr?.resume()
    const closed = new Promise<void>((resolve) => {
      child.on('close', () => {
        resolve()
      })
    })
    await pause(500)
    const started = Date.now()
    await killTree(child, deps, startedAt)
    await closed
    // Killing only the shell would leave the pipes open for the child's 30 s.
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 60_000)

  it.runIf(IS_WINDOWS)(
    'ends everything in the command’s job, a launcher’s orphaned grandchild included (M27)',
    async () => {
      const systemRoot = String(process.env['SystemRoot'])
      const logged: string[] = []
      const assembly = await shellJobAssembly({
        storageDir: storage.dir,
        systemRoot,
        log: (message) => {
          logged.push(message)
        },
      })()
      expect(logged).toEqual([])
      expect(assembly).toBeDefined()
      const job = newShellJob(String(assembly))
      const startedAt = Date.now()
      const shell = spawn(
        'powershell.exe',
        [...shellArguments('win32', `${LAUNCHED_PING}; Start-Sleep -Seconds 30`, job)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      shell.stderr.resume()
      const pingPid = await printedPid(shell)
      await pause(LAUNCHER_EXIT_MS)
      try {
        expect(isRunning(pingPid)).toBe(true)
        await killTree(
          shell,
          {
            ...deps,
            log: (message) => {
              logged.push(message)
            },
          },
          startedAt,
          job,
        )
        expect(isRunning(pingPid)).toBe(false)
        expect(logged).toEqual([])
      } finally {
        if (isRunning(pingPid)) {
          process.kill(pingPid)
        }
      }
    },
    60_000,
  )

  it.runIf(IS_WINDOWS)(
    'leaves a background process running when the command ends on its own (M27)',
    async () => {
      const assembly = await shellJobAssembly({
        storageDir: storage.dir,
        systemRoot: String(process.env['SystemRoot']),
        log: () => undefined,
      })()
      const shell = spawn(
        'powershell.exe',
        [...shellArguments('win32', LAUNCHED_PING, newShellJob(String(assembly)))],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      shell.stderr.resume()
      const pingPid = await printedPid(shell)
      await new Promise((resolve) => {
        shell.on('exit', resolve)
      })
      await pause(500)
      try {
        expect(isRunning(pingPid)).toBe(true)
      } finally {
        if (isRunning(pingPid)) {
          process.kill(pingPid)
        }
      }
    },
    60_000,
  )

  it.runIf(IS_WINDOWS)(
    'without a job, finds and kills a child that outlived its shell’s tree kill (M27)',
    async () => {
      const startedAt = Date.now()
      const shell = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Start-Process -NoNewWindow -PassThru -FilePath ping -ArgumentList '-n','30','127.0.0.1' | ForEach-Object { [Console]::Out.WriteLine('PID ' + $_.Id) }; Start-Sleep -Seconds 30",
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      shell.stderr.resume()
      const pingPid = await printedPid(shell)
      expect(isRunning(pingPid)).toBe(true)
      // The escape: taskkill's enumeration missed the child, so only the shell dies.
      const run: RunProgram = (file, args, env) => {
        if (path.win32.basename(file) === 'taskkill.exe' && args[1] === String(shell.pid)) {
          shell.kill()
          return Promise.resolve('')
        }
        return runForReal(file, args, env)
      }
      try {
        await killTree(shell, { ...deps, run }, startedAt)
        expect(isRunning(pingPid)).toBe(false)
      } finally {
        if (isRunning(pingPid)) {
          process.kill(pingPid)
        }
      }
    },
    60_000,
  )

  it('does nothing to a process that has exited', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise((resolve) => {
      child.on('exit', resolve)
    })
    const logged: string[] = []
    await killTree(
      child,
      {
        ...deps,
        log: (message) => {
          logged.push(message)
        },
      },
      Date.now(),
    )
    expect(logged).toEqual([])
  })

  it('makes the command a group leader on POSIX only', () => {
    expect(treeSpawnOptions('linux')).toEqual({ detached: true })
    expect(treeSpawnOptions('darwin')).toEqual({ detached: true })
    expect(treeSpawnOptions('win32')).toEqual({ detached: false })
  })
})

describe('windowsPowerShell', () => {
  it('gives Windows PowerShell its own module path under one spelling only', () => {
    // PowerShell 7 leaves an upper-case spelling; Windows would hand a child
    // the first one it sorts, so both must not be there.
    const { file, env } = windowsPowerShell(String.raw`C:\Windows`, {
      PSMODULEPATH: String.raw`C:\Program Files\PowerShell\7\Modules`,
      ProgramFiles: String.raw`C:\Program Files`,
    })
    expect(file).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'psmodulepath')).toEqual([
      'PSModulePath',
    ])
    expect(env['PSModulePath']).toBe(
      windowsPowerShellModulePath(String.raw`C:\Windows`, String.raw`C:\Program Files`),
    )
  })
})

/** A shell that dies when its tree kill (or a plain kill) reaches it. */
class FakeShell extends EventEmitter implements TreeRoot {
  public exitCode: number | null = null
  public signalCode: NodeJS.Signals | null = null
  public readonly kills: (NodeJS.Signals | undefined)[] = []

  public constructor(public readonly pid: number) {
    super()
  }

  public kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal)
    this.die()
    return true
  }

  public die(): void {
    this.exitCode = 1
    this.emit('exit')
  }
}

// FILETIME: 100 ns ticks since 1601-01-01 UTC, as the process table prints it.
function fileTime(ms: number): string {
  return String((BigInt(Math.round(ms)) + 11_644_473_600_000n) * 10_000n)
}

type Row = readonly [pid: number, parent: number, createdAt: number, name: string]

function table(rows: readonly Row[]): string {
  return rows
    .map(([pid, parent, at, name]) => `${String(pid)} ${String(parent)} ${fileTime(at)} ${name}`)
    .join('\r\n')
}

const SECOND = 1000
const JOB = {
  name: String.raw`Local\MuseSparkShell-test`,
  assemblyPath: String.raw`C:\store\job.dll`,
}

interface Script {
  readonly failTaskkill?: boolean
  /** What the job's Terminate prints, or an Error to reject with. */
  readonly job?: string | Error
  /** Ids the identity check finds changed, so it leaves them. */
  readonly changed?: readonly number[]
  readonly tables?: readonly string[]
}

/** Helpers over a scripted world: taskkill, the job, the process table and the identity kill. */
function scripted(shell: FakeShell, script: Script = {}) {
  const calls: { readonly program: string; readonly body: string }[] = []
  const killed: number[] = []
  const logged: string[] = []
  const tables = [...(script.tables ?? [])]
  const run: RunProgram = (file, args) => {
    const program = path.win32.basename(file)
    const body = args.at(-1) ?? ''
    calls.push({ program, body })
    if (program === 'taskkill.exe') {
      if (script.failTaskkill === true) {
        return Promise.reject(new Error('Access is denied.'))
      }
      shell.die()
      return Promise.resolve('SUCCESS')
    }
    if (body.includes('::Terminate(')) {
      if (script.job instanceof Error) {
        return Promise.reject(script.job)
      }
      if (script.job === 'terminated') {
        shell.die()
      }
      return Promise.resolve(`${script.job ?? 'absent'}\r\n`)
    }
    if (body.includes('Stop-Process')) {
      const ids = Array.from(body.matchAll(/@\((\d+), \d+\)/g), (match) => Number(match[1]))
      const done = ids.filter((id) => !(script.changed ?? []).includes(id))
      killed.push(...done)
      return Promise.resolve(done.map(String).join('\r\n'))
    }
    return Promise.resolve(tables.shift() ?? '')
  }
  const scriptedDeps = {
    platform: 'win32' as const,
    systemRoot: String.raw`C:\Windows`,
    log: (message: string) => {
      logged.push(message)
    },
    run,
  }
  const lookups = () => calls.filter((call) => call.body.includes('Get-CimInstance'))
  const taskkills = () => calls.filter((call) => call.program === 'taskkill.exe')
  return { calls, killed, logged, scriptedDeps, lookups, taskkills }
}

describe('the job path (M27)', () => {
  it('terminates the command’s job and needs nothing else', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell, { job: 'terminated' })
    await killTree(shell, world.scriptedDeps, Date.now() - SECOND, JOB)
    expect(world.calls).toHaveLength(1)
    expect(world.calls[0]?.body).toContain(String.raw`Add-Type -Path 'C:\store\job.dll'`)
    expect(world.calls[0]?.body).toContain(String.raw`::Terminate('Local\MuseSparkShell-test', 1)`)
    expect(world.logged).toEqual([])
  })

  it('falls back to taskkill and the sweep when the job is not there, saying so', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell, { job: 'absent', tables: [table([])] })
    await killTree(shell, world.scriptedDeps, Date.now() - SECOND, JOB)
    expect(world.taskkills()).toHaveLength(1)
    expect(world.lookups()).toHaveLength(1)
    expect(world.logged).toEqual([
      'the job of 100 was not there (absent); ending its tree with taskkill',
    ])
  })

  it('falls back when the helper itself fails', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell, {
      job: new Error('Add-Type is not allowed'),
      tables: [table([])],
    })
    await killTree(shell, world.scriptedDeps, Date.now() - SECOND, JOB)
    expect(world.taskkills()).toHaveLength(1)
    expect(world.logged).toEqual([
      'the job of 100 could not be terminated (Error: Add-Type is not allowed); ending its tree with taskkill',
    ])
  })
})

describe('the fallback sweep (M27)', () => {
  it('kills the children a tree kill missed, and theirs, never another process’s', async () => {
    const now = Date.now()
    const shell = new FakeShell(100)
    const world = scripted(shell, {
      tables: [
        table([
          [200, 100, now - 5 * SECOND, 'PING.EXE'],
          // Older than the shell: an earlier holder of its id.
          [300, 100, now - 60 * SECOND, 'old.exe'],
          // Newer than the shell's death: a later holder of its id.
          [400, 100, now + 60 * SECOND, 'later.exe'],
        ]),
        table([[500, 200, now - 3 * SECOND, 'conhost.exe']]),
        table([]),
      ],
    })
    await killTree(shell, world.scriptedDeps, now - 10 * SECOND)
    expect(world.killed).toEqual([200, 500])
    // The second lookup asks after the orphan's children too.
    expect(world.lookups()).toHaveLength(3)
    expect(world.lookups()[1]?.body).toContain('ParentProcessId=100 OR ParentProcessId=200')
    expect(world.logged).toEqual([
      'PING.EXE 200 outlived the tree kill of 100; killed it',
      'conhost.exe 500 outlived the tree kill of 200; killed it',
    ])
  })

  it('checks each orphan is still itself just before the kill, and leaves one that is not', async () => {
    const now = Date.now()
    const shell = new FakeShell(100)
    const world = scripted(shell, {
      changed: [200],
      tables: [table([[200, 100, now - 5 * SECOND, 'PING.EXE']])],
    })
    await killTree(shell, world.scriptedDeps, now - 10 * SECOND)
    const kill = world.calls.find((call) => call.body.includes('Stop-Process'))
    // The id and the creation time the table showed travel with the kill.
    expect(kill?.body).toContain(`@(200, ${fileTime(now - 5 * SECOND)})`)
    expect(kill?.body).toContain('$process.StartTime.ToFileTimeUtc()')
    expect(world.killed).toEqual([])
    expect(world.logged).toEqual([])
    // Not killed, so not followed: one lookup only.
    expect(world.lookups()).toHaveLength(1)
  })

  it('looks once and stops when the tree kill missed nothing', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell, { tables: [table([])] })
    await killTree(shell, world.scriptedDeps, Date.now() - SECOND)
    expect(world.taskkills()).toHaveLength(1)
    expect(world.lookups()).toHaveLength(1)
    expect(world.logged).toEqual([])
  })

  it(`gives up, saying so, after ${String(ORPHAN_SWEEP_ROUNDS)} rounds of new children`, async () => {
    const now = Date.now()
    const shell = new FakeShell(100)
    const generations = Array.from({ length: ORPHAN_SWEEP_ROUNDS }, (_, index) =>
      table([[201 + index, index === 0 ? 100 : 200 + index, now - SECOND, 'spawner.exe']]),
    )
    const world = scripted(shell, { tables: generations })
    await killTree(shell, world.scriptedDeps, now - 10 * SECOND)
    expect(world.killed).toHaveLength(ORPHAN_SWEEP_ROUNDS)
    expect(world.logged.at(-1)).toBe(
      `children of 100 kept appearing for ${String(ORPHAN_SWEEP_ROUNDS)} rounds after its tree kill`,
    )
  })

  it('says when the process table cannot be read', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell)
    const failing: RunProgram = (file, args, env) =>
      path.win32.basename(file) === 'powershell.exe'
        ? Promise.reject(new Error('WMI is unavailable'))
        : world.scriptedDeps.run(file, args, env)
    await killTree(shell, { ...world.scriptedDeps, run: failing }, Date.now() - SECOND)
    expect(world.logged).toEqual([
      'the process table could not be read or acted on after killing 100 (Error: WMI is unavailable); a child started during the kill may still run',
    ])
  })

  it('kills the shell alone when taskkill fails', async () => {
    const shell = new FakeShell(100)
    const world = scripted(shell, { failTaskkill: true, tables: [table([])] })
    await killTree(shell, world.scriptedDeps, Date.now() - SECOND)
    expect(shell.kills).toEqual(['SIGKILL'])
    expect(world.logged[0]).toBe(
      'taskkill of 100 failed (Error: Access is denied.); killing the shell only',
    )
  })

  it('reads the table’s rows, names with spaces included, and skips anything else', () => {
    const at = Date.parse('2026-09-23T12:00:00.000Z')
    expect(
      parseProcessTable(`${table([[7, 3, at, 'My Tool.exe']])}\r\n\r\nGet-CimInstance : error\r\n`),
    ).toEqual([{ pid: 7, parent: 3, ticks: fileTime(at), createdAt: at, name: 'My Tool.exe' }])
  })
})
