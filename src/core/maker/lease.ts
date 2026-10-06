import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_JOURNAL_FILE_MODE as OWNER_FILE_MODE,
  CHECKPOINT_STORAGE_MODE as OWNER_DIRECTORY_MODE,
} from '../../shared/constants'
import type { SerialIdentity } from './serial/identity'

const recordSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  resource: z.string().check(z.minLength(1)),
  holder: z.string().check(z.minLength(1)),
  pid: z.int().check(z.positive()),
  endpoint: z.string().check(z.minLength(1)),
})
export type HardwareLeaseRecord = z.infer<typeof recordSchema>

export interface LeaseDependencies {
  readonly directory: string
  readonly platform: NodeJS.Platform
  readonly timeoutMs: number
  readonly maxRecordBytes: number
  /** Kernel file lock; signal aborts immediately if its native holder exits. */
  readonly exclusive: <T>(
    file: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>
  /** Windows must supply a current-user DACL, not Node's inherited pipe ACL. */
  readonly listenOwnerPipe?: (
    endpoint: string,
    id: string,
    stop: () => Promise<void>,
  ) => Promise<() => Promise<void>>
  readonly isProcessAlive?: (pid: number) => boolean
  readonly isEndpointAlive?: (endpoint: string) => Promise<boolean>
}

/** Resolve aliases so /dev/serial/by-id and its tty cannot get two leases. */
export async function serialLeaseResource(
  identity: SerialIdentity,
  platform: NodeJS.Platform,
): Promise<string> {
  const port =
    platform === 'win32'
      ? identity.port.replace(/^\\\\[.?]\\(?=COM\d+$)/i, '').toUpperCase()
      : await realpath(identity.port)
  return `port:${port}`
}

function lockPath(deps: LeaseDependencies, resource: string): string {
  return path.join(deps.directory, `${createHash('sha256').update(resource).digest('hex')}.lock`)
}

async function privateDirectory(deps: LeaseDependencies): Promise<void> {
  await mkdir(deps.directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
  const sample = await lstat(deps.directory)
  if (!sample.isDirectory() || sample.isSymbolicLink()) throw new Error('lease-directory-invalid')
  const getUserId = process.getuid
  if (
    deps.platform !== 'win32' &&
    (sample.uid !== getUserId?.() || !sample.mode.toString(2).endsWith('111000000'))
  ) {
    throw new Error('lease-directory-not-private')
  }
}

async function readRecord(
  file: string,
  maxBytes: number,
): Promise<HardwareLeaseRecord | undefined> {
  try {
    const sample = await lstat(file)
    if (!sample.isFile() || sample.isSymbolicLink() || sample.size > maxBytes)
      throw new Error('lease-record-invalid')
    const bytes = await readFile(file)
    if (bytes.length > maxBytes) throw new Error('lease-record-oversize')
    return recordSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function leaseEndpoint(deps: LeaseDependencies, id: string): string {
  return deps.platform === 'win32'
    ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
    : path.join(deps.directory, `${id}.sock`)
}

function validateEndpoint(record: HardwareLeaseRecord, deps: LeaseDependencies): void {
  if (record.endpoint !== leaseEndpoint(deps, record.id)) throw new Error('lease-endpoint-invalid')
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

async function isEndpointReachable(endpoint: string, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect(endpoint)
    const finish = (isAlive: boolean) => {
      socket.destroy()
      resolve(isAlive)
    }
    socket.setTimeout(timeoutMs, () => {
      finish(true)
    }) // Unknown is occupied.
    socket.once('connect', () => {
      finish(true)
    })
    socket.once('error', (error) => {
      finish(!('code' in error && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')))
    })
  })
}

const stopSchema = z.strictObject({ command: z.literal('stop'), id: z.uuid() })

async function listenOwnerSocket(
  endpoint: string,
  id: string,
  stop: () => Promise<void>,
  deps: LeaseDependencies,
): Promise<() => Promise<void>> {
  const sockets = new Set<net.Socket>()
  const replies = new Map<net.Socket, Promise<void>>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(deps.timeoutMs, () => socket.destroy())
    let input = ''
    let isReceived = false
    socket.on('data', (chunk: Buffer) => {
      if (isReceived) {
        socket.destroy()
        return
      }
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > deps.maxRecordBytes) {
        socket.destroy()
        return
      }
      if (!input.endsWith('\n')) return
      isReceived = true
      let request: z.infer<typeof stopSchema>
      try {
        request = stopSchema.parse(JSON.parse(input))
      } catch {
        socket.destroy()
        return
      }
      if (request.id !== id) {
        socket.destroy()
        return
      }
      const replying = (async () => {
        // Track the reply before invoking a host callback that may throw synchronously.
        await Promise.resolve()
        try {
          let hasStopped: boolean
          try {
            await stop()
            hasStopped = true
          } catch {
            hasStopped = false
          }
          await new Promise<void>((resolve) => {
            socket.end(`${JSON.stringify({ stopped: hasStopped })}\n`, () => {
              resolve()
            })
          })
        } finally {
          replies.delete(socket)
        }
      })()
      replies.set(socket, replying)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, resolve)
  })
  try {
    await chmod(endpoint, OWNER_FILE_MODE)
  } catch (error: unknown) {
    server.close()
    throw error
  }
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(replies.values()),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, deps.timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }),
    )
  }
}

export async function claimHardwareLease(
  deps: LeaseDependencies,
  resource: string,
  holder: string,
  stop: () => Promise<void>,
): Promise<
  | { readonly status: 'busy'; readonly holder: HardwareLeaseRecord }
  | {
      readonly status: 'acquired'
      readonly record: HardwareLeaseRecord
      readonly release: () => Promise<void>
    }
> {
  await privateDirectory(deps)
  const file = lockPath(deps, resource)
  return await deps.exclusive(`${file}.mutex`, async (signal) => {
    signal.throwIfAborted()
    const previous = await readRecord(file, deps.maxRecordBytes)
    signal.throwIfAborted()
    if (previous !== undefined) {
      validateEndpoint(previous, deps)
      if (previous.resource !== resource) throw new Error('lease-resource-mismatch')
      const isHolderProcessAlive = (deps.isProcessAlive ?? isProcessAlive)(previous.pid)
      const isSocketAlive = await (deps.isEndpointAlive?.(previous.endpoint) ??
        isEndpointReachable(previous.endpoint, deps.timeoutMs))
      signal.throwIfAborted()
      if (isHolderProcessAlive || isSocketAlive) return { status: 'busy', holder: previous }
      // Both are proven absent, while the OS mutex excludes other claimants.
      await rm(file)
      signal.throwIfAborted()
      if (deps.platform !== 'win32') await rm(previous.endpoint, { force: true })
    }
    signal.throwIfAborted()
    const id = randomUUID()
    const endpoint = leaseEndpoint(deps, id)
    const record = recordSchema.parse({
      version: 1,
      id,
      resource,
      holder,
      pid: process.pid,
      endpoint,
    })
    let close: () => Promise<void>
    if (deps.platform === 'win32') {
      if (deps.listenOwnerPipe === undefined) throw new Error('lease-owner-pipe-unavailable')
      close = await deps.listenOwnerPipe(endpoint, id, stop)
    } else {
      close = await listenOwnerSocket(endpoint, id, stop, deps)
    }
    try {
      signal.throwIfAborted()
      const text = JSON.stringify(record)
      if (Buffer.byteLength(text) > deps.maxRecordBytes) throw new Error('lease-record-oversize')
      await writeFile(file, text, { flag: 'wx', mode: OWNER_FILE_MODE })
      signal.throwIfAborted()
    } catch (error: unknown) {
      await close()
      throw error
    }
    let isReleased = false
    return {
      status: 'acquired',
      record,
      release: async () => {
        await deps.exclusive(`${file}.mutex`, async (signal) => {
          signal.throwIfAborted()
          if (isReleased) return
          const current = await readRecord(file, deps.maxRecordBytes)
          signal.throwIfAborted()
          if (current?.id !== id) throw new Error('lease-holder-changed')
          await close()
          signal.throwIfAborted()
          await rm(file)
          isReleased = true
        })
      },
    }
  })
}

/** Out-of-band: no approval, mutex or running-turn queue is involved. */
export async function didStopHardwareLease(
  deps: LeaseDependencies,
  resource: string,
): Promise<boolean> {
  await privateDirectory(deps)
  const record = await readRecord(lockPath(deps, resource), deps.maxRecordBytes)
  if (record === undefined) return false
  validateEndpoint(record, deps)
  if (record.resource !== resource) throw new Error('lease-resource-mismatch')
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect(record.endpoint)
    const finish = (hasStopped: boolean) => {
      socket.destroy()
      resolve(hasStopped)
    }
    socket.setTimeout(deps.timeoutMs, () => {
      finish(false)
    })
    socket.on('error', () => {
      finish(false)
    })
    socket.once('connect', () =>
      socket.write(`${JSON.stringify({ command: 'stop', id: record.id })}\n`),
    )
    let input = ''
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > deps.maxRecordBytes) {
        finish(false)
        return
      }
      if (!input.endsWith('\n')) return
      try {
        finish(z.strictObject({ stopped: z.boolean() }).parse(JSON.parse(input)).stopped)
      } catch {
        finish(false)
      }
    })
    socket.once('end', () => {
      finish(false)
    })
  })
}
