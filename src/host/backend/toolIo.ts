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
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { Worker } from 'node:worker_threads'
import {
  deleteEnvironmentVariable,
  environmentValue,
  setEnvironmentVariable,
  windowsPowerShellModulePath,
} from '../../core/backends/musecode/launch'
import type {
  SearchHit,
  SearchJob,
  SearchOutcome,
  SearchWorkerMessage,
  ShellResult,
  ToolIo,
} from '../../core/backends/modelapi/tools'
import { resolveExecutable } from '../../core/executables'
import {
  BYTES_PER_MIB,
  SEARCH_TIMEOUT_MS,
  SHELL_DRAIN_GRACE_MS,
  SHELL_OUTPUT_MAX_CHARS,
  type TERMINAL_ENV_KEYS,
  TOOL_FILE_MAX_BYTES,
  TOOL_FILE_MAX_MIB,
  UI_TEXT,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
} from '../../shared/constants'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { killTree, type ProcessTreeDeps, type ShellJob, treeSpawnOptions } from '../processTree'
import { joinStatement, newShellJob } from './shellJob'

export interface ToolIoDeps {
  readonly platform: NodeJS.Platform
  readonly listFiles: () => Promise<readonly string[]>
  readonly systemRoot: string | undefined
  /** The environment for the next command: read per command, so a changed setting applies. */
  readonly env: () => NodeJS.ProcessEnv
  /** The bundled `searchWorker.js`. */
  readonly searchWorkerPath: string
  /** Where a failed tree kill is reported. */
  readonly log: (message: string) => void
  /** Whether an editor holds unsaved changes to the file (VS Code's documents, D27). */
  readonly hasUnsavedChanges: (absolutePath: string) => boolean
  /** Windows: the job helper's assembly, undefined where jobs are unavailable (M27). */
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
}

/**
 * Runs the matcher on a worker and terminates it when it overruns the
 * budget. The worker posts each file's hits as it finds them, so a search
 * that runs out of time returns what it found, marked partial (D27).
 */
export function searchOnWorker(
  workerPath: string,
  job: SearchJob,
  timeoutMs: number,
): Promise<SearchOutcome> {
  return new Promise<SearchOutcome>((resolve) => {
    const worker = new Worker(workerPath, { workerData: job })
    const hits: SearchHit[] = []
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
      settle({ ok: true, hits, isPartial: true })
    }, timeoutMs)
    worker.on('message', (message: SearchWorkerMessage) => {
      if (message.type === 'hits') {
        hits.push(...message.hits)
        return
      }
      settle(message.outcome.ok ? { ok: true, hits } : message.outcome)
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

// PLAN.md D27: a file is text for the tools only when it is valid UTF-8
// without NULs. A UTF-8 BOM is kept (the edit writes it back); a NUL (binary,
// or UTF-16 without a BOM) or invalid UTF-8 (a UTF-16 BOM, Latin-1,
// Shift-JIS…) is refused, since a lossy decode written back corrupts it.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const NUL = 0

export function decodeText(bytes: Uint8Array, absolutePath: string): string {
  if (bytes.includes(NUL)) {
    throw new Error(`${absolutePath} ${UI_TEXT.fileNotText}`)
  }
  try {
    return STRICT_UTF8.decode(bytes)
  } catch {
    throw new Error(`${absolutePath} ${UI_TEXT.fileNotText}`)
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const ENV_REFERENCE = /\$\{env:([^}]+)\}/g
const WORKSPACE_FOLDER_REFERENCE = '${workspaceFolder}'

/** The `terminal.integrated.env.*` key for a platform. */
export function terminalPlatform(
  platform: NodeJS.Platform = process.platform,
): keyof typeof TERMINAL_ENV_KEYS {
  if (platform === 'win32') {
    return 'windows'
  }
  return platform === 'darwin' ? 'osx' : 'linux'
}

/**
 * `base` with the user's `terminal.integrated.env.<platform>` applied as VS
 * Code's terminal applies it (PLAN.md D25; Cline #7793 is the gotcha when a
 * harness does not): a value replaces the variable, `null` removes it, and
 * `${env:NAME}` and `${workspaceFolder}` are substituted.
 */
export function withTerminalOverrides(
  base: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | null>>,
  platform: NodeJS.Platform,
  workspaceRoot: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      deleteEnvironmentVariable(env, platform, name)
      continue
    }
    const resolved = value
      .replaceAll(
        ENV_REFERENCE,
        (_reference, variable: string) => environmentValue(base, platform, variable) ?? '',
      )
      .replaceAll(WORKSPACE_FOLDER_REFERENCE, () => workspaceRoot ?? '')
    setEnvironmentVariable(env, platform, name, resolved)
  }
  return env
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

/**
 * The argument list for one command line through the platform's
 * interpreter. Windows PowerShell 5.1 writes a redirected stdout in the OEM
 * code page, so non-ASCII output arrived garbled; the preamble switches its
 * output (and what it hands native commands) to UTF-8 first (PLAN.md D27).
 */
/** The interpreter's arguments; on Windows the command first joins `job`, when it has one (M27). */
export function shellArguments(
  platform: NodeJS.Platform,
  command: string,
  job?: ShellJob,
): readonly string[] {
  return platform === 'win32'
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `${job === undefined ? '' : joinStatement(job)}${WINDOWS_POWERSHELL_UTF8_PREAMBLE}${command}`,
      ]
    : ['-lc', command]
}

export function createToolIo(deps: ToolIoDeps): ToolIo {
  const interpreter = shellInterpreter(deps.platform, deps.systemRoot, deps.env(), existsSync)
  return {
    async readFile(absolutePath) {
      let bytes: Uint8Array
      try {
        // Refused before it is loaded (M39): the tools hold a file whole.
        const { size } = await stat(absolutePath)
        if (size > TOOL_FILE_MAX_BYTES) {
          const mib = (size / BYTES_PER_MIB).toFixed(1)
          throw new Error(
            `${UI_TEXT.toolFileTooLarge} ${String(TOOL_FILE_MAX_MIB)} MiB, and this one is ${mib} MiB: ${UI_TEXT.toolFileTooLargeHint}`,
          )
        }
        bytes = await readFile(absolutePath)
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
      return decodeText(bytes, absolutePath)
    },
    async writeFile(absolutePath, content) {
      // A new file's folders are created (PLAN.md D26: `write_file` into a
      // missing folder failed); the caller confined the whole path first.
      // The write is atomic (D27): an interrupted one leaves the old file.
      await writeFileAtomically(absolutePath, content, { sleep: pause })
    },
    hasUnsavedChanges: deps.hasUnsavedChanges,
    listFiles: deps.listFiles,
    searchFiles: (job) => searchOnWorker(deps.searchWorkerPath, job, SEARCH_TIMEOUT_MS),
    realPath: canonicalPath,
    async runShell(command, cwd, timeoutMs, signal) {
      if (interpreter === undefined) {
        const missing = deps.platform === 'win32' ? 'Windows PowerShell' : BASH
        return {
          stdout: '',
          stderr: `${missing} was not found on the absolute entries of PATH`,
          exitCode: null,
          isTimedOut: false,
          isCancelled: false,
        }
      }
      const assembly = deps.platform === 'win32' ? await deps.shellJobAssembly?.() : undefined
      const job = assembly === undefined ? undefined : newShellJob(assembly)
      return await runCommand({
        file: interpreter,
        args: shellArguments(deps.platform, command, job),
        cwd,
        env: shellEnvironment(deps.env(), deps.platform, deps.systemRoot),
        timeoutMs,
        signal,
        tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
        job,
      })
    },
  }
}

/**
 * One stream's text within a budget: the head and the tail are kept and the
 * middle dropped with a count, so a flood of output still shows how it
 * ended (the error is usually last).
 */
export class BoundedText {
  private head = ''
  private tail = ''
  private omitted = 0
  private readonly decoder = new StringDecoder('utf8')

  public constructor(private readonly maxChars: number) {}

  private add(text: string): void {
    const half = Math.floor(this.maxChars / 2)
    const room = Math.max(half - this.head.length, 0)
    this.head += text.slice(0, room)
    this.tail += text.slice(room)
    const excess = this.tail.length - half
    if (excess <= 0) {
      return
    }
    this.omitted += excess
    this.tail = this.tail.slice(-half)
  }

  public push(chunk: Buffer): void {
    this.add(this.decoder.write(chunk))
  }

  public text(): string {
    this.add(this.decoder.end())
    return this.omitted === 0
      ? `${this.head}${this.tail}`
      : `${this.head}\n[${String(this.omitted)} characters omitted]\n${this.tail}`
  }
}

export interface CommandRun {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly signal: AbortSignal | undefined
  readonly tree: ProcessTreeDeps
  /** The job object the command joins (Windows, M27). */
  readonly job?: ShellJob | undefined
}

/**
 * Runs one process to its exit (PLAN.md D25). A timeout or an abort kills
 * the whole process tree, and the result waits for that kill to finish
 * (M27); otherwise it is settled on exit plus a short drain of the output,
 * never on the pipes closing, so a background process the command left
 * running cannot hold the tool call open.
 */
export function runCommand(run: CommandRun): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve) => {
    if (run.signal?.aborted === true) {
      resolve({ stdout: '', stderr: '', exitCode: null, isTimedOut: false, isCancelled: true })
      return
    }
    const startedAt = Date.now()
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is the payload by design: the user approved it on a card, and it runs through the interpreter as an argument array, never a shell string (PLAN.md §8)
    const child = spawn(run.file, [...run.args], {
      cwd: run.cwd,
      env: run.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(run.tree.platform),
    })
    const stdout = new BoundedText(SHELL_OUTPUT_MAX_CHARS)
    const stderr = new BoundedText(SHELL_OUTPUT_MAX_CHARS)
    let isTimedOut = false
    let isCancelled = false
    let isSettled = false
    let drain: NodeJS.Timeout | undefined
    let kill: Promise<void> | undefined
    const stop = () => {
      kill ??= killTree(child, run.tree, startedAt, run.job)
    }
    const onAbort = () => {
      isCancelled = true
      stop()
    }
    const timer = setTimeout(() => {
      isTimedOut = true
      stop()
    }, run.timeoutMs)
    const settle = (exitCode: number | null, failure = '') => {
      if (isSettled) {
        return
      }
      isSettled = true
      clearTimeout(timer)
      clearTimeout(drain)
      run.signal?.removeEventListener('abort', onAbort)
      // Our ends of the pipes; whatever still writes to them is not waited for.
      child.stdout.destroy()
      child.stderr.destroy()
      const result = {
        stdout: stdout.text(),
        stderr: `${stderr.text()}${failure}`,
        exitCode,
        isTimedOut,
        isCancelled,
      }
      // killTree never rejects: what it cannot do, it logs.
      void (kill ?? Promise.resolve()).then(() => {
        resolve(result)
      })
    }
    run.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.on('error', (error) => {
      settle(null, error.message)
    })
    child.on('exit', (code) => {
      drain = setTimeout(() => {
        settle(code)
      }, SHELL_DRAIN_GRACE_MS)
    })
    child.on('close', (code) => {
      settle(code)
    })
  })
}
