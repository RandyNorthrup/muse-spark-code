// Ending a command together with everything it started (PLAN.md D25, M27).
// `ChildProcess.kill` signals one process: a shell killed on a timeout or a
// Stop leaves its children running, and a grandchild that still holds the
// output pipes keeps the tool call open for ever (Claude Code #90672 is the
// same bug). On POSIX the command runs as the leader of its own process
// group and the whole group is signalled.
//
// On Windows `taskkill /T /F` ends only the tree it enumerates: a child the
// shell starts between that enumeration and its own end outlives it (under
// load it happened on every kill at the 0.6.0 gate, and one such child was
// left suspended for good), and a launcher that exits leaves its own child
// with no link to the shell at all. So each command joins a job object of
// its own (`shellJob.ts`), which every process it starts belongs to from
// its creation, and a kill terminates the job whole. Where no job could be
// made, the fallback is taskkill and then a sweep of the process table for
// the shell's orphans, one generation per round, each checked against its
// creation time just before it is killed, so a process that took a dead
// one's id is never hit.

import { execFile } from 'node:child_process'
import path from 'node:path'
import {
  setEnvironmentVariable,
  windowsPowerShellModulePath,
} from '../core/backends/musecode/launch'
import {
  ORPHAN_SWEEP_ROUNDS,
  PROCESS_TABLE_TIMEOUT_MS,
  SHELL_JOB_TYPE_NAME,
  TREE_EXIT_WAIT_MS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_TASKKILL_RELATIVE_PATH,
} from '../shared/constants'

const SIGKILL = 'SIGKILL'
const PS_MODULE_PATH = 'PSModulePath'
const TERMINATED = 'terminated'
const ABSENT = 'absent'
// A killed process's exit code, as `taskkill /F` gives it.
const KILLED_EXIT_CODE = 1

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
  /** `execFile`, hidden and bounded; tests stand in taskkill, the job and the process table. */
  readonly run?: RunProgram
}

/** The job object a Windows command runs in (`shellJob.ts`). */
export interface ShellJob {
  readonly name: string
  /** The compiled helper type's assembly. */
  readonly assemblyPath: string
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

/** A PowerShell single-quoted string: nothing inside it is expanded. */
export function powerShellQuoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`
}

export const runProgram: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
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

/**
 * Windows PowerShell with its own modules (`Get-CimInstance`, `Add-Type`),
 * whatever shell VS Code came from: every spelling of `PSModulePath` is
 * replaced, since Windows hands a child the first one it sorts.
 */
export function windowsPowerShell(
  systemRoot: string,
  base: NodeJS.ProcessEnv = process.env,
): {
  readonly file: string
  readonly env: NodeJS.ProcessEnv
} {
  const env = { ...base }
  setEnvironmentVariable(
    env,
    'win32',
    PS_MODULE_PATH,
    windowsPowerShellModulePath(systemRoot, base['ProgramFiles']),
  )
  return { file: path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH), env }
}

function hasExited(root: TreeRoot): boolean {
  return root.exitCode !== null || root.signalCode !== null
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

/** A row of the process table: ids, the creation time as printed and in epoch milliseconds. */
export interface ProcessRow {
  readonly pid: number
  readonly parent: number
  /** FILETIME ticks, exactly as the table printed them. */
  readonly ticks: string
  readonly createdAt: number
  readonly name: string
}

// A FILETIME counts 100 ns ticks from 1601-01-01 UTC: past 2^53, so a BigInt.
const FILETIME_TICKS_PER_MS = 10_000n
const FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000n
// The process table prints creation times to the microsecond; a process
// handle gives them to the tick.
const TICKS_PER_MICROSECOND = 10
const DECIMAL = /^\d+$/

/** The processes whose parent is one of `parents`, one row per line. */
function processTableScript(parents: Iterable<number>): string {
  const filter = Array.from(parents, (id) => `ParentProcessId=${String(id)}`).join(' OR ')
  return `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc(), $_.Name }`
}

/**
 * Kills each process that still is the one the table showed (same id, same
 * creation time, checked in the same run just before), printing the ids it
 * killed; one that has gone, or whose id another process now holds, is left.
 */
function identityKillScript(rows: readonly ProcessRow[]): string {
  const targets = rows.map((row) => `@(${String(row.pid)}, ${row.ticks})`).join(', ')
  return `foreach ($target in @(${targets})) { $process = Get-Process -Id $target[0] -ErrorAction SilentlyContinue; if ($null -ne $process -and [math]::Abs($process.StartTime.ToFileTimeUtc() - $target[1]) -lt ${String(TICKS_PER_MICROSECOND)}) { Stop-Process -InputObject $process -Force; [Console]::Out.WriteLine($target[0]) } }`
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
      ticks,
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
  const run = deps.run ?? runProgram
  const powershell = windowsPowerShell(systemRoot)
  const script = (body: string) =>
    run(powershell.file, [...WINDOWS_POWERSHELL_COMMAND_ARGS, body], powershell.env)
  const ancestors = new Map([[shellPid, diedAt]])
  for (let round = 0; round < ORPHAN_SWEEP_ROUNDS; round += 1) {
    let orphans: readonly ProcessRow[]
    let killed: ReadonlySet<number>
    try {
      orphans = orphansIn(
        parseProcessTable(await script(processTableScript(ancestors.keys()))),
        ancestors,
        startedAt,
      )
      if (orphans.length === 0) {
        return
      }
      const killedIds = await script(identityKillScript(orphans))
      killed = new Set(
        killedIds
          .split(/\r?\n/)
          .filter((line) => DECIMAL.test(line.trim()))
          .map(Number),
      )
    } catch (error: unknown) {
      deps.log(
        `the process table could not be read or acted on after killing ${String(shellPid)} (${String(error)}); a child started during the kill may still run`,
      )
      return
    }
    // Those left had gone, or their ids were taken: no new parent to follow.
    if (killed.size === 0) {
      return
    }
    const now = Date.now()
    for (const orphan of orphans) {
      if (!killed.has(orphan.pid)) {
        continue
      }
      deps.log(
        `${orphan.name} ${String(orphan.pid)} outlived the tree kill of ${String(orphan.parent)}; killed it`,
      )
      ancestors.set(orphan.pid, now)
    }
  }
  deps.log(
    `children of ${String(shellPid)} kept appearing for ${String(ORPHAN_SWEEP_ROUNDS)} rounds after its tree kill`,
  )
}

/** Terminates the command's job: false (logged) when that could not be done. */
async function didTerminateJob(
  job: ShellJob,
  pid: number,
  systemRoot: string,
  deps: ProcessTreeDeps,
): Promise<boolean> {
  const powershell = windowsPowerShell(systemRoot)
  const script = `Add-Type -Path ${powerShellQuoted(job.assemblyPath)}; if ([${SHELL_JOB_TYPE_NAME}]::Terminate(${powerShellQuoted(job.name)}, ${String(KILLED_EXIT_CODE)})) { '${TERMINATED}' } else { '${ABSENT}' }`
  try {
    const output = await (deps.run ?? runProgram)(
      powershell.file,
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
      powershell.env,
    )
    const answer = output.trim()
    if (answer === TERMINATED) {
      return true
    }
    deps.log(`the job of ${String(pid)} was not there (${answer}); ending its tree with taskkill`)
  } catch (error: unknown) {
    deps.log(
      `the job of ${String(pid)} could not be terminated (${String(error)}); ending its tree with taskkill`,
    )
  }
  return false
}

/**
 * Kills `root` and its descendants; resolves once they are gone, as far as
 * can be seen. `startedAt` is when the shell was spawned; `job` the job
 * object it joined, on Windows.
 */
export async function killTree(
  root: TreeRoot,
  deps: ProcessTreeDeps,
  startedAt: number,
  job?: ShellJob,
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
  if (job !== undefined && (await didTerminateJob(job, pid, systemRoot, deps))) {
    if ((await death) !== undefined) {
      return
    }
    deps.log(`${String(pid)} was still running after its job was terminated`)
  }
  try {
    await (deps.run ?? runProgram)(
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
