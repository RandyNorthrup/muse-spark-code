import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { SSH, SshReader, sshFrame, sshString } from '../../../src/core/vault/ssh/wire'
import {
  publicBlob,
  isSshSignatureValid,
  sshFingerprint,
  signSshData,
} from '../../../src/core/vault/ssh/keys'
import { sshFixture } from './sshFixture'
import { type SshAccessPort } from '../../../src/core/vault/ssh/ports'
import { VAULT_LIMITS } from '../../../src/shared/constants'

const data = (namespace: string, hash = 'sha256', length = 32) =>
  Buffer.concat([
    Buffer.from('SSHSIG'),
    sshString(namespace),
    sshString(''),
    sshString(hash),
    sshString(Buffer.alloc(length)),
  ])
describe('vault SSH agent destination proofs', () => {
  it('bounds bind chains and session ids and validates listed identity metadata', async () => {
    const f = sshFixture()
    try {
      f.session.receive(
        Buffer.concat([
          f.bind(f.hostBlob, Buffer.alloc(0)),
          f.bind(f.hostBlob, Buffer.alloc(VAULT_LIMITS.text + 1)),
          ...Array.from({ length: VAULT_LIMITS.names + 1 }, (_, index) =>
            f.bind(f.hostBlob, Buffer.from(String(index)), true),
          ),
        ]),
      )
      await f.session.drained()
      expect(f.replies.slice(0, 2).map((reply) => reply[4])).toEqual([SSH.failure, SSH.failure])
      expect(f.replies.slice(2, -1).every((reply) => reply[4] === SSH.success)).toBe(true)
      expect(f.replies.at(-1)?.[4]).toBe(SSH.failure)
    } finally {
      f.dispose()
    }
    for (const field of ['fingerprint', 'publicKey', 'count']) {
      const invalid = sshFixture()
      try {
        if (field === 'fingerprint')
          invalid.identity.item.fingerprint = sshFingerprint(invalid.hostBlob)
        else if (field === 'publicKey')
          invalid.identity.item.publicKey = `ssh-ed25519 ${invalid.hostBlob.toString('base64')}`
        else
          invalid.access.identities = () =>
            Promise.resolve(Array.from({ length: VAULT_LIMITS.items + 1 }, () => invalid.identity))
        invalid.session.receive(sshFrame(SSH.identities))
        await invalid.session.drained()
        expect(invalid.replies.at(-1)?.[4]).toBe(SSH.failure)
      } finally {
        invalid.dispose()
      }
    }
  })
  it('refuses a valid but unknown host bind and a duplicate forwarding session', async () => {
    const f = sshFixture()
    try {
      f.setKnown('')
      f.session.receive(f.bind())
      await f.session.drained()
      expect(f.replies.at(-1)?.[4]).toBe(SSH.failure)
      f.setKnown(`host.example ssh-ed25519 ${f.hostBlob.toString('base64')}`)
      f.session.receive(
        Buffer.concat([
          f.bind(f.hostBlob, f.sessionId, true),
          f.bind(f.hostBlob, f.sessionId, true),
        ]),
      )
      await f.session.drained()
      expect(f.replies.slice(1).map((reply) => reply[4])).toEqual([SSH.success, SSH.failure])
    } finally {
      f.dispose()
    }
  })
  it('rejects wrong service, method, algorithm and an unsigned authentication probe', async () => {
    const f = sshFixture()
    try {
      f.session.receive(f.bind())
      await f.session.drained()
      for (const change of [
        { service: 'other' },
        { method: 'other' },
        { algorithm: 'other' },
        { signed: 0 },
        { packet: 0 },
      ]) {
        const fields = {
          service: 'ssh-connection',
          method: 'publickey',
          algorithm: 'ssh-ed25519',
          signed: 1,
          packet: SSH.userauth,
          ...change,
        }
        const data = Buffer.concat([
          sshString(f.sessionId),
          Buffer.from([fields.packet]),
          sshString('deploy'),
          sshString(fields.service),
          sshString(fields.method),
          Buffer.from([fields.signed]),
          sshString(fields.algorithm),
          sshString(f.blob),
        ])
        f.session.receive(f.signFrame(data))
      }
      await f.session.drained()
      expect(f.replies.slice(1).every((reply) => reply[4] === SSH.failure)).toBe(true)
      expect(f.access.authorize).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  })
  it('closes at the queued-byte bound and rejects a late identity lookup after close', async () => {
    const f = sshFixture()
    try {
      const huge = sshFrame(SSH.identities, Buffer.alloc(VAULT_LIMITS.frameBytes / 2 - 1))
      f.session.receive(Buffer.concat([huge, huge, sshFrame(SSH.identities)]))
      await f.session.drained()
      expect(f.close).toHaveBeenCalledOnce()
      expect(f.replies).toEqual([])
    } finally {
      f.dispose()
    }
    const late = sshFixture(),
      ready = Promise.withResolvers<Awaited<ReturnType<SshAccessPort['identities']>>>(),
      entered = Promise.withResolvers<undefined>()
    late.access.identities = () => {
      entered.resolve(undefined)
      return ready.promise
    }
    try {
      late.session.receive(sshFrame(SSH.identities))
      await entered.promise
      late.session.close()
      ready.resolve([late.identity])
      await late.session.drained()
      expect(late.replies).toEqual([])
    } finally {
      late.dispose()
    }
  })
  it('lists public identities and signs a verified host/session/remote-user use', async () => {
    const f = sshFixture()
    try {
      f.session.receive(Buffer.concat([sshFrame(SSH.identities), f.bind(), f.signFrame()]))
      await f.session.drained()
      expect(f.replies.map((reply) => reply[4])).toEqual([
        SSH.identitiesAnswer,
        SSH.success,
        SSH.signAnswer,
      ])
      expect(f.uses).toEqual([
        {
          kind: 'ssh',
          host: 'host.example',
          hostKeyFingerprint: sshFingerprint(f.hostBlob),
          remoteUser: 'deploy',
          sessionId: f.sessionId.toString('base64'),
          forwarding: false,
        },
      ])
      const reader = new SshReader(f.replies[2]?.subarray(5) ?? Buffer.alloc(0))
      expect(isSshSignatureValid(f.blob, f.authentication(), reader.string())).toBe(true)
      expect(Buffer.concat(f.replies).includes(f.key.privateKey)).toBe(false)
    } finally {
      f.dispose()
    }
  })
  it('refuses host spoofing and corrupt session-bind before authorization', async () => {
    for (const isCorrupt of [false, true]) {
      const f = sshFixture()
      try {
        f.session.receive(
          f.bind(
            isCorrupt ? f.hostBlob : publicBlob(generateKeyPairSync('ed25519').publicKey),
            f.sessionId,
            false,
            isCorrupt,
          ),
        )
        await f.session.drained()
        expect(f.replies[0]?.[4]).toBe(SSH.failure)
        expect(f.access.authorize).not.toHaveBeenCalled()
      } finally {
        f.dispose()
      }
    }
  })
  it('refuses unknown/revoked known_hosts and rechecks it at signing', async () => {
    const f = sshFixture()
    try {
      f.session.receive(f.bind())
      await f.session.drained()
      f.setKnown('')
      f.session.receive(f.signFrame())
      await f.session.drained()
      expect(f.replies.at(-1)?.[4]).toBe(SSH.failure)
      expect(f.access.authorize).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  })
  it('rejects duplicate binding, authentication rebinding and changed session/key/method', async () => {
    const f = sshFixture()
    try {
      f.session.receive(f.bind())
      await f.session.drained()
      f.session.receive(
        Buffer.concat([
          f.bind(),
          f.bind(f.hostBlob, Buffer.from('other')),
          f.signFrame(f.authentication('deploy', Buffer.from('other'))),
          f.signFrame(
            f.authentication(
              'deploy',
              f.sessionId,
              publicBlob(generateKeyPairSync('ed25519').publicKey),
            ),
          ),
          f.signFrame(Buffer.from('arbitrary signing data')),
        ]),
      )
      await f.session.drained()
      expect(f.replies.slice(1).map((reply) => reply[4])).toEqual(
        Array.from({ length: 5 }, () => SSH.failure),
      )
      expect(f.access.sign).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  })
  it('parses hostbound authentication and rejects a different embedded host key', async () => {
    const f = sshFixture()
    try {
      f.session.receive(
        Buffer.concat([
          f.bind(),
          f.signFrame(
            f.authentication('deploy', f.sessionId, f.blob, 'publickey-hostbound-v00@openssh.com'),
          ),
          f.signFrame(
            f.authentication(
              'deploy',
              f.sessionId,
              f.blob,
              'publickey-hostbound-v00@openssh.com',
              f.blob,
            ),
          ),
        ]),
      )
      await f.session.drained()
      expect(f.replies.map((reply) => reply[4])).toEqual([SSH.success, SSH.signAnswer, SSH.failure])
    } finally {
      f.dispose()
    }
  })
  it('marks a forwarding chain and never signs at a forwarding-only hop', async () => {
    const f = sshFixture()
    try {
      f.session.receive(
        Buffer.concat([
          f.bind(f.hostBlob, f.sessionId, true),
          f.signFrame(),
          f.bind(f.hostBlob, Buffer.from('final')),
          f.signFrame(f.authentication('deploy', Buffer.from('final'))),
        ]),
      )
      await f.session.drained()
      expect(f.replies.map((reply) => reply[4])).toEqual([
        SSH.success,
        SSH.failure,
        SSH.success,
        SSH.signAnswer,
      ])
      expect(f.uses[0]).toMatchObject({ forwarding: true })
    } finally {
      f.dispose()
    }
  })
  it('represents a stripped session-bind as unproven, keeping its remote user', async () => {
    const f = sshFixture()
    try {
      f.session.receive(f.signFrame(f.authentication('different-user')))
      await f.session.drained()
      expect(f.uses[0]).toMatchObject({
        host: 'unproven',
        hostKeyFingerprint: null,
        sessionId: null,
        remoteUser: 'different-user',
      })
    } finally {
      f.dispose()
    }
  })
  it('accepts only the separate git SSHSIG namespace and valid hash lengths', async () => {
    const f = sshFixture()

    try {
      f.session.receive(
        Buffer.concat([
          f.signFrame(data('git')),
          f.signFrame(data('file')),
          f.signFrame(data('git', 'sha1', 64)),
          f.signFrame(data('git', 'sha256', 1)),
        ]),
      )
      await f.session.drained()
      expect(f.replies.map((reply) => reply[4])).toEqual([
        SSH.signAnswer,
        SSH.failure,
        SSH.failure,
        SSH.failure,
      ])
      expect(f.uses[0]).toMatchObject({
        kind: 'sshSign',
        namespace: 'git',
        keyFingerprint: f.key.fingerprint,
      })
      f.session.receive(Buffer.concat([f.bind(), f.signFrame(data('git'))]))
      await f.session.drained()
      expect(f.replies.at(-1)?.[4]).toBe(SSH.failure)
    } finally {
      f.dispose()
    }
  })
  it('never releases a late signature after revocation or connection close', async () => {
    for (const isRevoke of [false, true]) {
      const f = sshFixture()
      const started = Promise.withResolvers<undefined>(),
        done = Promise.withResolvers<undefined>()
      let borrowed: Buffer | undefined
      f.access.sign = vi.fn<SshAccessPort['sign']>(
        async (_identity, _ticket, _use, bytes, _flags, _lifetime, _signal, release) => {
          borrowed = bytes
          const signature = signSshData(f.key.privateKey, f.blob, Buffer.from(bytes), 0)
          started.resolve(undefined)
          try {
            await done.promise
            release(signature)
          } finally {
            signature.fill(0)
          }
        },
      )
      try {
        f.session.receive(Buffer.concat([f.bind(), f.signFrame()]))
        await started.promise
        if (isRevoke) f.invalidate()
        else f.session.close()
        expect(borrowed?.every((byte) => byte === 0)).toBe(true)
        done.resolve(undefined)
        await f.session.drained()
        expect(f.replies.map((reply) => reply[4])).toEqual([SSH.success])
        expect(f.close).toHaveBeenCalledOnce()
      } finally {
        f.dispose()
      }
    }
  })
  it('hides hidden/first-party/Never keys, rejects invalid signatures and refuses agent mutation commands', async () => {
    const f = sshFixture()
    try {
      for (const attribute of ['hidden', 'firstParty', 'never']) {
        f.identity.item.hidden = attribute === 'hidden'
        f.identity.item.firstParty = attribute === 'firstParty'
        f.identity.item.policy.mode = attribute === 'never' ? 'never' : 'askEveryTime'
        f.session.receive(sshFrame(SSH.identities))
        await f.session.drained()
        const reply = f.replies.at(-1)
        if (attribute === 'firstParty') expect(reply?.[4]).toBe(SSH.failure)
        else expect(reply?.readUInt32BE(5)).toBe(0)
      }
      f.identity.item.hidden = false
      f.identity.item.firstParty = false
      f.identity.item.policy.mode = 'askEveryTime'
      f.access.sign = vi.fn<SshAccessPort['sign']>(
        (_identity, _ticket, _use, _data, _flags, _lifetime, _signal, release) => {
          release(Buffer.alloc(64))
          return Promise.resolve()
        },
      )
      f.session.receive(Buffer.concat([f.bind(), f.signFrame(), sshFrame(17)]))
      await f.session.drained()
      expect(f.replies.slice(3).map((reply) => reply[4])).toEqual([
        SSH.success,
        SSH.failure,
        SSH.failure,
      ])
    } finally {
      f.dispose()
    }
  })
})
