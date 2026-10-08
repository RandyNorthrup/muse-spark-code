// Lane D: one slim pairing host for lane tests. Phase-1 suites keep their
// own harnesses; this builder shares the memory secret store instead.
import { DevicePairing } from '../../../src/host/devices/devicePairing'
import type { DeviceStore } from '../../../src/host/devices/deviceStore'
import { DeviceSecrets, type DeviceExecutionHost } from '../../../src/host/devices/deviceSecrets'
import type { DeviceWebviewRequest } from '../../../src/shared/devicesPanel'
import { deviceTestExpiry, deviceTestNow } from './deviceFixtures'
import { memorySecrets } from './fakes'

export const laneTestHost: DeviceExecutionHost = {
  ui: 'desktop',
  remoteName: undefined,
  execution: 'local',
  secretLocation: 'execution-host',
}

function laneSetup() {
  return Promise.resolve({
    certificateExpiresAt: deviceTestExpiry,
    interfaceLabel: 'lo',
    listenerApplication: 'node',
    endpoint: { address: '127.0.0.1', port: 34_567 },
  })
}

function denyLaneAction(request: DeviceWebviewRequest) {
  return Promise.resolve({
    viewId: request.viewId,
    requestId: request.requestId,
    failure: 'grant' as const,
  })
}

type LanePairingAct = (
  action: DeviceWebviewRequest['action'],
) => Promise<Awaited<ReturnType<DevicePairing['handle']>>>

/**
 * Completes mutual pairing between two lane-test hosts over typed invitation
 * text: pair, import each other's text, confirm the shown fingerprints and
 * import the confirmations. Returns the first side's pair id with the second
 * side's fingerprint, the pin that materials it. Throws on any failed step.
 */
export async function completeLaneMutualPairing(
  first: LanePairingAct,
  second: LanePairingAct,
): Promise<{ pairId: string; fingerprint: string }> {
  const firstReply = await first({ kind: 'pair' })
  const secondReply = await second({ kind: 'pair' })
  const firstInvite = firstReply.invitation
  const secondInvite = secondReply.invitation
  if (firstInvite === undefined || secondInvite === undefined) throw new Error('No test invitation')
  const firstImported = await first({
    kind: 'importInvitation',
    text: JSON.stringify(secondInvite),
  })
  if (firstImported.failure !== undefined) throw new Error('Lane invitation import failed')
  const secondImported = await second({
    kind: 'importInvitation',
    text: JSON.stringify(firstInvite),
  })
  if (secondImported.failure !== undefined) throw new Error('Lane invitation import failed')
  const firstConfirmed = await first({
    kind: 'confirmFingerprint',
    invitationId: secondInvite.invitationId,
    fingerprint: secondInvite.fingerprint,
  })
  if (firstConfirmed.failure !== undefined) throw new Error('Lane fingerprint confirm failed')
  const secondConfirmed = await second({
    kind: 'confirmFingerprint',
    invitationId: firstInvite.invitationId,
    fingerprint: firstInvite.fingerprint,
  })
  if (secondConfirmed.failure !== undefined) throw new Error('Lane fingerprint confirm failed')
  const firstConfirmation = firstConfirmed.confirmation
  const secondConfirmation = secondConfirmed.confirmation
  if (firstConfirmation === undefined || secondConfirmation === undefined)
    throw new Error('No test confirmation')
  const firstCompleted = await first({
    kind: 'importConfirmation',
    confirmation: secondConfirmation,
  })
  if (firstCompleted.failure !== undefined) throw new Error('Lane confirmation import failed')
  const secondCompleted = await second({
    kind: 'importConfirmation',
    confirmation: firstConfirmation,
  })
  if (secondCompleted.failure !== undefined) throw new Error('Lane confirmation import failed')
  return { pairId: firstConfirmation.pairId, fingerprint: secondInvite.fingerprint }
}

export function startLaneTestHost(store: DeviceStore, host: DeviceExecutionHost = laneTestHost) {
  const adapter = new DevicePairing({
    store,
    host,
    setup: laneSetup,
    otherAction: denyLaneAction,
    disconnectPair: () => undefined,
    secrets: new DeviceSecrets(memorySecrets(), host),
    now: () => deviceTestNow,
    receiverIncarnationId: '1'.repeat(32),
  })
  const act = (action: DeviceWebviewRequest['action']) =>
    adapter.handle({
      action,
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
    })
  return { adapter, act }
}
