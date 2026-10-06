import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rm, readdir } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import {
  checkNodeCertificate,
  checkNodeNames,
  issueNodeCertificate,
} from '../../src/runtime/node/tls/certificate'
import {
  NODE_MAX_AUTH_BYTES,
  NODE_TLS_CERT_FILE,
  NODE_TLS_KEY_FILE,
} from '../../src/shared/constants'
import { nodeNativeTest, nodeTempRoot } from './helpers/nodeNative'

const fixture = { root: '', pem: '', key: '', fingerprint: '', ca: '' }
beforeAll(async () => {
  if (process.platform === 'win32') return
  fixture.root = await nodeTempRoot('m110-a1-certificate-')
  const files = new NodePrivateFiles(fixture.root)
  const issued = await issueNodeCertificate(
    files,
    ['home.local', 'localhost'],
    Date.now,
    '/usr/bin/openssl',
    new AbortController().signal,
  )
  fixture.pem = await files.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES)
  fixture.key = await files.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES)
  fixture.fingerprint = issued.fingerprint
  const caFile = files.file('fixture-ca.pem')
  await promisify(execFile)('/usr/bin/openssl', [
    'req',
    '-x509',
    '-key',
    files.file(NODE_TLS_KEY_FILE),
    '-out',
    caFile,
    '-subj',
    '/CN=home.local',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'subjectAltName=DNS:home.local,DNS:localhost',
  ])
  fixture.ca = await readFile(caFile, 'utf8')
  await rm(caFile)
})
afterAll(async () => {
  if (fixture.root !== '') await rm(fixture.root, { recursive: true, force: true })
})

describe('H02 pinned non-CA certificate', () => {
  nodeNativeTest('issues a matching private leaf and a full SHA-256 fingerprint', async () => {
    const certificate = new X509Certificate(fixture.pem)
    expect(certificate.ca).toBe(false)
    expect(fixture.fingerprint).toHaveLength(64)
    expect(
      checkNodeCertificate(
        fixture.pem,
        fixture.key,
        ['home.local', 'localhost'],
        Date.now(),
        fixture.fingerprint,
      ),
    ).toBe(fixture.fingerprint)
    expect(await readdir(fixture.root)).toEqual(
      [NODE_TLS_CERT_FILE, NODE_TLS_KEY_FILE].toSorted((a, b) => a.localeCompare(b, 'en')),
    )
  })
  nodeNativeTest(
    'refuses a changed pin, wrong or extra SAN, and an expired/not-yet-valid leaf',
    async () => {
      await Promise.resolve()
      expect(() =>
        checkNodeCertificate(
          fixture.pem,
          fixture.key,
          ['home.local', 'localhost'],
          Date.now(),
          'a'.repeat(64),
        ),
      ).toThrow()
      expect(() =>
        checkNodeCertificate(fixture.pem, fixture.key, ['evil.local'], Date.now()),
      ).toThrow()
      expect(() =>
        checkNodeCertificate(fixture.pem, fixture.key, ['home.local'], Date.now()),
      ).toThrow()
      expect(() =>
        checkNodeCertificate(fixture.pem, fixture.key, ['home.local', 'localhost'], 0),
      ).toThrow()
      expect(() =>
        checkNodeCertificate(
          fixture.pem,
          fixture.key,
          ['home.local', 'localhost'],
          Number.MAX_SAFE_INTEGER,
        ),
      ).toThrow()
    },
  )
  nodeNativeTest('refuses a CA, mismatched private key and forged self-signature', () => {
    expect(() =>
      checkNodeCertificate(fixture.ca, fixture.key, ['home.local', 'localhost'], Date.now()),
    ).toThrow()
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    expect(() =>
      checkNodeCertificate(fixture.pem, privateKey, ['home.local', 'localhost'], Date.now()),
    ).toThrow()
    const bytes = Buffer.from(new X509Certificate(fixture.pem).raw)
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1
    const pem = `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64')}\n-----END CERTIFICATE-----`
    expect(() =>
      checkNodeCertificate(pem, fixture.key, ['home.local', 'localhost'], Date.now()),
    ).toThrow()
  })
  nodeNativeTest(
    'never overwrites an existing certificate/key or accepts an executable from PATH',
    async () => {
      const files = new NodePrivateFiles(fixture.root)
      await expect(
        issueNodeCertificate(
          files,
          ['home.local'],
          Date.now,
          '/usr/bin/openssl',
          new AbortController().signal,
        ),
      ).rejects.toThrow('changed')
      await expect(
        issueNodeCertificate(
          files,
          ['home.local'],
          Date.now,
          'openssl',
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(await files.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES)).toBe(fixture.pem)
    },
  )
  nodeNativeTest(
    'refuses IPs, wildcards, duplicate names and cancellation before issuance',
    async () => {
      const root = await nodeTempRoot('m110-a1-invalid-cert-')
      const files = new NodePrivateFiles(root)
      try {
        await expect(
          issueNodeCertificate(
            files,
            ['home.local'],
            Date.now,
            'openssl',
            new AbortController().signal,
          ),
        ).rejects.toThrow()
        for (const names of [['127.0.0.1'], ['*.home.local'], ['home.local', 'home.local'], []])
          await expect(
            issueNodeCertificate(
              files,
              names,
              Date.now,
              '/usr/bin/openssl',
              new AbortController().signal,
            ),
          ).rejects.toThrow()
        await expect(
          issueNodeCertificate(
            files,
            ['home.local'],
            Date.now,
            '/usr/bin/openssl',
            AbortSignal.abort(),
          ),
        ).rejects.toThrow()
        expect(await readdir(root)).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})

describe('H02/H03 name resolution', () => {
  it('requires each chosen name to resolve to the selected LAN interface', async () => {
    await expect(
      checkNodeNames(['home.local'], '192.168.1.10', () => Promise.resolve(['192.168.1.10'])),
    ).resolves.toBeUndefined()
    await expect(
      checkNodeNames(['home.local'], '192.168.1.10', () => Promise.resolve(['192.168.1.11'])),
    ).rejects.toThrow('does not resolve')
    await expect(
      checkNodeNames(['home.local'], '0.0.0.0', () => Promise.resolve(['0.0.0.0'])),
    ).rejects.toThrow()
    await expect(
      checkNodeNames(['127.0.0.1'], '127.0.0.1', () => Promise.resolve(['127.0.0.1'])),
    ).rejects.toThrow()
  })
})
