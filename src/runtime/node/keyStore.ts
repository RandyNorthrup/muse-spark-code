import { NodeTransactions } from './transactions'
// D89 item encryption; M109 owns the disk/slot codec, supplied at integration.
// No fallback competing slot format and no plaintext persistence (M110-N-store).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import type { SecretStore } from '../../host/auth/credentialStore'
import {
  NODE_DEPLOY_KEY_NAME,
  NODE_KEYS_FILE,
  NODE_MAX_AUTH_BYTES,
  NODE_PROTOCOL_VERSION,
  NODE_STATE_MAX_BYTES,
  NODE_VAULT_KEY_BYTES,
  NODE_VAULT_NONCE_BYTES,
  NODE_VAULT_TAG_BYTES,
  SECRET_KEYS,
  UI_TEXT,
} from '../../shared/constants'
import { isMissingFile, type NodePrivateFiles } from './privateFiles'

const itemSchema = z.strictObject({
  id: z.enum(['provider', 'deploy']),
  nonce: z
    .instanceof(Uint8Array)
    .check(z.refine((bytes) => bytes.byteLength === NODE_VAULT_NONCE_BYTES)),
  tag: z
    .instanceof(Uint8Array)
    .check(z.refine((bytes) => bytes.byteLength === NODE_VAULT_TAG_BYTES)),
  ciphertext: z
    .instanceof(Uint8Array)
    .check(z.refine((bytes) => bytes.byteLength <= NODE_MAX_AUTH_BYTES)),
})
const recordSchema = z.strictObject({
  generation: z.int().check(z.positive()),
  slot: z.unknown(),
  items: z.array(itemSchema).check(
    z.maxLength(2),
    z.refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  ),
})
type EncryptedItem = z.infer<typeof itemSchema>
export type NodeVaultRecord = z.infer<typeof recordSchema>

/** Exact D89.2 passphrase-slot and item record formats belong to M109's reader. */
export interface NodeVaultCodec {
  readPassphraseSlot(bytes: string): unknown
  /** The encrypted index is opened only after the passphrase slot unwraps. */
  parse(bytes: string, key: Uint8Array): NodeVaultRecord
  serialize(record: NodeVaultRecord, key: Uint8Array): string
  createPassphraseSlot(key: Uint8Array, passphrase: string): Promise<unknown>
  unwrapPassphraseSlot(slot: unknown, passphrase: string): Promise<Uint8Array>
}

function kindOf(name: string): EncryptedItem['id'] {
  if (name === SECRET_KEYS.modelApiKey) return 'provider'
  if (name === NODE_DEPLOY_KEY_NAME) return 'deploy'
  throw new Error(UI_TEXT.nodeErrors.unsupported)
}
function itemKey(key: Uint8Array, id: EncryptedItem['id']): Buffer {
  return Buffer.from(hkdfSync('sha256', key, '', id, NODE_VAULT_KEY_BYTES))
}
function additionalData(id: EncryptedItem['id']): Buffer {
  return Buffer.from(
    JSON.stringify([id, id === 'provider' ? 'apiKey' : 'sshKey', NODE_PROTOCOL_VERSION]),
  )
}
function encrypt(key: Uint8Array, id: EncryptedItem['id'], value: string): EncryptedItem {
  const derived = itemKey(key, id)
  const plaintext = Buffer.from(value)
  try {
    if (plaintext.byteLength === 0 || plaintext.byteLength > NODE_MAX_AUTH_BYTES)
      throw new Error(UI_TEXT.nodeErrors.tooLarge)
    const nonce = randomBytes(NODE_VAULT_NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', derived, nonce)
    cipher.setAAD(additionalData(id))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return { id, nonce, ciphertext, tag: cipher.getAuthTag() }
  } finally {
    derived.fill(0)
    plaintext.fill(0)
  }
}
function decrypt(key: Uint8Array, item: EncryptedItem): Buffer {
  const derived = itemKey(key, item.id)
  try {
    const cipher = createDecipheriv('aes-256-gcm', derived, item.nonce)
    cipher.setAAD(additionalData(item.id))
    cipher.setAuthTag(item.tag)
    return Buffer.concat([cipher.update(item.ciphertext), cipher.final()])
  } finally {
    derived.fill(0)
  }
}

export class NodeInterimKeyStore implements SecretStore {
  private key: Uint8Array | undefined
  private record: NodeVaultRecord | undefined
  private epoch = 0
  private readonly transactions = new NodeTransactions()

  constructor(
    private readonly files: NodePrivateFiles,
    private readonly codec: NodeVaultCodec,
  ) {}

  private unlocked(): { key: Uint8Array; record: NodeVaultRecord } {
    if (this.key === undefined || this.record === undefined)
      throw new Error(UI_TEXT.nodeErrors.locked)
    return { key: this.key, record: this.record }
  }

  private async publish(record: NodeVaultRecord, key: Uint8Array): Promise<void> {
    const bytes = this.codec.serialize(recordSchema.parse(record), key)
    if (Buffer.byteLength(bytes) > NODE_STATE_MAX_BYTES)
      throw new Error(UI_TEXT.nodeErrors.tooLarge)
    await this.files.write(NODE_KEYS_FILE, bytes)
    this.record = record
  }

  get isSealed(): boolean {
    return this.key === undefined
  }

  seal(): void {
    this.epoch += 1
    this.key?.fill(0)
    this.key = undefined
  }

  async initialize(passphrase: string): Promise<void> {
    const epoch = this.epoch
    await this.transactions.enqueue(async () => {
      try {
        await this.files.read(NODE_KEYS_FILE, NODE_STATE_MAX_BYTES)
        throw new Error(UI_TEXT.nodeErrors.conflict)
      } catch (error: unknown) {
        if (!isMissingFile(error)) throw error
      }
      const key = randomBytes(NODE_VAULT_KEY_BYTES)
      try {
        const slot = await this.codec.createPassphraseSlot(key, passphrase)
        if (this.epoch !== epoch) throw new Error(UI_TEXT.nodeErrors.cancelled)
        await this.publish({ generation: 1, slot, items: [] }, key)
        // A new store is sealed too; owner must explicitly unlock it.
      } finally {
        key.fill(0)
      }
    })
  }

  async unlock(passphrase: string): Promise<void> {
    this.seal()
    const epoch = this.epoch
    await this.transactions.enqueue(async () => {
      const bytes = await this.files.read(NODE_KEYS_FILE, NODE_STATE_MAX_BYTES)
      const slot = this.codec.readPassphraseSlot(bytes)
      const key = await this.codec.unwrapPassphraseSlot(slot, passphrase)
      try {
        if (key.byteLength !== NODE_VAULT_KEY_BYTES)
          throw new Error(UI_TEXT.nodeErrors.invalidRequest)
        const record = recordSchema.parse(this.codec.parse(bytes, key))
        for (const item of record.items) {
          const value = decrypt(key, item)
          value.fill(0)
        }
        if (this.epoch !== epoch) throw new Error(UI_TEXT.nodeErrors.cancelled)
        this.key?.fill(0)
        this.key = Uint8Array.from(key)
        this.record = record
      } finally {
        key.fill(0)
      }
    })
  }

  async get(name: string): Promise<string | undefined> {
    return await this.transactions.enqueue(() => {
      const { key, record } = this.unlocked()
      const id = kindOf(name)
      const item = record.items.find((value) => value.id === id)
      if (item === undefined) return Promise.resolve(undefined)
      const value = decrypt(key, item)
      try {
        return Promise.resolve(new TextDecoder('utf-8', { fatal: true }).decode(value))
      } finally {
        value.fill(0)
      }
    })
  }

  async store(name: string, value: string): Promise<void> {
    await this.transactions.enqueue(async () => {
      const { key, record } = this.unlocked()
      const id = kindOf(name)
      const item = encrypt(key, id, value)
      await this.publish(
        {
          ...record,
          generation: record.generation + 1,
          items: [...record.items.filter((old) => old.id !== id), item],
        },
        key,
      )
    })
  }

  async delete(name: string): Promise<void> {
    await this.transactions.enqueue(async () => {
      const { key, record } = this.unlocked()
      const id = kindOf(name)
      await this.publish(
        {
          ...record,
          generation: record.generation + 1,
          items: record.items.filter((item) => item.id !== id),
        },
        key,
      )
    })
  }

  /** Replace slots and ciphertext before removal. Disk snapshots retain their own slots. */
  async destroy(): Promise<void> {
    this.seal()
    await this.transactions.enqueue(async () => {
      await this.files.write(NODE_KEYS_FILE, '')
      this.record = undefined
    })
  }
}
