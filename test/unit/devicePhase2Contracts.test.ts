import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS, DEVICE_MODEL_TEXT } from '../../src/shared/constants'
import {
  DEVICE_GRANT_REFUSALS,
  DEVICE_RESULT_DISPOSITIONS,
  DEVICE_STEP_UP_METHODS,
  DEVICE_STREAMS,
  DEVICE_THROTTLE_REASONS,
  canOpenHandshake,
  deviceCapabilitySchema,
  deviceChannelSchema,
  deviceGrantRefusalSchema,
  deviceGrantRequestSchema,
  deviceGrantSchema,
  deviceHeartbeatSchema,
  deviceReadySchema,
  deviceResultAckSchema,
  deviceResultEnvelopeSchema,
  deviceStepUpSchema,
  deviceThrottledSchema,
  handshakeBackoffMs,
  canRetryAuth,
  type DeviceActionGrantPort,
  type DeviceCapability,
  type DeviceCapabilityPort,
  type DeviceChannelMessage,
  type DeviceChannelPort,
  type DeviceGrant,
  type DeviceStream,
  type DeviceGrantRequest,
  type DeviceHeartbeat,
  type DeviceReady,
  type DeviceResultAck,
  type DeviceResultEnvelope,
  type DeviceResultPort,
  type DeviceStepUpApproval,
  type DeviceThrottled,
} from '../../src/shared/devices'

const ID = 'a'.repeat(32)
const OTHER_ID = 'b'.repeat(32)
const HASH = 'c'.repeat(64)
const STREAMS: DeviceStream[] = ['control', 'status', 'events', 'logs', 'bulk']
const ready: DeviceReady = {
  version: 1,
  pairId: ID,
  receiverIncarnationId: ID,
  requestId: ID,
  streams: STREAMS,
}
const heartbeat: DeviceHeartbeat = {
  version: 1,
  pairId: ID,
  receiverIncarnationId: ID,
  sequence: 4,
  ackSequence: 3,
}
const capability: DeviceCapability = {
  version: 1,
  deviceId: ID,
  receiverIncarnationId: ID,
  observedAt: 1000,
  platform: 'win32',
  osVersion: 'Windows 11 build 26200',
  tools: ['node', 'git'],
  engines: [{ model: { providerId: 'local', modelId: 'model/example:latest' }, budget: 'ok' }],
  presence: { touchId: false, windowsHello: true, tpm: true, secureEnclave: false },
  power: 'ac',
  sleepInhibited: true,
  slotCap: 5,
  pressure: { cpuPercent: 12, memoryPercent: 40, diskPercent: 61, transportResets: 0 },
}
const grantRequest: DeviceGrantRequest = {
  version: 1,
  pairId: ID,
  ownerId: ID,
  roleId: ID,
  mode: 'manual',
  repositoryId: ID,
  lanes: true,
  checks: false,
  quota: {
    workers: 1,
    processes: 2,
    heavyChecks: 1,
    tokens: 100,
    spendUsd: 1,
    artifactBytes: 1024,
  },
}
const grant: DeviceGrant = {
  ...grantRequest,
  grantId: ID,
  grantRevision: 1,
  issuedAt: 1000,
  expiresAt: 3_601_000,
  requiresStepUp: true,
}
const stepUp: DeviceStepUpApproval = {
  version: 1,
  grantId: ID,
  actionDigest: HASH,
  presence: 'windows-hello',
  approvedAt: 2000,
  expiresAt: 302_000,
}
const envelope: DeviceResultEnvelope = {
  version: 1,
  identity: { pairId: ID, receiverIncarnationId: ID, boardId: ID, taskId: ID, attemptId: ID },
  epoch: 1,
  checkpoint: HASH,
  resultDigest: HASH,
  resultBytes: 1024,
  recordedAt: 3000,
}
const ack: DeviceResultAck = {
  version: 1,
  identity: envelope.identity,
  epoch: 1,
  resultDigest: HASH,
  settlementId: ID,
  disposition: 'accepted',
  acknowledgedAt: 4000,
}

describe('M100 phase-2 channel contracts (lane C reads)', () => {
  it('parses ready, heartbeat and throttled with the protocol version', () => {
    expect(deviceChannelSchema.parse({ kind: 'ready', ready })).toEqual({
      kind: 'ready',
      ready,
    })
    expect(deviceChannelSchema.parse({ kind: 'heartbeat', heartbeat })).toEqual({
      kind: 'heartbeat',
      heartbeat,
    })
    const throttled: DeviceThrottled = {
      version: 1,
      pairId: ID,
      unknownSince: 5000,
      reason: 'peer-penalty',
    }
    expect(deviceChannelSchema.parse({ kind: 'throttled', throttled })).toEqual({
      kind: 'throttled',
      throttled,
    })
  })
  it('refuses a wrong version on every channel envelope', () => {
    expect(deviceReadySchema.safeParse({ ...ready, version: 2 }).success).toBe(false)
    expect(deviceHeartbeatSchema.safeParse({ ...heartbeat, version: 2 }).success).toBe(false)
    expect(
      deviceThrottledSchema.safeParse({
        version: 2,
        pairId: ID,
        unknownSince: 1,
        reason: 'pressure',
      }).success,
    ).toBe(false)
  })
  it('has no probe kind and no offline throttle state', () => {
    expect(
      deviceChannelSchema.safeParse({ kind: 'probe', pairId: ID, requestId: ID }).success,
    ).toBe(false)
    expect(
      deviceThrottledSchema.safeParse({
        version: 1,
        pairId: ID,
        unknownSince: 1,
        reason: 'offline',
      }).success,
    ).toBe(false)
    expect(DEVICE_THROTTLE_REASONS).not.toContain('offline')
  })
  it('refuses unknown fields instead of dropping them', () => {
    expect(deviceReadySchema.safeParse({ ...ready, cipher: 'downgrade' }).success).toBe(false)
    expect(
      deviceHeartbeatSchema.safeParse({ ...heartbeat, sequence: 5, extra: true }).success,
    ).toBe(false)
  })
  it('refuses an ack past the sent sequence and an empty stream set', () => {
    expect(deviceHeartbeatSchema.safeParse({ ...heartbeat, ackSequence: 5 }).success).toBe(false)
    expect(deviceReadySchema.safeParse({ ...ready, streams: [] }).success).toBe(false)
    expect(
      deviceReadySchema.safeParse({ ...ready, streams: [...DEVICE_STREAMS, 'control'] }).success,
    ).toBe(false)
  })
  it('serializes channel fixtures within the channel byte cap', () => {
    const messages: DeviceChannelMessage[] = [
      { kind: 'ready', ready },
      { kind: 'heartbeat', heartbeat },
    ]
    for (const message of messages) {
      expect(deviceChannelSchema.parse(message)).toEqual(message)
      expect(JSON.stringify(message).length).toBeLessThanOrEqual(DEVICE_LIMITS.channelFrameBytes)
    }
  })
  it('paces handshakes and stops after one failed authentication (G29, G31)', () => {
    expect(DEVICE_LIMITS.pendingHandshakes).toBe(3)
    expect(canOpenHandshake(0)).toBe(true)
    expect(canOpenHandshake(2)).toBe(true)
    expect(canOpenHandshake(3)).toBe(false)
    expect(canOpenHandshake(-1)).toBe(false)
    expect(handshakeBackoffMs(1)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs)
    expect(handshakeBackoffMs(2)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs * 2)
    expect(handshakeBackoffMs(3)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs * 4)
    expect(handshakeBackoffMs(10)).toBe(DEVICE_LIMITS.handshakeBackoffMaxMs)
    expect(handshakeBackoffMs(100)).toBe(DEVICE_LIMITS.handshakeBackoffMaxMs)
    expect(canRetryAuth(0)).toBe(true)
    expect(canRetryAuth(1)).toBe(false)
    expect(canRetryAuth(2)).toBe(false)
  })
})

describe('M100 phase-2 capability contracts (lane V reads)', () => {
  it('parses a measured Windows advertisement with pressure signals', () => {
    expect(deviceCapabilitySchema.parse(capability)).toEqual(capability)
  })
  it('refuses a wrong version, stale platform or missing G30 truth', () => {
    expect(deviceCapabilitySchema.safeParse({ ...capability, version: 2 }).success).toBe(false)
    expect(deviceCapabilitySchema.safeParse({ ...capability, platform: 'freebsd' }).success).toBe(
      false,
    )
    const { slotCap: _slot, power: _power, ...withoutTruth } = capability
    expect(deviceCapabilitySchema.safeParse(withoutTruth).success).toBe(false)
  })
  it('refuses duplicate tools, duplicate engines and oversized lists', () => {
    expect(
      deviceCapabilitySchema.safeParse({ ...capability, tools: ['node', 'node'] }).success,
    ).toBe(false)
    expect(
      deviceCapabilitySchema.safeParse({
        ...capability,
        engines: [...capability.engines, ...capability.engines],
      }).success,
    ).toBe(false)
    expect(
      deviceCapabilitySchema.safeParse({
        ...capability,
        tools: Array.from(
          { length: DEVICE_LIMITS.capabilityTools + 1 },
          (_, index) => `tool-${String(index)}`,
        ),
      }).success,
    ).toBe(false)
  })
  it('serializes the advertisement within the capability byte cap', () => {
    expect(JSON.stringify(capability).length).toBeLessThanOrEqual(DEVICE_LIMITS.capabilityBytes)
  })
})

describe('M100 phase-2 grant contracts (lanes A and K read)', () => {
  it('parses an owner-bound grant, its request and its refusal', () => {
    expect(deviceGrantRequestSchema.parse(grantRequest)).toEqual(grantRequest)
    expect(deviceGrantSchema.parse(grant)).toEqual(grant)
    const refusal = {
      version: 1,
      pairId: ID,
      ownerId: OTHER_ID,
      reason: 'owner-mismatch',
      retryable: false,
    }
    expect(deviceGrantRefusalSchema.parse(refusal)).toEqual(refusal)
    expect(DEVICE_GRANT_REFUSALS).toContain('owner-mismatch')
  })
  it('refuses a wrong version on request, grant, step-up and refusal', () => {
    expect(deviceGrantRequestSchema.safeParse({ ...grantRequest, version: 2 }).success).toBe(false)
    expect(deviceGrantSchema.safeParse({ ...grant, version: 2 }).success).toBe(false)
    expect(deviceStepUpSchema.safeParse({ ...stepUp, version: 2 }).success).toBe(false)
    expect(
      deviceGrantRefusalSchema.safeParse({
        version: 0,
        pairId: ID,
        ownerId: ID,
        reason: 'scope-denied',
        retryable: true,
      }).success,
    ).toBe(false)
  })
  it('bounds grant and step-up validity windows', () => {
    expect(
      deviceGrantSchema.safeParse({
        ...grant,
        expiresAt: grant.issuedAt + DEVICE_LIMITS.grantValidityMs + 1,
      }).success,
    ).toBe(false)
    expect(deviceGrantSchema.safeParse({ ...grant, expiresAt: grant.issuedAt }).success).toBe(false)
    expect(deviceStepUpSchema.parse(stepUp)).toEqual(stepUp)
    expect(
      deviceStepUpSchema.safeParse({
        ...stepUp,
        expiresAt: stepUp.approvedAt + DEVICE_LIMITS.stepUpValidityMs + 1,
      }).success,
    ).toBe(false)
  })
  it('carries no credential field: planted secrets refuse to parse', () => {
    for (const shape of [deviceGrantRequestSchema, deviceGrantSchema, deviceStepUpSchema]) {
      expect(shape.safeParse({ ...grantRequest, password: 'secret-sentinel' }).success).toBe(false)
      expect(shape.safeParse({ ...grantRequest, bearer: 'secret-sentinel' }).success).toBe(false)
      expect(shape.safeParse({ ...grantRequest, apiKey: 'secret-sentinel' }).success).toBe(false)
    }
  })
  it('admits only device-answered presence: no faked kind parses', () => {
    expect(deviceStepUpSchema.safeParse({ ...stepUp, presence: 'none' }).success).toBe(false)
    expect(deviceStepUpSchema.safeParse({ ...stepUp, presence: 'orchestrator' }).success).toBe(
      false,
    )
    expect(DEVICE_STEP_UP_METHODS).toEqual(['touch-id', 'windows-hello', 'local-confirm'])
  })
  it('serializes grant fixtures within the grant byte cap', () => {
    expect(JSON.stringify(grant).length).toBeLessThanOrEqual(DEVICE_LIMITS.grantBytes)
  })
})

describe('M100 phase-2 result contracts (lane R reads)', () => {
  it('parses an envelope and each disposition exactly once', () => {
    expect(deviceResultEnvelopeSchema.parse(envelope)).toEqual(envelope)
    for (const disposition of DEVICE_RESULT_DISPOSITIONS) {
      expect(deviceResultAckSchema.parse({ ...ack, disposition })).toEqual({
        ...ack,
        disposition,
      })
    }
  })
  it('refuses a wrong version and epoch zero', () => {
    expect(deviceResultEnvelopeSchema.safeParse({ ...envelope, version: 2 }).success).toBe(false)
    expect(deviceResultAckSchema.safeParse({ ...ack, version: 2 }).success).toBe(false)
    expect(deviceResultEnvelopeSchema.safeParse({ ...envelope, epoch: 0 }).success).toBe(false)
    expect(deviceResultAckSchema.safeParse({ ...ack, epoch: 0 }).success).toBe(false)
  })
  it('serializes the envelope within the result byte cap', () => {
    expect(JSON.stringify(envelope).length).toBeLessThanOrEqual(DEVICE_LIMITS.resultEnvelopeBytes)
  })
})

describe('M100 phase-2 injected ports (later lanes implement, tests inject fakes)', () => {
  it('admits an owner grant, refuses a wrong owner and attests step-up', async () => {
    const steppedUp: DeviceStepUpApproval[] = []
    const port: DeviceActionGrantPort = {
      admit: (request) => {
        if (request.ownerId !== ID)
          return Promise.resolve({
            version: 1,
            pairId: request.pairId,
            ownerId: request.ownerId,
            reason: 'owner-mismatch',
            retryable: false,
          })
        return Promise.resolve({ ...grant, pairId: request.pairId, ownerId: request.ownerId })
      },
      attestStepUp: (approval) => {
        steppedUp.push(approval)
        return Promise.resolve()
      },
    }
    const admitted = await port.admit(grantRequest)
    expect(deviceGrantSchema.parse(admitted)).toEqual({ ...grant, pairId: ID, ownerId: ID })
    const refused = await port.admit({ ...grantRequest, ownerId: OTHER_ID })
    expect(deviceGrantRefusalSchema.parse(refused).reason).toBe('owner-mismatch')
    await port.attestStepUp(stepUp)
    expect(deviceStepUpSchema.parse(steppedUp[0])).toEqual(stepUp)
  })
  it('opens a ready channel, beats its heart and closes it', async () => {
    const opened: DeviceReady[] = []
    const beats: DeviceHeartbeat[] = []
    let isClosed = false
    const port: DeviceChannelPort = {
      open: (input) => {
        opened.push(deviceReadySchema.parse(input))
        return Promise.resolve()
      },
      heartbeat: (input) => {
        beats.push(deviceHeartbeatSchema.parse(input))
        return Promise.resolve()
      },
      close: () => {
        isClosed = true
        return Promise.resolve()
      },
    }
    await port.open(ready)
    await port.heartbeat(heartbeat)
    await port.close()
    expect(opened).toEqual([ready])
    expect(beats).toEqual([heartbeat])
    expect(isClosed).toBe(true)
  })
  it('snapshots capabilities and publishes results exactly once', async () => {
    const capabilityPort: DeviceCapabilityPort = {
      snapshot: () => Promise.resolve(deviceCapabilitySchema.parse(capability)),
    }
    expect(await capabilityPort.snapshot()).toEqual(capability)
    const seen = new Set<string>()
    const resultPort: DeviceResultPort = {
      publish: (result) => {
        const parsed = deviceResultEnvelopeSchema.parse(result)
        const disposition = seen.has(parsed.resultDigest) ? 'duplicate' : 'accepted'
        seen.add(parsed.resultDigest)
        return Promise.resolve(deviceResultAckSchema.parse({ ...ack, disposition }))
      },
    }
    const first = await resultPort.publish(envelope)
    const second = await resultPort.publish(envelope)
    expect(first.disposition).toBe('accepted')
    expect(second.disposition).toBe('duplicate')
  })
})

describe('M100 phase-2 model text (declared lazy readers)', () => {
  it('adds pacing, admission, result and owner guidance to the lazy reader', () => {
    for (const key of [
      'deviceChannelPacing',
      'deviceGrantAdmission',
      'deviceResultChannel',
      'deviceOwnerBinding',
    ] as const) {
      expect(DEVICE_MODEL_TEXT[key].length).toBeGreaterThan(100)
    }
    expect(DEVICE_MODEL_TEXT.deviceChannelPacing).toContain('Never probe ports')
    expect(DEVICE_MODEL_TEXT.deviceGrantAdmission).toContain('never faked')
    expect(DEVICE_MODEL_TEXT.deviceResultChannel).toContain('quarantine')
    expect(DEVICE_MODEL_TEXT.deviceOwnerBinding).toContain('vault')
    const entry = readFileSync(
      new URL('../../src/host/devices/deviceEntry.ts', import.meta.url),
      'utf8',
    )
    for (const key of [
      'deviceTaskContext',
      'deviceApprovalWait',
      'deviceChannelPacing',
      'deviceGrantAdmission',
      'deviceResultChannel',
      'deviceOwnerBinding',
    ]) {
      expect(entry).toContain(`DEVICE_MODEL_TEXT.${key}`)
    }
  })
})

describe('M100 phase-2 D100 amendments (lane 0 adds first)', () => {
  it('registers G29, G30 and G31 against M100 before lane C enforces them', () => {
    const register = readFileSync(
      new URL('../../docs/orchestration-gotchas.md', import.meta.url),
      'utf8',
    )
    for (const row of ['G29', 'G30', 'G31']) expect(register).toContain(`| ${row} `)
    expect(register).toContain('at most 3 pending handshakes')
    expect(register).toContain('STATUS_DLL_INIT_FAILED')
    expect(register).toContain('never retry in a loop')
    const owners = register.split('\n').filter((line) => /\| G(29|30|31) /.test(line))
    expect(owners).toHaveLength(3)
    for (const line of owners) {
      expect(line).toContain('M100')
      expect(line).toContain('amend')
    }
  })
  it('covers owner binding, QR/mDNS, Windows store and per-action control with a D101 reconcile note', () => {
    const model = readFileSync(
      new URL('../../docs/certification/m100-threat-model.md', import.meta.url),
      'utf8',
    )
    for (const obligation of [
      'owner binding',
      'QR',
      'mDNS',
      'Windows store',
      'per-action',
      'D101',
      'G29',
      'G30',
      'G31',
    ])
      expect(model).toContain(obligation)
  })
})
