import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEVICE_LIMITS,
  DEVICE_MODEL_TEXT,
  DEVICE_MODEL_TEXT_READERS,
} from '../../src/shared/constants'
import {
  DEVICE_FAILURES,
  deviceArtifactManifestSchema,
  deviceCapsSchema,
  deviceDispatchSchema,
  deviceEndpointSchema,
  deviceFrameSchema,
  deviceInvitationSchema,
  deviceJournalRecordSchema,
  deviceOfferSchema,
  devicePairingConfirmationSchema,
  deviceRouteSchema,
  type DeviceArtifactManifest,
  type DeviceAttemptIdentity,
  type DeviceCaps,
  type DeviceDispatch,
  type DeviceExecutionPort,
  type DeviceFrame,
  type DeviceInvitation,
  type DeviceJournalRecord,
  type DeviceOffer,
  type DevicePairingConfirmation,
  type DeviceRoute,
} from '../../src/shared/devices'

const ID = 'a'.repeat(32)
const OTHER_ID = 'b'.repeat(32)
const HASH = 'c'.repeat(64)
const GIT = 'd'.repeat(40)
const identity: DeviceAttemptIdentity = {
  pairId: ID,
  receiverIncarnationId: ID,
  boardId: ID,
  taskId: ID,
  attemptId: ID,
}
const caps: DeviceCaps = {
  workers: 1,
  processes: 2,
  heavyChecks: 1,
  tokens: 100,
  spendUsd: 1,
  artifactBytes: 1024,
}
const route: DeviceRoute = {
  pairId: ID,
  deviceId: ID,
  receiverIncarnationId: ID,
  poolId: ID,
  entryId: ID,
  model: { providerId: 'local', modelId: 'model/example:latest' },
}
const invitation: DeviceInvitation = {
  version: 1,
  invitationId: ID,
  deviceId: ID,
  certificateDerBase64: 'AAAA',
  fingerprint: HASH,
  endpoint: { address: '192.168.1.2', port: 12_345 },
  issuedAt: 1000,
  expiresAt: 301_000,
}
const confirmation: DevicePairingConfirmation = {
  version: 1,
  pairId: ID,
  localInvitationId: ID,
  peerInvitationId: OTHER_ID,
  localFingerprint: HASH,
  peerFingerprint: HASH,
  transcriptDigest: HASH,
  confirmedAt: 2000,
  signatureBase64: 'AAAA',
}
const offer: DeviceOffer = {
  deviceId: ID,
  receiverIncarnationId: ID,
  poolId: ID,
  repositoryId: ID,
  grantId: ID,
  grantRevision: 1,
  platform: 'darwin',
  toolchainDigest: HASH,
  lanes: true,
  checks: true,
  caps,
  entries: [
    {
      entryId: ID,
      roleId: ID,
      model: route.model,
      readiness: 'ready',
      payer: 'local',
      caps,
      capabilities: {
        vision: false,
        tools: true,
        structuredOutput: false,
        hostedSearch: false,
        reasoningEffort: false,
      },
    },
  ],
  checkIds: [ID],
}
const dispatch: DeviceDispatch = {
  kind: 'lane',
  identity,
  payloadDigest: HASH,
  repositoryId: ID,
  grantId: ID,
  grantRevision: 1,
  snapshot: { baseCommit: GIT, tree: GIT, manifestDigest: HASH },
  caps,
  mode: 'manual',
  route,
  roleId: ID,
  isolation: 'own-branch',
  brief: 'Fix the scoped task.',
  plannedWrites: ['src/app.ts'],
}
const artifact: DeviceArtifactManifest = {
  identity,
  repositoryId: ID,
  artifactId: ID,
  baseCommit: GIT,
  headCommit: GIT,
  tree: GIT,
  bundleDigest: HASH,
  bundleBytes: 1024,
  expandedBytes: 2048,
  objectCount: 2,
  fileCount: 1,
}
const usage = {
  settlementId: ID,
  payer: 'local',
  certainty: 'uncertain',
  inputTokens: 1,
  outputTokens: 1,
  returnedUsd: 0,
  retainedLiabilityUsd: 1,
} as const
const checkReport: DeviceFrame['body'] = {
  kind: 'checkReport',
  identity,
  repositoryId: ID,
  tree: GIT,
  checkId: ID,
  toolchainDigest: HASH,
  status: 'passed',
  report: 'Fixture report.',
}
function frame(body: DeviceFrame['body']): DeviceFrame {
  return { version: 1, pairId: ID, receiverIncarnationId: ID, requestId: ID, body }
}

describe('M100 public pairing contracts', () => {
  it('declares only the explicit lazy device factory as a model-text reader', () => {
    expect(DEVICE_MODEL_TEXT_READERS).toEqual(['dist/devices.js'])
    expect(Object.keys(DEVICE_MODEL_TEXT)).toEqual([
      'deviceTaskContext',
      'deviceApprovalWait',
      'deviceChannelPacing',
      'deviceGrantAdmission',
      'deviceResultChannel',
      'deviceOwnerBinding',
    ])
    expect(DEVICE_MODEL_TEXT.deviceTaskContext).toContain('untrusted input')
    expect(DEVICE_MODEL_TEXT.deviceApprovalWait).toContain('same durable attempt')
  })
  it('keeps public invitations and bilateral confirmations separate from authority', () => {
    expect(deviceInvitationSchema.parse(invitation)).toEqual(invitation)
    expect(devicePairingConfirmationSchema.parse(confirmation)).toEqual(confirmation)
    expect(DEVICE_LIMITS.devicesDefault).toBe(false)
    expect(DEVICE_LIMITS.discoveryDefault).toBe(false)
  })
  it.each([
    ['negative time', { ...invitation, issuedAt: -1, expiresAt: 299_999 }],
    ['certificate newline', { ...invitation, certificateDerBase64: 'AAAA\n' }],
    ['fingerprint newline', { ...invitation, fingerprint: 'c'.repeat(63) + '\n' }],
    ['old version', { ...invitation, version: 0 }],
    ['future version', { ...invitation, version: 2 }],
    ['empty validity', { ...invitation, expiresAt: invitation.issuedAt }],
    ['unbounded validity', { ...invitation, expiresAt: invitation.expiresAt + 1 }],
    ['fractional time', { ...invitation, issuedAt: 0.5, expiresAt: 300_000.5 }],
    [
      'unsafe time',
      {
        ...invitation,
        issuedAt: Number.MAX_SAFE_INTEGER + 1,
        expiresAt: Number.MAX_SAFE_INTEGER + 300_000,
      },
    ],
    [
      'certificate bound',
      { ...invitation, certificateDerBase64: 'A'.repeat(DEVICE_LIMITS.certificateBase64Chars + 4) },
    ],
    [
      'certificate encoding',
      { ...invitation, certificateDerBase64: '-----BEGIN PRIVATE KEY-----' },
    ],
    ['fingerprint bound', { ...invitation, fingerprint: HASH.slice(1) }],
    ['fingerprint encoding', { ...invitation, fingerprint: 'z'.repeat(64) }],
    ['extra bearer field', { ...invitation, token: 'fixture-not-a-credential' }],
  ])('rejects %s', (_name, value) => {
    expect(deviceInvitationSchema.safeParse(value).success).toBe(false)
  })
  it('bounds and allowlists signed confirmations', () => {
    expect(
      devicePairingConfirmationSchema.safeParse({
        ...confirmation,
        signatureBase64: 'A'.repeat(DEVICE_LIMITS.signatureBase64Chars + 4),
      }).success,
    ).toBe(false)
    expect(
      devicePairingConfirmationSchema.safeParse({ ...confirmation, approved: true }).success,
    ).toBe(false)
    expect(
      devicePairingConfirmationSchema.safeParse({ ...confirmation, transcriptDigest: '' }).success,
    ).toBe(false)
  })
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.2',
    '::1',
    'fd12::1',
    'fc00:1:2:3:4:5:6:7',
  ])('accepts private literal %s', (address) => {
    expect(deviceEndpointSchema.safeParse({ address, port: 1 }).success).toBe(true)
  })
  it.each([
    '0.0.0.0',
    '::',
    '8.8.8.8',
    '169.254.169.254',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '10.0.0.256',
    '010.0.0.1',
    '::ffff:192.168.1.2',
    'fe80::1',
    'fd00::1%en0',
    'fd00::1::2',
    'fd00:1',
    'fd00:1:2:3:4:5:6:7:8',
    'https://192.168.1.2',
    'localhost',
    'user@10.0.0.1',
    '10.0.0.1\n',
    'fd00::1\n',
    'fd00:ec2::254',
    'FD00:0EC2:0:0:0:0:0:0254',
    'fd00:ec2:0000:0000:0000:0000::254',
  ])('rejects unsafe or malformed literal %s', (address) => {
    expect(deviceEndpointSchema.safeParse({ address, port: 12_345 }).success).toBe(false)
  })
  it.each([0, -1, 65_536, 1.5, NaN])('rejects invalid port %s', (port) => {
    expect(deviceEndpointSchema.safeParse({ address: '10.0.0.1', port }).success).toBe(false)
  })
})

describe('M100 scoped offers and dispatch', () => {
  it('uses canonical models and opaque route ids without credential ownership collisions', () => {
    expect(deviceRouteSchema.parse(route)).toEqual(route)
    expect(deviceRouteSchema.parse({ ...route, deviceId: OTHER_ID }).deviceId).not.toBe(
      route.deviceId,
    )
    expect(deviceOfferSchema.parse(offer)).toEqual(offer)
    expect(deviceDispatchSchema.parse(dispatch)).toEqual(dispatch)
    expect(
      deviceDispatchSchema.safeParse({ ...dispatch, kind: 'check', route: undefined }).success,
    ).toBe(false)
  })
  it.each(['workers', 'processes', 'heavyChecks', 'tokens', 'spendUsd', 'artifactBytes'] as const)(
    'takes any nonnegative finite %s with no ceiling of ours',
    (key) => {
      expect(deviceCapsSchema.safeParse({ ...caps, [key]: 1_000_000 }).success).toBe(true)
      for (const value of [-1, NaN, Infinity]) {
        expect(deviceCapsSchema.safeParse({ ...caps, [key]: value }).success).toBe(false)
      }
      if (key !== 'spendUsd')
        expect(deviceCapsSchema.safeParse({ ...caps, [key]: 0.5 }).success).toBe(false)
    },
  )
  it.each([
    'apiKey',
    'provider',
    'endpoint',
    'environment',
    'command',
    'path',
    'email',
    'privateKey',
    'approval',
    'paidConsent',
  ])('rejects %s in offers and nested entries', (key) => {
    expect(deviceOfferSchema.safeParse({ ...offer, [key]: 'fixture-sentinel' }).success).toBe(false)
    expect(
      deviceOfferSchema.safeParse({
        ...offer,
        entries: [{ ...offer.entries[0], [key]: 'fixture-sentinel' }],
      }).success,
    ).toBe(false)
    expect(
      deviceRouteSchema.safeParse({
        ...route,
        model: { ...route.model, [key]: 'fixture-sentinel' },
      }).success,
    ).toBe(false)
  })
  it('rejects malformed routing ids and provider identities, at any name length', () => {
    for (const value of [
      '',
      'x'.repeat(32),
      'a'.repeat(33),
      'a'.repeat(31),
      'a'.repeat(31) + '\n',
    ]) {
      expect(deviceRouteSchema.safeParse({ ...route, deviceId: value }).success).toBe(false)
    }
    for (const model of [
      { ...route.model, providerId: 'https://provider.test' },
      { ...route.model, modelId: 'user@provider.test' },
    ])
      expect(deviceRouteSchema.safeParse({ ...route, model }).success).toBe(false)
    for (const model of [
      { ...route.model, providerId: `p${'p'.repeat(200)}` },
      { ...route.model, modelId: `m${'m'.repeat(200)}` },
    ])
      expect(deviceRouteSchema.safeParse({ ...route, model }).success).toBe(true)
    expect(
      deviceOfferSchema.safeParse({ ...offer, grantRevision: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false)
    expect(deviceOfferSchema.safeParse({ ...offer, grantRevision: 0 }).success).toBe(false)
  })
  it('refuses empty, impossible or duplicate offers, at any list length', () => {
    const changed = [
      { ...offer, lanes: false, checks: false, entries: [], checkIds: [] },
      { ...offer, entries: [] },
      { ...offer, checkIds: [] },
      { ...offer, caps: { ...caps, processes: 0 } },
      { ...offer, caps: { ...caps, workers: 0 } },
      { ...offer, caps: { ...caps, heavyChecks: 0 } },
      { ...offer, entries: [offer.entries[0], offer.entries[0]] },
      { ...offer, checkIds: [ID, ID] },
    ]
    for (const value of changed) expect(deviceOfferSchema.safeParse(value).success).toBe(false)
    expect(deviceOfferSchema.safeParse({ ...offer, lanes: false, entries: [] }).success).toBe(true)
    const longEntries = Array.from({ length: 40 }, (_unused, index) => ({
      ...offer.entries[0],
      entryId: index.toString(16).padStart(32, '0'),
    }))
    expect(deviceOfferSchema.safeParse({ ...offer, entries: longEntries }).success).toBe(true)
    const longCheckIds = Array.from({ length: 40 }, (_unused, index) =>
      index.toString(16).padStart(32, '0'),
    )
    expect(deviceOfferSchema.safeParse({ ...offer, checkIds: longCheckIds }).success).toBe(true)
  })
  it.each(['in-place', 'bypassPermissions'])('refuses remote widening %s', (value) => {
    expect(deviceDispatchSchema.safeParse({ ...dispatch, isolation: value }).success).toBe(false)
    expect(deviceDispatchSchema.safeParse({ ...dispatch, mode: value }).success).toBe(false)
  })
  it.each([
    '../secret',
    '/etc/file',
    'C:/file',
    String.raw`src\file`,
    'src/./file',
    'src//file',
    'src/../file',
    'src/file\0',
    'src/file\n',
  ])('confines planned write %s', (path) => {
    expect(deviceDispatchSchema.safeParse({ ...dispatch, plannedWrites: [path] }).success).toBe(
      false,
    )
  })
  it('binds dispatch routing to the attempt, with unbounded approved task input', () => {
    for (const value of [
      { ...dispatch, route: { ...route, pairId: OTHER_ID } },
      { ...dispatch, route: { ...route, receiverIncarnationId: OTHER_ID } },
      { ...dispatch, isolation: 'read-only' },
      { ...dispatch, snapshot: { ...dispatch.snapshot, tree: HASH } },
      { ...dispatch, command: 'echo fixture' },
      { ...dispatch, brief: '' },
    ])
      expect(deviceDispatchSchema.safeParse(value).success).toBe(false)
    expect(
      deviceDispatchSchema.safeParse({ ...dispatch, isolation: 'read-only', plannedWrites: [] })
        .success,
    ).toBe(true)
    for (const value of [
      { ...dispatch, brief: 'x'.repeat(9000) },
      { ...dispatch, guidance: 'x'.repeat(9000) },
      { ...dispatch, plannedWrites: Array.from({ length: 300 }, () => 'src/file') },
      { ...dispatch, plannedWrites: [`src/${'x'.repeat(600)}`] },
    ])
      expect(deviceDispatchSchema.safeParse(value).success).toBe(true)
  })
})

describe('M100 frame, artifact and durable-state boundaries', () => {
  it('round-trips every designed frame and fixed failure without accepting arbitrary RPCs', () => {
    const bodies: DeviceFrame['body'][] = [
      { kind: 'offers', offers: [offer] },
      { kind: 'dispatch', dispatch },
      {
        kind: 'outcome',
        outcome: {
          identity,
          payloadDigest: HASH,
          revision: 1,
          state: 'uncertain',
          occupied: caps,
          usage,
        },
      },
      { kind: 'reconcile', identities: [identity] },
      { kind: 'reconciled', outcomes: [], nextCursor: ID },
      { kind: 'cancel', identity },
      { kind: 'acknowledge', identity, settlementId: ID, payloadDigest: HASH },
      { kind: 'artifact', manifest: artifact },
      { kind: 'artifactChunk', identity, artifactId: ID, offset: 0, base64: 'AAAA' },
      checkReport,
      ...DEVICE_FAILURES.map((reason) => ({ kind: 'failure', reason }) as const),
      {
        kind: 'tombstone',
        record: {
          identity,
          payloadDigest: HASH,
          revision: 1,
          state: 'retired',
          usage,
          outcomeDigest: HASH,
          recordedAt: 1000,
        },
      },
    ]
    for (const body of bodies) expect(deviceFrameSchema.parse(frame(body))).toEqual(frame(body))
    expect(deviceFrameSchema.safeParse(frame({ kind: 'failure', reason: 'storage' })).success).toBe(
      true,
    )
    expect(deviceFrameSchema.safeParse({ ...frame(bodies[0]!), version: 2 }).success).toBe(false)
    expect(
      deviceFrameSchema.safeParse({
        ...frame(bodies[0]!),
        body: { kind: 'exec', command: 'echo fixture' },
      }).success,
    ).toBe(false)
    expect(
      deviceFrameSchema.safeParse({
        ...frame(bodies[0]!),
        body: { kind: 'failure', reason: 'storage', detail: '/private/fixture' },
      }).success,
    ).toBe(false)
  })
  it('rejects stale or cross-pair identities in each nested frame', () => {
    const wrong = { ...identity, pairId: OTHER_ID }
    const bodies: DeviceFrame['body'][] = [
      { kind: 'dispatch', dispatch: { ...dispatch, identity: wrong } },
      {
        kind: 'outcome',
        outcome: {
          identity: wrong,
          payloadDigest: HASH,
          revision: 1,
          state: 'uncertain',
          occupied: caps,
          usage,
        },
      },
      { kind: 'reconcile', identities: [wrong] },
      { kind: 'cancel', identity: wrong },
      { kind: 'artifact', manifest: { ...artifact, identity: wrong } },
      { kind: 'offers', offers: [{ ...offer, receiverIncarnationId: OTHER_ID }] },
    ]
    for (const body of bodies) expect(deviceFrameSchema.safeParse(frame(body)).success).toBe(false)
    expect(
      deviceFrameSchema.safeParse({
        ...frame({ kind: 'cancel', identity }),
        receiverIncarnationId: OTHER_ID,
      }).success,
    ).toBe(false)
  })
  it('reconciles a lost terminal reply after receiver restart without rewriting the durable owner', () => {
    const original = deviceJournalRecordSchema.parse({
      kind: 'receiver-record',
      recordedAt: 1000,
      outcome: {
        identity,
        payloadDigest: HASH,
        revision: 2,
        state: 'retired',
        occupied: { ...caps, workers: 0, processes: 0, heavyChecks: 0 },
        usage,
        artifact,
      },
    })
    if (original.kind !== 'receiver-record') throw new Error('Missing test outcome')
    const terminal = {
      identity,
      payloadDigest: HASH,
      revision: 2,
      state: 'retired',
      usage,
      outcomeDigest: HASH,
      recordedAt: 1000,
    } as const
    const bodies: DeviceFrame['body'][] = [
      { kind: 'reconcile', identities: [identity] },
      { kind: 'reconciled', outcomes: [original.outcome] },
      { kind: 'tombstone', record: terminal },
      { kind: 'acknowledge', identity, settlementId: usage.settlementId, payloadDigest: HASH },
    ]
    for (const body of bodies) {
      const restarted = { ...frame(body), receiverIncarnationId: OTHER_ID }
      expect(deviceFrameSchema.parse(restarted)).toEqual(restarted)
      expect(deviceFrameSchema.safeParse({ ...restarted, pairId: OTHER_ID }).success).toBe(false)
    }
    expect(original.outcome.identity).toEqual(dispatch.identity)
    expect(original.outcome.usage).toEqual(terminal.usage)
    expect(deviceJournalRecordSchema.parse(original)).toEqual(original)
  })
  it('keeps unresolved historical attempts occupied and rejects their relaunch or live control', () => {
    const unresolved = {
      identity,
      payloadDigest: HASH,
      revision: 1,
      state: 'uncertain',
      occupied: caps,
      usage,
    } as const
    const reconciled = {
      ...frame({ kind: 'reconciled', outcomes: [unresolved] }),
      receiverIncarnationId: OTHER_ID,
    }
    expect(deviceFrameSchema.parse(reconciled)).toEqual(reconciled)
    const activeBodies: DeviceFrame['body'][] = [
      { kind: 'dispatch', dispatch },
      { kind: 'outcome', outcome: unresolved },
      { kind: 'cancel', identity },
      { kind: 'artifact', manifest: artifact },
      { kind: 'artifactChunk', identity, artifactId: ID, offset: 0, base64: 'AAAA' },
      checkReport,
      { kind: 'offers', offers: [offer] },
    ]
    for (const body of activeBodies) {
      expect(
        deviceFrameSchema.safeParse({ ...frame(body), receiverIncarnationId: OTHER_ID }).success,
      ).toBe(false)
    }
    expect(unresolved.occupied).toEqual(caps)
    expect(unresolved.usage.retainedLiabilityUsd).toBe(1)
  })
  it('bounds reconciliation batches and artifact chunks; offers and reports run free', () => {
    const oversized: DeviceFrame['body'][] = [
      {
        kind: 'reconcile',
        identities: Array.from({ length: DEVICE_LIMITS.reconciliationPage + 1 }, () => identity),
      },
      {
        kind: 'artifactChunk',
        identity,
        artifactId: ID,
        offset: 0,
        base64: 'A'.repeat(DEVICE_LIMITS.artifactChunkBase64Chars + 4),
      },
    ]
    for (const body of oversized)
      expect(deviceFrameSchema.safeParse(frame(body)).success).toBe(false)
    expect(deviceFrameSchema.safeParse(frame({ kind: 'reconcile', identities: [] })).success).toBe(
      false,
    )
    const freed: DeviceFrame['body'][] = [
      { kind: 'offers', offers: Array.from({ length: 40 }, () => offer) },
      {
        kind: 'checkReport',
        identity,
        repositoryId: ID,
        tree: GIT,
        checkId: ID,
        toolchainDigest: HASH,
        status: 'passed',
        report: 'x'.repeat(20_000),
      },
    ]
    for (const body of freed) expect(deviceFrameSchema.safeParse(frame(body)).success).toBe(true)
  })
  it('enforces decoded chunk bytes at the final partial base64 group', () => {
    const chunk = { kind: 'artifactChunk', identity, artifactId: ID, offset: 0 } as const
    expect(
      deviceFrameSchema.safeParse(
        frame({
          ...chunk,
          base64: Buffer.alloc(DEVICE_LIMITS.artifactChunkBytes).toString('base64'),
        }),
      ).success,
    ).toBe(true)
    expect(
      deviceFrameSchema.safeParse(
        frame({ ...chunk, base64: 'A'.repeat(DEVICE_LIMITS.artifactChunkBase64Chars) }),
      ).success,
    ).toBe(false)
    expect(
      deviceFrameSchema.safeParse(
        frame({ ...chunk, base64: 'AAAA', offset: DEVICE_LIMITS.artifactBytes + 1 }),
      ).success,
    ).toBe(false)
  })
  it('bounds compressed/expanded results and requires exact Git object formats', () => {
    expect(deviceArtifactManifestSchema.parse(artifact)).toEqual(artifact)
    const artifactBounds = {
      bundleBytes: DEVICE_LIMITS.artifactBytes,
      expandedBytes: DEVICE_LIMITS.expandedArtifactBytes,
    }
    for (const [key, max] of Object.entries(artifactBounds)) {
      expect(deviceArtifactManifestSchema.safeParse({ ...artifact, [key]: max + 1 }).success).toBe(
        false,
      )
    }
    expect(
      deviceArtifactManifestSchema.safeParse({ ...artifact, objectCount: 20_000, fileCount: 5000 })
        .success,
    ).toBe(true)
    for (const change of [
      { baseCommit: '' },
      { headCommit: HASH },
      { baseCommit: HASH },
      { tree: HASH },
      { baseCommit: 'z'.repeat(40), headCommit: 'z'.repeat(40), tree: 'z'.repeat(40) },
      { tree: 'refs/heads/main' },
      { ref: 'refs/heads/main' },
      { bundleBytes: 0 },
      { expandedBytes: 0 },
      { objectCount: 0 },
    ]) {
      expect(deviceArtifactManifestSchema.safeParse({ ...artifact, ...change }).success).toBe(false)
    }
    expect(
      deviceArtifactManifestSchema.safeParse({
        ...artifact,
        baseCommit: HASH,
        headCommit: HASH,
        tree: HASH,
      }).success,
    ).toBe(true)
  })
  it('retains unresolved occupancy/liability and separates permanent tombstones from full results', () => {
    const record: DeviceJournalRecord = {
      kind: 'receiver-record',
      recordedAt: 1000,
      outcome: {
        identity,
        payloadDigest: HASH,
        revision: 1,
        state: 'uncertain',
        occupied: caps,
        usage,
      },
    }
    expect(deviceJournalRecordSchema.parse(record)).toEqual(record)
    const records: DeviceJournalRecord[] = [
      { kind: 'source-intent', dispatch, recordedAt: 1000 },
      {
        kind: 'tombstone',
        identity,
        payloadDigest: HASH,
        revision: 1,
        state: 'retired',
        usage,
        outcomeDigest: HASH,
        recordedAt: 1000,
      },
    ]
    for (const item of records) expect(deviceJournalRecordSchema.parse(item)).toEqual(item)
    expect(deviceJournalRecordSchema.safeParse({ ...records[1], expiresAt: 0 }).success).toBe(false)
    expect(deviceJournalRecordSchema.safeParse({ ...records[1], state: 'running' }).success).toBe(
      false,
    )
    expect(deviceJournalRecordSchema.safeParse({ ...records[1], usage: undefined }).success).toBe(
      false,
    )
    expect(
      deviceJournalRecordSchema.safeParse({
        ...record,
        outcome: { ...record.outcome, state: 'retired' },
      }).success,
    ).toBe(false)
    expect(
      deviceJournalRecordSchema.safeParse({ ...record, outcome: { ...record.outcome, artifact } })
        .success,
    ).toBe(false)
    for (const resource of ['workers', 'processes', 'heavyChecks'] as const) {
      expect(
        deviceJournalRecordSchema.safeParse({
          ...record,
          outcome: {
            ...record.outcome,
            state: 'retired',
            occupied: { ...caps, workers: 0, processes: 0, heavyChecks: 0, [resource]: 1 },
          },
        }).success,
      ).toBe(false)
    }
    const retired = {
      ...record.outcome,
      state: 'retired',
      occupied: { ...caps, workers: 0, processes: 0, heavyChecks: 0 },
      artifact,
    }
    expect(deviceJournalRecordSchema.safeParse({ ...record, outcome: retired }).success).toBe(true)
    expect(
      deviceJournalRecordSchema.safeParse({
        ...record,
        outcome: {
          ...retired,
          artifact: { ...artifact, identity: { ...identity, attemptId: OTHER_ID } },
        },
      }).success,
    ).toBe(false)
  })
  it('lets a host inject the real execution owner without a production fallback', async () => {
    const response = frame({ kind: 'failure', reason: 'grant' })
    const port: DeviceExecutionPort = {
      dispatch: () => Promise.resolve(response),
      reconcile: () => Promise.resolve([response]),
      cancel: () => Promise.resolve(),
    }
    expect(await port.dispatch(dispatch)).toEqual(response)
    expect(await port.reconcile([identity])).toEqual([response])
    await port.cancel(identity)
  })
})

describe('M100 same-machine threat contract', () => {
  it('defines local reachability, trusted-account risk and required isolation drills before a listener', () => {
    const review = readFileSync(
      new URL('../../docs/certification/m100-0.md', import.meta.url),
      'utf8',
    )
    const boundary = review.split('## Same-machine attacker boundary', 2)[1]?.split('\n## ', 1)[0]
    expect(boundary).toBeDefined()
    for (const obligation of [
      'another local user',
      'same-user process',
      'loopback ports',
      'pairing store',
      'journal',
      '0700',
      '0600',
      'peer credential checks',
      'argv or environment',
      'P-local-store-isolation',
      'E-local-journal-isolation',
      'T-local-peer-credentials',
      'M100-LOCAL-ACCOUNT',
      'syntactically valid terminal rewrite',
    ])
      expect(boundary).toContain(obligation)
    const plan = readFileSync(new URL('../../PLAN.md', import.meta.url), 'utf8')
    expect(plan.split('## 9. Security assumptions and accepted residual risk', 2)[1]).toContain(
      'M100-LOCAL-ACCOUNT',
    )
  })
})
