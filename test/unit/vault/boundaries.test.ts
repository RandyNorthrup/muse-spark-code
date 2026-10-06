import { describe, expect, it } from 'vitest'
import * as vault from '../../../src/shared/vault'
import * as protocol from '../../../src/shared/vaultProtocol'
import { vaultPanelStateSchema } from '../../../src/shared/modelsPanel'
import { vaultClientMessageSchema } from '../../../src/shared/hostApi/vaultMessages'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { FakeVaultSlot } from '../helpers/vault/core'
import { audit, grant, metadata, panel, requester, use } from '../helpers/vault/fixtures'

const longText = 'x'.repeat(VAULT_LIMITS.text + 1)
const many = Array.from({ length: VAULT_LIMITS.items + 1 }, () => metadata())
const ssh = {
  kind: 'ssh',
  host: 'example.test',
  hostKeyFingerprint: `SHA256:${'a'.repeat(43)}`,
  remoteUser: 'deploy',
  sessionId: 'YQ==',
  forwarding: false,
}
const oauth = {
  kind: 'oauth',
  origin: 'https://mcp.example.test',
  issuer: 'https://auth.example.test',
  resource: 'https://mcp.example.test/server',
}
const lock = {
  v: 1,
  processId: 1,
  startedAt: 0,
  brokerId: 'a'.repeat(32),
  userSession: 'test',
  socket: '/test',
}
const material = {
  v: 1,
  kind: 'material',
  requestId: 'a'.repeat(32),
  encoding: 'base64',
  bytes: 'YQ==',
}
const remote = {
  v: 1,
  id: 'a'.repeat(32),
  owningDeviceId: 'b'.repeat(32),
  use: {
    kind: 'ssh',
    host: 'example.test',
    hostKeyFingerprint: `SHA256:${'a'.repeat(43)}`,
    remoteUser: 'deploy',
    sessionDigest: 'a'.repeat(64),
    forwarding: false,
  },
}

describe('M109 boundary limits', () => {
  it.each([
    {
      name: 'empty text',
      schema: vault.vaultRequesterSchema,
      input: { ...requester(), conversationId: '' },
    },
    {
      name: 'long text',
      schema: vault.vaultRequesterSchema,
      input: { ...requester(), conversationId: longText },
    },
    {
      name: 'fractional counter',
      schema: vault.vaultRequesterSchema,
      input: { ...requester(), peerProcessId: 1.5 },
    },
    {
      name: 'zero peer',
      schema: vault.vaultRequesterSchema,
      input: { ...requester(), peerProcessId: 0 },
    },
    {
      name: 'malformed digest',
      schema: vault.vaultAuditRecordSchema,
      input: { ...audit(), digest: 'not-a-digest' },
    },
    { name: 'empty SSH session', schema: vault.vaultUseSchema, input: { ...ssh, sessionId: '' } },
    {
      name: 'large SSH session',
      schema: vault.vaultUseSchema,
      input: { ...ssh, sessionId: 'YWFh'.repeat(VAULT_LIMITS.frameBytes) },
    },
    {
      name: 'bad SSH encoding',
      schema: vault.vaultUseSchema,
      input: { ...ssh, sessionId: '%%%%' },
    },
    {
      name: 'partial base64 group',
      schema: vault.vaultUseSchema,
      input: { ...ssh, sessionId: 'YQ=' },
    },
    {
      name: 'partial private group',
      schema: protocol.vaultPrivateMaterialSchema,
      input: { ...material, bytes: 'YQ=' },
    },
    {
      name: 'long argv',
      schema: vault.vaultCommandSchema,
      input: { ...use().command, argv: [longText] },
    },
    {
      name: 'bad header token',
      schema: vault.vaultUseSchema,
      input: { kind: 'header', origin: 'https://example.test', headerName: 'Two Words' },
    },
    {
      name: 'bad use resource',
      schema: vault.vaultUseSchema,
      input: { ...oauth, resource: 'relative' },
    },
    {
      name: 'bad binding resource',
      schema: vault.vaultBindingSchema,
      input: { ...oauth, resource: 'relative' },
    },
    {
      name: 'bad material resource',
      schema: vault.vaultMaterialSchema,
      input: {
        kind: 'oauth',
        accessToken: new Uint8Array([1]),
        refreshToken: null,
        issuer: 'https://auth.example.test',
        expiresAt: 1000,
        resource: 'relative',
      },
    },
    {
      name: 'credential-bearing resource',
      schema: vault.vaultUseSchema,
      input: { ...oauth, resource: 'https://user:password@mcp.example.test' },
    },
    {
      name: 'fragment resource',
      schema: vault.vaultUseSchema,
      input: { ...oauth, resource: 'https://mcp.example.test/#fragment' },
    },
    {
      name: 'large ceiling',
      schema: vault.vaultGrantSchema,
      input: { ...grant(), ceiling: many.map(() => metadata().handle) },
    },
    {
      name: 'large roles',
      schema: vault.vaultGrantSchema,
      input: {
        ...grant(),
        roles: Array.from({ length: VAULT_LIMITS.names + 1 }, () => ({ kind: 'orchestrator' })),
      },
    },
    {
      name: 'large bindings',
      schema: vault.vaultItemMetadataSchema,
      input: { ...metadata(), bindings: many.map(() => grant().target) },
    },
    {
      name: 'large origins',
      schema: vault.vaultMaterialSchema,
      input: {
        kind: 'webLogin',
        origins: Array.from({ length: VAULT_LIMITS.names + 1 }, () => 'https://example.test'),
        username: new Uint8Array([1]),
        password: new Uint8Array([1]),
        totpSeed: null,
      },
    },
    {
      name: 'empty origins',
      schema: vault.vaultMaterialSchema,
      input: {
        kind: 'webLogin',
        origins: [],
        username: new Uint8Array([1]),
        password: new Uint8Array([1]),
        totpSeed: null,
      },
    },
    {
      name: 'zero TOTP period',
      schema: vault.vaultMaterialSchema,
      input: {
        kind: 'totp',
        seed: new Uint8Array([1]),
        algorithm: 'sha1',
        digits: 6,
        periodSeconds: 0,
      },
    },
    {
      name: 'large taint',
      schema: vault.vaultTaintSchema,
      input: {
        tainted: true,
        reasons: Array.from({ length: VAULT_LIMITS.reasons + 1 }, () => ({
          source: 'web',
          label: 'page',
        })),
      },
    },
    {
      name: 'protocol id',
      schema: protocol.vaultBrokerLockSchema,
      input: { ...lock, brokerId: 'bad' },
    },
    {
      name: 'protocol digest',
      schema: protocol.vaultRemoteRequestSchema,
      input: { ...remote, use: { ...remote.use, sessionDigest: 'bad' } },
    },
    {
      name: 'protocol empty text',
      schema: protocol.vaultBrokerLockSchema,
      input: { ...lock, socket: '' },
    },
    {
      name: 'protocol long text',
      schema: protocol.vaultBrokerLockSchema,
      input: { ...lock, socket: longText },
    },
    {
      name: 'protocol text controls',
      schema: protocol.vaultBrokerLockSchema,
      input: { ...lock, socket: 'line\nline' },
    },
    {
      name: 'protocol fractional counter',
      schema: protocol.vaultBrokerRequestSchema,
      input: { v: 1, sequence: 1.5, request: { kind: 'status' } },
    },
    {
      name: 'protocol negative counter',
      schema: protocol.vaultBrokerRequestSchema,
      input: { v: 1, sequence: -1, request: { kind: 'status' } },
    },
    {
      name: 'protocol handle',
      schema: protocol.vaultUseProposalSchema,
      input: { handle: 'bad', use: use(), taint: { tainted: false, reasons: [] } },
    },
    {
      name: 'large scrub request',
      schema: protocol.vaultBrokerRequestSchema,
      input: {
        v: 1,
        sequence: 0,
        request: { kind: 'scrub', text: 'x'.repeat(VAULT_LIMITS.frameBytes + 1) },
      },
    },
    {
      name: 'large scrub response',
      schema: protocol.vaultBrokerResponseSchema,
      input: {
        v: 1,
        sequence: 0,
        response: { kind: 'scrubbed', text: 'x'.repeat(VAULT_LIMITS.frameBytes + 1) },
      },
    },
    {
      name: 'large items',
      schema: protocol.vaultBrokerResponseSchema,
      input: { v: 1, sequence: 0, response: { kind: 'items', items: many } },
    },
    {
      name: 'large audit',
      schema: protocol.vaultBrokerResponseSchema,
      input: { v: 1, sequence: 0, response: { kind: 'audit', records: many.map(() => audit()) } },
    },
    {
      name: 'empty private encoding',
      schema: protocol.vaultPrivateMaterialSchema,
      input: { ...material, bytes: '' },
    },
    {
      name: 'large private encoding',
      schema: protocol.vaultPrivateMaterialSchema,
      input: { ...material, bytes: 'YWFh'.repeat(VAULT_LIMITS.frameBytes) },
    },
    {
      name: 'bad remote fingerprint',
      schema: protocol.vaultRemoteRequestSchema,
      input: { ...remote, use: { ...remote.use, hostKeyFingerprint: 'bad' } },
    },
    ...['vaultRevoke', 'vaultRemove', 'vaultPublicKey'].map((type) => ({
      name: `${type} identifier`,
      schema: vaultClientMessageSchema,
      input: type === 'vaultRevoke' ? { type, grantId: 'bad' } : { type, itemId: 'bad' },
    })),
    {
      name: 'remote HTTP origin',
      schema: protocol.vaultRemoteRequestSchema,
      input: {
        ...remote,
        use: {
          kind: 'totp',
          origin: new URL('https://example.test').origin.replace('https:', 'http:'),
        },
      },
    },
    {
      name: 'client identifier',
      schema: vaultClientMessageSchema,
      input: { type: 'vaultEdit', itemId: 'bad' },
    },
  ])('rejects $name', ({ schema, input }) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  it.each([
    { days: [1.5], startHour: 0, endHour: 24 },
    { days: [-1], startHour: 0, endHour: 24 },
    { days: [1], startHour: 0.5, endHour: 24 },
    { days: [1], startHour: -1, endHour: 24 },
    { days: [1], startHour: 0, endHour: 0.5 },
    { days: [1], startHour: 0, endHour: 0 },
  ])('rejects fractional or out-of-range window $days $startHour $endHour', (window) => {
    expect(vault.vaultGrantSchema.safeParse({ ...grant(), window }).success).toBe(false)
  })

  it('checks name and handle format and their equality', () => {
    for (const name of ['Bad', 'a'.repeat(49), 'bad_name'])
      expect(
        vault.vaultItemMetadataSchema.safeParse({ ...metadata(), name, handle: `secret://${name}` })
          .success,
      ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), handle: 'secret://other' }).success,
    ).toBe(false)
  })

  it('requires slot encryption metadata and pinned KDF parameters', async () => {
    const slot = await new FakeVaultSlot('passphrase').wrap(new Uint8Array([1]))
    for (const extra of [
      { kdf: null },
      { nonce: null },
      { tag: null },
      { provider: 'secretService' },
      { kdf: { kind: 'scrypt', salt: 'YQ==', N: 2, r: 8, p: 1 } },
      { kdf: { kind: 'argon2id', salt: 'YQ==', memoryKiB: 1, iterations: 3, parallelism: 4 } },
      { wrappedKey: '%%%%' },
    ])
      expect(vault.vaultSlotRecordSchema.safeParse({ ...slot, ...extra }).success).toBe(false)
  })

  it('rejects oversized panel lists and ambient paths', () => {
    const approval = {
      id: 'a'.repeat(32),
      requester: requester(),
      item: metadata(),
      use: use(),
      digest: 'b'.repeat(64),
      nonce: 'c'.repeat(32),
      createdAt: 0,
      expiresAt: 1000,
      lockEpoch: 0,
      taint: { tainted: false, reasons: [] },
    }
    const entries = Object.entries({
      items: metadata(),
      grants: grant(),
      audit: audit(),
      pending: approval,
      ambientFiles: { path: '/test', kind: 'ssh' },
    })
    for (const [key, entry] of entries) {
      expect(
        vaultPanelStateSchema.safeParse({ ...panel(), [key]: many.map(() => entry) }).success,
      ).toBe(false)
    }
    expect(
      vaultPanelStateSchema.safeParse({
        ...panel(),
        ambientFiles: [{ path: longText, kind: 'ssh' }],
      }).success,
    ).toBe(false)
  })
})
