// Required only by an explicit Devices action. No editor API or runtime fallback.
import { randomBytes, X509Certificate } from 'node:crypto'
import { DevicePanel } from '../../core/devices/devicePanel'
import { DevicePairingError } from '../../core/devices/pairing'
import type { AttemptJournal } from '../../core/devices/attemptJournal'
import { DEVICE_LIMITS, DEVICE_MODEL_TEXT } from '../../shared/constants'
import {
  deviceWebviewMessageSchema,
  type DeviceHostMessage,
  type DevicesPanelState,
} from '../../shared/devicesPanel'
import type { DeviceFrame, DEVICE_FAILURES } from '../../shared/devices'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { DevicePairing, type DevicePairingDeps } from './devicePairing'
import { assertLocalDeviceHost } from './deviceSecrets'
import {
  DeviceReceiver,
  type DeviceReceiverExecution,
  type DeviceReceiverPolicy,
} from './deviceReceiver'
import { DeviceTransport, type DeviceTransportPair } from './deviceTransport'
import type { DeviceChannel, DeviceChannelPort } from './deviceChannel'
import { handleDeviceRequest } from './deviceMessageHandler'

// Storage is provisioned/opened by the qualified editor after loading this bundle.
export { DeviceStore } from './deviceStore'
export {
  openDeviceProductionDeps,
  unboundDeviceLanePorts,
  type DeviceLanePorts,
  type DeviceProductionBundle,
  type DeviceProductionContext,
  type DeviceProductionDeps,
} from './deviceProduction'
export { startWindowsStorageProtection } from './windowsStorageProtection'
export type { DeviceStorageProtection } from '../../core/devices/storageProtection'
export { DeviceSecrets } from './deviceSecrets'
export { AttemptJournal } from '../../core/devices/attemptJournal'
export { DeviceDiscovery } from './deviceDiscovery'
export { createDeviceMdnsPort, decodeDeviceMdnsPacket } from './deviceMdns'
export { DeviceDiscoverySwitch } from './deviceDiscoverySwitch'
export { encodeQrInviteText, decodeScannedInviteText } from './qrInvite'

type Failure = (typeof DEVICE_FAILURES)[number]
export interface DeviceServiceDeps extends Omit<DevicePairingDeps, 'disconnectPair'> {
  readonly journal: AttemptJournal
  readonly execution: DeviceReceiverExecution
  readonly policy: Omit<DeviceReceiverPolicy, 'currentGrant'>
  readonly source: DeviceChannelPort
  readonly snapshot: () => Promise<DevicesPanelState>
  readonly publish: (message: DeviceHostMessage) => void
  readonly report: (reason: Failure) => void
}

/** All callers supply actual local authorities; construction grants no listener or execution. */
export async function createDeviceService(deps: DeviceServiceDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  assertLocalDeviceHost(deps.host)
  const transport = new DeviceTransport()
  const active = new Set<string>()
  const lifetime = { isDisposed: false }
  const isDisposed = () => lifetime.isDisposed
  const pairing = new DevicePairing({
    ...deps,
    disconnectPair(pairId) {
      active.delete(pairId)
      receiver.disconnect('revoked', pairId)
      transport.revoke(pairId)
    },
  })
  const receiver = await DeviceReceiver.open(
    deps.receiverIncarnationId,
    deps.journal,
    deps.execution,
    {
      ...deps.policy,
      async currentGrant(request) {
        const { row } = await pairing.material(request.identity.pairId, undefined)
        await pairing.authorize(row.pair.peer.fingerprint, request)
        const grant = row.grants.find((item) => item.offer.grantId === request.grantId)
        if (grant === undefined) throw new DevicePairingError('grant')
        return grant
      },
    },
  )
  const panel = new DevicePanel({
    perform: (request) => {
      if (lifetime.isDisposed) throw new DevicePairingError('revoked')
      return pairing.handle(request)
    },
    snapshot: deps.snapshot,
    publish(message) {
      if (!isDisposed()) deps.publish(message)
    },
  })
  async function observe(): Promise<void> {
    if (isDisposed()) return
    const message = await panel.observe()
    if (!isDisposed()) panel.publishObservation(message)
  }
  let observation: Promise<void> | undefined
  let shouldObserve = false
  function observed(): Promise<void> {
    if (isDisposed()) return Promise.resolve()
    // One running capture and one latest-state pending capture per panel.
    shouldObserve = true
    observation ??= (async () => {
      try {
        while (shouldObserve && !isDisposed()) {
          shouldObserve = false
          try {
            await observe()
          } catch {
            deps.report('storage')
          }
        }
      } finally {
        observation = undefined
      }
    })()
    return observation
  }
  const receiverPort: DeviceChannelPort = {
    connected(channel) {
      void (async () => {
        try {
          const { row } = await pairing.material(channel.pairId, undefined)
          channel.send({
            version: DEVICE_LIMITS.protocolVersion,
            pairId: channel.pairId,
            receiverIncarnationId: deps.receiverIncarnationId,
            requestId: randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'),
            body: { kind: 'offers', offers: row.grants.map((grant) => grant.offer) },
          })
          void observed()
        } catch {
          channel.close()
        }
      })()
    },
    async receive(frame, channel) {
      // E starts authenticated Stop before any journal/pairing/observation wait.
      await receiver.receive(frame, channel)
      const pending = observed()
      // Keep snapshot backpressure inside T's counted data-frame drain. Stop
      // uses T's independent reserved control path and never waits on the panel.
      if (frame.body.kind !== 'cancel') await pending
    },
    disconnected(reason, channel) {
      // Framing reset starts every local Stop before the reporting observer.
      receiver.disconnect(reason, channel.pairId)
      deps.report(reason)
      void observed()
    },
  }
  async function material(pairId: string, isOffering: boolean) {
    const { row, key } = await pairing.material(pairId, undefined, isOffering)
    if (lifetime.isDisposed) throw new Error('revoked')
    active.add(pairId)
    const pair: DeviceTransportPair = {
      pairId,
      receiverIncarnationId: deps.receiverIncarnationId,
      certificate: new X509Certificate(
        Buffer.from(row.pair.local.certificateDerBase64, 'base64'),
      ).toString(),
      privateKey: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fingerprint: row.pair.local.fingerprint,
      peerCertificate: new X509Certificate(
        Buffer.from(row.pair.peer.certificateDerBase64, 'base64'),
      ).toString(),
      peerFingerprint: row.pair.peer.fingerprint,
      isActive: () => active.has(pairId),
      isOffered: () => isOffering && active.has(pairId),
    }
    return { pair, endpoint: row.endpoint, localEndpoint: row.pair.local.endpoint }
  }
  return {
    panel,
    pairing,
    receiver,
    observe,
    async request(input: unknown, signal?: AbortSignal): Promise<DeviceHostMessage> {
      const parsed = deviceWebviewMessageSchema.safeParse(input)
      if (!parsed.success || isDisposed() || signal?.aborted === true)
        throw new Error('invalid-device-message')
      return parsed.data.type === 'devicesReady'
        ? await panel.ready()
        : await handleDeviceRequest(parsed.data, panel, signal)
    },
    // Model guidance is consumed only by a qualified local lane adapter.
    // Phase-2 contracts ride the same lazy reader; later lanes bind them.
    taskContext: () =>
      `${DEVICE_MODEL_TEXT.deviceTaskContext}\n\n${DEVICE_MODEL_TEXT.deviceApprovalWait}\n\n${DEVICE_MODEL_TEXT.deviceChannelPacing}\n\n${DEVICE_MODEL_TEXT.deviceGrantAdmission}\n\n${DEVICE_MODEL_TEXT.deviceResultChannel}\n\n${DEVICE_MODEL_TEXT.deviceOwnerBinding}`,
    async listen(pairId: string): Promise<() => void> {
      const { pair, localEndpoint } = await material(pairId, true)
      return await transport.listen(pair, localEndpoint.address, localEndpoint.port, receiverPort)
    },
    async connect(pairId: string): Promise<DeviceChannel> {
      const { pair, endpoint, localEndpoint } = await material(pairId, false)
      return await transport.connect(
        pair,
        endpoint.address,
        endpoint.port,
        localEndpoint.address,
        deps.source,
      )
    },
    // Native/editor method bridges use the same authenticated receiver port.
    receive: (frame: DeviceFrame, channel: DeviceChannel) => receiverPort.receive(frame, channel),
    disconnected(reason: Failure, channel: DeviceChannel) {
      receiverPort.disconnected(reason, channel)
    },
    dispose() {
      lifetime.isDisposed = true
      for (const pairId of active) {
        receiver.disconnect('revoked', pairId)
        transport.revoke(pairId)
      }
      active.clear()
    },
  }
}
