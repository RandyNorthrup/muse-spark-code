import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomFillSync,
  timingSafeEqual,
} from 'node:crypto'
import * as z from 'zod/mini'
import {
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  VAULT_NONCE_BYTES,
  VAULT_TAG_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { vaultEncodedSchema, vaultMaterialSchema, type VaultItem } from '../../shared/vault'

/** Safe codes for callers; exceptions never include a value or parser input. */
export class VaultError extends Error {
  constructor(readonly code: 'invalid' | 'authentication' | 'rollback' | 'locked' | 'busy' | 'io') {
    super(code === 'rollback' ? UI_TEXT.vault.rollback : UI_TEXT.vault.noAccess)
    this.name = 'VaultError'
  }
}

export function ownedBytes(source: Uint8Array): Buffer<ArrayBuffer> {
  const copy = Buffer.alloc(source.byteLength)
  copy.set(source)
  return copy
}

export function encodeVaultJson(value: object): Buffer {
  const json = JSON.stringify(value)
  const bytes = Buffer.alloc(Buffer.byteLength(json))
  bytes.write(json)
  return bytes
}

export function randomVaultBytes(length: number = VAULT_KEY_BYTES): Buffer<ArrayBuffer> {
  return randomFillSync(Buffer.alloc(length))
}

export function areVaultBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export function decodeVaultBytes(encoded: string, length?: number): Buffer {
  if (!vaultEncodedSchema.safeParse(encoded).success) throw new VaultError('invalid')
  const bytes = ownedBytes(Buffer.from(encoded, 'base64'))
  if (bytes.toString('base64') !== encoded || (length !== undefined && bytes.length !== length)) {
    bytes.fill(0)
    throw new VaultError('invalid')
  }
  return bytes
}

export function hkdfSha256(
  key: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number = VAULT_KEY_BYTES,
): Buffer {
  const scratch = new Uint8Array(hkdfSync('sha256', key, salt, info, length))
  try {
    return ownedBytes(scratch)
  } finally {
    scratch.fill(0)
  }
}

export function vaultHmacSha256(key: Uint8Array, message: Uint8Array): Buffer<ArrayBuffer> {
  const scratch = createHmac('sha256', key).update(message).digest()
  try {
    return ownedBytes(scratch)
  } finally {
    scratch.fill(0)
  }
}

export const vaultBlockSchema = z.strictObject({
  generation: z.number().check(z.int(), z.nonnegative(), z.refine(Number.isSafeInteger)),
  nonce: vaultEncodedSchema,
  tag: vaultEncodedSchema,
  ciphertext: vaultEncodedSchema,
})
export type VaultBlock = z.infer<typeof vaultBlockSchema>
export interface VaultBlockContext {
  vaultId: string
  id: string
  kind: string
  generation: number
}

function contextBytes(context: VaultBlockContext): Buffer {
  return encodeVaultJson({
    v: VAULT_FORMAT_VERSION,
    vaultId: context.vaultId,
    id: context.id,
    kind: context.kind,
    generation: context.generation,
  })
}

/** Low-level primitives also allow published known-answer vectors. Store callers use sealVaultBlock. */
export function aesGcmSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { ciphertext: Buffer; tag: Buffer } {
  if (key.byteLength !== VAULT_KEY_BYTES || nonce.byteLength !== VAULT_NONCE_BYTES)
    throw new VaultError('invalid')
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const chunk = cipher.update(plaintext)
  const tail = cipher.final()
  try {
    return {
      ciphertext: ownedBytes(Buffer.concat([chunk, tail])),
      tag: ownedBytes(cipher.getAuthTag()),
    }
  } finally {
    chunk.fill(0)
    tail.fill(0)
  }
}

export function aesGcmOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array,
): Buffer {
  if (
    key.byteLength !== VAULT_KEY_BYTES ||
    nonce.byteLength !== VAULT_NONCE_BYTES ||
    tag.byteLength !== VAULT_TAG_BYTES
  )
    throw new VaultError('invalid')
  let chunk: Buffer | undefined
  let tail: Buffer | undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    chunk = decipher.update(ciphertext)
    tail = decipher.final()
    const plaintext = Buffer.alloc(chunk.length + tail.length)
    plaintext.set(chunk)
    plaintext.set(tail, chunk.length)
    return plaintext
  } catch {
    throw new VaultError('authentication')
  } finally {
    chunk?.fill(0)
    tail?.fill(0)
  }
}

export function sealVaultBlock(
  key: Uint8Array,
  context: VaultBlockContext,
  plaintext: Uint8Array,
): VaultBlock {
  const aad = contextBytes(context)
  const derived = hkdfSha256(key, Buffer.from(context.vaultId), aad)
  const nonce = randomVaultBytes(VAULT_NONCE_BYTES)
  try {
    const sealed = aesGcmSeal(derived, nonce, plaintext, aad)
    return {
      generation: context.generation,
      nonce: nonce.toString('base64'),
      tag: sealed.tag.toString('base64'),
      ciphertext: sealed.ciphertext.toString('base64'),
    }
  } finally {
    derived.fill(0)
    nonce.fill(0)
  }
}

export function openVaultBlock(
  key: Uint8Array,
  context: VaultBlockContext,
  input: unknown,
): Buffer {
  const parsed = vaultBlockSchema.safeParse(input)
  if (!parsed.success || parsed.data.generation !== context.generation)
    throw new VaultError('invalid')
  const aad = contextBytes(context)
  const derived = hkdfSha256(key, Buffer.from(context.vaultId), aad)
  const buffers: Buffer[] = []
  try {
    const nonce = decodeVaultBytes(parsed.data.nonce, VAULT_NONCE_BYTES)
    buffers.push(nonce)
    const tag = decodeVaultBytes(parsed.data.tag, VAULT_TAG_BYTES)
    buffers.push(tag)
    const ciphertext = decodeVaultBytes(parsed.data.ciphertext)
    buffers.push(ciphertext)
    return aesGcmOpen(derived, nonce, ciphertext, tag, aad)
  } finally {
    derived.fill(0)
    for (const bytes of buffers) bytes.fill(0)
  }
}

/** Secret byte fields are never converted to immutable strings. All other material fields are scalar or string arrays. */
export function encodeVaultMaterial(material: VaultItem['material']): Buffer {
  const parsed = vaultMaterialSchema.safeParse(material)
  if (!parsed.success) throw new VaultError('invalid')
  const descriptor: Record<string, unknown> = {}
  const fields: Uint8Array[] = []
  for (const [name, value] of Object.entries(parsed.data)) {
    if (value instanceof Uint8Array) {
      descriptor[name] = { bytes: fields.length }
      fields.push(value)
    } else descriptor[name] = value
  }
  const header = encodeVaultJson(descriptor)
  const width = Uint32Array.BYTES_PER_ELEMENT
  const output = Buffer.alloc(
    width + header.length + fields.reduce((total, field) => total + width + field.byteLength, 0),
  )
  output.writeUInt32BE(header.length)
  output.set(header, width)
  let offset = width + header.length
  for (const field of fields) {
    output.writeUInt32BE(field.byteLength, offset)
    offset += width
    output.set(field, offset)
    offset += field.byteLength
  }
  return output
}

export function eraseVaultMaterial(material: VaultItem['material']): void {
  for (const value of Object.values(material)) if (value instanceof Uint8Array) value.fill(0)
}

export function decodeVaultMaterial(bytes: Buffer): VaultItem['material'] {
  const fields: Buffer[] = []
  const width = Uint32Array.BYTES_PER_ELEMENT
  try {
    if (bytes.length < width) throw new VaultError('invalid')
    const headerLength = bytes.readUInt32BE()
    if (headerLength > VAULT_LIMITS.frameBytes || headerLength > bytes.length - width)
      throw new VaultError('invalid')
    const descriptor: unknown = JSON.parse(bytes.toString('utf8', width, width + headerLength))
    if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor))
      throw new VaultError('invalid')
    let offset = width + headerLength
    while (offset < bytes.length) {
      if (fields.length >= VAULT_LIMITS.names) throw new VaultError('invalid')
      if (bytes.length - offset < width) throw new VaultError('invalid')
      const length = bytes.readUInt32BE(offset)
      offset += width
      if (length === 0 || length > VAULT_LIMITS.valueBytes || length > bytes.length - offset)
        throw new VaultError('invalid')
      fields.push(ownedBytes(bytes.subarray(offset, offset + length)))
      offset += length
    }
    const entries: [string, unknown][] = []
    const used = new Set<number>()
    for (const [name, value] of Object.entries(descriptor)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const reference = z
          .strictObject({ bytes: z.number().check(z.int(), z.nonnegative()) })
          .safeParse(value)
        if (!reference.success || used.has(reference.data.bytes)) throw new VaultError('invalid')
        const field = fields[reference.data.bytes]
        if (!field) throw new VaultError('invalid')
        used.add(reference.data.bytes)
        entries.push([name, field])
      } else entries.push([name, value])
    }
    const material = vaultMaterialSchema.safeParse(Object.fromEntries(entries))
    if (!material.success || used.size !== fields.length) throw new VaultError('invalid')
    return material.data
  } catch {
    for (const field of fields) field.fill(0)
    throw new VaultError('invalid')
  }
}
