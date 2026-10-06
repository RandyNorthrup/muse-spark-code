import * as crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createRecoverySlot,
  PassphraseVaultSlot,
  unlockRecoverySlot,
} from '../../../src/core/vault/keyslots'
import { randomVaultBytes } from '../../../src/core/vault/crypto'
import { FakeVaultClock } from '../helpers/vault/core'

const vaultId = 'a'.repeat(32)

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof crypto>()
  return { ...original, randomFillSync: vi.fn(original.randomFillSync) }
})

describe('vault software slots', () => {
  it('erases its root-key copy when salt RNG throws before asking for a passphrase', async () => {
    const key = randomVaultBytes()
    const secret = vi.fn(() => Promise.resolve(randomVaultBytes()))
    const slot = new PassphraseVaultSlot(vaultId, new FakeVaultClock(), secret)
    const allocations: Buffer[] = []
    const allocate = Buffer.alloc
    const allocation = vi.spyOn(Buffer, 'alloc').mockImplementation((length) => {
      const bytes = allocate(length)
      allocations.push(bytes)
      return bytes
    })
    const rng = vi.spyOn(crypto, 'randomFillSync').mockImplementation((bytes) => {
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(100)
      throw new Error('generated RNG failure')
    })
    try {
      await expect(slot.wrap(key)).rejects.toThrow('generated RNG failure')
      const owned = allocations.filter((bytes) => bytes.length === key.length)
      expect(owned.length).toBe(1)
      expect(owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
      expect(secret).not.toHaveBeenCalled()
      const random = allocations.filter((bytes) => bytes.length === 16)
      expect(random.length).toBe(1)
      expect(random.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
      expect(key.some((byte) => byte !== 0)).toBe(true)
    } finally {
      rng.mockRestore()
      allocation.mockRestore()
      for (const bytes of allocations) bytes.fill(0)
      key.fill(0)
    }
  })
  it('any independent recovery code unwraps only its own vault key', () => {
    const key = randomVaultBytes()
    const first = createRecoverySlot(key, vaultId, new FakeVaultClock())
    const second = createRecoverySlot(key, vaultId, new FakeVaultClock())
    expect(first.code.length).toBe(40)
    expect(first.code.buffer.byteLength).toBe(40)
    expect(first.code).not.toEqual(second.code)
    expect(unlockRecoverySlot(first.slot, first.code)).toEqual(key)
    expect(unlockRecoverySlot(second.slot, second.code)).toEqual(key)
    expect(() => unlockRecoverySlot(first.slot, second.code)).toThrow()
    expect(key.some((byte) => byte !== 0)).toBe(true)
  })
  it('authenticates every stable slot field and enforces exact encrypted-key lengths', () => {
    const recovery = createRecoverySlot(randomVaultBytes(), vaultId, new FakeVaultClock())
    for (const mutation of [
      { id: 'b'.repeat(32) },
      { vaultId: 'b'.repeat(32) },
      { createdAt: 2 },
      { wrappedKey: randomVaultBytes().toString('base64') },
      { nonce: randomVaultBytes(11).toString('base64') },
      { tag: randomVaultBytes(15).toString('base64') },
    ])
      expect(() => unlockRecoverySlot({ ...recovery.slot, ...mutation }, recovery.code)).toThrow()
    expect(() => unlockRecoverySlot(recovery.slot, Buffer.alloc(40, 0))).toThrow()
    expect(() => unlockRecoverySlot(recovery.slot, recovery.code.subarray(0, 39))).toThrow()
    const advanced = {
      ...recovery.slot,
      lastGeneration: 2,
      auditGeneration: 1,
      auditHead: 'f'.repeat(64),
    }
    expect(unlockRecoverySlot(advanced, recovery.code).length).toBe(32)
  })
  it('wraps and unwraps a passphrase slot, erases transferred input and obtains fresh presence on every use', async () => {
    const password = randomVaultBytes()
    const transferred: Uint8Array[] = []
    const uses: string[] = []
    const secret = (use: string) => {
      uses.push(use)
      const copy = Buffer.from(password)
      transferred.push(copy)
      return Promise.resolve(copy)
    }
    const slot = new PassphraseVaultSlot(vaultId, new FakeVaultClock(), secret, 'presence')
    const key = randomVaultBytes()
    const record = await slot.wrap(key)
    expect(await slot.unwrap(record, 'first generated use')).toEqual(key)
    expect(await slot.unwrap(record, 'second generated use')).toEqual(key)
    expect(uses).toEqual(['', 'first generated use', 'second generated use'])
    expect(transferred.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
    const wrong = new PassphraseVaultSlot(
      vaultId,
      new FakeVaultClock(),
      () => Promise.resolve(randomVaultBytes()),
      'presence',
    )
    await expect(wrong.unwrap(record, 'wrong password')).rejects.toThrow()
    await expect(slot.unwrap({ ...record, tier: 'passphrase' }, 'changed tier')).rejects.toThrow()
  })
  it('creates and unlocks the scrypt fallback without weakening its recorded parameters', async () => {
    const password = randomVaultBytes()
    const slot = new PassphraseVaultSlot(
      vaultId,
      new FakeVaultClock(),
      () => Promise.resolve(Buffer.from(password)),
      'passphrase',
      null,
    )
    const key = randomVaultBytes()
    const record = await slot.wrap(key)
    expect(record.kdf?.kind).toBe('scrypt')
    expect(await slot.unwrap(record, 'generated unlock')).toEqual(key)
    const foreign = new PassphraseVaultSlot('b'.repeat(32), new FakeVaultClock(), () =>
      Promise.resolve(Buffer.from(password)),
    )
    await expect(foreign.unwrap(record, 'foreign vault')).rejects.toThrow()
    await expect(slot.wrap(Buffer.alloc(31))).rejects.toThrow()
  })
})
