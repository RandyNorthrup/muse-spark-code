// Compile the Windows MCP job launcher once per source version. Each server
// starts this executable directly; its compiler is started directly too.
// M27's shell-job DLL remains separate for shell commands.

import { stat } from 'node:fs/promises'
import path from 'node:path'
import {
  MCP_JOB_SELF_TEST_ARGUMENT,
  MCP_JOB_SELF_TEST_TOKEN,
  SHELL_JOB_FOLDER,
} from '../../shared/constants'
import { runProgram } from '../processTree'
import { compileJob, type JobBuild, jobFileName, nativeJobPath, removeStaleJobs } from './jobBuild'
import type { ShellJobDeps } from './shellJob'
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
  } catch {
    return false
  }
}

const EXECUTABLE: JobBuild = {
  stem: 'MuseSparkMcpJob-',
  extension: '.exe',
  outputType: 'exe',
  references: ['System.Runtime.Serialization.dll', 'System.Xml.dll'],
  label: 'MCP job executable',
  isPresent,
}

/** The executable's file name for this source (the whole C#, the shared half included). */
export function mcpJobExecutableName(csharp: string): string {
  return jobFileName(EXECUTABLE, csharp)
}

async function verify(executable: string, deps: McpJobExecutableDeps): Promise<void> {
  let answer: string
  try {
    answer = await (deps.run ?? runProgram)(executable, [MCP_JOB_SELF_TEST_ARGUMENT], {
      SystemRoot: deps.systemRoot,
    })
  } catch (error: unknown) {
    throw new Error(`the MCP job executable self-test failed (${String(error)})`, { cause: error })
  }
  if (answer.trim() !== MCP_JOB_SELF_TEST_TOKEN) {
    throw new Error(`the MCP job executable self-test answered ${JSON.stringify(answer.trim())}`)
  }
}

/**
 * Undefined means unavailable. The bytes are sealed around the self-test; a
 * changed helper is refused with a typed error, and the next call recompiles.
 */
export function sealedMcpJobExecutable(
  deps: McpJobExecutableDeps,
): () => Promise<SealedMcpJob | undefined> {
  let ready: Promise<SealedMcpJob | undefined> | undefined
  const prepare = async (): Promise<SealedMcpJob | undefined> => {
    try {
      const csharp = await deps.readJobSource('mcpLauncher')
      let executable = path.join(deps.storageDir, SHELL_JOB_FOLDER, mcpJobExecutableName(csharp))
      let didCompile = false
      if (wasHelperChanged(executable) || !(await isPresent(executable))) {
        await compileJob(EXECUTABLE, executable, csharp, deps.systemRoot, deps.run)
        didCompile = true
      }
      executable = await nativeJobPath(executable)
      const check = await sealHelper(executable, () => verify(executable, deps))
      if (didCompile) await removeStaleJobs(EXECUTABLE, executable, deps.log)
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
      deps.log(`Windows MCP job executable is unavailable (${String(error)})`)
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
      deps.log(`Windows MCP job executable changed and is refused (${String(error)})`)
      return
    }
    return helper.path
  }
}
