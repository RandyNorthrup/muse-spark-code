import * as z from 'zod/mini'
import {
  VAULT_APPROVAL_TTL_MS,
  VAULT_BASE64_GROUP_CHARS,
  VAULT_FORMAT_VERSION,
  VAULT_KDF,
  VAULT_LIMITS,
  VAULT_TOTP_DIGITS,
} from './constants'

const text = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]*$/u))
const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const time = z.number().check(z.int(), z.nonnegative())
const handle = z.string().check(z.regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u))
const bytes = z
  .instanceof(Uint8Array)
  .check(z.refine((v) => v.byteLength > 0 && v.byteLength <= VAULT_LIMITS.valueBytes))
export const vaultEncodedSchema = z.string().check(
  z.minLength(1),
  z.maxLength(VAULT_LIMITS.frameBytes, { abort: true }),
  z.regex(/^[A-Za-z0-9+/]*={0,2}$/u),
  z.refine((v) => v.length % VAULT_BASE64_GROUP_CHARS === 0),
)
const encoded = vaultEncodedSchema
const absolutePath = text.check(
  z.refine(
    (v) => v.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(v) || /^\\\\[^\\]+\\[^\\]+/u.test(v),
  ),
)
export const vaultOriginSchema = text.check(
  z.refine((v) => {
    try {
      const u = new URL(v)
      return (
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        u.origin === v &&
        u.username === '' &&
        u.password === ''
      )
    } catch {
      return false
    }
  }),
)
const origin = vaultOriginSchema
const resource = text.check(
  z.refine((v) => {
    try {
      const u = new URL(v)
      return (
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        u.username === '' &&
        u.password === '' &&
        u.hash === ''
      )
    } catch {
      return false
    }
  }),
)
const httpsOrigin = origin.check(z.startsWith('https://'))
const fingerprint = text.check(z.regex(/^SHA256:[A-Za-z0-9+/]{43}$/u))
const names = z.array(text).check(
  z.minLength(1),
  z.maxLength(VAULT_LIMITS.names),
  z.refine((v) => new Set(v).size === v.length),
)
const environmentNames = names.check(
  z.refine((v) => v.every((n) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(n))),
)
const role = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('orchestrator') }),
  z.strictObject({ kind: z.literal('subagent') }),
  z.strictObject({ kind: z.literal('role'), name: text }),
  z.strictObject({ kind: z.literal('hook'), name: text }),
  z.strictObject({ kind: z.literal('mcp'), name: text }),
  z.strictObject({ kind: z.literal('headless') }),
])

export const vaultRequesterSchema = z
  .strictObject({
    id,
    hostId: id,
    conversationId: z.nullable(text),
    taskId: z.nullable(text),
    role,
    workspaceId: z.nullable(text),
    deviceId: z.nullable(text),
    peerProcessId: time.check(z.positive()),
    sessionId: z.nullable(id),
    unattended: z.boolean(),
    source: z.enum([
      'conversation',
      'subagent',
      'candidate',
      'team',
      'hook',
      'mcp',
      'headless',
      'schedule',
      'timedSend',
      'goal',
      'relocated',
      'device',
    ]),
  })
  .check(
    z.refine(
      (v) =>
        !['headless', 'schedule', 'timedSend', 'goal', 'relocated'].includes(v.source) ||
        v.unattended,
    ),
  )
export type VaultRequester = z.infer<typeof vaultRequesterSchema>

export const vaultCommandSchema = z.strictObject({
  executable: absolutePath,
  argv: z.array(z.string().check(z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0]*$/u))).check(
    z.maxLength(VAULT_LIMITS.argv),
    z.refine((v) => v.every((arg) => !arg.includes('secret://'))),
  ),
  cwd: absolutePath,
})

const sshTarget = z
  .strictObject({
    kind: z.literal('ssh'),
    host: text,
    hostKeyFingerprint: z.nullable(fingerprint),
    remoteUser: text,
    sessionId: z.nullable(encoded),
    forwarding: z.boolean(),
  })
  .check(z.refine((v) => (v.hostKeyFingerprint === null) === (v.sessionId === null)))
const signTarget = z.strictObject({
  kind: z.literal('sshSign'),
  keyFingerprint: fingerprint,
  namespace: z.literal('git'),
  dataDigest: digest,
})
const commandFields = { command: vaultCommandSchema }
const sudoTarget = z.strictObject({
  kind: z.literal('sudo'),
  ...commandFields,
  sudoPath: absolutePath,
})
const askpassTarget = z.strictObject({
  kind: z.literal('askpass'),
  ...commandFields,
  sudoPath: absolutePath,
})
const gitTarget = z.strictObject({
  kind: z.literal('git'),
  ...commandFields,
  protocol: z.literal('https'),
  host: text,
  path: text,
})
const envTarget = z.strictObject({
  kind: z.literal('environment'),
  ...commandFields,
  names: environmentNames,
})
const stdinTarget = z.strictObject({ kind: z.literal('stdin'), ...commandFields })
const totpTarget = z.strictObject({ kind: z.literal('totp'), ...commandFields })
const mcpTarget = z.strictObject({
  kind: z.literal('mcp'),
  ...commandFields,
  server: text,
  names: environmentNames,
})
const headerTarget = z.strictObject({
  kind: z.literal('header'),
  origin,
  headerName: text.check(z.regex(/^[!#$%&'*+.^_`|~\w-]+$/u)),
})
const oauthTarget = z.strictObject({
  kind: z.literal('oauth'),
  origin,
  issuer: httpsOrigin,
  resource,
})
const fillTarget = z
  .strictObject({
    kind: z.literal('fill'),
    origin: httpsOrigin,
    topOrigin: httpsOrigin,
    frameOrigin: httpsOrigin,
    frameId: text,
    browserId: id,
    certificateValid: z.literal(true),
    field: z.enum(['username', 'password', 'totp']),
  })
  .check(z.refine((v) => v.origin === v.topOrigin && v.origin === v.frameOrigin))
const sessionTarget = z.strictObject({
  kind: z.literal('session'),
  origin: httpsOrigin,
  browserId: id,
})
const disclosureTarget = z.strictObject({ kind: z.literal('disclosure'), recipient: text })

/** A resolved use. Callers resolve command paths and verify live destinations before hashing. */
export const vaultUseSchema = z.discriminatedUnion('kind', [
  sshTarget,
  signTarget,
  sudoTarget,
  askpassTarget,
  gitTarget,
  envTarget,
  stdinTarget,
  totpTarget,
  mcpTarget,
  headerTarget,
  oauthTarget,
  fillTarget,
  sessionTarget,
  disclosureTarget,
])
export type VaultUse = z.infer<typeof vaultUseSchema>

/** Grant targets are explicit; no wildcard command is representable for sudo. */
export const vaultBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ssh'),
    host: text,
    hostKeyFingerprint: fingerprint,
    remoteUser: text,
    forwarding: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('sshAnyHost'), remoteUser: text, forwarding: z.boolean() }),
  z.strictObject({
    kind: z.literal('sshSign'),
    keyFingerprint: fingerprint,
    namespace: z.literal('git'),
  }),
  z.strictObject({
    kind: z.literal('sudo'),
    command: vaultCommandSchema,
    commandDigest: digest,
    sudoPath: absolutePath,
  }),
  z.strictObject({
    kind: z.literal('askpass'),
    command: vaultCommandSchema,
    commandDigest: digest,
    sudoPath: absolutePath,
  }),
  z.strictObject({ kind: z.literal('git'), protocol: z.literal('https'), host: text, path: text }),
  z.strictObject({
    kind: z.literal('environment'),
    commandDigest: digest,
    names: environmentNames,
  }),
  z.strictObject({ kind: z.literal('stdin'), commandDigest: digest }),
  z.strictObject({ kind: z.literal('totp'), commandDigest: digest }),
  z.strictObject({
    kind: z.literal('mcp'),
    server: text,
    commandDigest: digest,
    names: environmentNames,
  }),
  z.strictObject({ kind: z.literal('origin'), origin }),
  z.strictObject({
    kind: z.literal('oauth'),
    origin,
    issuer: httpsOrigin,
    resource,
  }),
  z.strictObject({ kind: z.literal('disclosure'), recipient: text }),
])
export type VaultBinding = z.infer<typeof vaultBindingSchema>

export const vaultPolicySchema = z.strictObject({
  mode: z.enum(['askEveryTime', 'askOncePerSession', 'alwaysAllow', 'never']),
  unattendedAllowed: z.boolean(),
  allowDisclosure: z.boolean(),
})
const ceiling = z.union([
  z.literal('none'),
  z.literal('ask'),
  z.array(handle).check(z.maxLength(VAULT_LIMITS.items)),
])
export const vaultGrantSchema = z
  .strictObject({
    id,
    itemId: id,
    roles: z.union([
      z.literal('any'),
      z.array(role).check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
    ]),
    workspaces: z.union([z.literal('any'), names]),
    target: vaultBindingSchema,
    maxUses: z.nullable(time.check(z.positive())),
    uses: time,
    expiresAt: z.nullable(time),
    window: z.nullable(
      z
        .strictObject({
          days: z.array(z.number().check(z.int(), z.minimum(0), z.maximum(VAULT_LIMITS.day))).check(
            z.minLength(1),
            z.refine((v) => new Set(v).size === v.length),
          ),
          startHour: z.number().check(z.int(), z.minimum(0)),
          endHour: z.number().check(z.int(), z.maximum(VAULT_LIMITS.hour)),
        })
        .check(z.refine((v) => v.startHour < v.endHour)),
    ),
    unattendedAllowed: z.boolean(),
    sessionId: z.nullable(id),
    taskId: z.nullable(text),
    ceiling,
    createdAt: time,
    createdBy: z.enum(['vaultPanel', 'vaultCli']),
  })
  .check(z.refine((v) => v.maxUses === null || v.uses <= v.maxUses))
export type VaultGrant = z.infer<typeof vaultGrantSchema>

const dates = z.strictObject({
  createdAt: time,
  rotatedAt: z.nullable(time),
  expiresAt: z.nullable(time),
  lastUsedAt: z.nullable(time),
})
const kinds = z.enum([
  'apiKey',
  'oauth',
  'sshKey',
  'password',
  'webLogin',
  'totp',
  'session',
  'secret',
  'devicePair',
  'internal',
])
/** Safe for panel/audit/list. Secret fields deliberately cannot be spread into this schema. */
export const vaultItemMetadataSchema = z
  .strictObject({
    id,
    name: text,
    handle,
    label: text.check(z.maxLength(VAULT_LIMITS.label)),
    kind: kinds,
    bindings: z.array(vaultBindingSchema).check(z.maxLength(VAULT_LIMITS.grants)),
    requirePresence: z.boolean(),
    hidden: z.boolean(),
    firstParty: z.boolean(),
    policy: vaultPolicySchema,
    dates,
    publicKey: z.nullable(text),
    fingerprint: z.nullable(fingerprint),
  })
  .check(
    z.refine((v) => v.handle === `secret://${v.name}`),
    z.refine(
      (v) =>
        (!v.firstParty && !['internal', 'devicePair'].includes(v.kind)) ||
        (v.hidden &&
          v.policy.mode === 'never' &&
          !v.policy.allowDisclosure &&
          !v.policy.unattendedAllowed),
    ),
    z.refine((v) => !v.requirePresence || !v.policy.unattendedAllowed),
    z.refine((v) => v.kind === 'sshKey' || (v.publicKey === null && v.fingerprint === null)),
  )
export type VaultItemMetadata = z.infer<typeof vaultItemMetadataSchema>

/** Private in-memory material. Never a host/webview, audit or device message. */
export const vaultMaterialSchema = z.union([
  z.strictObject({
    kind: z.literal('apiKey'),
    value: bytes,
    auth: z.enum(['bearer', 'apiKey', 'header']),
    origin,
  }),
  z.strictObject({
    kind: z.literal('oauth'),
    accessToken: bytes,
    refreshToken: z.nullable(bytes),
    issuer: httpsOrigin,
    expiresAt: time,
    resource,
  }),
  z.strictObject({
    kind: z.literal('sshKey'),
    storage: z.literal('software'),
    privateKey: bytes,
    algorithm: z.enum(['ed25519', 'ecdsa-p256', 'rsa']),
  }),
  z.strictObject({
    kind: z.literal('sshKey'),
    storage: z.literal('hardware'),
    keyReference: text,
    algorithm: z.literal('ecdsa-p256'),
  }),
  z.strictObject({ kind: z.literal('password'), username: z.nullable(bytes), password: bytes }),
  z.strictObject({
    kind: z.literal('webLogin'),
    origins: z.array(httpsOrigin).check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
    username: bytes,
    password: bytes,
    totpSeed: z.nullable(bytes),
  }),
  z.strictObject({
    kind: z.literal('totp'),
    seed: bytes,
    algorithm: z.enum(['sha1', 'sha256', 'sha512']),
    digits: z.union([z.literal(VAULT_TOTP_DIGITS.standard), z.literal(VAULT_TOTP_DIGITS.extended)]),
    periodSeconds: time.check(z.positive()),
  }),
  z.strictObject({
    kind: z.literal('session'),
    origin: httpsOrigin,
    cookies: bytes,
    expiresAt: time,
  }),
  z.strictObject({ kind: z.literal('secret'), value: bytes }),
  z.strictObject({ kind: z.literal('devicePair'), value: bytes }),
  z.strictObject({ kind: z.literal('internal'), value: bytes }),
])
export const vaultItemSchema = z
  .strictObject({ metadata: vaultItemMetadataSchema, material: vaultMaterialSchema })
  .check(z.refine((v) => v.metadata.kind === v.material.kind))
export type VaultItem = z.infer<typeof vaultItemSchema>

export const vaultTaintSchema = z
  .strictObject({
    tainted: z.boolean(),
    reasons: z
      .array(
        z.strictObject({
          source: z.enum([
            'web',
            'search',
            'browser',
            'mcp',
            'issue',
            'pullRequest',
            'agent',
            'device',
            'restrictedWorkspace',
          ]),
          label: text,
        }),
      )
      .check(z.maxLength(VAULT_LIMITS.reasons)),
  })
  .check(z.refine((v) => v.tainted || v.reasons.length === 0))
export type VaultTaint = z.infer<typeof vaultTaintSchema>

export const vaultApprovalRequestSchema = z
  .strictObject({
    id,
    requester: vaultRequesterSchema,
    item: vaultItemMetadataSchema,
    use: vaultUseSchema,
    digest,
    nonce: id,
    createdAt: time,
    expiresAt: time,
    lockEpoch: time,
    taint: vaultTaintSchema,
  })
  .check(
    z.refine(
      (v) => v.expiresAt > v.createdAt && v.expiresAt - v.createdAt <= VAULT_APPROVAL_TTL_MS,
    ),
  )
export type VaultApprovalRequest = z.infer<typeof vaultApprovalRequestSchema>
export const vaultApprovalAnswerSchema = z.strictObject({
  requestId: id,
  digest,
  decision: z.enum(['allowOnce', 'allowSession', 'deny']),
})
export type VaultApprovalAnswer = z.infer<typeof vaultApprovalAnswerSchema>
export const vaultTicketSchema = z
  .strictObject({
    id,
    requestId: id,
    requesterId: id,
    itemId: id,
    digest,
    nonce: id,
    issuedAt: time,
    expiresAt: time,
    lockEpoch: time,
    maxUses: z.literal(1),
  })
  .check(
    z.refine((v) => v.expiresAt > v.issuedAt && v.expiresAt - v.issuedAt <= VAULT_APPROVAL_TTL_MS),
  )
export type VaultTicket = z.infer<typeof vaultTicketSchema>

/** Audit stores a digest and redacted target, never the raw argv or a value. */
export const vaultAuditRecordSchema = z.strictObject({
  v: z.literal(VAULT_FORMAT_VERSION),
  id,
  generation: time,
  time,
  requester: vaultRequesterSchema,
  handle,
  kind: z.enum([
    'ssh',
    'sshSign',
    'sudo',
    'askpass',
    'git',
    'environment',
    'stdin',
    'totp',
    'mcp',
    'header',
    'oauth',
    'fill',
    'session',
    'disclosure',
  ]),
  target: text,
  digest,
  decision: z.enum(['allow', 'deny', 'ask']),
  authority: z.enum(['mode', 'grant', 'user', 'taint', 'failClosed', 'presence']),
  grantId: z.nullable(id),
  outcome: z.enum([
    'pending',
    'succeeded',
    'failed',
    'denied',
    'revoked',
    'locked',
    'expired',
    'unrecallable',
  ]),
  previousHash: digest,
  hash: digest,
  mac: digest,
})
export type VaultAuditRecord = z.infer<typeof vaultAuditRecordSchema>

const kdf = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('argon2id'),
    salt: encoded,
    memoryKiB: z.literal(VAULT_KDF.argon2.memoryKiB),
    iterations: z.literal(VAULT_KDF.argon2.iterations),
    parallelism: z.literal(VAULT_KDF.argon2.parallelism),
  }),
  z.strictObject({
    kind: z.literal('scrypt'),
    salt: encoded,
    N: z.literal(VAULT_KDF.scrypt.N),
    r: z.literal(VAULT_KDF.scrypt.r),
    p: z.literal(VAULT_KDF.scrypt.p),
  }),
])
export const vaultSlotRecordSchema = z
  .strictObject({
    v: z.literal(VAULT_FORMAT_VERSION),
    id,
    vaultId: id,
    lastGeneration: time,
    auditGeneration: time,
    auditHead: digest,
    createdAt: time,
    tier: z.enum(['hardware', 'presence', 'osStore', 'secretStorage', 'passphrase', 'recovery']),
    provider: z.enum([
      'windowsTpm',
      'secureEnclave',
      'linuxTpm2',
      'windowsDpapi',
      'loginKeychain',
      'secretService',
      'secretStorage',
      'passphrase',
      'recovery',
    ]),
    keyReference: z.nullable(text),
    wrappedKey: encoded,
    nonce: z.nullable(encoded),
    tag: z.nullable(encoded),
    kdf: z.nullable(kdf),
    backend: z.nullable(
      z.enum(['dpapi', 'keychain', 'gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']),
    ),
  })
  .check(
    z.refine((v) => {
      switch (v.tier) {
        case 'hardware': {
          return (
            ['windowsTpm', 'secureEnclave', 'linuxTpm2'].includes(v.provider) &&
            v.keyReference !== null &&
            v.kdf === null
          )
        }
        case 'presence': {
          return v.provider === 'passphrase'
            ? v.kdf !== null && v.nonce !== null && v.tag !== null
            : ['windowsTpm', 'secureEnclave', 'linuxTpm2'].includes(v.provider) &&
                v.keyReference !== null &&
                v.kdf === null
        }
        case 'osStore': {
          return (
            ['windowsDpapi', 'loginKeychain', 'secretService'].includes(v.provider) &&
            v.kdf === null
          )
        }
        case 'secretStorage': {
          return v.provider === 'secretStorage' && v.backend !== null && v.kdf === null
        }
        case 'passphrase': {
          return v.provider === 'passphrase' && v.kdf !== null && v.nonce !== null && v.tag !== null
        }
        case 'recovery': {
          return v.provider === 'recovery' && v.kdf === null && v.nonce !== null && v.tag !== null
        }
      }
    }),
  )
export type VaultSlotRecord = z.infer<typeof vaultSlotRecordSchema>

/** Implemented by C; all owned byte buffers must be erased by their final consumer. */
export interface VaultStorePort {
  list(): Promise<readonly VaultItemMetadata[]>
  read(id: string): Promise<VaultItem>
  write(item: VaultItem): Promise<void>
  remove(id: string): Promise<void>
  lock(): void
}
/** Implemented by P. Presence must be checked for each use, not cached by the caller. */
export interface VaultSlotPort {
  readonly tier: VaultSlotRecord['tier']
  wrap(key: Uint8Array): Promise<VaultSlotRecord>
  unwrap(slot: VaultSlotRecord, use: string): Promise<Uint8Array>
}
export interface VaultClockPort {
  now(): number
}
