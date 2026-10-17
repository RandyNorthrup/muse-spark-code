import { generateKeyPairSync, sign } from 'node:crypto'
import { vi } from 'vitest'
import { metadata, ticket } from '../helpers/vault/fixtures'
import { type SshAccessPort, type SshIdentity } from '../../../src/core/vault/ssh/ports'
import { VaultSshSession } from '../../../src/core/vault/ssh/session'
import { generateEd25519Key, publicBlob, signSshData } from '../../../src/core/vault/ssh/keys'
import { SSH, sshFrame, sshString, uint32 } from '../../../src/core/vault/ssh/wire'
import { type VaultUse } from '../../../src/shared/vault'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'

export function sshFixture() {
  const key = generateEd25519Key(),
    blob = Buffer.from(key.publicKey.split(' ', 2)[1] ?? '', 'base64')
  const host = generateKeyPairSync('ed25519'),
    hostBlob = publicBlob(host.publicKey),
    sessionId = Buffer.from('generated-session-id')
  const identity: SshIdentity = {
    item: {
      ...metadata(),
      kind: 'sshKey',
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      bindings: [
        {
          kind: 'ssh',
          host: 'host.example',
          hostKeyFingerprint: 'SHA256:' + Buffer.alloc(32).toString('base64').replace(/=+$/u, ''),
          remoteUser: 'deploy',
          forwarding: false,
        },
      ],
    },
    blob,
    source: 'vault',
  }
  const replies: Buffer[] = [],
    uses: VaultUse[] = [],
    invalidations = new Set<() => void>()
  let known = `host.example ssh-ed25519 ${hostBlob.toString('base64')}`
  const access: SshAccessPort = {
    identities: vi.fn<SshAccessPort['identities']>(() => Promise.resolve([identity])),
    authorize: vi.fn<SshAccessPort['authorize']>((_identity, use) => {
      uses.push(use)
      return Promise.resolve({ ...ticket(), digest: vaultUseDigest(use) })
    }),
    sign: vi.fn<SshAccessPort['sign']>(
      (_identity, _ticket, _use, data, flags, _lifetime, _signal, release) => {
        const signature = signSshData(key.privateKey, blob, data, flags)
        try {
          release(signature)
        } finally {
          signature.fill(0)
        }
        return Promise.resolve()
      },
    ),
    subscribeInvalidation: (listener) => {
      invalidations.add(listener)
      return () => {
        invalidations.delete(listener)
      }
    },
  }
  const close = vi.fn(),
    terminate = vi.fn(() => Promise.resolve(true))
  const session = new VaultSshSession({
    access,
    knownHosts: { read: () => Promise.resolve(known) },
    send: (bytes) => {
      replies.push(Buffer.from(bytes))
    },
    close,
    terminate,
  })
  function bind(
    hostKey: Buffer = hostBlob,
    id: Buffer = sessionId,
    isForwarding = false,
    isCorrupt = false,
  ): Buffer {
    const signature = sign(null, id, host.privateKey)
    if (isCorrupt) signature[0] = (signature[0] ?? 0) ^ 1
    return sshFrame(
      SSH.extension,
      Buffer.concat([
        sshString('session-bind@openssh.com'),
        sshString(hostKey),
        sshString(id),
        sshString(Buffer.concat([sshString('ssh-ed25519'), sshString(signature)])),
        Buffer.from([isForwarding ? 1 : 0]),
      ]),
    )
  }
  function authentication(
    remoteUser = 'deploy',
    id: Buffer = sessionId,
    keyBlob: Buffer = blob,
    method = 'publickey',
    boundHost: Buffer = hostBlob,
  ): Buffer {
    return Buffer.concat([
      sshString(id),
      Buffer.from([SSH.userauth]),
      sshString(remoteUser),
      sshString('ssh-connection'),
      sshString(method),
      Buffer.from([1]),
      sshString('ssh-ed25519'),
      sshString(keyBlob),
      ...(method === 'publickey-hostbound-v00@openssh.com' ? [sshString(boundHost)] : []),
    ])
  }
  function signFrame(data: Buffer = authentication(), keyBlob: Buffer = blob, flags = 0): Buffer {
    return sshFrame(SSH.sign, Buffer.concat([sshString(keyBlob), sshString(data), uint32(flags)]))
  }
  return {
    key,
    blob,
    host,
    hostBlob,
    sessionId,
    identity,
    access,
    session,
    uses,
    replies,
    close,
    terminate,
    bind,
    authentication,
    signFrame,
    setKnown: (text: string) => {
      known = text
    },
    invalidate: () => {
      for (const callback of invalidations) callback()
    },
    dispose: () => {
      session.close()
      key.privateKey.fill(0)
    },
  }
}
