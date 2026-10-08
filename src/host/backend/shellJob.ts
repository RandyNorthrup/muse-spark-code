// The job objects Windows commands run in (PLAN.md D25, M27). A process
// belongs to its creator's job from the moment it exists, so a job holds
// everything a command starts, however it starts it (a launcher that exits
// included), and `TerminateJobObject` ends them all at once: nothing can be
// started between a look at the tree and the kill, which is what `taskkill
// /T` misses. The job has no limits and no kill-on-close, so a command that
// ends normally leaves its background processes running, as on POSIX.
//
// PowerShell reaches the Win32 job calls through a small C# type, compiled
// once per machine into the extension's storage (named by the source's
// digest) by .NET's compiler and loaded by each command. Where that is
// impossible (Constrained Language Mode forbids loading an assembly), the self-test
// fails, the log says so, and commands run as before, their kill falling
// back to taskkill and the orphan sweep (`processTree.ts`).

import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  SHELL_JOB_FOLDER,
  SHELL_JOB_NAME_PREFIX,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { powerShellQuoted } from '../../core/shellQuote'
import {
  loadJobAssembly,
  type RunProgram,
  runProgram,
  type ShellJob,
  windowsPowerShell,
} from '../processTree'
import { compileJob, type JobBuild, jobFileName, nativeJobPath, removeStaleJobs } from './jobBuild'
import type { JobHelper } from './jobSource'
import { isResourcePaused } from '../../core/resources/paused'

// The C# (C# 5, which Windows PowerShell 5.1's `Add-Type` compiles) is the
// shipped native/windows/MuseSparkJob.cs with the shared Win32 half
// (`jobSource.ts`).

const JOINED = 'joined'

export interface ShellJobDeps {
  /** The extension's global storage folder. */
  readonly storageDir: string
  readonly systemRoot: string
  readonly log: (message: string) => void
  /** A helper's whole C# (`jobSource.ts`), read when the helper is first built. */
  readonly readJobSource: (helper: JobHelper) => Promise<string>
  /** `execFile` for the compiler and self-test; tests stand them in. */
  readonly run?: RunProgram
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

const ASSEMBLY: JobBuild = {
  stem: `${SHELL_JOB_TYPE_NAME}-`,
  extension: '.dll',
  outputType: 'library',
  references: [],
  label: 'shell job assembly',
  isPresent,
}

/** The assembly's file name for this source (the whole C#, the shared half included). */
export function shellJobAssemblyName(csharp: string): string {
  return jobFileName(ASSEMBLY, csharp)
}

async function prepare(deps: ShellJobDeps): Promise<string | undefined> {
  const run = deps.run ?? runProgram
  try {
    const csharp = await deps.readJobSource('shellJob')
    let assembly = path.join(deps.storageDir, SHELL_JOB_FOLDER, shellJobAssemblyName(csharp))
    if (!(await isPresent(assembly))) {
      await compileJob(ASSEMBLY, assembly, csharp, deps.systemRoot, deps.run)
      await removeStaleJobs(ASSEMBLY, assembly, deps.log)
    }
    assembly = await nativeJobPath(assembly)
    // Loading the type and joining a job, as a command does, proves both
    // work and the system lets a process start a job of its own here. A
    // failing .NET call ends only its own statement in PowerShell, so the
    // answer is inside `try`: a load or join that fails never says joined.
    const powershell = windowsPowerShell(deps.systemRoot)
    const answer = await run(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `try { ${loadJobAssembly(assembly)}; [${SHELL_JOB_TYPE_NAME}]::Join(${powerShellQuoted(`${SHELL_JOB_NAME_PREFIX}${randomUUID()}`)}); '${JOINED}' } catch { exit 1 }`,
      ],
      powershell.env,
    )
    if (answer.trim() !== JOINED) {
      throw new Error(`the self-test answered ${JSON.stringify(answer.trim())}`)
    }
    return assembly
  } catch (error: unknown) {
    if (isResourcePaused(error)) throw error
    deps.log(
      `Windows job objects are unavailable (${String(error)}); a stopped command is ended with taskkill and a sweep for its orphans`,
    )
    return undefined
  }
}

/** The helper's assembly; a failed preparation can be tried again by the next caller. */
export function shellJobAssembly(deps: ShellJobDeps): () => Promise<string | undefined> {
  let ready: Promise<string | undefined> | undefined
  const attempt = async (): Promise<string | undefined> => {
    // Share an in-flight attempt and keep success, but not a transient
    // failure, whether it resolved empty or threw (a throwing logger, say):
    // A policy pause propagates; only an unavailable helper permits fallback.
    try {
      const assembly = await prepare(deps)
      if (assembly === undefined) {
        ready = undefined
      }
      return assembly
    } catch (error: unknown) {
      ready = undefined
      if (isResourcePaused(error)) throw error
      return undefined
    }
  }
  return () => (ready ??= attempt())
}

/** A fresh job for one command. */
export function newShellJob(assemblyPath: string): ShellJob {
  return { name: `${SHELL_JOB_NAME_PREFIX}${randomUUID()}`, assemblyPath }
}

/**
 * The statement a command starts with to join its job. A failure (the
 * assembly gone, a policy) is swallowed: the command runs as it would
 * without one, and its kill finds no job and falls back.
 *
 * Governed launches stop before running a payload if membership cannot be proved.
 *
 * It names no cmdlet (`loadJobAssembly`): a hook runs in a narrow
 * environment without `PSModuleAnalysisCachePath`, and on GitHub's Windows
 * runner the module analysis an `Add-Type` here set off took 20 s or more
 * and, on a fresh runner, ran past the hook test's 60 s budget before the
 * hook began.
 */
export function joinStatement(job: ShellJob, isGoverned = false): string {
  return `try { ${loadJobAssembly(job.assemblyPath)}; [${SHELL_JOB_TYPE_NAME}]::Join(${powerShellQuoted(job.name)}) } catch {${isGoverned ? ' exit 1' : ''} }; `
}
