import { expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { EN } from '../../../src/shared/l10n/en'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import type {
  DeviceHostMessage,
  DevicesPanelState,
  DeviceWebviewRequest,
} from '../../../src/shared/devicesPanel'
import type {
  DeviceCaps,
  DeviceInvitation,
  DeviceOffer,
  DevicePairingConfirmation,
} from '../../../src/shared/devices'

export const UI_DEVICE_ID = '1'.repeat(32)
export const UI_PAIR_ID = '2'.repeat(32)
export const UI_BOARD_ID = '3'.repeat(32)
export const UI_FINGERPRINT = '4'.repeat(64)
export const uiCaps: DeviceCaps = {
  workers: 1,
  processes: 2,
  heavyChecks: 1,
  tokens: 1000,
  spendUsd: 1,
  artifactBytes: 1024,
}
export const uiInvitation: DeviceInvitation = {
  version: 1,
  invitationId: '5'.repeat(32),
  deviceId: UI_DEVICE_ID,
  fingerprint: UI_FINGERPRINT,
  certificateDerBase64: 'AAAA',
  endpoint: { address: '10.2.3.4', port: 32_123 },
  issuedAt: 1000,
  expiresAt: 2000,
}
export const uiConfirmation: DevicePairingConfirmation = {
  version: 1,
  pairId: UI_PAIR_ID,
  localInvitationId: uiInvitation.invitationId,
  peerInvitationId: '6'.repeat(32),
  localFingerprint: UI_FINGERPRINT,
  peerFingerprint: '7'.repeat(64),
  transcriptDigest: '8'.repeat(64),
  confirmedAt: 1500,
  signatureBase64: 'AAAA',
}
export const uiOffer: DeviceOffer = {
  deviceId: UI_DEVICE_ID,
  receiverIncarnationId: '9'.repeat(32),
  poolId: 'a'.repeat(32),
  repositoryId: 'b'.repeat(32),
  grantId: 'c'.repeat(32),
  grantRevision: 1,
  platform: 'darwin',
  toolchainDigest: 'd'.repeat(64),
  lanes: true,
  checks: true,
  caps: uiCaps,
  checkIds: ['e'.repeat(32)],
  entries: [
    {
      entryId: 'f'.repeat(32),
      roleId: UI_BOARD_ID,
      model: { providerId: 'local', modelId: 'qualified-model' },
      capabilities: {
        vision: false,
        tools: true,
        structuredOutput: true,
        hostedSearch: false,
        reasoningEffort: false,
      },
      readiness: 'ready',
      payer: 'local',
      caps: uiCaps,
    },
  ],
}
export const uiDevice: Extract<DevicesPanelState, { enabled: true }>['devices'][number] = {
  deviceId: UI_DEVICE_ID,
  pairId: UI_PAIR_ID,
  label: 'Mac receiver',
  fingerprint: UI_FINGERPRINT,
  endpoint: uiInvitation.endpoint,
  status: 'connected',
  waitingApprovals: 0,
  unresolvedAttempts: 0,
  retainedLiabilityUsd: 0,
  offers: [uiOffer],
}
export function uiMessage(change: Partial<typeof uiDevice> = {}): DeviceHostMessage {
  return {
    type: 'deviceState',
    revision: 1,
    state: { enabled: true, discoveryEnabled: false, devices: [{ ...uiDevice, ...change }] },
  }
}
export function uiPort(response: DeviceHostMessage = uiMessage()) {
  let revision = response.revision
  return {
    request: vi.fn((request: DeviceWebviewRequest) =>
      Promise.resolve({
        ...response,
        revision: ++revision,
        setup: { ...response.setup, viewId: request.viewId, requestId: request.requestId },
      }),
    ),
  }
}

export function uiDeferredPort() {
  const first = Promise.withResolvers<DeviceHostMessage>()
  const second = Promise.withResolvers<DeviceHostMessage>()
  const port = {
    request: vi
      .fn((_request: DeviceWebviewRequest) => first.promise)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise),
  }
  return { port, first, second }
}

export async function expireDeviceUiWait(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.uiRequestTimeoutMs)
}

export async function resolveDeviceUiReply(
  held: PromiseWithResolvers<DeviceHostMessage>,
  request: DeviceWebviewRequest | undefined,
  response: DeviceHostMessage,
): Promise<void> {
  if (request === undefined) throw new Error('missing local UI request')
  held.resolve({
    ...response,
    setup: { ...response.setup, viewId: request.viewId, requestId: request.requestId },
  })
  await held.promise
}

export function uiUncertainMessage(revision = 3): DeviceHostMessage {
  return {
    ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
    revision,
  }
}

export async function expectRejectedDeviceInvitation(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: EN.devices.pair }).disabled).toBe(
      false,
    )
  })
  expect(screen.queryByLabelText(EN.devices.copyInvitation)).toBeNull()
  expect(screen.queryByRole('heading', { name: EN.devices.peerFingerprint })).toBeNull()
  expect(screen.queryByRole('button', { name: EN.devices.confirmFingerprint })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain(EN.devices.invalidMessage)
  expect(screen.getByText('Retained spending liability: $3.00')).not.toBeNull()
}
