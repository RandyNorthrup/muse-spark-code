import { createPrivateKey, type KeyObject } from 'node:crypto'
import { VAULT_KEY_BYTES } from '../../../shared/constants'
import { SshReader, SSH, sshFailure } from './wire'

const DER = {
  sequence: 0x30,
  integer: 0x02,
  octets: 0x04,
  bits: 0x03,
  context0: 0xa0,
  context1: 0xa1,
  longLength: 0x80,
  byteMask: 0xff,
  byteBits: 8,
  hexRadix: 16,
  one: 1n,
}
/** OpenSSH's documented unencrypted file format; encrypted PEM is handled by OpenSSL in keys.ts. */
export function readOpenSshKey(bytes: Buffer): { key: KeyObject; blob: Buffer } {
  const kind = 'OPENSSH PRIVATE KEY',
    begin = `-----BEGIN ${kind}-----`,
    end = `-----END ${kind}-----`
  const text = bytes.toString('ascii').trim()
  if (!text.startsWith(begin) || !text.endsWith(end)) throw sshFailure()
  const encoded = text.slice(begin.length, -end.length).replaceAll(/\s/gu, '')
  if (!/^[A-Za-z0-9+/=]+$/u.test(encoded)) throw sshFailure()
  const decoded = Buffer.from(encoded, 'base64'),
    copies: Buffer[] = []
  const copy = (buffer: Buffer): Buffer => {
    copies.push(buffer)
    return buffer
  }
  function der(tag: number, payload: Buffer): Buffer {
    const lengths: number[] = []
    let size = payload.length
    if (size < DER.longLength) lengths.push(size)
    else {
      while (size > 0) {
        lengths.unshift(size & DER.byteMask)
        size >>>= DER.byteBits
      }
      lengths.unshift(DER.longLength | lengths.length)
    }
    return copy(Buffer.concat([Buffer.from([tag, ...lengths]), payload]))
  }
  function integer(value: Buffer): Buffer {
    if (value.length === 0 || ((value[0] ?? 0) & DER.longLength) !== 0) throw sshFailure()
    return der(DER.integer, value)
  }
  function positive(value: Buffer): bigint {
    if (value.length === 0 || ((value[0] ?? 0) & DER.longLength) !== 0) throw sshFailure()
    return BigInt(`0x${value.toString('hex')}`)
  }
  function bigInteger(value: bigint): Buffer {
    const text = value.toString(DER.hexRadix),
      even = text.length % 2 === 0 ? text : `0${text}`
    const bytes = copy(Buffer.from(even, 'hex'))
    return integer(
      (bytes[0] ?? 0) & DER.longLength ? copy(Buffer.concat([Buffer.from([0]), bytes])) : bytes,
    )
  }
  try {
    const reader = new SshReader(decoded)
    if (
      reader.take(Buffer.byteLength('openssh-key-v1\0')).toString() !== 'openssh-key-v1\0' ||
      reader.text() !== 'none' ||
      reader.text() !== 'none' ||
      reader.string().length > 0 ||
      reader.uint32() !== 1
    )
      throw sshFailure()
    const blob = Buffer.from(reader.string()),
      secret = reader.string()
    reader.end()
    const inner = new SshReader(secret)
    if (inner.uint32() !== inner.uint32()) throw sshFailure()
    const algorithm = inner.text()
    let privateDer: Buffer, type: 'pkcs8' | 'pkcs1' | 'sec1'
    switch (algorithm) {
      case 'ssh-ed25519': {
        const raw = inner.string(),
          combined = inner.string()
        if (
          raw.length !== VAULT_KEY_BYTES ||
          combined.length !== VAULT_KEY_BYTES * 2 ||
          !combined.subarray(VAULT_KEY_BYTES).equals(raw)
        )
          throw sshFailure()
        privateDer = copy(
          Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            combined.subarray(0, VAULT_KEY_BYTES),
          ]),
        )
        type = 'pkcs8'
        break
      }
      case 'ecdsa-sha2-nistp256': {
        if (inner.text() !== 'nistp256') throw sshFailure()
        const point = inner.string(),
          scalar = inner.string()
        if (
          point.length !== SSH.ecPointBytes ||
          point[0] !== SSH.uint32Bytes ||
          scalar.length === 0 ||
          scalar.length > SSH.ecScalarBytes + 1 ||
          ((scalar[0] ?? 0) & DER.longLength) !== 0
        )
          throw sshFailure()
        const raw = scalar[0] === 0 ? scalar.subarray(1) : scalar
        if (raw.length > SSH.ecScalarBytes) throw sshFailure()
        const padded = copy(Buffer.alloc(SSH.ecScalarBytes))
        raw.copy(padded, padded.length - raw.length)
        privateDer = der(
          DER.sequence,
          copy(
            Buffer.concat([
              integer(Buffer.from([1])),
              der(DER.octets, padded),
              der(DER.context0, Buffer.from('06082a8648ce3d030107', 'hex')),
              der(DER.context1, der(DER.bits, Buffer.concat([Buffer.from([0]), point]))),
            ]),
          ),
        )
        type = 'sec1'
        break
      }
      case 'ssh-rsa': {
        const n = inner.string(),
          e = inner.string(),
          d = inner.string(),
          iqmp = inner.string(),
          p = inner.string(),
          q = inner.string()
        const primeP = positive(p),
          primeQ = positive(q)
        if (primeP <= 1 || primeQ <= 1) throw sshFailure()
        const exponent = positive(d)
        privateDer = der(
          DER.sequence,
          copy(
            Buffer.concat([
              integer(Buffer.from([0])),
              integer(n),
              integer(e),
              integer(d),
              integer(p),
              integer(q),
              bigInteger(exponent % (primeP - DER.one)),
              bigInteger(exponent % (primeQ - DER.one)),
              integer(iqmp),
            ]),
          ),
        )
        type = 'pkcs1'
        break
      }
      default: {
        throw sshFailure()
      }
    }
    inner.text()
    const padding = inner.takeRemaining()
    if (
      secret.length % SSH.openSshBlockBytes !== 0 ||
      padding.some((byte, index) => byte !== index + 1)
    )
      throw sshFailure()
    return { key: createPrivateKey({ key: privateDer, format: 'der', type }), blob }
  } finally {
    decoded.fill(0)
    for (const buffer of copies) buffer.fill(0)
  }
}
