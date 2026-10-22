import { execFile, spawn } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { identityOf, lstatIdentity, sameFile } from '../../fs/fileIdentity'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_TIMEOUT_MS,
  WORKSPACE_IDENTITY_ZERO,
} from '../../../shared/constants'
import { requireLocalExecutable } from './executable'
import type { PosixPeerDependencies, PosixPeerInstallation, PosixProcessLease } from './posixPeer'

const execute = promisify(execFile)
// Captured from the Apple-signed official Ollama 0.35.1 macOS distribution.
const OLLAMA_REQUIREMENT = '=anchor apple generic and certificate leaf[subject.OU] = "3MU9H2V9Y9"'
// Native ABI permission bits; these are not application tunables.
const WRITABLE_BY_OTHERS = 0o022
const identitySchema = z.strictObject({
  pid: z.int().check(z.positive()),
  uid: z.int().check(z.nonnegative()),
  realUid: z.int().check(z.nonnegative()),
  creationTime: z.string().check(z.regex(/^[1-9]\d{6,}$/)),
  executable: z.string().check(z.minLength(1)),
})
const volumeSchema = z.strictObject({
  filesystem: z.enum(['apfs', 'hfs']),
  flags: z.int().check(z.nonnegative()),
  device: z.string().check(z.regex(/^\d+$/)),
  uid: z.int().check(z.nonnegative()),
})

async function ownedPath(file: string, uid: number): Promise<void> {
  if ((await realpath(file)) !== file) throw new Error('unverified-darwin-anchor')
  for (let current = file; ; current = path.dirname(current)) {
    const entry = await lstat(current)
    if (
      entry.isSymbolicLink() ||
      (entry.uid !== 0 && entry.uid !== uid) ||
      (entry.mode & WRITABLE_BY_OTHERS) !== 0
    )
      throw new Error('unverified-darwin-anchor')
    if (path.dirname(current) === current) break
  }
}

/** Apple signature/team, canonical owned app, and previously vetted digest. */
export async function requireDarwinInstallation(
  installed: PosixPeerInstallation,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (
    process.platform !== 'darwin' ||
    installed.platform !== 'darwin' ||
    process.getuid?.() !== installed.uid
  )
    throw new Error('unverified-platform')
  const marker = `${path.sep}Ollama.app${path.sep}Contents${path.sep}`
  const index = installed.executable.lastIndexOf(marker)
  if (index === -1 || path.basename(installed.executable) !== 'ollama')
    throw new Error('unverified-darwin-installation')
  const app = installed.executable.slice(0, index + `${path.sep}Ollama.app`.length)
  await ownedPath(installed.executable, installed.uid)
  await ownedPath(installed.modelDirectory, installed.uid)
  for (const target of [app, installed.executable]) {
    await execute(
      '/usr/bin/codesign',
      [
        '--verify',
        '--strict',
        '-R',
        `${OLLAMA_REQUIREMENT} and identifier "${target === app ? 'com.electron.ollama' : 'ai.ollama.ollama'}"`,
        target,
      ],
      {
        env: {},
        signal,
        timeout: LOCAL_JUDGE_TIMEOUT_MS,
        maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
      },
    )
  }
  await requireLocalExecutable(installed.executable, installed.executableDigest, signal)
}

/** Persistent helper: its kqueue is held until close, exit or caller cancellation. */
export async function darwinProcessLease(
  helper: string,
  pid: number,
  signal: AbortSignal,
): Promise<PosixProcessLease> {
  signal.throwIfAborted()
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid < 1)
    throw new Error('unverified-darwin-pid')
  const child = spawn(helper, ['lease', String(pid)], {
    env: {},
    stdio: ['pipe', 'pipe', 'ignore'],
    signal,
    timeout: LOCAL_JUDGE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  let fault: Error | undefined
  child.on('error', (error) => {
    fault = error
  })
  child.stdin.on('error', (error) => {
    fault = error
  })
  const finished = new Promise<void>((resolve) =>
    child.once('close', () => {
      resolve()
    }),
  )
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const lines = reader[Symbol.asyncIterator]()
  let bytes = 0
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (!(bytes > LOCAL_JUDGE_MAX_RESPONSE_BYTES)) {
      return
    }

    fault = new Error('unverified-darwin-response')
    child.kill('SIGKILL')
  })
  let isClosed = false
  const close = async () => {
    if (!isClosed) {
      isClosed = true
      child.kill('SIGKILL')
      reader.close()
    }
    await finished
  }
  const read = async (): Promise<unknown> => {
    const line = await lines.next()
    signal.throwIfAborted()
    if (fault || isClosed || line.done || child.exitCode !== null || child.signalCode !== null)
      throw new Error('unverified-darwin-lifetime', { cause: fault })
    const decoded: unknown = JSON.parse(line.value)
    return decoded
  }
  const query = (command: 'identity' | 'alive') => {
    signal.throwIfAborted()
    if (isClosed || !child.stdin.writable) throw new Error('unverified-darwin-lifetime')
    child.stdin.write(`${command}\n`)
    return read()
  }
  try {
    const initial = identitySchema.parse(await read())
    if (
      initial.pid !== pid ||
      initial.uid !== process.getuid?.() ||
      initial.realUid !== initial.uid
    )
      throw new Error('unverified-darwin-identity')
    return {
      async identity() {
        const current = identitySchema.parse(await query('identity'))
        if (JSON.stringify(current) !== JSON.stringify(initial))
          throw new Error('unverified-darwin-generation')
        return {
          pid: current.pid,
          uid: current.uid,
          creationTime: current.creationTime,
          executable: current.executable,
        }
      },
      async isAlive() {
        return z.boolean().parse(await query('alive'))
      },
      close,
    }
  } catch (error: unknown) {
    await close()
    throw error
  }
}

/** Real default for the host's macOS seam; unsupported probes throw. */
export function darwinPeerDependencies(
  helper: string,
  installed: PosixPeerInstallation,
): PosixPeerDependencies {
  return {
    async acquireProcess(pid, signal) {
      await requireDarwinInstallation(installed, signal)
      return await darwinProcessLease(helper, pid, signal)
    },
    async verifyLocalVolume(directory, platform, signal) {
      if (platform !== 'darwin' || directory !== installed.modelDirectory)
        throw new Error('unverified-model-volume')
      const pending = [directory]
      let device: bigint | undefined
      while (pending.length > 0) {
        signal.throwIfAborted()
        const current = pending.pop()
        if (!current) throw new Error('unverified-model-volume')
        const { stdout } = await execute(helper, ['volume', current], {
          env: {},
          signal,
          timeout: LOCAL_JUDGE_TIMEOUT_MS,
          maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
        })
        const decoded: unknown = JSON.parse(stdout)
        const proof = volumeSchema.parse(decoded)
        if (
          proof.uid !== installed.uid ||
          (device !== undefined && device !== BigInt(proof.device))
        )
          throw new Error('unverified-model-volume')
        device = BigInt(proof.device)
        const entries = await readdir(current, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isSymbolicLink()) throw new Error('unverified-model-volume')
          const file = path.join(current, entry.name)
          const metadata = await lstatIdentity(file)
          if (
            !sameFile(metadata, { ...identityOf(metadata), dev: device }) ||
            metadata.uid !== BigInt(installed.uid) ||
            (metadata.mode & BigInt(WRITABLE_BY_OTHERS)) !== WORKSPACE_IDENTITY_ZERO
          )
            throw new Error('unverified-model-volume')
          if (entry.isDirectory()) pending.push(file)
          else if (!entry.isFile()) throw new Error('unverified-model-volume')
        }
      }
    },
  }
}
