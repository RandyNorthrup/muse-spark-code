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
// digest) and loaded by each command. Where that is impossible (Constrained
// Language Mode forbids `Add-Type`), the self-test fails, the log says so,
// and commands run as before, their kill falling back to taskkill and the
// orphan sweep (`processTree.ts`).

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  SHELL_JOB_FOLDER,
  SHELL_JOB_NAME_PREFIX,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { powerShellQuoted } from '../../core/shellQuote'
import { type RunProgram, runProgram, type ShellJob, windowsPowerShell } from '../processTree'

// C# 5, which Windows PowerShell 5.1's `Add-Type` compiles. The shell keeps
// its handle for its whole life: a job's name lasts as long as a handle to
// it, and the Stop opens the job by that name.
const SOURCE = `using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ${SHELL_JOB_TYPE_NAME} {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  const uint JOB_OBJECT_TERMINATE = 0x0008;
  static IntPtr held = IntPtr.Zero;

  /** Creates the named job and puts this process in it; its children follow. */
  public static void Join(string name) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
    if (job == IntPtr.Zero) {
      throw new Win32Exception();
    }
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(job);
      throw new Win32Exception(error);
    }
    held = job;
  }

  /** Ends every process in the named job; false when there is no such job. */
  public static bool Terminate(string name, uint exitCode) {
    IntPtr job = OpenJobObjectW(JOB_OBJECT_TERMINATE, false, name);
    if (job == IntPtr.Zero) {
      return false;
    }
    try {
      if (!TerminateJobObject(job, exitCode)) {
        throw new Win32Exception();
      }
      return true;
    } finally {
      CloseHandle(job);
    }
  }
}
`

const ASSEMBLY_STEM = `${SHELL_JOB_TYPE_NAME}-`
const ASSEMBLY_EXTENSION = '.dll'
const SOURCE_EXTENSION = '.cs'
const JOINED = 'joined'
const DIGEST_LENGTH = 16

export interface ShellJobDeps {
  /** The extension's global storage folder. */
  readonly storageDir: string
  readonly systemRoot: string
  readonly log: (message: string) => void
  /** `execFile` for Windows PowerShell; tests stand in the compiler. */
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

/** The assembly's file name for this source. */
export function shellJobAssemblyName(): string {
  const digest = createHash('sha256').update(SOURCE).digest('hex').slice(0, DIGEST_LENGTH)
  return `${ASSEMBLY_STEM}${digest}${ASSEMBLY_EXTENSION}`
}

async function compile(assembly: string, deps: ShellJobDeps, run: RunProgram): Promise<void> {
  const directory = path.dirname(assembly)
  await mkdir(directory, { recursive: true })
  // Unique names, so two windows compiling at once never share a file.
  const stem = path.join(directory, randomUUID())
  const source = `${stem}${SOURCE_EXTENSION}`
  const output = `${stem}${ASSEMBLY_EXTENSION}`
  const powershell = windowsPowerShell(deps.systemRoot)
  try {
    await writeFile(source, SOURCE, 'utf8')
    await run(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `Add-Type -Path ${powerShellQuoted(source)} -OutputAssembly ${powerShellQuoted(output)} -OutputType Library`,
      ],
      powershell.env,
    )
    try {
      await rename(output, assembly)
    } catch (error: unknown) {
      // Another window put the same assembly in place first.
      if (!(await isPresent(assembly))) {
        throw error
      }
    }
  } finally {
    await rm(source, { force: true })
    await rm(output, { force: true })
  }
}

/**
 * Removes the assemblies of earlier sources. One that another window still
 * has loaded cannot go and stays until a later start; that is logged.
 */
async function removeStale(assembly: string, log: (message: string) => void): Promise<void> {
  const directory = path.dirname(assembly)
  const current = path.basename(assembly)
  try {
    const names = await readdir(directory)
    for (const name of names) {
      if (name !== current && name.startsWith(ASSEMBLY_STEM) && name.endsWith(ASSEMBLY_EXTENSION)) {
        await rm(path.join(directory, name), { force: true })
      }
    }
  } catch (error: unknown) {
    log(`an earlier shell job assembly could not be removed yet (${String(error)})`)
  }
}

async function prepare(deps: ShellJobDeps): Promise<string | undefined> {
  const run = deps.run ?? runProgram
  const assembly = path.join(deps.storageDir, SHELL_JOB_FOLDER, shellJobAssemblyName())
  try {
    if (!(await isPresent(assembly))) {
      await compile(assembly, deps, run)
      await removeStale(assembly, deps.log)
    }
    // Joining a job, as a command does, proves the type loads and the
    // system lets a process start a job of its own here.
    const powershell = windowsPowerShell(deps.systemRoot)
    const answer = await run(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `Add-Type -Path ${powerShellQuoted(assembly)}; [${SHELL_JOB_TYPE_NAME}]::Join(${powerShellQuoted(`${SHELL_JOB_NAME_PREFIX}${randomUUID()}`)}); '${JOINED}'`,
      ],
      powershell.env,
    )
    if (answer.trim() !== JOINED) {
      throw new Error(`the self-test answered ${JSON.stringify(answer.trim())}`)
    }
    return assembly
  } catch (error: unknown) {
    deps.log(
      `Windows job objects are unavailable (${String(error)}); a stopped command is ended with taskkill and a sweep for its orphans`,
    )
    return undefined
  }
}

/** The helper's assembly, compiled and tested on first use; undefined where it cannot be. */
export function shellJobAssembly(deps: ShellJobDeps): () => Promise<string | undefined> {
  let ready: Promise<string | undefined> | undefined
  return () => (ready ??= prepare(deps))
}

/** A fresh job for one command. */
export function newShellJob(assemblyPath: string): ShellJob {
  return { name: `${SHELL_JOB_NAME_PREFIX}${randomUUID()}`, assemblyPath }
}

/**
 * The statement a command starts with to join its job. A failure (the
 * assembly gone, a policy) is swallowed: the command runs as it would
 * without one, and its kill finds no job and falls back.
 */
export function joinStatement(job: ShellJob): string {
  return `try { Add-Type -Path ${powerShellQuoted(job.assemblyPath)}; [${SHELL_JOB_TYPE_NAME}]::Join(${powerShellQuoted(job.name)}) } catch { }; `
}
