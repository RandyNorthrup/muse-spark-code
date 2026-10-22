import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  unlink,
} from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_JOURNAL_FILE_MODE as OWNER_FILE_MODE,
  CHECKPOINT_STORAGE_MODE as OWNER_DIRECTORY_MODE,
  MAKER_LEASE_SOCKET_NAME_CHARS,
  MAKER_LEASE_SOCKET_PATH_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import type { RunProgram } from '../../host/processTree'
import { powerShellQuoted } from '../shellQuote'
import type { SerialIdentity } from './serial/identity'

const nonEmptyString = z.string().check(z.minLength(1))
const recordSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  generation: z.uuid(),
  resource: nonEmptyString,
  holder: nonEmptyString,
  pid: z.int().check(z.positive()),
  startedAt: nonEmptyString,
  endpoint: nonEmptyString,
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
  readonly sessions: readonly (
    | (StopOutcome & { readonly record: HardwareLeaseRecord })
    | {
        readonly party: 'unknown'
        readonly status: 'failed'
        readonly reason: 'lease-stop-unrecognized'
        /** null: an unreadable Stop index entry. Stop never connects to either. */
        readonly record: HardwareLeaseRecord | null
      }
  )[]
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

// Stop passes isReadOnly: an absent folder holds no lease, and Stop never creates state.
async function isPrivateDirectory(deps: LeaseDependencies, isReadOnly?: boolean): Promise<boolean> {
  const absolute = path.resolve(deps.directory)
  const root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep)) {
    current = path.join(current, part)
    try {
      if (!isReadOnly) await mkdir(current, { mode: OWNER_DIRECTORY_MODE })
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    let sample
    try {
      sample = await lstat(current)
    } catch (error: unknown) {
      if (isReadOnly && hasCode(error, 'ENOENT')) return false
      throw error
    }
    if (!sample.isDirectory() || sample.isSymbolicLink()) throw new Error('lease-directory-invalid')
  }
  const sample = await lstat(absolute)
  const getUserId = process.getuid
  if (
    deps.platform === 'win32'
      ? !(await deps.isOwnerDirectory?.(absolute))
      : sample.uid !== getUserId?.() || !sample.mode.toString(2).endsWith('111000000')
  )
    throw new Error('lease-directory-not-private')
  return true
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

// A POSIX name from the id's random start fits the socket path cap; a clash fails the bind.
function leaseEndpoint(deps: LeaseDependencies, id: string): string {
  return deps.platform === 'win32'
    ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
    : path.join(deps.directory, `${id.slice(0, MAKER_LEASE_SOCKET_NAME_CHARS)}.sock`)
}

// Builds before FIXM103W10 named the POSIX socket by the whole id; both stay in this folder.
function isBoundRecord(
  record: HardwareLeaseRecord,
  deps: LeaseDependencies,
  resource: string,
): boolean {
  return (
    record.resource === resource &&
    (record.endpoint === leaseEndpoint(deps, record.id) ||
      (deps.platform !== 'win32' &&
        record.endpoint === path.join(deps.directory, `${record.id}.sock`)))
  )
}

function isMatchingRecord(
  value: HardwareLeaseRecord | null | undefined,
  record: HardwareLeaseRecord,
): boolean {
  return JSON.stringify(value) === JSON.stringify(record)
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
  if (isMatchingRecord(source, record))
    await retireGeneration(deps, record, current === undefined ? slot : file)
  else await cleanGeneration(deps, record)
}

async function cleanGeneration(
  deps: LeaseDependencies,
  record: HardwareLeaseRecord,
): Promise<void> {
  // Never unlink a reusable slot; both names belong only to this generation.
  try {
    await removeGeneration(recordPath(deps.directory, record))
  } finally {
    await removeGeneration(recordPath(deps.directory, record, 'stop'))
  }
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
    if (!isMatchingRecord(await readRecord(receipt, deps.maxRecordBytes), record)) {
      if (!hasCode(error, 'EEXIST')) throw error
      throw new Error('lease-retirement-changed', { cause: error })
    }
  } finally {
    // Every receipt outcome completes this generation's one cleanup transition.
    // Immutable routing slots still hold admission closed if retirement fails.
    await cleanGeneration(deps, record)
  }
}

async function isSameHolder(
  record: HardwareLeaseRecord,
  deps: LeaseDependencies,
): Promise<boolean> {
  try {
    const start = z.optional(nonEmptyString).parse(await deps.processStartTime(record.pid))
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
  await isPrivateDirectory(deps)
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
  // Refuse before any file exists: the OS would refuse the bind (EINVAL on macOS).
  // A Windows pipe name is 61 bytes, so the one cap holds there too.
  if (Buffer.byteLength(record.endpoint) > MAKER_LEASE_SOCKET_PATH_BYTES)
    throw new Error('lease-endpoint-too-long')
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
        let releasing: Promise<void> | undefined
        let isReleased = false
        return {
          status: 'acquired',
          record,
          release: async () => {
            if (isReleased) return
            // Concurrent callers share one transition; a later call retries failed cleanup.
            releasing ??= (async () => {
              // Close first; even endpoint failure must not bypass lease cleanup.
              try {
                closing ??= closeEndpoint()
                await closing
              } finally {
                await removeOwnedRecord(deps, record, slot)
                isReleased = true
              }
            })()
            try {
              await releasing
            } finally {
              releasing = undefined
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
      if (retired !== undefined && !isMatchingRecord(retired, previous)) return { status: 'busy' }
      if (retired === undefined) {
        const live = await readRecord(previousFile, deps.maxRecordBytes)
        if (live === null || (live !== undefined && !isMatchingRecord(live, previous)))
          return { status: 'busy' }
        const isLive = await isSameHolder(previous, deps)
        if (isCancelled()) return { status: 'cancelled' }
        if (isLive)
          return live === undefined ? { status: 'busy' } : { status: 'busy', holder: previous }
      }
      await retireGeneration(deps, previous, slot)
      slot = path.join(directory, `claim-v1.${resourceKey(resource)}.${previous.generation}.claim`)
    }
  } finally {
    if (!state.isPublished) {
      try {
        await close?.()
      } finally {
        if (hasOwnStop) await retireGeneration(deps, record, stopFile)
        if (hasOwnStopTemporary) await removeGeneration(stopTemporary)
        if (hasOwnFile && !hasOwnStop) await removeGeneration(file)
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

/** The platform's process queries: a bounded runner and, on Windows, its PowerShell. */
export interface LeaseIdentityQuery {
  readonly platform: NodeJS.Platform
  readonly run: RunProgram
  /** `windowsPowerShell(SystemRoot)`; without it every Windows answer is unknown. */
  readonly powershell?: { readonly file: string; readonly env: NodeJS.ProcessEnv } | undefined
}

// ps state and lstart; the C locale and UTC make one process print one fixed string.
const PS_START = /^(\S+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})$/

/**
 * Holder identity and, on Windows, the private-folder check (PLAN M103
 * REDM103P). `processStartTime`: undefined proves the pid absent or a zombie;
 * any doubt throws. Linux: the /proc starttime ticks. macOS: ps lstart, to
 * the second; a pid is not reused within its start second. Windows: the
 * creation FILETIME, as the process tree's checked kill compares it.
 * `isOwnerDirectory`: the current user owns the folder and only that user,
 * SYSTEM and Administrators are allowed any access; it never repairs one.
 */
export function leaseIdentity(
  query: LeaseIdentityQuery,
): Pick<LeaseDependencies, 'processStartTime' | 'isOwnerDirectory'> {
  const powershell = async (script: string) => {
    if (query.powershell === undefined) throw new Error('lease-identity-unavailable')
    const { file, env } = query.powershell
    const output = await query.run(file, [...WINDOWS_POWERSHELL_COMMAND_ARGS, script], env)
    return output.trim()
  }
  return {
    processStartTime: async (pid) => {
      let start: string | undefined
      if (query.platform === 'win32') {
        start = await powershell(
          `try{[Diagnostics.Process]::GetProcessById(${String(pid)}).StartTime.ToFileTimeUtc()}catch [ArgumentException]{'absent'}`,
        )
        if (start === 'absent') return
        start = /^\d+$/.exec(start)?.[0]
      } else if (query.platform === 'linux') {
        let stat: string
        try {
          stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
        } catch (error: unknown) {
          if (hasCode(error, 'ENOENT')) return
          throw error
        }
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        if (fields[0] === 'Z') return
        start = /^\d+$/.exec(fields[19] ?? '')?.[0]
      } else {
        let output: string
        try {
          output = await query.run('/bin/ps', ['-o', 'stat=,lstart=', '-p', String(pid)], {
            LC_ALL: 'C',
            TZ: 'UTC',
          })
        } catch (error: unknown) {
          // ps also fails for a missing pid; only the kernel's ESRCH proves absence.
          try {
            process.kill(pid, 0)
          } catch (error_: unknown) {
            if (hasCode(error_, 'ESRCH')) return
          }
          throw error
        }
        const [, state, lstart] = PS_START.exec(output.trim()) ?? []
        if (state?.startsWith('Z') === true) return
        start = lstart
      }
      if (start === undefined) throw new Error('lease-stat-unparseable')
      return start
    },
    isOwnerDirectory: async (directory) =>
      (await powershell(
        `$u=[Security.Principal.WindowsIdentity]::GetCurrent().User;$t=$u.GetType();$a=[IO.Directory]::GetAccessControl(${powerShellQuoted(directory)});$p=$a.GetOwner($t).Value -eq $u.Value;foreach($r in $a.GetAccessRules(1,1,$t)){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($u.Value,'S-1-5-18','S-1-5-32-544')){$p=0}};"$p"`,
      )) === 'True',
  }
}

/** Out-of-band: stop every leased resource. Stop never consults admission/claim records. */
export async function stopAllHardwareLeases(deps: LeaseDependencies): Promise<void> {
  const entries = (await isPrivateDirectory(deps, true)) ? await readdir(deps.directory) : []
  const resources = new Set<string>()
  let isUnreadable = false
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const record = await readRecord(path.join(deps.directory, entry), deps.maxRecordBytes)
    // An unreadable Stop index entry may be an owner whose resource is unknown.
    if (record === null) isUnreadable ||= entry.startsWith('stop-v1.')
    else if (record !== undefined) resources.add(record.resource)
  }
  const results = await Promise.allSettled(
    [...resources].map(async (resource) => {
      const { sessions } = await stopHardwareLease(deps, resource)
      // An owner that did not confirm, or that Stop could not recognise, is not stopped.
      if (sessions.some((session) => session.party !== 'contender' && session.status === 'failed'))
        throw new Error('lease-stop-unconfirmed')
    }),
  )
  if (isUnreadable || results.some((result) => result.status === 'rejected'))
    throw new Error('lease-stop-failed')
}

/** Out-of-band session discovery: Stop never consults admission/claim records. */
export async function stopHardwareLease(
  deps: LeaseDependencies,
  resource: string,
): Promise<HardwareLeaseStopResult> {
  const directory = deps.directory
  const pending: Promise<HardwareLeaseStopResult['sessions'][number] | undefined>[] = []
  const reached = new Set<string>()
  const unrecognized: (HardwareLeaseRecord | null)[] = []
  const entries = (await isPrivateDirectory(deps, true)) ? await readdir(directory) : []
  for (const entry of entries) {
    if (!entry.startsWith('stop-v1.') || !entry.endsWith('.json')) continue
    const file = path.join(directory, entry)
    const record = await readRecord(file, deps.maxRecordBytes)
    // A renamed index still belongs to the resource it names, even with another hash.
    if (
      record === undefined ||
      (!entry.startsWith(`stop-v1.${resourceKey(resource)}.`) && record?.resource !== resource)
    )
      continue
    // Never follow an entry that is not this folder's own confined record.
    if (
      record === null ||
      file !== recordPath(directory, record, 'stop') ||
      !isBoundRecord(record, deps, resource)
    ) {
      unrecognized.push(record)
      continue
    }
    reached.add(record.id)
    pending.push(
      (async () => {
        // Dispatch first: neither admission nor identity queries can gate a live Stop.
        const result = await stopRecord(deps, record)
        if (result.party !== 'unknown') return result
        const retired = await readRecord(
          recordPath(directory, record, 'retired'),
          deps.maxRecordBytes,
        )
        if (!isMatchingRecord(retired, record) && (await isSameHolder(record, deps))) return result
        try {
          await removeGeneration(file)
        } catch {
          // Proven stale discovery is never a Stop failure, even if unlink cannot finish.
        }
        return
      })(),
    )
  }
  const results = await Promise.all(pending)
  const sessions = results.filter((session) => session !== undefined)
  // Unconfirmed unless it duplicates an owner reached above or its holder is proven gone.
  for (const record of unrecognized)
    if (record === null || (!reached.has(record.id) && (await isSameHolder(record, deps))))
      sessions.push({
        party: 'unknown',
        status: 'failed',
        reason: 'lease-stop-unrecognized',
        record,
      })
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
    const fail = (reason: Extract<StopOutcome, { readonly party: 'unknown' }>['reason']) => {
      finish({ party: 'unknown', status: 'failed', reason })
    }
    socket.setTimeout(deps.timeoutMs, () => {
      fail('lease-stop-timeout')
    })
    socket.on('error', () => {
      fail('lease-stop-unavailable')
    })
    socket.once('connect', () =>
      socket.write(`${JSON.stringify({ command: 'stop', id: record.id })}\n`),
    )
    let input = ''
    socket.on('data', (chunk: Buffer) => {
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > deps.maxRecordBytes) {
        fail('lease-stop-invalid-response')
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
        else fail('lease-stop-timeout')
      } catch {
        fail('lease-stop-invalid-response')
      }
    })
    socket.once('end', () => {
      fail('lease-stop-unavailable')
    })
  })
}
