import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Socket } from 'node:net'
import { z } from 'zod'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_TIMEOUT_MS,
  LOCAL_JUDGE_DIGEST_HEX_LENGTH,
} from '../../../shared/constants'

const identitySchema = z.strictObject({
  pid: z.number().int().positive(),
  creationTime: z.string().regex(/^\d+$/),
  executable: z.string().min(1),
  executableDigest: z
    .string()
    .length(LOCAL_JUDGE_DIGEST_HEX_LENGTH)
    .regex(/^[a-f\d]+$/),
  ownerSid: z.string().regex(/^S-1-/),
  callerSid: z.string().regex(/^S-1-/),
})
type PeerIdentity = z.infer<typeof identitySchema>
const execute = promisify(execFile)

/** The test-only helper holds a process handle and double-reads the TCP row. */
export async function windowsPeer(helper: string, socket: Socket): Promise<PeerIdentity> {
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
  const { stdout } = await execute(
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
    },
  )
  const decoded: unknown = JSON.parse(stdout)
  return identitySchema.parse(decoded)
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
