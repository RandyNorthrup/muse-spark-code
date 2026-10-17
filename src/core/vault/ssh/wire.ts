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
  extensionResponse: 29,
  uint32Bytes: 4,
  openSshBlockBytes: 8,
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
  takeRemaining(): Buffer {
    return this.take(this.bytes.length - this.offset)
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

const responseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('success') }),
  z.strictObject({ kind: z.literal('failure') }),
  z.strictObject({ kind: z.literal('signature'), signature: bytesSchema }),
  z.strictObject({
    kind: z.literal('identities'),
    keys: z
      .array(
        z.strictObject({
          blob: bytesSchema,
          comment: z.string().check(z.maxLength(VAULT_LIMITS.text)),
        }),
      )
      .check(z.maxLength(VAULT_LIMITS.items)),
  }),
])
export function parseSshResponse(bytes: Buffer): z.infer<typeof responseSchema> {
  const reader = new SshReader(bytes),
    type = reader.byte()
  if ([SSH.success, SSH.failure, SSH.extensionFailure].includes(type)) {
    reader.end()
    return responseSchema.parse({ kind: type === SSH.success ? 'success' : 'failure' })
  }
  if (type === SSH.signAnswer) {
    const signature = reader.string()
    reader.end()
    return responseSchema.parse({ kind: 'signature', signature })
  }
  if (type !== SSH.identitiesAnswer) throw sshFailure()
  const count = reader.uint32()
  if (count > VAULT_LIMITS.items) throw sshFailure()
  const keys: { blob: Buffer; comment: string }[] = []
  for (let index = 0; index < count; index++)
    keys.push({ blob: reader.string(), comment: reader.text() })
  reader.end()
  return responseSchema.parse({ kind: 'identities', keys })
}

/** Holds at most one bounded frame; callers drain synchronously before accepting another chunk. */
export class SshFramer {
  private readonly header = Buffer.alloc(SSH.uint32Bytes)
  private headerOffset = 0
  private body: Buffer | null = null
  private bodyOffset = 0
  private isClosed = false
  push(chunk: Uint8Array, receive: (frame: Buffer) => void): void {
    let offset = 0
    while (offset < chunk.length && !this.isClosed) {
      if (!this.body) {
        const amount = Math.min(SSH.uint32Bytes - this.headerOffset, chunk.length - offset)
        this.header.set(chunk.subarray(offset, offset + amount), this.headerOffset)
        this.headerOffset += amount
        offset += amount
        if (this.headerOffset < SSH.uint32Bytes) continue
        const length = this.header.readUInt32BE()
        if (length < 1 || length > VAULT_LIMITS.frameBytes) throw sshFailure()
        this.body = Buffer.alloc(length)
        this.bodyOffset = 0
      }
      const body = this.body,
        amount = Math.min(body.length - this.bodyOffset, chunk.length - offset)
      body.set(chunk.subarray(offset, offset + amount), this.bodyOffset)
      this.bodyOffset += amount
      offset += amount
      if (this.bodyOffset !== body.length) continue
      this.body = null
      this.headerOffset = 0
      this.header.fill(0)
      try {
        receive(body)
      } finally {
        body.fill(0)
      }
    }
  }
  close(): void {
    this.isClosed = true
    this.header.fill(0)
    this.body?.fill(0)
    this.body = null
    this.bodyOffset = 0
    this.headerOffset = 0
  }
}
