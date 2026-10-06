// Independent process supervision: Stop never enters the model/request queue.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import * as z from 'zod/mini'
import { jobSourceReader } from '../../host/backend/jobSource'
import { mcpJobExecutable } from '../../host/backend/mcpJobExecutable'
import { spawnMcpJob } from '../../host/backend/mcpJobLaunch'
import { killTree, sweepExitedTree, treeSpawnOptions } from '../../host/processTree'
import { RUNTIME_STOP } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { withoutCredentials } from '../credentialVariables'

// Private child diagnostics never enter the editor log.
const log = () => {
  /* Native helper diagnostics are private; Stop reports fixed technical failures. */
}

const ownerSchema = z.strictObject({
  pipe: z.string().check(z.maxLength(RUNTIME_STOP.pathChars)),
  token: z
    .string()
    .check(
      z.regex(/^[a-f0-9]+$/u),
      z.minLength(RUNTIME_STOP.tokenBytes * 2),
      z.maxLength(RUNTIME_STOP.tokenBytes * 2),
    ),
})

export interface SupervisorDeps {
  readonly registry: string
  readonly cwd: string
  readonly file: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly packageRoot: string
  readonly stdin: Readable
  readonly stdout: Writable
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Await the group too: a leader's exit does not prove its children died. */
async function groupExited(pid: number | undefined): Promise<void> {
  if (pid === undefined || process.platform === 'win32') return
  const deadline = Date.now() + RUNTIME_STOP.exitMs
  for (;;) {
    try {
      process.kill(-pid, 0)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
      throw error
    }
    if (Date.now() >= deadline) throw new Error('ESTOP_TREE')
    await delay(RUNTIME_STOP.pollMs)
  }
}

/** The supervisor owns pipes and a group/job; the child never owns Stop. */
export async function superviseRuntime(deps: SupervisorDeps): Promise<number> {
  const env = withoutCredentials(deps.env)
  let jobExecutablePath: string | undefined
  if (process.platform === 'win32') {
    const systemRoot = env['SystemRoot']
    if (systemRoot === undefined) throw new Error('ESTOP_JOB')
    jobExecutablePath = await mcpJobExecutable({
      storageDir: deps.registry,
      systemRoot,
      log,
      readJobSource: jobSourceReader(deps.packageRoot),
    })()
    if (jobExecutablePath === undefined) throw new Error('ESTOP_JOB')
  }
  await mkdir(deps.registry, { recursive: true, mode: RUNTIME_STOP.directoryMode })
  await chmod(deps.registry, RUNTIME_STOP.directoryMode)
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-stop-'))
  const token = randomBytes(RUNTIME_STOP.tokenBytes).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\muse-stop-${randomUUID()}`
      : path.join(directory, 'control')
  const record = path.join(deps.registry, `${workspaceKey(deps.cwd)}-${token}.json`)
  let child: ChildProcessWithoutNullStreams | undefined
  let stopping: Promise<void> | undefined
  const ending = new AbortController()
  const closed = new Promise<void>((resolve) => {
    ending.signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  const startedAt = Date.now()
  const treeDeps = { platform: process.platform, systemRoot: env['SystemRoot'], log }
  const stop = () => {
    stopping ??= (async () => {
      if (child === undefined) return
      child.kill('SIGTERM')
      await delay(RUNTIME_STOP.graceMs)
      if (process.platform !== 'win32') {
        if (child.exitCode === null && child.signalCode === null) {
          await killTree(child, treeDeps, startedAt)
        } else {
          await sweepExitedTree(child.pid, startedAt, Date.now(), treeDeps)
        }
      }
      await groupExited(child.pid)
      if (process.platform === 'win32') {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('ESTOP_TREE'))
          }, RUNTIME_STOP.exitMs)
          void closed.then(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      ending.abort()
    })()
    // The main path awaits this failure and preserves a nonzero result.
    void stopping.catch(() => {
      ending.abort()
    })
  }
  const sockets = new Set<ReturnType<typeof createConnection>>()
  const control = createServer((socket) => {
    sockets.add(socket)
    socket.setTimeout(RUNTIME_STOP.exitMs, () => {
      socket.destroy()
    })
    socket.on('error', () => {
      socket.destroy()
    })
    socket.on('close', () => {
      sockets.delete(socket)
    })
    let request = ''
    socket.on('data', (bytes: Buffer) => {
      request += bytes.toString('utf8')
      if (request.length > RUNTIME_STOP.handshakeChars) {
        socket.destroy()
        return
      }
      if (!request.endsWith('\n')) return
      if (request !== `${token}\n`) {
        socket.destroy()
        return
      }
      stop()
      void stopping?.then(
        () => {
          socket.end('STOPPED\n')
        },
        () => {
          socket.end('ESTOP_TREE\n')
        },
      )
    })
  })
  control.maxConnections = RUNTIME_STOP.connections
  try {
    await new Promise<void>((resolve, reject) => {
      control.once('error', reject)
      control.listen(pipe, resolve)
    })
    await writeFile(record, JSON.stringify({ pipe, token }), {
      flag: 'wx',
      mode: RUNTIME_STOP.fileMode,
    })
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    child =
      jobExecutablePath === undefined
        ? // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the installed ACP bundle supervises its own Node/argv; tests inject a fake child, no shell or credential environment (PLAN.md §8).
          spawn(deps.file, [...deps.args], {
            cwd: deps.cwd,
            env,
            stdio: 'pipe',
            ...treeSpawnOptions(process.platform),
          })
        : spawnMcpJob({
            executablePath: jobExecutablePath,
            file: deps.file,
            args: deps.args,
            isVerbatim: false,
            cwd: deps.cwd,
            env,
            log,
          })
    child.on('error', () => {
      ending.abort()
    })
    child.on('close', () => {
      ending.abort()
    })
    child.on('exit', stop)
    // Piping preserves byte boundaries/backpressure; provider stderr is private.
    deps.stdin.pipe(child.stdin)
    child.stdin.on('error', stop)
    child.stdout.pipe(deps.stdout, { end: false })
    child.stderr.resume()
    await closed
    stop()
    await stopping
    return child.pid === undefined ? 1 : (child.exitCode ?? 0)
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    if (child !== undefined) deps.stdin.unpipe(child.stdin)
    deps.stdin.destroy()
    await new Promise<void>((resolve) => {
      // Let the final acknowledgement drain before closing authenticated peers.
      const timer = setTimeout(() => {
        for (const socket of sockets) socket.destroy()
      }, RUNTIME_STOP.graceMs)
      control.close(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    await rm(record, { force: true })
    await rm(directory, { recursive: true, force: true })
  }
}

/** Private authenticated control sockets reach every owner in this workspace. */
export async function stopWorkspace(registry: string, cwd: string): Promise<void> {
  let files: string[]
  try {
    files = await readdir(registry)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  const prefix = `${workspaceKey(cwd)}-`
  const owners = files.filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
  for (let offset = 0; offset < owners.length; offset += RUNTIME_STOP.owners) {
    await Promise.all(
      owners.slice(offset, offset + RUNTIME_STOP.owners).map(async (file) => {
        const handle = await open(path.join(registry, file), 'r')
        let owner: z.infer<typeof ownerSchema>
        try {
          const bytes = Buffer.alloc(RUNTIME_STOP.recordBytes + 1)
          const { bytesRead } = await handle.read(bytes)
          if (bytesRead > RUNTIME_STOP.recordBytes) throw new Error('ESTOP_RECORD')
          owner = ownerSchema.parse(JSON.parse(bytes.toString('utf8', 0, bytesRead)))
        } finally {
          await handle.close()
        }
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection(owner.pipe)
          socket.setTimeout(RUNTIME_STOP.exitMs, () => {
            socket.destroy(new Error('ESTOP_TIMEOUT'))
          })
          let reply = ''
          socket.on('error', reject)
          socket.on('connect', () => {
            socket.write(`${owner.token}\n`)
          })
          socket.on('data', (bytes: Buffer) => {
            reply += bytes.toString('utf8')
            if (reply.length > RUNTIME_STOP.handshakeChars) socket.destroy(new Error('ESTOP_REPLY'))
          })
          socket.on('close', (failed) => {
            if (!failed && reply === 'STOPPED\n') resolve()
            else reject(new Error('ESTOP_TREE'))
          })
        })
      }),
    )
  }
}
