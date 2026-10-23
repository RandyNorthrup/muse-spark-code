// Real completed device pairs for the suites: two invitations with real
// EC keypairs, confirmed both ways. Shared so the pair-building lines
// live once for the duplication gate.
import {
  confirmDeviceFingerprint,
  createDeviceInvitation,
  type DevicePair,
} from '../../../src/core/devices/pairing'

export const devicePairEndpoint = { address: '127.0.0.1', port: 8443 }

export function completeDevicePair(
  localDevice: string,
  peerDevice: string,
  now: number,
): { pair: DevicePair; localPem: string; peerPem: string } {
  const local = createDeviceInvitation(devicePairEndpoint, localDevice, now, now + 24 * 3600 * 1000)
  const peer = createDeviceInvitation(devicePairEndpoint, peerDevice, now, now + 24 * 3600 * 1000)
  return {
    pair: {
      local: local.invitation,
      peer: peer.invitation,
      localConfirmation: confirmDeviceFingerprint(
        local.invitation,
        peer.invitation,
        local.privateKeyPem,
        peer.invitation.fingerprint,
        now,
      ),
      peerConfirmation: confirmDeviceFingerprint(
        peer.invitation,
        local.invitation,
        peer.privateKeyPem,
        local.invitation.fingerprint,
        now,
      ),
    },
    localPem: local.privateKeyPem,
    peerPem: peer.privateKeyPem,
  }
}
