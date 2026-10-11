import { type SshHardwarePort } from './ports'
import { parsePublicKey, sshFingerprint } from './keys'
import { sshFailure } from './wire'
function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw sshFailure()
}
/** A successful return transfers the nonexportable reference to C. P disposes failed acquisitions. */
export async function generateHardwareSshKey(
  port: SshHardwarePort,
  signal: AbortSignal,
): Promise<{
  algorithm: 'ecdsa-p256'
  keyReference: string
  publicKey: string
  fingerprint: string
}> {
  checkActive(signal)
  const result = await port.generate(signal)
  try {
    checkActive(signal)
    if (
      !result.keyReference ||
      parsePublicKey(result.publicBlob).algorithm !== 'ecdsa-sha2-nistp256'
    )
      throw sshFailure()
    return {
      algorithm: 'ecdsa-p256',
      keyReference: result.keyReference,
      publicKey: `ecdsa-sha2-nistp256 ${result.publicBlob.toString('base64')}`,
      fingerprint: sshFingerprint(result.publicBlob),
    }
  } catch {
    await port.destroy(result.keyReference)
    throw sshFailure()
  }
}
