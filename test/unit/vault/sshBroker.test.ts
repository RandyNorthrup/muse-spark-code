import { afterEach, describe, it, expect, vi } from 'vitest'
import { type VaultBroker } from '../../../src/core/vault/broker/broker'
import { brokerSshAccess, type SshApprovalPort } from '../../../src/core/vault/ssh/brokerAccess'
import { type SshHardwarePort } from '../../../src/core/vault/ssh/ports'
import {
  generateEd25519Key,
  signSshData,
  isSshSignatureValid,
  publicBlob,
  importSshKey,
} from '../../../src/core/vault/ssh/keys'
import { generateKeyPairSync } from 'node:crypto'
import { generateHardwareSshKey } from '../../../src/core/vault/ssh/hardwareKey'
import { type VaultUse, type VaultItem, type VaultGrant } from '../../../src/shared/vault'
import { requester, grant } from '../helpers/vault/fixtures'
import { brokerFixture, cleanTaint } from './brokerFixture'

const brokers: VaultBroker[] = []
const secrets: Buffer[] = []
afterEach(async () => {
  try {
    for (const broker of brokers.splice(0)) await broker.dispose()
  } finally {
    for (const secret of secrets.splice(0)) secret.fill(0)
  }
})
async function setup() {
  const f = await brokerFixture()
  brokers.push(f.broker)
  const key = generateEd25519Key()
  secrets.push(key.privateKey)
  const blob = Buffer.from(key.publicKey.split(' ', 2)[1] ?? '', 'base64')
  const use: Extract<VaultUse, { kind: 'ssh' }> = {
    kind: 'ssh',
    host: 'host.example',
    hostKeyFingerprint: key.fingerprint,
    remoteUser: 'deploy',
    sessionId: Buffer.from('session').toString('base64'),
    forwarding: false,
  }
  const item: VaultItem = {
    metadata: {
      ...f.stored.metadata,
      kind: 'sshKey',
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      bindings: [
        {
          kind: 'ssh',
          host: use.host,
          hostKeyFingerprint: key.fingerprint,
          remoteUser: use.remoteUser,
          forwarding: false,
        },
      ],
      policy: { ...f.stored.metadata.policy, mode: 'askEveryTime' },
    },
    material: {
      kind: 'sshKey',
      storage: 'software',
      privateKey: key.privateKey,
      algorithm: 'ed25519',
    },
  }
  f.items.set(item.metadata.id, item)
  await f.broker.lock()
  await f.broker.unlock()
  await f.broker.endRequester(requester().id)
  const connection = f.broker.beginConnection(),
    registration = await f.broker.registerOnConnection(f.peer, requester(), 'ask', connection)
  const hardware: SshHardwarePort = {
    generate: vi.fn(() => Promise.reject(new Error('test hardware unavailable'))),
    destroy: vi.fn(() => Promise.resolve()),
    sign: vi.fn(() => Promise.reject(new Error('test hardware unavailable'))),
  }
  const approvals = {
    wait: vi.fn((request: Parameters<SshApprovalPort['wait']>[0]) =>
      f.broker.answer(f.peer, {
        requestId: request.id,
        digest: request.digest,
        decision: 'allowOnce',
      }),
    ),
  }
  const access = brokerSshAccess({
    broker: f.broker,
    requester: requester(),
    registration,
    taint: () => Promise.resolve(cleanTaint),
    approvals,
    hardware,
  })
  const signal = new AbortController().signal
  const [identity] = await access.identities(signal)
  if (!identity) throw new Error('missing generated identity')
  return { ...f, key, blob, use, identity, access, approvals, hardware, registration, signal }
}

describe('SSH access through the real vault broker', () => {
  it('refuses substituted approval tickets and finishes their broker operations as denied', async () => {
    for (const field of ['digest', 'requesterId', 'itemId']) {
      const f = await setup(),
        finish = vi.spyOn(f.broker, 'finish')
      f.approvals.wait.mockImplementation(async (request) => {
        const result = await f.broker.answer(f.peer, {
          requestId: request.id,
          digest: request.digest,
          decision: 'allowOnce',
        })
        if (result.kind !== 'ticket') return result
        return {
          ...result,
          ticket: {
            ...result.ticket,
            [field]: field === 'digest' ? 'a'.repeat(64) : 'f'.repeat(32),
          },
        }
      })
      await expect(f.access.authorize(f.identity, f.use, f.signal)).rejects.toThrow()
      expect(finish).toHaveBeenCalledWith(expect.any(String), false)
    }
  })
  it('gets authenticated UI approval, consumes one ticket, signs without exposing material and audits success', async () => {
    const f = await setup(),
      ticket = await f.access.authorize(f.identity, f.use, f.signal),
      data = Buffer.from('generated-data'),
      release = vi.fn<(signature: Buffer) => void>()
    let observed: Buffer | undefined
    release.mockImplementation((signature) => {
      observed = Buffer.from(signature)
    })
    const lifetime = { close: vi.fn(), terminate: () => Promise.resolve(true) }
    await f.access.sign(f.identity, ticket, f.use, data, 0, lifetime, f.signal, release, [])
    expect(release).toHaveBeenCalledOnce()
    expect(f.approvals.wait).toHaveBeenCalledOnce()
    expect(isSshSignatureValid(f.blob, data, observed ?? Buffer.alloc(0))).toBe(true)
    expect(
      f.records.some((record) => record.kind === 'ssh' && record.outcome === 'succeeded'),
    ).toBe(true)
    expect(JSON.stringify(f.records)).not.toContain(f.key.privateKey.toString('base64'))
    await expect(
      f.access.sign(f.identity, ticket, f.use, data, 0, lifetime, f.signal, release, []),
    ).rejects.toThrow()
  })
  it('refuses changed host/user and stripped session-bind without an explicit any-host grant', async () => {
    const f = await setup()
    await expect(
      f.access.authorize(f.identity, { ...f.use, remoteUser: 'root' }, f.signal),
    ).rejects.toThrow()
    await expect(
      f.access.authorize(f.identity, { ...f.use, host: 'other.example' }, f.signal),
    ).rejects.toThrow()
    await expect(
      f.access.authorize(
        f.identity,
        { ...f.use, hostKeyFingerprint: null, sessionId: null },
        f.signal,
      ),
    ).rejects.toThrow()
    expect(f.hardware.sign).not.toHaveBeenCalled()
  })
  it('requires a grant for unproven destinations and forwarding even after an Allow once answer', async () => {
    const f = await setup()
    const item = f.items.get(f.identity.item.id)
    if (!item) throw new Error('missing test item')
    item.metadata.bindings = [{ kind: 'sshAnyHost', remoteUser: 'deploy', forwarding: true }]
    await f.broker.lock()
    await f.broker.unlock()
    const unknown = { ...f.use, host: 'unproven', hostKeyFingerprint: null, sessionId: null }
    await expect(f.access.authorize(f.identity, unknown, f.signal)).rejects.toThrow()
    await expect(
      f.access.authorize(f.identity, { ...f.use, forwarding: true }, f.signal),
    ).rejects.toThrow()
    item.metadata.policy.mode = 'alwaysAllow'
    const standing: VaultGrant = {
      ...grant(),
      itemId: item.metadata.id,
      target: { kind: 'sshAnyHost', remoteUser: 'deploy', forwarding: true },
      maxUses: 2,
    }
    f.grants.set(standing.id, standing)
    await f.broker.lock()
    await f.broker.unlock()
    expect(await f.access.authorize(f.identity, unknown, f.signal)).toMatchObject({
      itemId: item.metadata.id,
    })
    expect(
      await f.access.authorize(f.identity, { ...f.use, forwarding: true }, f.signal),
    ).toMatchObject({ itemId: item.metadata.id })
  })
  it('revocation closes the current requester, terminates its pinned peer and blocks the next signature', async () => {
    const f = await setup(),
      close = vi.fn(),
      unsubscribe = f.access.subscribeInvalidation(close),
      ticket = await f.access.authorize(f.identity, f.use, f.signal)
    await f.broker.endRequester(requester().id)
    expect(close).toHaveBeenCalledOnce()
    unsubscribe()
    const release = vi.fn<(signature: Buffer) => void>()
    await expect(
      f.access.sign(
        f.identity,
        ticket,
        f.use,
        Buffer.from('data'),
        0,
        { close: vi.fn(), terminate: () => Promise.resolve(true) },
        f.signal,
        release,
        [],
      ),
    ).rejects.toThrow()
    expect(release).not.toHaveBeenCalled()
  })
  it('fronts an external key through the same authorization and wipes the upstream signature', async () => {
    const f = await setup(),
      raw = signSshData(f.key.privateKey, f.blob, Buffer.from('data'), 0)
    const external = {
      identities: () => Promise.resolve([{ ...f.identity, source: 'external' as const }]),
      sign: vi.fn(() => Promise.resolve(raw)),
    }
    const access = brokerSshAccess({
      broker: f.broker,
      requester: requester(),
      registration: f.registration,
      taint: () => Promise.resolve(cleanTaint),
      approvals: f.approvals,
      hardware: f.hardware,
      external,
    })
    const identity = { ...f.identity, source: 'external' as const },
      ticket = await access.authorize(identity, f.use, f.signal),
      release = vi.fn<(signature: Buffer) => void>()
    await access.sign(
      identity,
      ticket,
      f.use,
      Buffer.from('data'),
      0,
      { close: vi.fn(), terminate: () => Promise.resolve(true) },
      f.signal,
      release,
      [],
    )
    expect(release).toHaveBeenCalledOnce()
    expect(raw.every((byte) => byte === 0)).toBe(true)
  })
  it('a cancelled taint lookup never mints a request or acquires key material', async () => {
    const f = await setup(),
      taint = Promise.withResolvers<typeof cleanTaint>(),
      controller = new AbortController()
    const request = vi.spyOn(f.broker, 'request')
    const access = brokerSshAccess({
      broker: f.broker,
      requester: requester(),
      registration: f.registration,
      taint: () => taint.promise,
      approvals: f.approvals,
      hardware: f.hardware,
    })
    const pending = access.authorize(f.identity, f.use, controller.signal)
    controller.abort()
    taint.resolve(cleanTaint)
    await expect(pending).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('hardware generation rejects non-P256 and disposes a late/cancelled reference', async () => {
    const f = await setup(),
      controller = new AbortController()
    f.hardware.generate = vi.fn<SshHardwarePort['generate']>(() =>
      Promise.resolve({ keyReference: 'generated-ref', publicBlob: f.blob }),
    )
    await expect(generateHardwareSshKey(f.hardware, controller.signal)).rejects.toThrow()
    expect(f.hardware.destroy).toHaveBeenCalledWith('generated-ref')
    controller.abort()
    await expect(generateHardwareSshKey(f.hardware, controller.signal)).rejects.toThrow()
    expect(f.hardware.generate).toHaveBeenCalledOnce()
  })
  it('returns a P256 hardware reference and destroys a valid late acquisition after cancellation', async () => {
    const f = await setup(),
      curve = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
      blob = publicBlob(curve.publicKey),
      controller = new AbortController()
    f.hardware.generate = () => Promise.resolve({ keyReference: 'resident-key', publicBlob: blob })
    expect(await generateHardwareSshKey(f.hardware, controller.signal)).toMatchObject({
      algorithm: 'ecdsa-p256',
      keyReference: 'resident-key',
      publicKey: `ecdsa-sha2-nistp256 ${blob.toString('base64')}`,
    })
    expect(f.hardware.destroy).not.toHaveBeenCalled()
    const pending = Promise.withResolvers<Awaited<ReturnType<SshHardwarePort['generate']>>>()
    f.hardware.generate = () => pending.promise
    const acquisition = generateHardwareSshKey(f.hardware, controller.signal)
    controller.abort()
    pending.resolve({ keyReference: 'late-key', publicBlob: blob })
    await expect(acquisition).rejects.toThrow()
    expect(f.hardware.destroy).toHaveBeenCalledWith('late-key')
  })
  it('signs with hardware through P and refuses/wipes a valid signature completing after lock', async () => {
    const f = await setup(),
      curve = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
      software = importSshKey(
        Buffer.from(curve.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      ),
      blob = publicBlob(curve.publicKey)
    secrets.push(software.privateKey)
    const item = f.items.get(f.identity.item.id)
    if (!item) throw new Error('missing generated item')
    item.metadata.publicKey = software.publicKey
    item.metadata.fingerprint = software.fingerprint
    item.material = {
      kind: 'sshKey',
      storage: 'hardware',
      algorithm: 'ecdsa-p256',
      keyReference: 'resident-key',
    }
    await f.broker.lock()
    await f.broker.unlock()
    const [identity] = await f.access.identities(f.signal)
    if (!identity) throw new Error('missing resident identity')
    f.hardware.sign = (_reference, data) =>
      Promise.resolve(signSshData(software.privateKey, blob, data, 0))
    const data = Buffer.from('hardware-data'),
      release = vi.fn<(signature: Buffer) => void>(),
      controller = new AbortController()
    await f.access.sign(
      identity,
      await f.access.authorize(identity, f.use, f.signal),
      f.use,
      data,
      0,
      { close: vi.fn(), terminate: () => Promise.resolve(true) },
      f.signal,
      release,
      [],
    )
    expect(release).toHaveBeenCalledOnce()
    const result = Promise.withResolvers<Buffer>(),
      entered = Promise.withResolvers<undefined>(),
      raw = signSshData(software.privateKey, blob, data, 0)
    f.hardware.sign = () => {
      entered.resolve(undefined)
      return result.promise
    }
    const ticket = await f.access.authorize(identity, f.use, controller.signal)
    const signing = f.access.sign(
      identity,
      ticket,
      f.use,
      data,
      0,
      {
        close: () => {
          controller.abort()
        },
        terminate: () => Promise.resolve(true),
      },
      controller.signal,
      release,
      [],
    )
    const assertion = expect(signing).rejects.toThrow()
    await entered.promise
    const lock = f.broker.lock()
    result.resolve(raw)
    await assertion
    await lock
    expect(release).toHaveBeenCalledOnce()
    expect(raw.every((byte) => byte === 0)).toBe(true)
  })
  it('fresh presence is requested for each interactive use and failed presence authorizes nothing', async () => {
    const f = await setup(),
      item = f.items.get(f.identity.item.id)
    if (!item) throw new Error('missing generated item')
    item.metadata.requirePresence = true
    await f.broker.lock()
    await f.broker.unlock()
    const release = vi.fn<(signature: Buffer) => void>()
    const sign = async (): Promise<void> => {
      const ticket = await f.access.authorize(f.identity, f.use, f.signal)
      await f.access.sign(
        f.identity,
        ticket,
        f.use,
        Buffer.from('presence-data'),
        0,
        { close: vi.fn(), terminate: () => Promise.resolve(true) },
        f.signal,
        release,
        [],
      )
    }
    for (let index = 0; index < 2; index++) await sign()
    expect(f.deps.unlock.presence).toHaveBeenCalledTimes(2)
    f.deps.unlock.presence = () => Promise.resolve(false)
    await expect(sign()).rejects.toThrow()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('refuses to redeem a ticket after its approval was refused', async () => {
    const f = await setup()
    const requested = await f.broker.request(
      requester(),
      f.identity.item.handle,
      f.use,
      cleanTaint,
      f.registration,
    )
    if (requested.kind !== 'approval') throw new Error('expected an approval request')
    const answered = await f.broker.answer(f.peer, {
      requestId: requested.request.id,
      digest: requested.request.digest,
      decision: 'allowOnce',
    })
    if (answered.kind !== 'ticket') throw new Error('expected an issued ticket')
    // The requester-side checks refuse the ticket (substituted digest path):
    // finishing it as failed must invalidate it, not leave it redeemable.
    await f.broker.finish(answered.ticket.id, false)
    const replayed = await f.broker.redeem(
      requester().id,
      answered.ticket,
      f.use,
      {
        close: () => {
          // The admission under test carries no session resource.
        },
        terminate: () => Promise.resolve(false),
      },
      f.registration,
    )
    expect(replayed.kind).toBe('denied')
  })
  it('hides reviewed external identities under a none ceiling', async () => {
    const f = await setup()
    const externalIdentity = { item: f.identity.item, blob: f.blob, source: 'external' as const }
    const external = {
      identities: vi.fn(() => Promise.resolve([externalIdentity])),
      sign: () => Promise.reject(new Error('unexpected upstream sign')),
    }
    const base = {
      broker: f.broker,
      requester: requester(),
      registration: f.registration,
      taint: () => Promise.resolve(cleanTaint),
      approvals: f.approvals,
      hardware: f.hardware,
      external,
    }
    const ask = brokerSshAccess(base)
    const visible = await ask.identities(f.signal)
    expect(visible.some((identity) => identity.source === 'external')).toBe(true)
    const none = brokerSshAccess({ ...base, ceiling: 'none' })
    const hidden = await none.identities(f.signal)
    expect(hidden.some((identity) => identity.source === 'external')).toBe(false)
    // The none ceiling never reaches the upstream agent at all.
    expect(external.identities).toHaveBeenCalledOnce()
  })
})
