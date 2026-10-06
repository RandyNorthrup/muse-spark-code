// The injected platform store is VS Code SecretStorage on a qualified local host.
// No filesystem, settings, environment, log or child-process fallback exists.
import type { KeyObject } from 'node:crypto'
import { DEVICE_LIMITS } from '../../shared/constants'
import type { DeviceInvitation } from '../../shared/devices'
import { DevicePairingError, devicePrivateKey } from '../../core/devices/pairing'
import type { SecretStore } from '../auth/credentialStore'

export interface DeviceExecutionHost {
  readonly ui: 'desktop' | 'web'
  readonly remoteName: string | undefined
  readonly execution: 'local' | 'remote' | 'headless'
  readonly secretLocation: 'execution-host' | 'client' | 'unknown'
}
export function assertLocalDeviceHost(host: DeviceExecutionHost): void {
  if (
    host.ui !== 'desktop' ||
    host.remoteName !== undefined ||
    host.execution !== 'local' ||
    host.secretLocation !== 'execution-host'
  )
    throw new DevicePairingError('unsupported-host')
}
function secretName(invitationId: string): string {
  if (!/^[a-f0-9]{32}$(?![\s\S])/.test(invitationId)) throw new DevicePairingError('invalid-frame')
  return `museSpark.devices.privateKey.v${String(DEVICE_LIMITS.protocolVersion)}.${invitationId}`
}
export class DeviceSecrets {
  public constructor(
    private readonly store: SecretStore,
    private readonly host: DeviceExecutionHost,
  ) {}
  public async save(invitation: DeviceInvitation, pem: string, now: number): Promise<void> {
    assertLocalDeviceHost(this.host)
    devicePrivateKey(invitation, pem, now)
    const name = secretName(invitation.invitationId)
    let hasAttemptedWrite = false
    try {
      if ((await this.store.get(name)) !== undefined) throw new DevicePairingError('storage')
      hasAttemptedWrite = true
      await this.store.store(name, pem)
      await this.key(invitation, now)
    } catch {
      if (hasAttemptedWrite) await this.remove(invitation.invitationId)
      throw new DevicePairingError('storage')
    }
  }
  public async key(invitation: DeviceInvitation, now: number): Promise<KeyObject> {
    assertLocalDeviceHost(this.host)
    const loaded: { pem: string | undefined } = { pem: undefined }
    try {
      loaded.pem = await this.store.get(secretName(invitation.invitationId))
      if (
        loaded.pem === undefined ||
        loaded.pem === '' ||
        Buffer.byteLength(loaded.pem) > DEVICE_LIMITS.certificateBase64Chars
      )
        throw new DevicePairingError('storage')
      return devicePrivateKey(invitation, loaded.pem, now)
    } catch {
      throw new DevicePairingError('storage')
    } finally {
      loaded.pem = undefined
    }
  }
  public async remove(invitationId: string): Promise<void> {
    assertLocalDeviceHost(this.host)
    try {
      await this.store.delete(secretName(invitationId))
    } catch {
      throw new DevicePairingError('storage')
    }
  }
}
