import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  ResourceCapRefusedError,
  ResourceMemoryLimitError,
  type ResourceHandoffUntil,
} from './launch'
import { NO_WORKSPACE, type GuardedChildEnv } from '../executables'
import {
  isWorkspacePath,
  noWorkspaceChildEnvironment,
  resolveExecutable,
  workspaceChildEnvironment,
} from '../execGuard'
import { environmentValue } from '../execGuard'
import { existsSync, realpathSync } from 'node:fs'
import { CLI_OUTPUT_MAX_BYTES, PROCESS_TABLE_TIMEOUT_MS } from '../../shared/constants'
import { spawnResourceProcess } from './process'

/**
The workspace a governed child runs in: product lookups (`xdg-open`,
`open`, `rundll32.exe`, the governed probes) never resolve to a file
inside it, and the child's PATH is the guarded child PATH for it.
*/
export interface GovernedWorkspace {
  readonly workspaceRoot: string
}

/**
The workspace a governed call guards when its caller names none: the given
folder (the spawn's working directory, else this process's), unless it is
a filesystem root or the home folder. An editor host starts in one of
those (VS Code keeps its launch folder on macOS and Linux: `/` from the
Dock or Finder, the home folder from a desktop launcher); such a folder is
no project and holds every program, so it names no workspace, and lookups
then read absolute PATH entries only, links followed.
*/
export function defaultGovernedWorkspace(folder: string): GovernedWorkspace | undefined {
  const resolved = path.resolve(folder)
  if (resolved === path.parse(resolved).root) return undefined
  return comparablePath(resolved) === comparablePath(path.resolve(homedir()))
    ? undefined
    : { workspaceRoot: resolved }
}

/** A path as this platform compares it: Windows ignores case. */
function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function resolveCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  workspace: GovernedWorkspace | undefined,
): string {
  // The running runtime itself (the editor's Node, the agent's node) is no
  // lookup a workspace can plant: this process already runs it. VS Code's
  // extension host on Windows works in its own install folder, so Code.exe
  // sat "inside the workspace" and every vault broker launch was refused.
  if (command === process.execPath) return command
  const scope =
    workspace === undefined
      ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
      : { workspaceRoot: workspace.workspaceRoot, realpath: realpathSync }
  if (path.isAbsolute(command)) {
    // An absolute configured path inside the workspace is refused like a
    // bare name there: a planted absolute `gh` must not run with the
    // person's login when a report reads GitHub.
    if (
      workspace !== undefined &&
      isWorkspacePath(
        process.platform,
        { ...scope, workspaceRoot: workspace.workspaceRoot },
        command,
      )
    )
      throw new Error('Governed command unavailable')
    if (!existsSync(command)) throw new Error('Governed command unavailable')
    return command
  }
  const file = resolveExecutable(command, {
    platform: process.platform,
    pathVariable: environmentValue(env, process.platform, 'PATH'),
    fileExists: existsSync,
    scope,
  })
  if (file === undefined || !existsSync(file)) throw new Error('Governed command unavailable')
  return file
}

/** The child's environment: the guarded child PATH for its workspace, if it has one. */
function childEnvironment(
  env: NodeJS.ProcessEnv,
  workspace: GovernedWorkspace | undefined,
): GuardedChildEnv {
  return workspace === undefined
    ? noWorkspaceChildEnvironment(process.platform, env, realpathSync)
    : workspaceChildEnvironment(process.platform, env, {
        workspaceRoot: workspace.workspaceRoot,
        realpath: realpathSync,
      })
}

/**
Hand a URL, file or text to a fixed OS adapter (opener, clipboard). Waits for
the adapter's own exit inside RESOURCE_HANDOFF_TIMEOUT_MS; one still running
then is detached and counts as launched. Never waits for, or stops, what the
OS started for the user. `until: 'spawn'` is for a foreground handler
(xdg-open), launched once started; it takes no input.
*/
export async function handoffResourceFile(
  command: string,
  args: readonly string[],
  options: {
    readonly env: NodeJS.ProcessEnv
    readonly input?: string
    signal?: AbortSignal
    readonly until?: ResourceHandoffUntil
    /**
    The workspace the child runs in (guards its lookup and PATH).
    Defaults to the spawn's own working directory, else this process's.
    */
    readonly workspaceRoot?: string | undefined
  },
): Promise<void> {
  const workspace =
    options.workspaceRoot === undefined
      ? defaultGovernedWorkspace(process.cwd())
      : { workspaceRoot: options.workspaceRoot }
  const file = resolveCommand(command, options.env, workspace)
  const { child, handedOff } = await spawnResourceProcess('handoff', file, args, {
    env: childEnvironment(options.env, workspace),
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.until !== undefined && { handoffUntil: options.until }),
  })
  const { stdin } = child
  if (stdin === null) {
    await handedOff
    return
  }
  await new Promise<void>((resolve, reject) => {
    stdin.once('error', () => {
      reject(new Error('Governed handoff failed'))
    })
    void (async () => {
      try {
        await handedOff
        resolve()
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Governed handoff failed'))
      }
    })()
    stdin.end(options.input ?? '')
  })
}

/** execFile-compatible bounded results, using the ordinary governed command runner. */
export async function execResourceFile(
  profile: 'contained' | 'probe',
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding & {
    /**
    The workspace the child runs in (guards its lookup and PATH).
    Defaults to the spawn's own working directory, else this process's.
    */
    readonly workspaceRoot?: string | undefined
  },
): Promise<{ stdout: string; stderr: string }> {
  const env = options.env ?? process.env
  const workspace =
    options.workspaceRoot === undefined
      ? defaultGovernedWorkspace(typeof options.cwd === 'string' ? options.cwd : process.cwd())
      : { workspaceRoot: options.workspaceRoot }
  const file = resolveCommand(command, env, workspace)
  const childEnv = childEnvironment(env, workspace)
  const deadline = AbortSignal.timeout(options.timeout ?? PROCESS_TABLE_TIMEOUT_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  const launched = await spawnResourceProcess(profile, file, args, {
    env: childEnv,
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    signal,
  })
  const { child, stop } = launched
  child.stdin.end()
  return await new Promise((resolve, reject) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    const max = options.maxBuffer ?? CLI_OUTPUT_MAX_BYTES
    let bytesRead = 0
    let isFailed = false
    let stopping: Promise<void> | undefined
    const abort = () => {
      isFailed = true
      stopping ??= stop()
      void stopping.catch((error: unknown) => {
        // The abort already reached the waiter; the stop failure keeps its
        // cause so the record names the cleanup that failed.
        reject(new Error('Governed command tree stop failed', { cause: error }))
      })
    }
    // One named deadline covers admission and the run (the launch also stops on it).
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stdout.on('data', (bytes: Buffer) => {
      bytesRead += bytes.length
      if (bytesRead > max) abort()
      else out.push(bytes)
    })
    child.stderr.on('data', (bytes: Buffer) => {
      bytesRead += bytes.length
      if (bytesRead > max) abort()
      else err.push(bytes)
    })
    child.once('error', () => {
      abort()
    })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      void (async () => {
        await stopping
        const outcome = await launched.outcome()
        // A refused child or an enforced memory cap is a typed failure, even after exit 0.
        const memory = outcome?.limits.find((limit) => limit !== 'activeProcess')
        if (memory !== undefined) throw new ResourceMemoryLimitError(memory)
        if (outcome !== undefined && outcome.capRefusals > 0)
          throw new ResourceCapRefusedError(outcome.capRefusals)
        const result = {
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        }
        if (code === 0 && !isFailed) resolve(result)
        else
          reject(
            Object.assign(new Error('Governed command failed'), {
              ...result,
              code: isFailed ? -1 : code,
            }),
          )
      })().catch(reject)
    })
  })
}
