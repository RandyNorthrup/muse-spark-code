// Windows MCP stdio launcher (M50): the configured server inherits Node's
// binary pipe handles directly. The compiled C# executable creates the server
// suspended, assigns its no-breakaway kill-on-close job, and only then resumes
// it. It holds an actual handle to
// this extension process; when either it or the server exits, the job closes.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setEnvironmentVariable } from '../../core/backends/musecode/launch'
import { redactSecrets } from '../../core/redact'
import {
  MCP_JOB_CONFIG_VARIABLE,
  MCP_JOB_HANDSHAKE_MAX_CHARS,
  MCP_JOB_NONCE_BYTES,
} from '../../shared/constants'

export interface McpJobLaunch {
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

/** The raw pipes belong to this ChildProcess; no text relay touches MCP frames. */
export function spawnMcpJob(launch: McpJobLaunch): ChildProcessWithoutNullStreams {
  const controlPipe = `muse-spark-mcp-${randomUUID()}`
  const controlNonce = randomBytes(MCP_JOB_NONCE_BYTES).toString('hex')
  let isClosed = false
  let child: ChildProcessWithoutNullStreams | undefined
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
    child?.kill()
  })
  control.listen(`\\\\.\\pipe\\${controlPipe}`)
  control.unref()
  const payload = Buffer.from(
    JSON.stringify({
      file: launch.file,
      args: [...launch.args],
      cwd: launch.cwd,
      env: launch.env,
      parentPid: process.pid,
      isVerbatim: launch.isVerbatim,
      controlPipe,
      controlNonce,
      ...(launch.jobMemoryLimit !== undefined && { jobMemoryLimit: launch.jobMemoryLimit }),
    }),
    'utf8',
  ).toString('base64')
  const helperEnv = { ...launch.env }
  setEnvironmentVariable(helperEnv, 'win32', MCP_JOB_CONFIG_VARIABLE, payload)
  try {
    child = spawn(
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- this executable is compiled from the packaged native/windows/MuseSparkMcpLauncher.cs and MuseSparkMcpJob.cs into a digest-named file in extension storage; configured MCP input stays in a private environment value (PLAN.md §8).
      launch.executablePath,
      [],
      {
        cwd: launch.cwd,
        env: helperEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    child.once('exit', closeControl)
    child.once('error', closeControl)
    return child
  } catch (error: unknown) {
    closeControl()
    throw error
  }
}
