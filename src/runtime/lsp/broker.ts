// One authenticated local workspace runtime; stdio frontends own only their connection.
import { randomBytes, randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import path from 'node:path'
import * as z from 'zod/mini'
import { LSP_LIMITS, RUNTIME_STOP } from '../../shared/constants'
import { isProcessAlive } from '../../host/checkpoints/windowPresence'
import { workspaceKey } from '../dataFolder'
import { serveLsp, type LspServices } from './server'
import { privateDirectory, openPrivateRecord, writePrivateRecord } from './registry'

const ownerSchema = z.strictObject({
  pid: z.int().check(z.gte(1)),
  token: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  pipe: z.string().check(z.maxLength(LSP_LIMITS.uriChars)),
  configuration: z.string(),
})
const startingSchema = z.strictObject({ pid: z.int().check(z.gte(1)) })
function wait(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LSP_LIMITS.pollMs)
  })
}
function folderOf(registry: string, workspace: string): string {
  return path.join(registry, `lsp-${workspaceKey(workspace)}`)
}
async function recordAt(folder: string, name: string): Promise<unknown> {
  await privateDirectory(folder)
  const handle = await openPrivateRecord(path.join(folder, name))
  try {
    const bytes = Buffer.alloc(LSP_LIMITS.recordBytes + 1)
    const { bytesRead } = await handle.read(bytes)
    if (bytesRead > LSP_LIMITS.recordBytes) throw new Error('ELSP_RECORD')
    const raw: unknown = JSON.parse(bytes.toString('utf8', 0, bytesRead))
    return raw
  } finally {
    await handle.close()
  }
}

async function ownerAt(folder: string) {
  return ownerSchema.parse(await recordAt(folder, 'owner.json'))
}

/** Re-check under an exclusive recovery lock so stale observations cannot erase a new owner. */
async function recover(folder: string): Promise<void> {
  const lock = `${folder}.recover`
  try {
    const created = await privateDirectory(lock, true)
    if (!created.isNew) return
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EEXIST' || error.code === 'ENOENT')
    )
      return
    throw error
  }
  try {
    try {
      const owner = await ownerAt(folder)
      if (!isProcessAlive(owner.pid)) await rm(folder, { recursive: true, force: true })
      return
    } catch (error: unknown) {
      // A malformed worker record is not authority to start a second runtime.
      if (error instanceof Error && error.message === 'ELSP_PRIVATE') throw error
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return
    }
    try {
      const worker = await ownerAt(path.join(folder, 'worker'))
      if (isProcessAlive(worker.pid)) return
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'ELSP_PRIVATE') throw error
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return
    }
    try {
      const starting = startingSchema.parse(await recordAt(folder, 'starting.json'))
      if (!isProcessAlive(starting.pid)) await rm(folder, { recursive: true, force: true })
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'ELSP_PRIVATE') throw error
      let info
      try {
        info = await stat(folder)
      } catch {
        return
      }
      if (Date.now() - info.mtimeMs > LSP_LIMITS.startupMs)
        await rm(folder, { recursive: true, force: true })
    }
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

/** Worker owns its record until every client is closed; authenticated activity resets idle time. */
export async function startWorkspaceBroker(
  registry: string,
  workspace: string,
  configuration: string,
  services: LspServices,
) {
  await privateDirectory(registry)
  const folder = folderOf(registry, workspace)
  await privateDirectory(folder)
  const token = randomBytes(LSP_LIMITS.tokenBytes).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\muse-lsp-${randomUUID()}`
      : path.join(registry, randomBytes(LSP_LIMITS.socketNameBytes).toString('hex'))
  const lock = path.join(folder, 'worker')
  const record = JSON.stringify({ pid: process.pid, token, pipe, configuration })
  if (Buffer.byteLength(record) > LSP_LIMITS.recordBytes) throw new Error('ELSP_RECORD')
  try {
    await ownerAt(folder)
    throw new Error('ELSP_OWNED')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  // A second worker must never unlink the first worker's active socket/record.
  const created = await privateDirectory(lock, true)
  if (!created.isNew) throw new Error('ELSP_OWNED')
  await writePrivateRecord(path.join(lock, 'owner.json'), record)
  const clients = new Set<Socket>()
  let idle: ReturnType<typeof setTimeout> | undefined
  let closing: Promise<void> | undefined
  const { promise: closed, resolve: closeOwner } = Promise.withResolvers<undefined>()
  function activity(): void {
    if (closing !== undefined) return
    clearTimeout(idle)
    idle = setTimeout(() => {
      void close()
    }, LSP_LIMITS.idleMs)
  }
  const server = createServer((socket) => {
    if (clients.size >= LSP_LIMITS.clients) {
      socket.destroy()
      return
    }
    clients.add(socket)
    let isAuthenticated = false
    let handshake = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
    }, LSP_LIMITS.startupMs)
    const authenticate = (chunk: Buffer): void => {
      handshake = Buffer.concat([handshake, chunk])
      const end = handshake.indexOf('\n')
      if (end === -1) {
        if (handshake.length > RUNTIME_STOP.handshakeChars) socket.destroy()
        return
      }
      if (handshake.subarray(0, end).toString('ascii') !== token) {
        socket.destroy()
        return
      }
      clearTimeout(timer)
      socket.off('data', authenticate)
      isAuthenticated = true
      activity()
      socket.on('data', activity)
      const transport = serveLsp(socket, socket, workspace, services)
      void transport.closed.then(() => {
        socket.end()
      })
      const rest = handshake.subarray(end + 1)
      if (rest.length > 0) socket.unshift(rest)
      handshake = Buffer.alloc(0)
    }
    socket.on('data', authenticate)
    socket.on('error', () => {
      socket.destroy()
    })
    socket.once('close', () => {
      clearTimeout(timer)
      clients.delete(socket)
      if (isAuthenticated) activity()
    })
  })
  server.maxConnections = LSP_LIMITS.clients
  async function close(): Promise<void> {
    closing ??= (async () => {
      clearTimeout(idle)
      for (const client of clients) client.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      await rm(folder, { recursive: true, force: true })
      closeOwner(undefined)
    })()
    await closing
  }
  function onSignal(): void {
    void close()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(pipe, resolve)
    })
    const temporary = path.join(folder, 'owner.tmp')
    await writePrivateRecord(temporary, record)
    const { rename } = await import('node:fs/promises')
    await rename(temporary, path.join(folder, 'owner.json'))
    process.once('SIGTERM', onSignal)
    process.once('SIGINT', onSignal)
    activity()
    return { close, closed }
  } catch (error) {
    await close()
    throw error
  }
}

export interface BrokerLaunch {
  readonly registry: string
  readonly workspace: string
  readonly configuration: string
  /** Trusted installed runtime, supervised independently, no shell or credential environment. */
  launch(): void | Promise<void>
}

/** Exclusive startup directory, then a validated private record. A dead owner is replaceable. */
export async function connectWorkspaceBroker(deps: BrokerLaunch): Promise<Socket> {
  await privateDirectory(deps.registry, true)
  const folder = folderOf(deps.registry, deps.workspace)
  const deadline = Date.now() + LSP_LIMITS.startupMs
  let didLaunch = false
  for (;;) {
    if (Date.now() >= deadline) throw new Error('ELSP_STARTUP')
    try {
      const owner = await ownerAt(folder)
      if (!isProcessAlive(owner.pid)) {
        await recover(folder)
        await wait()
        continue
      }
      if (owner.configuration !== deps.configuration) throw new Error('ELSP_CONFIGURATION')
      return await new Promise<Socket>((resolve, reject) => {
        const socket = createConnection(owner.pipe)
        socket.setTimeout(LSP_LIMITS.startupMs, () => {
          socket.destroy(new Error('ELSP_CONNECT'))
        })
        socket.once('error', reject)
        socket.once('connect', () => {
          socket.setTimeout(0)
          socket.write(`${owner.token}\n`)
          resolve(socket)
        })
      })
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message === 'ELSP_CONFIGURATION' || error.message === 'ELSP_PRIVATE')
      )
        throw error
      if (Date.now() >= deadline) throw new Error('ELSP_STARTUP', { cause: error })
    }
    try {
      const created = await privateDirectory(folder, true)
      if (!created.isNew) throw Object.assign(new Error('ELSP_OWNED'), { code: 'EEXIST' })
      if (didLaunch) {
        await rm(folder, { recursive: true, force: true })
        throw new Error('ELSP_STARTUP')
      }
      await writePrivateRecord(
        path.join(folder, 'starting.json'),
        JSON.stringify({ pid: process.pid }),
      )
      try {
        await deps.launch()
        didLaunch = true
      } catch (error: unknown) {
        await rm(folder, { recursive: true, force: true })
        throw error
      }
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      await recover(folder)
    }
    await wait()
  }
}
