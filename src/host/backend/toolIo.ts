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
import { type FileHandle, lstat, mkdir, open, rm, stat } from 'node:fs/promises'
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
  ShellTimeLimit,
  ToolIo,
} from '../../core/backends/modelapi/tools'
import { resolveExecutable } from '../../core/executables'
import { isPdf } from '../../core/pdf'
import type { ToolImageIo } from '../../core/toolImages'
import { isSamePath } from '../../core/paths'
import { powerShellQuoted } from '../../core/shellQuote'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  BYTES_PER_MIB,
  MODEL_TEXT,
  MAX_DOCUMENT_BYTES,
  PDF_HEADER_WINDOW_BYTES,
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_FORBIDDEN_ENV_NAMES,
  HOOK_STDIN_MAX_BYTES,
  SEARCH_TIMEOUT_MS,
  SHELL_DRAIN_GRACE_MS,
  SHELL_OUTPUT_MAX_CHARS,
  type TERMINAL_ENV_KEYS,
  TOOL_FILE_MAX_BYTES,
  TOOL_FILE_MAX_MIB,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
} from '../../shared/constants'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically, writeFileIfUnchanged } from '../fsAtomic'
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
  /**
   * The files open in an editor with unsaved changes, by the paths VS
   * Code's documents give (D27).
   */
  readonly unsavedFiles: () => readonly string[]
  /** Runtime workspace identity, sampled at mutation and command boundaries. */
  readonly assertWorkspaceCurrent?: (() => void) | undefined
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
const HOOK_ENV_NAMES = [
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
] as const
const WINDOWS_HOOK_ENV_NAMES = ['COMSPEC', 'PATHEXT', 'SystemRoot', 'WINDIR'] as const

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
    throw new Error(`${absolutePath} ${MODEL_TEXT.fileNotText}`)
  }
  try {
    return STRICT_UTF8.decode(bytes)
  } catch {
    throw new Error(`${absolutePath} ${MODEL_TEXT.fileNotText}`)
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
 * A provider credential's variable: any `*_API_KEY`, and the named ones.
 * Hooks never get one (Muse Code's narrow environment), nor does any process
 * the ACP agent starts but Muse Code's own (runtime/credentialVariables.ts).
 */
export function isCredentialVariable(name: string): boolean {
  const upper = name.toUpperCase()
  return upper.endsWith('_API_KEY') || HOOK_FORBIDDEN_ENV_NAMES.has(upper)
}

export function hookEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  extraNames: readonly string[] = [],
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  const names: readonly string[] =
    platform === 'win32'
      ? [...HOOK_ENV_NAMES, ...WINDOWS_HOOK_ENV_NAMES, ...extraNames]
      : [...HOOK_ENV_NAMES, ...extraNames]
  for (const name of names) {
    if (isCredentialVariable(name)) {
      continue
    }
    const value = environmentValue(env, platform, name)
    if (value === undefined) {
      continue
    }
    const normalizedName = platform === 'win32' ? name.toUpperCase() : name
    if (normalizedName === PATH_VARIABLE) {
      const pathApi = platform === 'win32' ? path.win32 : path.posix
      const delimiter = pathApi.delimiter
      setEnvironmentVariable(
        clean,
        platform,
        name,
        value
          .split(delimiter)
          .filter((entry) => pathApi.isAbsolute(entry))
          .join(delimiter),
      )
    } else if (normalizedName !== 'COMSPEC' || path.win32.isAbsolute(value)) {
      setEnvironmentVariable(clean, platform, name, value)
    }
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

function hookProgramFor(deps: ToolIoDeps, configuredShell: string | undefined): string | undefined {
  if (deps.platform === 'win32') {
    return deps.systemRoot === undefined
      ? resolveExecutable('cmd', {
          platform: deps.platform,
          pathVariable: deps.env()['PATH'],
          fileExists: existsSync,
        })
      : path.win32.join(deps.systemRoot, 'System32', 'cmd.exe')
  }
  return configuredShell !== undefined &&
    path.posix.isAbsolute(configuredShell) &&
    existsSync(configuredShell)
    ? configuredShell
    : resolveExecutable('sh', {
        platform: deps.platform,
        pathVariable: deps.env()['PATH'],
        fileExists: existsSync,
      })
}

async function assertCheckedCanonicalPath(
  absolutePath: string,
  expectedCanonicalPath: string | undefined,
  platform: NodeJS.Platform,
) {
  if (expectedCanonicalPath === undefined) {
    return
  }
  const canonical = await canonicalPath(absolutePath)
  if (!isSamePath(canonical, expectedCanonicalPath, platform)) {
    throw new Error(MODEL_TEXT.pathChangedAfterApproval)
  }
}

/** The sampled pathname must still name the opened file, never a swapped junction target. */
async function checkedOpenedFile(
  absolutePath: string,
  file: FileHandle,
  expectedCanonicalPath: string | undefined,
  platform: NodeJS.Platform,
): Promise<{ readonly dev: number; readonly ino: number }> {
  const held = await file.stat()
  // Node exposes inode identity, not a final path by handle. This catches
  // observed swaps; rapid adversarial ABA swaps remain outside the guarantee.
  if (expectedCanonicalPath === undefined) {
    return { dev: held.dev, ino: held.ino }
  }
  for (let sample = 0; sample < 2; sample += 1) {
    await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, platform)
    const current = await stat(absolutePath)
    if (held.dev !== current.dev || held.ino !== current.ino) {
      throw new Error(MODEL_TEXT.pathChangedAfterApproval)
    }
  }
  return { dev: held.dev, ino: held.ino }
}

/** A path's metadata and bytes come from one handle; growth stops after max + 1 bytes. */
async function readBoundedFile(
  absolutePath: string,
  maxBytes: number,
  expectedCanonicalPath?: string,
  platform?: NodeJS.Platform,
  pdfMaxBytes?: number,
): Promise<
  | { readonly ok: true; readonly bytes: Buffer; readonly isPdf: boolean }
  | { readonly ok: false; readonly size: number; readonly isPdf: boolean }
> {
  const file = await open(absolutePath, 'r')
  try {
    if (expectedCanonicalPath !== undefined && platform !== undefined) {
      await checkedOpenedFile(absolutePath, file, expectedCanonicalPath, platform)
    }
    // An explicit position leaves this handle's sequential read at byte zero.
    const header = pdfMaxBytes === undefined ? undefined : Buffer.alloc(PDF_HEADER_WINDOW_BYTES)
    const headerRead =
      header === undefined ? undefined : await file.read(header, 0, header.length, 0)
    const isPdfFile =
      header !== undefined &&
      headerRead !== undefined &&
      isPdf(header.subarray(0, headerRead.bytesRead))
    const limit = isPdfFile ? (pdfMaxBytes ?? maxBytes) : maxBytes
    const { size } = await file.stat()
    if (size > limit) {
      return { ok: false, size, isPdf: isPdfFile }
    }
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const length = Math.min(BOUNDED_FILE_READ_CHUNK_BYTES, limit + 1 - total)
      const chunk = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(chunk, 0, length, null)
      if (bytesRead === 0) {
        return { ok: true, bytes: Buffer.concat(chunks, total), isPdf: isPdfFile }
      }
      total += bytesRead
      if (total > limit) {
        return { ok: false, size: total, isPdf: isPdfFile }
      }
      chunks.push(chunk.subarray(0, bytesRead))
    }
  } finally {
    await file.close()
  }
}

/**
 * Picker bytes use the same single-handle cap as tool reads, on the extension
 * host. A PDF may be as large as `pdfMaxBytes` (a document attachment's
 * limit unless the caller holds every file to `maxBytes`, M79).
 */
export async function readPickedFile(
  absolutePath: string,
  maxBytes: number,
  expectedCanonicalPath?: string,
  pdfMaxBytes: number = MAX_DOCUMENT_BYTES,
): Promise<{ readonly bytes: Uint8Array | undefined; readonly isPdf: boolean }> {
  try {
    const read = await readBoundedFile(
      absolutePath,
      maxBytes,
      expectedCanonicalPath,
      process.platform,
      pdfMaxBytes,
    )
    return { bytes: read.ok ? read.bytes : undefined, isPdf: read.isPdf }
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return { bytes: undefined, isPdf: false }
    }
    throw error
  }
}

/** The VS Code tool-row preview uses the same checked read as Model API tools. */
export function toolImagePreviewIo(
  toolIo: Pick<ToolIo, 'readBytes'>,
  fileSize: ToolImageIo['fileSize'],
): ToolImageIo {
  return {
    realPath: canonicalPath,
    fileSize,
    readBytes: (fsPath, maxBytes, expectedCanonicalPath) =>
      toolIo.readBytes(fsPath, maxBytes, expectedCanonicalPath),
  }
}

export function createToolIo(deps: ToolIoDeps): ToolIo {
  const interpreter = shellInterpreter(deps.platform, deps.systemRoot, deps.env(), existsSync)
  const hasUnsavedChanges = (absolutePath: string) =>
    deps.unsavedFiles().some((open) => isSamePath(open, absolutePath, deps.platform))
  const configuredHookShell = deps.env()['SHELL']
  const hookProgram = hookProgramFor(deps, configuredHookShell)
  return {
    async readFile(absolutePath, expectedCanonicalPath) {
      let bytes: Uint8Array
      try {
        // Refused before it is loaded (M39), including growth after metadata.
        const read = await readBoundedFile(
          absolutePath,
          TOOL_FILE_MAX_BYTES,
          expectedCanonicalPath,
          deps.platform,
        )
        if (!read.ok) {
          const mib = (read.size / BYTES_PER_MIB).toFixed(1)
          throw new Error(
            `${MODEL_TEXT.toolFileTooLarge} ${String(TOOL_FILE_MAX_MIB)} MiB, and this one is ${mib} MiB: ${MODEL_TEXT.toolFileTooLargeHint}`,
          )
        }
        bytes = read.bytes
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
      return decodeText(bytes, absolutePath)
    },
    async readBytes(absolutePath, maxBytes, expectedCanonicalPath) {
      try {
        const read = await readBoundedFile(
          absolutePath,
          maxBytes,
          expectedCanonicalPath,
          deps.platform,
        )
        if (!read.ok) {
          throw new Error(
            `${path.basename(absolutePath)} is ${String(read.size)} bytes, over the ${String(maxBytes)} allowed`,
          )
        }
        return read.bytes
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
    },
    async writeFile(absolutePath, content, expectedCanonicalPath) {
      // A new file's folders are created (PLAN.md D26: `write_file` into a
      // missing folder failed); the caller confined the whole path first.
      // The write is atomic (D27): an interrupted one leaves the old file.
      await writeFileAtomically(absolutePath, content, {
        sleep: pause,
        ...(deps.assertWorkspaceCurrent !== undefined && {
          assertCanWrite: deps.assertWorkspaceCurrent,
        }),
        ...(expectedCanonicalPath !== undefined && { expectedCanonicalPath }),
        platform: deps.platform,
      })
    },
    async writeFileIfUnchanged(absolutePath, expectedFingerprint, content, options) {
      return await writeFileIfUnchanged(absolutePath, expectedFingerprint, content, {
        sleep: pause,
        ...(deps.assertWorkspaceCurrent !== undefined && {
          assertCanWrite: deps.assertWorkspaceCurrent,
        }),
        expectedCanonicalPath: options.expectedCanonicalPath,
        platform: deps.platform,
        isReplaceable: () => options.unsavedAt.every((path) => !hasUnsavedChanges(path)),
      })
    },
    async pathExists(absolutePath) {
      try {
        await lstat(absolutePath)
        return true
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return false
        }
        throw error
      }
    },
    async reserveFile(absolutePath, expectedCanonicalPath) {
      await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
      deps.assertWorkspaceCurrent?.()
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
      // `wx`: created here or refused, never an existing file replaced (M34).
      deps.assertWorkspaceCurrent?.()
      const handle = await open(absolutePath, 'wx')
      let identity: { readonly dev: number; readonly ino: number }
      try {
        identity = await handle.stat()
      } catch (error: unknown) {
        await handle.close()
        throw error
      }
      let isClosed = false
      const close = async () => {
        if (isClosed) {
          return
        }
        await handle.close()
        isClosed = true
      }
      const release = async () => {
        await close()
        await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
        const current = await stat(absolutePath)
        if (current.dev !== identity.dev || current.ino !== identity.ino) {
          throw new Error(MODEL_TEXT.pathChangedAfterApproval)
        }
        await rm(absolutePath, { force: true })
      }
      try {
        await checkedOpenedFile(absolutePath, handle, expectedCanonicalPath, deps.platform)
      } catch (error: unknown) {
        try {
          await release()
        } catch {
          // Do not delete an outside file if the path changed after open.
        }
        throw error
      }
      return {
        fill: async (bytes) => {
          try {
            await checkedOpenedFile(absolutePath, handle, expectedCanonicalPath, deps.platform)
            deps.assertWorkspaceCurrent?.()
            await handle.writeFile(bytes)
            await close()
          } catch (error: unknown) {
            // A write that failed (a full disk) leaves no half file behind.
            try {
              await release()
            } catch {
              // The write's own failure is the one reported.
            }
            throw error
          }
        },
        release,
      }
    },
    hasUnsavedChanges,
    unsavedFiles: deps.unsavedFiles,
    listFiles: deps.listFiles,
    searchFiles: (job) => searchOnWorker(deps.searchWorkerPath, job, SEARCH_TIMEOUT_MS),
    realPath: canonicalPath,
    async runShell(command, cwd, timeoutMs, signal, limit) {
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
      deps.assertWorkspaceCurrent?.()
      return await runCommand({
        file: interpreter,
        args: shellArguments(deps.platform, command, job),
        cwd,
        env: shellEnvironment(deps.env(), deps.platform, deps.systemRoot),
        timeoutMs,
        signal,
        limit,
        tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
        job,
      })
    },
    async runHook(command, payload, cwd, timeoutMs, signal, extraEnvNames) {
      // dispatchHooks enforces this too. Keep the adapter bounded when it is
      // called directly, before any hook subprocess starts.
      if (Buffer.byteLength(payload) > HOOK_STDIN_MAX_BYTES) {
        throw new RangeError('Hook stdin exceeds the input cap')
      }
      const file = deps.platform === 'win32' ? interpreter : hookProgram
      if (hookProgram === undefined || file === undefined) {
        return {
          stdout: '',
          stderr: 'Hook shell is unavailable',
          exitCode: null,
          isTimedOut: false,
          isCancelled: false,
        }
      }
      const assembly = deps.platform === 'win32' ? await deps.shellJobAssembly?.() : undefined
      const job = assembly === undefined ? undefined : newShellJob(assembly)
      // On Windows PowerShell joins the job first, then starts cmd.exe with
      // the configured command. The command itself uses cmd, as Muse Code does.
      const args =
        deps.platform === 'win32'
          ? shellArguments(
              deps.platform,
              `& ${powerShellQuoted(hookProgram)} /D /S /C ${powerShellQuoted(command)}`,
              job,
            )
          : ['-c', command]
      deps.assertWorkspaceCurrent?.()
      return await runCommand({
        file,
        args,
        cwd,
        env: hookEnvironment(deps.env(), deps.platform, extraEnvNames),
        timeoutMs,
        signal,
        tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
        job,
        stdin: payload,
        maxOutputBytes: HOOK_OUTPUT_MAX_BYTES,
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
  /** Lifts the timeout while the command runs (M46: moved to the background). */
  readonly limit?: ShellTimeLimit | undefined
  readonly tree: ProcessTreeDeps
  /** The job object the command joins (Windows, M27). */
  readonly job?: ShellJob | undefined
  /** One JSON payload for a hook process; ordinary shell tools leave stdin closed. */
  readonly stdin?: string | undefined
  /** Per-stream byte ceiling, killing the tree when crossed. */
  readonly maxOutputBytes?: number | undefined
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
      stdio: ['pipe', 'pipe', 'pipe'],
      ...treeSpawnOptions(run.tree.platform),
    })
    const stdout = new BoundedText(SHELL_OUTPUT_MAX_CHARS)
    const stderr = new BoundedText(SHELL_OUTPUT_MAX_CHARS)
    let isTimedOut = false
    let isCancelled = false
    let isOutputTooLarge = false
    let stdoutBytes = 0
    let stderrBytes = 0
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
    run.limit?.bind(() => {
      clearTimeout(timer)
    })
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
        ...(isOutputTooLarge && { isOutputTooLarge }),
      }
      // killTree never rejects: what it cannot do, it logs.
      void (kill ?? Promise.resolve()).then(() => {
        resolve(result)
      })
    }
    run.signal?.addEventListener('abort', onAbort, { once: true })
    // A hook may exit before consuming stdin. EPIPE must not crash the host.
    // Ordinary shell tools get EOF at once, as they did with ignored stdin.
    child.stdin.on('error', () => {
      // An early hook exit can close stdin before this write finishes.
    })
    child.stdin.end(run.stdin)
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (run.maxOutputBytes !== undefined && stdoutBytes > run.maxOutputBytes) {
        isOutputTooLarge = true
        stop()
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (run.maxOutputBytes !== undefined && stderrBytes > run.maxOutputBytes) {
        isOutputTooLarge = true
        stop()
      }
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
