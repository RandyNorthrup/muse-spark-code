// Linux/macOS design adapters. A native lifetime lease is REQUIRED; two
// snapshots or a listener PID alone never produce a verified peer.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, readlink, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Socket } from 'node:net'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { LOCAL_JUDGE_MAX_RESPONSE_BYTES, LOCAL_JUDGE_TIMEOUT_MS } from '../../../shared/constants'
import { verifyLinuxInstallation } from './linuxVolume'

const execute = promisify(execFile)
// Fixed /proc ABI fields and address encoding, not inference tunables.
const PROC_LAYOUT = {
  ipv4Octets: 4,
  byteMax: 255,
  hexRadix: 16,
  portWidth: 4,
  startTimeIndex: 19,
} as const
const processIdentitySchema = z.strictObject({
  pid: z.int().check(z.positive()),
  creationTime: z.string().check(z.regex(/^\d+$/)),
  executable: z.string().check(z.minLength(1)),
  uid: z.int().check(z.nonnegative()),
})

/** Native pidfd/libproc integration owns lifetime proof, never a JS PID cache. */
export interface PosixProcessLease {
  identity(): Promise<unknown>
  isAlive(): Promise<boolean>
  close(): Promise<void>
}
export interface PosixPeerInstallation {
  readonly platform: 'linux' | 'darwin'
  readonly executable: string
  readonly executableDigest: string
  readonly uid: number
  readonly modelDirectory: string
}
export interface PosixPeerDependencies {
  /** Unsupported lifecycle semantics throw, rather than returning a dummy lease. */
  acquireProcess(pid: number, signal: AbortSignal): Promise<PosixProcessLease>
  /** Native mount proof: unknown, FUSE, overlay and network volumes refuse. */
  verifyLocalVolume(
    directory: string,
    platform: 'linux' | 'darwin',
    signal: AbortSignal,
  ): Promise<void>
}

function procAddress(address: string): string {
  // /proc uses native-order 32-bit words for each address family.
  if (address === '::1') return '00000000000000000000000001000000'
  const parts = address.split('.').map(Number)
  if (
    parts.length !== PROC_LAYOUT.ipv4Octets ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0 || part > PROC_LAYOUT.byteMax)
  )
    throw new Error('unverified-tuple')
  return parts
    .toReversed()
    .map((part) => part.toString(PROC_LAYOUT.hexRadix).padStart(2, '0'))
    .join('')
    .toUpperCase()
}
function procEndpoint(address: string, port: number): string {
  return `${procAddress(address)}:${port.toString(PROC_LAYOUT.hexRadix).padStart(PROC_LAYOUT.portWidth, '0').toUpperCase()}`
}

async function hasSocketDescriptor(pid: string, files: string[], inode: string): Promise<boolean> {
  for (const fd of files) {
    let link: string
    try {
      link = await readlink(`/proc/${pid}/fd/${fd}`)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw new Error('unverified-hidden-descriptor', { cause: error })
    }
    if (link === `socket:[${inode}]`) return true
  }
  return false
}

function macEndpoint(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${String(port)}`
}

function socketTuple(socket: Socket) {
  const { remoteAddress, remotePort, localAddress, localPort } = socket
  if (!remoteAddress || !remotePort || !localAddress || !localPort)
    throw new Error('unverified-tuple')
  return { remoteAddress, remotePort, localAddress, localPort }
}

async function linuxSocket(
  socket: Socket,
  uid: number,
  signal: AbortSignal,
): Promise<{ pid: number; inode: string }> {
  const tuple = socketTuple(socket)
  const table = await readFile(
    socket.remoteFamily === 'IPv6' ? '/proc/self/net/tcp6' : '/proc/self/net/tcp',
    'utf8',
  )
  const rows = table.split('\n').slice(1)
  const local = procEndpoint(tuple.remoteAddress, tuple.remotePort)
  const remote = procEndpoint(tuple.localAddress, tuple.localPort)
  const matching = rows
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[1] === local && fields[2] === remote && fields[3] === '01')
  const row = matching[0]
  if (
    matching.length !== 1 ||
    !row?.[9] ||
    Number(row[7]) !== uid ||
    !/^\d+$/.test(row[9]) ||
    row[9] === '0'
  )
    throw new Error('unverified-socket-inode')
  const inode = row[9]
  const owners: number[] = []
  const entries = await readdir('/proc')
  const pids = entries.filter((name) => /^\d+$/.test(name))
  for (const pid of pids) {
    signal.throwIfAborted()
    let files: string[]
    let hasExpectedUid = false
    try {
      // proc directory ownership changes for nondumpable tasks. The status UID
      // fields identify same-user tasks even then; their hidden fds must refuse.
      const status = await readFile(`/proc/${pid}/status`, 'utf8')
      const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(status)
      if (!uids) throw new Error('unverified-process-owner')
      hasExpectedUid = uids.slice(1).some((value) => Number(value) === uid)
      if (!hasExpectedUid) continue
      files = await readdir(`/proc/${pid}/fd`)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      const owner = await stat(`/proc/${pid}`)
      if (hasExpectedUid || owner.uid === uid)
        throw new Error('unverified-hidden-owner', { cause: error })
      continue
    }
    if (await hasSocketDescriptor(pid, files, inode)) owners.push(Number(pid))
  }
  if (owners.length !== 1 || !owners[0]) throw new Error('unverified-socket-owner')
  return { pid: owners[0], inode }
}

async function macSocket(
  socket: Socket,
  uid: number,
  signal: AbortSignal,
): Promise<{ pid: number; inode: string }> {
  const addresses = socketTuple(socket)
  const family = socket.remoteFamily === 'IPv6' ? '6' : '4'
  const tuple = `${macEndpoint(addresses.remoteAddress, addresses.remotePort)}->${macEndpoint(addresses.localAddress, addresses.localPort)}`
  const { stdout } = await execute(
    '/usr/sbin/lsof',
    ['-nP', '-a', `-i${family}TCP`, '-sTCP:ESTABLISHED', '-F0pufnT'],
    { env: {}, timeout: LOCAL_JUDGE_TIMEOUT_MS, maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES, signal },
  )
  let pid = 0,
    owner = -1,
    name = '',
    state = ''
  const matching: number[] = []
  const flush = () => {
    if (name === tuple && state === 'ST=ESTABLISHED' && owner === uid) matching.push(pid)
    name = ''
    state = ''
  }
  for (const raw of stdout.split('\0')) {
    const field = raw.trimStart()
    if (field.startsWith('p')) {
      flush()
      pid = Number(field.slice(1))
      owner = -1
    } else if (field.startsWith('u')) owner = Number(field.slice(1))
    else if (field.startsWith('f')) flush()
    else if (field.startsWith('n')) name = field.slice(1)
    else if (field.startsWith('TST=')) state = field.slice(1)
  }
  flush()
  if (matching.length !== 1 || !matching[0]) throw new Error('unverified-socket-owner')
  return { pid: matching[0], inode: tuple }
}

/** Platform-guarded full tuple + owner + lease + canonical installation proof. */
export async function posixPeer(
  socket: Socket,
  installed: PosixPeerInstallation,
  deps: PosixPeerDependencies,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const getUid = process.getuid
  if (process.platform !== installed.platform || socket.destroyed || getUid?.() !== installed.uid)
    throw new Error('unverified-platform')
  const sample = installed.platform === 'linux' ? linuxSocket : macSocket
  const before = await sample(socket, installed.uid, signal)
  const lease = await deps.acquireProcess(before.pid, signal)
  try {
    const identity = processIdentitySchema.parse(await lease.identity())
    if (
      identity.pid !== before.pid ||
      identity.uid !== installed.uid ||
      identity.executable !== installed.executable ||
      path.basename(identity.executable) !== 'ollama'
    )
      throw new Error('unverified-runtime')
    if (installed.platform === 'linux') {
      await verifyLinuxInstallation(installed, signal)
      for (const namespace of ['net', 'user', 'mnt']) {
        if (
          (await readlink(`/proc/${String(identity.pid)}/ns/${namespace}`)) !==
          (await readlink(`/proc/self/ns/${namespace}`))
        )
          throw new Error('unverified-namespace')
      }
      const stat = await readFile(`/proc/${String(identity.pid)}/stat`, 'utf8')
      const fields = stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)
      const start = fields.at(PROC_LAYOUT.startTimeIndex)
      if (start !== identity.creationTime) throw new Error('unverified-runtime-generation')
    }
    if (
      (await realpath(installed.modelDirectory)) !== path.resolve(installed.modelDirectory) ||
      (await realpath(installed.executable)) !== installed.executable
    )
      throw new Error('unverified-model-root')
    await deps.verifyLocalVolume(installed.modelDirectory, installed.platform, signal)
    const digest = createHash('sha256')
      .update(await readFile(installed.executable))
      .digest('hex')
    if (digest !== installed.executableDigest) throw new Error('unverified-runtime')
    const after = await sample(socket, installed.uid, signal)
    const final = processIdentitySchema.parse(await lease.identity())
    signal.throwIfAborted()
    if (
      after.pid !== before.pid ||
      after.inode !== before.inode ||
      JSON.stringify(final) !== JSON.stringify(identity) ||
      !(await lease.isAlive())
    )
      throw new Error('unverified-runtime-generation')
    return JSON.stringify({ ...identity, executableDigest: digest })
  } finally {
    await lease.close()
  }
}
