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
import { type VaultAuditPort, type VaultAuditWriter } from './ports'
import {
  UnixVaultPrivateFiles,
  isVaultFileMissing,
  type VaultPrivateFilesPort,
  type VaultFileWriter,
} from './files'

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
class VaultAuditWriterSession implements VaultAuditWriter {
  private writer: VaultFileWriter | null = null
  private isClosed = false
  private key: Buffer | null = null
  private records: VaultAuditRecord[] = []
  private anchor: Anchor | null = null
  private size = 0
  private tail: Promise<unknown> = Promise.resolve()
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
    const previous = this.tail
    const result = (async () => {
      try {
        await previous
      } catch {
        /* The previous caller owns its failure. */
      }
      return await this.anchors.transaction(async () => {
        this.check()
        return await run()
      })
    })()
    this.tail = result
    return await result
  }
  private check(): void {
    if (!this.key) throw new Error(UI_TEXT.vault.locked)
  }
  private async verify(): Promise<void> {
    this.check()
    const anchor = anchorSchema.parse(await this.anchors.read())
    this.check()
    let bytes: Buffer
    try {
      bytes = await this.files.read(this.path, this.maxBytes)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
      bytes = Buffer.alloc(0)
    }
    this.check()
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
  private async appendRecord(
    input: Parameters<VaultAuditPort['append']>[0],
    canCommit: () => boolean,
  ): Promise<void> {
    await this.verify()
    this.check()
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
    this.check()
    if (!canCommit()) return
    const writer = this.writer
    if (!writer) throw new Error(UI_TEXT.vault.locked)
    if (this.size + line.byteLength > this.maxBytes) {
      // The authenticated slot checkpoint retains the capped prefix's head, so rotation has no gap.
      next.baseGeneration = anchor.generation
      next.baseHash = anchor.hash
      writer.replace(line)
    } else writer.append(line)
    this.check()
    try {
      // Physical commit already happened in this tick. Finish its anchor under the writer transaction, even on close.
      await this.anchors.write(next)
    } catch (error: unknown) {
      this.close()
      throw error
    }
    this.anchor = next
  }
  private checkOpen(): void {
    if (this.isClosed) throw new Error(UI_TEXT.vault.locked)
  }
  async open(vaultKey: Uint8Array): Promise<void> {
    if (this.isClosed) throw new Error(UI_TEXT.vault.locked)
    if (
      vaultKey.byteLength !== VAULT_KEY_BYTES ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes <= 0 ||
      this.maxBytes > VAULT_AUDIT_MAX_BYTES
    )
      throw new Error(UI_TEXT.vault.noAccess)
    await this.files.directory(this.directory)
    this.checkOpen()
    const derived = new Uint8Array(
      hkdfSync('sha256', vaultKey, Buffer.alloc(0), 'muse-vault-audit-v1', VAULT_KEY_BYTES),
    )
    try {
      this.writer = this.files.writer(this.path)
      this.key = Buffer.alloc(VAULT_KEY_BYTES)
      this.key.set(derived)
      derived.fill(0)
      await this.serial(async () => {
        await this.verify()
      })
    } catch (error: unknown) {
      this.close()
      throw error
    } finally {
      derived.fill(0)
    }
  }
  async append(
    input: Parameters<VaultAuditPort['append']>[0],
    canCommit: () => boolean = () => true,
  ): Promise<void> {
    const snapshot = inputSchema.parse(input)
    await this.serial(async () => {
      await this.appendRecord(snapshot, canCommit)
    })
  }
  async read(): Promise<readonly VaultAuditRecord[]> {
    return await this.serial(async () => {
      await this.verify()
      return structuredClone(this.records)
    })
  }
  close(): void {
    this.isClosed = true
    this.writer?.close()
    this.writer = null
    this.key?.fill(0)
    this.key = null
    this.anchor = null
    this.records = []
    this.size = 0
  }
}
/** A factory plus the direct-reader facade. Every asynchronous operation captures one isolated session. */
export class VaultAuditLog implements VaultAuditPort {
  private current: VaultAuditWriter | null = null
  constructor(
    private readonly directory: string,
    private readonly anchors: VaultAuditAnchorPort,
    private readonly maxBytes = VAULT_AUDIT_MAX_BYTES,
    private readonly files: VaultPrivateFilesPort = new UnixVaultPrivateFiles(),
  ) {}
  async openWriter(vaultKey: Uint8Array): Promise<VaultAuditWriter> {
    const writer = new VaultAuditWriterSession(
      this.directory,
      this.anchors,
      this.maxBytes,
      this.files,
    )
    await writer.open(vaultKey)
    return writer
  }
  async open(vaultKey: Uint8Array): Promise<void> {
    this.close()
    const writer = new VaultAuditWriterSession(
      this.directory,
      this.anchors,
      this.maxBytes,
      this.files,
    )
    this.current = writer
    await writer.open(vaultKey)
  }
  async append(record: Parameters<VaultAuditPort['append']>[0]): Promise<void> {
    const writer = this.current
    if (!writer) throw new Error(UI_TEXT.vault.locked)
    await writer.append(record)
  }
  async read(): Promise<readonly VaultAuditRecord[]> {
    const writer = this.current
    if (!writer) throw new Error(UI_TEXT.vault.locked)
    return await writer.read()
  }
  close(): void {
    this.current?.close()
    this.current = null
  }
}
