// M100/D80: our own versioned protocol, not a guessed upstream wire shape.
// Schemas validate data only. Local pins, grants, consent, durability, checked
// addresses and retirement remain the executing host's authority (m100-0.md).
import * as z from 'zod/mini'
import { accountIdSchema } from './accounts'
import { DEVICE_LIMITS, DEVICE_METADATA_ULA_SEGMENTS } from './constants'

const id = z
  .string()
  .check(
    z.minLength(DEVICE_LIMITS.idChars),
    z.maxLength(DEVICE_LIMITS.idChars),
    z.regex(/^[a-f0-9]{32}$(?![\s\S])/),
  )
const digest = z
  .string()
  .check(
    z.minLength(DEVICE_LIMITS.digestChars),
    z.maxLength(DEVICE_LIMITS.digestChars),
    z.regex(/^[a-f0-9]{64}$(?![\s\S])/),
  )
const timestamp = z.int().check(z.gte(0))
const revision = z.int().check(z.gte(1))
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$(?![\s\S])/
const boundedText = (max: number) => z.string().check(z.minLength(1), z.maxLength(max))
const base64 = (max: number) => boundedText(max).check(z.regex(base64Pattern))
const artifactChunk = base64(DEVICE_LIMITS.artifactChunkBase64Chars).check(
  z.refine((value) => {
    let padding = 0
    if (value.endsWith('=')) padding = value.endsWith('==') ? 2 : 1
    return (
      (value.length / DEVICE_LIMITS.base64GroupChars) * DEVICE_LIMITS.base64GroupBytes - padding <=
      DEVICE_LIMITS.artifactChunkBytes
    )
  }),
)
const cap = (max: number) => z.int().check(z.gte(0), z.lte(max))

// Invitations contain literal endpoints. DNS/discovery hints are checked again
// by T before connection; they never replace this saved identity or TLS pin.
function isPrivateLiteral(address: string): boolean {
  if (address === '::1') return true
  if (address.includes(':')) {
    if (!/^f[cd][a-f0-9]{2}:/i.test(address)) return false
    const halves = address.split('::')
    if (halves.length > 2) return false
    const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')))
    const isValid =
      groups.every((group) => /^[a-f0-9]{1,4}$(?![\s\S])/i.test(group)) &&
      (halves.length === 2
        ? groups.length < DEVICE_LIMITS.ipv6Groups
        : groups.length === DEVICE_LIMITS.ipv6Groups)
    if (!isValid) return false
    const parts = (half: string) => (half === '' ? [] : half.split(':'))
    const expanded =
      halves.length === 2
        ? [
            ...parts(halves[0] ?? ''),
            ...Array.from({ length: DEVICE_LIMITS.ipv6Groups - groups.length }, () => '0'),
            ...parts(halves[1] ?? ''),
          ]
        : groups
    return expanded.some(
      (group, index) => Number(`0x${group}`) !== DEVICE_METADATA_ULA_SEGMENTS[index],
    )
  }
  const octets = address.split('.')
  return (
    octets.length === DEVICE_LIMITS.ipv4Octets &&
    octets.every(
      (octet) =>
        /^(?:0|[1-9][0-9]{0,2})$(?![\s\S])/.test(octet) &&
        Number(octet) <= DEVICE_LIMITS.ipv4OctetMax,
    ) &&
    /^(?:(?:10|127)\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(address)
  )
}

export const deviceEndpointSchema = z.strictObject({
  address: boundedText(DEVICE_LIMITS.addressChars).check(z.refine(isPrivateLiteral)),
  port: z.int().check(z.gte(1), z.lte(DEVICE_LIMITS.portMax)),
})

export const deviceInvitationSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    invitationId: id,
    deviceId: id,
    certificateDerBase64: base64(DEVICE_LIMITS.certificateBase64Chars),
    fingerprint: digest,
    endpoint: deviceEndpointSchema,
    issuedAt: timestamp,
    expiresAt: timestamp,
  })
  .check(
    z.refine(
      (value) =>
        value.expiresAt > value.issuedAt &&
        value.expiresAt - value.issuedAt <= DEVICE_LIMITS.invitationValidityMs,
    ),
  )
export type DeviceInvitation = z.infer<typeof deviceInvitationSchema>

// Offline, signed only after the user compares the other screen. P verifies
// both signatures over the canonical transcript, freshness and one-use ids.
export const devicePairingConfirmationSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  pairId: id,
  localInvitationId: id,
  peerInvitationId: id,
  localFingerprint: digest,
  peerFingerprint: digest,
  transcriptDigest: digest,
  confirmedAt: timestamp,
  signatureBase64: base64(DEVICE_LIMITS.signatureBase64Chars),
})
export type DevicePairingConfirmation = z.infer<typeof devicePairingConfirmationSchema>

// M95 binding: canonical identity only, never ProviderDefinition/auth/endpoint.
const model = z.strictObject({
  providerId: boundedText(DEVICE_LIMITS.modelIdChars).check(
    z.regex(/^[a-z0-9][a-z0-9._-]*$(?![\s\S])/),
  ),
  modelId: boundedText(DEVICE_LIMITS.modelIdChars).check(
    z.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$(?![\s\S])/),
  ),
})
export const deviceRouteSchema = z.strictObject({
  pairId: id,
  deviceId: id,
  receiverIncarnationId: id,
  poolId: id,
  entryId: id,
  model,
})
export type DeviceRoute = z.infer<typeof deviceRouteSchema>

export const deviceCapsSchema = z.strictObject({
  workers: cap(DEVICE_LIMITS.workers),
  processes: cap(DEVICE_LIMITS.processes),
  heavyChecks: cap(DEVICE_LIMITS.heavyChecks),
  tokens: cap(DEVICE_LIMITS.tokens),
  spendUsd: z.number().check(z.gte(0), z.lte(DEVICE_LIMITS.spendUsd)),
  artifactBytes: cap(DEVICE_LIMITS.artifactBytes),
})
export type DeviceCaps = z.infer<typeof deviceCapsSchema>

const entry = z.strictObject({
  entryId: id,
  roleId: id,
  model,
  capabilities: z.strictObject({
    vision: z.boolean(),
    tools: z.boolean(),
    structuredOutput: z.boolean(),
    hostedSearch: z.boolean(),
    reasoningEffort: z.boolean(),
  }),
  readiness: z.enum(['ready', 'unavailable', 'unknown']),
  payer: z.enum(['subscription', 'apiKey', 'local', 'unknown']),
  caps: deviceCapsSchema,
})

export const deviceOfferSchema = z
  .strictObject({
    deviceId: id,
    receiverIncarnationId: id,
    poolId: id,
    repositoryId: id,
    grantId: id,
    grantRevision: revision,
    platform: z.enum(['win32', 'linux', 'darwin']),
    toolchainDigest: digest,
    lanes: z.boolean(),
    checks: z.boolean(),
    caps: deviceCapsSchema,
    entries: z.array(entry).check(z.maxLength(DEVICE_LIMITS.entries)),
    checkIds: z.array(id).check(z.maxLength(DEVICE_LIMITS.checks)),
  })
  .check(
    z.refine(
      (value) =>
        (value.lanes || value.checks) &&
        (value.lanes
          ? value.entries.length > 0 && value.caps.workers > 0
          : value.entries.length === 0) &&
        (value.checks
          ? value.checkIds.length > 0 && value.caps.heavyChecks > 0
          : value.checkIds.length === 0) &&
        value.caps.processes > 0 &&
        new Set(value.entries.map((item) => item.entryId)).size === value.entries.length &&
        new Set(value.checkIds).size === value.checkIds.length,
    ),
  )
export type DeviceOffer = z.infer<typeof deviceOfferSchema>

const gitObject = z.union([z.string().check(z.regex(/^[a-f0-9]{40}$(?![\s\S])/)), digest])
const snapshot = z
  .strictObject({
    baseCommit: gitObject,
    tree: gitObject,
    manifestDigest: digest,
    dirtyPreviewDigest: z.optional(digest),
  })
  .check(z.refine((value) => value.baseCommit.length === value.tree.length))
const relativePath = boundedText(DEVICE_LIMITS.pathChars).check(
  z.refine(
    (value) =>
      !/[\\:]|\p{Cc}|\p{Zl}|\p{Zp}/u.test(value) &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  ),
)
const attempt = z.strictObject({
  pairId: id,
  receiverIncarnationId: id,
  boardId: id,
  taskId: id,
  attemptId: id,
})
export { attempt as deviceAttemptIdentitySchema }
export type DeviceAttemptIdentity = z.infer<typeof attempt>

export function isSameAttempt(
  first: DeviceAttemptIdentity,
  second: DeviceAttemptIdentity,
): boolean {
  return (
    first.pairId === second.pairId &&
    first.receiverIncarnationId === second.receiverIncarnationId &&
    first.boardId === second.boardId &&
    first.taskId === second.taskId &&
    first.attemptId === second.attemptId
  )
}

const dispatchCommon = {
  identity: attempt,
  payloadDigest: digest,
  repositoryId: id,
  grantId: id,
  grantRevision: revision,
  snapshot,
  caps: deviceCapsSchema,
  // A ceiling, not an approval. No Bypass or remote permission token exists.
  mode: z.enum(['plan', 'manual', 'acceptEdits', 'auto']),
}
export const deviceDispatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...dispatchCommon,
    kind: z.literal('check'),
    checkId: id,
    toolchainDigest: digest,
  }),
  z
    .strictObject({
      ...dispatchCommon,
      kind: z.literal('lane'),
      route: deviceRouteSchema,
      roleId: id,
      isolation: z.enum(['own-branch', 'read-only']),
      brief: boundedText(DEVICE_LIMITS.taskBriefChars),
      guidance: z.optional(boundedText(DEVICE_LIMITS.guidanceChars)),
      plannedWrites: z.array(relativePath).check(z.maxLength(DEVICE_LIMITS.writePaths)),
    })
    .check(
      z.refine(
        (value) =>
          value.route.pairId === value.identity.pairId &&
          value.route.receiverIncarnationId === value.identity.receiverIncarnationId &&
          (value.isolation !== 'read-only' || value.plannedWrites.length === 0),
      ),
    ),
])
export type DeviceDispatch = z.infer<typeof deviceDispatchSchema>

export const deviceArtifactManifestSchema = z
  .strictObject({
    identity: attempt,
    repositoryId: id,
    artifactId: id,
    baseCommit: gitObject,
    headCommit: gitObject,
    tree: gitObject,
    bundleDigest: digest,
    bundleBytes: cap(DEVICE_LIMITS.artifactBytes).check(z.gte(1)),
    expandedBytes: cap(DEVICE_LIMITS.expandedArtifactBytes).check(z.gte(1)),
    objectCount: cap(DEVICE_LIMITS.artifactObjects).check(z.gte(1)),
    fileCount: cap(DEVICE_LIMITS.artifactFiles),
  })
  .check(
    z.refine(
      (value) =>
        value.baseCommit.length === value.headCommit.length &&
        value.headCommit.length === value.tree.length,
    ),
  )
export type DeviceArtifactManifest = z.infer<typeof deviceArtifactManifestSchema>

const usage = z.strictObject({
  settlementId: id,
  payer: z.enum(['subscription', 'apiKey', 'local', 'unknown']),
  certainty: z.enum(['known', 'estimated', 'uncertain']),
  inputTokens: cap(DEVICE_LIMITS.tokens),
  outputTokens: cap(DEVICE_LIMITS.tokens),
  returnedUsd: z.number().check(z.gte(0), z.lte(DEVICE_LIMITS.spendUsd)),
  retainedLiabilityUsd: z.number().check(z.gte(0), z.lte(DEVICE_LIMITS.spendUsd)),
})
const outcome = z
  .strictObject({
    identity: attempt,
    payloadDigest: digest,
    revision,
    state: z.enum([
      'admitted',
      'launch-intent',
      'running',
      'paused',
      'uncertain',
      'retired',
      'refused',
    ]),
    occupied: deviceCapsSchema,
    usage,
    failure: z.optional(z.literal('capacity')),
    artifact: z.optional(deviceArtifactManifestSchema),
  })
  .check(
    z.refine(
      (value) =>
        (value.failure === undefined || value.state === 'retired') &&
        (value.artifact === undefined ||
          (value.state === 'retired' && isSameAttempt(value.identity, value.artifact.identity))) &&
        ((value.state !== 'retired' && value.state !== 'refused') ||
          (value.occupied.workers === 0 &&
            value.occupied.processes === 0 &&
            value.occupied.heavyChecks === 0)),
    ),
  )

// Compact terminal data survives full-result cleanup, so reconciliation can
// return settlement/liability without relaunching or inventing an empty result.
const tombstoneShape = {
  identity: attempt,
  payloadDigest: digest,
  revision,
  state: z.enum(['retired', 'refused']),
  usage,
  failure: z.optional(z.literal('capacity')),
  outcomeDigest: digest,
  recordedAt: timestamp,
}
const tombstone = z.strictObject(tombstoneShape)

export const DEVICE_FAILURES = [
  'blocked-or-unreachable',
  'incompatible',
  'unpaired',
  'revoked',
  'invalid-frame',
  'capacity',
  'grant',
  'approval-required',
  'paid-consent-required',
  'storage',
  'reconcile-required',
  'payload-changed',
  'uncertain',
  'unsupported-host',
] as const

// Each envelope carries the saved pair and current authenticated receiver.
// Reconciliation/acknowledgement preserves historical attempt owners; only
// live execution/control must name this incarnation. T authenticates the
// envelope; E looks up the original tuple + payload digest, never adopts it.
export const deviceFrameSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    pairId: id,
    receiverIncarnationId: id,
    requestId: id,
    body: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('offers'),
        offers: z.array(deviceOfferSchema).check(z.maxLength(DEVICE_LIMITS.repositories)),
      }),
      z.strictObject({ kind: z.literal('dispatch'), dispatch: deviceDispatchSchema }),
      z.strictObject({ kind: z.literal('outcome'), outcome }),
      z.strictObject({ kind: z.literal('tombstone'), record: tombstone }),
      z.strictObject({
        kind: z.literal('reconcile'),
        identities: z
          .array(attempt)
          .check(z.minLength(1), z.maxLength(DEVICE_LIMITS.reconciliationPage)),
      }),
      z.strictObject({
        kind: z.literal('reconciled'),
        outcomes: z.array(outcome).check(z.maxLength(DEVICE_LIMITS.reconciliationPage)),
        nextCursor: z.optional(id),
      }),
      z.strictObject({ kind: z.literal('cancel'), identity: attempt }),
      z.strictObject({
        kind: z.literal('acknowledge'),
        identity: attempt,
        settlementId: id,
        payloadDigest: digest,
      }),
      z.strictObject({ kind: z.literal('artifact'), manifest: deviceArtifactManifestSchema }),
      z.strictObject({
        kind: z.literal('artifactChunk'),
        identity: attempt,
        artifactId: id,
        offset: cap(DEVICE_LIMITS.artifactBytes),
        base64: artifactChunk,
      }),
      z.strictObject({
        kind: z.literal('checkReport'),
        identity: attempt,
        repositoryId: id,
        tree: gitObject,
        checkId: id,
        toolchainDigest: digest,
        status: z.enum(['passed', 'failed', 'not-run']),
        report: boundedText(DEVICE_LIMITS.reportChars),
      }),
      z.strictObject({ kind: z.literal('failure'), reason: z.enum(DEVICE_FAILURES) }),
    ]),
  })
  .check(
    z.refine((frame) => {
      const isPairedAttempt = (identity: DeviceAttemptIdentity) => identity.pairId === frame.pairId
      const isMatchingAttempt = (identity: DeviceAttemptIdentity) =>
        isPairedAttempt(identity) && identity.receiverIncarnationId === frame.receiverIncarnationId
      const body = frame.body
      switch (body.kind) {
        case 'offers': {
          return body.offers.every(
            (offer) => offer.receiverIncarnationId === frame.receiverIncarnationId,
          )
        }
        case 'dispatch': {
          return isMatchingAttempt(body.dispatch.identity)
        }
        case 'outcome': {
          return isMatchingAttempt(body.outcome.identity)
        }
        case 'reconcile': {
          return body.identities.every((item) => isPairedAttempt(item))
        }
        case 'reconciled': {
          return body.outcomes.every((item) => isPairedAttempt(item.identity))
        }
        case 'artifact': {
          return isMatchingAttempt(body.manifest.identity)
        }
        case 'tombstone': {
          return isPairedAttempt(body.record.identity)
        }
        case 'acknowledge': {
          return isPairedAttempt(body.identity)
        }
        case 'failure': {
          return true
        }
        default: {
          return isMatchingAttempt(body.identity)
        }
      }
    }),
  )
export type DeviceFrame = z.infer<typeof deviceFrameSchema>

// Owner-only, nonsync journal data. A terminal tombstone never expires; full
// result retention is bounded independently. Storage exhaustion stops work.
export const deviceJournalRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('source-intent'),
    dispatch: deviceDispatchSchema,
    recordedAt: timestamp,
  }),
  z.strictObject({ kind: z.literal('receiver-record'), outcome, recordedAt: timestamp }),
  z.strictObject({
    ...tombstoneShape,
    kind: z.literal('tombstone'),
  }),
])
export type DeviceJournalRecord = z.infer<typeof deviceJournalRecordSchema>

// An admission port binds M96's real policy/leases and durable journal. Its
// implementation must persist admission + launch intent before starting.
export interface DeviceExecutionPort {
  dispatch(request: DeviceDispatch): Promise<DeviceFrame>
  reconcile(identities: readonly DeviceAttemptIdentity[]): Promise<readonly DeviceFrame[]>
  cancel(identity: DeviceAttemptIdentity): Promise<void>
}

// M100 phase 2 (lane 0): channel, capability, grant and result envelopes.
// Every envelope carries the protocol version, a byte/queue cap and a zod
// parse before use. Unknown fields are rejected by strict parsing, never
// silently dropped: the receiver surfaces the refused shape for display
// (D36). Lanes C, R, V, A and K own carriage and enforcement; this file is
// the contract they code against, with injected ports below.

// Lane C reads: one long-lived authenticated channel per pair. Streams run
// in priority order: control over status/events over logs over bulk, so bulk
// never starves control or Stop.
export const DEVICE_STREAMS = ['control', 'status', 'events', 'logs', 'bulk'] as const
export type DeviceStream = (typeof DEVICE_STREAMS)[number]

// The authenticated ready call: health is this call, never a port probe
// (G52). No probe message kind exists; a probe refuses to parse.
export const deviceReadySchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  pairId: id,
  receiverIncarnationId: id,
  requestId: id,
  streams: z
    .array(z.enum(DEVICE_STREAMS))
    .check(z.minLength(1), z.maxLength(DEVICE_LIMITS.channelStreams)),
})
export type DeviceReady = z.infer<typeof deviceReadySchema>

export const deviceHeartbeatSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    pairId: id,
    receiverIncarnationId: id,
    sequence: z.int().check(z.gte(0)),
    ackSequence: z.int().check(z.gte(0)),
  })
  .check(z.refine((value) => value.ackSequence <= value.sequence))
export type DeviceHeartbeat = z.infer<typeof deviceHeartbeatSchema>

// G50: refusal reads as throttled or unknown since a time, never down. The
// closed reason set has no offline state.
export const DEVICE_THROTTLE_REASONS = ['handshake-backoff', 'peer-penalty', 'pressure'] as const
export const deviceThrottledSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  pairId: id,
  receiverIncarnationId: z.optional(id),
  unknownSince: timestamp,
  reason: z.enum(DEVICE_THROTTLE_REASONS),
})
export type DeviceThrottled = z.infer<typeof deviceThrottledSchema>

export const deviceChannelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready'), ready: deviceReadySchema }),
  z.strictObject({ kind: z.literal('heartbeat'), heartbeat: deviceHeartbeatSchema }),
  z.strictObject({ kind: z.literal('throttled'), throttled: deviceThrottledSchema }),
])
export type DeviceChannelMessage = z.infer<typeof deviceChannelSchema>

// G50 pacing, pure so lane C and its tests share the exact contract: at
// most pendingHandshakes open handshakes per host, jittered exponential
// backoff from the base capped at the ten-minute maximum. The jitter is
// one-sided: randomSource removes up to handshakeBackoffJitter of the
// nominal delay, so hosts that fail together spread out while the result
// never exceeds the nominal delay or the cap. Tests inject a fixed source;
// production passes Math.random.
export function canOpenHandshake(pendingHandshakes: number): boolean {
  return (
    Number.isSafeInteger(pendingHandshakes) &&
    pendingHandshakes >= 0 &&
    pendingHandshakes < DEVICE_LIMITS.pendingHandshakes
  )
}
export function handshakeBackoffMs(
  failures: number,
  randomSource: () => number = Math.random,
): number {
  const attempts = Number.isSafeInteger(failures) && failures > 0 ? failures : 1
  const nominal = Math.min(
    DEVICE_LIMITS.handshakeBackoffBaseMs * 2 ** (attempts - 1),
    DEVICE_LIMITS.handshakeBackoffMaxMs,
  )
  const draw = Math.min(Math.max(randomSource(), 0), 1)
  return nominal - nominal * DEVICE_LIMITS.handshakeBackoffJitter * draw
}
// G52: one failed authentication stops and asks; retries never loop.
export function canRetryAuth(failures: number): boolean {
  return (
    Number.isSafeInteger(failures) &&
    failures >= 0 &&
    failures < DEVICE_LIMITS.authFailuresBeforeAsk
  )
}

// Lane V reads: measured capability and capacity advertisement, kept current
// by the device. Slot caps come from measured headroom; transport failure
// and pressure feed the governor as signals (G12). G51 needs platform,
// power and slot truth before a Windows worker is admitted.
const engineBudget = z.enum(['ok', 'low', 'exhausted', 'unknown'])
const percent = z.number().check(z.gte(0), z.lte(100))
export const deviceCapabilitySchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    deviceId: id,
    receiverIncarnationId: id,
    observedAt: timestamp,
    platform: z.enum(['win32', 'linux', 'darwin']),
    osVersion: boundedText(DEVICE_LIMITS.labelChars),
    tools: z
      .array(boundedText(DEVICE_LIMITS.labelChars))
      .check(z.maxLength(DEVICE_LIMITS.capabilityTools)),
    engines: z
      .array(z.strictObject({ model, budget: engineBudget }))
      .check(z.maxLength(DEVICE_LIMITS.capabilityEngines)),
    presence: z.strictObject({
      touchId: z.boolean(),
      windowsHello: z.boolean(),
      tpm: z.boolean(),
      secureEnclave: z.boolean(),
    }),
    power: z.enum(['ac', 'battery', 'unknown']),
    sleepInhibited: z.boolean(),
    slotCap: cap(DEVICE_LIMITS.workers),
    pressure: z.strictObject({
      cpuPercent: percent,
      memoryPercent: percent,
      diskPercent: percent,
      transportResets: z.int().check(z.gte(0)),
    }),
  })
  .check(
    z.refine(
      (value) =>
        new Set(value.tools).size === value.tools.length &&
        new Set(value.engines.map((engine) => `${engine.model.providerId} ${engine.model.modelId}`))
          .size === value.engines.length &&
        // The byte cap is part of the schema, not a comment beside it: a
        // field-valid advertisement that serializes past capabilityBytes
        // refuses to parse, so lane V can treat parse success as proof of
        // the cap and lane C never has to drop what the schema called valid.
        // Bytes on the wire are UTF-8, not UTF-16 code units: one CJK
        // character is one code unit and three bytes.
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= DEVICE_LIMITS.capabilityBytes,
    ),
  )
export type DeviceCapability = z.infer<typeof deviceCapabilitySchema>

// Lanes A and K read: per-action admission grants bound to their owner. A
// device serves two orchestrators only with separate grants and quotas per
// owner. No credential field exists on any grant shape: a secret planted in
// one refuses to parse.
// Lanes A and K read: modes from narrowest to widest. This order is the
// ceiling order and deliberately differs from PERMISSION_MODES in
// constants.ts, where plan sorts after manual: an index compare over that
// array treats plan as wider than manual.
export const DEVICE_GRANT_MODE_ORDER = ['plan', 'manual', 'acceptEdits', 'auto'] as const
export type DeviceGrantMode = (typeof DEVICE_GRANT_MODE_ORDER)[number]
const grantMode = z.enum(DEVICE_GRANT_MODE_ORDER)
export const deviceGrantRequestSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    pairId: id,
    ownerId: id,
    roleId: id,
    mode: grantMode,
    repositoryId: id,
    lanes: z.boolean(),
    checks: z.boolean(),
    quota: deviceCapsSchema,
  })
  .check(z.refine((value) => value.lanes || value.checks))
export type DeviceGrantRequest = z.infer<typeof deviceGrantRequestSchema>

export const deviceGrantSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    grantId: id,
    grantRevision: revision,
    pairId: id,
    ownerId: id,
    roleId: id,
    mode: grantMode,
    repositoryId: id,
    lanes: z.boolean(),
    checks: z.boolean(),
    quota: deviceCapsSchema,
    issuedAt: timestamp,
    expiresAt: timestamp,
    requiresStepUp: z.boolean(),
  })
  .check(
    z.refine(
      (value) =>
        (value.lanes || value.checks) &&
        value.expiresAt > value.issuedAt &&
        value.expiresAt - value.issuedAt <= DEVICE_LIMITS.grantValidityMs,
    ),
  )
export type DeviceGrant = z.infer<typeof deviceGrantSchema>

// Lanes A and K read: the sender's ceiling a grant request is admitted
// against. grantCeilingRefusal returns null when the request fits inside
// the ceiling (mode no wider than the ceiling mode, every quota field no
// larger than the ceiling quota) and a typed scope-denied refusal naming
// the request's pair and owner otherwise. Parse success never means
// admission: lanes A and K call this before admitting.
export interface DeviceGrantCeiling {
  readonly mode: DeviceGrantMode
  readonly quota: DeviceCaps
}
const grantQuotaFields = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
] as const
export function grantCeilingRefusal(
  request: DeviceGrantRequest,
  ceiling: DeviceGrantCeiling,
): DeviceGrantRefusal | null {
  const isModeWider =
    DEVICE_GRANT_MODE_ORDER.indexOf(request.mode) > DEVICE_GRANT_MODE_ORDER.indexOf(ceiling.mode)
  const isQuotaWider = grantQuotaFields.some((field) => request.quota[field] > ceiling.quota[field])
  if (!isModeWider && !isQuotaWider) return null
  return {
    version: DEVICE_LIMITS.protocolVersion,
    pairId: request.pairId,
    ownerId: request.ownerId,
    reason: 'scope-denied',
    retryable: false,
  }
}

// A fresh per-action step-up, confirmed on the device. Presence is one of
// the device's real methods; there is no unattested kind, so a faked answer
// has no value that parses.
export const DEVICE_STEP_UP_METHODS = ['touch-id', 'windows-hello', 'local-confirm'] as const
export const deviceStepUpSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    grantId: id,
    actionDigest: digest,
    presence: z.enum(DEVICE_STEP_UP_METHODS),
    approvedAt: timestamp,
    expiresAt: timestamp,
  })
  .check(
    z.refine(
      (value) =>
        value.expiresAt > value.approvedAt &&
        value.expiresAt - value.approvedAt <= DEVICE_LIMITS.stepUpValidityMs,
    ),
  )
export type DeviceStepUpApproval = z.infer<typeof deviceStepUpSchema>

export const DEVICE_GRANT_REFUSALS = [
  'unknown-owner',
  'owner-mismatch',
  'grant-expired',
  'grant-revoked',
  'scope-denied',
  'quota-exceeded',
  'step-up-required',
  'presence-unverified',
] as const
export const deviceGrantRefusalSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  pairId: id,
  ownerId: id,
  reason: z.enum(DEVICE_GRANT_REFUSALS),
  retryable: z.boolean(),
})
export type DeviceGrantRefusal = z.infer<typeof deviceGrantRefusalSchema>

// Lane K reads: the owner/grant queue bounds as callable guards, mirroring
// canOpenHandshake. Lane K calls canAddOwner before binding another owner
// to a device and canAddGrant before issuing another grant under an owner,
// so the caps are enforced by the shared contract rather than picked per
// lane. Counts are current occupancy, not the incoming item.
export function canAddOwner(ownerCount: number): boolean {
  return (
    Number.isSafeInteger(ownerCount) &&
    ownerCount >= 0 &&
    ownerCount < DEVICE_LIMITS.ownersPerDevice
  )
}
export function canAddGrant(grantCount: number): boolean {
  return (
    Number.isSafeInteger(grantCount) && grantCount >= 0 && grantCount < DEVICE_LIMITS.grantsPerOwner
  )
}

// Lane R reads: the result channel. Results return content-addressed and
// are acknowledged once; a resend returns the recorded duplicate outcome,
// and a late result is quarantined, never silently applied.
export const deviceResultEnvelopeSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  identity: attempt,
  epoch: z.int().check(z.gte(1)),
  checkpoint: digest,
  resultDigest: digest,
  resultBytes: cap(DEVICE_LIMITS.artifactBytes).check(z.gte(1)),
  recordedAt: timestamp,
})
export type DeviceResultEnvelope = z.infer<typeof deviceResultEnvelopeSchema>

export const DEVICE_RESULT_DISPOSITIONS = ['accepted', 'quarantined', 'duplicate'] as const
export const deviceResultAckSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  identity: attempt,
  epoch: z.int().check(z.gte(1)),
  resultDigest: digest,
  settlementId: id,
  disposition: z.enum(DEVICE_RESULT_DISPOSITIONS),
  acknowledgedAt: timestamp,
})
export type DeviceResultAck = z.infer<typeof deviceResultAckSchema>

// Lane R reads: an acknowledgement settles one (epoch, digest) pair, never
// a digest alone. An old-epoch ack beside a new-epoch envelope with the
// same digest does not match, so copying the sample port still resends the
// new epoch instead of settling it. Lane R calls isAckForEnvelope before
// applying an ack and canQueueResultAck before queueing another wait.
export function isAckForEnvelope(ack: DeviceResultAck, envelope: DeviceResultEnvelope): boolean {
  return (
    isSameAttempt(ack.identity, envelope.identity) &&
    ack.epoch === envelope.epoch &&
    ack.resultDigest === envelope.resultDigest
  )
}
export function canQueueResultAck(pendingAcks: number): boolean {
  return (
    Number.isSafeInteger(pendingAcks) &&
    pendingAcks >= 0 &&
    pendingAcks < DEVICE_LIMITS.pendingResultAcks
  )
}

// Injected ports. Lanes C, V, A and R provide the real authorities; tests
// inject fakes. No port carries credentials, probes or unattested presence.
export interface DeviceChannelPort {
  open(input: DeviceReady): Promise<void>
  heartbeat(input: DeviceHeartbeat): Promise<void>
  close(): Promise<void>
}
export interface DeviceCapabilityPort {
  snapshot(): Promise<DeviceCapability>
}
export interface DeviceActionGrantPort {
  admit(request: DeviceGrantRequest): Promise<DeviceGrant | DeviceGrantRefusal>
  attestStepUp(approval: DeviceStepUpApproval): Promise<void>
}
export interface DeviceResultPort {
  publish(result: DeviceResultEnvelope): Promise<DeviceResultAck>
}

// M100 extends authenticated offers with this M108 field. A peer learns only
// per-provider headroom, never account ids, labels, groups or confirmations.
export const accountHeadroomSchema = z.enum(['ample', 'some', 'none'])
export const deviceAccountHeadroomSchema = z.record(accountIdSchema, accountHeadroomSchema)
