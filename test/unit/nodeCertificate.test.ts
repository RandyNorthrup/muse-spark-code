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
  readNodeChallengeKey,
} from '../../src/runtime/node/auth/entry'
import {
  NODE_MAX_AUTH_BYTES,
  NODE_CHALLENGE_KEY_BYTES,
  NODE_TLS_CERT_FILE,
  NODE_TLS_KEY_FILE,
  NODE_TLS_DIRECTORY,
  NODE_TLS_PENDING_DIRECTORY,
  NODE_TLS_ISSUE_TIMEOUT_MS,
} from '../../src/shared/constants'
import { nodeNativeTest, nodeTempRoot } from './helpers/nodeNative'
import { useRuntimeGovernor } from './helpers/resources/runtimeGovernor'

// Issuance starts OpenSSL through the governed launch: admitted by the
// governor the node command's process configures (POSIX; Windows refuses).
useRuntimeGovernor('m110-a1-certificate-jobs-', process.platform !== 'win32')
const fixture = { root: '', certificateRoot: '', pem: '', key: '', fingerprint: '', ca: '' }
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
  fixture.certificateRoot = issued.root
  const committed = new NodePrivateFiles(issued.root)
  fixture.pem = await committed.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES)
  fixture.key = await committed.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES)
  fixture.fingerprint = issued.fingerprint
  const caFile = files.file('fixture-ca.pem')
  const args = [
    'req',
    '-new',
    '-x509',
    '-key',
    committed.file(NODE_TLS_KEY_FILE),
    '-out',
    caFile,
    '-subj',
    '/CN=home.local',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'subjectAltName=DNS:home.local,DNS:localhost',
  ]
  // LibreSSL otherwise waits for a CSR on stdin. Prove the fixture requests a
  // new leaf explicitly; this assertion also makes the portability guard fire.
  expect(args).toContain('-new')
  await promisify(execFile)('/usr/bin/openssl', args, {
    env: {},
    timeout: NODE_TLS_ISSUE_TIMEOUT_MS,
  })
  fixture.ca = await readFile(caFile, 'utf8')
  await rm(caFile)
})
afterAll(async () => {
  if (fixture.root !== '') await rm(fixture.root, { recursive: true, force: true })
})

describe('H02 pinned non-CA certificate', () => {
  nodeNativeTest(
    'H02/H05 derives a stable challenge key from the protected pair and rotates with it',
    async () => {
      const original = await readNodeChallengeKey(new NodePrivateFiles(fixture.certificateRoot))
      expect(original).toHaveLength(NODE_CHALLENGE_KEY_BYTES)
      expect(await readNodeChallengeKey(new NodePrivateFiles(fixture.certificateRoot))).toEqual(
        original,
      )
      const root = await nodeTempRoot('m110-a3-challenge-key-')
      try {
        const pair = await issueNodeCertificate(
          new NodePrivateFiles(root),
          ['home.local'],
          Date.now,
          '/usr/bin/openssl',
          new AbortController().signal,
        )
        const files = new NodePrivateFiles(pair.root)
        expect(await readNodeChallengeKey(files)).not.toEqual(original)
        // A mixed pair must not yield an authentication key.
        await files.write(NODE_TLS_KEY_FILE, fixture.key)
        await expect(readNodeChallengeKey(files)).rejects.toThrow()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
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
    expect(await readdir(fixture.root)).toEqual([NODE_TLS_DIRECTORY])
    expect(await readdir(fixture.certificateRoot)).toEqual(
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
    return Promise.resolve()
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
      ).rejects.toThrow()
      await expect(
        issueNodeCertificate(
          files,
          ['home.local'],
          Date.now,
          'openssl',
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(
        await new NodePrivateFiles(fixture.certificateRoot).read(
          NODE_TLS_CERT_FILE,
          NODE_MAX_AUTH_BYTES,
        ),
      ).toBe(fixture.pem)
      const root = await nodeTempRoot('m110-a2-legacy-cert-')
      const legacy = new NodePrivateFiles(root)
      try {
        await legacy.write(NODE_TLS_KEY_FILE, fixture.key)
        await expect(
          issueNodeCertificate(
            legacy,
            ['home.local'],
            Date.now,
            '/usr/bin/openssl',
            new AbortController().signal,
          ),
        ).rejects.toThrow('changed')
        expect(await legacy.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES)).toBe(fixture.key)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
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
  nodeNativeTest(
    'H02/H15 certificate-write failure leaves no partial commit and retry succeeds',
    async () => {
      const root = await nodeTempRoot('m110-a2-cert-failure-')
      const files = new NodePrivateFiles(root)
      const write = NodePrivateFiles.prototype.write
      let writes = 0
      const seen: string[][] = []
      // Fail exactly the certificate commit while the two key writes pass through.
      NodePrivateFiles.prototype.write = async function (
        this: NodePrivateFiles,
        name: string,
        text: string,
      ): Promise<void> {
        writes += 1
        seen.push([name, text])
        if (writes === 3) throw new Error('injected certificate-write failure')
        await write.call(this, name, text)
      }
      try {
        await expect(
          issueNodeCertificate(
            files,
            ['home.local'],
            Date.now,
            '/usr/bin/openssl',
            new AbortController().signal,
          ),
        ).rejects.toThrow()
        expect(seen[2]?.[0]).toBe(NODE_TLS_CERT_FILE)
        NodePrivateFiles.prototype.write = write
        expect(await readdir(root)).toEqual([])
        const issued = await issueNodeCertificate(
          files,
          ['home.local'],
          Date.now,
          '/usr/bin/openssl',
          new AbortController().signal,
        )
        const pair = new NodePrivateFiles(issued.root)
        expect(
          checkNodeCertificate(
            await pair.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES),
            await pair.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES),
            ['home.local'],
            Date.now(),
            issued.fingerprint,
          ),
        ).toBe(issued.fingerprint)
      } finally {
        NodePrivateFiles.prototype.write = write
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  nodeNativeTest(
    'H02/H15 restart discards an uncommitted key and preserves a committed pair',
    async () => {
      const root = await nodeTempRoot('m110-a2-cert-crash-')
      const files = new NodePrivateFiles(root)
      try {
        await files.prepare()
        const staging = new NodePrivateFiles(files.file(NODE_TLS_PENDING_DIRECTORY))
        await staging.write(NODE_TLS_KEY_FILE, fixture.key)
        await staging.write('abandoned.tmp', 'uncommitted issuance')
        const issued = await issueNodeCertificate(
          files,
          ['home.local'],
          Date.now,
          '/usr/bin/openssl',
          new AbortController().signal,
        )
        expect(await readdir(root)).toEqual([NODE_TLS_DIRECTORY])
        const committed = new NodePrivateFiles(issued.root)
        expect(await readdir(committed.root)).toEqual(
          [NODE_TLS_CERT_FILE, NODE_TLS_KEY_FILE].toSorted((a, b) => a.localeCompare(b, 'en')),
        )
        const certificate = await committed.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES)
        const key = await committed.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES)
        expect(key).not.toBe(fixture.key)
        await expect(
          issueNodeCertificate(
            files,
            ['home.local'],
            Date.now,
            '/usr/bin/openssl',
            new AbortController().signal,
          ),
        ).resolves.toEqual(issued)
        expect(await committed.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES)).toBe(certificate)
        expect(
          checkNodeCertificate(certificate, key, ['home.local'], Date.now(), issued.fingerprint),
        ).toBe(issued.fingerprint)
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
