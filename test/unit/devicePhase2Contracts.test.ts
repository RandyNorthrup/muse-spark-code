import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS, DEVICE_MODEL_TEXT } from '../../src/shared/constants'
import {
  DEVICE_GRANT_MODE_ORDER,
  DEVICE_GRANT_REFUSALS,
  DEVICE_RESULT_DISPOSITIONS,
  DEVICE_STEP_UP_METHODS,
  DEVICE_STREAMS,
  DEVICE_THROTTLE_REASONS,
  isAckForEnvelope,
  canOpenHandshake,
  canQueueResultAck,
  grantCeilingRefusal,
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
  type DeviceGrantCeiling,
  type DeviceGrantRefusal,
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
const noJitter = () => 0
const halfJitter = () => 0.5
const fullJitter = () => 1
const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
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
  it('paces handshakes and stops after one failed authentication (G50, G52)', () => {
    expect(DEVICE_LIMITS.pendingHandshakes).toBe(3)
    expect(canOpenHandshake(0)).toBe(true)
    expect(canOpenHandshake(2)).toBe(true)
    expect(canOpenHandshake(3)).toBe(false)
    expect(canOpenHandshake(-1)).toBe(false)
    expect(canRetryAuth(0)).toBe(true)
    expect(canRetryAuth(1)).toBe(false)
    expect(canRetryAuth(2)).toBe(false)
  })
  it('jitters the backoff from an injected source within the stated bound (G50)', () => {
    expect(DEVICE_LIMITS.handshakeBackoffJitter).toBe(0.25)
    expect(handshakeBackoffMs(1, noJitter)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs)
    expect(handshakeBackoffMs(2, noJitter)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs * 2)
    expect(handshakeBackoffMs(3, noJitter)).toBe(DEVICE_LIMITS.handshakeBackoffBaseMs * 4)
    expect(handshakeBackoffMs(10, noJitter)).toBe(DEVICE_LIMITS.handshakeBackoffMaxMs)
    expect(handshakeBackoffMs(100, noJitter)).toBe(DEVICE_LIMITS.handshakeBackoffMaxMs)
    expect(handshakeBackoffMs(1, fullJitter)).toBe(
      DEVICE_LIMITS.handshakeBackoffBaseMs * (1 - DEVICE_LIMITS.handshakeBackoffJitter),
    )
    expect(handshakeBackoffMs(2, fullJitter)).toBe(
      DEVICE_LIMITS.handshakeBackoffBaseMs * 2 * (1 - DEVICE_LIMITS.handshakeBackoffJitter),
    )
    expect(handshakeBackoffMs(1, halfJitter)).toBe(
      DEVICE_LIMITS.handshakeBackoffBaseMs * (1 - DEVICE_LIMITS.handshakeBackoffJitter / 2),
    )
    for (const failures of [1, 2, 3, 10, 100]) {
      const nominal = Math.min(
        DEVICE_LIMITS.handshakeBackoffBaseMs * 2 ** (failures - 1),
        DEVICE_LIMITS.handshakeBackoffMaxMs,
      )
      for (const source of [noJitter, halfJitter, fullJitter]) {
        const jittered = handshakeBackoffMs(failures, source)
        expect(jittered).toBeLessThanOrEqual(nominal)
        expect(jittered).toBeGreaterThanOrEqual(
          nominal * (1 - DEVICE_LIMITS.handshakeBackoffJitter),
        )
        expect(jittered).toBeLessThanOrEqual(DEVICE_LIMITS.handshakeBackoffMaxMs)
      }
    }
    const deflected = handshakeBackoffMs(1)
    expect(deflected).toBeLessThanOrEqual(DEVICE_LIMITS.handshakeBackoffBaseMs)
    expect(deflected).toBeGreaterThanOrEqual(
      DEVICE_LIMITS.handshakeBackoffBaseMs * (1 - DEVICE_LIMITS.handshakeBackoffJitter),
    )
  })
})

describe('M100 phase-2 capability contracts (lane V reads)', () => {
  it('parses a measured Windows advertisement with pressure signals', () => {
    expect(deviceCapabilitySchema.parse(capability)).toEqual(capability)
  })
  it('refuses a wrong version, stale platform or missing G51 truth', () => {
    expect(deviceCapabilitySchema.safeParse({ ...capability, version: 2 }).success).toBe(false)
    expect(deviceCapabilitySchema.safeParse({ ...capability, platform: 'freebsd' }).success).toBe(
      false,
    )
    const { slotCap: _slot, power: _power, ...withoutTruth } = capability
    expect(deviceCapabilitySchema.safeParse(withoutTruth).success).toBe(false)
  })
  it('refuses duplicate tools and duplicate engines, at any list length', () => {
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
        tools: Array.from({ length: 70 }, (_, index) => `tool-${String(index)}`),
      }).success,
    ).toBe(true)
  })
  it('serializes the advertisement within the capability byte cap', () => {
    expect(utf8Bytes(capability)).toBeLessThanOrEqual(DEVICE_LIMITS.capabilityBytes)
  })
  it('counts the byte cap in UTF-8 bytes, not string length', () => {
    // Each name is 60 code units but about three times as many UTF-8
    // bytes, so string length stays under the cap while the wire size exceeds it.
    const wide: DeviceCapability = {
      ...capability,
      tools: Array.from({ length: 60 }, (_, index) => `t${String(index)}-`.padEnd(60, '你')),
    }
    expect(JSON.stringify(wide).length).toBeLessThanOrEqual(DEVICE_LIMITS.capabilityBytes)
    expect(utf8Bytes(wide)).toBeGreaterThan(DEVICE_LIMITS.capabilityBytes)
    expect(deviceCapabilitySchema.safeParse(wide).success).toBe(false)
  })
  it('refuses a field-valid advertisement that serializes past the byte cap', () => {
    const full: DeviceCapability = {
      ...capability,
      tools: Array.from({ length: 100 }, (_, index) => `tool-${String(index)}-`.padEnd(100, 'x')),
      pressure: { ...capability.pressure, transportResets: Number.MAX_SAFE_INTEGER },
    }
    expect(JSON.stringify(full).length).toBeGreaterThan(DEVICE_LIMITS.capabilityBytes)
    expect(deviceCapabilitySchema.safeParse(full).success).toBe(false)
    expect(deviceCapabilitySchema.parse(capability)).toEqual(capability)
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

describe('M100 phase-2 queue caps (lane R reads)', () => {
  it('locks pendingResultAcks behind a callable guard', () => {
    expect(DEVICE_LIMITS.pendingResultAcks).toBe(256)
    expect(canQueueResultAck(DEVICE_LIMITS.pendingResultAcks - 1)).toBe(true)
    expect(canQueueResultAck(DEVICE_LIMITS.pendingResultAcks)).toBe(false)
  })
  it('refuses negative, fractional and non-finite counts on the queue guard', () => {
    expect(canQueueResultAck(0)).toBe(true)
    expect(canQueueResultAck(-1)).toBe(false)
    expect(canQueueResultAck(1.5)).toBe(false)
    expect(canQueueResultAck(NaN)).toBe(false)
    expect(canQueueResultAck(Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})

describe('M100 phase-2 grant ceiling (lanes A and K read)', () => {
  const ceiling: DeviceGrantCeiling = {
    mode: 'manual',
    quota: { ...grantRequest.quota },
  }
  it('orders modes plan < manual < acceptEdits < auto', () => {
    expect(DEVICE_GRANT_MODE_ORDER).toEqual(['plan', 'manual', 'acceptEdits', 'auto'])
    expect(grantCeilingRefusal(grantRequest, ceiling)).toBe(null)
    expect(grantCeilingRefusal({ ...grantRequest, mode: 'plan' }, ceiling)).toBe(null)
    for (const mode of ['acceptEdits', 'auto'] as const) {
      const refusal = grantCeilingRefusal({ ...grantRequest, mode }, ceiling)
      expect(deviceGrantRefusalSchema.parse(refusal)).toEqual({
        version: 1,
        pairId: grantRequest.pairId,
        ownerId: grantRequest.ownerId,
        reason: 'scope-denied',
        retryable: false,
      })
    }
  })
  it('refuses a grant wider than the ceiling on every quota field', () => {
    const fields = [
      'workers',
      'processes',
      'heavyChecks',
      'tokens',
      'spendUsd',
      'artifactBytes',
    ] as const
    expect(fields).toHaveLength(6)
    for (const field of fields) {
      const quota = { ...grantRequest.quota }
      quota[field] += 1
      const widened: DeviceGrantRequest = { ...grantRequest, quota }
      const refusal: DeviceGrantRefusal | null = grantCeilingRefusal(widened, ceiling)
      expect(refusal?.reason).toBe('scope-denied')
      expect(deviceGrantRefusalSchema.parse(refusal)).toEqual({
        ...refusal,
        version: 1,
        pairId: grantRequest.pairId,
        ownerId: grantRequest.ownerId,
      })
    }
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

describe('M100 phase-2 injected ports (later lanes implement; tests use inline port closures)', () => {
  it('admits an owner grant, refuses a wrong owner and a widened grant, and attests step-up', async () => {
    const steppedUp: DeviceStepUpApproval[] = []
    const ceiling: DeviceGrantCeiling = { mode: 'manual', quota: { ...grantRequest.quota } }
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
        const overCeiling = grantCeilingRefusal(request, ceiling)
        return overCeiling
          ? Promise.resolve(overCeiling)
          : Promise.resolve({ ...grant, pairId: request.pairId, ownerId: request.ownerId })
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
    const widened = await port.admit({ ...grantRequest, mode: 'auto' })
    expect(deviceGrantRefusalSchema.parse(widened).reason).toBe('scope-denied')
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
        const key = `${String(parsed.epoch)}:${parsed.resultDigest}`
        const disposition = seen.has(key) ? 'duplicate' : 'accepted'
        seen.add(key)
        return Promise.resolve(
          deviceResultAckSchema.parse({ ...ack, epoch: parsed.epoch, disposition }),
        )
      },
    }
    const first = await resultPort.publish(envelope)
    const second = await resultPort.publish(envelope)
    expect(first.disposition).toBe('accepted')
    expect(second.disposition).toBe('duplicate')
  })
  it('binds an acknowledgement to its epoch: an old-epoch ack never settles a new epoch', async () => {
    const settled = new Set<string>()
    const resultPort: DeviceResultPort = {
      publish: (result) => {
        const parsed = deviceResultEnvelopeSchema.parse(result)
        const key = `${String(parsed.epoch)}:${parsed.resultDigest}`
        const disposition = settled.has(key) ? 'duplicate' : 'accepted'
        settled.add(key)
        return Promise.resolve(
          deviceResultAckSchema.parse({ ...ack, epoch: parsed.epoch, disposition }),
        )
      },
    }
    const nextEpoch = { ...envelope, epoch: 2 }
    const oldAck = await resultPort.publish(envelope)
    expect(isAckForEnvelope(oldAck, envelope)).toBe(true)
    expect(isAckForEnvelope(oldAck, nextEpoch)).toBe(false)
    const fresh = await resultPort.publish(nextEpoch)
    expect(fresh.disposition).toBe('accepted')
    expect(isAckForEnvelope(fresh, nextEpoch)).toBe(true)
    expect(isAckForEnvelope(fresh, envelope)).toBe(false)
    expect(isAckForEnvelope({ ...fresh, resultDigest: 'd'.repeat(64) }, nextEpoch)).toBe(false)
    const again = await resultPort.publish(nextEpoch)
    expect(again.disposition).toBe('duplicate')
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
  it('binds each SSH-limit rule to one M100 row (G50, G51, G52) under unique ids', () => {
    const lines = readFileSync(
      new URL('../../docs/orchestration-gotchas.md', import.meta.url),
      'utf8',
    ).split('\n')
    const rowIds = lines.flatMap((line) => /^\| (G\d+) /.exec(line)?.[1] ?? [])
    expect(new Set(rowIds).size).toBe(rowIds.length)
    const rules = {
      G50: 'at most 3 pending handshakes',
      G51: 'STATUS_DLL_INIT_FAILED',
      G52: 'never retry in a loop',
    }
    for (const [row, rule] of Object.entries(rules)) {
      const holders = lines.filter((line) => line.includes(rule))
      expect(holders).toHaveLength(1)
      expect(holders[0]?.startsWith(`| ${row} `)).toBe(true)
      expect(holders[0]).toContain('M100')
      expect(holders[0]).toContain('amend')
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
      'G50',
      'G51',
      'G52',
    ])
      expect(model).toContain(obligation)
  })
  it('keeps the D101 reconcile vocabulary typed', () => {
    for (const reason of ['owner-mismatch', 'grant-revoked'] as const) {
      expect(
        deviceGrantRefusalSchema.parse({
          version: 1,
          pairId: ID,
          ownerId: ID,
          reason,
          retryable: false,
        }).reason,
      ).toBe(reason)
    }
  })
  it('names every threat with its owning lane and planned test', () => {
    const model = readFileSync(
      new URL('../../docs/certification/m100-threat-model.md', import.meta.url),
      'utf8',
    )
    const [, afterHeading = ''] = model.split('## Threat table', 2)
    const [table = ''] = afterHeading.split('## ', 2)
    const rows = table.split('\n').filter((line) => line.startsWith('| '))
    const threats = [
      'stolen pair key',
      'malicious paired device',
      'replay',
      'downgrade',
      'resource exhaustion',
      'd101 reconcile',
    ]
    expect(rows.length).toBeGreaterThanOrEqual(threats.length + 2)
    for (const threat of threats) {
      const row = rows.find((line) => line.toLowerCase().includes(threat))
      expect(row).toBeDefined()
      if (row === undefined) continue
      const cells = row
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
      expect(cells.length).toBeGreaterThanOrEqual(4)
      expect(cells[2]).toMatch(/\blane\s+(0|[A-Z])\b/i)
      expect(cells[3]).toContain('.test.ts')
      expect(cells[3]).toContain('›')
    }
  })
})
