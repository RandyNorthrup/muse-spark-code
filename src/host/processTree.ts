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

import { parseProcessTable, type ProcessRow } from '../core/resources/trees/processTable'
export { parseProcessTable } from '../core/resources/trees/processTable'

import { execFile } from 'node:child_process'
import { stopResourceTree } from '../core/resources/admission'
import type { ResourceLease } from '../core/resources/launch'
import path from 'node:path'
import {
  setEnvironmentVariable,
  windowsPowerShellModulePath,
} from '../core/backends/musecode/launch'
import { powerShellQuoted } from '../core/shellQuote'
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
  // Nested @() arrays flatten in PowerShell's pipeline, turning a FILETIME
  // into the next PID. Hashtable records keep each identity pair together.
  const targets = rows.map((row) => `@{ Id = ${String(row.pid)}; Ticks = ${row.ticks} }`).join(', ')
  return `foreach ($target in @(${targets})) { $process = Get-Process -Id $target.Id -ErrorAction SilentlyContinue; if ($null -ne $process -and [math]::Abs($process.StartTime.ToFileTimeUtc() - $target.Ticks) -lt ${String(TICKS_PER_MICROSECOND)}) { Stop-Process -InputObject $process -Force; [Console]::Out.WriteLine($target.Id) } }`
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

/**
 * A stdio server may exit before its child does (M50). On POSIX, a child that
 * stayed in the server's process group keeps that group alive after its leader
 * exits; signal it before close resolves. On Windows, the parent is gone, so
 * taskkill has no tree to enumerate; the checked orphan sweep uses its PID and
 * exit time. Neither path contains a child that deliberately detaches itself.
 */
export async function sweepExitedTree(
  pid: number | undefined,
  startedAt: number,
  diedAt: number,
  deps: ProcessTreeDeps,
  resource?: ResourceLease,
): Promise<void> {
  if (resource !== undefined) {
    await stopResourceTree(resource)
    return
  }
  if (pid === undefined) {
    return
  }
  if (deps.platform !== 'win32') {
    try {
      process.kill(-pid, SIGKILL)
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ESRCH'
      ) {
        return
      }
      deps.log(
        `the process group of exited ${String(pid)} could not be signalled: ${String(error)}`,
      )
    }
    return
  }
  if (deps.systemRoot === undefined) {
    deps.log(`the children of exited ${String(pid)} could not be swept: SystemRoot is not set`)
    return
  }
  await sweepOrphans(pid, diedAt, startedAt, deps.systemRoot, deps)
}

/**
 * The statement that loads the job helper's assembly, through .NET rather
 * than `Add-Type`: a cmdlet is found by module auto-loading, which without
 * a module analysis cache analyses every module on the module path before
 * the statement can run (20 s and more on GitHub's Windows runner, M51).
 */
export function loadJobAssembly(assemblyPath: string): string {
  return `[void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(assemblyPath)})`
}

/** Terminates the command's job: false (logged) when that could not be done. */
async function didTerminateJob(
  job: ShellJob,
  pid: number,
  systemRoot: string,
  deps: ProcessTreeDeps,
): Promise<boolean> {
  const powershell = windowsPowerShell(systemRoot)
  const script = `${loadJobAssembly(job.assemblyPath)}; if ([${SHELL_JOB_TYPE_NAME}]::Terminate(${powerShellQuoted(job.name)}, ${String(KILLED_EXIT_CODE)})) { '${TERMINATED}' } else { '${ABSENT}' }`
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
  resource?: ResourceLease,
): Promise<void> {
  if (resource !== undefined) {
    await stopResourceTree(resource)
    return
  }
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
