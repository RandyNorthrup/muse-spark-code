// Ending a command together with everything it started (PLAN.md D25, M27).
// `ChildProcess.kill` signals one process: a shell killed on a timeout or a
// Stop leaves its children running, and a grandchild that still holds the
// output pipes keeps the tool call open for ever (Claude Code #90672 is the
// same bug). On POSIX the command runs as the leader of its own process
// group and the whole group is signalled. On Windows `taskkill /T /F` ends
// the tree it enumerates, but a child the shell starts between that
// enumeration and its own end outlives it, orphaned (under load it happened
// on every kill at the 0.6.0 gate, and one such child was left suspended for
// good). So once the shell has exited, its orphans are looked up in the
// process table by their parent's id and their trees killed in turn, a few
// rounds deep. A child counts only if it was created while its parent was
// ours (after the shell started, before the parent died), so a process that
// later took a dead parent's id never has its children hit; a process that
// has already exited is never signalled, so a recycled id is never hit
// either.

import { execFile } from 'node:child_process'
import path from 'node:path'
import { windowsPowerShellModulePath } from '../core/backends/musecode/launch'
import {
  ORPHAN_SWEEP_ROUNDS,
  PROCESS_TABLE_TIMEOUT_MS,
  TREE_EXIT_WAIT_MS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_TASKKILL_RELATIVE_PATH,
} from '../shared/constants'

const SIGKILL = 'SIGKILL'
const PS_MODULE_PATH = 'PSModulePath'

/** Runs a program to its end: its stdout, or a rejection on a failure exit. */
export type RunProgram = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<string>

export interface ProcessTreeDeps {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  readonly log: (message: string) => void
  /** `execFile`, hidden and bounded; tests stand in taskkill and the process table. */
  readonly run?: RunProgram
}

/** The shell a tree kill starts from (a `ChildProcess` is one). */
export interface TreeRoot {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', listener: () => void): unknown
}

/** Spawn options that make a later tree kill possible. */
export function treeSpawnOptions(platform: NodeJS.Platform): { readonly detached: boolean } {
  // A new process group (and session) on POSIX; on Windows `detached` would
  // give the command a console of its own instead, so it stays attached.
  return { detached: platform !== 'win32' }
}

function hasExited(root: TreeRoot): boolean {
  return root.exitCode !== null || root.signalCode !== null
}

function runHidden(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS, env },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(new Error(error.message, { cause: error }))
      },
    )
  })
}

/** When `root` exits (its time), or undefined if it has not within `ms`. */
function deathOf(root: TreeRoot, ms: number): Promise<number | undefined> {
  if (hasExited(root)) {
    return Promise.resolve(Date.now())
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined)
    }, ms)
    root.once('exit', () => {
      clearTimeout(timer)
      resolve(Date.now())
    })
  })
}

/** A row of the process table: ids, and the creation time in epoch milliseconds. */
export interface ProcessRow {
  readonly pid: number
  readonly parent: number
  readonly createdAt: number
  readonly name: string
}

// A FILETIME counts 100 ns ticks from 1601-01-01 UTC: past 2^53, so a BigInt.
const FILETIME_TICKS_PER_MS = 10_000n
const FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000n
const DECIMAL = /^\d+$/

/** The processes whose parent is one of `parents`, one row per line. */
function processTableScript(parents: Iterable<number>): string {
  const filter = Array.from(parents, (id) => `ParentProcessId=${String(id)}`).join(' OR ')
  return `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc(), $_.Name }`
}

/** The script's rows; a line that is not one (an error, a blank) is skipped. */
export function parseProcessTable(stdout: string): readonly ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const [pid = '', parent = '', ticks = '', ...name] = line.trim().split(' ')
    if ([pid, parent, ticks].some((field) => !DECIMAL.test(field))) {
      continue
    }
    rows.push({
      pid: Number(pid),
      parent: Number(parent),
      createdAt: Number(BigInt(ticks) / FILETIME_TICKS_PER_MS - FILETIME_UNIX_EPOCH_MS),
      name: name.join(' '),
    })
  }
  return rows
}

/**
 * The rows that are orphans of `ancestors` (each id with the time it died):
 * created after the shell started and before the parent died, so never a
 * child of a later process that took a dead parent's id.
 */
function orphansIn(
  rows: readonly ProcessRow[],
  ancestors: ReadonlyMap<number, number>,
  startedAt: number,
): readonly ProcessRow[] {
  return rows.filter((row) => {
    const parentDiedAt = ancestors.get(row.parent)
    return (
      parentDiedAt !== undefined &&
      !ancestors.has(row.pid) &&
      row.createdAt >= startedAt &&
      row.createdAt <= parentDiedAt
    )
  })
}

async function sweepOrphans(
  shellPid: number,
  diedAt: number,
  startedAt: number,
  systemRoot: string,
  deps: ProcessTreeDeps,
): Promise<void> {
  const run = deps.run ?? runHidden
  const taskkill = path.win32.join(systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH)
  const powershell = path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
  // Windows PowerShell's own modules (Get-CimInstance), whatever shell VS Code came from.
  const env = {
    ...process.env,
    [PS_MODULE_PATH]: windowsPowerShellModulePath(systemRoot, process.env['ProgramFiles']),
  }
  const ancestors = new Map([[shellPid, diedAt]])
  for (let round = 0; round < ORPHAN_SWEEP_ROUNDS; round += 1) {
    let rows: readonly ProcessRow[]
    try {
      rows = parseProcessTable(
        await run(
          powershell,
          [...WINDOWS_POWERSHELL_COMMAND_ARGS, processTableScript(ancestors.keys())],
          env,
        ),
      )
    } catch (error: unknown) {
      deps.log(
        `the process table could not be read after killing ${String(shellPid)} (${String(error)}); a child started during the kill may still run`,
      )
      return
    }
    const orphans = orphansIn(rows, ancestors, startedAt)
    if (orphans.length === 0) {
      return
    }
    for (const orphan of orphans) {
      deps.log(
        `${orphan.name} ${String(orphan.pid)} outlived the tree kill of ${String(orphan.parent)}; killing it`,
      )
      try {
        await run(taskkill, ['/PID', String(orphan.pid), '/T', '/F'], env)
      } catch (error: unknown) {
        deps.log(`taskkill of ${String(orphan.pid)} failed (${String(error)})`)
      }
      ancestors.set(orphan.pid, Date.now())
    }
  }
  deps.log(
    `children of ${String(shellPid)} kept appearing for ${String(ORPHAN_SWEEP_ROUNDS)} rounds after its tree kill`,
  )
}

/**
 * Kills `root` and its descendants; resolves once they are gone, as far as
 * the process table shows. `startedAt` is when the shell was spawned.
 */
export async function killTree(
  root: TreeRoot,
  deps: ProcessTreeDeps,
  startedAt: number,
): Promise<void> {
  const { pid } = root
  if (pid === undefined || hasExited(root)) {
    return
  }
  if (deps.platform !== 'win32') {
    try {
      process.kill(-pid, SIGKILL)
    } catch (error: unknown) {
      // The group may be gone already; the leader itself still gets the signal.
      deps.log(`process group ${String(pid)} could not be signalled: ${String(error)}`)
      root.kill(SIGKILL)
    }
    return
  }
  const { systemRoot } = deps
  if (systemRoot === undefined) {
    root.kill(SIGKILL)
    return
  }
  const death = deathOf(root, TREE_EXIT_WAIT_MS)
  try {
    await (deps.run ?? runHidden)(
      path.win32.join(systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH),
      ['/PID', String(pid), '/T', '/F'],
      process.env,
    )
  } catch (error: unknown) {
    if (!hasExited(root)) {
      deps.log(`taskkill of ${String(pid)} failed (${String(error)}); killing the shell only`)
      root.kill(SIGKILL)
    }
  }
  const diedAt = await death
  if (diedAt === undefined) {
    deps.log(`${String(pid)} was still running ${String(TREE_EXIT_WAIT_MS)} ms after its tree kill`)
    return
  }
  await sweepOrphans(pid, diedAt, startedAt, systemRoot, deps)
}
