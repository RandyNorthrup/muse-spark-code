// M110d lane X2: the pair's cryptography fails closed. Every case runs the
// real primitives (node:crypto) and breaks the exact thing a person would
// be hurt by: a forged signature, a meddled SAS, a replayed frame, a
// dropped revocation, a rotation that strands a device, a reused invite.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  fingerprintIdentity,
  generateIdentityKeyPair,
  signIdentityChallenge,
  isIdentityChallengeValid,
} from '../../src/core/devices/identity'
import { beginSas, finishSas } from '../../src/core/devices/sas'
import { createSequenceGuard } from '../../src/core/devices/sequence'
import {
  emptyRevocationList,
  isRevocationListExtension,
  isKeyRevoked,
  mergeRevocationLists,
  revokeKey,
  isRevocationListValid,
} from '../../src/core/devices/revocation'
import { isPinAccepted, beginRotation, completeRotation } from '../../src/core/devices/rotation'
import { createInvitation, redeemInvitation } from '../../src/core/devices/invitation'

describe('node identity keys', () => {
  it('signs a challenge its own public half verifies, and nothing else does', () => {
    const node = generateIdentityKeyPair()
    const stranger = generateIdentityKeyPair()
    const challenge = randomBytes(32)
    const signature = signIdentityChallenge(node.privateKey, challenge)
    expect(isIdentityChallengeValid(node.publicKey, challenge, signature)).toBe(true)
    expect(isIdentityChallengeValid(stranger.publicKey, challenge, signature)).toBe(false)
    expect(isIdentityChallengeValid(node.publicKey, randomBytes(32), signature)).toBe(false)
    expect(fingerprintIdentity(node.publicKey)).not.toBe(fingerprintIdentity(stranger.publicKey))
  })

  it('refuses a malformed key and a truncated signature', () => {
    const node = generateIdentityKeyPair()
    expect(() => fingerprintIdentity('not-a-key')).toThrow()
    expect(isIdentityChallengeValid(node.publicKey, randomBytes(32), 'AAAA')).toBe(false)
  })
})

describe('committed SAS', () => {
  it('both sides read the same digits, and a meddler cannot match them', () => {
    const pairSecret = randomBytes(32)
    const a = beginSas()
    const b = beginSas()
    const digitsA = finishSas(a, b.localCommitment, b.localNonce, pairSecret)
    const digitsB = finishSas(b, a.localCommitment, a.localNonce, pairSecret)
    expect(digitsA).toEqual(digitsB)
    expect(digitsA.join(' ')).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/)
    const meddled = finishSas(a, b.localCommitment, b.localNonce, randomBytes(32))
    expect(meddled).not.toEqual(digitsA)
  })

  it('refuses a nonce swapped after its commitment', () => {
    const a = beginSas()
    const b = beginSas()
    expect(() => finishSas(a, b.localCommitment, beginSas().localNonce, randomBytes(32))).toThrow(
      'SAS nonce does not match its commitment',
    )
    expect(() => finishSas(a, b.localCommitment, b.localNonce, new Uint8Array(0))).toThrow(
      'SAS stretches a pair secret',
    )
  })
})

describe('frame replay protection', () => {
  it('accepts each frame once and refuses replays and the aged-out past', () => {
    const guard = createSequenceGuard(4)
    expect([0, 1, 2].map((sequence) => guard.accept(sequence))).toEqual(['ok', 'ok', 'ok'])
    expect(guard.accept(1)).toBe('duplicate')
    expect(guard.accept(100)).toBe('ok')
    expect(guard.accept(2)).toBe('too-old')
    expect(guard.accept(99)).toBe('ok')
    expect(guard.accept(99)).toBe('duplicate')
  })
})

describe('subtract-only revocation', () => {
  const pairKey = randomBytes(32)

  it('revokes once and refuses a list with a dropped or forged entry', () => {
    const revoked = revokeKey(
      revokeKey(emptyRevocationList(pairKey), pairKey, 'lost-phone'),
      pairKey,
      'old-key',
    )
    expect(isKeyRevoked(revoked, pairKey, 'lost-phone')).toBe(true)
    expect(isKeyRevoked(revoked, pairKey, 'kept-key')).toBe(false)
    expect(revokeKey(revoked, pairKey, 'lost-phone').entries).toHaveLength(2)
    const dropped = { entries: revoked.entries.slice(1) }
    expect(isRevocationListValid(dropped, pairKey)).toBe(false)
    const forged = {
      entries: revoked.entries.map((entry, index) =>
        index === 0 ? { ...entry, keyId: 'forged' } : entry,
      ),
    }
    expect(isRevocationListValid(forged, pairKey)).toBe(false)
    expect(isRevocationListValid(revoked, randomBytes(32))).toBe(false)
    expect(() => isKeyRevoked(forged, pairKey, 'forged')).toThrow(
      'revocation list fails verification',
    )
  })

  it('takes an update only when it extends what the device accepted', () => {
    const one = revokeKey(emptyRevocationList(pairKey), pairKey, 'a')
    const two = revokeKey(one, pairKey, 'b')
    expect(isRevocationListExtension(one, two, pairKey)).toBe(true)
    expect(isRevocationListExtension(two, one, pairKey)).toBe(false)
    expect(isRevocationListExtension(one, one, pairKey)).toBe(true)
    const other = revokeKey(emptyRevocationList(pairKey), pairKey, 'b')
    expect(isRevocationListExtension(one, other, pairKey)).toBe(false)
  })

  it('merges two lists into their union and refuses a tampered side', () => {
    const first = revokeKey(emptyRevocationList(pairKey), pairKey, 'a')
    const second = revokeKey(emptyRevocationList(pairKey), pairKey, 'b')
    const merged = mergeRevocationLists(first, second, pairKey)
    expect(isKeyRevoked(merged, pairKey, 'a')).toBe(true)
    expect(isKeyRevoked(merged, pairKey, 'b')).toBe(true)
    const only = second.entries[0]
    if (only === undefined) throw new Error('the test revokes one key')
    const tampered = { entries: [{ ...only, keyId: 'c' }] }
    expect(() => mergeRevocationLists(first, tampered, pairKey)).toThrow(
      'revocation list fails verification',
    )
  })
})

describe('rotation overlap', () => {
  it('keeps both pins through the overlap and only the new one after', () => {
    const rotating = beginRotation('pin-old', 'pin-new')
    expect(isPinAccepted(rotating, 'pin-old')).toBe(true)
    expect(isPinAccepted(rotating, 'pin-new')).toBe(true)
    const completed = completeRotation(rotating)
    expect(isPinAccepted(completed, 'pin-old')).toBe(false)
    expect(isPinAccepted(completed, 'pin-new')).toBe(true)
    expect(() => completeRotation(completed)).toThrow('no rotation is open')
    expect(() => beginRotation('same', 'same')).toThrow('rotation needs a different pin')
  })
})

describe('pairing invitations', () => {
  it('redeems once, bound to the node, inside its window', () => {
    const invitation = createInvitation({ fingerprint: 'AA:BB', now: 1000, expiresAt: 2000 })
    const redeemed = redeemInvitation(invitation, {
      code: invitation.code,
      fingerprint: 'AA:BB',
      now: 1500,
    })
    expect(redeemed.redeemed).toBe(true)
    expect(() =>
      redeemInvitation(redeemed, { code: invitation.code, fingerprint: 'AA:BB', now: 1500 }),
    ).toThrow('this invitation was already used')
    expect(() =>
      redeemInvitation(invitation, { code: 'wrong', fingerprint: 'AA:BB', now: 1500 }),
    ).toThrow('this invitation code is wrong')
    expect(() =>
      redeemInvitation(invitation, { code: invitation.code, fingerprint: 'CC:DD', now: 1500 }),
    ).toThrow('this invitation names another node')
    expect(() =>
      redeemInvitation(invitation, { code: invitation.code, fingerprint: 'AA:BB', now: 2000 }),
    ).toThrow('this invitation has expired')
  })
})
