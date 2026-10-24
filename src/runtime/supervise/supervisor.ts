// `muse-spark-code-acp supervise <command>` (M104 lane H, PLAN.md D84): the
// runtime command runs as a child this process owns whole, so a stop that
// never enters the command's own request queue ends all of it. On Windows
// the child runs in a kill-on-close job object (the MCP servers' launcher,
// native/windows/MuseSparkMcpJob.cs): ending the helper ends every process
// in the job, and the helper ends with this process. On POSIX the child
// leads its own process group: a stop sends SIGTERM to the group (the
// runtime then stops what it governs), and SIGKILL to what remains after
// the grace. A stop arrives from this process's own signals or from
// `stop`, through a private endpoint (a named pipe, or a socket in the
// owner-only folder) that answers only a request carrying the run's token.
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
import { spawnGuarded } from '../../core/guardedChildProcess'
import { resourceWindowsJob } from '../../core/resources/admission'
import { ResourceUnavailableError } from '../../core/resources/launch'
import { spawnMcpJob } from '../../host/backend/mcpJobLaunch'
import type { Logger } from '../../host/logger'
import { treeSpawnOptions } from '../../host/processTree'
import {
  POSIX_TREE_EXIT_POLL_MS,
  POSIX_TREE_EXIT_WAIT_MS,
  SIGNAL_EXIT_BASE,
  SUPERVISE_ENDPOINT_NAME_BYTES,
  SUPERVISE_MESSAGE_MAX_BYTES,
  SUPERVISE_REPLY,
  SUPERVISE_SOCKET_PATH_MAX_BYTES,
  SUPERVISED_OWNER_VARIABLE,
  TREE_EXIT_WAIT_MS,
} from '../../shared/constants'
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

/** The child: its whole tree in a job (Windows) or its own group (POSIX). */
async function launch(
  deps: SuperviseDeps,
  ownerId: string,
): Promise<ChildProcessWithoutNullStreams> {
  const env = workspaceChildEnvironment(
    process.platform,
    { ...deps.env, [SUPERVISED_OWNER_VARIABLE]: ownerId },
    { workspaceRoot: deps.cwd, realpath: realpathSync },
  )
  const args = [deps.entry, ...deps.args]
  if (process.platform !== 'win32')
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- this runtime's own installed entry run again by Node, argument array, no shell, guarded workspace environment, its own process group so a stop ends it whole (M104 lane H).
    return spawnGuarded(process.execPath, args, {
      cwd: deps.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...treeSpawnOptions(process.platform),
    })
  const job = await resourceWindowsJob()
  if (job === undefined) throw new ResourceUnavailableError('launchUnavailable')
  await job.verify()
  return spawnMcpJob({
    executablePath: job.executablePath,
    file: process.execPath,
    args,
    isVerbatim: false,
    cwd: deps.cwd,
    env,
    log: (message) => {
      deps.log.trace(message)
    },
  })
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
  let launching: Promise<ChildProcessWithoutNullStreams> | undefined
  let stopping: Promise<boolean> | undefined
  const stop = (): Promise<boolean> => {
    stopping ??= (async () => {
      // A stop during the launch waits for the child, then ends it.
      let running: ChildProcessWithoutNullStreams | undefined
      try {
        running = await launching
      } catch (error: unknown) {
        // The launch failed: nothing runs, and the run reports that failure.
        deps.log.trace(`Supervised launch failed before its stop: ${failureForLog(error)}`)
        return true
      }
      if (running?.pid === undefined || running.exitCode !== null || running.signalCode !== null)
        return true
      const exited = new Promise<void>((resolve) => {
        running.once('exit', () => {
          resolve()
        })
      })
      if (process.platform === 'win32') {
        // Ending the job's helper closes the job: the kernel ends every process in it.
        running.kill()
        await exited
        return true
      }
      const group = running.pid
      signalGroup(group, 'SIGTERM')
      if (await isGroupGoneWithin(group, TREE_EXIT_WAIT_MS)) return true
      signalGroup(group, 'SIGKILL')
      return await isGroupGoneWithin(group, POSIX_TREE_EXIT_WAIT_MS)
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
    launching = launch(deps, ownerId)
    const launched = await launching
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
