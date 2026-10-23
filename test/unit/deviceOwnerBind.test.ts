// M100 lane K: pairs bound to their owners; per-message authorization by
// role under least-privilege time-bounded revocable grants; per-owner
// quotas; every decision audited; pair keys wrapped for OS-store rest.
import { describe, expect, it } from 'vitest'
import {
  DeviceOwnerAudit,
  DeviceOwnerBindings,
  DeviceOwnerGrants,
  protectPairKey,
  unprotectPairKey,
  type DeviceOwnerAuditRecord,
  type DeviceOwnerAuthMessage,
} from '../../src/core/devices/ownerBind'
import { DevicePairingError, type DevicePair } from '../../src/core/devices/pairing'
import { PassphraseVaultSlot } from '../../src/core/vault/keyslots'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { deviceGrantSchema, type DeviceGrant } from '../../src/shared/devices'
import { deviceCaps } from './helpers/deviceFixtures'
import { completeDevicePair } from './helpers/devicePairs'

const NOW = Date.UTC(2026, 9, 23)
const OWNER_A = 'aa'.repeat(16)
const OWNER_B = 'bb'.repeat(16)
const ROLE = 'cc'.repeat(16)
const REPOSITORY = 'dd'.repeat(16)

function hexId(byte: number): string {
  return byte.toString(16).padStart(2, '0').repeat(16)
}

function completePair(localDevice: string, peerDevice: string) {
  const completed = completeDevicePair(localDevice, peerDevice, NOW)
  return { pair: completed.pair, pem: completed.localPem }
}

function grantFor(pairId: string, ownerId: string, grantId: string): DeviceGrant {
  return deviceGrantSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    grantId,
    grantRevision: 1,
    pairId,
    ownerId,
    roleId: ROLE,
    mode: 'manual',
    repositoryId: REPOSITORY,
    lanes: true,
    checks: false,
    quota: deviceCaps,
    issuedAt: NOW,
    expiresAt: NOW + DEVICE_LIMITS.grantValidityMs,
    requiresStepUp: false,
  })
}

function messageFor(
  grant: DeviceGrant,
  mode?: DeviceOwnerAuthMessage['mode'],
): DeviceOwnerAuthMessage {
  return {
    pairId: grant.pairId,
    ownerId: grant.ownerId,
    roleId: grant.roleId,
    grantId: grant.grantId,
    grantRevision: grant.grantRevision,
    ...(mode !== undefined && { mode }),
  }
}

function collectedAudit(records: DeviceOwnerAuditRecord[]): DeviceOwnerAudit {
  return new DeviceOwnerAudit({
    append: (record) => {
      records.push(record)
      return Promise.resolve()
    },
  })
}

describe('M100 lane K owner bindings', () => {
  it('binds a completed pair to its owner; the same binding twice is one', () => {
    const bindings = new DeviceOwnerBindings()
    const { pair } = completePair(hexId(1), hexId(2))
    const first = bindings.bind(pair, OWNER_A, NOW)
    expect(bindings.bind(pair, OWNER_A, NOW)).toBe(first)
    expect(bindings.assertOwner(first.pairId, OWNER_A)).toEqual(first)
    // A second orchestrator needs its own binding on the same pair.
    const second = bindings.bind(pair, OWNER_B, NOW)
    expect(second.ownerId).toBe(OWNER_B)
    expect(second.pairId).toBe(first.pairId)
    // One device may serve and request over the same pair: both sides bind.
    const back = bindings.bind(
      {
        local: pair.peer,
        peer: pair.local,
        localConfirmation: pair.peerConfirmation,
        peerConfirmation: pair.localConfirmation,
      },
      OWNER_A,
      NOW,
    )
    expect(back.pairId).toBe(first.pairId)
    expect(back.localDeviceId).toBe(hexId(2))
    expect(bindings.assertOwner(first.pairId, OWNER_A, hexId(1))).toEqual(first)
    expect(bindings.assertOwner(first.pairId, OWNER_A, hexId(2))).toEqual(back)
    expect(() => bindings.assertOwner(first.pairId, OWNER_A, 'ff'.repeat(16))).toThrow(
      expect.objectContaining({ reason: 'grant' }),
    )
  })

  it('refuses a valid pair key for the wrong owner', () => {
    const bindings = new DeviceOwnerBindings()
    const { pair } = completePair(hexId(3), hexId(4))
    const binding = bindings.bind(pair, OWNER_A, NOW)
    // The TLS key is valid — the pair completed — but owner B has no binding.
    expect(() => bindings.assertOwner(binding.pairId, OWNER_B)).toThrow(
      expect.objectContaining({ reason: 'grant' }),
    )
    expect(() => bindings.assertOwner('ff'.repeat(16), OWNER_A)).toThrow(
      expect.objectContaining({ reason: 'unpaired' }),
    )
    expect(() => bindings.assertOwner(binding.pairId, OWNER_A, hexId(3), '00'.repeat(32))).toThrow(
      expect.objectContaining({ reason: 'grant' }),
    )
    expect(bindings.assertOwner(binding.pairId, OWNER_A, hexId(3), pair.peer.fingerprint)).toEqual(
      binding,
    )
  })

  it('keeps the old binding when the same devices re-pair, and refuses a broken pair', () => {
    const bindings = new DeviceOwnerBindings()
    const first = completePair(hexId(5), hexId(6))
    const binding = bindings.bind(first.pair, OWNER_A, NOW)
    const rotated = completePair(hexId(5), hexId(6))
    // Same devices, fresh keys: a new pair, and the old binding is intact.
    const fresh = bindings.bind(rotated.pair, OWNER_A, NOW)
    expect(fresh.pairId).not.toBe(binding.pairId)
    expect(bindings.assertOwner(binding.pairId, OWNER_A)).toEqual(binding)
    const broken: DevicePair = {
      ...first.pair,
      peerConfirmation: {
        ...first.pair.peerConfirmation,
        signatureBase64: Buffer.alloc(64).toString('base64'),
      },
    }
    expect(() => bindings.bind(broken, OWNER_B, NOW)).toThrow(DevicePairingError)
  })
})

describe('M100 lane K per-message authorization', () => {
  it('allows a current grant and audits the decision', async () => {
    const records: DeviceOwnerAuditRecord[] = []
    const audit = collectedAudit(records)
    const bindings = new DeviceOwnerBindings()
    const grants = new DeviceOwnerGrants(bindings, audit)
    const { pair } = completePair(hexId(7), hexId(8))
    const binding = bindings.bind(pair, OWNER_A, NOW)
    const grant = await grants.issue(grantFor(binding.pairId, OWNER_A, hexId(9)))
    const decided = await grants.authorize(messageFor(grant), NOW + 1000)
    expect(decided).toEqual(grant)
    expect(records.map((record) => [record.action, record.decision])).toEqual([
      ['issue', 'allow'],
      ['authorize', 'allow'],
    ])
  })

  it('denies an unknown pair, an unbound owner and a grant carried across pairs', async () => {
    const records: DeviceOwnerAuditRecord[] = []
    const audit = collectedAudit(records)
    const bindings = new DeviceOwnerBindings()
    const grants = new DeviceOwnerGrants(bindings, audit)
    const one = completePair(hexId(11), hexId(12))
    const two = completePair(hexId(13), hexId(14))
    const first = bindings.bind(one.pair, OWNER_A, NOW)
    const second = bindings.bind(two.pair, OWNER_A, NOW)
    const grant = await grants.issue(grantFor(first.pairId, OWNER_A, hexId(15)))
    const unknown = await grants.authorize({ ...messageFor(grant), pairId: 'ff'.repeat(16) }, NOW)
    expect(unknown).toMatchObject({ reason: 'unknown-owner' })
    const unbound = await grants.authorize({ ...messageFor(grant), ownerId: OWNER_B }, NOW)
    expect(unbound).toMatchObject({ reason: 'owner-mismatch' })
    const crossed = await grants.authorize({ ...messageFor(grant), pairId: second.pairId }, NOW)
    expect(crossed).toMatchObject({ reason: 'owner-mismatch' })
    const wrongRole = await grants.authorize({ ...messageFor(grant), roleId: 'ee'.repeat(16) }, NOW)
    expect(wrongRole).toMatchObject({ reason: 'owner-mismatch' })
    expect(records.filter((record) => record.decision === 'deny')).toHaveLength(4)
  })

  it('denies a grant replayed past its bound, revoked, or never issued', async () => {
    const records: DeviceOwnerAuditRecord[] = []
    const audit = collectedAudit(records)
    const bindings = new DeviceOwnerBindings()
    const grants = new DeviceOwnerGrants(bindings, audit)
    const { pair } = completePair(hexId(16), hexId(17))
    const binding = bindings.bind(pair, OWNER_A, NOW)
    const grant = await grants.issue(grantFor(binding.pairId, OWNER_A, hexId(18)))
    expect(await grants.authorize(messageFor(grant), NOW)).toEqual(grant)
    const expired = await grants.authorize(messageFor(grant), grant.expiresAt)
    expect(expired).toMatchObject({ reason: 'grant-expired' })
    const early = await grants.authorize(messageFor(grant), grant.issuedAt - 1)
    expect(early).toMatchObject({ reason: 'grant-expired' })
    const renewed = await grants.issue({ ...grant, grantRevision: 2 })
    expect(renewed.grantRevision).toBe(2)
    const replayed = await grants.authorize(messageFor(grant), NOW)
    expect(replayed).toMatchObject({ reason: 'grant-expired' })
    await expect(grants.issue({ ...grant, grantRevision: 1 })).rejects.toThrow(
      expect.objectContaining({ reason: 'grant' }),
    )
    await grants.revoke(OWNER_A, grant.grantId, binding.pairId)
    const refused = await grants.authorize({ ...messageFor(grant), grantRevision: 2 }, NOW)
    expect(refused).toMatchObject({ reason: 'grant-revoked' })
    const neverIssued = await grants.authorize({ ...messageFor(grant), grantId: hexId(19) }, NOW)
    expect(neverIssued).toMatchObject({ reason: 'grant-revoked' })
  })

  it('denies a wider mode and a quota past the per-owner ledger', async () => {
    const records: DeviceOwnerAuditRecord[] = []
    const audit = collectedAudit(records)
    const bindings = new DeviceOwnerBindings()
    const grants = new DeviceOwnerGrants(bindings, audit)
    const { pair } = completePair(hexId(21), hexId(22))
    const binding = bindings.bind(pair, OWNER_A, NOW)
    bindings.bind(pair, OWNER_B, NOW)
    const grantA = await grants.issue(grantFor(binding.pairId, OWNER_A, hexId(23)))
    const grantB = await grants.issue(grantFor(binding.pairId, OWNER_B, hexId(24)))
    const wider = await grants.authorize(messageFor(grantA, 'auto'), NOW)
    expect(wider).toMatchObject({ reason: 'scope-denied' })
    const narrower = await grants.authorize(messageFor(grantA, 'plan'), NOW)
    expect(narrower).toEqual(grantA)
    await grants.spend(OWNER_A, binding.pairId, { ...deviceCaps, workers: deviceCaps.workers })
    const over = await grants.authorize(
      { ...messageFor(grantA), quota: { ...deviceCaps, workers: 1 } },
      NOW,
    )
    expect(over).toMatchObject({ reason: 'quota-exceeded' })
    // Owner B's ledger is untouched by owner A's spend.
    expect(grants.usedBy(OWNER_B)).toEqual({
      workers: 0,
      processes: 0,
      heavyChecks: 0,
      tokens: 0,
      spendUsd: 0,
      artifactBytes: 0,
    })
    const allowed = await grants.authorize({ ...messageFor(grantB), quota: { ...deviceCaps } }, NOW)
    expect(allowed).toEqual(grantB)
    await expect(
      grants.spend(OWNER_A, binding.pairId, { ...deviceCaps, workers: -1 }),
    ).rejects.toThrow(expect.objectContaining({ reason: 'grant' }))
  })

  it('refuses malformed input typed and fails closed when the audit fails', async () => {
    const records: DeviceOwnerAuditRecord[] = []
    const audit = collectedAudit(records)
    const bindings = new DeviceOwnerBindings()
    const grants = new DeviceOwnerGrants(bindings, audit)
    const { pair } = completePair(hexId(25), hexId(26))
    const binding = bindings.bind(pair, OWNER_A, NOW)
    const grant = await grants.issue(grantFor(binding.pairId, OWNER_A, hexId(27)))
    const base = messageFor(grant)
    for (const malformed of [
      { ...base, pairId: 'nope' },
      { ...base, grantRevision: 0 },
      { ...base, mode: 'owner' },
      { ...base, quota: { ...deviceCaps, workers: NaN } },
    ]) {
      await expect(
        grants.authorize(malformed as unknown as DeviceOwnerAuthMessage, NOW),
      ).rejects.toThrow(expect.objectContaining({ reason: 'invalid-frame' }))
    }
    const broken = new DeviceOwnerGrants(
      bindings,
      new DeviceOwnerAudit({
        append: () => Promise.reject(new Error('audit unavailable')),
      }),
    )
    await expect(broken.authorize(base, NOW)).rejects.toThrow(
      expect.objectContaining({ reason: 'storage' }),
    )
  })
})

const LANE_K_TEST_PHRASE = 'lane-k-test-phrase'

function passphraseSlot(vaultId: string): PassphraseVaultSlot {
  return new PassphraseVaultSlot(vaultId, { now: () => NOW }, () =>
    Promise.resolve(Buffer.from(LANE_K_TEST_PHRASE, 'utf8')),
  )
}

describe('M100 lane K pair-key protection', () => {
  it('round-trips a real pair key with no PEM bytes at rest', async () => {
    const { pair, pem } = completePair(hexId(28), hexId(29))
    const bindings = new DeviceOwnerBindings()
    const binding = bindings.bind(pair, OWNER_A, NOW)
    const slot = passphraseSlot(binding.pairId)
    const envelope = await protectPairKey(slot, binding.pairId, pem)
    expect(JSON.stringify(envelope)).not.toContain('PRIVATE KEY')
    await expect(unprotectPairKey(slot, envelope)).resolves.toBe(pem)
  })

  it('refuses anything but a private key, a swapped pair and a cut block', async () => {
    const { pair, pem } = completePair(hexId(30), hexId(31))
    const bindings = new DeviceOwnerBindings()
    const binding = bindings.bind(pair, OWNER_A, NOW)
    const slot = passphraseSlot(binding.pairId)
    await expect(protectPairKey(slot, 'nope', pem)).rejects.toThrow(
      expect.objectContaining({ reason: 'invalid-frame' }),
    )
    await expect(protectPairKey(slot, binding.pairId, 'not a key')).rejects.toThrow(
      expect.objectContaining({ reason: 'storage' }),
    )
    const envelope = await protectPairKey(slot, binding.pairId, pem)
    const swapped = { ...envelope, pairId: 'ff'.repeat(16) }
    await expect(unprotectPairKey(slot, swapped)).rejects.toThrow()
    const cut = {
      ...envelope,
      block: {
        ...envelope.block,
        ciphertext: `${envelope.block.ciphertext.startsWith('A') ? 'B' : 'A'}${envelope.block.ciphertext.slice(1)}`,
      },
    }
    await expect(unprotectPairKey(slot, cut)).rejects.toThrow()
    const foreign = passphraseSlot('ff'.repeat(16))
    await expect(unprotectPairKey(foreign, envelope)).rejects.toThrow()
  })
})
