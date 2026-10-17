import { constants, unlinkSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  lstatIdentity,
  lstatIdentitySync,
  handleIdentity,
  sameFile,
  identityOf,
  type FileIdentity,
} from '../../fs/fileIdentity'
import { vaultItemSchema, type VaultItem, type VaultItemMetadata } from '../../../shared/vault'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type AmbientFile } from './ambient'
import { eraseItem, itemDigest } from './material'
import { type MigrationOwnerPort, type MigrationLease, VaultMigrationFault } from './ports'

const digestSchema = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const receiptSchema = z.strictObject({
  path: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  identity: z.strictObject({ dev: z.bigint(), ino: z.bigint() }),
  digest: digestSchema,
  items: z
    .array(
      z.strictObject({ id: z.string().check(z.regex(/^[a-f0-9]{32}$/u)), digest: digestSchema }),
    )
    .check(z.minLength(1), z.maxLength(VAULT_LIMITS.items)),
})
type ImportReceipt = z.infer<typeof receiptSchema>
export interface VaultFileImportPort {
  list(): Promise<readonly VaultItemMetadata[]>
  read(id: string): Promise<VaultItem>
  /** C verifies staged decrypted items, then atomically publishes the batch AND its encrypted
   * receipt under the migration writer. Verification failure publishes neither. Calls authorize
   * at physical commit. Receipts persist across processes; no plaintext journal is permitted. */
  writeBatch(
    items: readonly VaultItem[],
    receipt: { id: string; record: ImportReceipt },
    verify: (read: VaultFileImportPort['read']) => Promise<void>,
    authorize: () => void,
  ): Promise<void>
  readReceipt(id: string): Promise<unknown>
  forgetReceipt(id: string, authorize: () => void): Promise<void>
}

/** U/H call only from a user's Import/Keep/Delete action; neither agent tools nor models own this port. */
export class VaultFileImporter {
  private isDisposed = false
  private readonly cancelledReceipts = new Set<string>()
  constructor(
    private readonly vault: VaultFileImportPort,
    private readonly owner: MigrationOwnerPort,
  ) {}

  private assertActive(lease: MigrationLease): void {
    if (this.isDisposed) throw new VaultMigrationFault('invalid')
    lease.assertCurrent()
  }

  private async read(
    path: string,
  ): Promise<{ bytes: Buffer; identity: FileIdentity; size: bigint; mtimeNs: bigint }> {
    const before = await lstatIdentity(path)
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      Number(before.size) <= 0 ||
      before.size > VAULT_LIMITS.valueBytes
    )
      throw new VaultMigrationFault('invalid')
    let bytes: Buffer | undefined
    let isTransferred = false
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const held = await handleIdentity(file)
      if (
        !sameFile(before, held) ||
        !held.isFile() ||
        Number(held.size) <= 0 ||
        held.size > VAULT_LIMITS.valueBytes
      )
        throw new VaultMigrationFault('conflict')
      bytes = Buffer.alloc(Number(held.size))
      let offset = 0
      while (offset < bytes.byteLength) {
        const result = await file.read(bytes, offset, bytes.byteLength - offset, offset)
        if (result.bytesRead === 0) throw new VaultMigrationFault('conflict')
        offset += result.bytesRead
      }
      const after = await handleIdentity(file)
      const named = await lstatIdentity(path)
      if (
        !sameFile(held, named) ||
        after.size !== held.size ||
        after.mtimeNs !== held.mtimeNs ||
        named.size !== held.size ||
        named.mtimeNs !== held.mtimeNs
      )
        throw new VaultMigrationFault('conflict')
      await file.close()
      isTransferred = true
      return { bytes, identity: held, size: held.size, mtimeNs: held.mtimeNs }
    } finally {
      if (!isTransferred) {
        bytes?.fill(0)
        await file.close()
      }
    }
  }

  async import(
    file: AmbientFile,
    prepare: (kind: AmbientFile['kind'], bytes: Uint8Array) => Promise<readonly VaultItem[]>,
    assertUserAction: () => void,
  ): Promise<{ items: readonly VaultItemMetadata[]; receipt: string }> {
    const selection = { ...file }
    return await this.owner.run(async (lease) => {
      let source: Buffer | undefined
      let items: readonly VaultItem[] = []
      try {
        this.assertActive(lease)
        assertUserAction()
        const read = await this.read(selection.path)
        source = read.bytes
        this.assertActive(lease)
        const sourceDigest = createHash('sha256').update(source).digest('hex')
        items = await prepare(selection.kind, source)
        this.assertActive(lease)
        if (items.length === 0 || items.length > VAULT_LIMITS.items)
          throw new VaultMigrationFault('invalid')
        const metadata = items.map((item) => vaultItemSchema.parse(item).metadata)
        const ids = new Set(metadata.map((item) => item.id))
        const names = new Set(metadata.map((item) => item.name))
        if (ids.size !== items.length || names.size !== items.length)
          throw new VaultMigrationFault('conflict')
        const existing = await this.vault.list()
        this.assertActive(lease)
        if (existing.some((item) => ids.has(item.id) || names.has(item.name)))
          throw new VaultMigrationFault('conflict')
        const digests = items.map((item) => ({ id: item.metadata.id, digest: itemDigest(item) }))
        const receipt = randomUUID()
        const record = receiptSchema.parse({
          path: selection.path,
          identity: identityOf(read.identity),
          digest: sourceDigest,
          items: digests,
        })
        await this.vault.writeBatch(
          items,
          { id: receipt, record },
          async (readStaged) => {
            for (const expected of digests) {
              let copied: VaultItem | undefined
              try {
                copied = await readStaged(expected.id)
                this.assertActive(lease)
                if (itemDigest(copied) !== expected.digest)
                  throw new VaultMigrationFault('verification')
              } finally {
                eraseItem(copied)
              }
            }
          },
          () => {
            this.assertActive(lease)
            assertUserAction()
          },
        )
        this.assertActive(lease)
        return { items: structuredClone(metadata), receipt }
      } catch (error: unknown) {
        if (error instanceof VaultMigrationFault) throw error
        throw new VaultMigrationFault('storage')
      } finally {
        for (const item of items) eraseItem(item)
        source?.fill(0)
      }
    })
  }

  async keep(receipt: string): Promise<void> {
    // Cancel this window's in-flight Delete synchronously, before waiting on the writer.
    this.cancelledReceipts.add(receipt)
    await this.owner.run(async (lease) => {
      this.assertActive(lease)
      if (!receiptSchema.safeParse(await this.vault.readReceipt(receipt)).success)
        throw new VaultMigrationFault('invalid')
      await this.vault.forgetReceipt(receipt, () => {
        this.assertActive(lease)
      })
    })
  }
  async deleteSource(receipt: string, assertUserAction: () => void): Promise<void> {
    await this.owner.run(async (lease) => {
      const parsed = receiptSchema.safeParse(await this.vault.readReceipt(receipt))
      if (!parsed.success) throw new VaultMigrationFault('invalid')
      const saved = parsed.data
      const assertReceipt = () => {
        this.assertActive(lease)
        if (this.cancelledReceipts.has(receipt)) throw new VaultMigrationFault('invalid')
      }
      let source: Buffer | undefined
      try {
        assertReceipt()
        assertUserAction()
        const read = await this.read(saved.path)
        source = read.bytes
        assertReceipt()
        if (
          !sameFile(saved.identity, read.identity) ||
          createHash('sha256').update(source).digest('hex') !== saved.digest
        )
          throw new VaultMigrationFault('conflict')
        for (const expected of saved.items) {
          let item: VaultItem | undefined
          try {
            item = await this.vault.read(expected.id)
            assertReceipt()
            if (itemDigest(item) !== expected.digest) throw new VaultMigrationFault('verification')
          } finally {
            eraseItem(item)
          }
        }
        assertReceipt()
        assertUserAction()
        assertReceipt()
        const final = lstatIdentitySync(saved.path)
        if (
          !sameFile(saved.identity, final) ||
          final.isSymbolicLink() ||
          final.size !== read.size ||
          final.mtimeNs !== read.mtimeNs
        )
          throw new VaultMigrationFault('conflict')
        assertReceipt()
        unlinkSync(saved.path)
        assertReceipt()
        await this.vault.forgetReceipt(receipt, () => {
          this.assertActive(lease)
        })
      } catch (error: unknown) {
        if (error instanceof VaultMigrationFault) throw error
        throw new VaultMigrationFault('storage')
      } finally {
        source?.fill(0)
      }
    })
  }
  dispose(): void {
    this.isDisposed = true
    this.cancelledReceipts.clear()
  }
}
