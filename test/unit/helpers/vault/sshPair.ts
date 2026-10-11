// RFC 9987 uint32-length framing. OpenSSH session-bind is a vendor extension,
// not an RFC field. Generated keys only; no fixture private key is committed.
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { Buffer } from 'node:buffer'

const SSH = {
  failure: 5,
  success: 6,
  identities: 11,
  identitiesAnswer: 12,
  sign: 13,
  signAnswer: 14,
  extension: 27,
}
function uint32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
function string(b: Uint8Array | string): Buffer {
  const bytes = Buffer.from(b)
  return Buffer.concat([uint32(bytes.length), bytes])
}
function frame(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const b = Buffer.concat([Buffer.from([type]), payload])
  return Buffer.concat([uint32(b.length), b])
}
function readString(b: Buffer, offset: number): { value: Buffer; end: number } {
  if (offset + 4 > b.length) throw new Error('fake SSH: truncated length')
  const end = offset + 4 + b.readUInt32BE(offset)
  if (end > b.length) throw new Error('fake SSH: truncated string')
  return { value: b.subarray(offset + 4, end), end }
}

export class FakeSshServer {
  private readonly key = generateKeyPairSync('ed25519')
  private pending = Buffer.alloc(0)
  private bound: Buffer | null = null
  private isForwarding = false
  readonly publicBlob: Buffer
  constructor(
    private readonly hasAnyHostGrant = false,
    private readonly canForward = false,
  ) {
    const raw = this.key.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
    this.publicBlob = Buffer.concat([string('ssh-ed25519'), string(raw)])
  }
  private dispatch(b: Buffer): Buffer {
    switch (b[0]) {
      case SSH.identities: {
        return b.length === 1
          ? frame(
              SSH.identitiesAnswer,
              Buffer.concat([uint32(1), string(this.publicBlob), string('generated-test-key')]),
            )
          : frame(SSH.failure)
      }
      case SSH.extension: {
        const extension = readString(b, 1)
        if (extension.value.toString() !== 'session-bind@openssh.com' || this.bound !== null)
          return frame(SSH.failure)
        const host = readString(b, extension.end)
        const session = readString(b, host.end)
        const signature = readString(b, session.end)
        const algorithm = readString(signature.value, 0)
        const rawSignature = readString(signature.value, algorithm.end)
        if (
          !host.value.equals(this.publicBlob) ||
          algorithm.value.toString() !== 'ssh-ed25519' ||
          rawSignature.end !== signature.value.length ||
          signature.end + 1 !== b.length ||
          !verify(null, session.value, this.key.publicKey, rawSignature.value)
        )
          return frame(SSH.failure)
        if (b[signature.end] !== 0 && b[signature.end] !== 1) return frame(SSH.failure)
        this.bound = Buffer.from(session.value)
        this.isForwarding = b[signature.end] === 1
        return frame(SSH.success)
      }
      case SSH.sign: {
        if (
          (this.bound === null && !this.hasAnyHostGrant) ||
          (this.isForwarding && !this.canForward)
        )
          return frame(SSH.failure)
        const key = readString(b, 1)
        const data = readString(b, key.end)
        if (
          !key.value.equals(this.publicBlob) ||
          data.end + 4 !== b.length ||
          b.readUInt32BE(data.end) !== 0
        )
          return frame(SSH.failure)
        const signature = sign(null, data.value, this.key.privateKey)
        return frame(
          SSH.signAnswer,
          string(Buffer.concat([string('ssh-ed25519'), string(signature)])),
        )
      }
      default: {
        return frame(SSH.failure)
      }
    }
  }
  receive(chunk: Uint8Array): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const replies: Buffer[] = []
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32BE(0)
      if (length < 1 || length > 1024 * 1024) throw new Error('fake SSH: invalid frame')
      if (this.pending.length < length + 4) break
      const message = this.pending.subarray(4, length + 4)
      this.pending = this.pending.subarray(length + 4)
      try {
        replies.push(this.dispatch(message))
      } catch {
        replies.push(frame(SSH.failure))
      }
    }
    return replies
  }
  bindFrame(session: Uint8Array, isForwarding = false, isCorrupt = false): Buffer {
    const signature = sign(null, session, this.key.privateKey)
    if (isCorrupt) signature[0] = (signature[0] ?? 0) ^ 1
    return frame(
      SSH.extension,
      Buffer.concat([
        string('session-bind@openssh.com'),
        string(this.publicBlob),
        string(session),
        string(Buffer.concat([string('ssh-ed25519'), string(signature)])),
        Buffer.from([isForwarding ? 1 : 0]),
      ]),
    )
  }
}

export class FakeSshClient {
  constructor(private readonly server: FakeSshServer) {}
  identities(): Buffer[] {
    return this.server.receive(frame(SSH.identities))
  }
  bind(session: Uint8Array, isForwarding = false, isCorrupt = false): Buffer[] {
    return this.server.receive(this.server.bindFrame(session, isForwarding, isCorrupt))
  }
  sign(data: Uint8Array): Buffer[] {
    return this.server.receive(
      frame(SSH.sign, Buffer.concat([string(this.server.publicBlob), string(data), uint32(0)])),
    )
  }
}
