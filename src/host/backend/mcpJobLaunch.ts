// Windows MCP stdio launcher (M50): the configured server inherits Node's
// binary pipe handles directly. The compiled C# executable creates the server
// suspended, assigns its no-breakaway kill-on-close job, and only then resumes
// it. It holds an actual handle to
// this extension process; when either it or the server exits, the job closes.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import * as z from 'zod/mini'
import { environmentValue, setEnvironmentVariable } from '../../core/backends/musecode/launch'
import { redactSecrets } from '../../core/redact'
import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
import { stopResourceTree } from '../../core/resources/admission'
import {
  MCP_JOB_CONFIG_VARIABLE,
  MCP_JOB_HANDSHAKE_MAX_CHARS,
  MCP_JOB_NONCE_BYTES,
  RESOURCE_JOB_RECORD_MAX_CHARS,
  RESOURCE_JOB_RECORD_WAIT_MS,
} from '../../shared/constants'
import { resourceProcessIdentitySchema, type ResourceProcessIdentity } from '../../shared/resources'

/** SPAWN017C: the limits an attested job enforces itself, in process. */
export interface JobAttestationLimits {
  readonly activeProcessLimit: number
  readonly spawnLimit: number
  readonly spawnWindowMs: number
  readonly sampleMs: number
  readonly emptyTimeoutMs: number
}

const count = z.number().check(z.int(), z.nonnegative())
/** The helper's one final record, sent after the job was ended and drained. */
const jobRecordSchema = z.strictObject({
  v: z.literal(1),
  ending: z.enum(['exit', 'stopped', 'owner', 'spawnRate']),
  exitCode: z.number().check(z.int()),
  emptied: z.boolean(),
  cpuMs: count,
  peakJobMemoryBytes: count,
  totalProcesses: count,
  activeProcessLimit: count,
})
export type JobRecord = z.infer<typeof jobRecordSchema>

export interface AttestedJobControl {
  /** The payload root, reported by the helper before it resumed it. */
  readonly root: Promise<ResourceProcessIdentity | undefined>
  /** The final record; undefined when none valid arrived (usage uncertain, never refused). */
  readonly record: Promise<JobRecord | undefined>
  /** Ask the helper to end and drain the whole job; it then reports and exits. */
  stop: () => void
}

/** The kept control pipe after GO: PID and RESULT in, STOP out. Anything else ends it. */
function attestedChannel() {
  // Each answer settles once: the first event wins, later ones find no listener.
  const answers = new EventTarget()
  // A CustomEvent carries an absent answer as null; both mean "never arrived".
  const root = (async () => {
    const events: unknown = await once(answers, 'root')
    const [event] = z
      .tuple([z.object({ detail: z.nullable(resourceProcessIdentitySchema) })])
      .parse(events)
    return event.detail ?? undefined
  })()
  const record = (async () => {
    const events: unknown = await once(answers, 'record')
    const [event] = z.tuple([z.object({ detail: z.nullable(jobRecordSchema) })]).parse(events)
    return event.detail ?? undefined
  })()
  const answer = (name: 'root' | 'record', detail: unknown): void => {
    answers.dispatchEvent(new CustomEvent(name, { detail: detail ?? null }))
  }
  let socket: Socket | undefined
  let pending = ''
  let isStopRequested = false
  const settle = () => {
    answer('root', undefined)
    answer('record', undefined)
  }
  const isAccepted = (text: string): boolean => {
    const pid = /^PID (\d+) (\d+)$/u.exec(text)
    if (pid?.[1] !== undefined && pid[2] !== undefined) {
      const parsed = resourceProcessIdentitySchema.safeParse({
        pid: Number(pid[1]),
        startTime: pid[2],
      })
      if (parsed.success) answer('root', parsed.data)
      return parsed.success
    }
    if (!text.startsWith('RESULT ')) return false
    try {
      const parsed = jobRecordSchema.safeParse(JSON.parse(text.slice('RESULT '.length)))
      if (parsed.success) answer('record', parsed.data)
      return parsed.success
    } catch {
      return false
    }
  }
  return {
    control: {
      root,
      record,
      stop: () => {
        isStopRequested = true
        if (socket?.writable === true) socket.write('STOP\n')
      },
    } satisfies AttestedJobControl,
    bind: (bound: Socket) => {
      socket = bound
      bound.unref()
      bound.on('close', settle)
      if (isStopRequested) bound.write('STOP\n')
    },
    receive: (bytes: Buffer) => {
      pending += bytes.toString('utf8')
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
        const text = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!isAccepted(text)) {
          // A protocol violation: the helper reads EOF as STOP and ends the job.
          socket?.destroy()
          return
        }
      }
      if (pending.length > RESOURCE_JOB_RECORD_MAX_CHARS) socket?.destroy()
    },
    /** After the helper exits, a record still absent is never awaited forever. */
    expire: () => {
      setTimeout(settle, RESOURCE_JOB_RECORD_WAIT_MS).unref()
    },
  }
}

export interface McpJobLaunch {
  /** Only the pinned browser uses the fixed additional CDP pipe pair. */
  readonly debugPipes?: boolean | undefined
  readonly resource?: ResourceLease | undefined
  readonly resourceAssembly?: string | undefined
  readonly executablePath: string
  readonly file: string
  readonly args: readonly string[]
  readonly isVerbatim: boolean
  readonly cwd: string
  /** Only the allowlisted and explicitly configured variables reach the server. */
  readonly env: NodeJS.ProcessEnv
  readonly log: (message: string) => void
  /** The whole job's memory in bytes (M91b, plugin children); absent sets no limit. */
  readonly jobMemoryLimit?: number | undefined
  /** SPAWN017C portable launches: an unnamed job that attests its own tree. */
  readonly attestation?: JobAttestationLimits | undefined
}

/** The SDK and our process adapters share the same suspended native launch boundary. */
export function prepareMcpJobLaunch(launch: McpJobLaunch) {
  const controlPipe = `muse-spark-mcp-${randomUUID()}`
  const controlNonce = randomBytes(MCP_JOB_NONCE_BYTES).toString('hex')
  const attested = launch.attestation === undefined ? undefined : attestedChannel()
  let isClosed = false
  let stop: (() => void) | undefined
  const control = createServer((socket) => {
    let request = ''
    let isAuthorized = false
    socket.on('error', (error) => {
      launch.log(`the MCP job control pipe closed: ${redactSecrets(error.message)}`)
    })
    socket.on('data', (bytes: Buffer) => {
      if (isAuthorized) {
        attested?.receive(bytes)
        return
      }
      request += bytes.toString('utf8')
      if (request.length > MCP_JOB_HANDSHAKE_MAX_CHARS) {
        socket.destroy()
        return
      }
      const end = request.indexOf('\n')
      if (end === -1) {
        return
      }
      if (request.slice(0, end) !== `READY ${controlNonce}`) {
        socket.destroy()
        return
      }
      isAuthorized = true
      if (attested === undefined) socket.end(`GO ${controlNonce}\n`)
      else {
        socket.write(`GO ${controlNonce}\n`)
        attested.bind(socket)
      }
      closeControl()
    })
  })
  const closeControl = () => {
    isClosed = true
    if (control.listening) control.close()
  }
  control.maxConnections = 1
  control.on('listening', () => {
    if (isClosed) control.close()
  })
  control.on('error', (error) => {
    launch.log(`the MCP job control pipe could not listen: ${redactSecrets(error.message)}`)
    stop?.()
  })
  control.listen(`\\\\.\\pipe\\${controlPipe}`)
  control.unref()
  const payload = Buffer.from(
    JSON.stringify({
      file: launch.file,
      args: [...launch.args],
      cwd: launch.cwd,
      env: resourceEnvironment(launch.env, launch.resource),
      parentPid: process.pid,
      isVerbatim: launch.isVerbatim,
      controlPipe,
      controlNonce,
      ...(launch.jobMemoryLimit !== undefined && { jobMemoryLimit: launch.jobMemoryLimit }),
      ...(launch.debugPipes === true && { debugPipes: true }),
      ...(launch.attestation !== undefined && { attestation: launch.attestation }),
    }),
    'utf8',
  ).toString('base64')
  const helperEnv = resourceEnvironment(launch.env, launch.resource)
  // The CLR launcher needs its system directory even when the payload has
  // an empty environment. The payload's environment above remains separate.
  const systemRoot = environmentValue(process.env, 'win32', 'SystemRoot')
  if (systemRoot !== undefined && environmentValue(helperEnv, 'win32', 'SystemRoot') === undefined)
    setEnvironmentVariable(helperEnv, 'win32', 'SystemRoot', systemRoot)
  setEnvironmentVariable(helperEnv, 'win32', MCP_JOB_CONFIG_VARIABLE, payload)
  return {
    env: helperEnv,
    attested,
    closeControl,
    stopWith: (action: () => void) => {
      stop = action
    },
    register: () => {
      launch.resource?.register({
        job:
          launch.resourceAssembly === undefined
            ? undefined
            : {
                name: `Local\\${controlPipe}`,
                assemblyPath: launch.resourceAssembly,
              },
      })
    },
  }
}

/** The raw pipes belong to this ChildProcess; no text relay touches MCP frames. */
export function spawnMcpJob(launch: McpJobLaunch): ChildProcessWithoutNullStreams {
  const prepared = prepareMcpJobLaunch(launch)
  try {
    const child = spawn(
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- this executable is compiled from the packaged native/windows/MuseSparkMcpLauncher.cs and MuseSparkMcpJob.cs into a digest-named file in extension storage; configured MCP input stays in a private environment value (PLAN.md §8).
      launch.executablePath,
      [],
      {
        cwd: launch.cwd,
        env: prepared.env,
        stdio:
          launch.debugPipes === true
            ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe']
            : ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    prepared.stopWith(() => {
      if (launch.resource === undefined) child.kill()
      else
        void stopResourceTree(launch.resource).catch(() => {
          launch.log('the registered MCP tree could not be stopped')
        })
    })
    child.once('exit', prepared.closeControl)
    child.once('error', prepared.closeControl)
    prepared.register()
    child.once('exit', (code) => {
      if (code !== 0) launch.resource?.failed?.()
      launch.resource?.complete(false)
    })
    child.once('error', () => {
      launch.resource?.failed?.()
      launch.resource?.complete(child.pid === undefined)
    })
    return child
  } catch (error: unknown) {
    launch.resource?.failed?.()
    launch.resource?.complete(true)
    prepared.closeControl()
    throw error
  }
}

/**
 * SPAWN017C: a portable contained or probe launch. The helper's observed exit
 * proves the tree gone (it ended and drained the job, or the kernel ended it
 * when the helper's only handle closed); its record carries the final usage.
 * The caller registers and completes the lease.
 */
export function spawnAttestedJob(
  launch: McpJobLaunch & { readonly attestation: JobAttestationLimits },
): { child: ChildProcessWithoutNullStreams; control: AttestedJobControl } {
  const prepared = prepareMcpJobLaunch(launch)
  const attested = prepared.attested
  if (attested === undefined) throw new Error('Attested job channel unavailable')
  try {
    const child = spawn(
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the same digest-named launcher compiled from the packaged native/windows sources; launch input stays in a private environment value (PLAN.md §8, SPAWN017C).
      launch.executablePath,
      [],
      { cwd: launch.cwd, env: prepared.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    child.once('exit', () => {
      prepared.closeControl()
      attested.expire()
    })
    child.once('error', () => {
      prepared.closeControl()
      attested.expire()
    })
    return { child, control: attested.control }
  } catch (error: unknown) {
    prepared.closeControl()
    throw error
  }
}
