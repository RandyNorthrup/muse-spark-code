import path from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Socket } from 'node:net'
import * as z from 'zod/mini'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_TIMEOUT_MS,
  LOCAL_JUDGE_DIGEST_HEX_LENGTH,
} from '../../../shared/constants'
import { executeGuarded } from './guardedExec'

const identitySchema = z.strictObject({
  pid: z.int().check(z.positive()),
  creationTime: z.string().check(z.regex(/^\d+$/)),
  executable: z.string().check(z.minLength(1)),
  executableDigest: z
    .string()
    .check(z.minLength(LOCAL_JUDGE_DIGEST_HEX_LENGTH), z.maxLength(LOCAL_JUDGE_DIGEST_HEX_LENGTH))
    .check(z.regex(/^[a-f\d]+$/)),
  ownerSid: z.string().check(z.regex(/^S-1-/)),
  callerSid: z.string().check(z.regex(/^S-1-/)),
})
type PeerIdentity = z.infer<typeof identitySchema>

/** The native helper holds a process handle and double-reads the TCP row. */
export async function windowsPeer(
  helper: string,
  socket: Socket,
  signal?: AbortSignal,
): Promise<PeerIdentity> {
  signal?.throwIfAborted()
  if (
    process.platform !== 'win32' ||
    !socket.remoteAddress ||
    !socket.remotePort ||
    !socket.localAddress ||
    !socket.localPort ||
    socket.destroyed
  ) {
    throw new Error('unverified-peer')
  }
  const { stdout } = await executeGuarded(
    helper,
    [
      socket.remoteAddress,
      String(socket.remotePort),
      socket.localAddress,
      String(socket.localPort),
    ],
    {
      windowsHide: true,
      timeout: LOCAL_JUDGE_TIMEOUT_MS,
      maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
      // No credential environment goes to the helper.
      env: { SystemRoot: process.env['SystemRoot'] },
      signal,
    },
  )
  const decoded: unknown = JSON.parse(stdout)
  return identitySchema.parse(decoded)
}

/** Canonical model roots on fixed NTFS only; UNC/mapped drives are unverified. */
export async function windowsModelDirectory(
  helper: string,
  directory: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (process.platform !== 'win32' || path.resolve(directory) !== (await realpath(directory)))
    throw new Error('unverified-model-root')
  const { stdout } = await executeGuarded(helper, ['root', directory], {
    windowsHide: true,
    timeout: LOCAL_JUDGE_TIMEOUT_MS,
    maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
    env: { SystemRoot: process.env['SystemRoot'] },
    signal,
  })
  const decoded: unknown = JSON.parse(stdout)
  z.strictObject({ local: z.literal(true) }).parse(decoded)
}

/** Compare process generation as well as PID; a retained TTL proves nothing. */
export function requireInstalledPeer(
  actual: PeerIdentity,
  installed: { executable: string; ownerSid: string; executableDigest: string },
  previous?: PeerIdentity,
): void {
  if (
    path.win32.normalize(actual.executable).toLowerCase() !==
      path.win32.normalize(installed.executable).toLowerCase() ||
    path.win32.basename(actual.executable).toLowerCase() !== 'ollama.exe' ||
    actual.ownerSid !== installed.ownerSid ||
    actual.ownerSid !== actual.callerSid ||
    actual.executableDigest !== installed.executableDigest ||
    (previous !== undefined &&
      (actual.pid !== previous.pid ||
        actual.creationTime !== previous.creationTime ||
        actual.executable !== previous.executable ||
        actual.executableDigest !== previous.executableDigest ||
        actual.ownerSid !== previous.ownerSid))
  ) {
    throw new Error('unverified-runtime')
  }
}
