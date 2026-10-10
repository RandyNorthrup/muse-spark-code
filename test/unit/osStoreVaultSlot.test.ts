import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { OsStoreVaultSlot } from '../../src/runtime/vault/slots/osStoreVaultSlot'
import { PosixVaultSlots } from '../../src/runtime/vault/slots/posixVaultSlots'
import { VaultStoreUnavailableError } from '../../src/core/vault/broker/ports'
import { VaultSlotUnlock } from '../../src/core/vault/broker/repository'
import { VaultStore } from '../../src/core/vault/store'
import { slotContext } from './helpers/vault/fixtures'
import { AnchorWithId } from './vault/managementFixture'
import { MemoryVaultFiles } from './vault/storeFixtures'

function fixture(platform: NodeJS.Platform = 'linux') {
  let stored: Uint8Array | undefined
  const inputs: Uint8Array[] = [],
    outputs: Uint8Array[] = []
  const entry = {
    getSecret: vi.fn((): Promise<Uint8Array | number[] | null | undefined> => {
      const result = stored?.slice()
      if (result) outputs.push(result)
      return Promise.resolve(result)
    }),
    setSecret: vi.fn((key: Uint8Array) => {
      inputs.push(key)
      stored = new Uint8Array(key)
      return Promise.resolve()
    }),
    deleteCredential: vi.fn(() => {
      stored?.fill(0)
      stored = undefined
      return Promise.resolve(true)
    }),
  }
  const context = slotContext()
  const open = vi.fn(() => entry)
  const slot = new OsStoreVaultSlot(context, platform, open)
  return { slot, context, entry, open, inputs, outputs }
}

const noUnsubscribe = (): void => {
  /* The fake platform reports no screen lock. */
}

describe('OS-store vault slot', () => {
  it.each(['linux', 'darwin'] as const)(
    'round trips generated keys on %s without a key in the record',
    async (platform) => {
      const f = fixture(platform)
      const key = randomBytes(32)
      try {
        const record = await f.slot.wrap(key)
        expect(record.provider).toBe(platform === 'linux' ? 'secretService' : 'loginKeychain')
        expect(JSON.stringify(record)).not.toContain(key.toString('base64'))
        expect(f.inputs[0]).toEqual(Buffer.alloc(32))
        expect(f.outputs[0]).toEqual(new Uint8Array(32))
        const restored = await f.slot.unwrap({ ...record, lastGeneration: 2 }, '')
        expect(Buffer.from(restored)).toEqual(key)
        restored.fill(0)
        await expect(f.slot.wrap(key)).rejects.toMatchObject({ code: 'busy' })
        await f.slot.remove()
        await expect(f.slot.unwrap(record, '')).rejects.toMatchObject({ code: 'locked' })
        expect(f.entry.deleteCredential).toHaveBeenCalledOnce()
      } finally {
        key.fill(0)
      }
    },
  )
  it('serializes removal with a new wrap and wipes failed verification', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const gate = Promise.withResolvers<boolean>()
    f.entry.deleteCredential.mockReturnValueOnce(gate.promise)
    const removal = f.slot.remove()
    await expect(f.slot.wrap(key)).rejects.toMatchObject({ code: 'busy' })
    gate.resolve(true)
    await removal
    const damaged = randomBytes(32)
    f.entry.getSecret.mockResolvedValueOnce(null).mockResolvedValueOnce(damaged)
    await expect(f.slot.wrap(key)).rejects.toMatchObject({ code: 'io' })
    expect(damaged).toEqual(Buffer.alloc(32))
    expect(f.entry.deleteCredential).toHaveBeenCalledTimes(2)
    expect(f.entry.setSecret.mock.calls[0]?.[0]).toEqual(Buffer.alloc(32))
    key.fill(0)
  })
  it.each(['linux', 'darwin'] as const)(
    'implements provider selection on %s and denies unsupported presence',
    async (platform) => {
      const f = fixture(platform),
        key = randomBytes(32)
      const record = await f.slot.wrap(key)
      key.fill(0)
      const provider = new PosixVaultSlots(platform)
      expect(provider.slotFor(record)).toBeInstanceOf(OsStoreVaultSlot)
      expect(provider.slotFor({ ...record, tier: 'hardware' })).toBeNull()
      expect(
        provider.slotFor({
          ...record,
          provider: platform === 'linux' ? 'loginKeychain' : 'secretService',
        }),
      ).toBeNull()
      expect(provider.osStore(record.vaultId, record.id)).toBeInstanceOf(OsStoreVaultSlot)
      expect(await provider.presence()).toBe(false)
      expect(() => provider.onScreenLock()).toThrow()
      expect(() => new PosixVaultSlots('win32')).toThrow()
      await f.slot.remove()
    },
  )
  it('normalizes and erases native numeric arrays captured on Kubuntu', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const record = await f.slot.wrap(key)
    const native = [...key]
    f.entry.getSecret.mockResolvedValueOnce(native)
    const erasedArrays = vi.spyOn(Array.prototype, 'fill')
    try {
      const restored = await f.slot.unwrap(record, '')
      expect(restored).toEqual(key)
      const empty = Array.from({ length: 32 }, () => 0)
      expect(native).toEqual(empty)
      expect(erasedArrays.mock.contexts).toHaveLength(2)
      expect(erasedArrays.mock.contexts[0]).not.toBe(native)
      expect(erasedArrays.mock.contexts[0]).toEqual(empty)
      expect(erasedArrays.mock.contexts[1]).toBe(native)
      restored.fill(0)
    } finally {
      erasedArrays.mockRestore()
      key.fill(0)
    }
  })
  it('normalizes the native missing-entry null captured on Secret Service', async () => {
    const f = fixture(),
      key = randomBytes(32)
    f.entry.getSecret.mockResolvedValueOnce(null)
    const record = await f.slot.wrap(key)
    key.fill(0)
    f.entry.getSecret.mockResolvedValueOnce(null)
    await expect(f.slot.unwrap(record, '')).rejects.toMatchObject({ code: 'locked' })
  })
  it('refuses swapped immutable identity before reading the OS store', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const record = await f.slot.wrap(key)
    key.fill(0)
    f.open.mockClear()
    for (const changed of [
      { id: randomBytes(16).toString('hex') },
      { vaultId: randomBytes(16).toString('hex') },
      { provider: 'loginKeychain' as const },
      { keyReference: 'other' },
      { wrappedKey: Buffer.from('other').toString('base64') },
      { createdAt: record.createdAt + 1 },
      { nonce: randomBytes(12).toString('base64') },
    ])
      await expect(f.slot.unwrap({ ...record, ...changed }, '')).rejects.toMatchObject({
        code: 'invalid',
      })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('throws the typed store error with no native text on denied storage', async () => {
    const f = fixture(),
      key = randomBytes(32)
    f.entry.setSecret.mockImplementationOnce(() =>
      Promise.reject(new Error('native account path must stay private')),
    )
    // The exact fixed message proves no native text escapes with the error.
    await expect(f.slot.wrap(key)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof VaultStoreUnavailableError &&
        error.name === 'VaultStoreUnavailableError' &&
        error.message === 'storeUnavailable',
    )
    expect(f.entry.deleteCredential).toHaveBeenCalledOnce()
    expect(f.inputs).toEqual([])
    expect(f.entry.setSecret.mock.calls[0]?.[0]).toEqual(Buffer.alloc(32))
    key.fill(0)
  })
  it('throws the typed store error when the entry cannot be read', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const record = await f.slot.wrap(key)
    key.fill(0)
    f.entry.getSecret.mockRejectedValueOnce(new Error('native D-Bus path must stay private'))
    await expect(f.slot.unwrap(record, '')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof VaultStoreUnavailableError && error.message === 'storeUnavailable',
    )
    await f.slot.remove()
  })
  it('an unusable OS store survives slot unlock as the typed error', async () => {
    const files = new MemoryVaultFiles()
    const anchor = new AnchorWithId()
    const key = randomBytes(32)
    const context = slotContext()
    let secrets: Uint8Array | undefined
    const entry = {
      getSecret: (): Promise<Uint8Array | null> => Promise.resolve(secrets?.slice() ?? null),
      setSecret: (value: Uint8Array): Promise<void> => {
        secrets = Uint8Array.from(value)
        return Promise.resolve()
      },
      deleteCredential: (): Promise<boolean> => {
        secrets = undefined
        return Promise.resolve(true)
      },
    }
    const open = (): typeof entry => entry
    const slot = new OsStoreVaultSlot(context, 'linux', open)
    try {
      const record = await slot.wrap(key)
      const store = await VaultStore.create({ files, anchor, key }, context.vaultId, [record])
      store.lock()
      entry.getSecret = () => Promise.reject(new Error('native D-Bus path must stay private'))
      const unlock = new VaultSlotUnlock(files, anchor, {
        slotFor: (candidate) => (candidate.tier === 'osStore' ? slot : null),
        osStore: () => slot,
        presence: () => Promise.resolve(false),
        onScreenLock: () => noUnsubscribe,
      })
      await expect(unlock.unlock(null)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof VaultStoreUnavailableError && error.message === 'storeUnavailable',
      )
    } finally {
      key.fill(0)
      secrets?.fill(0)
    }
  })
  it('refuses malformed stored bytes and wipes them', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const record = await f.slot.wrap(key)
    key.fill(0)
    const invalid = randomBytes(1)
    f.entry.getSecret.mockResolvedValueOnce(invalid)
    await expect(f.slot.unwrap(record, '')).rejects.toMatchObject({ code: 'invalid' })
    expect(invalid).toEqual(Buffer.alloc(1))
  })
  it('does not touch storage with an invalid key or an unsupported platform', async () => {
    const f = fixture()
    await expect(f.slot.wrap(new Uint8Array(1))).rejects.toMatchObject({ code: 'invalid' })
    expect(f.open).not.toHaveBeenCalled()
    expect(() => new OsStoreVaultSlot(f.context, 'win32', f.open)).toThrow()
    expect(new VaultStoreUnavailableError()).toMatchObject({
      name: 'VaultStoreUnavailableError',
      message: 'storeUnavailable',
    })
  })
})
