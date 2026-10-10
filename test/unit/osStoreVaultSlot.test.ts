import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  OsStoreVaultSlot,
  VaultOsStoreUnavailableError,
} from '../../src/runtime/vault/slots/osStoreVaultSlot'
import { slotContext } from './helpers/vault/fixtures'
import { UI_TEXT } from '../../src/shared/constants'

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
    expect(f.entry.setSecret.mock.calls[0]?.[0]).toEqual(Buffer.alloc(32))
    key.fill(0)
  })
  it('normalizes and erases native numeric arrays captured on Kubuntu', async () => {
    const f = fixture(),
      key = randomBytes(32)
    const record = await f.slot.wrap(key)
    const native = [...key]
    f.entry.getSecret.mockResolvedValueOnce(native)
    const restored = await f.slot.unwrap(record, '')
    expect(restored).toEqual(key)
    expect(native).toEqual(Array.from({ length: 32 }, () => 0))
    restored.fill(0)
    key.fill(0)
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
  it('erases owned input and replaces native diagnostics on denied storage', async () => {
    const f = fixture(),
      key = randomBytes(32)
    f.entry.setSecret.mockImplementationOnce(() => Promise.reject(new Error(key.toString('hex'))))
    await expect(f.slot.wrap(key)).rejects.toThrow(UI_TEXT.vault.secretServiceUnavailable)
    expect(f.inputs).toEqual([])
    expect(f.entry.setSecret.mock.calls[0]?.[0]).toEqual(Buffer.alloc(32))
    key.fill(0)
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
    expect(new VaultOsStoreUnavailableError('darwin').message).toBe(
      UI_TEXT.vault.keychainUnavailable,
    )
  })
})
