// M91 lane X: the plugin host. Amp and OpenCode plugins run OUT OF PROCESS
// in a short-lived child under the user's own runtime (pluginChild.ts is the
// entry; the host writes one JSON request line on stdin and reads one JSON
// answer line on stdout). One child per hook call: a crash or timeout is
// contained to that call, and nothing survives it. The host guarantees the
// invariants whatever a plugin does (RVM91X fixes in brackets):
// - an answer can only refuse, narrow or add context: every frame is parsed
//   by a closed schema [3], and sanitizePluginAnswer drops every allow grant,
//   even from a compromised child;
// - a crash, timeout, over-long or invalid answer, missing runtime, or a
//   failed answer from the shim follows the call's fail-closed rule [6]:
//   blocked when closed, failed with the reason when open;
// - the child and everything it starts end together: a `PluginProcessTree`
//   starts it (a kill-on-close job object on Windows, from the host; a
//   process group on POSIX) and ends the whole tree on answer, timeout and
//   session dispose [5]; without a tree on Windows the hook is refused;
// - the environment is the caller's allowlisted hook environment (M51's,
//   `hookEnvironment` in the host), for the version probe and the child
//   alike; never the inherited one, and no credential name in any case [2];
// - nothing throws outside the call's promise: stdin errors [4], frame
//   errors and kill errors all settle the call;
// - a disposed session spawns nothing, rechecked after every await [8];
// - the answer completes on its response line, then the tree is ended [11];
// - waits: no deadline of ours — a call waits for the child's answer line,
//   an explicit per-hook timeout, the person's own plugin wait, or Stop,
//   and the runtime answers whole; every wait says how long it has waited
//   while it lasts, and an explicit timeout or Stop names the wait it
//   kept [14].
import { Buffer } from 'node:buffer'
import { admitResource, stopResourceTree } from '../../resources/admission'

import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  BYTES_PER_MIB,
  MILLISECONDS_PER_SECOND,
  PLUGIN_NODE_MINIMUM,
  STILL_WAITING_NOTICE_MS,
} from '../../../shared/constants'
import { formatUnit } from '../../../shared/l10n/text'
import { startStillWaiting, stillWaitingText } from '../../timeouts'
import type { ForeignHookAnswer } from './hookFormats/contract'
import { type GuardedChildEnv } from '../../executables'
import { resolveExecutable, workspaceChildEnvironment } from '../../execGuard'
import { environmentValue } from '../../execGuard'
import { resourceEnvironment, type ResourceLease } from '../../resources/launch'
import { spawnGuarded } from '../../guardedChildProcess'
import { withoutCredentials } from '../../credentialEnvironment'
import { statSync } from 'node:fs'
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
  /** Whether any failure blocks (the event's fail-closed rule). */
  readonly failClosed: boolean
  readonly timeoutMs?: number | undefined
}

export interface PluginSpawnOptions {
  readonly resource?: ResourceLease | undefined
  /**
  The child's whole environment: already allowlisted and guarded for the
  workspace by the caller (only `workspaceChildEnvironment` can produce
  one), so a raw environment does not type-check here.
  */
  readonly env: GuardedChildEnv
  readonly cwd: string
}

/** One running plugin child, as the host drives it. */
export interface PluginChildHandle {
  readonly pid: number | undefined
  /** Writes the request and closes stdin; a write error reaches `onError`. */
  write(text: string): void
  onStdout(listener: (chunk: Buffer) => void): void
  onClose(listener: (code?: number | null) => void): void
  /** A spawn error, or a stdin error such as EPIPE. */
  onError(listener: () => void): void
}

/**
How plugin children start and end as a whole tree. The host gives a
kill-on-close job object on Windows (the M50 job launcher); POSIX uses a
process group of its own. `killTree` never throws.
*/
export interface PluginProcessTree {
  spawn(
    command: string,
    args: readonly string[],
    options: PluginSpawnOptions,
  ): Promise<PluginChildHandle>
  killTree(child: PluginChildHandle): void | Promise<void>
}

export interface PluginRunDeps {
  /**
  M51's allowlisted hook environment, computed by the caller
  (`hookEnvironment` in the host). It is the only environment the probe
  and the child see; the extension host's own never reaches either.
  */
  readonly env: NodeJS.ProcessEnv
  /**
  The workspace the plugin runs for: `node`, `bun` and `prlimit` are
  never resolved to a file inside it (resolved through links), and the
  child's PATH carries the guarded child environment for it. REQUIRED:
  the production session passes the workspace with `realpathSync`.
  */
  readonly workspaceRoot: string
  /**
  Resolves links for the workspace comparison. REQUIRED: a lexical-only
  comparison keeps a symlink into the workspace on PATH.
  */
  readonly realpath: (filePath: string) => string
  readonly platform?: NodeJS.Platform | undefined
  /** `node --version` / `bun --version` output for an absolute command. */
  readonly runVersion?: ((command: string, env: NodeJS.ProcessEnv) => Promise<string>) | undefined
  /** Whether an absolute path is a file (the runtime's PATH lookup, D24). */
  readonly fileExists?: ((filePath: string) => boolean) | undefined
  /** Child entry source; default is pluginChildSource(). */
  readonly childSource?: string | undefined
  /** Default: a POSIX process group; none on Windows, where the hook is then refused. */
  readonly processTree?: PluginProcessTree | undefined
  /** Fixed-text notes (refused registrations); never plugin text. */
  readonly warn?: ((message: string) => void) | undefined
  /**
  The person's plugin bounds, re-read per call so a changed setting
  applies without rebinding; absent means none of ours.
  */
  readonly bounds?: (() => PluginPersonBounds) | undefined
  /** Still-waiting notices go here; without one the wait stays silent. */
  readonly notice?: ((message: string) => void) | undefined
  /** Tests only: the still-waiting cadence; production keeps the shared one. */
  readonly noticeMs?: number | undefined
}

/**
What the person sets on plugin children (D121: each 0 or absent is none
of ours, applied only when set). The host reads these from `museSpark.`
settings on every call.
*/
export interface PluginPersonBounds {
  /** Seconds a plugin hook waits for its child; 0 waits for the answer or Stop. */
  readonly timeoutSeconds?: number | undefined
  /** The child's memory ceiling in MiB; 0 is the runtime's own default. */
  readonly maxMemoryMiB?: number | undefined
  /** The answer frame cap in bytes; 0 reads answers whole. */
  readonly maxAnswerBytes?: number | undefined
}

/** A call's bounds in the units the host enforces; undefined is none of ours. */
export interface PluginCallBounds {
  readonly timeoutMs: number | undefined
  readonly maxMemoryBytes: number | undefined
  readonly maxAnswerBytes: number | undefined
}

/** The person's bounds in enforcement units; every unset value is none of ours. */
export function pluginCallBounds(bounds: PluginPersonBounds): PluginCallBounds {
  return {
    timeoutMs:
      bounds.timeoutSeconds !== undefined && bounds.timeoutSeconds > 0
        ? bounds.timeoutSeconds * MILLISECONDS_PER_SECOND
        : undefined,
    maxMemoryBytes:
      bounds.maxMemoryMiB !== undefined && bounds.maxMemoryMiB > 0
        ? bounds.maxMemoryMiB * BYTES_PER_MIB
        : undefined,
    maxAnswerBytes:
      bounds.maxAnswerBytes !== undefined && bounds.maxAnswerBytes > 0
        ? bounds.maxAnswerBytes
        : undefined,
  }
}

/** What a session lends one call: its live children, whether it closed, and the turn's stop. */
interface RunScope {
  readonly owned: Set<PluginChildHandle>
  readonly isClosed: () => boolean
  readonly signal?: AbortSignal | undefined
}

export type RuntimeResolution =
  | { readonly ok: true; readonly command: string; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: string }

async function defaultRunVersion(
  command: string,
  env: NodeJS.ProcessEnv,
  deps: PluginRunDeps,
  signal?: AbortSignal,
): Promise<string> {
  const tree = treeFor(deps, deps.platform ?? process.platform)
  if (tree === undefined) throw new Error('Plugin runtime probe has no process tree')
  // D121: no probe timeout of ours — the probe waits for the runtime's
  // answer, its exit, the person's own plugin wait, or Stop. The wait says
  // how long it has waited while it lasts, and every end names its wait.
  const startedAt = Date.now()
  const waitedText = (): string =>
    formatUnit(
      Math.max(0, Math.round((Date.now() - startedAt) / MILLISECONDS_PER_SECOND)),
      'second',
    )
  const bounds = pluginCallBounds(deps.bounds?.() ?? {})
  const resource = await admitResource('hook', signal)
  let child: PluginChildHandle
  try {
    if (signal?.aborted === true)
      throw new Error(`Plugin runtime probe cancelled after ${waitedText()}`)
    child = await tree.spawn(command, ['--version'], {
      env: resourceEnvironment(
        workspaceChildEnvironment(deps.platform ?? process.platform, env, {
          workspaceRoot: deps.workspaceRoot,
          realpath: deps.realpath,
        }),
        resource,
      ),
      cwd: path.dirname(command),
      ...(resource !== undefined && { resource }),
    })
  } catch (error: unknown) {
    resource?.complete(true)
    throw error
  }
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let isDone = false
    const finish = (error?: Error) => {
      if (isDone) return
      isDone = true
      if (timer !== undefined) clearTimeout(timer)
      stopNoticing()
      signal?.removeEventListener('abort', abort)
      endTree(tree, child)
      if (error === undefined) resolve(Buffer.concat(chunks).toString('utf8'))
      else reject(error)
    }
    const abort = () => {
      finish(new Error(`Plugin runtime probe cancelled after ${waitedText()}`))
    }
    // Only the person's own plugin wait ends the probe early; without one
    // the runtime's answer, its exit, or Stop ends it. The bound names the
    // wait it kept, as a wait with no bound names Stop's wait.
    const probeTimeoutMs = bounds.timeoutMs
    const timer =
      probeTimeoutMs === undefined
        ? undefined
        : setTimeout(
            () => {
              finish(
                new Error(
                  `Plugin runtime probe timed out after ${formatUnit(Math.max(1, Math.round(probeTimeoutMs / MILLISECONDS_PER_SECOND)), 'second')}`,
                ),
              )
            },
            Math.max(probeTimeoutMs, 1),
          )
    // Do not let a straggler keep the host alive.
    timer?.unref()
    // The wait says how long it has waited, as Model API requests do.
    const stopNoticing = startStillWaiting((elapsedMs) => {
      deps.notice?.(stillWaitingText({ key: 'pluginHook' }, elapsedMs))
    }, deps.noticeMs ?? STILL_WAITING_NOTICE_MS)
    signal?.addEventListener('abort', abort, { once: true })
    child.onError(() => {
      finish(new Error('Plugin runtime probe failed'))
    })
    child.onClose((code) => {
      finish(
        code === undefined || code === 0
          ? undefined
          : new Error('Plugin runtime probe exited unsuccessfully'),
      )
    })
    child.onStdout((chunk) => {
      if (isDone) return
      bytes += chunk.byteLength
      if (bounds.maxAnswerBytes !== undefined && bytes > bounds.maxAnswerBytes) {
        finish(new Error('Plugin runtime probe output exceeded its bound'))
        return
      }
      chunks.push(chunk)
    })
    if (signal?.aborted === true) abort()
  })
}

function isExistingFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
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
One runtime name by absolute path on the allowlisted PATH, never a file
inside the workspace the plugin runs for (resolved through links).
*/
function probeRuntime(
  name: string,
  deps: PluginRunDeps,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  return resolveExecutable(name, {
    platform,
    pathVariable: environmentValue(env, platform, 'PATH'),
    fileExists: deps.fileExists ?? isExistingFile,
    scope: { workspaceRoot: deps.workspaceRoot, realpath: deps.realpath },
  })
}

/**
The user's runtime for this plugin system, by absolute path on the
allowlisted PATH (D24), or a refusal with a reason: Amp and plain JS need
system node >= 22.18 (TS goes through Node's built-in type stripping; the
extension host's Electron Node is never used); OpenCode is Bun-native and
needs the installed bun.
*/
export async function resolvePluginRuntime(
  system: PluginSystem,
  deps: PluginRunDeps,
  signal?: AbortSignal,
): Promise<RuntimeResolution> {
  const platform = deps.platform ?? process.platform
  const env = withoutCredentials(deps.env)
  // The person's own plugin bounds, or none of ours: a set memory ceiling
  // caps the child's heap, job and data segment below.
  const bounds = pluginCallBounds(deps.bounds?.() ?? {})
  const runVersion =
    deps.runVersion ??
    ((command: string, env: NodeJS.ProcessEnv) => defaultRunVersion(command, env, deps, signal))
  const name = system === 'amp' ? 'node' : 'bun'
  const command = probeRuntime(name, deps, env, platform)
  if (system === 'amp') {
    if (command === undefined) {
      return { ok: false, reason: 'amp: the system node runtime is not installed' }
    }
    let text: string
    try {
      text = await runVersion(command, env)
    } catch (error: unknown) {
      // Stop and the person's own wait end the probe with the wait's own
      // words, not 'not installed'.
      return {
        ok: false,
        reason:
          error instanceof Error &&
          (error.message.startsWith('Plugin runtime probe cancelled after') ||
            error.message.startsWith('Plugin runtime probe timed out after'))
            ? error.message
            : 'amp: the system node runtime is not installed',
      }
    }
    const version = parseVersion(text)
    if (version === undefined)
      return { ok: false, reason: 'amp: the system node version could not be read' }
    if (!isAtLeast(version, PLUGIN_NODE_MINIMUM))
      return {
        ok: false,
        reason: `amp: system node ${version.join('.')} is too old (need >= ${PLUGIN_NODE_MINIMUM} for type stripping)`,
      }
    // D121: no heap flag of ours — without a set ceiling the runtime's own
    // default applies; a set ceiling caps node's heap at it.
    const heapFlag =
      bounds.maxMemoryBytes === undefined
        ? []
        : [`--max-old-space-size=${String(Math.floor(bounds.maxMemoryBytes / BYTES_PER_MIB))}`]
    return {
      ok: true,
      command,
      args: [...heapFlag, '--input-type=module', '-e'],
    }
  }
  if (command === undefined) {
    return { ok: false, reason: 'opencode: the installed bun runtime is absent' }
  }
  try {
    await runVersion(command, env)
  } catch (error: unknown) {
    // Stop and the person's own wait end the probe with the wait's own
    // words, not 'absent'.
    return {
      ok: false,
      reason:
        error instanceof Error &&
        (error.message.startsWith('Plugin runtime probe cancelled after') ||
          error.message.startsWith('Plugin runtime probe timed out after'))
          ? error.message
          : 'opencode: the installed bun runtime is absent',
    }
  }
  // D121: no memory bound of ours on any platform — without a set ceiling
  // bun runs directly, and a plugin child that outgrows the machine is
  // ended with its tree on an explicit timeout, by Stop, or by the OS, not
  // refused up front.
  return boundedBun(command, env, platform, deps, bounds.maxMemoryBytes)
}

/**
Bun has no heap flag, so a person's memory ceiling is bounded outside it
where the OS offers a spawner-set cap: on Windows by the job's memory
limit (the host's tree caps the launcher it starts through), on Linux by
util-linux's `prlimit --data`. macOS offers neither, and OpenCode itself
runs bun plugins with no memory bound there — so on macOS a set ceiling
refuses with its reason instead of running unbounded past it.
*/
function boundedBun(
  bun: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  deps: PluginRunDeps,
  maxMemoryBytes: number | undefined,
): RuntimeResolution {
  if (maxMemoryBytes === undefined) {
    return { ok: true, command: bun, args: ['-e'] }
  }
  if (platform === 'win32') {
    // The host starts this through its job launcher, which carries the same ceiling.
    return { ok: true, command: bun, args: ['-e'] }
  }
  if (platform === 'darwin') {
    return { ok: false, reason: 'opencode: the plugin memory ceiling cannot be bounded on darwin' }
  }
  if (platform !== 'linux') {
    return { ok: false, reason: `opencode: bun's memory cannot be bounded on ${platform}` }
  }
  const prlimit = probeRuntime('prlimit', deps, env, platform)
  if (prlimit === undefined) {
    return {
      ok: false,
      reason: 'opencode: the plugin memory ceiling needs prlimit, which is absent',
    }
  }
  return {
    ok: true,
    command: prlimit,
    args: [`--data=${String(maxMemoryBytes)}`, '--', bun, '-e'],
  }
}

/** Wraps a Node child: the request goes in once, and stderr is drained unread. */
export function nodeChildHandle(child: ChildProcess): PluginChildHandle {
  const errors: (() => void)[] = []
  const failed = (): void => {
    for (const listener of errors) listener()
  }
  child.on('error', failed)
  // An EPIPE arrives after write() returns: without this it would be uncaught.
  child.stdin?.on('error', failed)
  // Plugin logs stay on the child's stderr; the host never parses them.
  child.stderr?.resume()
  return {
    pid: child.pid,
    write: (text) => {
      const { stdin } = child
      if (stdin === null) {
        failed()
        return
      }
      // A child that ended before it was handed over (its close and error
      // already past) has a destroyed stdin: the write's callback says so.
      stdin.write(text, (error) => {
        if (error !== null && error !== undefined) failed()
      })
      stdin.end()
    },
    onStdout: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        listener(chunk)
      })
    },
    onClose: (listener) => {
      child.on('close', (code) => {
        listener(code)
      })
    },
    onError: (listener) => {
      errors.push(listener)
    },
  }
}

const resources = new WeakMap<PluginChildHandle, ResourceLease>()

async function didStopRegisteredPlugin(child: PluginChildHandle): Promise<boolean> {
  const resource = resources.get(child)
  if (resource === undefined) return false
  await stopResourceTree(resource)
  return true
}

/** POSIX: the child leads a process group of its own, killed as one. */
export const posixProcessTree: PluginProcessTree = {
  spawn: (command, args, options) => {
    const child = spawnGuarded(command, [...args], {
      env: options.env,
      cwd: options.cwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    options.resource?.register({ pid: child.pid, group: true })
    child.once('exit', (code) => {
      if (code !== 0) options.resource?.failed?.()
      options.resource?.complete(false)
    })
    child.once('error', () => {
      options.resource?.failed?.()
      options.resource?.complete(child.pid === undefined)
    })
    const handle = nodeChildHandle(child)
    if (options.resource !== undefined) resources.set(handle, options.resource)
    return Promise.resolve(handle)
  },
  killTree: async (child) => {
    if ((await didStopRegisteredPlugin(child)) || child.pid === undefined) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The group is gone already: nothing left to bound.
    }
  },
}

/** Starts a child inside a kill-on-close job: the host's M50 launcher on Windows. */
export type PluginJobLaunch = (
  command: string,
  args: readonly string[],
  options: PluginSpawnOptions,
) => ChildProcess

/**
Children started through a job launcher. Ending the launcher closes the
job's only handle, so kill-on-close ends the runtime and everything it
started; the launcher also returns, closing the job, when the child exits.
*/
export function jobProcessTree(launch: PluginJobLaunch): PluginProcessTree {
  const launchers = new WeakMap<PluginChildHandle, ChildProcess>()
  return {
    spawn: (command, args, options) => {
      const launcher = launch(command, args, options)
      const handle = nodeChildHandle(launcher)
      launchers.set(handle, launcher)
      if (options.resource !== undefined) resources.set(handle, options.resource)
      return Promise.resolve(handle)
    },
    killTree: async (child) => {
      if (await didStopRegisteredPlugin(child)) return
      try {
        launchers.get(child)?.kill()
      } catch {
        // Already gone: its job closed with it.
      }
    },
  }
}

/** What the host offers plugin children: a process group, a job, or why neither. */
export type PluginContainment =
  | { readonly kind: 'processGroup' }
  | { readonly kind: 'job'; readonly launch: PluginJobLaunch }
  /** `notice` is in the user's language: the hook fails by its fail-closed rule and says so. */
  | { readonly kind: 'unavailable'; readonly notice: string }

/** The tree for a containment, or its notice when there is none. */
export function containedTree(containment: PluginContainment): PluginProcessTree | string {
  switch (containment.kind) {
    case 'processGroup': {
      return posixProcessTree
    }
    case 'job': {
      return jobProcessTree(containment.launch)
    }
    case 'unavailable': {
      return containment.notice
    }
  }
}

const ANSWER_SCHEMA = z.strictObject({
  status: z.enum(['completed', 'blocked', 'failed']),
  reason: z.optional(z.string()),
  context: z.optional(z.string()),
  systemMessage: z.optional(z.string()),
  permissionDecision: z.optional(z.enum(['deny', 'ask', 'allow'])),
  approvalDecision: z.optional(z.enum(['allow', 'deny'])),
  updatedInput: z.optional(z.record(z.string(), z.unknown())),
  stopReason: z.optional(z.string()),
  replacement: z.optional(
    z.strictObject({
      target: z.literal('toolResult'),
      value: z.union([z.string(), z.record(z.string(), z.unknown())]),
    }),
  ),
})

const FRAME_SCHEMA = z.union([
  z.strictObject({
    ok: z.literal(true),
    answer: ANSWER_SCHEMA,
    refused: z.optional(z.array(z.string())),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
])

/**
Registrations the mapping refuses (PLAN.md M91, the lane X tables), each
with its fixed reason. The child reports names; only these reach the log.
*/
const REFUSED_REGISTRATIONS: Readonly<Record<PluginSystem, Readonly<Record<string, string>>>> = {
  amp: { 'changes.prompt': 'there is no Ship or Push workflow here' },
  opencode: {
    'chat.params': 'it chooses model parameters',
    'chat.headers': 'it chooses request headers',
    'experimental.provider.small_model': 'it chooses a model',
    'tool.definition': 'it changes the tool list',
    'experimental.chat.messages.transform': 'it rewrites earlier request bytes',
    'experimental.chat.system.transform': 'it rewrites earlier request bytes',
    'experimental.compaction.autocontinue': 'there is no auto-continue control here',
    'experimental.text.complete': 'there is no display rewrite here',
    'shell.env': 'environment edits are a secret risk',
    config: 'it is a registration, not a hook point',
    tool: 'it is a registration, not a hook point',
    auth: 'it is a registration, not a hook point',
    provider: 'it is a registration, not a hook point',
    dispose: 'it is a registration, not a hook point',
  },
}

function noteRefused(call: PluginCall, names: readonly string[], deps: PluginRunDeps): void {
  const known = REFUSED_REGISTRATIONS[call.system]
  let unknown = 0
  const distinct = new Set(names)
  for (const name of distinct) {
    const reason = Object.hasOwn(known, name) ? known[name] : undefined
    if (reason === undefined) {
      unknown += 1
    } else {
      deps.warn?.(`${call.system}: the plugin's ${name} is refused: ${reason}`)
    }
  }
  if (unknown > 0) {
    deps.warn?.(`${call.system}: ${String(unknown)} unknown plugin hook(s) refused`)
  }
}

/**
A plugin answer can only refuse, narrow or add context: every allow
grant is dropped (an allow becomes a plain completed), and tool
narrowing the plugin was never offered is dropped. Runs on every answer,
including the child's, so a compromised child cannot widen a decision.
*/
export function sanitizePluginAnswer(answer: ForeignHookAnswer): ForeignHookAnswer {
  const { allowedToolNames: _dropped, ...offered } = answer
  const parsed = ANSWER_SCHEMA.safeParse(offered)
  if (!parsed.success) return { status: 'failed', reason: 'plugin returned an invalid answer' }
  const { approvalDecision, permissionDecision, ...rest } = parsed.data
  return {
    ...rest,
    ...(approvalDecision === 'deny' && { approvalDecision: 'deny' as const }),
    ...((permissionDecision === 'deny' || permissionDecision === 'ask') && { permissionDecision }),
  }
}

/** System errors that mean the OS refused the child's start (a missing or unusable runtime path). */
const PLUGIN_SPAWN_START_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ENOTDIR',
  'ENAMETOOLONG',
])

/** Whether the OS refused the child's start, with its refusal code. */
function isSpawnStartRefusal(error: unknown): error is Error & { readonly code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    PLUGIN_SPAWN_START_CODES.has(error.code)
  )
}

/** The call's fail-closed rule over any failure: a transport fault or a failed answer. */
function settled(call: PluginCall, answer: ForeignHookAnswer): ForeignHookAnswer {
  if (answer.status !== 'failed') return answer
  const reason = answer.reason ?? `${call.system}: the plugin failed`
  return { status: call.failClosed ? 'blocked' : 'failed', reason }
}

function transportFailure(call: PluginCall, detail: string): ForeignHookAnswer {
  return { status: 'failed', reason: `${call.system}: ${detail}` }
}

/** The response frame, by its closed schema; anything else is a failure. */
function readFrame(call: PluginCall, text: string, deps: PluginRunDeps): ForeignHookAnswer {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return transportFailure(call, 'the plugin child answered outside its frame')
  }
  const frame = FRAME_SCHEMA.safeParse(value)
  if (!frame.success) return transportFailure(call, 'the plugin child sent an invalid answer')
  if (!frame.data.ok) return transportFailure(call, frame.data.error)
  if (frame.data.refused !== undefined) noteRefused(call, frame.data.refused, deps)
  return frame.data.answer
}

const NEWLINE = 0x0a

/** A tree's end, which must never throw out of an event listener. */
function endTree(tree: PluginProcessTree, child: PluginChildHandle): void {
  try {
    void Promise.resolve(tree.killTree(child)).catch(() => {
      // A refused registered stop retains unknown occupancy; the bounded hook still settles.
    })
  } catch {
    // The tree's own fault: the call still settles.
  }
}

function treeFor(deps: PluginRunDeps, platform: NodeJS.Platform): PluginProcessTree | undefined {
  if (deps.processTree !== undefined) return deps.processTree
  return platform === 'win32' ? undefined : posixProcessTree
}

/**
One plugin hook call in one child. The child's tree is always ended: on
its answer line, on timeout, on crash, and by PluginSession.dispose for
stragglers.
*/
async function runInScope(
  call: PluginCall,
  deps: PluginRunDeps,
  scope: RunScope | undefined,
): Promise<ForeignHookAnswer> {
  const platform = deps.platform ?? process.platform
  const closed = (): ForeignHookAnswer => ({
    status: 'failed',
    reason: `${call.system}: the session is closed`,
  })
  if (scope?.isClosed() === true) return closed()
  const tree = treeFor(deps, platform)
  if (tree === undefined) {
    return settled(
      call,
      transportFailure(call, 'plugin children run only in a job object, which is unavailable here'),
    )
  }
  const runtime = await resolvePluginRuntime(call.system, deps, scope?.signal)
  if (scope?.isClosed() === true) return closed()
  if (!runtime.ok) return settled(call, transportFailure(call, runtime.reason))
  const source = deps.childSource ?? pluginChildSource()
  const resource = await admitResource('hook', scope?.signal)
  if (scope?.isClosed() === true) {
    resource?.complete(true)
    return closed()
  }
  let child: PluginChildHandle
  try {
    // The child runs an absolute runtime, never a workspace file, with the
    // guarded child PATH for the workspace (links followed), so nothing it
    // starts by bare name resolves to a program planted there.
    const pluginDir = path.dirname(call.pluginPath)
    child = await tree.spawn(runtime.command, [...runtime.args, source], {
      env: resourceEnvironment(
        withoutCredentials(
          workspaceChildEnvironment(platform, deps.env, {
            workspaceRoot: deps.workspaceRoot,
            realpath: deps.realpath,
          }),
        ),
        resource,
      ),
      cwd: pluginDir,
      ...(resource !== undefined && { resource }),
    })
  } catch (error: unknown) {
    resource?.complete(true)
    // A start the OS refuses settles the call failed naming the refusal; an
    // unexpected failure keeps its kind.
    if (isSpawnStartRefusal(error))
      return settled(
        call,
        transportFailure(call, `the plugin child could not start (${error.code})`),
      )
    throw error
  }
  if (scope?.isClosed() === true) {
    endTree(tree, child)
    return closed()
  }
  // D121: no deadline of ours — the call waits for the child's answer
  // line, an explicit per-hook timeout, the person's own plugin wait, or
  // Stop; without a bound the answer arrives whole, whatever its size.
  // Every wait says how long it has waited while it lasts, and every end
  // names the wait it kept.
  return await new Promise<ForeignHookAnswer>((resolve) => {
    scope?.owned.add(child)
    const startedAt = Date.now()
    const waitedText = (): string =>
      formatUnit(
        Math.max(0, Math.round((Date.now() - startedAt) / MILLISECONDS_PER_SECOND)),
        'second',
      )
    const onAbort = (): void => {
      finish(transportFailure(call, `the plugin call was cancelled after ${waitedText()}`))
    }
    // A call its session ended while it waited: the session is gone, and
    // the answer names the wait Stop kept.
    const closedAfterWait = (): ForeignHookAnswer => ({
      status: 'failed',
      reason: `${call.system}: the session is closed after ${waitedText()}`,
    })
    let isDone = false
    const chunks: Buffer[] = []
    let bytes = 0
    // An explicit per-hook timeout wins; otherwise the person's own plugin
    // wait bounds the call. The bound names the wait it kept, as a wait
    // with no bound names Stop's wait.
    const bounds = pluginCallBounds(deps.bounds?.() ?? {})
    const timeoutMs = call.timeoutMs ?? bounds.timeoutMs
    const finish = (answer: ForeignHookAnswer): void => {
      if (isDone) return
      isDone = true
      scope?.owned.delete(child)
      scope?.signal?.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
      stopNoticing()
      endTree(tree, child)
      // A call its session ended answers nothing stale: the session is
      // gone, and the answer names the wait Stop kept.
      resolve(
        scope?.isClosed() === true
          ? closedAfterWait()
          : settled(call, sanitizePluginAnswer(answer)),
      )
    }
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => {
              finish(
                transportFailure(
                  call,
                  `the plugin child timed out after ${formatUnit(Math.max(1, Math.round(timeoutMs / MILLISECONDS_PER_SECOND)), 'second')}`,
                ),
              )
            },
            Math.max(timeoutMs, 1),
          )
    // Do not let a straggler keep the host alive.
    timer?.unref()
    // The wait says how long it has waited, as Model API requests do.
    const stopNoticing = startStillWaiting((elapsedMs) => {
      deps.notice?.(stillWaitingText({ key: 'pluginHook' }, elapsedMs))
    }, deps.noticeMs ?? STILL_WAITING_NOTICE_MS)
    scope?.signal?.addEventListener('abort', onAbort, { once: true })
    child.onError(() => {
      finish(transportFailure(call, 'the plugin child crashed'))
    })
    child.onStdout((chunk) => {
      if (isDone) return
      const end = chunk.indexOf(NEWLINE)
      const part = end === -1 ? chunk : chunk.subarray(0, end)
      bytes += part.byteLength
      if (bounds.maxAnswerBytes !== undefined && bytes > bounds.maxAnswerBytes) {
        finish(transportFailure(call, 'the plugin answer exceeded its frame'))
        return
      }
      chunks.push(part)
      if (end !== -1) finish(readFrame(call, Buffer.concat(chunks).toString('utf8'), deps))
    })
    child.onClose(() => {
      if (isDone) return
      const text = Buffer.concat(chunks).toString('utf8').trim()
      finish(
        text === ''
          ? transportFailure(call, 'the plugin child exited without answering')
          : readFrame(call, text, deps),
      )
    })
    try {
      child.write(
        `${JSON.stringify({
          system: call.system,
          plugin: call.pluginPath,
          hook: call.hook,
          payload: call.payload,
        })}\n`,
      )
    } catch {
      finish(transportFailure(call, 'the plugin child could not take its request'))
    }
  })
}

/** One plugin hook call outside any session.
@unwired M91b one plugin hook call outside any session
*/
export async function runPluginHook(
  call: PluginCall,
  deps: PluginRunDeps,
): Promise<ForeignHookAnswer> {
  return await runInScope(call, deps, undefined)
}

/** One session's plugin children: dispose ends every live child's tree. */
export class PluginSession {
  private readonly resourceStop = new AbortController()
  private readonly owned = new Set<PluginChildHandle>()
  private isDisposed = false

  public constructor(private readonly deps: PluginRunDeps) {}

  /**
  Run one hook call; refused when the session is closed, at any await.
  A stopped turn (`signal`) ends the child and answers nothing.
  */
  public async run(call: PluginCall, signal?: AbortSignal): Promise<ForeignHookAnswer> {
    const stop =
      signal === undefined
        ? this.resourceStop.signal
        : AbortSignal.any([signal, this.resourceStop.signal])
    return await runInScope(call, this.deps, {
      owned: this.owned,
      isClosed: () => this.isDisposed || signal?.aborted === true,
      signal: stop,
    })
  }

  /** End every live child's tree; later calls are refused. */
  public dispose(): void {
    this.isDisposed = true
    this.resourceStop.abort()
    const tree = treeFor(this.deps, this.deps.platform ?? process.platform)
    if (tree !== undefined) for (const child of this.owned) endTree(tree, child)
    this.owned.clear()
  }
}
