import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import * as z from 'zod/mini'
import type { NodeVaultCodec, NodeVaultRecord } from '../../../src/runtime/node/keyStore'

// A deliberately test-only codec. Its disk layout is NOT the M109 record format.
const slotSchema = z.strictObject({
  testOnly: z.literal(true),
  salt: z.string(),
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
})
const fixtureSchema = z.strictObject({
  generation: z.int(),
  slot: slotSchema,
  items: z.array(
    z.strictObject({
      id: z.enum(['provider', 'deploy']),
      nonce: z.string(),
      ciphertext: z.string(),
      tag: z.string(),
    }),
  ),
})
export class FixtureCodec implements NodeVaultCodec {
  readPassphraseSlot(bytes: string): unknown {
    const input: unknown = JSON.parse(bytes)
    return fixtureSchema.parse(input).slot
  }
  parse(bytes: string): NodeVaultRecord {
    const input: unknown = JSON.parse(bytes)
    const record = fixtureSchema.parse(input)
    return {
      ...record,
      items: record.items.map((item) => ({
        ...item,
        nonce: Buffer.from(item.nonce, 'base64'),
        ciphertext: Buffer.from(item.ciphertext, 'base64'),
        tag: Buffer.from(item.tag, 'base64'),
      })),
    }
  }
  serialize(record: NodeVaultRecord): string {
    return JSON.stringify({
      ...record,
      items: record.items.map((item) => ({
        ...item,
        nonce: Buffer.from(item.nonce).toString('base64'),
        ciphertext: Buffer.from(item.ciphertext).toString('base64'),
        tag: Buffer.from(item.tag).toString('base64'),
      })),
    })
  }
  createPassphraseSlot(key: Uint8Array, passphrase: string): Promise<unknown> {
    const salt = randomBytes(16)
    const derived = scryptSync(passphrase, salt, 32, { N: 1024 })
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', derived, nonce)
    const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
    derived.fill(0)
    return Promise.resolve({
      testOnly: true,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    })
  }
  unwrapPassphraseSlot(slot: unknown, passphrase: string): Promise<Uint8Array> {
    const parsed = slotSchema.parse(slot)
    const key = scryptSync(passphrase, Buffer.from(parsed.salt, 'base64'), 32, { N: 1024 })
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.nonce, 'base64'))
    cipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
    try {
      return Promise.resolve(
        Buffer.concat([cipher.update(Buffer.from(parsed.ciphertext, 'base64')), cipher.final()]),
      )
    } finally {
      key.fill(0)
    }
  }
}
