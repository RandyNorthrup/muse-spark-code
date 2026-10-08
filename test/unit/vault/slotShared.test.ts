import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { VAULT_FORMAT_VERSION, VAULT_KEY_BYTES } from '../../../src/shared/constants'
import { vaultSlotRecordSchema } from '../../../src/shared/vault'
import {
  collectSlotChunk,
  drainSlotStderr,
  SLOT_STDOUT_LIMIT,
  type SlotChildProcess,
  watchSlotChildErrors,
} from '../../../src/runtime/vault/slots/slotChild'
import { slotIdentitySchema } from '../../../src/runtime/vault/slots/slotIdentity'
import { wrapSlotKey } from '../../../src/runtime/vault/slots/slotWrap'

class FakeChild extends EventEmitter implements SlotChildProcess {
  stdin = new EventEmitter()
  stderr = new EventEmitter()
}

function fakeChild(): FakeChild {
  return new FakeChild()
}

describe('slotChild', () => {
  it('fails the exchange on abort, child error and stdin error', () => {
    const child = fakeChild()
    const abort = vi.fn()
    const signal = AbortSignal.timeout(1000)
    watchSlotChildErrors(child, signal, abort)
    child.emit('error', new Error('boom'))
    child.stdin.emit('error', new Error('boom'))
    expect(abort).toHaveBeenCalledTimes(2)
  })

  it('collects chunks and fails closed past the limit, erasing the overflow', () => {
    const chunks: Buffer[] = []
    const fail = vi.fn()
    const kept = collectSlotChunk(chunks, 0, Buffer.from('abc'), fail)
    expect(kept).toBe(3)
    expect(chunks).toHaveLength(1)
    expect(fail).not.toHaveBeenCalled()
    const room = SLOT_STDOUT_LIMIT - kept
    const overflow = Buffer.alloc(room + 1, 7)
    expect(collectSlotChunk(chunks, kept, overflow, fail)).toBe(kept)
    expect(fail).toHaveBeenCalledOnce()
    expect(overflow.every((byte) => byte === 0)).toBe(true)
    expect(chunks).toHaveLength(1)
  })

  it('erases stderr without relaying it', () => {
    const child = fakeChild()
    drainSlotStderr(child)
    const chunk = Buffer.from(String.raw`C:\Users\someone\secret`)
    child.stderr.emit('data', chunk)
    expect(chunk.every((byte) => byte === 0)).toBe(true)
  })
})

describe('slotIdentity', () => {
  it('binds the slot, vault and tier shared by every platform', () => {
    expect(
      slotIdentitySchema.safeParse({
        slotId: 'a'.repeat(32),
        vaultId: 'b'.repeat(32),
        tier: 'hardware',
      }).success,
    ).toBe(true)
    expect(
      slotIdentitySchema.safeParse({ slotId: 'short', vaultId: 'b'.repeat(32), tier: 'hardware' })
        .success,
    ).toBe(false)
  })
})

/** A parsed record the wrap tests rewrap: only `wrappedKey` varies per case. */
function recordBase() {
  return vaultSlotRecordSchema.parse({
    v: VAULT_FORMAT_VERSION,
    id: 'a'.repeat(32),
    vaultId: 'b'.repeat(32),
    lastGeneration: 1,
    auditGeneration: 1,
    auditHead: 'c'.repeat(64),
    createdAt: 1,
    tier: 'hardware',
    provider: 'secureEnclave',
    keyReference: 'a'.repeat(32),
    wrappedKey: Buffer.from('sealed').toString('base64'),
    nonce: null,
    tag: null,
    kdf: null,
    backend: null,
  })
}

describe('wrapSlotKey', () => {
  it('owns the key, records an accepted container and erases the copy', async () => {
    const key = new Uint8Array(VAULT_KEY_BYTES).fill(9)
    const seen: Buffer[] = []
    const base = recordBase()
    const record = await wrapSlotKey({
      key,
      checkCapability: () => Promise.resolve(),
      invoke: (owned) => {
        seen.push(owned)
        expect(owned.length).toBe(VAULT_KEY_BYTES)
        return Promise.resolve({ container: { tag: 'sealed' } })
      },
      accept: () => true,
      record: (wrappedKey) => ({ ...base, wrappedKey }),
    })
    expect(record.wrappedKey).toBe(
      Buffer.from(JSON.stringify({ tag: 'sealed' })).toString('base64'),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]?.every((byte) => byte === 0)).toBe(true)
  })

  it('refuses a short key and a rejected container without invoking', async () => {
    const base = recordBase()
    const invoke = vi.fn(() => Promise.resolve({ container: { tag: 'x' } }))
    await expect(
      wrapSlotKey({
        key: new Uint8Array(1),
        checkCapability: () => Promise.resolve(),
        invoke,
        accept: () => true,
        record: (wrappedKey) => ({ ...base, wrappedKey }),
      }),
    ).rejects.toThrow()
    await expect(
      wrapSlotKey({
        key: new Uint8Array(VAULT_KEY_BYTES),
        checkCapability: () => Promise.resolve(),
        invoke,
        accept: () => false,
        record: (wrappedKey) => ({ ...base, wrappedKey }),
      }),
    ).rejects.toThrow()
    expect(invoke).toHaveBeenCalledOnce()
  })
})
