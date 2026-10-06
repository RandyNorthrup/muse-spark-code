import { execFile } from 'node:child_process'
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
  createPrivateKey,
} from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  NODE_MAX_AUTH_BYTES,
  NODE_TLS_CERT_FILE,
  NODE_TLS_KEY_FILE,
  NODE_TLS_ISSUE_TIMEOUT_MS,
  NODE_TLS_SERIAL_BYTES,
  NODE_TLS_VALID_DAYS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { nodeLanAddressSchema } from '../../../shared/node'
import { nodeDomainSchema, nodeDigestSchema } from '../../../shared/nodeAuth'
import { isMissingFile, type NodePrivateFiles } from '../privateFiles'

export interface NodeCertificate {
  root: string
  certificateFile: string
  privateKeyFile: string
  fingerprint: string
}

/** The same certificate digest is pinned by N and printed in full on the console/TUI. */
export function checkNodeCertificate(
  pem: string,
  key: string,
  names: readonly string[],
  now: number,
  fingerprint?: string,
): string {
  const certificate = new X509Certificate(pem)
  const digest = certificate.fingerprint256.replaceAll(':', '').toLowerCase()
  if (
    names.length === 0 ||
    certificate.ca ||
    certificate.subjectAltName
      ?.split(', ')
      .toSorted((a, b) => a.localeCompare(b, 'en'))
      .join(', ') !==
      names
        .map((name) => `DNS:${name}`)
        .toSorted((a, b) => a.localeCompare(b, 'en'))
        .join(', ') ||
    certificate.subject !== certificate.issuer ||
    !certificate.verify(certificate.publicKey) ||
    !certificate.checkPrivateKey(createPrivateKey(key)) ||
    Date.parse(certificate.validFrom) > now ||
    Date.parse(certificate.validTo) <= now ||
    names.some(
      (name) =>
        certificate.checkHost(nodeDomainSchema.parse(name), {
          subject: 'never',
          wildcards: false,
        }) !== name,
    ) ||
    (fingerprint !== undefined && nodeDigestSchema.parse(fingerprint) !== digest)
  )
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  return digest
}

/** Check on-node resolution; clients still need their own LAN DNS/hosts entry. */
export async function checkNodeNames(
  names: readonly string[],
  address: string,
  resolve: (name: string) => Promise<readonly string[]> = async (name) => {
    const answers = await lookup(name, { all: true })
    return answers.map((answer) => answer.address)
  },
): Promise<void> {
  nodeLanAddressSchema.parse(address)
  if (names.length === 0) throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  for (const name of names) {
    nodeDomainSchema.parse(name)
    const answers = await resolve(name)
    if (!answers.includes(address))
      throw new Error(fill(UI_TEXT.nodeMessages.nameUnresolved, { name }))
  }
}

/** OpenSSL is supplied as an absolute trusted installed path by C/S0; no shell or repository config. */
export async function issueNodeCertificate(
  files: NodePrivateFiles,
  names: readonly string[],
  now: () => number,
  opensslPath: string,
  signal: AbortSignal,
): Promise<NodeCertificate> {
  for (const name of names) nodeDomainSchema.parse(name)
  if (names.length === 0 || new Set(names).size !== names.length || !path.isAbsolute(opensslPath))
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  await files.prepare()
  for (const name of [NODE_TLS_CERT_FILE, NODE_TLS_KEY_FILE]) {
    try {
      await files.read(name, NODE_MAX_AUTH_BYTES)
    } catch (error: unknown) {
      if (isMissingFile(error)) continue
      throw error
    }
    throw new Error(UI_TEXT.nodeErrors.conflict)
  }
  const stem = `tls-${randomUUID()}`
  const temporaryKey = `${stem}.key.pem`
  const temporaryCert = `${stem}.cert.pem`
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  await files.write(temporaryKey, privateKey)
  try {
    await promisify(execFile)(
      opensslPath,
      [
        'req',
        '-new',
        '-x509',
        '-key',
        files.file(temporaryKey),
        '-out',
        files.file(temporaryCert),
        '-days',
        String(NODE_TLS_VALID_DAYS),
        '-set_serial',
        `0x${randomBytes(NODE_TLS_SERIAL_BYTES).toString('hex')}`,
        '-subj',
        `/CN=${names[0] ?? ''}`,
        '-addext',
        'basicConstraints=critical,CA:FALSE',
        '-addext',
        'keyUsage=critical,digitalSignature',
        '-addext',
        'extendedKeyUsage=serverAuth',
        '-addext',
        `subjectAltName=${names.map((name) => `DNS:${name}`).join(',')}`,
      ],
      {
        env: {},
        cwd: files.root,
        timeout: NODE_TLS_ISSUE_TIMEOUT_MS,
        maxBuffer: NODE_MAX_AUTH_BYTES,
        signal,
      },
    )
    // OpenSSL creates output according to umask. Copy only after the child exits;
    // the staging directory is private and C/S0 owns its parent permissions.
    const pem = await readFile(files.file(temporaryCert), 'utf8')
    const fingerprint = checkNodeCertificate(pem, privateKey, names, now())
    signal.throwIfAborted()
    await files.write(NODE_TLS_KEY_FILE, privateKey)
    await files.write(NODE_TLS_CERT_FILE, pem)
    return {
      root: files.root,
      certificateFile: NODE_TLS_CERT_FILE,
      privateKeyFile: NODE_TLS_KEY_FILE,
      fingerprint,
    }
  } catch {
    throw new Error(UI_TEXT.nodeErrors.unavailable)
  } finally {
    await Promise.allSettled([unlink(files.file(temporaryKey)), unlink(files.file(temporaryCert))])
  }
}
