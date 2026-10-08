// Windows MCP stdio launcher (M50): the configured server inherits Node's
// binary pipe handles directly. The compiled C# executable creates the server
// suspended, assigns its no-breakaway kill-on-close job, and only then resumes
// it. It holds an actual handle to
// this extension process; when either it or the server exits, the job closes.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { environmentValue, setEnvironmentVariable } from '../../core/backends/musecode/launch'
import { redactSecrets } from '../../core/redact'
import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
import { stopResourceTree } from '../../core/resources/admission'
import {
  MCP_JOB_CONFIG_VARIABLE,
  MCP_JOB_HANDSHAKE_MAX_CHARS,
  MCP_JOB_NONCE_BYTES,
} from '../../shared/constants'

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
}

/** The SDK and our process adapters share the same suspended native launch boundary. */
export function prepareMcpJobLaunch(launch: McpJobLaunch) {
  const controlPipe = `muse-spark-mcp-${randomUUID()}`
  const controlNonce = randomBytes(MCP_JOB_NONCE_BYTES).toString('hex')
  let isClosed = false
  let stop: (() => void) | undefined
  const control = createServer((socket) => {
    let request = ''
    let isAuthorized = false
    socket.on('error', (error) => {
      launch.log(`the MCP job control pipe closed: ${redactSecrets(error.message)}`)
    })
    socket.on('data', (bytes: Buffer) => {
      if (isAuthorized) return
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
      socket.end(`GO ${controlNonce}\n`)
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
