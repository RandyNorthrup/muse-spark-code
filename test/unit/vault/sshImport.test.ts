import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importSshKey, signSshData, isSshSignatureValid } from '../../../src/core/vault/ssh/keys'
import { SshReader, sshString, uint32 } from '../../../src/core/vault/ssh/wire'

const run = promisify(execFile)
const context = { directory: '' }
const files = new Map<string, Buffer>()
beforeAll(async () => {
  context.directory = await mkdtemp(path.join(os.tmpdir(), 'muse-ssh-import-'))
  try {
    for (const type of ['ed25519', 'ecdsa', 'rsa']) {
      const file = path.join(context.directory, type)
      await run(
        'ssh-keygen',
        [
          '-q',
          '-t',
          type,
          '-b',
          type === 'rsa' ? '2048' : '256',
          '-N',
          '',
          '-C',
          'generated-m109-test',
          '-f',
          file,
        ],
        {
          env: {
            PATH: process.env['PATH'],
            ...(process.env['SystemRoot'] && { SystemRoot: process.env['SystemRoot'] }),
          },
        },
      )
      files.set(type, await readFile(file))
    }
  } catch (error: unknown) {
    await rm(context.directory, { recursive: true, force: true })
    throw error
  }
})
afterAll(async () => {
  for (const bytes of files.values()) bytes.fill(0)
  await rm(context.directory, { recursive: true, force: true })
})
describe('generated OpenSSH key files', () => {
  it('imports real OpenSSH Ed25519, ECDSA P-256 and RSA files and verifies their signatures', () => {
    for (const [type, bytes] of files) {
      const key = importSshKey(bytes)
      try {
        expect(key.algorithm).toBe(type === 'ecdsa' ? 'ecdsa-p256' : type)
        const blob = Buffer.from(key.publicKey.split(' ', 2)[1] ?? '', 'base64'),
          data = Buffer.from('generated-message'),
          flags = type === 'rsa' ? 4 : 0
        expect(
          isSshSignatureValid(blob, data, signSshData(key.privateKey, blob, data, flags)),
        ).toBe(true)
      } finally {
        key.privateKey.fill(0)
      }
    }
  })
  it('refuses corrupt padding, checkints, public keys, cipher and trailing file data', () => {
    const original = files.get('ed25519')
    if (!original) throw new Error('missing generated key')
    const text = original.toString('ascii'),
      body = text.split('\n').slice(1, -2).join(''),
      decoded = Buffer.from(body, 'base64')
    const reader = new SshReader(decoded)
    const magic = reader.take(Buffer.byteLength('openssh-key-v1\0')),
      cipher = reader.string(),
      kdf = reader.string(),
      options = reader.string(),
      count = reader.uint32(),
      blob = reader.string(),
      secret = reader.string()
    const kind = 'OPENSSH PRIVATE KEY'
    function file(
      publicBlob: Buffer,
      privateBytes: Buffer,
      cipherBytes = cipher,
      extra = Buffer.alloc(0),
    ): Buffer {
      return Buffer.from(
        `-----BEGIN ${kind}-----\n${Buffer.concat([magic, sshString(cipherBytes), sshString(kdf), sshString(options), uint32(count), sshString(publicBlob), sshString(privateBytes), extra]).toString('base64')}\n-----END ${kind}-----`,
      )
    }
    try {
      const badPadding = Buffer.from(secret)
      badPadding[badPadding.length - 1] = 0
      const badCheck = Buffer.from(secret)
      badCheck[0] = (badCheck[0] ?? 0) ^ 1
      const badPublic = Buffer.from(blob)
      badPublic[badPublic.length - 1] = (badPublic.at(-1) ?? 0) ^ 1
      for (const bytes of [
        file(blob, badPadding),
        file(blob, badCheck),
        file(badPublic, secret),
        file(blob, secret, Buffer.from('aes256-ctr')),
        file(blob, secret, cipher, Buffer.from([1])),
      ]) {
        try {
          expect(() => importSshKey(bytes)).toThrow()
        } finally {
          bytes.fill(0)
        }
      }
      badPadding.fill(0)
      badCheck.fill(0)
    } finally {
      decoded.fill(0)
    }
  })
})
