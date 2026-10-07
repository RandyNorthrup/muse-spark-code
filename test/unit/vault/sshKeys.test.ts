import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  generateEd25519Key,
  importSshKey,
  publicBlob,
  parsePublicKey,
  signSshData,
  isSshSignatureValid,
  sshFingerprint,
} from '../../../src/core/vault/ssh/keys'
import {
  SSH,
  SshReader,
  SshFramer,
  sshString,
  sshFrame,
  uint32,
  parseSshRequest,
} from '../../../src/core/vault/ssh/wire'
import { resolveKnownHost } from '../../../src/core/vault/ssh/knownHosts'
import { createHmac } from 'node:crypto'

function armor(bytes: Buffer): Buffer {
  const kind = 'OPENSSH PRIVATE KEY'
  return Buffer.from(`-----BEGIN ${kind}-----\n${bytes.toString('base64')}\n-----END ${kind}-----`)
}
describe('vault SSH keys and RFC 9987 boundary', () => {
  it('generates unpooled Ed25519 material, exports only public data and verifies signatures', () => {
    const key = generateEd25519Key()
    try {
      const blob = Buffer.from(key.publicKey.split(' ', 2)[1] ?? '', 'base64'),
        data = Buffer.from('message')
      expect(key.privateKey.buffer.byteLength).toBe(key.privateKey.byteLength)
      expect(key.fingerprint).toBe(sshFingerprint(blob))
      expect(isSshSignatureValid(blob, data, signSshData(key.privateKey, blob, data, 0))).toBe(true)
      expect(
        isSshSignatureValid(
          blob,
          Buffer.from('changed'),
          signSshData(key.privateKey, blob, data, 0),
        ),
      ).toBe(false)
      expect(() => signSshData(key.privateKey, blob, data, SSH.rsa512)).toThrow()
    } finally {
      key.privateKey.fill(0)
    }
  })
  it('imports PEM, encrypted PEM and unencrypted OpenSSH; rejects a public/private mismatch', () => {
    const generated = generateKeyPairSync('ed25519'),
      pem = generated.privateKey.export({ type: 'pkcs8', format: 'pem' })
    const password = Buffer.from('generated-test-passphrase')
    const encrypted = generated.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: password,
    })
    const imported = importSshKey(Buffer.from(pem)),
      decrypted = importSshKey(Buffer.from(encrypted), password)
    try {
      expect(imported.publicKey).toBe(decrypted.publicKey)
      expect(() => importSshKey(Buffer.from(encrypted))).toThrow()
    } finally {
      imported.privateKey.fill(0)
      decrypted.privateKey.fill(0)
      password.fill(0)
    }
    const blob = publicBlob(generated.publicKey),
      reader = new SshReader(blob)
    reader.text()
    const raw = reader.string(),
      der = generated.privateKey.export({ type: 'pkcs8', format: 'der' })
    const secret = Buffer.concat([
      uint32(1),
      uint32(1),
      sshString('ssh-ed25519'),
      sshString(raw),
      sshString(Buffer.concat([der.subarray(-32), raw])),
      sshString('test'),
    ])
    const file = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      sshString('none'),
      sshString('none'),
      sshString(''),
      uint32(1),
      sshString(blob),
      sshString(secret),
    ])
    const encoded = armor(file)
    try {
      const result = importSshKey(encoded)
      result.privateKey.fill(0)
      secret[0] = 1
      const bad = Buffer.concat([
        Buffer.from('openssh-key-v1\0'),
        sshString('none'),
        sshString('none'),
        sshString(''),
        uint32(1),
        sshString(blob),
        sshString(secret),
      ])
      expect(() => importSshKey(armor(bad))).toThrow()
      bad.fill(0)
    } finally {
      der.fill(0)
      secret.fill(0)
      file.fill(0)
      encoded.fill(0)
    }
  })
  it('handles P-256 and RSA SHA2; rejects weak or mismatched methods and unknown flags', () => {
    for (const generated of [
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
      generateKeyPairSync('rsa', { modulusLength: 2048 }),
    ]) {
      const key = importSshKey(
        Buffer.from(generated.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      )
      const blob = publicBlob(generated.publicKey),
        data = Buffer.from('test'),
        flags = key.algorithm === 'rsa' ? SSH.rsa512 : 0
      try {
        expect(parsePublicKey(blob).algorithm).toBe(key.publicKey.split(' ', 1)[0])
        expect(
          isSshSignatureValid(blob, data, signSshData(key.privateKey, blob, data, flags)),
        ).toBe(true)
        expect(
          isSshSignatureValid(
            blob,
            data,
            Buffer.concat([
              sshString('ssh-rsa'),
              sshString(sign('sha1', data, generated.privateKey)),
            ]),
          ),
        ).toBe(false)
        expect(() => signSshData(key.privateKey, blob, data, 100)).toThrow()
      } finally {
        key.privateKey.fill(0)
      }
    }
  })
  it('parses fragmented/coalesced frames, bounds lengths, rejects trailing and malformed fields', () => {
    const parser = new SshFramer(),
      seen: unknown[] = []
    const frames = Buffer.concat([
      sshFrame(SSH.identities),
      sshFrame(SSH.sign, Buffer.concat([sshString('key'), sshString('data'), uint32(0)])),
    ])
    for (const byte of frames)
      parser.push(Buffer.from([byte]), (frame) => {
        seen.push(structuredClone(parseSshRequest(frame)))
      })
    expect(seen).toHaveLength(2)
    expect(() => parseSshRequest(Buffer.from([SSH.identities, 1]))).toThrow()
    expect(() => parseSshRequest(Buffer.from([SSH.sign, 1]))).toThrow()
    expect(() => {
      new SshFramer().push(Buffer.concat([uint32(0), Buffer.from([1])]), vi.fn())
    }).toThrow()
    expect(() => {
      new SshFramer().push(Buffer.concat([uint32(0xff_ff_ff_ff), Buffer.from([1])]), vi.fn())
    }).toThrow()
    parser.close()
  })
  it('matches literal, hashed and wildcard known_hosts; revocation, negation, aliases and wrong keys fail closed', () => {
    const blob = publicBlob(generateKeyPairSync('ed25519').publicKey),
      other = publicBlob(generateKeyPairSync('ed25519').publicKey)
    const key = `ssh-ed25519 ${blob.toString('base64')}`,
      salt = Buffer.from('generated-salt'),
      hash = createHmac('sha1', salt).update('host.example').digest('base64')
    expect(resolveKnownHost(`host.example ${key}`, blob)).toBe('host.example')
    expect(
      resolveKnownHost(`|1|${salt.toString('base64')}|${hash} ${key}`, blob, 'host.example'),
    ).toBe('host.example')
    expect(resolveKnownHost(`*.example,!bad.example ${key}`, blob, 'host.example')).toBe(
      'host.example',
    )
    for (const [text, host] of [
      [`host.example ${key}`, 'other.example'],
      [`*.example,!bad.example ${key}`, 'bad.example'],
      [`host.example ${key}\n@revoked host.example ${key}`, 'host.example'],
      [`host.example,alias.example ${key}`, undefined],
    ])
      expect(() => resolveKnownHost(text ?? '', blob, host)).toThrow()
    expect(() => resolveKnownHost(`host.example ${key}`, other, 'host.example')).toThrow()
  })
})
