// The file system and shell the Model API tool harness runs on (M7): the
// workspace's own files through node:fs, the file listing through the same
// lister the @-mention index uses (so .gitignore applies), and one shell
// command line at a time through PowerShell (Windows) or bash, spawned
// with an argument array (never a shell string, PLAN.md D4) in the
// workspace root, with a timeout and an output cap. The interpreter is found
// by absolute path only and the environment is the one VS Code's own
// terminal would give (D24).

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  environmentValue,
  setEnvironmentVariable,
  windowsPowerShellModulePath,
} from '../../core/backends/musecode/launch'
import type {
  SearchJob,
  SearchOutcome,
  ShellResult,
  ToolIo,
} from '../../core/backends/modelapi/tools'
import { resolveExecutable } from '../../core/executables'
import {
  SEARCH_TIMEOUT_MS,
  SHELL_OUTPUT_MAX_BYTES,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../shared/constants'
import { canonicalPath } from '../canonicalPath'

export interface ToolIoDeps {
  readonly platform: NodeJS.Platform
  readonly listFiles: () => Promise<readonly string[]>
  readonly systemRoot: string | undefined
  readonly env: NodeJS.ProcessEnv
  /** The bundled `searchWorker.js`. */
  readonly searchWorkerPath: string
}

const SEARCH_TIMED_OUT = `search stopped after ${String(SEARCH_TIMEOUT_MS)} ms`

/** Runs the matcher on a worker and terminates it when it overruns the budget. */
export function searchOnWorker(
  workerPath: string,
  job: SearchJob,
  timeoutMs: number,
): Promise<SearchOutcome> {
  return new Promise<SearchOutcome>((resolve) => {
    const worker = new Worker(workerPath, { workerData: job })
    let isSettled = false
    const settle = (outcome: SearchOutcome) => {
      if (isSettled) {
        return
      }
      isSettled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      void worker.terminate()
      settle({ ok: false, reason: SEARCH_TIMED_OUT })
    }, timeoutMs)
    worker.on('message', (outcome: SearchOutcome) => {
      settle(outcome)
      void worker.terminate()
    })
    worker.on('error', (error) => {
      settle({ ok: false, reason: error.message })
    })
    worker.on('exit', (code) => {
      settle({ ok: false, reason: `search worker exited with code ${String(code)}` })
    })
  })
}

const ENOENT = 'ENOENT'
const SIGKILL = 'SIGKILL'
const BASH = 'bash'
const POWERSHELL = 'powershell'
const PATH_VARIABLE = 'PATH'
const PS_MODULE_PATH = 'PSModulePath'
const PROGRAM_FILES = 'ProgramFiles'

// The variables VS Code's terminal strips from the extension host's
// environment before a shell sees it (`sanitizeProcessEnvironment`,
// microsoft/vscode src/vs/base/common/processes.ts): Electron's switches
// (`ELECTRON_RUN_AS_NODE` turns a `code` command into plain Node), the
// window's IPC handles, and the Snap and GDK loader paths.
const HOST_ONLY_VARIABLES: readonly RegExp[] = [
  /^ELECTRON_.+$/,
  /^VSCODE_(?!(?:PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)$).+$/,
  /^SNAP(?:|_.*)$/,
  /^GDK_PIXBUF_.+$/,
]

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ENOENT
}

/** The shell tool's environment: the user's, without the extension host's own plumbing. */
export function shellEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (HOST_ONLY_VARIABLES.every((pattern) => !pattern.test(key))) {
      clean[key] = value
    }
  }
  if (platform === 'win32' && systemRoot !== undefined) {
    setEnvironmentVariable(
      clean,
      platform,
      PS_MODULE_PATH,
      windowsPowerShellModulePath(systemRoot, environmentValue(env, platform, PROGRAM_FILES)),
    )
  }
  return clean
}

/**
 * The interpreter for the shell tool, by absolute path: Windows PowerShell
 * under `%SystemRoot%` (else the first on the absolute PATH), bash from the
 * absolute PATH elsewhere. Undefined when there is none.
 */
export function shellInterpreter(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  env: NodeJS.ProcessEnv,
  isExistingFile: (filePath: string) => boolean,
): string | undefined {
  const probe = {
    platform,
    pathVariable: environmentValue(env, platform, PATH_VARIABLE),
    fileExists: isExistingFile,
  }
  if (platform === 'win32') {
    return systemRoot === undefined
      ? resolveExecutable(POWERSHELL, probe)
      : path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
  }
  return resolveExecutable(BASH, probe)
}

/** The argument list for one command line through the platform's interpreter. */
export function shellArguments(platform: NodeJS.Platform, command: string): readonly string[] {
  return platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['-lc', command]
}

export function createToolIo(deps: ToolIoDeps): ToolIo {
  const env = shellEnvironment(deps.env, deps.platform, deps.systemRoot)
  const interpreter = shellInterpreter(deps.platform, deps.systemRoot, deps.env, existsSync)
  return {
    async readFile(absolutePath) {
      try {
        return await readFile(absolutePath, 'utf8')
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
    },
    async writeFile(absolutePath, content) {
      await writeFile(absolutePath, content, 'utf8')
    },
    listFiles: deps.listFiles,
    async listDirectory(absolutePath) {
      try {
        const entries = await readdir(absolutePath, { withFileTypes: true })
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return []
        }
        throw error
      }
    },
    searchFiles: (job) => searchOnWorker(deps.searchWorkerPath, job, SEARCH_TIMEOUT_MS),
    realPath: canonicalPath,
    runShell(command, cwd, timeoutMs) {
      if (interpreter === undefined) {
        const missing = deps.platform === 'win32' ? 'Windows PowerShell' : BASH
        return Promise.resolve({
          stdout: '',
          stderr: `${missing} was not found on the absolute entries of PATH`,
          exitCode: null,
          isTimedOut: false,
        })
      }
      return new Promise<ShellResult>((resolve) => {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is the payload by design: the user approved it on a card, and it runs through the interpreter as an argument array, never a shell string (PLAN.md §8)
        const child = spawn(interpreter, [...shellArguments(deps.platform, command)], {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        let isTimedOut = false
        let captured = 0
        const capture = (chunk: Buffer, sink: (text: string) => void) => {
          if (captured >= SHELL_OUTPUT_MAX_BYTES) {
            return
          }
          captured += chunk.length
          sink(chunk.toString('utf8'))
        }
        child.stdout.on('data', (chunk: Buffer) => {
          capture(chunk, (text) => {
            stdout += text
          })
        })
        child.stderr.on('data', (chunk: Buffer) => {
          capture(chunk, (text) => {
            stderr += text
          })
        })
        const timer = setTimeout(() => {
          isTimedOut = true
          child.kill(SIGKILL)
        }, timeoutMs)
        child.on('error', (error) => {
          clearTimeout(timer)
          resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: null, isTimedOut })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          resolve({ stdout, stderr, exitCode: code, isTimedOut })
        })
      })
    },
  }
}
