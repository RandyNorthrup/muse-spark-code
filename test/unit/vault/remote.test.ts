import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VaultRemoteOwner,
  hasConsumedVaultRemoteUse,
  vaultRemoteResponseSchema,
  type VaultRemotePorts,
  type VaultRemoteChannelPort,
  type VaultRemoteApprovalCard,
  type VaultRemoteConsumerPorts,
} from '../../../src/core/vault/remote'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { vaultRemoteRequestSchema } from '../../../src/shared/vaultProtocol'
import { type VaultUse } from '../../../src/shared/vault'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { brokerFixture } from './brokerFixture'
import { requester, use as environmentUse } from '../helpers/vault/fixtures'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup(kind: 'ssh' | 'totp' = 'ssh') {
  const f = await brokerFixture()
  const session = randomBytes(32).toString('base64'),
    hostKeyFingerprint = `SHA256:${randomBytes(32).toString('base64').replaceAll('=', '')}`
  const actual: VaultUse =
    kind === 'ssh'
      ? {
          kind,
          host: 'server.test',
          hostKeyFingerprint,
          remoteUser: 'deploy',
          sessionId: session,
          forwarding: false,
        }
      : { kind, command: environmentUse().command }
  await f.change({
    bindings: [
      kind === 'ssh'
        ? {
            kind,
            host: 'server.test',
            hostKeyFingerprint,
            remoteUser: 'deploy',
            forwarding: false,
          }
        : { kind, commandDigest: vaultCommandDigest(environmentUse().command) },
    ],
    policy: { mode: 'alwaysAllow', unattendedAllowed: false, allowDisclosure: false },
  })
  const remote = vaultRemoteRequestSchema.parse({
    v: 1,
    id: '1'.repeat(32),
    owningDeviceId: '2'.repeat(32),
    use:
      kind === 'ssh'
        ? {
            kind,
            host: 'server.test',
            hostKeyFingerprint,
            remoteUser: 'deploy',
            sessionDigest: createHash('sha256')
              .update(Buffer.from(session, 'base64'))
              .digest('hex'),
            forwarding: false,
          }
        : { kind, origin: 'https://login.test' },
  })
  const who = {
    ...requester(),
    taskId: 'remote-task',
    deviceId: '3'.repeat(32),
    source: 'device' as const,
  }
  const identity = {
    pinnedMutualTls: true as const,
    owningDeviceId: remote.owningDeviceId,
    deviceId: who.deviceId,
    requester: who,
  }
  const frames: ReturnType<typeof vaultRemoteResponseSchema.parse>[] = []
  const closeListeners = new Set<() => void>()
  const channel: VaultRemoteChannelPort = {
    authenticate: vi.fn<VaultRemoteChannelPort['authenticate']>(() =>
      Promise.resolve(structuredClone(identity)),
    ),
    subscribeClose: (listener) => {
      closeListeners.add(listener)
      return () => {
        closeListeners.delete(listener)
      }
    },
    send: vi.fn((frame) => {
      frames.push(vaultRemoteResponseSchema.parse(frame))
    }),
  }
  const buffers: Uint8Array[] = [],
    cards: VaultRemoteApprovalCard[] = []
  const ports: VaultRemotePorts = {
    owningDeviceId: remote.owningDeviceId,
    peer: f.peer,
    broker: f.broker,
    select: vi.fn(() => Promise.resolve(f.stored.metadata.handle)),
    resolve: vi.fn(() => Promise.resolve(structuredClone(actual))),
    approve: vi.fn<VaultRemotePorts['approve']>((card) => {
      cards.push(structuredClone(card))
      return Promise.resolve({
        requestId: card.request.id,
        digest: card.digest,
        decision: 'allowOnce',
      })
    }),
    execute: vi.fn<VaultRemotePorts['execute']>((_ticket, _use, _remote, _signal, canRelease) => {
      if (!canRelease()) throw new Error('broker release refused')
      const bytes = kind === 'ssh' ? randomBytes(64) : Buffer.from('123456')
      buffers.push(bytes)
      return Promise.resolve(bytes)
    }),
  }
  const owner = new VaultRemoteOwner(ports)
  cleanups.push(async () => {
    await owner.dispose()
    await f.broker.dispose()
  })
  return {
    ...f,
    owner,
    ports,
    remote,
    identity,
    frames,
    cards,
    buffers,
    actual,
    channel,
    disconnect: () => {
      for (const listener of closeListeners) listener()
    },
  }
}
describe('M109 R remote owner-side uses', () => {
  it('V10 V13: a changed resolved SSH host/user is refused before broker registration', async () => {
    const f = await setup(),
      register = vi.spyOn(f.broker, 'register')
    if (f.actual.kind === 'ssh') f.actual.host = 'outside.test'
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('denied')
    expect(register).not.toHaveBeenCalled()
    expect(f.ports.approve).not.toHaveBeenCalled()
  })
  it('V10: a non-UI owner peer cannot start local consent or execution', async () => {
    const f = await setup()
    f.ports.peer = { ...f.peer, ui: false }
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('denied')
    expect(f.ports.select).not.toHaveBeenCalled()
  })
  it('V11: replay saturation refuses admission instead of evicting prior request ids', async () => {
    const f = await setup()
    Object.defineProperty(f.owner, 'seen', {
      value: new Set(Array.from({ length: VAULT_LIMITS.items }, (_, index) => String(index))),
    })
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('denied')
    expect(f.ports.select).not.toHaveBeenCalled()
  })
  it('V10: receiver privately consumes only bound kind/id on pinned channel and wipes sink bytes', async () => {
    const f = await setup('totp'),
      sink: Uint8Array[] = []
    const ports: VaultRemoteConsumerPorts = {
      requester: f.identity.requester,
      authenticate: vi.fn<VaultRemoteConsumerPorts['authenticate']>(() =>
        Promise.resolve({ pinnedMutualTls: true, owningDeviceId: f.remote.owningDeviceId }),
      ),
      subscribeClose: f.channel.subscribeClose,
      exchange: vi.fn(() =>
        Promise.resolve({ v: 1, id: f.remote.id, result: { kind: 'code', code: '123456' } }),
      ),
      deliver: vi.fn<VaultRemoteConsumerPorts['deliver']>((_kind, bytes, _request, canDeliver) => {
        expect(canDeliver()).toBe(true)
        sink.push(bytes)
        return Promise.resolve()
      }),
    }
    const signal = new AbortController().signal
    expect(await hasConsumedVaultRemoteUse(f.remote, ports, signal)).toBe(true)
    expect(sink[0]?.every((value) => value === 0)).toBe(true)
    ports.exchange = vi.fn(() =>
      Promise.resolve({ v: 1, id: 'f'.repeat(32), result: { kind: 'code', code: '123456' } }),
    )
    expect(await hasConsumedVaultRemoteUse(f.remote, ports, signal)).toBe(false)
    ports.exchange = vi.fn(() =>
      Promise.resolve({ v: 1, id: f.remote.id, result: { kind: 'signature', signature: 'AA==' } }),
    )
    expect(await hasConsumedVaultRemoteUse(f.remote, ports, signal)).toBe(false)
    ports.requester.unattended = true
    expect(await hasConsumedVaultRemoteUse(f.remote, ports, signal)).toBe(false)
    expect(ports.deliver).toHaveBeenCalledOnce()
  })
  it('V10 V16: receiver disconnect before private write refuses delivery and wipes retained bytes', async () => {
    const f = await setup(),
      entered = Promise.withResolvers<undefined>(),
      go = Promise.withResolvers<undefined>()
    let held: Uint8Array | undefined, canDeliver: (() => boolean) | undefined
    const ports: VaultRemoteConsumerPorts = {
      requester: f.identity.requester,
      authenticate: () =>
        Promise.resolve({ pinnedMutualTls: true, owningDeviceId: f.remote.owningDeviceId }),
      subscribeClose: f.channel.subscribeClose,
      exchange: () =>
        Promise.resolve({
          v: 1,
          id: f.remote.id,
          result: { kind: 'signature', signature: randomBytes(64).toString('base64') },
        }),
      deliver: async (_kind, bytes, _request, canWrite) => {
        held = bytes
        canDeliver = canWrite
        entered.resolve(undefined)
        await go.promise
      },
    }
    const pending = hasConsumedVaultRemoteUse(f.remote, ports, new AbortController().signal)
    await entered.promise
    f.disconnect()
    expect(canDeliver?.()).toBe(false)
    go.resolve(undefined)
    expect(await pending).toBe(false)
    expect(held?.every((value) => value === 0)).toBe(true)
  })
  it.each(['ssh', 'totp'] as const)(
    'V10: %s requires local choice and fresh approval on every use; only capability crosses',
    async (kind) => {
      const f = await setup(kind)
      await f.owner.serve(f.channel, f.remote)
      await f.owner.serve(f.channel, { ...f.remote, id: '4'.repeat(32) })
      expect(f.ports.select).toHaveBeenCalledTimes(2)
      expect(f.ports.approve).toHaveBeenCalledTimes(2)
      expect(f.ports.execute).toHaveBeenCalledTimes(2)
      expect(f.frames.map((frame) => frame.result.kind)).toEqual([
        kind === 'ssh' ? 'signature' : 'code',
        kind === 'ssh' ? 'signature' : 'code',
      ])
      for (const frame of f.frames) {
        expect(Object.keys(frame).toSorted((a, b) => a.localeCompare(b))).toEqual([
          'id',
          'result',
          'v',
        ])
        expect(JSON.stringify(frame)).not.toContain('secret://')
        for (const name of ['requester', 'item', 'grant', 'ticket', 'nonce', 'seed', 'privateKey'])
          expect(JSON.stringify(frame)).not.toContain(name)
      }
      for (const bytes of f.buffers) expect(bytes.every((value) => value === 0)).toBe(true)
      expect(f.cards[0]?.remote).toEqual(f.remote)
      expect(f.cards[0]?.request.taint.tainted).toBe(true)
    },
  )
  it('V10: strict device request/response shapes refuse env, items, grants, approvals and extra values', async () => {
    const f = await setup()
    for (const field of ['item', 'grant', 'approval', 'value', 'handle', 'unattended'])
      await expect(
        f.owner.serve(f.channel, { ...f.remote, [field]: randomBytes(32).toString('base64') }),
      ).rejects.toThrow()
    await expect(f.owner.serve(f.channel, { ...f.remote, use: environmentUse() })).rejects.toThrow()
    expect(f.ports.select).not.toHaveBeenCalled()
    for (const field of ['item', 'grant', 'ticket', 'value'])
      expect(
        vaultRemoteResponseSchema.safeParse({
          v: 1,
          id: f.remote.id,
          result: { kind: 'code', code: '123456', [field]: 'forbidden' },
        }).success,
      ).toBe(false)
  })
  it.each(['unpinned', 'wrongOwner', 'wrongDevice', 'unattended'] as const)(
    'V10 V12 V13: %s identity fails before local selection or canAdmit',
    async (change) => {
      const f = await setup()
      switch (change) {
        case 'unpinned': {
          Object.assign(f.identity, { pinnedMutualTls: false })
          break
        }
        case 'wrongOwner': {
          f.remote.owningDeviceId = 'f'.repeat(32)
          break
        }
        case 'wrongDevice': {
          f.identity.requester.deviceId = 'f'.repeat(32)
          break
        }
        case 'unattended': {
          {
            f.identity.requester.unattended = true
            // No default
          }
          break
        }
      }
      await f.owner.serve(f.channel, f.remote)
      expect(f.frames).toEqual([{ v: 1, id: f.remote.id, result: { kind: 'denied' } }])
      expect(f.ports.select).not.toHaveBeenCalled()
      expect(f.ports.execute).not.toHaveBeenCalled()
    },
  )
  it('V11: replay is refused and consumes no additional approval or use', async () => {
    const f = await setup()
    await f.owner.serve(f.channel, f.remote)
    await f.owner.serve(f.channel, structuredClone(f.remote))
    expect(f.frames[1]?.result.kind).toBe('denied')
    expect(f.ports.execute).toHaveBeenCalledOnce()
    expect(f.ports.approve).toHaveBeenCalledOnce()
  })
  it('V10: changed SSH host/session and remote forwarding are refused', async () => {
    const f = await setup()
    if (f.remote.use.kind === 'ssh') f.remote.use.sessionDigest = 'f'.repeat(64)
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('denied')
    expect(f.ports.approve).not.toHaveBeenCalled()
    if (f.remote.use.kind === 'ssh')
      await expect(
        f.owner.serve(f.channel, { ...f.remote, use: { ...f.remote.use, forwarding: true } }),
      ).rejects.toThrow()
  })
  it.each(['digest', 'id', 'session', 'expiry', 'deny'] as const)(
    'V11: %s answer cannot release remote capability',
    async (change) => {
      const f = await setup()
      const answer = vi.spyOn(f.broker, 'answer')
      f.ports.approve = vi.fn<typeof f.ports.approve>((card) => {
        if (change === 'expiry') f.clock.advance(120_000)
        let decision = 'allowOnce'
        if (change === 'session') decision = 'allowSession'
        else if (change === 'deny') decision = 'deny'
        return Promise.resolve({
          requestId: change === 'id' ? 'f'.repeat(32) : card.request.id,
          digest: change === 'digest' ? 'f'.repeat(64) : card.digest,
          decision,
        })
      })
      await f.owner.serve(f.channel, f.remote)
      expect(f.frames[0]?.result.kind).toBe('denied')
      expect(f.ports.execute).not.toHaveBeenCalled()
      if (change !== 'deny') expect(answer).not.toHaveBeenCalled()
    },
  )
  it('V10 V11: remote origin participates in local card digest; editing display snapshot changes no authority', async () => {
    const f = await setup('totp')
    f.ports.approve = vi.fn<typeof f.ports.approve>((card) => {
      const digest = card.digest
      if (card.remote.use.kind === 'totp') card.remote.use.origin = 'https://outside.test'
      card.request.requester.deviceId = 'f'.repeat(32)
      return Promise.resolve({ requestId: card.request.id, digest, decision: 'allowOnce' })
    })
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('code')
    expect(vi.mocked(f.ports.execute).mock.calls[0]?.[2]).toEqual(f.remote)
    expect(f.remote.use.kind === 'totp' && f.remote.use.origin).toBe('https://login.test')
  })
  it.each(['lock', 'disconnect', 'dispose'] as const)(
    'V7 V10 V16: %s invalidates pending release and wipes late bytes',
    async (change) => {
      const f = await setup()
      const entered = Promise.withResolvers<undefined>(),
        waiting = Promise.withResolvers<Uint8Array>()
      f.ports.execute = vi.fn<typeof f.ports.execute>(() => {
        entered.resolve(undefined)
        return waiting.promise
      })
      const pending = f.owner.serve(f.channel, f.remote)
      await entered.promise
      if (change === 'lock') await f.broker.lock()
      else if (change === 'disconnect') f.disconnect()
      else await f.owner.dispose()
      const bytes = randomBytes(64)
      waiting.resolve(bytes)
      await pending
      expect(f.frames.every((frame) => frame.result.kind === 'denied')).toBe(true)
      expect(bytes.every((value) => value === 0)).toBe(true)
    },
  )
  it('V7: malformed output and throwing transport still wipe owned capability bytes', async () => {
    const f = await setup('totp')
    const bytes = Buffer.from([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6])
    f.ports.execute = vi.fn<typeof f.ports.execute>(() => Promise.resolve(bytes))
    await f.owner.serve(f.channel, f.remote)
    expect(f.frames[0]?.result.kind).toBe('denied')
    expect(bytes.every((value) => value === 0)).toBe(true)
    const next = await setup()
    next.channel.send = vi.fn(() => {
      throw new Error('transport unavailable')
    })
    await expect(next.owner.serve(next.channel, next.remote)).rejects.toThrow()
    expect(next.buffers.every((buffer) => buffer.every((value) => value === 0))).toBe(true)
  })
})
