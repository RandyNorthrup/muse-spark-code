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

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { McpStdioLaunch } from '../../core/backends/modelapi/mcp/servers'
import type { McpChildProcess } from '../../core/backends/modelapi/mcp/stdio'
import type { vaultCommandSchema } from '../../shared/vault'
import { killTree, sweepExitedTree, type TreeRoot, treeSpawnOptions } from '../processTree'
import {
  environmentValue,
  setEnvironmentVariable,
  resolveServerCommand,
  spawnLine,
  workspaceChildEnvironment,
} from '../../core/execGuard'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { realpathSync, statSync } from 'node:fs'
import { stopResourceTree } from '../../core/resources/admission'
import { mcpSecretReferences } from '../../core/vault/mcpReferences'
import { redactSecrets } from '../../core/redact'
import { MCP_STDIO_ENV_ALLOWLIST, TREE_EXIT_WAIT_MS, UI_TEXT } from '../../shared/constants'
import { describeStoreError } from './storeErrors'
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

// A window can hold many MCP servers. Their exit sweeps must not launch a
// burst of PowerShell process-table helpers at shutdown.
const exitedSweepQueue: { current: Promise<void> } = { current: Promise.resolve() }

function queueExitedSweep(
  pid: number | undefined,
  startedAt: number,
  diedAt: number,
  deps: McpSpawnDeps,
  signal?: AbortSignal,
): Promise<void> {
  if (deps.platform !== 'win32') {
    return (async () => {
      try {
        await sweepExitedTree(pid, startedAt, diedAt, deps, undefined, signal)
      } catch (error: unknown) {
        deps.log(
          `the children of an exited MCP server could not be ended: ${describeStoreError(error)}`,
        )
      }
    })()
  }
  const previous = exitedSweepQueue.current
  const cleanup = (async () => {
    await previous
    try {
      await sweepExitedTree(pid, startedAt, diedAt, deps, undefined, signal)
    } catch (error: unknown) {
      deps.log(
        `the children of an exited MCP server could not be swept: ${describeStoreError(error)}`,
      )
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

/** O's trusted resolution port: canonical paths before the broker hashes the stdio use. */
export function resolveMcpVaultCommand(
  launch: McpStdioLaunch,
  cwd: string,
  deps: McpSpawnDeps,
): ReturnType<typeof vaultCommandSchema.parse> {
  mcpSecretReferences(launch)
  const env = mcpServerEnvironment(deps.env(), launch.env, deps.platform)
  const file = resolveServerCommand(launch.command, cwd, env, deps, {
    workspaceRoot: cwd,
    realpath: realpathSync,
  })
  return { executable: realpathSync(file), argv: [...launch.args], cwd: realpathSync(cwd) }
}

function exitDescription(code: number | null, signal: NodeJS.Signals | null = null): string {
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
  signal?: AbortSignal,
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
  child.onProcessExit((code, exitSignal) => {
    processCode = code
    processSignal = exitSignal
    // A server that exits by itself can still leave a child. Start the
    // identity-checked sweep now; stdout may still have a final MCP frame.
    if (resource !== undefined) {
      treeCleanup ??= stopResourceTree(resource)
      void treeCleanup.catch(() => {
        deps.log('an exited MCP server has an unproved registered tree stop')
      })
    } else if (!isJobLauncher) {
      treeCleanup ??= queueExitedSweep(child.pid, startedAt, Date.now(), deps, signal)
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
      treeCleanup ??= killTree(child, treeDeps, startedAt, undefined, undefined, signal)
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
  return (launch, cwd, _isCancelled, signal, resource, assembly) => {
    if (mcpSecretReferences(launch).size > 0) {
      throw new Error(UI_TEXT.vault.noAccess)
    }
    if (!deps.isExistingDirectory(cwd)) {
      throw new Error(`its working directory ${cwd} does not exist`)
    }
    // The server runs an absolute file with the guarded child PATH for
    // its working directory, so nothing it starts by bare name resolves to
    // a program planted there. A relative command stays the file the
    // person's config names, resolved against that directory.
    const env = resourceEnvironment(
      workspaceChildEnvironment(
        deps.platform,
        mcpServerEnvironment(deps.env(), launch.env, deps.platform),
        { workspaceRoot: cwd, realpath: realpathSync },
      ),
      resource,
    )
    const file = resolveServerCommand(launch.command, cwd, env, deps, {
      workspaceRoot: cwd,
      realpath: realpathSync,
    })
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
      return observeMcpProcess(nodeProcessHandle(child), deps, startedAt, true, resource, signal)
    }
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the server the user configured in Muse Code's settings, started only in a trusted workspace, with an absolute resolved command and a fixed argument array (PLAN.md §8).
    const child = spawnGuarded(line.file, [...line.args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...treeSpawnOptions(deps.platform),
    })
    observeResourceProcess(resource, child)
    return observeMcpProcess(nodeProcessHandle(child), deps, startedAt, false, resource, signal)
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
