import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises'
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
  generation: z.uuid(),
  resource: z.string().check(z.minLength(1)),
  holder: z.string().check(z.minLength(1)),
  pid: z.int().check(z.positive()),
  startedAt: z.string().check(z.minLength(1)),
  endpoint: z.string().check(z.minLength(1)),
})
export type HardwareLeaseRecord = z.infer<typeof recordSchema>

type StopOutcome =
  | { readonly party: 'holder'; readonly status: 'stopped' }
  | { readonly party: 'holder'; readonly status: 'failed'; readonly reason: 'lease-stop-failed' }
  | { readonly party: 'contender'; readonly status: 'cancelled' }
  | {
      readonly party: 'contender'
      readonly status: 'failed'
      readonly reason: 'lease-contender-cancel-failed'
    }
  | {
      readonly party: 'unknown'
      readonly status: 'failed'
      readonly reason:
        'lease-stop-timeout' | 'lease-stop-unavailable' | 'lease-stop-invalid-response'
    }

export interface HardwareLeaseStopResult {
  readonly stopped: boolean
  readonly sessions: readonly (StopOutcome & { readonly record: HardwareLeaseRecord })[]
}

export interface LeaseDependencies {
  readonly directory: string
  readonly platform: NodeJS.Platform
  readonly timeoutMs: number
  readonly maxRecordBytes: number
  /** Legacy advisory hook. Atomic file publication never calls it. */
  readonly exclusive?: <T>(
    file: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>
  /** Windows must supply a current-user DACL, not Node's inherited pipe ACL. */
  readonly listenOwnerPipe?: (
    endpoint: string,
    id: string,
    stop: () => Promise<void>,
  ) => Promise<() => Promise<void>>
  /** Exact OS start identity; undefined means proven absent, throw means unknown. */
  readonly processStartTime: (pid: number) => Promise<string | undefined>
  /** Windows: current-user owner/DACL check; never repair an existing directory. */
  readonly isOwnerDirectory?: (directory: string) => Promise<boolean>
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

function resourceKey(resource: string): string {
  return createHash('sha256').update(resource).digest('hex')
}

async function privateDirectory(deps: LeaseDependencies): Promise<void> {
  const absolute = path.resolve(deps.directory)
  const root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep)) {
    current = path.join(current, part)
    try {
      await mkdir(current, { mode: OWNER_DIRECTORY_MODE })
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    const sample = await lstat(current)
    if (!sample.isDirectory() || sample.isSymbolicLink()) throw new Error('lease-directory-invalid')
  }
  const sample = await lstat(absolute)
  const getUserId = process.getuid
  if (deps.platform === 'win32') {
    if (!(await deps.isOwnerDirectory?.(absolute))) throw new Error('lease-directory-not-private')
  } else if (sample.uid !== getUserId?.() || !sample.mode.toString(2).endsWith('111000000')) {
    throw new Error('lease-directory-not-private')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function removeGeneration(file: string): Promise<void> {
  try {
    await unlink(file)
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return
    // Windows can report EPERM for a second unlink while deletion is completing.
    if (hasCode(error, 'EPERM')) {
      try {
        await lstat(file)
      } catch (sampleError: unknown) {
        if (hasCode(sampleError, 'ENOENT')) return
        throw sampleError
      }
    }
    throw error
  }
}

async function writeCompleteRecord(handle: FileHandle, text: string): Promise<void> {
  try {
    await handle.writeFile(text)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

// undefined is absent; null is held by an unknown owner, never permission to reclaim.
async function readRecord(
  file: string,
  maxBytes: number,
): Promise<HardwareLeaseRecord | null | undefined> {
  try {
    const sample = await lstat(file)
    if (!sample.isFile() || sample.isSymbolicLink() || sample.size > maxBytes) return null
    const handle = await open(file, 'r')
    let bytes: Buffer
    try {
      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > maxBytes) return null
      bytes = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    try {
      const parsed = recordSchema.safeParse(JSON.parse(bytes.toString('utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  } catch (error: unknown) {
    if (hasCode(error, 'ENOENT')) return undefined
    return null // Unreadable is occupied too; Stop can still reach other sessions.
  }
}

function recordPath(
  directory: string,
  record: HardwareLeaseRecord,
  kind: 'claim' | 'stop' | 'retired' = 'claim',
): string {
  return path.join(
    directory,
    `${kind}-v1.${resourceKey(record.resource)}.${record.id}.${record.generation}.json`,
  )
}

function leaseEndpoint(deps: LeaseDependencies, id: string): string {
  return deps.platform === 'win32'
    ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
    : path.join(deps.directory, `${id}.sock`)
}

function isBoundRecord(
  record: HardwareLeaseRecord,
  deps: LeaseDependencies,
  resource: string,
): boolean {
  return record.resource === resource && record.endpoint === leaseEndpoint(deps, record.id)
}

async function removeOwnedRecord(
  deps: LeaseDependencies,
  record: HardwareLeaseRecord,
  slot: string,
): Promise<void> {
  const file = recordPath(deps.directory, record)
  const current = await readRecord(file, deps.maxRecordBytes)
  if (
    current !== undefined &&
    (current?.id !== record.id || current.generation !== record.generation)
  )
    throw new Error('lease-holder-changed')
  // An absent marker alone cannot retire a possibly corrupted routing record.
  const source = current ?? (await readRecord(slot, deps.maxRecordBytes))
  if (JSON.stringify(source) === JSON.stringify(record))
    await retireGeneration(deps, record, current === undefined ? slot : file)
  await removeGeneration(file)
  await removeGeneration(recordPath(deps.directory, record, 'stop'))
}

async function retireGeneration(
  deps: LeaseDependencies,
  record: HardwareLeaseRecord,
  source: string,
): Promise<void> {
  const receipt = recordPath(deps.directory, record, 'retired')
  try {
    await link(source, receipt)
  } catch (error: unknown) {
    // A concurrent release may have removed source after publishing this receipt.
    if (JSON.stringify(await readRecord(receipt, deps.maxRecordBytes)) === JSON.stringify(record))
      return
    if (!hasCode(error, 'EEXIST')) throw error
    throw new Error('lease-retirement-changed', { cause: error })
  }
}

async function isSameHolder(
  record: HardwareLeaseRecord,
  deps: LeaseDependencies,
): Promise<boolean> {
  try {
    const start = z
      .optional(z.string().check(z.minLength(1)))
      .parse(await deps.processStartTime(record.pid))
    return start === record.startedAt
  } catch {
    return true // Permission/OS failure cannot prove that the holder has died.
  }
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
          let reply: { stopped: boolean } | { cancelled: boolean }
          try {
            await stop()
            reply = { stopped: true }
          } catch (error: unknown) {
            if (error instanceof Error && error.message === 'lease-contender-cancelled')
              reply = { cancelled: true }
            else if (error instanceof Error && error.message === 'lease-contender-cancel-failed')
              reply = { cancelled: false }
            else reply = { stopped: false }
          }
          await new Promise<void>((resolve) => {
            socket.end(`${JSON.stringify(reply)}\n`, () => {
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
  | { readonly status: 'busy'; readonly holder?: HardwareLeaseRecord }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'acquired'
      readonly record: HardwareLeaseRecord
      readonly release: () => Promise<void>
    }
> {
  await privateDirectory(deps)
  const directory = deps.directory
  const startedAt = await deps.processStartTime(process.pid)
  if (startedAt === undefined) throw new Error('lease-holder-identity-unavailable')
  const id = randomUUID()
  const record = recordSchema.parse({
    version: 1,
    id,
    generation: randomUUID(),
    resource,
    holder,
    pid: process.pid,
    startedAt,
    endpoint: leaseEndpoint(deps, id),
  })
  const file = recordPath(directory, record)
  const stopFile = recordPath(directory, record, 'stop')
  const stopTemporary = `${stopFile}.preparing`
  let close: (() => Promise<void>) | undefined
  let hasOwnFile = false
  let hasOwnStop = false
  let hasOwnStopTemporary = false
  const state = { isPublished: false, isCancelled: false }
  const isCancelled = () => state.isCancelled
  let publishing: Promise<void> | undefined
  const stopSession = async () => {
    state.isCancelled = true
    try {
      await publishing
    } catch {
      // Failed publication leaves this generation a contender.
    }
    try {
      await stop()
    } catch (error: unknown) {
      throw new Error(state.isPublished ? 'lease-stop-failed' : 'lease-contender-cancel-failed', {
        cause: error,
      })
    }
    if (!state.isPublished) throw new Error('lease-contender-cancelled')
  }
  try {
    const text = JSON.stringify(record)
    if (Buffer.byteLength(text) > deps.maxRecordBytes) throw new Error('lease-record-oversize')
    // This unique private file is preparation only. No claim slot references it yet.
    const handle = await open(file, 'wx', OWNER_FILE_MODE)
    hasOwnFile = true
    await writeCompleteRecord(handle, text)
    if (deps.platform === 'win32') {
      if (deps.listenOwnerPipe === undefined) throw new Error('lease-owner-pipe-unavailable')
      close = await deps.listenOwnerPipe(record.endpoint, id, stopSession)
    } else close = await listenOwnerSocket(record.endpoint, id, stopSession, deps)
    // Independent inode: corruption of a claim file cannot corrupt Stop discovery.
    const stopHandle = await open(stopTemporary, 'wx', OWNER_FILE_MODE)
    hasOwnStopTemporary = true
    await writeCompleteRecord(stopHandle, text)
    await link(stopTemporary, stopFile)
    hasOwnStop = true
    await removeGeneration(stopTemporary)
    hasOwnStopTemporary = false
    let slot = path.join(directory, `claim-v1.${resourceKey(resource)}.head.claim`)
    const visited = new Set<string>()
    for (;;) {
      if (isCancelled()) return { status: 'cancelled' }
      if (visited.has(slot)) return { status: 'busy' }
      visited.add(slot)
      const previous = await readRecord(slot, deps.maxRecordBytes)
      if (isCancelled()) return { status: 'cancelled' }
      if (previous === null) return { status: 'busy' }
      if (previous === undefined) {
        // The sole linearization point. No fallible work follows successful publication.
        try {
          publishing = (async () => {
            await link(file, slot)
            state.isPublished = true
          })()
          await publishing
        } catch (error: unknown) {
          if (!hasCode(error, 'EEXIST')) throw error
          visited.delete(slot)
          continue
        }
        const closeEndpoint = close
        let closing: Promise<void> | undefined
        let isReleased = false
        return {
          status: 'acquired',
          record,
          release: async () => {
            if (isReleased) return
            // Close the session first; even endpoint failure must not bypass lease cleanup.
            try {
              closing ??= closeEndpoint()
              await closing
            } finally {
              await removeOwnedRecord(deps, record, slot)
              isReleased = true
            }
          },
        }
      }
      if (!isBoundRecord(previous, deps, resource)) return { status: 'busy' }
      const previousFile = recordPath(directory, previous)
      const retired = await readRecord(
        recordPath(directory, previous, 'retired'),
        deps.maxRecordBytes,
      )
      if (retired !== undefined && JSON.stringify(retired) !== JSON.stringify(previous))
        return { status: 'busy' }
      if (retired === undefined) {
        const live = await readRecord(previousFile, deps.maxRecordBytes)
        if (
          live === null ||
          (live !== undefined && JSON.stringify(live) !== JSON.stringify(previous))
        )
          return { status: 'busy' }
        const isLive = await isSameHolder(previous, deps)
        if (isCancelled()) return { status: 'cancelled' }
        if (isLive)
          return live === undefined ? { status: 'busy' } : { status: 'busy', holder: previous }
        await retireGeneration(deps, previous, slot)
        // Never unlink a reusable slot. All cleaners address the old unique generation.
        await removeGeneration(previousFile)
        await removeGeneration(recordPath(directory, previous, 'stop'))
      }
      slot = path.join(directory, `claim-v1.${resourceKey(resource)}.${previous.generation}.claim`)
    }
  } finally {
    if (!state.isPublished) {
      try {
        await close?.()
      } finally {
        if (hasOwnStop) await removeGeneration(stopFile)
        if (hasOwnStopTemporary) await removeGeneration(stopTemporary)
        if (hasOwnFile) await removeGeneration(file)
      }
    }
  }
}

/** Compatibility predicate: only a settled holder acknowledgement counts. */
export async function didStopHardwareLease(
  deps: LeaseDependencies,
  resource: string,
): Promise<boolean> {
  const result = await stopHardwareLease(deps, resource)
  return result.stopped
}

/** Out-of-band session discovery: Stop never consults admission/claim records. */
export async function stopHardwareLease(
  deps: LeaseDependencies,
  resource: string,
): Promise<HardwareLeaseStopResult> {
  await privateDirectory(deps)
  const directory = deps.directory
  const pending: Promise<HardwareLeaseStopResult['sessions'][number]>[] = []
  const entries = await readdir(directory)
  for (const entry of entries) {
    if (!entry.startsWith(`stop-v1.${resourceKey(resource)}.`) || !entry.endsWith('.json')) continue
    const file = path.join(directory, entry)
    const record = await readRecord(file, deps.maxRecordBytes)
    if (
      record === undefined ||
      record === null ||
      file !== recordPath(directory, record, 'stop') ||
      !isBoundRecord(record, deps, resource)
    )
      continue
    pending.push(stopRecord(deps, record))
  }
  const sessions = await Promise.all(pending)
  return {
    stopped:
      sessions.some((session) => session.party === 'holder' && session.status === 'stopped') &&
      sessions.every((session) => session.party === 'contender' || session.status !== 'failed'),
    sessions,
  }
}

const stopReplySchema = z.union([
  z.strictObject({ stopped: z.boolean() }),
  z.strictObject({ cancelled: z.boolean() }),
  z.strictObject({ timedOut: z.literal(true) }),
])

async function stopRecord(
  deps: LeaseDependencies,
  record: HardwareLeaseRecord,
): Promise<HardwareLeaseStopResult['sessions'][number]> {
  return await new Promise((resolve) => {
    const socket = net.connect(record.endpoint)
    const finish = (outcome: StopOutcome) => {
      socket.destroy()
      resolve({ ...outcome, record })
    }
    socket.setTimeout(deps.timeoutMs, () => {
      finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-timeout' })
    })
    socket.on('error', () => {
      finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-unavailable' })
    })
    socket.once('connect', () =>
      socket.write(`${JSON.stringify({ command: 'stop', id: record.id })}\n`),
    )
    let input = ''
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > deps.maxRecordBytes) {
        finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-invalid-response' })
        return
      }
      if (!input.endsWith('\n')) return
      try {
        const reply = stopReplySchema.parse(JSON.parse(input))
        if ('stopped' in reply)
          finish(
            reply.stopped
              ? { party: 'holder', status: 'stopped' }
              : {
                  party: 'holder',
                  status: 'failed',
                  reason: 'lease-stop-failed',
                },
          )
        else if ('cancelled' in reply)
          finish(
            reply.cancelled
              ? { party: 'contender', status: 'cancelled' }
              : {
                  party: 'contender',
                  status: 'failed',
                  reason: 'lease-contender-cancel-failed',
                },
          )
        else finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-timeout' })
      } catch {
        finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-invalid-response' })
      }
    })
    socket.once('end', () => {
      finish({ party: 'unknown', status: 'failed', reason: 'lease-stop-unavailable' })
    })
  })
}
