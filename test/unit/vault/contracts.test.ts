import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import * as vault from '../../../src/shared/vault'
import * as protocol from '../../../src/shared/vaultProtocol'
import { vaultPanelStateSchema } from '../../../src/shared/modelsPanel'
import {
  vaultClientMessageSchema,
  vaultHostMessageSchema,
} from '../../../src/shared/hostApi/vaultMessages'
import {
  approval as approvalFixture,
  audit,
  grant,
  item,
  metadata,
  panel,
  requester,
  ticket as ticketFixture,
  use,
} from '../helpers/vault/fixtures'
import {
  FakeVaultBroker,
  FakeVaultClock,
  FakeVaultSlot,
  InMemoryVault,
} from '../helpers/vault/core'
import * as constants from '../../../src/shared/constants'

describe('M109 strict contracts', () => {
  it('V1 V4 V8 V9: no value can be added to metadata, panel, audit or host messages', () => {
    const value = randomBytes(32).toString('base64')
    expect(vault.vaultItemMetadataSchema.parse(metadata())).toEqual(metadata())
    expect(vault.vaultAuditRecordSchema.parse(audit())).toEqual(audit())
    expect(vaultPanelStateSchema.parse(panel())).toEqual(panel())
    expect(vaultHostMessageSchema.parse({ type: 'vaultState', state: panel() }).state).toEqual(
      panel(),
    )
    for (const schemaAndData of [
      { schema: vault.vaultItemMetadataSchema, data: metadata() },
      { schema: vault.vaultAuditRecordSchema, data: audit() },
      { schema: vaultPanelStateSchema, data: panel() },
    ])
      expect(schemaAndData.schema.safeParse({ ...schemaAndData.data, value }).success).toBe(false)
    expect(
      vaultPanelStateSchema.safeParse({ ...panel(), items: [{ ...metadata(), password: value }] })
        .success,
    ).toBe(false)
    expect(vaultClientMessageSchema.safeParse({ type: 'vaultAdd', value }).success).toBe(false)
    expect(
      vaultClientMessageSchema.safeParse({ type: 'vaultEdit', itemId: metadata().id, value })
        .success,
    ).toBe(false)
  })

  it('validates handles, names, identifiers and bounded metadata', () => {
    for (const name of ['', 'Upper', 'a_b', 'a'.repeat(49), 'with space']) {
      expect(
        vault.vaultItemMetadataSchema.safeParse({ ...metadata(), name, handle: `secret://${name}` })
          .success,
      ).toBe(false)
    }
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), handle: 'secret://other' }).success,
    ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), label: 'x'.repeat(257) }).success,
    ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), label: 'line\nvalue' }).success,
    ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), id: 'a'.repeat(31) }).success,
    ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({
        ...metadata(),
        dates: { ...metadata().dates, createdAt: Number.MAX_SAFE_INTEGER + 1 },
      }).success,
    ).toBe(false)
  })

  it('first-party and internal items are hidden, Never and undisclosable', () => {
    for (const extra of [{ firstParty: true }, { kind: 'devicePair' }, { kind: 'internal' }]) {
      expect(vault.vaultItemMetadataSchema.safeParse({ ...metadata(), ...extra }).success).toBe(
        false,
      )
      expect(
        vault.vaultItemMetadataSchema.safeParse({
          ...metadata(),
          ...extra,
          hidden: true,
          policy: { ...metadata().policy, mode: 'never' },
        }).success,
      ).toBe(true)
    }
    expect(
      vault.vaultItemMetadataSchema.safeParse({ ...metadata(), publicKey: 'ssh-ed25519 public' })
        .success,
    ).toBe(false)
    expect(
      vault.vaultItemMetadataSchema.safeParse({
        ...metadata(),
        kind: 'sshKey',
        fingerprint: 'SHA256:bad',
      }).success,
    ).toBe(false)
  })

  it('V7: private material is bytes, with matching kinds; passkeys have no representation', () => {
    expect(vault.vaultItemSchema.parse(item()).material.kind).toBe('secret')
    expect(
      vault.vaultItemSchema.safeParse({
        metadata: metadata(),
        material: { kind: 'secret', value: 'text' },
      }).success,
    ).toBe(false)
    expect(
      vault.vaultItemSchema.safeParse({
        metadata: metadata(),
        material: { kind: 'secret', value: new Uint8Array() },
      }).success,
    ).toBe(false)
    expect(
      vault.vaultItemSchema.safeParse({
        metadata: metadata(),
        material: { kind: 'secret', value: new Uint8Array(constants.VAULT_LIMITS.valueBytes + 1) },
      }).success,
    ).toBe(false)
    expect(
      vault.vaultItemSchema.safeParse({
        metadata: metadata(),
        material: {
          kind: 'totp',
          seed: randomBytes(20),
          algorithm: 'sha1',
          digits: 6,
          periodSeconds: 30,
        },
      }).success,
    ).toBe(false)
    expect(
      vault.vaultMaterialSchema.safeParse({ kind: 'passkey', privateKey: randomBytes(32) }).success,
    ).toBe(false)
    expect(
      vault.vaultMaterialSchema.safeParse({
        kind: 'sshKey',
        storage: 'hardware',
        keyReference: 'test',
        algorithm: 'ed25519',
      }).success,
    ).toBe(false)
  })

  it('represents all item kinds without putting material into metadata', () => {
    const value = randomBytes(32)
    const materials = [
      { kind: 'apiKey', value, auth: 'bearer', origin: 'https://api.example.test' },
      {
        kind: 'oauth',
        accessToken: value,
        refreshToken: null,
        issuer: 'https://auth.example.test',
        expiresAt: 1000,
        resource: 'https://mcp.example.test/server',
      },
      { kind: 'sshKey', storage: 'software', privateKey: value, algorithm: 'ed25519' },
      {
        kind: 'sshKey',
        storage: 'hardware',
        keyReference: 'generated-test-key',
        algorithm: 'ecdsa-p256',
      },
      { kind: 'password', username: null, password: value },
      {
        kind: 'webLogin',
        origins: ['https://example.test'],
        username: value,
        password: value,
        totpSeed: null,
      },
      { kind: 'totp', seed: value, algorithm: 'sha256', digits: 8, periodSeconds: 30 },
      { kind: 'session', origin: 'https://example.test', cookies: value, expiresAt: 1000 },
      { kind: 'secret', value },
      { kind: 'devicePair', value },
      { kind: 'internal', value },
    ]
    for (const material of materials)
      expect(vault.vaultMaterialSchema.safeParse(material).success).toBe(true)
  })

  it('V2 V15: command and sudo paths must be absolute and arguments cannot contain NUL', () => {
    expect(vault.vaultCommandSchema.parse(use().command)).toEqual(use().command)
    expect(
      vault.vaultCommandSchema.safeParse({ ...use().command, executable: 'sudo' }).success,
    ).toBe(false)
    expect(vault.vaultCommandSchema.safeParse({ ...use().command, cwd: '.' }).success).toBe(false)
    expect(
      vault.vaultCommandSchema.safeParse({ ...use().command, argv: ['bad\0arg'] }).success,
    ).toBe(false)
    expect(
      vault.vaultCommandSchema.safeParse({
        ...use().command,
        argv: ['--token=secret://test-secret'],
      }).success,
    ).toBe(false)
    expect(
      vault.vaultCommandSchema.safeParse({
        ...use().command,
        argv: Array.from({ length: 257 }, () => ''),
      }).success,
    ).toBe(false)
    expect(
      vault.vaultUseSchema.safeParse({ kind: 'sudo', command: use().command, sudoPath: 'sudo' })
        .success,
    ).toBe(false)
    expect(
      vault.vaultBindingSchema.safeParse({
        kind: 'sudo',
        command: '*',
        commandDigest: '*',
        sudoPath: '/usr/bin/sudo',
      }).success,
    ).toBe(false)
  })

  it('V3: origins and OAuth audiences are canonical and bound, not credential-bearing URLs', () => {
    for (const origin of [
      'https://user:password@example.test',
      'https://example.test/path',
      'https://EXAMPLE.test',
      'https://example.test:443',
      'file:///test',
      'https://éxample.test',
    ]) {
      expect(vault.vaultBindingSchema.safeParse({ kind: 'origin', origin }).success).toBe(false)
    }
    expect(
      vault.vaultBindingSchema.safeParse({
        kind: 'oauth',
        origin: 'https://mcp.example.test',
        issuer: new URL('https://auth.example.test').href.replace('https:', 'http:'),
        resource: 'https://mcp.example.test',
      }).success,
    ).toBe(false)
    expect(
      vault.vaultUseSchema.safeParse({
        kind: 'header',
        origin: 'https://example.test',
        headerName: 'X-Test\nInjected',
      }).success,
    ).toBe(false)
  })

  it('RVM109L0 P2 issuer: OAuth contracts preserve complete HTTPS issuer identifiers', () => {
    const oauth = {
      kind: 'oauth',
      origin: 'https://mcp.example.test',
      resource: 'https://mcp.example.test/server',
    }
    const privateMaterial = {
      kind: 'oauth',
      accessToken: randomBytes(32),
      refreshToken: null,
      expiresAt: 1000,
      resource: oauth.resource,
    }
    for (const issuer of [
      'https://auth.example.test',
      'https://auth.example.test/',
      'https://auth.example.test/realms/team',
      'https://AUTH.example.test:443/realms/%74eam/',
      'HTTPS://auth.example.test/realms/team',
    ]) {
      for (const [schema, value] of [
        [vault.vaultUseSchema, oauth],
        [vault.vaultBindingSchema, oauth],
        [vault.vaultMaterialSchema, privateMaterial],
      ] as const) {
        const parsed = schema.parse({ ...value, issuer })
        expect(parsed.kind === 'oauth' && parsed.issuer).toBe(issuer)
      }
    }
    for (const issuer of [
      new URL('https://auth.example.test').href.replace('https:', 'http:'),
      'https://auth.example.test/realms/team?audience=mcp',
      'https://auth.example.test/realms/team?',
      'https://auth.example.test/realms/team#fragment',
      'https://auth.example.test/realms/team#',
      'https://user:password@auth.example.test/realms/team',
      'https://@auth.example.test/realms/team',
      'https://auth.example.test/realms/team with space',
      String.raw`https://auth.example.test\realms\team`,
      'https:///auth.example.test',
      'https://[invalid]/realm',
      '/realms/team',
    ]) {
      for (const [schema, value] of [
        [vault.vaultUseSchema, oauth],
        [vault.vaultBindingSchema, oauth],
        [vault.vaultMaterialSchema, privateMaterial],
      ] as const)
        expect(schema.safeParse({ ...value, issuer }).success, issuer).toBe(false)
    }
  })

  it('RVM109L0 P2 issuer: the committed issuer JSON Schema matches its runtime boundary', () => {
    const committed: unknown = JSON.parse(
      readFileSync(
        new URL('../../../docs/schemas/vault-issuer-v1.schema.json', import.meta.url),
        'utf8',
      ),
    )
    expect(committed).toEqual({ ...z.toJSONSchema(vault.vaultIssuerSchema), format: 'uri' })
  })

  it('V14: fill rejects IDN look-alikes, HTTP, cross-origin frames and invalid certificates', () => {
    const fill = {
      kind: 'fill',
      origin: 'https://example.test',
      topOrigin: 'https://example.test',
      frameOrigin: 'https://example.test',
      frameId: 'frame',
      browserId: 'a'.repeat(32),
      certificateValid: true,
      field: 'password',
    }
    expect(vault.vaultUseSchema.safeParse(fill).success).toBe(true)
    for (const extra of [
      { topOrigin: 'https://xn--xample-9ua.test' },
      { frameOrigin: 'https://outside.test' },
      { certificateValid: false },
      {
        origin: new URL('https://example.test').origin.replace('https:', 'http:'),
        topOrigin: new URL('https://example.test').origin.replace('https:', 'http:'),
        frameOrigin: new URL('https://example.test').origin.replace('https:', 'http:'),
      },
    ])
      expect(vault.vaultUseSchema.safeParse({ ...fill, ...extra }).success).toBe(false)
  })

  it('validates environment names as a nonempty unique set', () => {
    for (const names of [
      [],
      ['DUP', 'DUP'],
      ['bad-name'],
      ['bad\nname'],
      Array.from({ length: 129 }, (_, n) => `NAME_${String(n)}`),
    ]) {
      expect(vault.vaultUseSchema.safeParse({ ...use(), names }).success).toBe(false)
    }
  })

  it('V12: presence cannot allow unattended use; unattended sources must say so', () => {
    expect(
      vault.vaultItemMetadataSchema.safeParse({
        ...metadata(),
        requirePresence: true,
        policy: { ...metadata().policy, unattendedAllowed: true },
      }).success,
    ).toBe(false)
    for (const source of ['headless', 'schedule', 'timedSend', 'goal', 'relocated']) {
      expect(
        vault.vaultRequesterSchema.safeParse({ ...requester(), source, unattended: false }).success,
      ).toBe(false)
      expect(
        vault.vaultRequesterSchema.safeParse({ ...requester(), source, unattended: true }).success,
      ).toBe(true)
    }
  })

  it('V11: grants validate every count and local-time window and cannot come from model or prompt', () => {
    expect(vault.vaultGrantSchema.parse(grant())).toEqual(grant())
    for (const extra of [
      { uses: 3 },
      { maxUses: 0 },
      { maxUses: -1 },
      { expiresAt: -1 },
      { roles: [] },
      { workspaces: [] },
      { createdBy: 'model' },
      { createdBy: 'approval' },
    ]) {
      expect(vault.vaultGrantSchema.safeParse({ ...grant(), ...extra }).success).toBe(false)
    }
    for (const window of [
      { days: [7], startHour: 0, endHour: 24 },
      { days: [1, 1], startHour: 0, endHour: 24 },
      { days: [], startHour: 0, endHour: 24 },
      { days: [1], startHour: 24, endHour: 24 },
      { days: [1], startHour: 0, endHour: 25 },
      { days: [1], startHour: 8, endHour: 8 },
    ]) {
      expect(vault.vaultGrantSchema.safeParse({ ...grant(), window }).success).toBe(false)
    }
    expect(
      vault.vaultGrantSchema.safeParse({
        ...grant(),
        window: { days: [0, 6], startHour: 8, endHour: 17 },
      }).success,
    ).toBe(true)
  })

  it('V1: taint carries provenance and cannot deny having recorded untrusted content', () => {
    expect(
      vault.vaultTaintSchema.safeParse({
        tainted: false,
        reasons: [{ source: 'web', label: 'page' }],
      }).success,
    ).toBe(false)
    expect(
      vault.vaultTaintSchema.safeParse({
        tainted: true,
        reasons: [{ source: 'web', label: 'page' }],
      }).success,
    ).toBe(true)
  })

  it('V11 V13: approvals and tickets require digest, nonce, requester, epoch and future expiry', () => {
    const approval = approvalFixture()
    expect(vault.vaultApprovalRequestSchema.safeParse(approval).success).toBe(true)
    expect(vault.vaultApprovalRequestSchema.safeParse({ ...approval, expiresAt: 0 }).success).toBe(
      false,
    )
    expect(
      vault.vaultApprovalRequestSchema.safeParse({ ...approval, expiresAt: 120_001 }).success,
    ).toBe(false)
    const answer = { requestId: approval.id, digest: approval.digest, decision: 'allowOnce' }
    expect(vault.vaultApprovalAnswerSchema.safeParse(answer).success).toBe(true)
    expect(
      vault.vaultApprovalAnswerSchema.safeParse({ requestId: approval.id, decision: 'allowOnce' })
        .success,
    ).toBe(false)
    expect(
      vault.vaultApprovalAnswerSchema.safeParse({ ...answer, decision: 'alwaysAllow' }).success,
    ).toBe(false)
    const ticket: vault.VaultTicket = {
      id: approval.id,
      requestId: approval.id,
      requesterId: requester().id,
      itemId: metadata().id,
      digest: approval.digest,
      nonce: approval.nonce,
      issuedAt: 0,
      expiresAt: 1000,
      lockEpoch: 0,
      maxUses: 1,
    }
    expect(vault.vaultTicketSchema.safeParse(ticket).success).toBe(true)
    expect(vault.vaultTicketSchema.safeParse({ ...ticket, maxUses: 2 }).success).toBe(false)
    expect(vault.vaultTicketSchema.safeParse({ ...ticket, expiresAt: 0 }).success).toBe(false)
    expect(vault.vaultTicketSchema.safeParse({ ...ticket, expiresAt: 120_001 }).success).toBe(false)
  })

  it('V4 V5 V13: public protocol is versioned and proposals cannot claim identity or approval', () => {
    const request: protocol.VaultBrokerRequest = { v: 1, sequence: 0, request: { kind: 'status' } }
    expect(
      protocol.vaultBrokerRequestSchema.safeParse({
        v: 2,
        sequence: 0,
        request: { kind: 'status' },
      }).success,
    ).toBe(false)
    expect(protocol.vaultBrokerRequestSchema.parse(request).request.kind).toBe('status')
    expect(
      protocol.vaultUseProposalSchema.safeParse({
        handle: metadata().handle,
        use: use(),
        taint: { tainted: false, reasons: [] },
        requester: requester(),
      }).success,
    ).toBe(false)
    expect(
      protocol.vaultBrokerRequestSchema.safeParse({
        v: 1,
        sequence: 0,
        request: { kind: 'firstPartyRead', itemId: metadata().id },
      }).success,
    ).toBe(false)
    expect(
      protocol.vaultBrokerLockSchema.safeParse({
        v: 1,
        processId: 0,
        startedAt: 0,
        brokerId: 'a'.repeat(32),
        userSession: 'test',
        socket: '/test',
      }).success,
    ).toBe(false)
    expect(
      protocol.vaultBrokerLockSchema.safeParse({
        v: 1,
        processId: 1,
        startedAt: 0,
        brokerId: 'a'.repeat(32),
        userSession: 'test',
        socket: '/test',
      }).success,
    ).toBe(true)
  })

  it('V1 V9: public lists never admit hidden or first-party records or secret fields', () => {
    const response: protocol.VaultBrokerResponse = {
      v: 1,
      sequence: 0,
      response: { kind: 'items', items: [metadata()] },
    }
    expect(protocol.vaultBrokerResponseSchema.safeParse(response).success).toBe(true)
    for (const extra of [
      { hidden: true },
      { firstParty: true, hidden: true, policy: { ...metadata().policy, mode: 'never' } },
      { value: randomBytes(32).toString('hex') },
    ])
      expect(
        protocol.vaultBrokerResponseSchema.safeParse({
          ...response,
          response: { kind: 'items', items: [{ ...metadata(), ...extra }] },
        }).success,
      ).toBe(false)
    expect(
      protocol.vaultBrokerEventSchema.safeParse({
        kind: 'locked',
        v: 1,
        lockEpoch: 1,
        value: 'not permitted',
      }).success,
    ).toBe(false)
    expect(protocol.vaultBrokerEventSchema.parse({ kind: 'locked', v: 1, lockEpoch: 1 }).kind).toBe(
      'locked',
    )
  })

  it('RVM109L0 P2 broker: the port delivers auditable automatic tickets alongside approval and denial', async () => {
    const broker: protocol.VaultBrokerPort = new FakeVaultBroker(
      new InMemoryVault(),
      new FakeVaultClock(),
    )
    const scriptedRequest = vi.spyOn(broker, 'request')
    const results: protocol.VaultAuthorizationResult[] = [
      { kind: 'approval', request: approvalFixture() },
      { kind: 'ticket', ticket: ticketFixture(), authority: { kind: 'mode' } },
      {
        kind: 'ticket',
        ticket: ticketFixture(),
        authority: { kind: 'grant', grantId: grant().id },
      },
      { kind: 'denied', reason: 'policy' },
    ]
    for (const result of results) {
      scriptedRequest.mockResolvedValueOnce(result)
      const received = await broker.request(requester(), metadata().handle, use(), {
        tainted: false,
        reasons: [],
      })
      expect(
        protocol.vaultBrokerResponseSchema.parse({ v: 1, sequence: 0, response: received })
          .response,
      ).toEqual(result)
      if (received.kind !== 'ticket') continue
      expect(received.ticket).toEqual(ticketFixture())
      expect(received.authority).toEqual(result.kind === 'ticket' && result.authority)
    }
    for (const authority of [
      undefined,
      { kind: 'grant' },
      { kind: 'mode', grantId: grant().id },
      { kind: 'user', grantId: grant().id },
      { kind: 'model' },
    ])
      expect(
        protocol.vaultBrokerResponseSchema.safeParse({
          v: 1,
          sequence: 0,
          response: { kind: 'ticket', ticket: ticketFixture(), authority },
        }).success,
      ).toBe(false)
    const scriptedAnswer = vi.spyOn(broker, 'answer')
    const answered: protocol.VaultApprovalResult = {
      kind: 'ticket',
      ticket: ticketFixture(),
      authority: { kind: 'user' },
    }
    scriptedAnswer.mockResolvedValueOnce(answered)
    expect(
      await broker.answer(
        { hostId: requester().hostId, processId: 100, userId: 'test-user', ui: true },
        {
          requestId: answered.ticket.requestId,
          digest: answered.ticket.digest,
          decision: 'allowOnce',
        },
      ),
    ).toEqual(answered)
  })

  it('RVM109L0 P2 broker: the committed authorization JSON Schema matches the port and wire boundary', () => {
    const committed: unknown = JSON.parse(
      readFileSync(
        new URL('../../../docs/schemas/vault-authorization-result-v1.schema.json', import.meta.url),
        'utf8',
      ),
    )
    expect(committed).toEqual(z.toJSONSchema(protocol.vaultAuthorizationResultSchema))
  })

  it('P2-4 the source schema generator checks every committed vault schema for drift', () => {
    const result = spawnSync(process.execPath, ['scripts/vault-schema.mjs', '--check'], {
      cwd: new URL('../../../', import.meta.url),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
  })

  it('V10: device protocol permits only bound signatures and codes', () => {
    const base = { v: 1, id: 'a'.repeat(32), owningDeviceId: 'b'.repeat(32) }
    expect(
      protocol.vaultRemoteRequestSchema.safeParse({
        ...base,
        use: { kind: 'totp', origin: 'https://example.test' },
      }).success,
    ).toBe(true)
    for (const kind of ['environment', 'disclosure', 'password', 'item', 'grant'])
      expect(protocol.vaultRemoteRequestSchema.safeParse({ ...base, use: { kind } }).success).toBe(
        false,
      )
    expect(
      protocol.vaultRemoteRequestSchema.safeParse({
        ...base,
        use: { kind: 'totp', origin: 'https://example.test' },
        item: metadata(),
      }).success,
    ).toBe(false)
  })

  it('private read material stays on its dedicated channel with a known client and bounded encoding', () => {
    expect(
      protocol.vaultPrivateReadSchema.safeParse({
        v: 1,
        kind: 'firstPartyRead',
        itemId: metadata().id,
        origin: 'https://example.test',
        client: 'model',
      }).success,
    ).toBe(true)
    expect(
      protocol.vaultPrivateReadSchema.safeParse({
        v: 1,
        kind: 'firstPartyRead',
        itemId: metadata().id,
        origin: 'https://example.test',
        client: 'agent',
      }).success,
    ).toBe(false)
    expect(
      protocol.vaultPrivateMaterialSchema.safeParse({
        v: 1,
        kind: 'material',
        requestId: 'a'.repeat(32),
        encoding: 'base64',
        bytes: randomBytes(32).toString('base64'),
      }).success,
    ).toBe(true)
    expect(
      protocol.vaultPrivateMaterialSchema.safeParse({
        v: 1,
        kind: 'material',
        requestId: 'a'.repeat(32),
        encoding: 'base64',
        bytes: 'invalid!',
      }).success,
    ).toBe(false)
  })

  it('V6 V16: all slot tiers are represented and basic_text is refused', async () => {
    for (const tier of [
      'hardware',
      'presence',
      'osStore',
      'secretStorage',
      'passphrase',
      'recovery',
    ]) {
      const parsedTier = vault.vaultSlotRecordSchema.shape.tier.parse(tier)
      const slot = await new FakeVaultSlot(parsedTier).wrap(randomBytes(32))
      expect(vault.vaultSlotRecordSchema.safeParse(slot).success).toBe(true)
      expect(vault.vaultSlotRecordSchema.safeParse({ ...slot, lastGeneration: -1 }).success).toBe(
        false,
      )
      expect(
        vault.vaultSlotRecordSchema.safeParse({ ...slot, provider: 'recovery', tier: 'hardware' })
          .success,
      ).toBe(false)
      expect(
        vault.vaultSlotRecordSchema.safeParse({ ...slot, backend: 'basic_text' }).success,
      ).toBe(false)
      if (tier === 'passphrase')
        expect(vault.vaultSlotRecordSchema.safeParse({ ...slot, kdf: null }).success).toBe(false)
    }
  })

  it('keeps the planned defaults and performance budgets explicit', () => {
    expect(constants.VAULT_DEFAULTS).toEqual({
      enabled: true,
      protection: 'auto',
      agentFence: true,
      lockOnScreenLock: true,
    })
    expect([
      constants.VAULT_APPROVAL_TTL_MS,
      constants.VAULT_ASKPASS_USES,
      constants.VAULT_ASKPASS_TTL_MS,
      constants.VAULT_SESSION_MAX_DAYS,
      constants.VAULT_AUDIT_MAX_BYTES,
      constants.VAULT_LEGACY_RETAIN_RELEASES,
      constants.VAULT_FIRST_SEND_SLACK_MS,
      constants.VAULT_SIGN_P95_MS,
      constants.VAULT_FEEDER_START_MS,
      constants.VAULT_SCRUB_MIN_MBPS,
      constants.VAULT_IDLE_MINUTES,
    ]).toEqual([120_000, 3, 600_000, 30, 8 * 1024 * 1024, 2, 25, 20, 200, 50, 240])
    expect([
      constants.VAULT_KEY_BYTES,
      constants.VAULT_NONCE_BYTES,
      constants.VAULT_TAG_BYTES,
      constants.VAULT_RECOVERY_BYTES,
    ]).toEqual([32, 12, 16, 20])
  })
})
