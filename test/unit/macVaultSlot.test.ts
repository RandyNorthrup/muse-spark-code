import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VAULT_KEY_BYTES, VAULT_LIMITS } from '../../src/shared/constants'
import { vaultSlotRecordSchema, type VaultSlotRecord } from '../../src/shared/vault'
import {
  invokeMacVault,
  macVaultContainerSchema,
  macVaultRequestSchema,
  type MacVaultContainer,
  type MacVaultTransport,
} from '../../src/runtime/vault/slots/macVaultProtocol'
import { MacVaultSlot, macVaultProtectionFacts } from '../../src/runtime/vault/slots/macVaultSlot'
import { FakeVaultSlot } from './helpers/vault/core'

function frame(metadata: unknown, key: Uint8Array = new Uint8Array()): Buffer {
  const json = Buffer.from(JSON.stringify(metadata))
  const output = Buffer.alloc(4 + json.length + key.length)
  output.writeUInt32BE(json.length)
  output.set(json, 4)
  output.set(key, 4 + json.length)
  return output
}

function context() {
  return {
    id: randomBytes(16).toString('hex'),
    vaultId: randomBytes(16).toString('hex'),
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(64),
    createdAt: 0,
  }
}

function canFakeUnwrap(use: string): boolean {
  return use !== 'deny'
}

class FakeMacHelper implements MacVaultTransport {
  private readonly entries = new Map<string, { fake: FakeVaultSlot; slot: VaultSlotRecord }>()
  isAvailable = true
  isCertified = true
  readonly calls: ReturnType<typeof macVaultRequestSchema.parse>[] = []
  readonly inputKeys: Uint8Array[] = []
  readonly outputs: Uint8Array[] = []
  readonly fakePresence = new FakeVaultSlot('presence', canFakeUnwrap)
  async exchange(header: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const raw: unknown = JSON.parse(Buffer.from(header).toString('utf8'))
    const request = macVaultRequestSchema.parse(raw)
    this.calls.push(request)
    this.inputKeys.push(key)
    let output: Buffer
    switch (request.operation) {
      case 'probe': {
        output = frame({
          v: 1,
          status: 'ok',
          secureEnclave: this.isAvailable,
          certified: this.isCertified,
        })
        break
      }
      case 'wrap': {
        const fake =
          request.identity.tier === 'presence' ? this.fakePresence : new FakeVaultSlot('osStore')
        const slot = await fake.wrap(key)
        const sealed = randomBytes(60).toString('base64')
        this.entries.set(sealed, { fake, slot })
        const container = macVaultContainerSchema.parse({
          v: 1,
          identity: request.identity,
          sealed,
          ...(request.identity.tier !== 'osStore' && {
            keyBlob: randomBytes(32).toString('base64'),
            ephemeral: randomBytes(65).toString('base64'),
            salt: randomBytes(32).toString('base64'),
          }),
        })
        output = frame({ v: 1, status: 'ok', container })
        break
      }
      case 'unwrap': {
        const entry = this.entries.get(request.container.sealed)
        if (entry === undefined) throw new Error('fake unknown item')
        const bytes = await entry.fake.unwrap(entry.slot, request.use)
        output = frame({ v: 1, status: 'ok' }, bytes)
        bytes.fill(0)
        break
      }
      case 'delete': {
        output = frame({ v: 1, status: 'ok' })
        break
      }
    }
    this.outputs.push(output)
    return output
  }
}

describe('Mac vault slot', () => {
  it.each(['osStore', 'hardware', 'presence'] as const)(
    'roundtrips %s without retaining helper buffers',
    async (tier) => {
      const helper = new FakeMacHelper()
      const slot = new MacVaultSlot(tier, context(), helper)
      const key = randomBytes(VAULT_KEY_BYTES)
      const record = await slot.wrap(key)
      expect(record.provider).toBe(tier === 'osStore' ? 'loginKeychain' : 'secureEnclave')
      expect(record.wrappedKey).not.toBe(key.toString('base64'))
      const result = await slot.unwrap(record, 'Use this exact destination')
      expect(result).toEqual(key)
      expect(result).not.toBe(key)
      expect(helper.inputKeys.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true)
      expect(helper.outputs.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true)
      result.fill(0)
      key.fill(0)
    },
  )

  it('requires fresh presence for each exact use and refuses denial', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('presence', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    const first = await slot.unwrap(record, 'destination A')
    first.fill(0)
    const second = await slot.unwrap(record, 'destination B')
    second.fill(0)
    await expect(slot.unwrap(record, 'deny')).rejects.toThrow()
    expect(helper.fakePresence.prompts).toEqual(['destination A', 'destination B', 'deny'])
    expect(helper.calls.filter((call) => call.operation === 'unwrap')).toHaveLength(3)
  })

  it.each(['hardware', 'presence'] as const)(
    'refuses unavailable/uncertified %s before passing any key',
    async (tier) => {
      for (const [isAvailable, isCertified] of [
        [false, true],
        [true, false],
        [false, false],
      ]) {
        const helper = new FakeMacHelper()
        helper.isAvailable = isAvailable!
        helper.isCertified = isCertified!
        const slot = new MacVaultSlot(tier, context(), helper)
        await expect(slot.wrap(randomBytes(32))).rejects.toThrow()
        expect(helper.calls.map((call) => call.operation)).toEqual(['probe'])
        expect(helper.inputKeys[0]).toHaveLength(0)
      }
    },
  )

  it('takes owned key/context snapshots before awaiting capability', async () => {
    const helper = new FakeMacHelper()
    const metadata = context()
    const originalId = metadata.id
    const slot = new MacVaultSlot('hardware', metadata, helper)
    metadata.id = randomBytes(16).toString('hex')
    const key = randomBytes(32)
    const expected = Uint8Array.from(key)
    const pending = slot.wrap(key)
    key.fill(0)
    const record = await pending
    expect(record.id).toBe(originalId)
    const result = await slot.unwrap(record, 'snapshot')
    expect([...result]).toEqual([...expected])
    result.fill(0)
    expected.fill(0)
  })

  it('validates context before any helper side effect', () => {
    const helper = new FakeMacHelper()
    for (const invalid of [
      { id: '../' },
      { vaultId: '' },
      { lastGeneration: -1 },
      { auditGeneration: -1 },
      { auditHead: '' },
      { createdAt: -1 },
    ]) {
      expect(() => new MacVaultSlot('osStore', { ...context(), ...invalid }, helper)).toThrow()
    }
    expect(helper.calls).toHaveLength(0)
  })

  it.each([0, 31, 33])('refuses vault-key length %i before helper dispatch', async (length) => {
    const helper = new FakeMacHelper()
    await expect(
      new MacVaultSlot('osStore', context(), helper).wrap(randomBytes(length)),
    ).rejects.toThrow()
    expect(helper.calls).toHaveLength(0)
  })

  it('binds slot/provider/reference/container before OS dispatch', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('osStore', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    const callCount = helper.calls.length
    for (const mutation of [
      { id: randomBytes(16).toString('hex') },
      { vaultId: randomBytes(16).toString('hex') },
      { tier: 'hardware', provider: 'secureEnclave' },
      { provider: 'secretService' },
      { keyReference: 'foreign' },
      { nonce: randomBytes(12).toString('base64') },
      { tag: randomBytes(16).toString('base64') },
      { backend: 'keychain' },
      { wrappedKey: 'A'.repeat(VAULT_LIMITS.text + 4) },
      { wrappedKey: 'Zh==' },
    ]) {
      const mutated = { ...record, ...mutation }
      await expect(slot.unwrap(vaultSlotRecordSchema.parse(mutated), 'same use')).rejects.toThrow()
    }
    expect(helper.calls).toHaveLength(callCount)
    const raw: unknown = JSON.parse(Buffer.from(record.wrappedKey, 'base64').toString('utf8'))
    const container = macVaultContainerSchema.parse(raw)
    for (const changed of [
      { ...container.identity, slotId: randomBytes(16).toString('hex') },
      { ...container.identity, vaultId: randomBytes(16).toString('hex') },
      { ...container.identity, tier: 'hardware' },
    ]) {
      const encoded = Buffer.from(JSON.stringify({ ...container, identity: changed })).toString(
        'base64',
      )
      await expect(slot.unwrap({ ...record, wrappedKey: encoded }, 'same use')).rejects.toThrow()
    }
    expect(helper.calls).toHaveLength(callCount)
  })

  it('checks capability again on unwrap, including after certification is revoked', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('presence', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    helper.isCertified = false
    await expect(slot.unwrap(record, 'later use')).rejects.toThrow()
    expect(helper.calls.at(-1)?.operation).toBe('probe')
    expect(helper.fakePresence.prompts).toHaveLength(0)
  })

  it('refuses a presence slot relabelled as silent hardware', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('presence', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    await expect(slot.unwrap({ ...record, tier: 'hardware' }, 'must ask')).rejects.toThrow()
    const raw: unknown = JSON.parse(Buffer.from(record.wrappedKey, 'base64').toString('utf8'))
    const container = macVaultContainerSchema.parse(raw)
    const wrappedKey = Buffer.from(
      JSON.stringify({ ...container, identity: { ...container.identity, tier: 'hardware' } }),
    ).toString('base64')
    await expect(slot.unwrap({ ...record, wrappedKey }, 'must ask')).rejects.toThrow()
    expect(helper.fakePresence.prompts).toHaveLength(0)
  })

  it('refuses oversized valid JSON and noncanonical base64 before native access', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('osStore', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    let json = Buffer.from(record.wrappedKey, 'base64').toString('utf8')
    const oversized = Buffer.from(json + ' '.repeat(4096)).toString('base64')
    await expect(slot.unwrap({ ...record, wrappedKey: oversized }, 'bounded')).rejects.toThrow()
    while (Buffer.byteLength(json) % 3 === 0) json += ' '
    const canonical = Buffer.from(json).toString('base64')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const at = canonical.indexOf('=') - 1
    const index = alphabet.indexOf(canonical[at]!)
    const changed = canonical.slice(0, at) + alphabet.charAt(index + 1) + canonical.slice(at + 1)
    expect(Buffer.from(changed, 'base64')).toEqual(Buffer.from(canonical, 'base64'))
    await expect(slot.unwrap({ ...record, wrappedKey: changed }, 'canonical')).rejects.toThrow()
    expect(helper.calls).toHaveLength(1)
  })

  it('rejects a helper wrap container for a different identity', async () => {
    const helper = new FakeMacHelper()
    const malicious: MacVaultTransport = {
      exchange: async (header, key) => {
        const raw: unknown = JSON.parse(Buffer.from(header).toString('utf8'))
        const request = macVaultRequestSchema.parse(raw)
        if (request.operation !== 'wrap') throw new Error('fake expected wrap')
        return await helper.exchange(
          Buffer.from(
            JSON.stringify({
              ...request,
              identity: { ...request.identity, slotId: randomBytes(16).toString('hex') },
            }),
          ),
          key,
        )
      },
    }
    await expect(
      new MacVaultSlot('osStore', context(), malicious).wrap(randomBytes(32)),
    ).rejects.toThrow()
  })

  it('removes only its own Keychain slot; hardware retirement needs no helper call', async () => {
    const helper = new FakeMacHelper()
    const metadata = context()
    await new MacVaultSlot('osStore', metadata, helper).remove()
    expect(helper.calls[0]).toEqual({
      v: 1,
      operation: 'delete',
      identity: { slotId: metadata.id, vaultId: metadata.vaultId, tier: 'osStore' },
    })
    await new MacVaultSlot('hardware', metadata, helper).remove()
    expect(helper.calls).toHaveLength(1)
  })

  it('banner distinguishes physical availability from certified protection', async () => {
    const helper = new FakeMacHelper()
    helper.isCertified = false
    const facts = await macVaultProtectionFacts(helper)
    expect(facts.secureEnclaveAvailable).toBe(true)
    expect(facts.secureEnclaveCertified).toBe(false)
    expect(facts.hardwareAvailable).toBe(false)
    expect(facts.presenceAvailable).toBe(false)
    expect(facts.hardwareWarning).toContain('certified')
    helper.isCertified = true
    const certified = await macVaultProtectionFacts(helper)
    expect(certified.hardwareWarning).toContain('silently')
  })
})

describe('Mac native frame boundary', () => {
  it('validates the exact request schema independently of framing', () => {
    const metadata = context()
    const identity = { slotId: metadata.id, vaultId: metadata.vaultId, tier: 'osStore' }
    const request = {
      v: 1,
      operation: 'unwrap',
      identity,
      use: 'exact use',
      container: { v: 1, identity, sealed: randomBytes(60).toString('base64') },
    }
    expect(macVaultRequestSchema.safeParse(request).success).toBe(true)
    for (const mutation of [
      { v: 2 },
      { operation: 'foreign' },
      { value: 'canary' },
      { identity: { ...identity, slotId: '../' } },
      { identity: { ...identity, vaultId: '' } },
      { identity: { ...identity, tier: 'foreign' } },
      { identity: { ...identity, value: 'canary' } },
      { use: '' },
      { use: 'bad\nuse' },
      { use: 'x'.repeat(4097) },
    ]) {
      expect(macVaultRequestSchema.safeParse({ ...request, ...mutation }).success).toBe(false)
    }
  })

  it('refuses invalid invocation keys and use text before dispatch', async () => {
    const helper = new FakeMacHelper()
    const metadata = context()
    const identity = { slotId: metadata.id, vaultId: metadata.vaultId, tier: 'osStore' as const }
    for (const length of [0, 31, 33]) {
      await expect(
        invokeMacVault(helper, { v: 1, operation: 'wrap', identity }, randomBytes(length)),
      ).rejects.toThrow()
    }
    await expect(
      invokeMacVault(helper, { v: 1, operation: 'probe' }, randomBytes(32)),
    ).rejects.toThrow()
    expect(helper.calls).toHaveLength(0)
    const slot = new MacVaultSlot('osStore', metadata, helper)
    const record = await slot.wrap(randomBytes(32))
    for (const use of [
      '',
      'bad\0use',
      'bad\nuse',
      'bad\ruse',
      'x'.repeat(4097),
      'x'.repeat(4096),
    ]) {
      await expect(slot.unwrap(record, use)).rejects.toThrow()
    }
    expect(helper.calls).toHaveLength(1)
  })

  it.each([
    frame({ v: 2, status: 'ok', secureEnclave: true, certified: true }),
    frame({ v: 1, status: 'ok', secureEnclave: true, certified: true, value: 'canary' }),
    frame({ v: 1, status: 'ok', secureEnclave: 'true', certified: true }),
    frame({ v: 1, status: 'ok', secureEnclave: true }),
    Buffer.alloc(3),
    Buffer.alloc(4),
    Buffer.from([0, 0, 16, 1]),
    Buffer.from([0, 0, 0, 8]),
    frame({ v: 1, status: 'ok', secureEnclave: true, certified: true }, randomBytes(1)),
    frame({ v: 1, status: 'error', code: 'foreign' }),
    frame({ v: 1, status: 'error', code: 'cancelled' }, randomBytes(32)),
  ])('rejects malformed probe frames and erases output %s', async (bytes) => {
    const output = Buffer.from(bytes)
    const transport: MacVaultTransport = { exchange: () => Promise.resolve(output) }
    await expect(invokeMacVault(transport, { v: 1, operation: 'probe' })).rejects.toThrow()
    expect(output.every((byte) => byte === 0)).toBe(true)
  })

  it('erases an owned key on transport failure without exposing its error', async () => {
    let received: Uint8Array | undefined
    const transport: MacVaultTransport = {
      exchange: (_header, key) => {
        received = key
        return Promise.reject(new Error('private path/account/canary'))
      },
    }
    const metadata = context()
    const key = randomBytes(32)
    await expect(
      invokeMacVault(
        transport,
        {
          v: 1,
          operation: 'wrap',
          identity: {
            slotId: metadata.id,
            vaultId: metadata.vaultId,
            tier: 'osStore',
          },
        },
        key,
      ),
    ).rejects.toThrow('No access')
    expect(received?.every((byte) => byte === 0)).toBe(true)
    expect(key.some((byte) => byte !== 0)).toBe(true)
    key.fill(0)
  })

  it('rejects trailing plaintext or a short unwrap secret', async () => {
    const helper = new FakeMacHelper()
    const slot = new MacVaultSlot('osStore', context(), helper)
    const record = await slot.wrap(randomBytes(32))
    for (const length of [0, 31, 33]) {
      const transport: MacVaultTransport = {
        exchange: () => Promise.resolve(frame({ v: 1, status: 'ok' }, randomBytes(length))),
      }
      const same = new MacVaultSlot(
        'osStore',
        {
          id: record.id,
          vaultId: record.vaultId,
          lastGeneration: 0,
          auditGeneration: 0,
          auditHead: '0'.repeat(64),
          createdAt: 0,
        },
        transport,
      )
      await expect(same.unwrap(record, 'use')).rejects.toThrow()
    }
  })

  it('rejects container format/length/provider fields', () => {
    const metadata = context()
    const valid: MacVaultContainer = {
      v: 1,
      identity: { slotId: metadata.id, vaultId: metadata.vaultId, tier: 'hardware' },
      sealed: randomBytes(60).toString('base64'),
      keyBlob: randomBytes(32).toString('base64'),
      ephemeral: randomBytes(65).toString('base64'),
      salt: randomBytes(32).toString('base64'),
    }
    expect(macVaultContainerSchema.safeParse(valid).success).toBe(true)
    for (const mutation of [
      { v: 2 },
      { sealed: randomBytes(59).toString('base64') },
      { keyBlob: undefined },
      { keyBlob: '' },
      { keyBlob: 'Zg==' },
      { keyBlob: 'Zh==' },
      { keyBlob: 'A'.repeat(4100) },
      { ephemeral: randomBytes(64).toString('base64') },
      { salt: randomBytes(31).toString('base64') },
      { value: 'canary' },
      { identity: { ...valid.identity, tier: 'osStore' } },
    ]) {
      // Zg== is a valid one-byte blob; its content belongs to the OS, not this parser.
      expect(macVaultContainerSchema.safeParse({ ...valid, ...mutation }).success).toBe(
        mutation.keyBlob === 'Zg==',
      )
    }
  })
})
