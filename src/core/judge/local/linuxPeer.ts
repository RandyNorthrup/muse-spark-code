import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import * as z from 'zod/mini'
import { LOCAL_JUDGE_TIMEOUT_MS } from '../../../shared/constants'
import type { PosixPeerDependencies, PosixProcessLease } from './posixPeer'
import { verifyLinuxAnchor, verifyLinuxLocalVolume } from './linuxVolume'

const snapshotSchema = z.discriminatedUnion('alive', [
  z.strictObject({ alive: z.literal(false) }),
  z.strictObject({
    alive: z.literal(true),
    identity: z.strictObject({
      pid: z.int().check(z.positive()),
      uid: z.int().check(z.nonnegative()),
      creationTime: z.string().check(z.regex(/^\d+$/)),
      executable: z.string().check(z.minLength(1)),
    }),
  }),
])

/** The trusted native helper owns a pidfd for this entire lease, never a PID cache. */
async function acquireLinuxProcess(
  helper: string,
  pid: number,
  callerSignal: AbortSignal,
): Promise<PosixProcessLease> {
  const getUid = process.getuid
  const uid = getUid?.()
  if (uid === undefined || pid < 1 || process.platform !== 'linux' || !Number.isSafeInteger(pid))
    throw new Error('unverified-native-lifetime')
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(LOCAL_JUDGE_TIMEOUT_MS)])
  await verifyLinuxAnchor(helper, uid, 'file', signal)
  signal.throwIfAborted()
  const child = spawn(helper, [String(pid)], { env: {}, stdio: ['pipe', 'pipe', 'ignore'] })
  const reader = createInterface({ input: child.stdout })
  const lines = reader[Symbol.asyncIterator]()
  let isClosed = false
  let hasFault = false
  child.on('error', () => {
    hasFault = true
    reader.close()
  })
  child.stdin.on('error', () => {
    hasFault = true
    reader.close()
  })
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => {
      resolve()
    }),
  )
  const abort = () => {
    child.kill()
    reader.close()
  }
  signal.addEventListener('abort', abort, { once: true })
  const close = async () => {
    if (isClosed) return
    isClosed = true
    signal.removeEventListener('abort', abort)
    child.stdin.end('q\n')
    child.kill()
    reader.close()
    await exited
  }
  const snapshot = async () => {
    signal.throwIfAborted()
    if (isClosed || hasFault) throw new Error('unverified-native-lifetime')
    const next = lines.next()
    child.stdin.write('i\n')
    const line = await next
    signal.throwIfAborted()
    if (line.done) throw new Error('unverified-native-lifetime')
    const decoded: unknown = JSON.parse(line.value)
    return snapshotSchema.parse(decoded)
  }
  try {
    const initial = await snapshot()
    if (!initial.alive || initial.identity.pid !== pid || initial.identity.uid !== uid)
      throw new Error('unverified-native-lifetime')
    return {
      async identity() {
        const value = await snapshot()
        if (!value.alive || JSON.stringify(value.identity) !== JSON.stringify(initial.identity))
          throw new Error('unverified-runtime-generation')
        return value.identity
      },
      async isAlive() {
        const value = await snapshot()
        return value.alive
      },
      close,
    }
  } catch (error: unknown) {
    await close()
    throw error
  }
}

export function createLinuxPeerDependencies(helper: string): PosixPeerDependencies {
  return {
    acquireProcess: (pid, signal) => acquireLinuxProcess(helper, pid, signal),
    async verifyLocalVolume(directory, platform, signal) {
      if (platform !== 'linux') throw new Error('unverified-platform')
      await verifyLinuxLocalVolume(directory, signal)
    },
  }
}
