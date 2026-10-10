import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  FakeVaultBroker,
  FakeVaultChannel,
  FakeVaultClock,
  FakeVaultSlot,
  InMemoryVault,
} from '../helpers/vault/core'
import { FakeCdpTarget, FakeGit, FakeSudo } from '../helpers/vault/routes'
import { FakeSshClient, FakeSshServer } from '../helpers/vault/sshPair'
import { item, metadata, requester, use } from '../helpers/vault/fixtures'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { vaultSlotRecordSchema, type VaultUse } from '../../../src/shared/vault'
import {
  vaultApprovalResultSchema,
  type VaultAuthorizationResult,
} from '../../../src/shared/vaultProtocol'

function pendingApproval(result: VaultAuthorizationResult) {
  if (result.kind !== 'approval') throw new Error('expected a pending approval')
  return result.request
}

describe('vault test doubles (not runtime certification)', () => {
  it('owns private byte copies and returns metadata only', async () => {
    const store = new InMemoryVault()
    const original = item()
    const expected = Uint8Array.from(
      original.material.kind === 'secret' ? original.material.value : [],
    )
    await store.write(original)
    if (original.material.kind === 'secret') original.material.value.fill(0)
    const read = await store.read(original.metadata.id)
    expect(read.material.kind === 'secret' && read.material.value).toEqual(expected)
    if (read.material.kind === 'secret') read.material.value.fill(0)
    const again = await store.read(original.metadata.id)
    expect(again.material.kind === 'secret' && again.material.value).toEqual(expected)
    expect(await store.list()).toEqual([metadata()])
    await store.remove(original.metadata.id)
    await expect(store.read(original.metadata.id)).rejects.toThrow('missing')
    store.lock()
    expect(() => store.list()).toThrow('locked')
  })

  it('recovers from a lost slot through every other tier and prompts separately', async () => {
    const key = randomBytes(32)
    const hardware = new FakeVaultSlot('hardware')
    const hardwareSlot = await hardware.wrap(key)
    hardware.lost = true
    await expect(hardware.unwrap(hardwareSlot, 'use')).rejects.toThrow('unavailable')
    for (const tier of ['presence', 'osStore', 'secretStorage', 'passphrase', 'recovery']) {
      const slot = new FakeVaultSlot(vaultSlotRecordSchema.shape.tier.parse(tier))
      const record = await slot.wrap(key)
      expect(await slot.unwrap(record, 'use one')).toEqual(Uint8Array.from(key))
      expect(await slot.unwrap(record, 'use two')).toEqual(Uint8Array.from(key))
      expect(slot.prompts.length).toBe(tier === 'presence' || tier === 'passphrase' ? 2 : 0)
    }
    const denied = new FakeVaultSlot('presence', () => false)
    await expect(denied.unwrap(await denied.wrap(key), 'denied use')).rejects.toThrow(
      'presence denied',
    )
    await expect(
      new FakeVaultSlot('hardware').unwrap(
        await new FakeVaultSlot('recovery').wrap(key),
        'wrong tier',
      ),
    ).rejects.toThrow('unavailable')
  })

  it('slots own copies at wrap and return a fresh buffer for every unwrap', async () => {
    const key = randomBytes(32)
    const expected = Uint8Array.from(key)
    const slot = new FakeVaultSlot('hardware')
    const record = await slot.wrap(key)
    key.fill(0)
    const first = await slot.unwrap(record, 'first')
    expect(first).toEqual(expected)
    first.fill(0)
    expect(await slot.unwrap(record, 'second')).toEqual(expected)
  })

  it('V11 V13: fake approval refuses changed digests, foreign hosts, non-UI answers, replay and expiry', async () => {
    const store = new InMemoryVault()
    await store.write(item())
    const clock = new FakeVaultClock()
    const broker = new FakeVaultBroker(store, clock)
    const req = pendingApproval(
      await broker.request(requester(), metadata().handle, use(), {
        tainted: false,
        reasons: [],
      }),
    )
    const peer = { hostId: requester().hostId, processId: 100, userId: 'test-user', ui: true }
    const answer = { requestId: req.id, digest: req.digest, decision: 'allowOnce' as const }
    expect(await broker.answer(peer, { ...answer, digest: '0'.repeat(64) })).toEqual({
      kind: 'denied',
      reason: 'digest',
    })
    expect(await broker.answer({ ...peer, hostId: '0'.repeat(32) }, answer)).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(await broker.answer({ ...peer, ui: false }, answer)).toEqual({
      kind: 'denied',
      reason: 'peer',
    })
    expect(await broker.answer(peer, answer)).toMatchObject({
      kind: 'ticket',
      authority: { kind: 'user' },
    })
    expect(await broker.answer(peer, answer)).toEqual({ kind: 'denied', reason: 'replay' })
    const expired = pendingApproval(
      await broker.request(requester(), metadata().handle, use(), {
        tainted: true,
        reasons: [{ source: 'web', label: 'fake page' }],
      }),
    )
    clock.advance(120_000)
    expect(
      await broker.answer(peer, { ...answer, requestId: expired.id, digest: expired.digest }),
    ).toEqual({ kind: 'denied', reason: 'expired' })
    await broker.lock()
    const status = await broker.status()
    expect(status.state).toBe('locked')
    expect(status.lockEpoch).toBe(1)
    await expect(
      broker.request(requester(), metadata().handle, use(), { tainted: false, reasons: [] }),
    ).rejects.toThrow('locked')
    expect(() => {
      clock.advance(-1)
    }).toThrow('invalid')
  })

  it('authenticated channel copies its peer and refuses use after close', async () => {
    const peer = { hostId: requester().hostId, processId: 100, userId: 'test-user', ui: true }
    const channel = new FakeVaultChannel(peer)
    expect(await channel.authenticate()).toEqual(peer)
    expect(await channel.authenticate()).not.toBe(peer)
    channel.close()
    await expect(channel.authenticate()).rejects.toThrow('closed')
  })

  it('RVM109L0 P3 ownership: caller mutation cannot transfer a pending approval to another host', async () => {
    const store = new InMemoryVault()
    await store.write(item())
    const broker = new FakeVaultBroker(store, new FakeVaultClock())
    const original = requester()
    const req = pendingApproval(
      await broker.request(original, metadata().handle, use(), { tainted: false, reasons: [] }),
    )
    const ownerHost = req.requester.hostId
    original.hostId = '0'.repeat(32)
    req.requester.hostId = original.hostId
    const peer = { hostId: original.hostId, processId: 100, userId: 'test-user', ui: true }
    const answer = { requestId: req.id, digest: req.digest, decision: 'allowOnce' as const }
    expect(await broker.answer(peer, answer)).toEqual({ kind: 'denied', reason: 'peer' })
    expect(await broker.answer({ ...peer, hostId: ownerHost }, answer)).toMatchObject({
      kind: 'ticket',
      authority: { kind: 'user' },
    })
  })

  it('RVM109L0 P3 ownership: requester, use and taint are snapshotted before awaiting the store', async () => {
    const store = new InMemoryVault()
    await store.write(item())
    const broker = new FakeVaultBroker(store, new FakeVaultClock())
    const original = requester()
    original.role = { kind: 'role', name: 'original-role' }
    const target = use()
    const reason = { source: 'web' as const, label: 'original-page' }
    const taint = { tainted: true, reasons: [reason] }
    const expected = structuredClone({ requester: original, use: target, taint })
    const pending = broker.request(original, metadata().handle, target, taint)
    original.hostId = '0'.repeat(32)
    original.role.name = 'changed-role'
    target.command.argv.push('--changed')
    target.names.push('CHANGED_TOKEN')
    taint.tainted = false
    reason.label = 'changed-page'
    const req = pendingApproval(await pending)
    expect(req).toMatchObject(expected)
    expect(req.digest).toBe(vaultUseDigest(expected.use))
  })

  it('RVM109L0 P2 broker: a UI answer returns its bound single-use ticket or consumes a denial', async () => {
    const store = new InMemoryVault()
    await store.write(item())
    const clock = new FakeVaultClock()
    const broker = new FakeVaultBroker(store, clock)
    const peer = { hostId: requester().hostId, processId: 100, userId: 'test-user', ui: true }
    for (const decision of ['allowOnce', 'allowSession', 'deny'] as const) {
      const req = pendingApproval(
        await broker.request(requester(), metadata().handle, use(), {
          tainted: false,
          reasons: [],
        }),
      )
      clock.advance(1)
      const result = await broker.answer(peer, { requestId: req.id, digest: req.digest, decision })
      expect(vaultApprovalResultSchema.parse(result)).toEqual(result)
      if (decision === 'deny') {
        expect(result).toEqual({ kind: 'denied', reason: 'policy' })
        expect(broker.accepted).not.toContain(req.id)
      } else {
        expect(result).toMatchObject({
          kind: 'ticket',
          authority: { kind: 'user' },
          ticket: {
            requestId: req.id,
            requesterId: req.requester.id,
            itemId: req.item.id,
            digest: req.digest,
            nonce: req.nonce,
            issuedAt: clock.now(),
            expiresAt: req.expiresAt,
            lockEpoch: req.lockEpoch,
            maxUses: 1,
          },
        })
        expect(broker.accepted).toContain(req.id)
      }
      expect(
        await broker.answer(peer, { requestId: req.id, digest: req.digest, decision }),
      ).toEqual({ kind: 'denied', reason: 'replay' })
    }
  })

  it('RVM109L0 P3 ownership: pending item metadata is detached from the store list', async () => {
    const store = new InMemoryVault()
    const listed = metadata()
    const originalId = listed.id
    vi.spyOn(store, 'list').mockResolvedValue([listed])
    const broker = new FakeVaultBroker(store, new FakeVaultClock())
    const req = pendingApproval(
      await broker.request(requester(), listed.handle, use(), { tainted: false, reasons: [] }),
    )
    listed.id = '0'.repeat(32)
    req.item.id = listed.id
    const result = await broker.answer(
      { hostId: req.requester.hostId, processId: 100, userId: 'test-user', ui: true },
      { requestId: req.id, digest: req.digest, decision: 'allowOnce' },
    )
    expect(result).toMatchObject({ kind: 'ticket', ticket: { itemId: originalId } })
  })

  it('broker fake hides private items and refuses absent handles', async () => {
    const store = new InMemoryVault()
    const hidden = item()
    hidden.metadata.hidden = true
    await store.write(hidden)
    const broker = new FakeVaultBroker(store, new FakeVaultClock())
    expect(await broker.list(requester())).toEqual([])
    await expect(
      broker.request(requester(), hidden.metadata.handle, use(), { tainted: false, reasons: [] }),
    ).rejects.toThrow('unavailable')
  })

  it('RFC 9987 pair supports identities and signing with and without session-bind', () => {
    const server = new FakeSshServer()
    const client = new FakeSshClient(server)
    expect(client.identities()[0]?.[4]).toBe(12)
    expect(client.sign(randomBytes(32))[0]?.[4]).toBe(5)
    expect(client.bind(randomBytes(32))[0]?.[4]).toBe(6)
    expect(client.sign(randomBytes(32))[0]?.[4]).toBe(14)
    expect(client.bind(randomBytes(32))[0]?.[4]).toBe(5)
    const unbound = new FakeSshClient(new FakeSshServer(true))
    expect(unbound.sign(randomBytes(32))[0]?.[4]).toBe(14)
  })

  it('SSH fake refuses corrupted binding signatures and ungranted forwarding', () => {
    const corrupt = new FakeSshClient(new FakeSshServer())
    expect(corrupt.bind(randomBytes(32), false, true)[0]?.[4]).toBe(5)
    expect(corrupt.sign(randomBytes(32))[0]?.[4]).toBe(5)
    const forwarded = new FakeSshClient(new FakeSshServer())
    expect(forwarded.bind(randomBytes(32), true)[0]?.[4]).toBe(6)
    expect(forwarded.sign(randomBytes(32))[0]?.[4]).toBe(5)
    const allowed = new FakeSshClient(new FakeSshServer(false, true))
    allowed.bind(randomBytes(32), true)
    expect(allowed.sign(randomBytes(32))[0]?.[4]).toBe(14)
  })

  it('SSH framing handles split and coalesced frames and refuses oversized frames', () => {
    const server = new FakeSshServer()
    const frame = server.bindFrame(randomBytes(32))
    expect(server.receive(frame.subarray(0, 2))).toEqual([])
    expect(server.receive(frame.subarray(2))[0]?.[4]).toBe(6)
    expect(server.receive(Buffer.from([0, 0, 0, 1, 11, 0, 0, 0, 1, 11]))).toHaveLength(2)
    expect(() => new FakeSshServer().receive(Buffer.from([255, 255, 255, 255]))).toThrow(
      'invalid frame',
    )
    expect(() => new FakeSshServer().receive(Buffer.alloc(4))).toThrow('invalid frame')
  })

  it('SSH fake refuses malformed fields, flags and identity requests', () => {
    function packet(type: number, payload: Buffer): Buffer {
      const bytes = Buffer.concat([Buffer.from([type]), payload])
      const length = Buffer.alloc(4)
      length.writeUInt32BE(bytes.length)
      return Buffer.concat([length, bytes])
    }
    const session = randomBytes(32)
    const server = new FakeSshServer()
    const binding = server.bindFrame(session)
    const extensionEnd = 9 + binding.readUInt32BE(5)
    const hostEnd = extensionEnd + 4 + binding.readUInt32BE(extensionEnd)
    const sessionEnd = hostEnd + 4 + binding.readUInt32BE(hostEnd)
    const signatureStart = sessionEnd + 4
    const variants = [
      packet(11, Buffer.from([0])),
      packet(27, Buffer.from([0])),
      packet(27, Buffer.from([0, 0, 0, 100, 1])),
      packet(99, Buffer.alloc(0)),
    ]
    for (const offset of [9, extensionEnd + 4, signatureStart + 4, binding.length - 1]) {
      const changed = Buffer.from(binding)
      changed[offset] = 2
      variants.push(changed)
    }
    variants.push(packet(27, Buffer.concat([binding.subarray(5), Buffer.from([0])])))
    for (const malformed of variants) expect(server.receive(malformed)[0]?.[4]).toBe(5)

    const signer = new FakeSshServer(true)
    const key = signer.publicBlob
    const keyLength = Buffer.alloc(4)
    keyLength.writeUInt32BE(key.length)
    const signPayload = Buffer.concat([keyLength, key, Buffer.alloc(4), Buffer.alloc(4)])
    expect(signer.receive(packet(13, signPayload))[0]?.[4]).toBe(14)
    const wrongKey = Buffer.from(signPayload)
    wrongKey[4] = 2
    const wrongFlags = Buffer.from(signPayload)
    wrongFlags.writeUInt32BE(1, wrongFlags.length - 4)
    for (const malformed of [wrongKey, wrongFlags, Buffer.concat([signPayload, Buffer.from([0])])])
      expect(signer.receive(packet(13, malformed))[0]?.[4]).toBe(5)
  })

  it('V15: sudo fake records exact -S -k argv and refuses swaps', () => {
    const sudo = new FakeSudo()
    const target: Extract<VaultUse, { kind: 'sudo' }> = {
      kind: 'sudo',
      command: use().command,
      sudoPath: '/usr/bin/sudo',
    }
    const digest = vaultUseDigest(target)
    sudo.run(target, digest, randomBytes(32))
    expect(sudo.runs[0]?.argv).toEqual(['-S', '-k', '-p', '', '--', '/usr/bin/tool', '--check'])
    expect(() => {
      sudo.run({ ...target, sudoPath: '/bad/sudo' }, digest, randomBytes(32))
    }).toThrow('changed')
    expect(() => {
      sudo.run({ ...target, command: { ...target.command, cwd: '/bad' } }, digest, randomBytes(32))
    }).toThrow('changed')
    sudo.cached = true
    sudo.clear()
    expect(sudo.cached).toBe(false)
  })

  it('git fake returns an ephemeral descriptor only for its exact scope and never stores', () => {
    const scope = { protocol: 'https', host: 'example.test', path: 'owner/repo' }
    const git = new FakeGit(scope)
    expect(git.get('get', scope)).toEqual({ ephemeral: true, password_expiry_utc: 1_000_000 })
    expect(git.get('store', scope)).toBeNull()
    expect(git.get('erase', scope)).toBeNull()
    for (const changed of [
      { ...scope, protocol: 'http' },
      { ...scope, host: 'outside.test' },
      { ...scope, path: 'other/repo' },
    ])
      expect(git.get('get', changed)).toBeNull()
    expect(git.operations).toHaveLength(6)
  })

  it('V14: CDP fake refuses changed live facts and never reads back a password', () => {
    const use: Extract<VaultUse, { kind: 'fill' }> = {
      kind: 'fill',
      origin: 'https://example.test',
      topOrigin: 'https://example.test',
      frameOrigin: 'https://example.test',
      frameId: 'frame',
      browserId: 'a'.repeat(32),
      certificateValid: true,
      field: 'password',
    }
    const good = new FakeCdpTarget(use.origin)
    good.insert(use, randomBytes(32))
    expect(good.inserted).toEqual([32])
    expect(() => good.readPassword()).toThrow('forbidden')
    for (const target of [
      new FakeCdpTarget('https://outside.test'),
      new FakeCdpTarget('https://outside.test', use.frameOrigin),
      new FakeCdpTarget(use.origin, 'https://outside.test'),
      new FakeCdpTarget(use.origin, use.origin, false),
      new FakeCdpTarget(use.origin, use.origin, true, 'text'),
    ])
      expect(() => {
        target.insert(use, randomBytes(32))
      }).toThrow('changed')
    const insecureOrigin = new URL(use.origin)
    insecureOrigin.protocol = 'http:'
    const insecure = { ...use, origin: insecureOrigin.origin, frameOrigin: insecureOrigin.origin }
    expect(() => {
      new FakeCdpTarget(insecure.origin).insert(insecure, randomBytes(32))
    }).toThrow('changed')
  })
})
