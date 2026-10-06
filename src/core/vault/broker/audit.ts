import { VaultBrokerQueue } from './queue'
import { createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  VAULT_AUDIT_MAX_BYTES,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import { vaultAuditRecordSchema, type VaultAuditRecord } from '../../../shared/vault'
import { type VaultAuditPort } from './ports'
import { UnixVaultPrivateFiles, isVaultFileMissing, type VaultPrivateFilesPort } from './files'

const hashSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const count = z.number().check(z.int(), z.nonnegative())
const anchorSchema = z.strictObject({
  generation: count,
  hash: hashSchema,
  baseGeneration: count,
  baseHash: hashSchema,
})
const inputSchema = z.omit(vaultAuditRecordSchema, {
  v: true,
  id: true,
  generation: true,
  previousHash: true,
  hash: true,
  mac: true,
})
type Anchor = z.infer<typeof anchorSchema>
/** C persists this authenticated anchor and holds the shared audit writer transaction. */
export interface VaultAuditAnchorPort {
  read(): Promise<Anchor>
  write(anchor: Anchor): Promise<void>
  transaction<T>(run: () => Promise<T>): Promise<T>
}
function hashed(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function unsigned(record: VaultAuditRecord): Omit<VaultAuditRecord, 'hash' | 'mac'> {
  const { hash: _hash, mac: _mac, ...result } = record
  return result
}
export class VaultAuditLog implements VaultAuditPort {
  private key: Buffer | null = null
  private records: VaultAuditRecord[] = []
  private anchor: Anchor | null = null
  private size = 0
  private readonly queue = new VaultBrokerQueue()
  private readonly path: string
  constructor(
    private readonly directory: string,
    private readonly anchors: VaultAuditAnchorPort,
    private readonly maxBytes = VAULT_AUDIT_MAX_BYTES,
    private readonly files: VaultPrivateFilesPort = new UnixVaultPrivateFiles(),
  ) {
    this.path = path.join(directory, 'audit.v1.jsonl')
  }
  private mac(hash: string): string {
    if (!this.key) throw new Error(UI_TEXT.vault.locked)
    return createHmac('sha256', this.key).update(hash).digest('hex')
  }
  private async serial<T>(run: () => Promise<T>): Promise<T> {
    return await this.queue.run(() => this.anchors.transaction(run))
  }
  private async verify(): Promise<void> {
    if (!this.key) throw new Error(UI_TEXT.vault.locked)
    const anchor = anchorSchema.parse(await this.anchors.read())
    let bytes: Buffer
    try {
      bytes = await this.files.read(this.path, this.maxBytes)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
      bytes = Buffer.alloc(0)
    }
    const text = bytes.toString('utf8')
    if (bytes.length > 0 && (!text.endsWith('\n') || text.includes('\n\n')))
      throw new Error(UI_TEXT.vault.noAccess)
    const records: VaultAuditRecord[] = []
    let previousHash = anchor.baseHash,
      generation = anchor.baseGeneration
    for (const line of text.split('\n')) {
      if (line === '') continue
      const record = vaultAuditRecordSchema.parse(JSON.parse(line))
      if (
        record.generation !== generation + 1 ||
        record.previousHash !== previousHash ||
        record.hash !== hashed(unsigned(record)) ||
        record.mac !== this.mac(record.hash)
      )
        throw new Error(UI_TEXT.vault.noAccess)
      previousHash = record.hash
      generation = record.generation
      records.push(record)
    }
    if (generation !== anchor.generation || previousHash !== anchor.hash)
      throw new Error(UI_TEXT.vault.noAccess)
    this.records = records
    this.anchor = anchor
    this.size = bytes.byteLength
  }
  private async appendRecord(input: Parameters<VaultAuditPort['append']>[0]): Promise<void> {
    await this.verify()
    const anchor = this.anchor
    if (!anchor || !this.key) throw new Error(UI_TEXT.vault.locked)
    const record = vaultAuditRecordSchema.parse({
      v: VAULT_FORMAT_VERSION,
      id: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
      generation: anchor.generation + 1,
      ...input,
      previousHash: anchor.hash,
      hash: '0'.repeat(VAULT_LIMITS.sha256Hex),
      mac: '0'.repeat(VAULT_LIMITS.sha256Hex),
    })
    record.hash = hashed(unsigned(record))
    record.mac = this.mac(record.hash)
    const line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
    if (line.byteLength > this.maxBytes) throw new Error(UI_TEXT.vault.noAccess)
    const next = { ...anchor, generation: record.generation, hash: record.hash }
    if (this.size + line.byteLength > this.maxBytes) {
      // The authenticated slot checkpoint retains the capped prefix's head, so rotation has no gap.
      next.baseGeneration = anchor.generation
      next.baseHash = anchor.hash
      await this.files.replace(this.path, line)
    } else await this.files.append(this.path, line)
    try {
      await this.anchors.write(next)
    } catch (error: unknown) {
      this.close()
      throw error
    }
    this.anchor = next
  }
  async open(vaultKey: Uint8Array): Promise<void> {
    this.close()
    if (
      vaultKey.byteLength !== VAULT_KEY_BYTES ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes <= 0 ||
      this.maxBytes > VAULT_AUDIT_MAX_BYTES
    )
      throw new Error(UI_TEXT.vault.noAccess)
    await this.files.directory(this.directory)
    const derived = new Uint8Array(
      hkdfSync('sha256', vaultKey, Buffer.alloc(0), 'muse-vault-audit-v1', VAULT_KEY_BYTES),
    )
    this.key = Buffer.alloc(VAULT_KEY_BYTES)
    this.key.set(derived)
    derived.fill(0)
    try {
      await this.serial(async () => {
        await this.verify()
      })
    } catch (error: unknown) {
      this.close()
      throw error
    }
  }
  async append(input: Parameters<VaultAuditPort['append']>[0]): Promise<void> {
    const snapshot = inputSchema.parse(input)
    await this.serial(async () => {
      await this.appendRecord(snapshot)
    })
  }
  async read(): Promise<readonly VaultAuditRecord[]> {
    return await this.serial(async () => {
      await this.verify()
      return structuredClone(this.records)
    })
  }
  close(): void {
    this.key?.fill(0)
    this.key = null
    this.anchor = null
    this.records = []
    this.size = 0
  }
}
