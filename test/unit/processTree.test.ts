// The tree kill (D25, M27). Against real processes: a shell that starts a
// child and waits, killed as a whole; on Windows, a child that outlived its
// shell's kill (the escape M27 closes), found and killed; the no-op on a
// process already gone. Against a scripted process table: which orphans the
// sweep kills, round by round, and what it says when it cannot.

import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  killTree,
  parseProcessTable,
  type RunProgram,
  type TreeRoot,
  treeSpawnOptions,
} from '../../src/host/processTree'
import { ORPHAN_SWEEP_ROUNDS } from '../../src/shared/constants'

const deps = {
  platform: process.platform,
  systemRoot: process.env['SystemRoot'],
  log: () => undefined,
}

function shellWithChild(): ReturnType<typeof spawn> {
  // A parent whose own child keeps the output pipe open for 30 s.
  return process.platform === 'win32'
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

describe('killTree', () => {
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
    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })
    const started = Date.now()
    await killTree(child, deps, startedAt)
    await closed
    // Killing only the shell would leave the pipes open for the child's 30 s.
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 60_000)

  it.runIf(process.platform === 'win32')(
    'finds and kills a child that outlived its shell’s tree kill (M27)',
    async () => {
      const startedAt = Date.now()
      const shell = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Start-Process -NoNewWindow -PassThru -FilePath ping -ArgumentList '-n','30','127.0.0.1' | ForEach-Object { [Console]::Out.WriteLine($_.Id) }; Start-Sleep -Seconds 30",
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      shell.stderr.resume()
      // Ping writes to the same pipe; its id is the line of digits alone.
      const pingPid = await new Promise<number>((resolve) => {
        let output = ''
        shell.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          const id = output.split(/\r?\n/).find((line) => /^\d+$/.test(line))
          if (id !== undefined) {
            resolve(Number(id))
          }
        })
      })
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

/** The sweep over scripted process tables, one per lookup; taskkill always succeeds. */
function sweepOver(
  shell: FakeShell,
  tables: readonly string[],
  options: { failTaskkill?: boolean } = {},
) {
  const calls: string[][] = []
  const logged: string[] = []
  const remaining = [...tables]
  const run: RunProgram = (file, args) => {
    const program = path.win32.basename(file)
    calls.push([program, ...args])
    if (program === 'taskkill.exe') {
      if (options.failTaskkill === true) {
        return Promise.reject(new Error('Access is denied.'))
      }
      if (args[1] === String(shell.pid)) {
        shell.die()
      }
      return Promise.resolve('SUCCESS')
    }
    return Promise.resolve(remaining.shift() ?? '')
  }
  const sweepDeps = {
    platform: 'win32' as const,
    systemRoot: String.raw`C:\Windows`,
    log: (message: string) => {
      logged.push(message)
    },
    run,
  }
  return { calls, logged, sweepDeps }
}

const killedPids = (calls: readonly string[][]) =>
  calls.filter(([program]) => program === 'taskkill.exe').map((call) => call[2])

describe('the orphan sweep (M27)', () => {
  it('kills the children a tree kill missed, and theirs, never another process’s', async () => {
    const now = Date.now()
    const shell = new FakeShell(100)
    const { calls, logged, sweepDeps } = sweepOver(shell, [
      table([
        [200, 100, now - 5 * SECOND, 'PING.EXE'],
        // Older than the shell: an earlier holder of its id.
        [300, 100, now - 60 * SECOND, 'old.exe'],
        // Newer than the shell's death: a later holder of its id.
        [400, 100, now + 60 * SECOND, 'later.exe'],
      ]),
      table([[500, 200, now - 3 * SECOND, 'conhost.exe']]),
      table([]),
    ])
    await killTree(shell, sweepDeps, now - 10 * SECOND)
    expect(killedPids(calls)).toEqual(['100', '200', '500'])
    // The second lookup asks after the orphan's children too.
    const lookups = calls.filter(([program]) => program === 'powershell.exe')
    expect(lookups).toHaveLength(3)
    expect(lookups[1]?.at(-1)).toContain('ParentProcessId=100 OR ParentProcessId=200')
    expect(logged).toEqual([
      'PING.EXE 200 outlived the tree kill of 100; killing it',
      'conhost.exe 500 outlived the tree kill of 200; killing it',
    ])
  })

  it('looks once and stops when the tree kill missed nothing', async () => {
    const shell = new FakeShell(100)
    const { calls, logged, sweepDeps } = sweepOver(shell, [table([])])
    await killTree(shell, sweepDeps, Date.now() - SECOND)
    expect(killedPids(calls)).toEqual(['100'])
    expect(calls.filter(([program]) => program === 'powershell.exe')).toHaveLength(1)
    expect(logged).toEqual([])
  })

  it(`gives up, saying so, after ${String(ORPHAN_SWEEP_ROUNDS)} rounds of new children`, async () => {
    const now = Date.now()
    const shell = new FakeShell(100)
    const generations = Array.from({ length: ORPHAN_SWEEP_ROUNDS }, (_, index) =>
      table([[201 + index, index === 0 ? 100 : 200 + index, now - SECOND, 'spawner.exe']]),
    )
    const { calls, logged, sweepDeps } = sweepOver(shell, generations)
    await killTree(shell, sweepDeps, now - 10 * SECOND)
    expect(killedPids(calls)).toHaveLength(1 + ORPHAN_SWEEP_ROUNDS)
    expect(logged.at(-1)).toBe(
      `children of 100 kept appearing for ${String(ORPHAN_SWEEP_ROUNDS)} rounds after its tree kill`,
    )
  })

  it('says when the process table cannot be read', async () => {
    const shell = new FakeShell(100)
    const { logged, sweepDeps } = sweepOver(shell, [])
    const failing: RunProgram = (file, args, env) =>
      path.win32.basename(file) === 'powershell.exe'
        ? Promise.reject(new Error('WMI is unavailable'))
        : sweepDeps.run(file, args, env)
    await killTree(shell, { ...sweepDeps, run: failing }, Date.now() - SECOND)
    expect(logged).toEqual([
      'the process table could not be read after killing 100 (Error: WMI is unavailable); a child started during the kill may still run',
    ])
  })

  it('kills the shell alone when taskkill fails', async () => {
    const shell = new FakeShell(100)
    const { logged, sweepDeps } = sweepOver(shell, [table([])], { failTaskkill: true })
    await killTree(shell, sweepDeps, Date.now() - SECOND)
    expect(shell.kills).toEqual(['SIGKILL'])
    expect(logged[0]).toBe(
      'taskkill of 100 failed (Error: Access is denied.); killing the shell only',
    )
  })

  it('reads the table’s rows, names with spaces included, and skips anything else', () => {
    const at = Date.parse('2026-09-23T12:00:00.000Z')
    expect(
      parseProcessTable(`${table([[7, 3, at, 'My Tool.exe']])}\r\n\r\nGet-CimInstance : error\r\n`),
    ).toEqual([{ pid: 7, parent: 3, createdAt: at, name: 'My Tool.exe' }])
  })
})
