import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import {
  DEVICE_STATUSES,
  devicesPanelStateSchema,
  deviceHostMessageSchema,
  deviceWebviewRequestSchema,
  deviceWebviewMessageSchema,
  parseDeviceHostMessage,
  parseDeviceWebviewRequest,
  type DevicesPanelState,
} from '../../src/shared/devicesPanel'
import {
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
  type DeviceHostMessage,
  type DeviceWebviewRequest,
  type DevicesPanelPort,
} from '../../src/shared/protocol'

const ID = 'a'.repeat(32)
const HASH = 'c'.repeat(64)
const endpoint = { address: '10.0.0.1', port: 12_345 }
const caps = {
  workers: 1,
  processes: 2,
  heavyChecks: 1,
  tokens: 100,
  spendUsd: 1,
  artifactBytes: 1024,
}
const row = {
  deviceId: ID,
  pairId: ID,
  label: 'Test receiver',
  fingerprint: HASH,
  endpoint,
  status: 'connected',
  waitingApprovals: 0,
  unresolvedAttempts: 1,
  retainedLiabilityUsd: 1,
  offers: [],
} satisfies Extract<DevicesPanelState, { enabled: true }>['devices'][number]
const state: DevicesPanelState = { enabled: true, discoveryEnabled: false, devices: [row] }

describe('M100 Devices panel and shared bridge', () => {
  it('accepts only the strict Devices document handshake beside existing action requests', () => {
    expect(deviceWebviewMessageSchema.safeParse({ type: 'devicesReady' }).success).toBe(true)
    for (const raw of [
      { type: 'ready' },
      { type: 'tasksReady' },
      { type: 'devicesReady', action: { kind: 'pair' } },
      { type: 'devicesReady', secret: 'private-sentinel' },
      null,
    ])
      expect(deviceWebviewMessageSchema.safeParse(raw).success).toBe(false)
    expect(parseDeviceWebviewRequest({ type: 'devicesReady' }).ok).toBe(false)
  })

  it('requires the view identity, request identity and initiating snapshot revision on every request', () => {
    const request = {
      type: 'deviceRequest',
      viewId: ID,
      requestId: ID,
      revision: 3,
      action: { kind: 'pair' },
    }
    expect(parseDeviceWebviewRequest(request).ok).toBe(true)
    for (const change of [
      { viewId: undefined },
      { viewId: '' },
      { viewId: ID + '\n' },
      { requestId: undefined },
      { revision: undefined },
      { revision: -1 },
      { revision: 1.5 },
    ])
      expect(parseDeviceWebviewRequest({ ...request, ...change }).ok).toBe(false)
    expect(
      parseDeviceHostMessage({
        type: 'deviceState',
        revision: 3,
        state: { enabled: false },
        setup: { requestId: ID },
      }).ok,
    ).toBe(false)
  })

  it('requires an ordered snapshot revision, including off observations and action replies', () => {
    const message = { type: 'deviceState', state: { enabled: false } }
    for (const revision of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(parseDeviceHostMessage({ ...message, revision }).ok).toBe(false)
    for (const revision of [0, 1, 2])
      expect(parseDeviceHostMessage({ ...message, revision }).ok).toBe(true)
  })
  it('rejects MAX_SAFE_INTEGER and out-of-range observation dates at the host boundary', () => {
    for (const lastObservedAt of [Number.MAX_SAFE_INTEGER, DEVICE_LIMITS.observationMaxMs + 1])
      expect(
        parseDeviceHostMessage({
          type: 'deviceState',
          revision: 1,
          state: { ...state, devices: [{ ...row, lastObservedAt }] },
        }).ok,
      ).toBe(false)
    expect(
      parseDeviceHostMessage({
        type: 'deviceState',
        revision: 1,
        state: { ...state, devices: [{ ...row, lastObservedAt: DEVICE_LIMITS.observationMaxMs }] },
      }).ok,
    ).toBe(true)
  })
  it('supplies exact translated manifest handoffs without registering unused production keys', () => {
    const handoffSchema = z.record(
      z.string(),
      z.strictObject({
        'command.pairDevice.title': z.string(),
        'config.devices.description': z.string(),
        'config.deviceDiscovery.description': z.string(),
      }),
    )
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../../docs/certification/m100-manifest-strings.json', import.meta.url),
        'utf8',
      ),
    )
    const handoff = handoffSchema.parse(raw)
    expect(new Set(Object.keys(handoff))).toEqual(new Set(['en', ...TABLE_LOCALES]))
    for (const locale of ['en', ...TABLE_LOCALES]) {
      const tableRaw: unknown =
        locale === 'en'
          ? EN
          : JSON.parse(
              readFileSync(new URL(`../../l10n/ui.${locale}.json`, import.meta.url), 'utf8'),
            )
      const table = z
        .object({
          devices: z.object({
            pair: z.string(),
            settingsDescription: z.string(),
            discoveryDescription: z.string(),
          }),
        })
        .parse(tableRaw)
      expect(handoff[locale]).toEqual({
        'command.pairDevice.title': table.devices.pair,
        'config.devices.description': table.devices.settingsDescription,
        'config.deviceDiscovery.description': table.devices.discoveryDescription,
      })
    }
  })
  it('keeps the off state empty and available without starting any device service', () => {
    expect(devicesPanelStateSchema.parse({ enabled: false })).toEqual({ enabled: false })
    expect(devicesPanelStateSchema.safeParse({ enabled: false, devices: [row] }).success).toBe(
      false,
    )
    expect(
      devicesPanelStateSchema.safeParse({ enabled: false, discoveryEnabled: true }).success,
    ).toBe(false)
    expect(
      parseDeviceHostMessage({ type: 'deviceState', revision: 1, state: { enabled: false } }).ok,
    ).toBe(true)
  })
  it('keeps Devices off the ordinary chat route', () => {
    expect(
      parseHostToWebviewMessage({ type: 'deviceState', revision: 1, state: { enabled: false } }).ok,
    ).toBe(false)
    expect(
      parseWebviewToHostMessage({
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action: { kind: 'pair' },
      }).ok,
    ).toBe(false)
    expect(
      parseDeviceWebviewRequest({
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action: { kind: 'pair', detail: '/private/fixture' },
      }),
    ).toEqual({ ok: false, error: 'invalid-device-message' })
  })
  it('carries observations and local setup facts, with no safety/liveness proof', () => {
    for (const status of DEVICE_STATUSES) {
      expect(
        devicesPanelStateSchema.safeParse({ ...state, devices: [{ ...row, status }] }).success,
      ).toBe(true)
    }
    const message: DeviceHostMessage = {
      type: 'deviceState',
      revision: 1,
      state,
      setup: {
        viewId: ID,
        requestId: ID,
        listenerApplication: 'Test extension host',
        interfaceLabel: 'Test LAN',
        failure: 'blocked-or-unreachable',
      },
    }
    expect(deviceHostMessageSchema.parse(message)).toEqual(message)
    expect(parseDeviceHostMessage(message)).toEqual({ ok: true, message })
    expect(
      deviceHostMessageSchema.safeParse({
        ...message,
        setup: { viewId: ID, requestId: ID, error: '/private/fixture' },
      }).success,
    ).toBe(false)
    expect(
      devicesPanelStateSchema.safeParse({ ...state, devices: [{ ...row, stopped: true }] }).success,
    ).toBe(false)
  })
  it('round-trips every local action through both schemas and the existing chat bridge', () => {
    const actions: DeviceWebviewRequest['action'][] = [
      { kind: 'pair' },
      { kind: 'importInvitation', text: 'Public test invitation' },
      { kind: 'confirmFingerprint', invitationId: ID, fingerprint: HASH },
      {
        kind: 'importConfirmation',
        confirmation: {
          version: 1,
          pairId: ID,
          localInvitationId: ID,
          peerInvitationId: 'b'.repeat(32),
          localFingerprint: HASH,
          peerFingerprint: 'd'.repeat(64),
          transcriptDigest: HASH,
          confirmedAt: 1000,
          signatureBase64: 'AAAA',
        },
      },
      { kind: 'setAddress', pairId: ID, endpoint },
      { kind: 'setDiscovery', enabled: false },
      { kind: 'offer', pairId: ID, lanes: true, checks: true, caps },
      { kind: 'pauseOffers', pairId: ID },
      { kind: 'unlink', pairId: ID },
      { kind: 'resumeQueue', pairId: ID, boardId: ID },
    ]
    for (const action of actions) {
      const message: DeviceWebviewRequest = {
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action,
      }
      expect(deviceWebviewRequestSchema.parse(message)).toEqual(message)
      expect(parseDeviceWebviewRequest(message)).toEqual({ ok: true, message })
    }
  })
  it.each(['key', 'repositoryPath', 'command', 'paidConsent', 'retirementProof'])(
    'refuses %s in a local request',
    (field) => {
      const message = {
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action: {
          kind: 'offer',
          pairId: ID,
          lanes: true,
          checks: true,
          caps,
          [field]: 'fixture-sentinel',
        },
      }
      expect(parseDeviceWebviewRequest(message).ok).toBe(false)
      expect(
        parseDeviceWebviewRequest({
          ...message,
          action: { kind: 'pair' },
          [field]: 'fixture-sentinel',
        }).ok,
      ).toBe(false)
    },
  )
  it('bounds invitations, rows, labels, observations, counters and retained liability', () => {
    expect(
      parseDeviceWebviewRequest({
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action: {
          kind: 'importInvitation',
          text: 'x'.repeat(DEVICE_LIMITS.invitationTextChars + 1),
        },
      }).ok,
    ).toBe(false)
    expect(
      devicesPanelStateSchema.safeParse({
        ...state,
        devices: Array.from({ length: DEVICE_LIMITS.pairedDevices + 1 }, () => row),
      }).success,
    ).toBe(false)
    for (const change of [
      { deviceId: 'x'.repeat(32) },
      { deviceId: ID + '\n' },
      { fingerprint: HASH + '\n' },
      { unresolvedAttempts: DEVICE_LIMITS.unresolvedAttempts + 1 },
      { fingerprint: 'f'.repeat(63) },
      { label: 'x'.repeat(DEVICE_LIMITS.labelChars + 1) },
      { label: '' },
      { lastObservedAt: -1 },
      { lastObservedAt: Number.MAX_SAFE_INTEGER + 1 },
      { waitingApprovals: DEVICE_LIMITS.unresolvedAttempts + 1 },
      { unresolvedAttempts: -1 },
      { retainedLiabilityUsd: Infinity },
      { retainedLiabilityUsd: -1 },
      { retainedLiabilityUsd: DEVICE_LIMITS.spendUsd * DEVICE_LIMITS.unresolvedAttempts + 1 },
      {
        offers: Array.from({ length: DEVICE_LIMITS.repositories + 1 }, () => ({
          deviceId: ID,
          receiverIncarnationId: ID,
          poolId: ID,
          repositoryId: ID,
          grantId: ID,
          grantRevision: 1,
          platform: 'darwin',
          toolchainDigest: HASH,
          lanes: false,
          checks: true,
          caps,
          entries: [],
          checkIds: [ID],
        })),
      },
    ])
      expect(
        devicesPanelStateSchema.safeParse({ ...state, devices: [{ ...row, ...change }] }).success,
      ).toBe(false)
    expect(
      parseDeviceWebviewRequest({
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: '',
        action: { kind: 'pair' },
      }).ok,
    ).toBe(false)
  })
  it('allows a host to inject the validated portable bridge with explicit unsupported-host failure', async () => {
    const port: DevicesPanelPort = {
      request: (message) =>
        Promise.resolve(
          deviceHostMessageSchema.parse({
            type: 'deviceState',
            revision: 1,
            state: { enabled: false },
            setup: {
              viewId: message.viewId,
              requestId: message.requestId,
              failure: 'unsupported-host',
            },
          }),
        ),
    }
    const response = await port.request(
      deviceWebviewRequestSchema.parse({
        type: 'deviceRequest',
        revision: 1,
        viewId: ID,
        requestId: ID,
        action: { kind: 'pair' },
      }),
    )
    expect(parseDeviceHostMessage(response).ok).toBe(true)
    expect(response.setup?.failure).toBe('unsupported-host')
  })
})
