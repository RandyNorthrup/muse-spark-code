// The file system and shell the Model API tool harness runs on (M7): the
// workspace's own files through node:fs, the file listing through the same
// lister the @-mention index uses (so .gitignore applies), and one shell
// command line at a time through PowerShell (Windows) or bash, spawned
// with an argument array (never a shell string, PLAN.md D4) in the
// workspace root, with a timeout and an output cap.

import { spawn } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type {
  SearchJob,
  SearchOutcome,
  ShellResult,
  ToolIo,
} from '../../core/backends/modelapi/tools'
import {
  SEARCH_TIMEOUT_MS,
  SHELL_OUTPUT_MAX_BYTES,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../shared/constants'

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

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ENOENT
}

/** The interpreter and its argument list for one command line. */
export function shellInvocation(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  command: string,
): { readonly file: string; readonly args: readonly string[] } {
  if (platform === 'win32') {
    const file =
      systemRoot === undefined
        ? 'powershell.exe'
        : path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
    return {
      file,
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    }
  }
  return { file: BASH, args: ['-lc', command] }
}

export function createToolIo(deps: ToolIoDeps): ToolIo {
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
    runShell(command, cwd, timeoutMs) {
      const invocation = shellInvocation(deps.platform, deps.systemRoot, command)
      return new Promise<ShellResult>((resolve) => {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is the payload by design: the user approved it on a card, and it runs through the interpreter as an argument array, never a shell string (PLAN.md §8)
        const child = spawn(invocation.file, [...invocation.args], {
          cwd,
          env: deps.env,
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
