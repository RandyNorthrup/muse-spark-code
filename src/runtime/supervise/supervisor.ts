// `muse-spark-code-acp supervise <command>` (M104 lane H, PLAN.md D84): the
// runtime command runs as a child this process owns whole, so a stop that
// never enters the command's own request queue ends all of it. The run is a
// governed launch like any other (RLF-GOVFORK): admitted, registered,
// tree-owned and completed. On Windows the child runs contained in an
// attested kill-on-close job: the helper ends every process in it, proves
// the drain, and enforces fork protection. On POSIX the child leads its
// own process group (no temp root: it is a full runtime that governs its
// own launches): a stop sends SIGTERM to the group (the runtime then stops
// what it governs), and SIGKILL to what remains after the grace. A stop
// arrives from this process's own signals or from `stop`, through a
// private endpoint (a named pipe, or a socket in the owner-only folder)
// that answers only a request carrying the run's token.
import { realpathSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { constants as osConstants } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { isErrno } from '../../core/fs/errno'
import { failureForLog } from '../../core/backends/musecode/logText'
import { workspaceChildEnvironment } from '../../core/execGuard'
import type { GuardedChildEnv } from '../../core/executables'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { admitResource } from '../../core/resources/admission'
import {
  resourceEnvironment,
  ResourceUnavailableError,
  type ResourceForkStop,
  type ResourceLease,
  type ResourcePipedProcess,
} from '../../core/resources/launch'
import { spawnResourceProcess } from '../../core/resources/launcher'
import type { Logger } from '../../host/logger'
import { treeSpawnOptions } from '../../host/processTree'
import {
  POSIX_TREE_EXIT_POLL_MS,
  POSIX_TREE_EXIT_WAIT_MS,
  RESOURCE_TREE_PROCESS_CAP,
  RESOURCE_TREE_SPAWN_CAP,
  SIGNAL_EXIT_BASE,
  SUPERVISE_ENDPOINT_NAME_BYTES,
  SUPERVISE_MESSAGE_MAX_BYTES,
  SUPERVISE_REPLY,
  SUPERVISE_SOCKET_PATH_MAX_BYTES,
  SUPERVISED_OWNER_VARIABLE,
  TREE_EXIT_WAIT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import {
  isTokenMatching,
  newToken,
  recordFile,
  removeRecord,
  writeRecord,
  type SupervisedRecord,
} from './records'

export interface SuperviseDeps {
  /** The runtime command to run, as it would be typed after the executable. */
  readonly args: readonly string[]
  /** This runtime's entry (dist/acp.js), run again by Node as the child. */
  readonly entry: string
  /** The folder the run starts in: `stop` there stops it. */
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  /** The verified owner-only folder the records live in. */
  readonly root: string
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly log: Logger
}

/** A stop endpoint the platform cannot hold: a socket path past `sun_path`. */
export class SuperviseEndpointError extends Error {
  readonly code = 'ESUPERVISE_ENDPOINT'
  constructor() {
    super('ESUPERVISE_ENDPOINT')
    this.name = 'SuperviseEndpointError'
  }
}

function endpointFor(root: string, ownerId: string): string {
  if (process.platform === 'win32') return String.raw`\\.\pipe\muse-spark-supervised-${ownerId}`
  const socket = path.join(root, `${randomBytes(SUPERVISE_ENDPOINT_NAME_BYTES).toString('hex')}.s`)
  if (Buffer.byteLength(socket) > SUPERVISE_SOCKET_PATH_MAX_BYTES)
    throw new SuperviseEndpointError()
  return socket
}

/** Whether no process remains in the POSIX group. */
function isGroupGone(group: number): boolean {
  try {
    process.kill(-group, 0)
    return false
  } catch (error: unknown) {
    // ESRCH: no member left. EPERM: a member exists we may not signal.
    if (isErrno(error) && error.code === 'ESRCH') return true
    if (isErrno(error) && error.code === 'EPERM') return false
    throw error
  }
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal)
  } catch (error: unknown) {
    // The group already emptied.
    if (!(isErrno(error) && error.code === 'ESRCH')) throw error
  }
}

async function isGroupGoneWithin(group: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (!isGroupGone(group)) {
    if (Date.now() >= deadline) return false
    await delay(POSIX_TREE_EXIT_POLL_MS)
  }
  return true
}

interface SupervisedChild {
  readonly child: ResourcePipedProcess['child']
  /** Ends the whole tree; true when its end proves it gone. */
  readonly stopTree: () => Promise<boolean>
  /** Fork-protection words for the person, read once the child has ended. */
  readonly forkWords: () => Promise<readonly string[]>
}

/** What the person is told when fork protection touched their run. */
function forkWordsFor(
  forkStop: ResourceForkStop | undefined,
  capRefusals: number,
): readonly string[] {
  const words: string[] = []
  if (forkStop === 'activeProcess')
    words.push(
      fill(UI_TEXT.supervision.forkStoppedProcesses, {
        bound: formatNumber(RESOURCE_TREE_PROCESS_CAP),
      }),
    )
  else if (forkStop === 'spawnRate')
    words.push(
      fill(UI_TEXT.supervision.forkStoppedSpawns, {
        bound: formatNumber(RESOURCE_TREE_SPAWN_CAP),
      }),
    )
  if (capRefusals > 0) words.push(plural(UI_TEXT.supervision.childrenRefused, capRefusals))
  return words
}

/** Windows: the run contained in an attested job, through the one governed launch. */
async function launchGoverned(
  deps: SuperviseDeps,
  env: GuardedChildEnv,
  args: readonly string[],
  signal: AbortSignal,
): Promise<SupervisedChild> {
  const launched = await spawnResourceProcess('contained', process.execPath, args, {
    env,
    cwd: deps.cwd,
    signal,
  })
  return {
    child: launched.child,
    stopTree: async () => {
      await launched.stop()
      const outcome = await launched.outcome()
      return outcome?.isRetirementProved ?? false
    },
    forkWords: async () => {
      const outcome = await launched.outcome()
      return outcome === undefined ? [] : forkWordsFor(outcome.forkStop, outcome.capRefusals)
    },
  }
}

/**
POSIX: the run admitted and registered with the governor, leading its own
group. No temp root: the child is a full runtime that governs its own
launches' temp. Linux binds the group for fork protection; macOS registers
occupancy only, as do all other macOS launches.
*/
async function launchRegistered(
  deps: SuperviseDeps,
  env: GuardedChildEnv,
  args: readonly string[],
  signal: AbortSignal,
): Promise<SupervisedChild> {
  const resource: ResourceLease | undefined = await admitResource(
    'other',
    signal,
    undefined,
    undefined,
    undefined,
    true,
  )
  // A supervised run never runs ungoverned: without admission it refuses.
  if (resource === undefined) throw new ResourceUnavailableError('admissionUnavailable')
  let child: ChildProcessWithoutNullStreams
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- this runtime's own installed entry run again by Node, argument array, no shell, guarded workspace environment, its own process group so a stop ends it whole (M104 lane H).
    child = spawnGuarded(process.execPath, [...args], {
      cwd: deps.cwd,
      env: resourceEnvironment(env, resource),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...treeSpawnOptions(process.platform),
    })
  } catch (error: unknown) {
    resource.failed?.()
    resource.complete(true)
    throw error
  }
  const endGroup = async (): Promise<void> => {
    const group = child.pid
    if (group === undefined) return
    signalGroup(group, 'SIGTERM')
    if (await isGroupGoneWithin(group, TREE_EXIT_WAIT_MS)) return
    signalGroup(group, 'SIGKILL')
    await isGroupGoneWithin(group, POSIX_TREE_EXIT_WAIT_MS)
  }
  resource.register({ pid: child.pid, group: true, stop: endGroup })
  child.once('exit', (code) => {
    if (code !== 0) resource.failed?.()
    const group = child.pid
    if (group === undefined) {
      resource.complete(true)
      return
    }
    try {
      resource.complete(isGroupGone(group))
    } catch (error: unknown) {
      // An unreadable group is unknown, never gone; the tree stays owned.
      deps.log.trace(`Supervised group liveness unreadable: ${failureForLog(error)}`)
      resource.complete(false)
    }
  })
  child.once('error', () => {
    resource.failed?.()
    resource.complete(child.pid === undefined)
  })
  return {
    child,
    stopTree: async () => {
      await endGroup()
      const group = child.pid
      return group === undefined || isGroupGone(group)
    },
    forkWords: () => Promise.resolve(forkWordsFor(resource.stoppedForFork?.(), 0)),
  }
}

/** The child: its whole tree in a job (Windows) or its own group (POSIX). */
async function launch(
  deps: SuperviseDeps,
  ownerId: string,
  signal: AbortSignal,
): Promise<SupervisedChild> {
  const env = workspaceChildEnvironment(
    process.platform,
    { ...deps.env, [SUPERVISED_OWNER_VARIABLE]: ownerId },
    { workspaceRoot: deps.cwd, realpath: realpathSync },
  )
  const args = [deps.entry, ...deps.args]
  return process.platform === 'win32'
    ? await launchGoverned(deps, env, args, signal)
    : await launchRegistered(deps, env, args, signal)
}

/** A child's exit code; one ended by a signal exits 128 plus its number. */
function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  return signal === null ? (code ?? 1) : SIGNAL_EXIT_BASE + osConstants.signals[signal]
}

/** The control endpoint: one line carrying the token asks for the stop; the reply is one word. */
function controlServer(record: SupervisedRecord, isStopped: () => Promise<boolean>): Server {
  const server = createServer((socket: Socket) => {
    let request = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {
      socket.destroy()
    })
    socket.on('data', (chunk: string) => {
      request += chunk
      if (Buffer.byteLength(request) > SUPERVISE_MESSAGE_MAX_BYTES) {
        socket.destroy()
        return
      }
      const end = request.indexOf('\n')
      if (end === -1) return
      if (!isTokenMatching(record, request.slice(0, end))) {
        socket.destroy()
        return
      }
      socket.removeAllListeners('data')
      void isStopped().then((isWhole) => {
        socket.end(`${isWhole ? SUPERVISE_REPLY.stopped : SUPERVISE_REPLY.failed}\n`)
      })
    })
  })
  return server
}

/** Runs the command supervised; resolves with its exit code (0 after a stop). */
export async function superviseRuntime(deps: SuperviseDeps): Promise<number> {
  const ownerId = randomUUID()
  const record: SupervisedRecord = {
    ownerId,
    endpoint: endpointFor(deps.root, ownerId),
    token: newToken(),
  }
  const file = recordFile(deps.root, deps.cwd, ownerId)
  const admission = new AbortController()
  let launching: Promise<SupervisedChild> | undefined
  let stopping: Promise<boolean> | undefined
  const stop = (): Promise<boolean> => {
    stopping ??= (async () => {
      // A stop during admission ends the wait; during the launch it waits
      // for the child, then ends it.
      admission.abort()
      let supervised: SupervisedChild | undefined
      try {
        supervised = await launching
      } catch (error: unknown) {
        // The launch failed: nothing runs, and the run reports that failure.
        deps.log.trace(`Supervised launch failed before its stop: ${failureForLog(error)}`)
        return true
      }
      if (supervised === undefined) return true
      const running = supervised.child
      const isEnded =
        running.pid === undefined || running.exitCode !== null || running.signalCode !== null
      if (isEnded) return true
      const isWhole = await supervised.stopTree()
      return isWhole
    })()
    return stopping
  }
  const server = controlServer(record, stop)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(record.endpoint, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const onSignal = () => {
    void stop()
  }
  try {
    await writeRecord(file, record)
    process.once('SIGTERM', onSignal)
    process.once('SIGINT', onSignal)
    launching = launch(deps, ownerId, admission.signal)
    let supervised: SupervisedChild | undefined
    try {
      supervised = await launching
    } catch (error: unknown) {
      // A stop that landed during admission ends the run as stopped.
      const isStopAbort =
        stopping !== undefined && error instanceof DOMException && error.name === 'AbortError'
      if (!isStopAbort) throw error
    }
    if (supervised === undefined) return Number(!(await stopping))
    const launched = supervised.child
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        launched.once('error', reject)
        launched.once('close', (code, signal) => {
          resolve({ code, signal })
        })
      },
    )
    deps.stdin.pipe(launched.stdin)
    launched.stdin.on('error', () => {
      // The child closed its input first; its exit is reported below.
    })
    launched.stdout.pipe(deps.stdout, { end: false })
    launched.stderr.pipe(deps.stderr, { end: false })
    const { code, signal } = await ended
    deps.stdin.unpipe(launched.stdin)
    const words = await supervised.forkWords()
    for (const line of words) deps.stderr.write(`${line}\n`)
    return stopping === undefined ? exitCodeOf(code, signal) : Number(!(await stopping))
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    await removeRecord(file)
    if (process.platform !== 'win32') await removeRecord(record.endpoint)
    // The child had the input; nothing reads it now, so it holds the process no longer.
    deps.stdin.destroy()
  }
}
