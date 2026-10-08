import { constants, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  WindowsVaultSlot,
  windowsVaultProtectionFacts,
  windowsVaultScreenLock,
} from '../../src/runtime/vault/slots/windowsVaultSlot'
import {
  invokeWindowsVault,
  windowsPresenceMessage,
  windowsVaultContainerSchema,
  windowsVaultRequestSchema,
  type WindowsVaultTransport,
} from '../../src/runtime/vault/slots/windowsVaultProtocol'
import { UI_TEXT, VAULT_KEY_BYTES, VAULT_LIMITS } from '../../src/shared/constants'
import type { VaultSlotRecord } from '../../src/shared/vault'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

const context = {
  id: '1'.repeat(32),
  vaultId: '2'.repeat(32),
  lastGeneration: 0,
  auditGeneration: 0,
  auditHead: '0'.repeat(64),
  createdAt: 0,
}
const signing: {
  privateKey?: KeyObject
  publicKey: string
  alternatePrivate?: KeyObject
  alternatePublic: string
  weakPrivate?: KeyObject
  weakPublic: string
} = { publicKey: '', alternatePublic: '', weakPublic: '' }
beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  signing.privateKey = pair.privateKey
  signing.publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const alternate = generateKeyPairSync('rsa', { modulusLength: 2048 })
  signing.alternatePrivate = alternate.privateKey
  signing.alternatePublic = alternate.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64')
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 })
  signing.weakPrivate = weak.privateKey
  signing.weakPublic = weak.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
})

function frame(metadata: unknown, key: Uint8Array = new Uint8Array()): Buffer {
  const header = Buffer.from(JSON.stringify(metadata))
  const output = Buffer.alloc(4 + header.length + key.length)
  output.writeUInt32BE(header.length)
  output.set(header, 4)
  output.set(key, 4 + header.length)
  return output
}
type Request = ReturnType<typeof windowsVaultRequestSchema.parse>
const outputs: Uint8Array[] = []
const inputs: Uint8Array[] = []
afterEach(() => {
  for (const bytes of [...outputs, ...inputs]) bytes.fill(0)
  outputs.length = 0
  inputs.length = 0
  setUiText(EN, 'en')
  vi.restoreAllMocks()
})
function fake(
  options: {
    rsa?: boolean
    hello?: boolean
    ecc?: boolean
    dpapi?: boolean
    response?: (request: Request, metadata: unknown, key: Uint8Array) => Uint8Array
  } = {},
) {
  const requests: Request[] = []
  const values = new Map<string, Uint8Array>()
  const transport: WindowsVaultTransport = {
    exchange: (header, key) => {
      const raw: unknown = JSON.parse(Buffer.from(header).toString('utf8'))
      const request = windowsVaultRequestSchema.parse(raw)
      requests.push(request)
      inputs.push(key)
      let metadata: unknown = { v: 1, status: 'ok' }
      let secret: Uint8Array = new Uint8Array()
      switch (request.operation) {
        case 'probe': {
          metadata = {
            v: 1,
            status: 'ok',
            rsa: options.rsa ?? true,
            hello: options.hello ?? true,
            ecc: options.ecc ?? false,
            dpapi: options.dpapi ?? true,
          }
          break
        }
        case 'wrap': {
          const owned = new Uint8Array(key)
          inputs.push(owned)
          values.set(request.identity.slotId, owned)
          metadata = {
            v: 1,
            status: 'ok',
            container: {
              v: 1,
              identity: request.identity,
              sealed: randomBytes(request.identity.tier === 'osStore' ? 64 : 256).toString(
                'base64',
              ),
              helloPublicKey: request.identity.tier === 'presence' ? signing.publicKey : null,
            },
          }
          break
        }
        case 'unwrap': {
          secret = values.get(request.identity.slotId) ?? new Uint8Array(VAULT_KEY_BYTES)
          if (request.identity.tier === 'presence')
            metadata = {
              v: 1,
              status: 'ok',
              presence: {
                challenge: request.challenge,
                publicKey: signing.publicKey,
                signature: sign('sha256', windowsPresenceMessage(request), {
                  key: signing.privateKey!,
                  padding: constants.RSA_PKCS1_PSS_PADDING,
                  saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
                }).toString('base64'),
                padding: 'pss',
              },
            }
          break
        }
        case 'screenLock': {
          metadata = { v: 1, status: 'ok', locked: true }
          break
        }
        case 'delete': {
          break
        }
      }
      const result = options.response?.(request, metadata, secret) ?? frame(metadata, secret)
      outputs.push(result)
      return Promise.resolve(result)
    },
  }
  return { transport, requests }
}

describe('Windows vault slots: D89.2', () => {
  it.each(['osStore', 'hardware', 'presence'] as const)(
    'wraps and unwraps %s with owned bytes and lane-0 metadata',
    async (tier) => {
      const host = fake()
      const slot = new WindowsVaultSlot(tier, context, host.transport)
      const key = randomBytes(VAULT_KEY_BYTES)
      const record = await slot.wrap(key)
      const actual = await slot.unwrap(record, 'SSH deploy to the test host')
      expect(actual).toEqual(key)
      expect(actual).not.toBe(key)
      expect(record).toMatchObject({
        ...context,
        tier,
        provider: tier === 'osStore' ? 'windowsDpapi' : 'windowsTpm',
        keyReference: context.id,
      })
      expect(
        inputs
          .filter((bytes) => bytes.length === VAULT_KEY_BYTES)
          .some((bytes) => bytes.every((value) => value === 0)),
      ).toBe(true)
      expect(outputs.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
      actual.fill(0)
      key.fill(0)
    },
  )
  it('rejects invalid identity, generation and unknown context fields', () => {
    const host = fake()
    for (const changed of [
      { ...context, id: '../foreign' },
      { ...context, vaultId: 'x' },
      { ...context, lastGeneration: -1 },
      { ...context, auditHead: 'x' },
      { ...context, createdAt: 0.5 },
      { ...context, secret: 'canary' },
    ]) {
      expect(() => new WindowsVaultSlot('osStore', changed, host.transport)).toThrow(
        UI_TEXT.vault.useChanged,
      )
    }
    expect(host.requests).toHaveLength(0)
  })
  it('owns context before an external mutation', async () => {
    const mutable = { ...context }
    const slot = new WindowsVaultSlot('osStore', mutable, fake().transport)
    mutable.id = 'f'.repeat(32)
    const record = await slot.wrap(randomBytes(32))
    expect(record.id).toBe(context.id)
  })
  it('rejects wrong key length before starting any helper', async () => {
    const host = fake()
    await expect(
      new WindowsVaultSlot('osStore', context, host.transport).wrap(new Uint8Array(31)),
    ).rejects.toThrow(UI_TEXT.vault.useChanged)
    expect(host.requests).toHaveLength(0)
  })
  it('snapshots caller key bytes before the capability await', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('hardware', context, host.transport)
    const key = randomBytes(32)
    const expected = Buffer.from(key)
    const pending = slot.wrap(key)
    key.fill(0)
    const result = await slot.unwrap(await pending, 'generated material')
    expect(result).toEqual(expected)
    result.fill(0)
    expected.fill(0)
  })
  it('erases both owned wrap buffers before returning a slot record', async () => {
    const key = randomBytes(32)
    const allocated: Buffer[] = []
    const allocate = Buffer.alloc
    vi.spyOn(Buffer, 'alloc').mockImplementation((size: number) => {
      const bytes = allocate(size)
      if (size === 32) allocated.push(bytes)
      return bytes
    })
    await new WindowsVaultSlot('osStore', context, fake().transport).wrap(key)
    expect(allocated).toHaveLength(2)
    expect(allocated.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
    key.fill(0)
  })
  it.each([
    { tier: 'hardware', rsa: false, hello: true },
    { tier: 'presence', rsa: true, hello: false, dpapi: true },
    { tier: 'presence', rsa: false, hello: true },
  ] as const)(
    'refuses unavailable $tier without a software fallback',
    async ({ tier, rsa, hello }) => {
      const host = fake({ rsa, hello })
      await expect(
        new WindowsVaultSlot(tier, context, host.transport).wrap(randomBytes(32)),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(host.requests.map((request) => request.operation)).toEqual(['probe'])
      expect(inputs.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
    },
  )
  it('rejects a helper container for another slot before creating a record', async () => {
    const host = fake({
      response: (request, metadata, key) =>
        request.operation === 'wrap'
          ? frame({
              v: 1,
              status: 'ok',
              container: {
                v: 1,
                identity: { ...request.identity, slotId: 'f'.repeat(32) },
                sealed: randomBytes(64).toString('base64'),
                helloPublicKey: null,
              },
            })
          : frame(metadata, key),
    })
    await expect(
      new WindowsVaultSlot('osStore', context, host.transport).wrap(randomBytes(32)),
    ).rejects.toThrow()
  })
  it('rejects each mismatched slot record before reaching a helper', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('osStore', context, host.transport)
    const record = await slot.wrap(randomBytes(32))
    host.requests.length = 0
    const changes: Partial<VaultSlotRecord>[] = [
      { id: 'f'.repeat(32) },
      { vaultId: 'f'.repeat(32) },
      { tier: 'hardware' },
      { provider: 'loginKeychain' },
      { keyReference: 'foreign' },
      { nonce: 'YWJj' },
      { tag: 'YWJj' },
      { backend: 'keychain' },
      { wrappedKey: record.wrappedKey.replace(/=+$/u, '') + ' ' },
    ]
    for (const change of changes)
      await expect(slot.unwrap({ ...record, ...change }, 'test')).rejects.toThrow()
    expect(host.requests).toHaveLength(0)
  })
  it('rejects foreign, malformed and oversized inner containers', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('osStore', context, host.transport)
    const record = await slot.wrap(randomBytes(32))
    host.requests.length = 0
    const raw: unknown = JSON.parse(Buffer.from(record.wrappedKey, 'base64').toString('utf8'))
    const container = windowsVaultContainerSchema.parse(raw)
    for (const changed of [
      { ...container, identity: { ...container.identity, vaultId: 'f'.repeat(32) } },
      { ...container, sealed: 'not base64' },
      { ...container, helloPublicKey: signing.publicKey },
      { ...container, secret: 'canary' },
    ]) {
      await expect(
        slot.unwrap(
          { ...record, wrappedKey: Buffer.from(JSON.stringify(changed)).toString('base64') },
          'test',
        ),
      ).rejects.toThrow()
    }
    await expect(
      slot.unwrap(
        {
          ...record,
          wrappedKey: Buffer.from(
            JSON.stringify(container).padStart(VAULT_LIMITS.text, ' '),
          ).toString('base64'),
        },
        'test',
      ),
    ).rejects.toThrow()
    expect(host.requests).toHaveLength(0)
  })
  it('rejects noncanonical outer base64 even when it decodes to valid slot JSON', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('osStore', context, host.transport)
    const record = await slot.wrap(randomBytes(32))
    const text = Buffer.from(record.wrappedKey, 'base64').toString('utf8')
    const canonical = Buffer.from(text + ' '.repeat(4 - (text.length % 3))).toString('base64')
    const changed = canonical.replace(/A==$/u, 'B==')
    expect(changed).not.toBe(canonical)
    await expect(slot.unwrap({ ...record, wrappedKey: changed }, 'test')).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('rejects inner containers with an invalid tier, format, ciphertext size or encoding', () => {
    const identity = { slotId: context.id, vaultId: context.vaultId, tier: 'osStore' }
    const valid = {
      v: 1,
      identity,
      sealed: Buffer.alloc(64).toString('base64'),
      helloPublicKey: null,
    }
    expect(windowsVaultContainerSchema.safeParse(valid).success).toBe(true)
    for (const invalid of [
      { ...valid, v: 2 },
      { ...valid, sealed: 'AB==' },
      { ...valid, sealed: Buffer.alloc(VAULT_LIMITS.text).toString('base64') },
      { ...valid, identity: { ...identity, tier: 'presence' } },
      { ...valid, identity: { ...identity, tier: 'hardware' } },
      { ...valid, extra: 'canary' },
    ]) {
      expect(windowsVaultContainerSchema.safeParse(invalid).success).toBe(false)
    }
  })
  it('sanitizes malformed slot JSON before crossing the broker boundary', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('osStore', context, host.transport)
    const record = await slot.wrap(randomBytes(32))
    const changed = {
      ...record,
      wrappedKey: Buffer.from('private-canary invalid json').toString('base64'),
    }
    await expect(slot.unwrap(changed, 'test')).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('uses a fresh challenge for every presence use', async () => {
    const host = fake()
    const slot = new WindowsVaultSlot('presence', context, host.transport)
    const record = await slot.wrap(randomBytes(32))
    const first = await slot.unwrap(record, 'SSH A')
    first.fill(0)
    const second = await slot.unwrap(record, 'SSH B')
    second.fill(0)
    const requests = host.requests.filter((request) => request.operation === 'unwrap')
    expect(requests[0]?.challenge).not.toBe(requests[1]?.challenge)
    expect(requests.map((request) => request.use)).toEqual(['SSH A', 'SSH B'])
  })
  it.each(['missing', 'challenge', 'publicKey', 'signature', 'padding', 'changedUse'] as const)(
    'refuses a %s Hello proof and erases the released bytes',
    async (fault) => {
      const host = fake({
        response: (request, metadata, key) => {
          if (request.operation !== 'unwrap') return frame(metadata, key)
          const proof = {
            challenge: request.challenge,
            publicKey: signing.publicKey,
            signature: sign(
              'sha256',
              windowsPresenceMessage(
                fault === 'changedUse' ? { ...request, use: 'another target' } : request,
              ),
              {
                key: signing.privateKey!,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32,
              },
            ).toString('base64'),
            padding: 'pss',
          }
          if (fault === 'missing') return frame({ v: 1, status: 'ok' }, key)
          switch (fault) {
            case 'challenge': {
              proof.challenge = randomBytes(32).toString('base64')
              break
            }
            case 'publicKey': {
              proof.publicKey = signing.alternatePublic
              proof.signature = sign('sha256', windowsPresenceMessage(request), {
                key: signing.alternatePrivate!,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32,
              }).toString('base64')
              break
            }
            case 'signature': {
              proof.signature = randomBytes(256).toString('base64')
              break
            }
            case 'padding': {
              {
                proof.padding = 'pkcs1'
                // No default
              }
              break
            }
          }
          return frame({ v: 1, status: 'ok', presence: proof }, key)
        },
      })
      const slot = new WindowsVaultSlot('presence', context, host.transport)
      await expect(slot.unwrap(await slot.wrap(randomBytes(32)), 'SSH A')).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(outputs.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
    },
  )
  it('accepts captured PKCS1 as well as PSS only after signature verification', async () => {
    const host = fake({
      response: (request, metadata, key) =>
        frame(
          request.operation === 'unwrap'
            ? {
                v: 1,
                status: 'ok',
                presence: {
                  challenge: request.challenge,
                  publicKey: signing.publicKey,
                  padding: 'pkcs1',
                  signature: sign('sha256', windowsPresenceMessage(request), {
                    key: signing.privateKey!,
                    padding: constants.RSA_PKCS1_PADDING,
                  }).toString('base64'),
                },
              }
            : metadata,
          key,
        ),
    })
    const slot = new WindowsVaultSlot('presence', context, host.transport)
    const actual = await slot.unwrap(await slot.wrap(randomBytes(32)), 'SSH test')
    expect(actual).toHaveLength(32)
    actual.fill(0)
  })
  it('refuses a valid signature from a weak RSA Hello key', async () => {
    const host = fake({
      response: (request, metadata, key) => {
        if (request.operation === 'wrap')
          return frame({
            v: 1,
            status: 'ok',
            container: {
              v: 1,
              identity: request.identity,
              sealed: randomBytes(256).toString('base64'),
              helloPublicKey: signing.weakPublic,
            },
          })
        if (request.operation === 'unwrap')
          return frame(
            {
              v: 1,
              status: 'ok',
              presence: {
                challenge: request.challenge,
                publicKey: signing.weakPublic,
                padding: 'pss',
                signature: sign('sha256', windowsPresenceMessage(request), {
                  key: signing.weakPrivate!,
                  padding: constants.RSA_PKCS1_PSS_PADDING,
                  saltLength: 32,
                }).toString('base64'),
              },
            },
            key,
          )
        return frame(metadata, key)
      },
    })
    const slot = new WindowsVaultSlot('presence', context, host.transport)
    await expect(slot.unwrap(await slot.wrap(randomBytes(32)), 'weak key')).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('deletes only its own identity even after a caller mutation', async () => {
    const host = fake()
    const mutable = { ...context }
    const slot = new WindowsVaultSlot('hardware', mutable, host.transport)
    mutable.id = 'f'.repeat(32)
    await slot.remove()
    expect(host.requests).toEqual([
      {
        v: 1,
        operation: 'delete',
        identity: { slotId: context.id, vaultId: context.vaultId, tier: 'hardware' },
      },
    ])
  })
  it('reports actual capability facts and reads installed text at use time', async () => {
    const host = fake({ rsa: false, hello: false, dpapi: true, ecc: true })
    setUiText(
      {
        ...EN,
        vault: {
          ...EN.vault,
          hardwareWarning: 'Matériel de test',
          osStoreWarning: 'Stockage de test',
          presenceTierWarning: 'Présence de test',
        },
      },
      'fr',
    )
    expect(await windowsVaultProtectionFacts(host.transport)).toMatchObject({
      hardwareAvailable: false,
      eccAvailable: true,
      helloAvailable: false,
      presenceAvailable: false,
      osStoreAvailable: true,
      osStoreWarning: 'Stockage de test',
      hardwareWarning: 'Matériel de test',
      presenceWarning: 'Présence de test',
    })
  })
  it('reports screen lock only after a validated helper notification', async () => {
    await expect(windowsVaultScreenLock(fake().transport)).resolves.toBeUndefined()
    await expect(
      windowsVaultScreenLock(
        fake({ response: () => frame({ v: 1, status: 'ok', locked: false }) }).transport,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('reports unavailable current-user DPAPI separately from TPM and Hello', async () => {
    const facts = await windowsVaultProtectionFacts(fake({ dpapi: false }).transport)
    expect(facts.osStoreAvailable).toBe(false)
    expect(facts.hardwareAvailable).toBe(true)
  })
})

describe('Windows helper boundary', () => {
  it('refuses truncated private key bodies instead of padding them with zeros', async () => {
    const host = fake({
      response: (request, metadata, key) =>
        frame(metadata, request.operation === 'unwrap' ? key.subarray(0, 31) : key),
    })
    const slot = new WindowsVaultSlot('osStore', context, host.transport)
    await expect(slot.unwrap(await slot.wrap(randomBytes(32)), 'test')).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('bounds encoded request headers even when individual strings fit their schema', async () => {
    const host = fake()
    await expect(
      invokeWindowsVault(
        host.transport,
        {
          v: 1,
          operation: 'wrap',
          identity: { slotId: context.id, vaultId: context.vaultId, tier: 'osStore' },
          title: 'test',
          use: 'é'.repeat(VAULT_LIMITS.text),
        },
        randomBytes(32),
      ),
    ).rejects.toThrow(UI_TEXT.vault.useChanged)
    expect(host.requests).toHaveLength(0)
  })
  it.each([
    'truncated',
    'surplus',
    'zeroLength',
    'oversized',
    'unknownField',
    'error',
    'malformedJson',
    'wrongVersion',
  ] as const)('refuses %s responses without relaying their diagnostic', async (fault) => {
    const host = fake({
      response: () => {
        const good = frame({ v: 1, status: 'ok', rsa: true, ecc: false, hello: false, dpapi: true })
        if (fault === 'truncated') return good.subarray(0, -1)
        if (fault === 'surplus') return Buffer.concat([good, Buffer.of(0)])
        if (fault === 'zeroLength') {
          good.writeUInt32BE(0)
          return good
        }
        if (fault === 'oversized') {
          good.writeUInt32BE(VAULT_LIMITS.text + 1)
          return good
        }
        if (fault === 'malformedJson') {
          good.fill(0, 4)
          return good
        }
        if (fault === 'wrongVersion')
          return frame({ v: 2, status: 'ok', rsa: true, ecc: false, hello: false, dpapi: true })
        if (fault === 'error')
          return frame({
            v: 1,
            status: 'error',
            code: 'refused',
            diagnostic: 'do not relay this canary',
          })
        return frame({
          v: 1,
          status: 'ok',
          rsa: true,
          ecc: false,
          hello: false,
          dpapi: true,
          secret: 'do not relay this canary',
        })
      },
    })
    await expect(invokeWindowsVault(host.transport, { v: 1, operation: 'probe' })).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(outputs.every((bytes) => bytes.every((value) => value === 0))).toBe(true)
  })
  it('sanitizes thrown transport diagnostics and erases wrap input', async () => {
    let captured: Uint8Array | undefined
    const transport: WindowsVaultTransport = {
      exchange: (_header, key) => {
        captured = key
        return Promise.reject(new Error('private canary'))
      },
    }
    const key = randomBytes(32)
    await expect(new WindowsVaultSlot('osStore', context, transport).wrap(key)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(captured?.every((value) => value === 0)).toBe(true)
    expect(key.some((value) => value !== 0)).toBe(true)
    key.fill(0)
  })
  it('validates requests and exact private input lengths before exchange', async () => {
    const host = fake()
    await expect(
      invokeWindowsVault(host.transport, { v: 1, operation: 'probe' }, randomBytes(32)),
    ).rejects.toThrow(UI_TEXT.vault.useChanged)
    await expect(
      invokeWindowsVault(
        host.transport,
        {
          v: 1,
          operation: 'wrap',
          identity: { slotId: context.id, vaultId: context.vaultId, tier: 'osStore' },
          title: 'test',
          use: 'test\nforeign',
        },
        randomBytes(32),
      ),
    ).rejects.toThrow(UI_TEXT.vault.useChanged)
    expect(host.requests).toHaveLength(0)
  })
})
