// M91 lane X: the plugin host. Amp and OpenCode plugins run OUT OF PROCESS
// in a short-lived child under the user's own runtime (pluginChild.ts is the
// entry; both sides speak one JSON request line on stdin, one JSON answer
// line on stdout). One child per hook call: a crash or timeout is contained
// to that call, and nothing survives it. The host guarantees the brief's
// invariants whatever a plugin does:
// - an answer can only refuse, narrow or add context: sanitizePluginAnswer
//   drops every allow grant, even from a compromised child;
// - a crash, timeout, over-long answer or missing runtime follows the
//   event's fail-closed rule (failClosed on the call, owned by lane W's
//   dispatcher): blocked when closed, failed with the reason when open;
// - the child is killed with the session: PluginSession tracks every live
//   child and kills the process group (POSIX) or the process (Windows);
// - bounds: PLUGIN_HOOK_TIMEOUT_MS per call, PLUGIN_CHILD_MAX_HEAP_MB heap
//   for node, PLUGIN_RESPONSE_MAX_BYTES per answer frame.
// The child inherits a filtered environment: HOOK_FORBIDDEN_ENV_NAMES and
// any *_API_KEY never reach it (AGENTS.md: secrets never reach a child).
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  HOOK_FORBIDDEN_ENV_NAMES,
  PLUGIN_CHILD_MAX_HEAP_MB,
  PLUGIN_HOOK_TIMEOUT_MS,
  PLUGIN_NODE_MINIMUM,
  PLUGIN_RESPONSE_MAX_BYTES,
} from '../../../shared/constants'
import type { ForeignHookAnswer } from './hookFormats/contract'
import { pluginChildSource } from './pluginChild'

export type PluginSystem = 'amp' | 'opencode'

export interface PluginCall {
  readonly system: PluginSystem
  /** Absolute plugin path (a .js/.ts file the runtime imports). */
  readonly pluginPath: string
  /** The plugin-system hook, from PLAN's lane X mapping. */
  readonly hook: string
  /** The hook payload, shaped by the dispatcher per the mapping. */
  readonly payload: Readonly<Record<string, unknown>>
  /** Whether a crash/timeout blocks (the event's fail-closed rule). */
  readonly failClosed: boolean
  readonly timeoutMs?: number | undefined
}

export interface PluginRunDeps {
  readonly platform?: NodeJS.Platform | undefined
  /** `node --version` / `bun --version` output; default runs the binary. */
  readonly runVersion?: ((command: string) => Promise<string>) | undefined
  /** Child entry source; default is pluginChildSource(). */
  readonly childSource?: string | undefined
  readonly spawn?: PluginSpawn | undefined
  /** Live children register here so the session kills its stragglers. */
  readonly ownedBy?: Set<PluginChildHandle> | undefined
}

export interface PluginSpawnOptions {
  readonly env: NodeJS.ProcessEnv
  readonly detached: boolean
}

export interface PluginChildStdin {
  write(chunk: string): void
  end(): void
}

export interface PluginChildEvents {
  on(event: 'data', listener: (chunk: Buffer) => void): void
}

export interface PluginChildHandle {
  readonly pid: number | undefined
  readonly stdin: PluginChildStdin | null
  readonly stdout: PluginChildEvents | null
  readonly stderr: PluginChildEvents | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'close' | 'error', listener: (...args: never[]) => void): void
}

export type PluginSpawn = (
  command: string,
  args: readonly string[],
  options: PluginSpawnOptions,
) => PluginChildHandle

export type RuntimeResolution =
  | { readonly ok: true; readonly command: string; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: string }

const execFileAsync = promisify(nodeExecFile)

async function defaultRunVersion(command: string): Promise<string> {
  const { stdout } = await execFileAsync(command, ['--version'], { timeout: 15_000 })
  return stdout
}

const VERSION_PARTS = 3

function parseVersion(text: string): readonly [number, number, number] | undefined {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  if (match === null) return undefined
  const parts = [match[1], match[2], match[3]].map(Number)
  return parts.every((part) => Number.isSafeInteger(part))
    ? [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    : undefined
}

function isAtLeast(have: readonly [number, number, number], want: string): boolean {
  const minimum = want.split('.').map(Number)
  for (let index = 0; index < VERSION_PARTS; index += 1) {
    const mine = have[index] ?? 0
    const need = minimum[index] ?? 0
    if (mine !== need) return mine > need
  }
  return true
}

/**
 * The user's runtime for this plugin system, or a refusal with a reason:
 * Amp and plain JS need system node >= 22.18 (TS goes through Node's
 * built-in type stripping; the extension host's Electron Node is never
 * used); OpenCode is Bun-native and needs the installed bun.
 */
export async function resolvePluginRuntime(
  system: PluginSystem,
  deps: PluginRunDeps = {},
): Promise<RuntimeResolution> {
  const runVersion = deps.runVersion ?? defaultRunVersion
  if (system === 'amp') {
    let text: string
    try {
      text = await runVersion('node')
    } catch {
      return { ok: false, reason: 'amp: the system node runtime is not installed' }
    }
    const version = parseVersion(text)
    if (version === undefined)
      return { ok: false, reason: 'amp: the system node version could not be read' }
    if (!isAtLeast(version, PLUGIN_NODE_MINIMUM))
      return {
        ok: false,
        reason: `amp: system node ${version.join('.')} is too old (need >= ${PLUGIN_NODE_MINIMUM} for type stripping)`,
      }
    return {
      ok: true,
      command: 'node',
      args: [
        `--max-old-space-size=${String(PLUGIN_CHILD_MAX_HEAP_MB)}`,
        '--input-type=module',
        '-e',
      ],
    }
  }
  try {
    await runVersion('bun')
  } catch {
    return { ok: false, reason: 'opencode: the installed bun runtime is absent' }
  }
  return { ok: true, command: 'bun', args: ['-e'] }
}

/** The child environment: everything except credentials. */
export function pluginChildEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(from)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    if (upper.endsWith('_API_KEY') || HOOK_FORBIDDEN_ENV_NAMES.has(upper)) continue
    env[name] = value
  }
  return env
}

const ANSWER_STATUSES = ['completed', 'blocked', 'failed'] as const

function isStatus(value: unknown): value is ForeignHookAnswer['status'] {
  return (ANSWER_STATUSES as readonly unknown[]).includes(value)
}

/**
 * A plugin answer can only refuse, narrow or add context: every allow
 * grant is dropped (an allow becomes a plain completed), and tool
 * narrowing the plugin was never offered is dropped. Runs on every answer,
 * including the child's, so a compromised child cannot widen a decision.
 */
export function sanitizePluginAnswer(answer: ForeignHookAnswer): ForeignHookAnswer {
  if (!isStatus(answer.status))
    return { status: 'failed', reason: 'plugin returned an invalid answer' }
  const { approvalDecision, permissionDecision, allowedToolNames: _dropped, ...rest } = answer
  return {
    ...rest,
    ...(approvalDecision === 'deny' && { approvalDecision: 'deny' as const }),
    ...((permissionDecision === 'deny' || permissionDecision === 'ask') && { permissionDecision }),
  }
}

function transportFailure(call: PluginCall, detail: string): ForeignHookAnswer {
  return { status: call.failClosed ? 'blocked' : 'failed', reason: `${call.system}: ${detail}` }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: PluginSpawnOptions,
): PluginChildHandle {
  const child: ChildProcess = nodeSpawn(command, [...args], {
    env: options.env,
    detached: options.detached,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return child as unknown as PluginChildHandle
}

/** Kill the whole process group on POSIX; the process on Windows. */
function killChild(child: PluginChildHandle, platform: NodeJS.Platform): void {
  try {
    if (platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, 'SIGKILL')
      return
    }
  } catch {
    // Fall through to a direct kill (already dead or no group).
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already dead: nothing left to bound.
  }
}

/**
 * One plugin hook call in one child. The child is always reaped: on answer,
 * on timeout, on crash, and by PluginSession.dispose for stragglers.
 */
export async function runPluginHook(
  call: PluginCall,
  deps: PluginRunDeps = {},
): Promise<ForeignHookAnswer> {
  const platform = deps.platform ?? process.platform
  const spawn = deps.spawn ?? defaultSpawn
  const source = deps.childSource ?? pluginChildSource()
  const timeoutMs = call.timeoutMs ?? PLUGIN_HOOK_TIMEOUT_MS
  const runtime = await resolvePluginRuntime(call.system, deps)
  if (!runtime.ok) return transportFailure(call, runtime.reason)
  return await new Promise<ForeignHookAnswer>((resolve) => {
    let child: PluginChildHandle
    try {
      child = spawn(runtime.command, [...runtime.args, source], {
        env: pluginChildEnv(),
        detached: platform !== 'win32',
      })
    } catch {
      resolve(transportFailure(call, 'the plugin child could not start'))
      return
    }
    deps.ownedBy?.add(child)
    let isDone = false
    let stdout = ''
    let isFrameCapped = false
    const finish = (answer: ForeignHookAnswer): void => {
      if (isDone) return
      isDone = true
      deps.ownedBy?.delete(child)
      clearTimeout(timer)
      killChild(child, platform)
      resolve(sanitizePluginAnswer(answer))
    }
    const timer = setTimeout(
      () => {
        finish(transportFailure(call, 'the plugin child timed out'))
      },
      Math.max(timeoutMs, 1),
    )
    // Do not let a straggler keep the host alive.
    timer.unref()
    child.on('error', () => {
      finish(transportFailure(call, 'the plugin child crashed'))
    })
    child.on('close', () => {
      if (isDone) return
      const text = stdout.trim()
      if (text === '') {
        finish(transportFailure(call, 'the plugin child exited without answering'))
        return
      }
      let frame: unknown
      try {
        frame = JSON.parse(text)
      } catch {
        finish(transportFailure(call, 'the plugin child answered outside its frame'))
        return
      }
      if (
        frame === null ||
        typeof frame !== 'object' ||
        (frame as { ok?: unknown }).ok !== true ||
        typeof (frame as { answer?: unknown }).answer !== 'object'
      ) {
        const error =
          frame !== null &&
          typeof frame === 'object' &&
          typeof (frame as { error?: unknown }).error === 'string'
            ? (frame as { error: string }).error
            : 'the plugin failed'
        finish(transportFailure(call, error))
        return
      }
      finish((frame as { answer: ForeignHookAnswer }).answer)
    })
    const request = JSON.stringify({
      system: call.system,
      plugin: call.pluginPath,
      hook: call.hook,
      payload: call.payload,
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (isDone || isFrameCapped) return
      stdout += chunk.toString('utf8')
      if (stdout.length <= PLUGIN_RESPONSE_MAX_BYTES) return
      isFrameCapped = true
      finish(transportFailure(call, 'the plugin answer exceeded its frame'))
    })
    child.stderr?.on('data', () => {
      // Plugin logs stay on the child's stderr; the host never parses them.
    })
    try {
      child.stdin?.write(`${request}\n`)
      child.stdin?.end()
    } catch {
      finish(transportFailure(call, 'the plugin child could not start'))
    }
  })
}

/** One session's plugin children: dispose kills every live child. */
export class PluginSession {
  private readonly owned = new Set<PluginChildHandle>()
  private disposed = false

  /** Run one hook call; refused when the session is closed. */
  async run(call: PluginCall, deps: PluginRunDeps = {}): Promise<ForeignHookAnswer> {
    return this.disposed
      ? { status: 'failed', reason: `${call.system}: the session is closed` }
      : await runPluginHook(call, { ...deps, ownedBy: this.owned })
  }

  /** Kill every live child of this session. */
  dispose(platform: NodeJS.Platform = process.platform): void {
    this.disposed = true
    for (const child of this.owned) killChild(child, platform)
    this.owned.clear()
  }
}
