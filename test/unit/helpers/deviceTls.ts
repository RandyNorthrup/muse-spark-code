// Real pinned-TLS identities for the device suites: invitations with real
// EC keypairs and self-signed certificates, as PEM with fingerprints,
// valid for a day from creation.
import { createDeviceInvitation } from '../../../src/core/devices/pairing'

export interface DeviceTlsIdentity {
  readonly pem: string
  readonly keyPem: string
  readonly fingerprint: string
}

function certificatePem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

export function deviceTlsIdentity(deviceId: string, port: number): DeviceTlsIdentity {
  const now = Date.now()
  const made = createDeviceInvitation(
    { address: '127.0.0.1', port },
    deviceId,
    now,
    now + 24 * 3600 * 1000,
  )
  return {
    pem: certificatePem(made.invitation.certificateDerBase64),
    keyPem: made.privateKeyPem,
    fingerprint: made.invitation.fingerprint,
  }
}
