// Compile the Windows MCP job launcher once per source version. Each server
// starts this executable directly; its compiler is started directly too.
// M27's shell-job DLL remains separate for shell commands.

import path from 'node:path'
import {
  MCP_JOB_SELF_TEST_ARGUMENT,
  MCP_JOB_SELF_TEST_TOKEN,
  SHELL_JOB_FOLDER,
} from '../../shared/constants'
import type { ShellJobDeps } from './shellJob'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { runProgram } from '../processTree'
import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { compileJob, type JobBuild, jobFileName, nativeJobPath, removeStaleJobs } from './jobBuild'
import { describeStoreError, isStoreErrorCode } from './storeErrors'
import { isResourceHelperChanged, sealHelper, wasHelperChanged } from './helperIntegrity'

/** A self-tested helper and its per-use check (SPAWN017C): never run once changed. */
export interface SealedMcpJob {
  readonly path: string
  /** Hashes the helper before each launch; throws ResourceHelperChangedError for changed bytes. */
  readonly verify: () => Promise<void>
}

// The C# is the shipped native/windows/MuseSparkMcpLauncher.cs with the
// shared Win32 half (`jobSource.ts`).

/** Same compile inputs as M27, with an independent source and executable. */
export type McpJobExecutableDeps = ShellJobDeps

async function isPresent(file: string): Promise<boolean> {
  try {
    const fileInfo = await stat(file)
    return fileInfo.isFile()
  } catch (error: unknown) {
    // Anything but a missing file is not this probe's to swallow.
    if (isStoreErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

export const MCP_JOB_BUILD: JobBuild = {
  stem: 'MuseSparkMcpJob-',
  extension: '.exe',
  outputType: 'exe',
  references: ['System.Runtime.Serialization.dll', 'System.Xml.dll'],
  label: 'MCP job executable',
  isPresent,
}

/** The executable's file name for this source (the whole C#, the shared half included). */
export function mcpJobExecutableName(csharp: string): string {
  return jobFileName(MCP_JOB_BUILD, csharp)
}

async function verify(executable: string, deps: McpJobExecutableDeps): Promise<void> {
  let answer: string
  try {
    answer = await (deps.run ?? runProgram)(
      executable,
      [MCP_JOB_SELF_TEST_ARGUMENT],
      // The self-test answers for its own binary: absolute entries only, links followed.
      noWorkspaceChildEnvironment('win32', { SystemRoot: deps.systemRoot }, realpathSync),
    )
  } catch (error: unknown) {
    throw new Error(`the MCP job executable self-test failed (${String(error)})`, { cause: error })
  }
  if (answer.trim() !== MCP_JOB_SELF_TEST_TOKEN) {
    throw new Error(`the MCP job executable self-test answered ${JSON.stringify(answer.trim())}`)
  }
}

/**
Undefined means unavailable. The bytes are sealed around the self-test; a
changed helper is refused with a typed error, and the next call recompiles.
*/
export function sealedMcpJobExecutable(
  deps: McpJobExecutableDeps,
): () => Promise<SealedMcpJob | undefined> {
  let ready: Promise<SealedMcpJob | undefined> | undefined
  const prepare = async (): Promise<SealedMcpJob | undefined> => {
    try {
      const csharp = await deps.readJobSource('mcpLauncher')
      let executable = path.join(deps.storageDir, SHELL_JOB_FOLDER, mcpJobExecutableName(csharp))
      if (wasHelperChanged(executable) || !(await isPresent(executable))) {
        await compileJob(MCP_JOB_BUILD, executable, csharp, deps.systemRoot, deps.run)
      }
      executable = await nativeJobPath(executable)
      const check = await sealHelper(executable, () => verify(executable, deps))
      // Every preparation, not just after a compile: a file freed since the
      // last window retires here, and a held one waits silently for its
      // process's exit instead of warning on every start.
      await removeStaleJobs(MCP_JOB_BUILD, executable, deps.log, () =>
        deps.readJobSource('mcpLauncher'),
      )
      return {
        path: executable,
        verify: async () => {
          try {
            await check()
          } catch (error: unknown) {
            // Re-prepare on the next call; this launch is refused.
            if (isResourceHelperChanged(error)) ready = undefined
            throw error
          }
        },
      }
    } catch (error: unknown) {
      deps.log(`Windows MCP job executable is unavailable (${describeStoreError(error)})`)
      // Fail closed for this binding, as before; only a changed helper is rebuilt.
      if (isResourceHelperChanged(error)) ready = undefined
      return
    }
  }
  return () => (ready ??= prepare())
}

/** Undefined means stdio MCP must fail closed on this Windows machine. */
export function mcpJobExecutable(deps: McpJobExecutableDeps): () => Promise<string | undefined> {
  const sealed = sealedMcpJobExecutable(deps)
  return async () => {
    const helper = await sealed()
    if (helper === undefined) return
    try {
      await helper.verify()
    } catch (error: unknown) {
      deps.log(`Windows MCP job executable changed and is refused (${describeStoreError(error)})`)
      return
    }
    return helper.path
  }
}
