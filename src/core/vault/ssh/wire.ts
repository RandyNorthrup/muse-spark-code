import * as z from 'zod/mini'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'

/** Protocol numbers and fixed encoding widths, not configurable limits (RFC 9987). */
export const SSH = {
  failure: 5,
  success: 6,
  identities: 11,
  identitiesAnswer: 12,
  sign: 13,
  signAnswer: 14,
  extension: 27,
  extensionFailure: 28,
  uint32Bytes: 4,
  userauth: 50,
  rsa256: 2,
  rsa512: 4,
  edSignatureBytes: 64,
  ecPointBytes: 65,
  ecScalarBytes: 32,
}

export function sshFailure(): Error {
  return new Error(UI_TEXT.vault.noAccess)
}
export function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(SSH.uint32Bytes)
  bytes.writeUInt32BE(value)
  return bytes
}
export function sshString(value: Uint8Array | string): Buffer {
  const bytes = Buffer.from(value)
  return Buffer.concat([uint32(bytes.length), bytes])
}
export function sshFrame(type: number, payload: Uint8Array = Buffer.alloc(0)): Buffer {
  const bytes = Buffer.concat([Buffer.from([type]), payload])
  if (bytes.length > VAULT_LIMITS.frameBytes) throw sshFailure()
  return Buffer.concat([uint32(bytes.length), bytes])
}
export class SshReader {
  private offset = 0
  constructor(private readonly bytes: Buffer) {}
  take(length: number): Buffer {
    if (length < 0 || this.offset + length > this.bytes.length) throw sshFailure()
    const result = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }
  byte(): number {
    return this.take(1).readUInt8()
  }
  boolean(): boolean {
    const value = this.byte()
    if (value !== 0 && value !== 1) throw sshFailure()
    return value === 1
  }
  uint32(): number {
    return this.take(SSH.uint32Bytes).readUInt32BE()
  }
  string(): Buffer {
    const length = this.uint32()
    if (length > VAULT_LIMITS.frameBytes) throw sshFailure()
    return this.take(length)
  }
  text(): string {
    const bytes = this.string(),
      text = bytes.toString('utf8')
    if (
      bytes.length > VAULT_LIMITS.text ||
      !Buffer.from(text).equals(bytes) ||
      /[\0\r\n]/u.test(text)
    )
      throw sshFailure()
    return text
  }
  end(): void {
    if (this.offset !== this.bytes.length) throw sshFailure()
  }
}
const bytesSchema = z.instanceof(Buffer).check(z.maxLength(VAULT_LIMITS.frameBytes))
const requestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('identities') }),
  z.strictObject({
    kind: z.literal('sign'),
    key: bytesSchema,
    data: bytesSchema,
    flags: z.number().check(z.int(), z.nonnegative()),
  }),
  z.strictObject({
    kind: z.literal('bind'),
    hostKey: bytesSchema,
    session: bytesSchema,
    signature: bytesSchema,
    forwarding: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('query') }),
  z.strictObject({ kind: z.literal('unsupported'), extension: z.boolean() }),
])
export function parseSshRequest(bytes: Buffer): z.infer<typeof requestSchema> {
  const reader = new SshReader(bytes)
  switch (reader.byte()) {
    case SSH.identities: {
      reader.end()
      return requestSchema.parse({ kind: 'identities' })
    }
    case SSH.sign: {
      const key = reader.string(),
        data = reader.string(),
        flags = reader.uint32()
      reader.end()
      return requestSchema.parse({ kind: 'sign', key, data, flags })
    }
    case SSH.extension: {
      const name = reader.text()
      if (name === 'query') {
        reader.end()
        return requestSchema.parse({ kind: 'query' })
      }
      if (name !== 'session-bind@openssh.com')
        return requestSchema.parse({ kind: 'unsupported', extension: true })
      const hostKey = reader.string(),
        session = reader.string(),
        signature = reader.string(),
        isForwarding = reader.boolean()
      reader.end()
      return requestSchema.parse({
        kind: 'bind',
        hostKey,
        session,
        signature,
        forwarding: isForwarding,
      })
    }
    default: {
      return requestSchema.parse({ kind: 'unsupported', extension: false })
    }
  }
}

/** Holds at most one bounded frame; callers drain synchronously before accepting another chunk. */
export class SshFramer {
  private pending = Buffer.alloc(0)
  push(chunk: Uint8Array, receive: (frame: Buffer) => void): void {
    let offset = 0
    while (offset < chunk.length) {
      let needed = SSH.uint32Bytes - this.pending.length
      if (needed <= 0) {
        const length = this.pending.readUInt32BE()
        if (length < 1 || length > VAULT_LIMITS.frameBytes) throw sshFailure()
        needed = SSH.uint32Bytes + length - this.pending.length
      }
      const old = this.pending
      const amount = Math.min(needed, chunk.length - offset)
      this.pending = Buffer.concat([old, chunk.subarray(offset, offset + amount)])
      old.fill(0)
      offset += amount
      if (this.pending.length < SSH.uint32Bytes) continue
      const length = this.pending.readUInt32BE()
      if (length < 1 || length > VAULT_LIMITS.frameBytes) throw sshFailure()
      if (this.pending.length !== SSH.uint32Bytes + length) continue
      const frame = this.pending
      this.pending = Buffer.alloc(0)
      try {
        receive(frame.subarray(SSH.uint32Bytes))
      } finally {
        frame.fill(0)
      }
    }
  }
  close(): void {
    this.pending.fill(0)
    this.pending = Buffer.alloc(0)
  }
}
