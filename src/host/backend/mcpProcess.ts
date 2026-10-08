// Starting a stdio MCP server for the Model API backend (M50, PLAN.md D42).
//
// - **Environment.** The server gets what Muse Code gives its own: a small
//   allowlist of the extension host's variables (MCP_STDIO_ENV_ALLOWLIST),
//   then its entry's `env`. Nothing else of the host's environment, where a
//   key or token may sit, reaches it.
// - **Command.** An absolute path is taken as it is, a relative one against
//   the server's working directory, and a bare name is looked for on the
//   absolute entries of PATH only (D24: never the working directory), with
//   the extensions Windows starts (`.com`, `.exe`, `.bat`, `.cmd`).
// - **Batch files.** Windows starts a `.cmd` or `.bat` (`npx.cmd`, the usual
//   launcher) only through `cmd.exe`, as `CreateProcess` itself does. Every
//   part of the line is quoted, and a part that holds `"`, `%` or a line
//   break is refused, since cmd.exe would read it as syntax: arguments come
//   from the user's settings, never the model, and are never re-read.
// - **Stopping.** A POSIX process group or a Windows kill-on-close job owns
//   the entire process tree; the Windows helper exits on Stop or owner death.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { stopResourceTree } from '../../core/resources/admission'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { environmentValue, setEnvironmentVariable } from '../../core/backends/musecode/launch'
import type { McpStdioLaunch } from '../../core/backends/modelapi/mcp/servers'
import type { McpChildProcess } from '../../core/backends/modelapi/mcp/stdio'
import { absolutePathEntries } from '../../core/executables'
import { redactSecrets } from '../../core/redact'
import { MCP_STDIO_ENV_ALLOWLIST, TREE_EXIT_WAIT_MS } from '../../shared/constants'
import { killTree, sweepExitedTree, type TreeRoot, treeSpawnOptions } from '../processTree'
import { spawnMcpJob } from './mcpJobLaunch'
import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
import { observeResourceProcess } from '../resources/resourceAdmission'

export interface McpSpawnDeps {
  readonly platform: NodeJS.Platform
  readonly systemRoot: string | undefined
  /** Windows: M50's compiled executable, which jobs the server before it runs. */
  readonly jobExecutablePath?: string | undefined
  /** The extension host's environment, read per server. */
  readonly env: () => NodeJS.ProcessEnv
  readonly isExistingFile: (filePath: string) => boolean
  readonly isExistingDirectory: (directory: string) => boolean
  readonly log: (message: string) => void
}

const PATH_VARIABLE = 'PATH'
const PATHEXT_VARIABLE = 'PATHEXT'
// The extensions `CreateProcess` starts, in Windows' default PATHEXT order.
const WINDOWS_LAUNCHABLE = ['.com', '.exe', '.bat', '.cmd'] as const
const WINDOWS_BATCH: ReadonlySet<string> = new Set(['.bat', '.cmd'])
const CMD_RELATIVE_PATH = String.raw`System32\cmd.exe`
// `/d` skips AutoRun; `/v:off` prevents inherited delayed expansion of `!`;
// `/s` keeps the quoted line as it is; `/c` runs it and ends.
const CMD_ARGUMENTS = ['/d', '/v:off', '/s', '/c'] as const
const CMD_UNQUOTABLE = /["%\r\n]/
const NUL = String.fromCodePoint(0)
const TRAILING_BACKSLASHES = /(\\+)$/
// A window can hold many MCP servers. Their exit sweeps must not launch a
// burst of PowerShell process-table helpers at shutdown.
const exitedSweepQueue: { current: Promise<void> } = { current: Promise.resolve() }

function queueExitedSweep(
  pid: number | undefined,
  startedAt: number,
  diedAt: number,
  deps: McpSpawnDeps,
): Promise<void> {
  if (deps.platform !== 'win32') {
    return (async () => {
      try {
        await sweepExitedTree(pid, startedAt, diedAt, deps)
      } catch (error: unknown) {
        deps.log(`the children of an exited MCP server could not be ended: ${String(error)}`)
      }
    })()
  }
  const previous = exitedSweepQueue.current
  const cleanup = (async () => {
    await previous
    try {
      await sweepExitedTree(pid, startedAt, diedAt, deps)
    } catch (error: unknown) {
      deps.log(`the children of an exited MCP server could not be swept: ${String(error)}`)
    }
  })()
  exitedSweepQueue.current = cleanup
  return cleanup
}

/** The allowlisted variables of the host's environment, then the entry's own. */
export function mcpServerEnvironment(
  hostEnv: NodeJS.ProcessEnv,
  entryEnv: Readonly<Record<string, string>>,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of MCP_STDIO_ENV_ALLOWLIST) {
    const value = environmentValue(hostEnv, platform, name)
    if (value !== undefined) {
      setEnvironmentVariable(env, platform, name, value)
    }
  }
  for (const [name, value] of Object.entries(entryEnv)) {
    setEnvironmentVariable(env, platform, name, value)
  }
  return env
}

/** The extensions to try for a bare Windows name: PATHEXT's launchable ones, in its order. */
function windowsExtensions(env: NodeJS.ProcessEnv): readonly string[] {
  const listed = (environmentValue(env, 'win32', PATHEXT_VARIABLE) ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
  const known: readonly string[] = WINDOWS_LAUNCHABLE
  const ordered = listed.filter((extension) => known.includes(extension))
  return ordered.length === 0 ? WINDOWS_LAUNCHABLE : ordered
}

function candidatesFor(
  name: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  if (platform !== 'win32') {
    return [name]
  }
  const extension = path.win32.extname(name).toLowerCase()
  const known: readonly string[] = WINDOWS_LAUNCHABLE
  return known.includes(extension)
    ? [name]
    : windowsExtensions(env).map((candidate) => `${name}${candidate}`)
}

/** The file the command names, absolute; throws with the reason when there is none. */
export function resolveServerCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  deps: Pick<McpSpawnDeps, 'platform' | 'isExistingFile'>,
): string {
  const p = deps.platform === 'win32' ? path.win32 : path.posix
  const name = p.basename(command)
  const hasDirectory =
    command.includes('/') || (deps.platform === 'win32' && command.includes('\\'))
  const directories = hasDirectory
    ? [p.dirname(p.resolve(cwd, command))]
    : absolutePathEntries(deps.platform, environmentValue(env, deps.platform, PATH_VARIABLE))
  for (const directory of directories) {
    for (const candidate of candidatesFor(name, deps.platform, env)) {
      const full = p.join(directory, candidate)
      if (deps.isExistingFile(full)) {
        return full
      }
    }
  }
  throw new Error(
    hasDirectory
      ? `its command ${name} does not exist`
      : `its command ${name} was not found on the absolute entries of PATH`,
  )
}

/** One part of a cmd.exe line: quoted, with the backslashes before the closing quote doubled. */
export function cmdQuoted(part: string): string {
  if (CMD_UNQUOTABLE.test(part) || part.includes(NUL)) {
    throw new Error(
      'a batch-file server cannot be given a double quote, a percent sign or a line break; start its program directly',
    )
  }
  return `"${part.replace(TRAILING_BACKSLASHES, '$1$1')}"`
}

/** What `spawn` is given: the file itself, or cmd.exe running a batch file. */
export function spawnLine(
  file: string,
  args: readonly string[],
  deps: Pick<McpSpawnDeps, 'platform' | 'systemRoot'>,
): { readonly file: string; readonly args: readonly string[]; readonly isVerbatim: boolean } {
  const isBatch =
    deps.platform === 'win32' && WINDOWS_BATCH.has(path.win32.extname(file).toLowerCase())
  if (!isBatch) {
    return { file, args, isVerbatim: false }
  }
  if (deps.systemRoot === undefined) {
    throw new Error('a batch-file server needs cmd.exe, and SystemRoot is not set')
  }
  const line = [file, ...args].map((part) => cmdQuoted(part)).join(' ')
  return {
    file: path.win32.join(deps.systemRoot, CMD_RELATIVE_PATH),
    args: [...CMD_ARGUMENTS, `"${line}"`],
    isVerbatim: true,
  }
}

function exitDescription(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null
    ? `it was ended by ${signal ?? 'a signal'}`
    : `it exited with code ${String(code)}`
}

/** The Node process events are separate: `exit` can precede its last stdout bytes. */
export interface McpProcessHandle extends TreeRoot {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  onProcessExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  onStreamsClose(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  onStartError(listener: (error: Error) => void): void
}

function nodeProcessHandle(child: ChildProcessWithoutNullStreams): McpProcessHandle {
  return {
    get pid() {
      return child.pid
    },
    get exitCode() {
      return child.exitCode
    },
    get signalCode() {
      return child.signalCode
    },
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    onProcessExit(listener) {
      child.once('exit', listener)
    },
    onStreamsClose(listener) {
      child.once('close', listener)
    },
    onStartError(listener) {
      child.once('error', listener)
    },
    once(event, listener) {
      child.once(event, listener)
    },
    kill(signal) {
      return child.kill(signal)
    },
  }
}

/** Deliver final bytes before ending MCP, while starting job cleanup at process exit. */
export function observeMcpProcess(
  child: McpProcessHandle,
  deps: McpSpawnDeps,
  startedAt: number,
  isJobLauncher = false,
  resource?: ResourceLease,
): McpChildProcess {
  const exitListeners = new Set<(how: string) => void>()
  let exit: string | undefined
  let startError: string | undefined
  let processCode: number | null = null
  let processSignal: NodeJS.Signals | null = null
  let treeCleanup: Promise<void> | undefined
  const treeDeps = { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log }
  const exited = (how: string) => {
    if (exit !== undefined) {
      return
    }
    exit = how
    for (const listener of exitListeners) {
      listener(how)
    }
  }
  child.onProcessExit((code, signal) => {
    processCode = code
    processSignal = signal
    // A server that exits by itself can still leave a child. Start the
    // identity-checked sweep now; stdout may still have a final MCP frame.
    if (resource !== undefined) {
      treeCleanup ??= stopResourceTree(resource)
      void treeCleanup.catch(() => {
        deps.log('an exited MCP server has an unproved registered tree stop')
      })
    } else if (!isJobLauncher) {
      treeCleanup ??= queueExitedSweep(child.pid, startedAt, Date.now(), deps)
    }
  })
  child.onStreamsClose((code, signal) => {
    exited(startError ?? exitDescription(code ?? processCode, signal ?? processSignal))
  })
  child.onStartError((error) => {
    startError = `it could not be started: ${redactSecrets(error.message)}`
  })
  // A write to a server that has gone is reported by its exit, not thrown.
  child.stdin.on('error', (error) => {
    deps.log(`an MCP server's input could not be written: ${redactSecrets(error.message)}`)
  })
  return {
    write: (bytes) => {
      if (exit === undefined && child.stdin.writable) {
        child.stdin.write(bytes)
      }
    },
    endInput: () => {
      child.stdin.end()
    },
    onStdout: (listener) => {
      child.stdout.on('data', listener)
    },
    onStderr: (listener) => {
      child.stderr.on('data', listener)
    },
    onExit: (listener) => {
      if (exit === undefined) {
        exitListeners.add(listener)
      } else {
        listener(exit)
      }
    },
    kill: () => {
      if (resource !== undefined) {
        treeCleanup ??= stopResourceTree(resource)
        return treeCleanup
      }
      if (isJobLauncher) {
        if (exit !== undefined) {
          return Promise.resolve()
        }
        treeCleanup ??= new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('the MCP job launcher did not exit after Stop'))
          }, TREE_EXIT_WAIT_MS)
          child.onStreamsClose(() => {
            clearTimeout(timer)
            resolve()
          })
          const didSignal = child.kill()
          if (didSignal || child.exitCode !== null || child.signalCode !== null) {
            return
          }
          clearTimeout(timer)
          reject(new Error('the MCP job launcher could not be stopped'))
        })
        return treeCleanup
      }
      if (treeCleanup !== undefined) {
        return treeCleanup
      }
      // Node can set exitCode just before it emits `exit`. Let that event
      // capture the real death time and start the sweep; do not cache
      // killTree's early no-op over the pending exit cleanup.
      if (child.exitCode !== null || child.signalCode !== null) {
        return new Promise<void>((resolve) => {
          child.onProcessExit(() => {
            void (treeCleanup ?? Promise.resolve()).then(resolve)
          })
        })
      }
      treeCleanup ??= killTree(child, treeDeps, startedAt)
      return treeCleanup
    },
  }
}

/** The pool's spawner (McpPoolDeps.spawn); throws with the reason a server cannot start. */
export function mcpServerSpawner(
  deps: McpSpawnDeps,
): (
  launch: McpStdioLaunch,
  cwd: string,
  isCancelled?: () => boolean,
  signal?: AbortSignal,
  resource?: ResourceLease,
  assembly?: string,
) => McpChildProcess {
  return (launch, cwd, _isCancelled, _signal, resource, assembly) => {
    if (!deps.isExistingDirectory(cwd)) {
      throw new Error(`its working directory ${cwd} does not exist`)
    }
    const env = resourceEnvironment(
      mcpServerEnvironment(deps.env(), launch.env, deps.platform),
      resource,
    )
    const file = resolveServerCommand(launch.command, cwd, env, deps)
    const line = spawnLine(file, launch.args, deps)
    const startedAt = Date.now()
    if (deps.platform === 'win32') {
      if (deps.jobExecutablePath === undefined || deps.systemRoot === undefined) {
        throw new Error('Windows job containment is unavailable; the MCP server was not started')
      }
      const child = spawnMcpJob({
        executablePath: deps.jobExecutablePath,
        file: line.file,
        args: line.args,
        isVerbatim: line.isVerbatim,
        cwd,
        env,
        log: deps.log,
        resource,
        resourceAssembly: assembly,
      })
      return observeMcpProcess(nodeProcessHandle(child), deps, startedAt, true, resource)
    }
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the server the user configured in Muse Code's settings, started only in a trusted workspace, with an absolute resolved command and a fixed argument array (PLAN.md §8).
    const child = spawn(line.file, [...line.args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...treeSpawnOptions(deps.platform),
    })
    observeResourceProcess(resource, child)
    return observeMcpProcess(nodeProcessHandle(child), deps, startedAt, false, resource)
  }
}

/** Whether a directory is there: the real spawner's probe. */
export function isExistingDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory()
  } catch {
    return false
  }
}

/** Whether a file (not a directory) is there: the real spawner's probe. */
export function isExistingFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}
