// Independent process supervision: Stop never enters the model/request queue.
import { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readdir, rm, type FileHandle } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import * as z from 'zod/mini'
import type { ResourceTicket } from '../../shared/resources'
import { RUNTIME_STOP, LSP_LIMITS } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { withoutCredentials } from '../credentialVariables'
import { isProcessAlive } from '../../host/checkpoints/windowPresence'
import { privateDirectory, openPrivateRecord, writePrivateRecord } from './registry'

const ownerSchema = z.strictObject({
  pid: z.optional(z.int().check(z.gte(1))),
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
  readonly watchdogFile?: string
  readonly stdin: Readable
  readonly stdout: Writable
}

/** The supervisor owns pipes and a group/job; the child never owns Stop. */
export async function superviseRuntime(deps: SupervisorDeps): Promise<number> {
  await privateDirectory(deps.registry, true)
  const env = withoutCredentials(deps.env)
  const { processAuthority } = await import('./processAuthority')
  const authority = await processAuthority(deps.packageRoot, deps.registry)
  const directory = path.join(
    tmpdir(),
    `ms-${randomBytes(LSP_LIMITS.socketNameBytes).toString('hex')}`,
  )
  const created = await privateDirectory(directory, true)
  if (!created.isNew) throw new Error('ELSP_PRIVATE')
  const token = randomBytes(RUNTIME_STOP.tokenBytes).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\muse-stop-${randomUUID()}`
      : path.join(directory, 'control')
  const record = path.join(deps.registry, `${workspaceKey(deps.cwd)}-${randomUUID()}.json`)
  let child: ChildProcessWithoutNullStreams | undefined
  let watchdog: ChildProcessWithoutNullStreams | undefined
  let watchdogDone: Promise<number> | undefined
  let childTicket: ResourceTicket | undefined
  let watchdogTicket: ResourceTicket | undefined
  let stopping: Promise<void> | undefined
  const { promise: startup, resolve: finishStartup } = Promise.withResolvers<undefined>()
  const { promise: closed, resolve: closeOwner } = Promise.withResolvers<undefined>()
  const stop = () => {
    stopping ??= (async () => {
      await startup
      if (child === undefined) return
      if (childTicket !== undefined) await authority.stop(childTicket, true)
      // EOF guardian has independently enrolled the same exact ticket before admission.
      if (watchdog !== undefined && watchdogDone !== undefined) {
        watchdog.stdin.end()
        const result = await watchdogDone
        if (result !== 0) throw new Error('ESTOP_WATCHDOG')
        if (watchdogTicket !== undefined) await authority.stop(watchdogTicket)
      }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      closeOwner(undefined)
    })()
    // The main path awaits this failure and preserves a nonzero result.
    void stopping.catch(() => {
      closeOwner(undefined)
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
    await writePrivateRecord(record, JSON.stringify({ pid: process.pid, pipe, token }))
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    if (process.platform !== 'win32') {
      const launched = await authority.launch(
        process.execPath,
        [
          deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
          String(process.pid),
          deps.packageRoot,
          deps.registry,
        ],
        deps.cwd,
        env,
        deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
      )
      watchdog = launched.child
      watchdogTicket = launched.ticket
      launched.admit()
      const guard = watchdog
      watchdogDone = new Promise<number>((resolve) => {
        guard.once('close', (code) => {
          resolve(code ?? 1)
        })
      })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('ESTOP_WATCHDOG'))
        }, RUNTIME_STOP.exitMs)
        guard.once('error', reject)
        guard.stdout.once('data', (bytes: Buffer) => {
          clearTimeout(timer)
          if (bytes.toString('ascii') === 'READY\n') resolve()
          else reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.once('close', () => {
          clearTimeout(timer)
          reject(new Error('ESTOP_WATCHDOG'))
        })
      })
      guard.stderr.resume()
      guard.stdout.resume()
      guard.once('exit', stop)
    }
    const launched = await authority.launch(
      deps.file,
      deps.args,
      deps.cwd,
      env,
      deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
    )
    child = launched.child
    childTicket = launched.ticket
    child.on('error', () => {
      closeOwner(undefined)
    })
    child.on('close', () => {
      closeOwner(undefined)
    })
    child.on('exit', stop)
    if (watchdog !== undefined) {
      const guard = watchdog
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('ESTOP_WATCHDOG'))
        }, RUNTIME_STOP.exitMs)
        guard.stdout.once('data', (bytes: Buffer) => {
          clearTimeout(timer)
          if (bytes.toString('ascii') === 'OWNED\n') resolve()
          else reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.once('close', () => {
          clearTimeout(timer)
          reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.stdin.write(`${JSON.stringify({ ticket: childTicket })}\n`)
      })
    }
    launched.admit()
    // Piping preserves byte boundaries/backpressure; provider stderr is private.
    deps.stdin.pipe(child.stdin)
    child.stdin.on('error', stop)
    child.stdout.pipe(deps.stdout, { end: false })
    child.stderr.resume()
    finishStartup(undefined)
    await closed
    stop()
    await stopping
    return child.pid === undefined ? 1 : (child.exitCode ?? 0)
  } catch (error: unknown) {
    if (child === undefined && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return 1
    throw error
  } finally {
    finishStartup(undefined)
    stop()
    try {
      await stopping
    } finally {
      process.off('SIGTERM', stop)
      process.off('SIGINT', stop)
      if (watchdog !== undefined) {
        watchdog.stdin.end()
        await watchdogDone
        const ticket = watchdogTicket
        if (
          ticket !== undefined &&
          authority.registry.tickets().some((entry) => entry.id === ticket.id)
        )
          await authority.stop(ticket)
      }
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
}

/** Private authenticated control sockets reach every owner in this workspace. */
export async function stopWorkspace(registry: string, cwd: string): Promise<void> {
  let files: string[]
  try {
    await privateDirectory(registry)
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
        let handle: FileHandle
        try {
          handle = await openPrivateRecord(path.join(registry, file))
        } catch (error: unknown) {
          // The owner removes its private record when it finishes stopping.
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
          throw error
        }
        let owner: z.infer<typeof ownerSchema>
        try {
          const bytes = Buffer.alloc(RUNTIME_STOP.recordBytes + 1)
          const { bytesRead } = await handle.read(bytes)
          if (bytesRead > RUNTIME_STOP.recordBytes) throw new Error('ESTOP_RECORD')
          owner = ownerSchema.parse(JSON.parse(bytes.toString('utf8', 0, bytesRead)))
        } finally {
          await handle.close()
        }
        if (owner.pid !== undefined && !isProcessAlive(owner.pid)) {
          await rm(path.join(registry, file), { force: true })
          return
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
