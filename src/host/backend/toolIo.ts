import { hardwareStop, type HardwareStop } from '../../core/maker/guard/hardwareCommands'
import type { HardwareContext } from '../../core/maker/guard/httpCommands'
// The file system and shell the Model API tool harness runs on (M7): the
// workspace's own files through node:fs, the file listing through the same
// lister the @-mention index uses (so .gitignore applies), and one shell
// command line at a time through PowerShell (Windows) or bash, spawned
// with an argument array (never a shell string, PLAN.md D4) in the
// workspace root, with a timeout and an output cap. The interpreter is found
// by absolute path only and the environment is the one VS Code's own
// terminal would give, with credential variables fenced (D89.5) and agent
// credential routes fenced (D89).

import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import {
  type FileIdentity,
  handleIdentity,
  lstatIdentity,
  sameFile,
  statIdentity,
} from '../../core/fs/fileIdentity'
import type {
  ReservationStep,
  SearchHit,
  SearchJob,
  SearchOutcome,
  SearchWorkerMessage,
  ShellResult,
  ShellTimeLimit,
  ToolIo,
} from '../../core/backends/modelapi/tools'
import { wireWordForLog } from '../../core/logging'
import { setLongTimeout, startStillWaiting, stillWaitingText } from '../../core/timeouts'
import type { ToolImageIo } from '../../core/toolImages'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  CLI_OUTPUT_MAX_BYTES,
  BYTES_PER_MIB,
  FILE_REFUSAL_MODEL_TEXT,
  HOOK_MAX_RUNNING_COMMANDS,
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  MEDIA_READ_MAX_BYTES,
  MAKER_STOP_DEADLINE_MS,
  UI_TEXT,
  MODEL_TEXT,
  PDF_HEADER_WINDOW_BYTES,
  RUNTIME_MAKER_AGENT_SHELL,
  SEARCH_TIMEOUT_MS,
  SHELL_DRAIN_GRACE_MS,
  SHELL_OUTPUT_MAX_CHARS,
  type TERMINAL_ENV_KEYS,
  TOOL_FILE_MAX_BYTES,
  TOOL_FILE_MAX_MIB,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
} from '../../shared/constants'
import type { VaultExecService } from '../../core/vault/exec/service'
import { type ExecutableScope, type GuardedChildEnv } from '../../core/executables'
import { killTree, type ProcessTreeDeps, type ShellJob, treeSpawnOptions } from '../processTree'
import { NO_WORKSPACE } from '../../core/executables'
import {
  deleteEnvironmentVariable,
  environmentValue,
  isWorkspacePath,
  setEnvironmentVariable,
  shellEnvironment,
  hookEnvironment,
  resolveExecutable,
  noWorkspaceChildEnvironment,
  workspaceChildEnvironment,
} from '../../core/execGuard'
import { fileReadIdentity } from '../../core/fs/fileIdentity'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, type BigIntStats } from 'node:fs'
import { type FileHandle, lstat, mkdir, open, rm } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { Worker } from 'node:worker_threads'
import { contentHash, type ContentSource } from '../../core/schedules/provenance'
import { refusedShellEntry, unstartedShell } from '../../core/shellResult'
import { isPdf } from '../../core/pdf'
import { isSamePath } from '../../core/paths'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { powerShellQuoted } from '../../core/shellQuote'
import { fill, uiLocale } from '../../shared/l10n/text'
import { canonicalPath } from '../canonicalPath'
import {
  foldersMade,
  renameReplacing,
  writeFileAtomically,
  writeFileIfUnchanged,
} from '../fsAtomic'
import { spawnMcpJob } from './mcpJobLaunch'
import { joinStatement, newShellJob } from './shellJob'
import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
import { admitResource, resourceWindowsJob } from '../../core/resources/admission'
import { observeResourceProcess } from '../resources/resourceAdmission'
import { holdResourceJob } from '../resources/resourceJobHolder'
import type { VaultFenceOptions } from '../../core/vault/exec/fence'

/** Short window CLI commands share the shell's admission, native tree and bounded teardown. */
export async function runResourceCommand(
  invocation: { readonly command: string; readonly args: readonly string[] },
  timeoutMs: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  assertCanRun?: () => void,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let resource: ResourceLease | undefined
  let nativeJob: Awaited<ReturnType<typeof resourceWindowsJob>>
  const childEnv = env ?? process.env
  const systemRoot = environmentValue(childEnv, process.platform, 'SystemRoot')
  try {
    resource = await admitResource('other', signal, 'foreground')
    nativeJob =
      resource !== undefined && process.platform === 'win32'
        ? await resourceWindowsJob()
        : undefined
    assertCanRun?.()
  } catch (error: unknown) {
    resource?.complete(true)
    return {
      exitCode: -1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
  // Short-window CLI commands run with the guarded child PATH for their
  // working directory (the caller's workspace root, or this process's), so
  // a planted helper there never runs by bare name.
  const childWorkspaceRoot = cwd ?? process.cwd()
  const result = await runCommand({
    file: invocation.command,
    args: invocation.args,
    cwd: childWorkspaceRoot,
    env: workspaceChildEnvironment(process.platform, childEnv, {
      workspaceRoot: childWorkspaceRoot,
      realpath: realpathSync,
    }),
    timeoutMs,
    signal,
    tree: {
      platform: process.platform,
      systemRoot,
      log: () => {
        /* The caller scrubs and reports the command result. */
      },
    },
    nativeJob,
    resource,
    maxOutputBytes: CLI_OUTPUT_MAX_BYTES,
    maxOutputChars: CLI_OUTPUT_MAX_BYTES,
  })
  return {
    exitCode:
      result.isTimedOut || result.isCancelled || result.isOutputTooLarge === true
        ? -1
        : (result.exitCode ?? -1),
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export interface ToolIoDeps {
  readonly hardwareContext?: () => HardwareContext
  /** Lazy, per-session broker route supplied by the registered requester owner. */
  readonly vault?: (() => Promise<VaultExecService>) | undefined
  readonly platform: NodeJS.Platform
  readonly listFiles: (signal?: AbortSignal) => Promise<readonly string[]>
  readonly systemRoot: string | undefined
  /** The environment for the next command: read per command, so a changed setting applies. */
  readonly env: () => NodeJS.ProcessEnv
  /** D89.5: names only; honored solely for an explicitly interactive shell entry. */
  readonly passEnvironmentVariables?: (() => readonly string[]) | undefined
  /** The bundled `searchWorker.js`. */
  readonly searchWorkerPath: string
  /** Where a failed tree kill is reported. */
  readonly log: (message: string) => void
  /**
  The files open in an editor with unsaved changes, by the paths VS
  Code's documents give (D27).
  */
  readonly unsavedFiles: () => readonly string[]
  /**
  The workspace shell commands and hooks run in: interpreter lookups
  never resolve a file inside it, and child environments carry the
  guarded child PATH for it. Absent falls back to each call's own
  working directory.
  */
  readonly workspaceRoot?: string | undefined
  /** Runtime workspace identity, sampled at mutation and command boundaries. */
  readonly assertWorkspaceCurrent?: (() => void) | undefined
  /** Windows: the job helper's assembly, undefined where jobs are unavailable (M27). */
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  /** Off is allowed only for the interactive main conversation. Runtime workers omit it. */
  readonly agentFence?: (() => boolean) | undefined
  /**
  Running hook commands at once, 0 for all at once as Muse Code does
  (M127): `museSpark.hooksMaxRunningCommands`, read per hook process so
  a changed setting applies. Absent keeps the extension-host fallback cap.
  */
  readonly hookMaxRunningCommands?: (() => number) | undefined
  /** Per-requester facts supplied by the trusted launcher. */
  readonly vaultFence?: (() => VaultFenceOptions) | undefined
}

/**
Runs the matcher on a worker and terminates it when it overruns the
budget. The worker posts each file's hits as it finds them, so a search
that runs out of time returns what it found, marked partial (D27).
*/
export function searchOnWorker(
  workerPath: string,
  job: SearchJob,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  signal?.throwIfAborted()
  return new Promise<SearchOutcome>((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: job, env: withoutCredentials(process.env) })
    const hits: SearchHit[] = []
    let isSettled = false
    const settle = (outcome: SearchOutcome) => {
      if (isSettled) {
        return
      }
      isSettled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      reject(new DOMException(undefined, 'AbortError'))
    }
    const timer = setTimeout(() => {
      void worker.terminate()
      settle({ ok: true, hits, isPartial: true })
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
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
// curl's own --fail exit for an HTTP error; a Stop answered without 2xx reports it too.
const CURL_HTTP_ERROR_EXIT = 22
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
  } catch (error: unknown) {
    // Only malformed UTF-8 fails here; anything else is not this decode's.
    if (error instanceof TypeError) {
      throw new Error(`${absolutePath} ${MODEL_TEXT.fileNotText}`, { cause: error })
    }
    throw error
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
Best-effort release after a failed reservation check: a path that changed
after open must not make cleanup delete an outside file, and a release
failure never hides the check's own.
*/
async function releaseReservation(release: () => Promise<ReservationStep>): Promise<void> {
  try {
    await release()
  } catch {
    // Do not delete an outside file if the path changed after open.
  }
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
`base` with the user's `terminal.integrated.env.<platform>` applied as VS
Code's terminal applies it (PLAN.md D25; Cline #7793 is the gotcha when a
harness does not): a value replaces the variable, `null` removes it, and
`${env:NAME}` and `${workspaceFolder}` are substituted.
*/
export function withTerminalOverrides(
  base: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | null>>,
  platform: NodeJS.Platform,
  workspaceRoot: string | undefined = '',
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
      .replaceAll(WORKSPACE_FOLDER_REFERENCE, () => workspaceRoot)
    setEnvironmentVariable(env, platform, name, resolved)
  }
  return env
}

/**
The interpreter for the shell tool, by absolute path: Windows PowerShell
under `%SystemRoot%` (else the first on the absolute PATH), bash from the
absolute PATH elsewhere. With the workspace, entries inside it are never
probed, so a planted `bash` there never resolves. Undefined when there is
none.
*/
export function shellInterpreter(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  env: NodeJS.ProcessEnv,
  isExistingFile: (filePath: string) => boolean,
  scope: ExecutableScope,
): string | undefined {
  const probe = {
    platform,
    pathVariable: environmentValue(env, platform, PATH_VARIABLE),
    fileExists: isExistingFile,
    scope,
  }
  if (platform === 'win32') {
    return systemRoot === undefined
      ? resolveExecutable(POWERSHELL, probe)
      : path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
  }
  return resolveExecutable(BASH, probe)
}

/**
The argument list for one command line through the platform's
interpreter. Windows PowerShell 5.1 writes a redirected stdout in the OEM
code page, so non-ASCII output arrived garbled; the preamble switches its
output (and what it hands native commands) to UTF-8 first (PLAN.md D27).
*/
/** The interpreter's arguments; on Windows the command first joins `job`, when it has one (M27). */
export function shellArguments(
  platform: NodeJS.Platform,
  command: string,
  job?: ShellJob,
  isGoverned = false,
  isFenced = false,
): readonly string[] {
  if (platform === 'win32')
    // The shared argument list: one way to start Windows PowerShell. The
    // command is inline (`-Command`, no script file), so the process-scope
    // `-ExecutionPolicy Bypass` it carries changes nothing on the machine.
    return [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `${job === undefined ? '' : joinStatement(job, isGoverned)}${WINDOWS_POWERSHELL_UTF8_PREAMBLE}${command}`,
    ]
  return isFenced ? ['--noprofile', '--norc', '-c', command] : ['-lc', command]
}

/**
The interpreter for hooks, by absolute path: an absolute `SHELL` the
person configured, unless it names a file inside the workspace (a
planting there is never the interpreter); otherwise `sh` resolved
outside the workspace. Undefined when there is none.
*/
export function hookProgramFor(
  deps: ToolIoDeps,
  configuredShell: string | undefined,
  scope: ExecutableScope,
): string | undefined {
  if (deps.platform === 'win32') {
    return deps.systemRoot === undefined
      ? resolveExecutable('cmd', {
          platform: deps.platform,
          pathVariable: deps.env()['PATH'],
          fileExists: existsSync,
          scope,
        })
      : path.win32.join(deps.systemRoot, 'System32', 'cmd.exe')
  }
  // An absolute `SHELL` inside the workspace (for example from
  // `terminal.integrated.env.*` with `${workspaceFolder}` expanded) is
  // never the hook interpreter: a planted shell there must not run. It is
  // ignored and `sh` is resolved outside the workspace instead. With the
  // explicit no-workspace scope there is no workspace to be inside.
  const workspace = 'workspaceRoot' in scope ? scope : undefined
  const isShellInWorkspace =
    configuredShell !== undefined &&
    workspace !== undefined &&
    path.posix.isAbsolute(configuredShell) &&
    isWorkspacePath(deps.platform, workspace, configuredShell)
  return !isShellInWorkspace &&
    configuredShell !== undefined &&
    path.posix.isAbsolute(configuredShell) &&
    existsSync(configuredShell)
    ? configuredShell
    : resolveExecutable('sh', {
        platform: deps.platform,
        pathVariable: deps.env()['PATH'],
        fileExists: existsSync,
        scope,
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
    throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
  }
}

/** The sampled pathname must still name the opened file, never a swapped junction target. */
async function checkedOpenedFile(
  absolutePath: string,
  file: FileHandle,
  expectedCanonicalPath: string | undefined,
  platform: NodeJS.Platform,
): Promise<BigIntStats> {
  const held = await handleIdentity(file)
  // Node exposes inode identity, not a final path by handle. This catches
  // observed swaps; rapid adversarial ABA swaps remain outside the guarantee.
  if (expectedCanonicalPath === undefined) {
    return held
  }
  for (let sample = 0; sample < 2; sample += 1) {
    await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, platform)
    const current = await statIdentity(absolutePath)
    if (!sameFile(held, current)) {
      throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
    }
  }
  return held
}

/** A path's metadata and bytes come from one handle; growth stops after max + 1 bytes. */
async function readBoundedFile(
  absolutePath: string,
  maxBytes: number,
  expectedCanonicalPath?: string,
  platform?: NodeJS.Platform,
  pdfMaxBytes?: number,
  signal?: AbortSignal,
): Promise<
  | {
      readonly ok: true
      readonly bytes: Buffer
      readonly isPdf: boolean
      readonly source: Extract<ContentSource, { kind: 'file' }>
    }
  | { readonly ok: false; readonly size: number; readonly isPdf: boolean }
> {
  signal?.throwIfAborted()
  const canonical = expectedCanonicalPath ?? (await canonicalPath(absolutePath))
  const file = await open(absolutePath, 'r')
  try {
    signal?.throwIfAborted()
    if (expectedCanonicalPath !== undefined && platform !== undefined) {
      await checkedOpenedFile(absolutePath, file, expectedCanonicalPath, platform)
      signal?.throwIfAborted()
    }
    // An explicit position leaves this handle's sequential read at byte zero.
    const header = pdfMaxBytes === undefined ? undefined : Buffer.alloc(PDF_HEADER_WINDOW_BYTES)
    const headerRead =
      header === undefined ? undefined : await file.read(header, 0, header.length, 0)
    signal?.throwIfAborted()
    const isPdfFile =
      header !== undefined &&
      headerRead !== undefined &&
      isPdf(header.subarray(0, headerRead.bytesRead))
    const limit = isPdfFile ? (pdfMaxBytes ?? maxBytes) : maxBytes
    const identity = await handleIdentity(file)
    const size = Number(identity.size)
    signal?.throwIfAborted()
    if (size > limit) {
      return { ok: false, size, isPdf: isPdfFile }
    }
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      signal?.throwIfAborted()
      const length = Math.min(BOUNDED_FILE_READ_CHUNK_BYTES, limit + 1 - total)
      const chunk = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(chunk, 0, length, null)
      signal?.throwIfAborted()
      if (bytesRead === 0) {
        const after = await handleIdentity(file)
        if (identity.size !== after.size || identity.mtimeNs !== after.mtimeNs)
          throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
        const bytes = Buffer.concat(chunks, total)
        return {
          ok: true,
          bytes,
          isPdf: isPdfFile,
          source: {
            kind: 'file',
            contentHash: contentHash(bytes),
            file: {
              path: canonical.replaceAll('\\', '/'),
              ...fileReadIdentity(identity),
            },
          },
        }
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
Picker bytes use the same single-handle cap as tool reads, on the extension
host. A PDF may be as large as `pdfMaxBytes` (a document attachment's
limit unless the caller holds every file to `maxBytes`, M79). `bytes` is
undefined for a file over its limit, or one gone since it was picked
(`isMissing`).
*/
export async function readPickedFile(
  absolutePath: string,
  maxBytes: number,
  expectedCanonicalPath?: string,
  // D121: PDFs read whole like anything else — bounded only by the caller's
  // cap (host memory for media), never by a document size of ours.
  pdfMaxBytes: number = MEDIA_READ_MAX_BYTES,
): Promise<{
  readonly bytes: Uint8Array | undefined
  readonly isPdf: boolean
  readonly isMissing: boolean
}> {
  try {
    const read = await readBoundedFile(
      absolutePath,
      maxBytes,
      expectedCanonicalPath,
      process.platform,
      pdfMaxBytes,
    )
    return { bytes: read.ok ? read.bytes : undefined, isPdf: read.isPdf, isMissing: false }
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return { bytes: undefined, isPdf: false, isMissing: true }
    }
    throw error
  }
}

/**
Picked bytes as text. Invalid UTF-8 is refused rather than read as
replacement characters, in the panel's language (the decoder's own message
is English); a byte-order mark is dropped. The refusal carries its cause.
*/
export function decodeTransferBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new Error(UI_TEXT.textFileInvalid, { cause: error })
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

export function createHardwareStopRunner(
  deps: Pick<ToolIoDeps, 'platform' | 'systemRoot' | 'log'>,
): (stop: HardwareStop) => Promise<ShellResult> {
  return (stop) => runHardwareStop(deps, stop)
}

async function runHardwareStop(
  deps: Pick<ToolIoDeps, 'platform' | 'systemRoot' | 'log'>,
  stop: HardwareStop,
): Promise<ShellResult> {
  if (stop.kind === 'serial') {
    // An open or write the device never finishes cannot hold Stop's caller: past
    // the deadline delivery is unconfirmed, and a late handle still writes and closes.
    const delivery = (async () => {
      const port = await open(stop.address, 'w')
      try {
        await port.writeFile(Buffer.from(stop.payload, 'latin1'))
      } finally {
        await port.close()
      }
      return true
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const isDelivered = await Promise.race([
        delivery,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false)
          }, MAKER_STOP_DEADLINE_MS)
        }),
      ])
      if (!isDelivered)
        return {
          stdout: '',
          stderr: 'Stop delivery timed out',
          exitCode: null,
          isTimedOut: true,
          isCancelled: false,
        }
    } finally {
      clearTimeout(timer)
    }
    return { stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
  }
  const file =
    deps.platform === 'win32'
      ? path.win32.join(deps.systemRoot ?? '', 'System32', 'curl.exe')
      : '/usr/bin/curl'
  if (!(deps.platform === 'win32' ? path.win32 : path.posix).isAbsolute(file))
    return unstartedShell('Absolute Stop transport unavailable')
  const nullDevice = deps.platform === 'win32' ? 'NUL' : '/dev/null'
  // A redirect is never followed and exits 0 under --fail, so delivery is
  // confirmed only by the 2xx status --write-out prints; the body is discarded
  // so stdout carries nothing else (D83).
  const result = await runCommand({
    file,
    args: [
      '-q',
      '--config',
      nullDevice,
      '--noproxy',
      '*',
      '--fail',
      '--output',
      nullDevice,
      '--write-out',
      '%{http_code}',
      '-X',
      'POST',
      stop.address,
    ],
    cwd: process.cwd(),
    env: noWorkspaceChildEnvironment(deps.platform, {}, realpathSync),
    timeoutMs: MAKER_STOP_DEADLINE_MS,
    signal: undefined,
    tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
  })
  return result.exitCode === 0 && !/^2\d\d$/.test(result.stdout)
    ? { ...result, exitCode: CURL_HTTP_ERROR_EXIT }
    : result
}

export function createToolIo(deps: ToolIoDeps): ToolIo {
  // Shells and hooks run with the workspace as their working directory, so
  // their interpreters are resolved outside it (resolved through links).
  // With no folder open the explicit no-workspace scope applies: absolute
  // entries only, links followed.
  const lookupWorkspace: ExecutableScope =
    deps.workspaceRoot === undefined
      ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
      : { workspaceRoot: deps.workspaceRoot, realpath: realpathSync }
  const interpreter = shellInterpreter(
    deps.platform,
    deps.systemRoot,
    deps.env(),
    existsSync,
    lookupWorkspace,
  )
  const hasUnsavedChanges = (absolutePath: string) =>
    deps.unsavedFiles().some((open) => isSamePath(open, absolutePath, deps.platform))
  // The byte-range file execution (dist/toolRange.js, D6): the windowed
  // reader and the streaming splice live in their own chunk, loaded on the
  // first range addressed call, so whole-file turns never carry them. Each
  // caller fails its own safe way: a bundle that cannot load refuses the
  // call that needed it with the chunk named, never a silent fallback.
  // Loaded once per ToolIo: a load that failed is not kept, so the next
  // range call tries again.
  let rangeLoad: Promise<Required<Pick<ToolIo, 'readFileRange' | 'spliceFileRange'>>> | undefined
  async function fileRangeIo(): Promise<
    Required<Pick<ToolIo, 'readFileRange' | 'spliceFileRange'>>
  > {
    rangeLoad ??= (async () => {
      const entry = await import('./toolRangeEntry.js')
      return entry.createFileRangeIo({
        uiText: UI_TEXT,
        uiLocale: uiLocale(),
        platform: deps.platform,
        sleep: pause,
        checkOpenedFile: (absolutePath, file, expectedCanonicalPath) =>
          checkedOpenedFile(absolutePath, file, expectedCanonicalPath, deps.platform),
        isMissingFile,
        renameReplacing,
        hasUnsavedChanges,
        assertWorkspaceCurrent: deps.assertWorkspaceCurrent,
      })
    })()
    try {
      return await rangeLoad
    } catch (error) {
      rangeLoad = undefined
      const name = error instanceof Error ? wireWordForLog(error.name) : 'unknown'
      deps.log(`toolRange.js failed (${name})`)
      throw new Error(UI_TEXT.toolRangeUnavailable, { cause: error })
    }
  }
  const configuredHookShell = deps.env()['SHELL']
  const hookProgram = hookProgramFor(deps, configuredHookShell, lookupWorkspace)
  // Each call's child environment is guarded for the workspace it runs in.
  const workspaceFor = (cwd: string): { workspaceRoot: string; realpath: typeof realpathSync } => ({
    workspaceRoot: deps.workspaceRoot ?? cwd,
    realpath: realpathSync,
  })
  const prepareResourceJob = async (
    resource: ResourceLease | undefined,
    job: ShellJob | undefined,
  ) => {
    if (resource !== undefined && job !== undefined && deps.systemRoot !== undefined)
      resource = await holdResourceJob(resource, job, deps.systemRoot)
    try {
      deps.assertWorkspaceCurrent?.()
    } catch (error: unknown) {
      resource?.complete(true)
      throw error
    }
    return resource
  }
  return {
    async readMedia(absolutePath, maxBytes, expectedCanonicalPath, signal, observeSource) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
        throw new RangeError('Invalid media read limit')
      signal?.throwIfAborted()
      const { createMediaInspector } = await import('../../core/media/inspectEntry')
      const media = createMediaInspector(UI_TEXT, uiLocale())
      let file: FileHandle
      try {
        file = await open(absolutePath, 'r')
      } catch (error: unknown) {
        if (isMissingFile(error)) return
        throw error
      }
      try {
        const identity = await checkedOpenedFile(
          absolutePath,
          file,
          expectedCanonicalPath,
          deps.platform,
        )
        const metadata = await file.stat()
        const { size } = metadata
        // An empty file is empty, not over the limit (M105 E2 review).
        if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes)
          throw new Error(UI_TEXT.execFileTooLarge)
        if (size === 0) throw new Error(UI_TEXT.execFileEmpty)
        let isPdfFile = false
        const sniffed = await media.sniffMedia({
          sizeBytes: size,
          read: async (offset, length) => {
            signal?.throwIfAborted()
            const chunk = Buffer.alloc(length)
            const { bytesRead } = await file.read(chunk, 0, length, offset)
            if (offset === 0) isPdfFile = isPdf(chunk.subarray(0, bytesRead))
            return chunk.subarray(0, bytesRead)
          },
        })
        signal?.throwIfAborted()
        if (!sniffed.ok) return { kind: 'other', reason: sniffed.reason, isPdf: isPdfFile }
        const admission = media.checkMediaLimits(sniffed.info, {
          maxUploadBytes: maxBytes,
          acceptedMediaTypes: [sniffed.info.mediaType],
        })
        if (!admission.ok) throw new Error(admission.reason)
        const name = path.basename(absolutePath)
        const changed = () => new Error(fill(UI_TEXT.media.sourceChanged, { name }))
        async function* chunks(handle: FileHandle, active?: AbortSignal) {
          let offset = 0
          for (;;) {
            active?.throwIfAborted()
            const chunk = Buffer.allocUnsafe(
              Math.min(BOUNDED_FILE_READ_CHUNK_BYTES, size + 1 - offset),
            )
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset)
            if (bytesRead === 0) break
            offset += bytesRead
            if (offset > size) throw changed()
            yield chunk.subarray(0, bytesRead)
          }
          if (offset !== size) throw changed()
          const after = await handle.stat()
          if (
            after.size !== size ||
            after.mtimeMs !== metadata.mtimeMs ||
            after.ctimeMs !== metadata.ctimeMs
          )
            throw changed()
          const current = await checkedOpenedFile(
            absolutePath,
            handle,
            expectedCanonicalPath,
            deps.platform,
          )
          if (!sameFile(identity, current)) throw changed()
        }
        const hash = createHash('sha256')
        for await (const chunk of chunks(file, signal)) hash.update(chunk)
        const sha256 = hash.digest('hex')
        observeSource?.({
          kind: 'file',
          contentHash: sha256,
          file: {
            path: expectedCanonicalPath.replaceAll('\\', '/'),
            ...fileReadIdentity(identity),
          },
        })
        return {
          info: sniffed.info,
          sha256,
          source: {
            name,
            mime: sniffed.info.mediaType,
            bytes: size,
            open: async function* (active) {
              active.throwIfAborted()
              const held = await open(absolutePath, 'r')
              try {
                const current = await checkedOpenedFile(
                  absolutePath,
                  held,
                  expectedCanonicalPath,
                  deps.platform,
                )
                if (!sameFile(identity, current)) throw changed()
                const digest = createHash('sha256')
                for await (const chunk of chunks(held, active)) {
                  digest.update(chunk)
                  yield chunk
                }
                if (digest.digest('hex') !== sha256) throw changed()
              } finally {
                await held.close()
              }
            },
          },
        }
      } finally {
        await file.close()
      }
    },
    async readFile(absolutePath, expectedCanonicalPath, signal, observeSource) {
      let bytes: Uint8Array
      try {
        // Refused before it is loaded (M39), including growth after metadata.
        const read = await readBoundedFile(
          absolutePath,
          TOOL_FILE_MAX_BYTES,
          expectedCanonicalPath,
          deps.platform,
          undefined,
          signal,
        )
        if (!read.ok) {
          const mib = (read.size / BYTES_PER_MIB).toFixed(1)
          throw new Error(
            `${MODEL_TEXT.toolFileTooLarge} ${String(TOOL_FILE_MAX_MIB)} MiB, and this one is ${mib} MiB: ${MODEL_TEXT.toolFileTooLargeHint}`,
          )
        }
        observeSource?.(read.source)
        bytes = read.bytes
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
      return decodeText(bytes, absolutePath)
    },
    // The size without the bytes, for range addressing.
    async fileSize(absolutePath, expectedCanonicalPath) {
      let file: FileHandle
      try {
        file = await open(absolutePath, 'r')
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
      try {
        await checkedOpenedFile(absolutePath, file, expectedCanonicalPath, deps.platform)
        const metadata = await file.stat()
        return metadata.size
      } finally {
        await file.close()
      }
    },
    // One byte window of a file of any size, with the file's size, mtime
    // and text shape, so reads and edits reach past the whole-read cap by
    // range. The implementation loads with dist/toolRange.js on the first
    // range addressed call; a bundle that cannot load refuses this call
    // with the chunk named.
    async readFileRange(absolutePath, expectedCanonicalPath, range, signal) {
      const rangeIo = await fileRangeIo()
      return await rangeIo.readFileRange(absolutePath, expectedCanonicalPath, range, signal)
    },
    // Replace bytes `[start, end)` of the file with `replacement`,
    // streaming the rest through a temporary file so a range edit never
    // loads the whole file. The implementation loads with dist/toolRange.js
    // on the first range addressed call; a bundle that cannot load refuses
    // this call with the chunk named.
    async spliceFileRange(
      absolutePath,
      expectedCanonicalPath,
      expected,
      start,
      end,
      replacement,
      options,
      signal,
    ) {
      const rangeIo = await fileRangeIo()
      return await rangeIo.spliceFileRange(
        absolutePath,
        expectedCanonicalPath,
        expected,
        start,
        end,
        replacement,
        options,
        signal,
      )
    },
    async readBytes(absolutePath, maxBytes, expectedCanonicalPath, signal, observeSource) {
      try {
        const read = await readBoundedFile(
          absolutePath,
          maxBytes,
          expectedCanonicalPath,
          deps.platform,
          undefined,
          signal,
        )
        if (!read.ok) {
          throw new Error(
            `${path.basename(absolutePath)} is ${String(read.size)} bytes, over the ${String(maxBytes)} allowed`,
          )
        }
        observeSource?.(read.source)
        return read.bytes
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return
        }
        throw error
      }
    },
    async writeFile(absolutePath, content, expectedCanonicalPath, assertCanWrite) {
      // A new file's folders are created (PLAN.md D26: `write_file` into a
      // missing folder failed); the caller confined the whole path first.
      // The write is atomic (D27): an interrupted one leaves the old file.
      await writeFileAtomically(absolutePath, content, {
        sleep: pause,
        assertCanWrite: () => {
          deps.assertWorkspaceCurrent?.()
          assertCanWrite?.()
        },
        ...(expectedCanonicalPath !== undefined && { expectedCanonicalPath }),
        platform: deps.platform,
      })
    },
    async writeFileIfUnchanged(absolutePath, expectedFingerprint, content, options) {
      return await writeFileIfUnchanged(absolutePath, expectedFingerprint, content, {
        sleep: pause,
        assertCanWrite: () => {
          deps.assertWorkspaceCurrent?.()
          options.assertCanWrite?.()
        },
        expectedCanonicalPath: options.expectedCanonicalPath,
        platform: deps.platform,
        isReplaceable: () => options.unsavedAt.every((path) => !hasUnsavedChanges(path)),
        ...(options.staged !== undefined && { staged: options.staged }),
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
    async reserveFile(absolutePath, expectedCanonicalPath, beforeCreate) {
      await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
      deps.assertWorkspaceCurrent?.()
      const directory = path.dirname(absolutePath)
      const createdFolders = foldersMade(directory, await mkdir(directory, { recursive: true }))
      await beforeCreate?.(createdFolders)
      await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
      // `wx`: created here or refused, never an existing file replaced (M34).
      deps.assertWorkspaceCurrent?.()
      const handle = await open(absolutePath, 'wx')
      let identity: FileIdentity
      try {
        identity = await handleIdentity(handle)
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
      // The path still names the file reserved, with no link on the way, and
      // it is still empty: only then is it ours to fill or remove (M86). Bytes
      // the user wrote into it meanwhile are theirs and stay.
      const isReserved = async (): Promise<boolean> => {
        await assertCheckedCanonicalPath(absolutePath, expectedCanonicalPath, deps.platform)
        let current: BigIntStats
        try {
          current = await lstatIdentity(absolutePath)
        } catch (error: unknown) {
          if (isMissingFile(error)) {
            return false
          }
          throw error
        }
        return current.isFile() && sameFile(current, identity) && Number(current.size) === 0
      }
      const release = async (): Promise<ReservationStep> => {
        await close()
        if (!(await isReserved())) {
          return 'changed'
        }
        await rm(absolutePath, { force: true })
        return 'done'
      }
      try {
        await checkedOpenedFile(absolutePath, handle, expectedCanonicalPath, deps.platform)
      } catch (error: unknown) {
        await releaseReservation(release)
        throw error
      }
      return {
        fill: async (bytes) => {
          try {
            await checkedOpenedFile(absolutePath, handle, expectedCanonicalPath, deps.platform)
            // Immediately before writing: the held file is still empty and the
            // path still names it. A failure part way is left as it is, never
            // cleaned up blindly: a release removes the file only while empty.
            const held = await handleIdentity(handle)
            if (Number(held.size) > 0 || !(await isReserved())) {
              return 'changed'
            }
            deps.assertWorkspaceCurrent?.()
            await handle.writeFile(bytes)
            return 'done'
          } finally {
            // The caller can stop after a failed fill; it must not own a leaked descriptor.
            await close()
          }
        },
        release,
      }
    },
    hasUnsavedChanges,
    unsavedFiles: deps.unsavedFiles,
    async listFiles(signal) {
      signal?.throwIfAborted()
      const files = await deps.listFiles(signal)
      signal?.throwIfAborted()
      return files
    },
    searchFiles: (job, signal) =>
      searchOnWorker(deps.searchWorkerPath, job, SEARCH_TIMEOUT_MS, signal),
    realPath: canonicalPath,
    runHardwareStop: createHardwareStopRunner(deps),
    async runShell(
      command,
      cwd,
      timeoutMs,
      signal,
      limit,
      assertCanRun,
      isInteractive = false,
      resourceKind = 'toolShell',
    ) {
      if (command.includes('secret://')) return unstartedShell(UI_TEXT.vault.noAccess)
      const context = deps.hardwareContext?.()
      if (context?.isHardwareWorkspace === true) {
        const stop = hardwareStop(
          command,
          deps.platform === 'win32' ? 'powershell' : 'bash',
          context,
        )
        if (stop !== undefined) return await runHardwareStop(deps, stop)
      }
      if (interpreter === undefined) {
        const missing = deps.platform === 'win32' ? 'Windows PowerShell' : BASH
        return unstartedShell(`${missing} was not found on the absolute entries of PATH`)
      }
      let resource: ResourceLease | undefined
      let assembly: string | undefined
      try {
        assembly = deps.platform === 'win32' ? await deps.shellJobAssembly?.() : undefined
        resource = await admitResource(resourceKind, signal)
        deps.assertWorkspaceCurrent?.()
      } catch (error: unknown) {
        resource?.complete(true)
        throw error
      }
      const job = assembly === undefined ? undefined : newShellJob(assembly)
      resource = await prepareResourceJob(resource, job)
      const refusal = entryRefusal(assertCanRun)
      if (refusal !== undefined) {
        resource?.complete(true)
        // No workspace process has started; retain the owner's no-entry refusal.
        return refusedShellEntry()
      }
      const isFenced = !isInteractive || (deps.agentFence?.() ?? true)
      return await runCommand({
        file: interpreter,
        args: shellArguments(deps.platform, command, job, resource !== undefined, isFenced),
        cwd,
        env: shellEnvironment(
          isInteractive ? deps.env() : { ...deps.env(), [RUNTIME_MAKER_AGENT_SHELL]: '1' },
          deps.platform,
          deps.systemRoot,
          isInteractive ? (deps.passEnvironmentVariables?.() ?? []) : [],
          isFenced,
          deps.vaultFence?.(),
          workspaceFor(cwd),
        ),
        timeoutMs,
        signal,
        limit,
        tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
        job,
        resource,
        assertCanStart: assertCanRun,
      })
    },
    ...(deps.vault && {
      runVaultShell: async (command, cwd, timeoutMs, secrets, signal, limit, assertCanRun) => {
        if (interpreter === undefined || command.includes('secret://'))
          return unstartedShell(UI_TEXT.vault.noAccess)
        if (deps.platform === 'win32' && secrets.sudo)
          return unstartedShell(UI_TEXT.vault.windowsElevation)
        const vault = await deps.vault?.()
        if (!vault) return unstartedShell(UI_TEXT.vault.brokerBlocked)
        // M107: the feeder owns and ends its own contained tree; the run still
        // holds a governed admission until it has returned.
        const resource = await admitResource('toolShell', signal)
        try {
          return await vault.run(
            {
              command: {
                executable: interpreter,
                argv: [...shellArguments(deps.platform, command, undefined, false, true)],
                cwd,
              },
              secrets,
            },
            signal ?? new AbortController().signal,
            () => {
              deps.assertWorkspaceCurrent?.()
              assertCanRun?.()
            },
            { timeoutMs, limit },
          )
        } catch (error: unknown) {
          resource?.failed?.()
          throw error
        } finally {
          resource?.complete(true)
        }
      },
    }),
    async runHook(
      command,
      payload,
      cwd,
      timeoutMs,
      signal,
      extraEnvNames,
      assertCanStart?: () => void,
    ) {
      // dispatchHooks enforces this too. Keep the adapter bounded when it is
      // called directly, before any hook subprocess starts.
      if (Buffer.byteLength(payload) > HOOK_STDIN_MAX_BYTES) {
        throw new RangeError('Hook stdin exceeds the input cap')
      }
      const file = deps.platform === 'win32' ? interpreter : hookProgram
      if (hookProgram === undefined || file === undefined) {
        return unstartedShell('Hook shell is unavailable')
      }
      const assembly = deps.platform === 'win32' ? await deps.shellJobAssembly?.() : undefined
      const job = assembly === undefined ? undefined : newShellJob(assembly)
      let resource = await admitResource('hook', signal)
      // On Windows PowerShell joins the job first, then starts cmd.exe with
      // the configured command. The command itself uses cmd, as Muse Code does.
      const args =
        deps.platform === 'win32'
          ? shellArguments(
              deps.platform,
              `& ${powerShellQuoted(hookProgram)} /D /S /C ${powerShellQuoted(command)}`,
              job,
              resource !== undefined,
            )
          : ['-c', command]
      resource = await prepareResourceJob(resource, job)
      // Lane K: the hook-process start shared by every session and the
      // lazy window/Tab bundles, held in the lazily loaded hook runtime so
      // the hook implementation stays out of activation (NOLIMITS4 C8: no
      // host-wide count gates it).
      let release: () => void
      try {
        const runtime = await import('../../core/backends/modelapi/hookRuntimeEntry.js')
        release = await runtime.acquireHookProcessSlot(
          signal,
          deps.hookMaxRunningCommands?.() ?? HOOK_MAX_RUNNING_COMMANDS,
        )
      } catch (error: unknown) {
        // No process started: a load failure or a cancelled slot wait gives
        // the admitted lease back, as runCommand does on every exit (RVM94KR 4).
        resource?.complete(true)
        throw error
      }
      try {
        return await runCommand({
          file,
          args,
          cwd,
          env: hookEnvironment(deps.env(), deps.platform, extraEnvNames, workspaceFor(cwd)),
          timeoutMs,
          signal,
          tree: { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
          job,
          resource,
          stdin: payload,
          maxOutputBytes: HOOK_OUTPUT_MAX_BYTES,
          assertCanStart,
        })
      } finally {
        release()
      }
    },
    async runHookHttp(url, payload, signal) {
      // dispatchHooks and hookHandlers enforce this too. Keep the adapter
      // bounded when it is called directly, before any request goes out.
      if (Buffer.byteLength(payload) > HOOK_STDIN_MAX_BYTES) {
        throw new RangeError('Hook http payload exceeds the input cap')
      }
      const hooks = await import('../web/webFetchEntry.js')
      return await hooks.postHookPayload(url, payload, signal)
    },
  }
}

/**
One stream's text within a budget: the head and the tail are kept and the
middle dropped with a count, so a flood of output still shows how it
ended (the error is usually last).
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
  readonly nativeJob?: Awaited<ReturnType<typeof resourceWindowsJob>>
  readonly maxOutputChars?: number | undefined
  readonly resource?: ResourceLease | undefined
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  /**
  The child's whole environment: the guarded shell/hook environment for
  `cwd`, so a raw environment does not type-check here.
  */
  readonly env: GuardedChildEnv
  /**
  The caller's own deadline, or undefined: then the process runs until it
  exits or the signal aborts, saying so out loud on the log while it runs
  (owner 2026-10-16: no arbitrary limits, no silent hangs).
  */
  readonly timeoutMs: number | undefined
  readonly signal: AbortSignal | undefined
  /** Lifts the timeout while the command runs (M46: moved to the background). */
  readonly limit?: ShellTimeLimit | undefined
  readonly tree: ProcessTreeDeps
  /** The job object the command joins (Windows, M27). */
  readonly job?: ShellJob | undefined
  /** One JSON payload for a hook process; ordinary shell tools leave stdin closed. */
  readonly stdin?: string | Uint8Array | undefined
  /** Feeder streams are scrubbed before any text is accumulated. */
  readonly onStdout?: (bytes: Buffer) => void
  readonly onStderr?: (bytes: Buffer) => void
  /** A feeder ends residual descendants before it releases its credential leases. */
  readonly killOnExit?: boolean
  /** Feeder containment owns descendants even after their leader exits. */
  readonly terminateTree?: (child: ChildProcess) => Promise<void>
  /** The outer feeder launcher owns the command timer; cleanup still has a hard clock. */
  readonly hasExternalTimeout?: boolean
  /** Per-stream byte ceiling, killing the tree when crossed. */
  readonly maxOutputBytes?: number | undefined
  /** Last synchronous fence, after args/env preparation and immediately before native spawn. */
  readonly assertCanStart?: (() => void) | undefined
}

/** The spawned process, or the Error spawn threw before any process existed. */
function startProcess(run: CommandRun) {
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is the payload by design: the user approved it on a card, and it runs through the interpreter as an argument array, never a shell string (PLAN.md §8)
    const child =
      run.nativeJob === undefined
        ? spawnGuarded(run.file, [...run.args], {
            cwd: run.cwd,
            env: resourceEnvironment(run.env, run.resource),
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            ...treeSpawnOptions(run.tree.platform),
          })
        : spawnMcpJob({
            executablePath: run.nativeJob.executablePath,
            resourceAssembly: run.nativeJob.assemblyPath,
            file: run.file,
            args: run.args,
            cwd: run.cwd,
            env: resourceEnvironment(run.env, run.resource),
            isVerbatim: false,
            resource: run.resource,
            log: run.tree.log,
          })
    if (run.nativeJob === undefined) observeResourceProcess(run.resource, child, run.job)
    return child
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error), { cause: error })
  }
}

/**
The owner's final admission, captured as data: a throw is the documented
no-entry refusal, so the caller settles with `refusedShellEntry` and starts
nothing instead of treating a refusal as a process failure.
*/
function entryRefusal(assert: (() => void) | undefined): { readonly cause: unknown } | undefined {
  try {
    assert?.()
    return undefined
  } catch (error: unknown) {
    return { cause: error }
  }
}

/**
Runs one process to its exit (PLAN.md D25). A named timeout or an abort
kills the whole process tree, and the result waits for that kill to
finish (M27); otherwise it is settled on exit plus a short drain of the
output, never on the pipes closing, so a background process the command
left running cannot hold the tool call open. A run with no timeout of its
own has none: it runs until it exits or is stopped, saying so out loud.
*/
export function runCommand(run: CommandRun): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve) => {
    if (run.signal?.aborted === true) {
      run.resource?.complete(true)
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        isTimedOut: false,
        isCancelled: true,
        isWorkspaceShutdownProven: true,
      })
      return
    }
    const startedAt = Date.now()
    const refusal = entryRefusal(run.assertCanStart)
    if (refusal !== undefined) {
      resolve(refusedShellEntry())
      return
    }
    const child = startProcess(run)
    if (child instanceof Error) {
      run.resource?.complete(true)
      // spawn itself threw (a command line past the operating system's limit,
      // a NUL in the command): no process was ever created, which is the one
      // local fact that proves none exists to outlive the result.
      resolve(unstartedShell(child.message))
      return
    }
    const stdout = new BoundedText(run.maxOutputChars ?? SHELL_OUTPUT_MAX_CHARS)
    const stderr = new BoundedText(run.maxOutputChars ?? SHELL_OUTPUT_MAX_CHARS)
    let isTimedOut = false
    let isCancelled = false
    let isOutputTooLarge = false
    let stdoutBytes = 0
    let stderrBytes = 0
    let isSettled = false
    let drain: NodeJS.Timeout | undefined
    let kill: Promise<void> | undefined
    let hasTerminationFailed = false
    const stop = () => {
      kill ??= (async () => {
        try {
          if (run.terminateTree) await run.terminateTree(child)
          else await killTree(child, run.tree, startedAt, run.job, run.resource, run.signal)
        } catch (error: unknown) {
          // A feeder's failed containment returns no output (M109); a refused
          // registered stop settles as a failure (M107).
          if (run.terminateTree) hasTerminationFailed = true
          else settle(null, String(error))
        }
      })()
    }
    const onAbort = () => {
      isCancelled = true
      stop()
    }
    // A named deadline kills the tree past it, however long it is (past
    // one timer's range too); unnamed, the process runs until it exits or
    // the signal aborts, saying so out loud on the log.
    const cancelTimer =
      run.hasExternalTimeout || run.timeoutMs === undefined
        ? undefined
        : setLongTimeout(() => {
            isTimedOut = true
            stop()
          }, run.timeoutMs)
    const stopNoticing =
      run.timeoutMs === undefined
        ? startStillWaiting((elapsedMs) => {
            run.tree.log(stillWaitingText({ key: 'shellCommand' }, elapsedMs))
          })
        : undefined
    run.limit?.bind(() => {
      cancelTimer?.()
      run.resource?.background()
    })
    const settle = (exitCode: number | null, failure = '', isUnstarted = false) => {
      if (isSettled) {
        return
      }
      isSettled = true
      cancelTimer?.()
      clearTimeout(drain)
      stopNoticing?.()
      run.signal?.removeEventListener('abort', onAbort)
      // Our ends of the pipes; whatever still writes to them is not waited for.
      child.stdout.destroy()
      child.stderr.destroy()
      if (!isUnstarted && run.killOnExit) stop()
      const result: ShellResult = {
        stdout: stdout.text(),
        stderr: `${stderr.text()}${failure}`,
        exitCode,
        isTimedOut,
        isCancelled,
        ...(isOutputTooLarge && { isOutputTooLarge }),
        ...(isUnstarted && { isWorkspaceShutdownProven: true }),
      }
      // Registered stop refusal settles as a failure and retains unknown tree occupancy.
      void (kill ?? Promise.resolve()).then(() => {
        resolve(
          hasTerminationFailed
            ? { ...result, stdout: '', stderr: UI_TEXT.vault.noAccess, exitCode: null }
            : result,
        )
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
      if (run.onStdout) run.onStdout(chunk)
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (run.maxOutputBytes !== undefined && stderrBytes > run.maxOutputBytes) {
        isOutputTooLarge = true
        stop()
      }
      if (run.onStderr) run.onStderr(chunk)
      else stderr.push(chunk)
    })
    child.on('error', (error) => {
      // Node leaves the pid undefined only when the spawn itself failed: no
      // process exists. Any other error (a failed kill, a broken pipe) is a
      // process that did launch, so it proves nothing.
      settle(null, error.message, child.pid === undefined)
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
