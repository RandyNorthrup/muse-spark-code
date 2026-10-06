import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { VAULT_FORMAT_VERSION, VAULT_KEY_BYTES, VAULT_LIMITS } from '../../shared/constants'
import {
  vaultItemMetadataSchema,
  vaultItemSchema,
  vaultSlotRecordSchema,
  type VaultItem,
  type VaultSlotRecord,
  type VaultStorePort,
} from '../../shared/vault'
import { handleIdentity, lstatIdentity, sameFile } from '../fs/fileIdentity'
import {
  decodeVaultBytes,
  decodeVaultMaterial,
  encodeVaultMaterial,
  encodeVaultJson,
  areVaultBytesEqual,
  eraseVaultMaterial,
  hkdfSha256,
  openVaultBlock,
  ownedBytes,
  randomVaultBytes,
  sealVaultBlock,
  VaultError,
  vaultBlockSchema,
  vaultHmacSha256,
} from './crypto'

type VaultFileName = 'vault.v1' | 'slots.v1' | 'pending.v1'
export interface VaultFilePort {
  readonly maxBytes: number
  read(name: VaultFileName): Promise<Buffer | null>
  writeAtomic(name: VaultFileName, data: Uint8Array): Promise<void>
  remove(name: VaultFileName): Promise<void>
  withWriter<T>(operation: () => Promise<T>): Promise<T>
}
export interface VaultGenerationState {
  generation: number
  auditGeneration: number
  auditHead: string
}
/** P/B must bind this to durable monotonic state outside the replaceable vault file. */
export interface VaultGenerationPort {
  minimum(vaultId: string): Promise<VaultGenerationState | null>
  advance(vaultId: string, state: VaultGenerationState): Promise<void>
}
/** Mandatory on Windows. P verifies/protects owner-only DACLs without inventing a helper frame here. */
export interface VaultFileSecurityPort {
  protect(path: string, kind: 'directory' | 'file'): Promise<void>
  verify(path: string, kind: 'directory' | 'file'): Promise<void>
}

export class NodeVaultFiles implements VaultFilePort {
  constructor(
    private readonly root: string,
    readonly maxBytes: number,
    private readonly security?: VaultFileSecurityPort,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    if (
      !path.isAbsolute(root) ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      (platform === 'win32' && !security)
    )
      throw new VaultError('invalid')
  }
  private async verify(path: string, kind: 'directory' | 'file'): Promise<void> {
    const sample = await lstat(path)
    if (
      sample.isSymbolicLink() ||
      (kind === 'directory' ? !sample.isDirectory() : !sample.isFile())
    )
      throw new VaultError('io')
    if (this.platform !== 'win32') {
      const permitted =
        constants.S_IRUSR | constants.S_IWUSR | (kind === 'directory' ? constants.S_IXUSR : 0)
      if (
        typeof process.getuid !== 'function' ||
        sample.uid !== process.getuid() ||
        (sample.mode & (constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO)) !== permitted
      )
        throw new VaultError('io')
    }
    await this.security?.verify(path, kind)
  }
  private async directory(): Promise<void> {
    const mode = constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR
    const created = await mkdir(this.root, { recursive: true, mode })
    if ((await realpath(this.root)) !== path.resolve(this.root)) throw new VaultError('io')
    if (created !== undefined) await this.security?.protect(this.root, 'directory')
    await this.verify(this.root, 'directory')
  }
  private async syncDirectory(): Promise<void> {
    // Windows MoveFileEx/Node rename-over-existing is rerun on Win11; Node cannot fsync a Windows directory.
    if (this.platform === 'win32') return
    const directory = await open(this.root, constants.O_RDONLY)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
  async read(name: VaultFileName): Promise<Buffer | null> {
    await this.directory()
    const file = path.join(this.root, name)
    let handle
    let bytes: Buffer | undefined
    try {
      await this.verify(file, 'file')
      const identity = await lstatIdentity(file)
      const noFollow: unknown = Reflect.get(constants, 'O_NOFOLLOW')
      handle = await open(file, constants.O_RDONLY | (typeof noFollow === 'number' ? noFollow : 0))
      const held = await handleIdentity(handle)
      if (!sameFile(identity, held) || !held.isFile() || held.size > BigInt(this.maxBytes))
        throw new VaultError('io')
      bytes = Buffer.alloc(Number(held.size))
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (result.bytesRead === 0) throw new VaultError('io')
        offset += result.bytesRead
      }
      const after = await handleIdentity(handle)
      if (!sameFile(held, after) || after.size !== held.size || after.mtimeNs !== held.mtimeNs)
        throw new VaultError('io')
      return bytes
    } catch (error) {
      bytes?.fill(0)
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null
      throw new VaultError('io')
    } finally {
      await handle?.close()
    }
  }
  async writeAtomic(name: VaultFileName, data: Uint8Array): Promise<void> {
    if (data.byteLength > this.maxBytes) throw new VaultError('invalid')
    await this.directory()
    const stage = path.join(
      this.root,
      `${name}.${randomVaultBytes(VAULT_LIMITS.idBytes).toString('hex')}.stage`,
    )
    const handle = await open(stage, 'wx', constants.S_IRUSR | constants.S_IWUSR)
    const identity = await handleIdentity(handle)
    try {
      await this.security?.protect(stage, 'file')
      await this.verify(stage, 'file')
      await handle.writeFile(data)
      await handle.sync()
      await handle.close()
      if (!sameFile(identity, await lstatIdentity(stage))) throw new VaultError('io')
      await rename(stage, path.join(this.root, name))
      await this.verify(path.join(this.root, name), 'file')
      await this.syncDirectory()
    } catch {
      throw new VaultError('io')
    } finally {
      await handle.close()
      try {
        if (sameFile(identity, await lstatIdentity(stage))) await unlink(stage)
      } catch {
        /* A published or replaced stage is never deleted. */
      }
    }
  }
  async remove(name: VaultFileName): Promise<void> {
    await this.directory()
    const file = path.join(this.root, name)
    await this.verify(file, 'file')
    await unlink(file)
    await this.syncDirectory()
  }
  async withWriter<T>(operation: () => Promise<T>): Promise<T> {
    await this.directory()
    const file = path.join(this.root, 'writer.lock')
    let handle
    try {
      handle = await open(file, 'wx', constants.S_IRUSR | constants.S_IWUSR)
    } catch {
      throw new VaultError('busy')
    }
    const identity = await handleIdentity(handle)
    try {
      await this.security?.protect(file, 'file')
      await this.verify(file, 'file')
      await handle.sync()
      return await operation()
    } finally {
      await handle.close()
      if (sameFile(identity, await lstatIdentity(file))) await unlink(file)
      else await Promise.reject(new VaultError('io'))
    }
  }
}

const generation = z.number().check(z.int(), z.nonnegative(), z.refine(Number.isSafeInteger))
const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const documentSchema = z.strictObject({
  v: z.literal(VAULT_FORMAT_VERSION),
  vaultId: id,
  generation,
  index: vaultBlockSchema,
  items: z
    .array(z.strictObject({ id, block: vaultBlockSchema }))
    .check(z.maxLength(VAULT_LIMITS.items)),
})
const slotsSchema = z.strictObject({
  v: z.literal(VAULT_FORMAT_VERSION),
  vaultId: id,
  generation,
  auditGeneration: generation,
  auditHead: digest,
  records: z.array(vaultSlotRecordSchema).check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
  mac: z.string(),
})
const indexSchema = z.strictObject({
  items: z
    .array(z.strictObject({ metadata: vaultItemMetadataSchema, generation }))
    .check(z.maxLength(VAULT_LIMITS.items)),
})
const snapshotSchema = z.strictObject({ document: documentSchema, slots: slotsSchema })
type Document = z.infer<typeof documentSchema>
type Slots = z.infer<typeof slotsSchema>
type Index = z.infer<typeof indexSchema>
export interface VaultSnapshot {
  document: Document
  slots: Slots
}
export interface VaultStoreOptions {
  files: VaultFilePort
  anchor: VaultGenerationPort
  key: Uint8Array
}

function parseJson(bytes: Buffer): unknown {
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return parsed
  } catch {
    throw new VaultError('invalid')
  }
}
function slotMac(key: Uint8Array, slots: Omit<Slots, 'mac'>): Buffer {
  const derived = hkdfSha256(key, Buffer.from(slots.vaultId), Buffer.from('vault-slots-v1'))
  try {
    return vaultHmacSha256(derived, encodeVaultJson(slots))
  } finally {
    derived.fill(0)
  }
}
function authenticateSlots(key: Uint8Array, input: unknown): Slots {
  const parsed = slotsSchema.safeParse(input)
  if (!parsed.success) throw new VaultError('invalid')
  const { mac, ...body } = parsed.data
  const expected = slotMac(key, body)
  const actual = decodeVaultBytes(mac, VAULT_KEY_BYTES)
  try {
    if (
      !areVaultBytesEqual(expected, actual) ||
      new Set(body.records.map((slot) => slot.id)).size !== body.records.length ||
      body.records.some(
        (slot) =>
          slot.vaultId !== body.vaultId ||
          slot.lastGeneration !== body.generation ||
          slot.auditGeneration !== body.auditGeneration ||
          slot.auditHead !== body.auditHead,
      )
    )
      throw new VaultError('authentication')
    return parsed.data
  } finally {
    expected.fill(0)
    actual.fill(0)
  }
}
function openIndex(key: Uint8Array, document: Document): Index {
  const bytes = openVaultBlock(
    key,
    { vaultId: document.vaultId, id: 'index', kind: 'index', generation: document.generation },
    document.index,
  )
  try {
    const parsed = indexSchema.safeParse(parseJson(bytes))
    if (!parsed.success || parsed.data.items.length !== document.items.length)
      throw new VaultError('invalid')
    const ids = new Set<string>()
    const names = new Set<string>()
    const blocks = new Map(document.items.map((entry) => [entry.id, entry.block]))
    for (const item of parsed.data.items) {
      const block = blocks.get(item.metadata.id)
      if (
        !block ||
        ids.has(item.metadata.id) ||
        names.has(item.metadata.name) ||
        item.generation < 1 ||
        item.generation > document.generation ||
        item.generation !== block.generation
      )
        throw new VaultError('invalid')
      ids.add(item.metadata.id)
      names.add(item.metadata.name)
    }
    return parsed.data
  } finally {
    bytes.fill(0)
  }
}
function validateSnapshot(
  key: Uint8Array,
  input: VaultSnapshot,
): { snapshot: VaultSnapshot; index: Index } {
  const parsed = documentSchema.safeParse(input.document)
  if (!parsed.success) throw new VaultError('invalid')
  const slots = authenticateSlots(key, input.slots)
  if (parsed.data.vaultId !== slots.vaultId || parsed.data.generation !== slots.generation)
    throw new VaultError('rollback')
  return { snapshot: { document: parsed.data, slots }, index: openIndex(key, parsed.data) }
}

/** Owns only the key; ciphertext snapshots are reloaded under the cross-process writer lock on every operation. */
export class VaultStore implements VaultStorePort {
  /** Unauthenticated unlock hints. Opening with the unwrapped key must authenticate the document and anchor. */
  static async slotRecords(
    files: VaultFilePort,
    vaultId: string,
  ): Promise<readonly VaultSlotRecord[]> {
    return await files.withWriter(async () => {
      const bytes = await files.read('slots.v1')
      const pending = bytes ? null : await files.read('pending.v1')
      if (pending) {
        try {
          const parsed = snapshotSchema.safeParse(parseJson(pending))
          if (
            !parsed.success ||
            parsed.data.document.vaultId !== vaultId ||
            parsed.data.slots.vaultId !== vaultId ||
            parsed.data.slots.records.some((slot) => slot.vaultId !== vaultId)
          )
            throw new VaultError('invalid')
          return parsed.data.slots.records
        } finally {
          pending.fill(0)
        }
      }
      if (!bytes) throw new VaultError('invalid')
      try {
        const parsed = slotsSchema.safeParse(parseJson(bytes))
        if (
          !parsed.success ||
          parsed.data.vaultId !== vaultId ||
          parsed.data.records.some((record) => record.vaultId !== vaultId)
        )
          throw new VaultError('invalid')
        return parsed.data.records
      } finally {
        bytes.fill(0)
      }
    })
  }
  static async create(
    options: VaultStoreOptions,
    vaultId: string,
    records: readonly VaultSlotRecord[],
  ): Promise<VaultStore> {
    const store = new VaultStore(options, vaultId)
    try {
      await options.files.withWriter(async () => {
        if (
          (await options.files.read('vault.v1')) ||
          (await options.files.read('slots.v1')) ||
          (await options.files.read('pending.v1')) ||
          (await options.anchor.minimum(vaultId))
        )
          throw new VaultError('invalid')
        await store.publish({ items: [] }, [], {
          v: VAULT_FORMAT_VERSION,
          vaultId,
          generation: 0,
          auditGeneration: 0,
          auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
          records: [...records],
          mac: '',
        })
      })
      return store
    } catch (error) {
      store.lock()
      throw error
    }
  }
  static async open(options: VaultStoreOptions, vaultId: string): Promise<VaultStore> {
    const store = new VaultStore(options, vaultId)
    try {
      await options.files.withWriter(async () => {
        await store.load()
      })
      return store
    } catch (error) {
      store.lock()
      throw error
    }
  }
  static async restore(
    options: VaultStoreOptions,
    input: unknown,
    records?: readonly VaultSlotRecord[],
  ): Promise<VaultStore> {
    const shape = snapshotSchema.safeParse(input)
    if (!shape.success) throw new VaultError('invalid')
    const validated = validateSnapshot(options.key, shape.data)
    const store = new VaultStore(options, validated.snapshot.document.vaultId)
    try {
      await options.files.withWriter(async () => {
        await store.recoverPending()
        const minimum = await options.anchor.minimum(store.vaultId)
        const current = await options.files.read('vault.v1')
        const currentSlots = await options.files.read('slots.v1')
        try {
          if ((current === null) !== (currentSlots === null)) throw new VaultError('invalid')
          if (current && currentSlots) {
            const previous = documentSchema.safeParse(parseJson(current))
            const previousSlots = authenticateSlots(store.active(), parseJson(currentSlots))
            if (
              !previous.success ||
              previous.data.vaultId !== store.vaultId ||
              previousSlots.vaultId !== store.vaultId
            )
              throw new VaultError('invalid')
            if (
              previous.data.generation > shape.data.document.generation ||
              previousSlots.generation > shape.data.document.generation
            )
              throw new VaultError('rollback')
          }
          if (
            minimum &&
            (shape.data.document.generation < minimum.generation ||
              shape.data.slots.auditGeneration < minimum.auditGeneration ||
              (shape.data.slots.auditGeneration === minimum.auditGeneration &&
                shape.data.slots.auditHead !== minimum.auditHead))
          )
            throw new VaultError('rollback')
          // Authenticate every item before advancing an anchor or publishing anything.
          for (const item of validated.index.items)
            eraseVaultMaterial(
              store.material(validated.snapshot.document, validated.index, item.metadata.id)
                .material,
            )
          await store.publish(validated.index, validated.snapshot.document.items, {
            ...validated.snapshot.slots,
            records: records ? [...records] : validated.snapshot.slots.records,
          })
        } finally {
          current?.fill(0)
          currentSlots?.fill(0)
        }
      })
      return store
    } catch (error) {
      store.lock()
      throw error
    }
  }
  private readonly key: Buffer
  private locked = false
  private readonly options: Omit<VaultStoreOptions, 'key'>
  private constructor(
    options: VaultStoreOptions,
    readonly vaultId: string,
  ) {
    if (options.key.byteLength !== VAULT_KEY_BYTES) throw new VaultError('invalid')
    this.key = ownedBytes(options.key)
    this.options = { files: options.files, anchor: options.anchor }
  }
  private active(): Buffer {
    if (this.locked) throw new VaultError('locked')
    return this.key
  }
  private async load(): Promise<{ snapshot: VaultSnapshot; index: Index }> {
    this.active()
    await this.recoverPending()
    const documentBytes = await this.options.files.read('vault.v1')
    const slotsBytes = await this.options.files.read('slots.v1')
    if (!documentBytes || !slotsBytes) throw new VaultError('invalid')
    try {
      const document = documentSchema.safeParse(parseJson(documentBytes))
      const slots = slotsSchema.safeParse(parseJson(slotsBytes))
      if (!document.success || !slots.success) throw new VaultError('invalid')
      const result = validateSnapshot(this.active(), { document: document.data, slots: slots.data })
      const minimum = await this.options.anchor.minimum(this.vaultId)
      this.active()
      if (
        !minimum ||
        result.snapshot.document.vaultId !== this.vaultId ||
        result.snapshot.document.generation !== minimum.generation ||
        result.snapshot.slots.auditGeneration !== minimum.auditGeneration ||
        result.snapshot.slots.auditHead !== minimum.auditHead
      )
        throw new VaultError('rollback')
      return result
    } finally {
      documentBytes.fill(0)
      slotsBytes.fill(0)
    }
  }
  private async recoverPending(): Promise<void> {
    const bytes = await this.options.files.read('pending.v1')
    if (!bytes) return
    try {
      const parsed = snapshotSchema.safeParse(parseJson(bytes))
      if (!parsed.success || parsed.data.document.vaultId !== this.vaultId)
        throw new VaultError('invalid')
      const { snapshot, index } = validateSnapshot(this.active(), parsed.data)
      const minimum = await this.options.anchor.minimum(this.vaultId)
      this.active()
      if (
        snapshot.document.generation !== (minimum?.generation ?? 0) &&
        snapshot.document.generation !== (minimum?.generation ?? 0) + 1
      )
        throw new VaultError('rollback')
      if (
        minimum &&
        (snapshot.slots.auditGeneration < minimum.auditGeneration ||
          (snapshot.slots.auditGeneration === minimum.auditGeneration &&
            snapshot.slots.auditHead !== minimum.auditHead))
      )
        throw new VaultError('rollback')
      if (
        snapshot.document.generation === minimum?.generation &&
        (snapshot.slots.auditGeneration !== minimum.auditGeneration ||
          snapshot.slots.auditHead !== minimum.auditHead)
      )
        throw new VaultError('rollback')
      for (const item of index.items)
        eraseVaultMaterial(this.material(snapshot.document, index, item.metadata.id).material)
      if (!minimum || snapshot.document.generation > minimum.generation)
        await this.options.anchor.advance(this.vaultId, {
          generation: snapshot.document.generation,
          auditGeneration: snapshot.slots.auditGeneration,
          auditHead: snapshot.slots.auditHead,
        })
      this.active()
      await this.options.files.writeAtomic('slots.v1', encodeVaultJson(snapshot.slots))
      this.active()
      await this.options.files.writeAtomic('vault.v1', encodeVaultJson(snapshot.document))
      this.active()
      await this.options.files.remove('pending.v1')
    } finally {
      bytes.fill(0)
    }
  }
  private async publish(index: Index, items: Document['items'], prior: Slots): Promise<void> {
    const next = prior.generation + 1
    if (!Number.isSafeInteger(next)) throw new VaultError('invalid')
    const body: Omit<Slots, 'mac'> = {
      v: VAULT_FORMAT_VERSION,
      vaultId: this.vaultId,
      generation: next,
      auditGeneration: prior.auditGeneration,
      auditHead: prior.auditHead,
      records: prior.records.map((record) => ({
        ...record,
        lastGeneration: next,
        auditGeneration: prior.auditGeneration,
        auditHead: prior.auditHead,
      })),
    }
    const parsedBody = slotsSchema.safeParse({ ...body, mac: '' })
    if (
      !parsedBody.success ||
      body.records.some((slot) => slot.vaultId !== this.vaultId) ||
      new Set(body.records.map((slot) => slot.id)).size !== body.records.length
    )
      throw new VaultError('invalid')
    const mac = slotMac(this.active(), body)
    const plaintext = encodeVaultJson(index)
    let documentBytes: Buffer | undefined
    let slotBytes: Buffer | undefined
    let pendingBytes: Buffer | undefined
    try {
      const document: Document = {
        v: VAULT_FORMAT_VERSION,
        vaultId: this.vaultId,
        generation: next,
        index: sealVaultBlock(
          this.active(),
          { vaultId: this.vaultId, id: 'index', kind: 'index', generation: next },
          plaintext,
        ),
        items,
      }
      if (!documentSchema.safeParse(document).success) throw new VaultError('invalid')
      openIndex(this.active(), document)
      documentBytes = encodeVaultJson(document)
      slotBytes = encodeVaultJson({ ...body, mac: mac.toString('base64') })
      pendingBytes = encodeVaultJson({ document, slots: { ...body, mac: mac.toString('base64') } })
      if (
        documentBytes.length > this.options.files.maxBytes ||
        slotBytes.length > this.options.files.maxBytes ||
        pendingBytes.length > this.options.files.maxBytes
      )
        throw new VaultError('invalid')
      await this.options.files.writeAtomic('pending.v1', pendingBytes)
      this.active()
      await this.options.anchor.advance(this.vaultId, {
        generation: next,
        auditGeneration: body.auditGeneration,
        auditHead: body.auditHead,
      })
      this.active()
      await this.options.files.writeAtomic('slots.v1', slotBytes)
      this.active()
      await this.options.files.writeAtomic('vault.v1', documentBytes)
      this.active()
      await this.options.files.remove('pending.v1')
    } catch (error) {
      this.lock()
      throw error
    } finally {
      mac.fill(0)
      plaintext.fill(0)
      documentBytes?.fill(0)
      slotBytes?.fill(0)
      pendingBytes?.fill(0)
    }
  }
  private material(document: Document, index: Index, id: string): VaultItem {
    const descriptor = index.items.find((entry) => entry.metadata.id === id)
    const entry = document.items.find((candidate) => candidate.id === id)
    if (!descriptor || !entry) throw new VaultError('invalid')
    const plaintext = openVaultBlock(
      this.active(),
      {
        vaultId: this.vaultId,
        id,
        kind: descriptor.metadata.kind,
        generation: descriptor.generation,
      },
      entry.block,
    )
    try {
      const material = decodeVaultMaterial(plaintext)
      if (material.kind !== descriptor.metadata.kind) {
        eraseVaultMaterial(material)
        throw new VaultError('invalid')
      }
      return { metadata: descriptor.metadata, material }
    } finally {
      plaintext.fill(0)
    }
  }
  lock(): void {
    this.locked = true
    this.key.fill(0)
  }
  async list() {
    const result = await this.options.files.withWriter(async () => {
      const loaded = await this.load()
      return loaded.index.items.map((item) => item.metadata)
    })
    this.active()
    return result
  }
  async read(id: string): Promise<VaultItem> {
    let item: VaultItem | undefined
    try {
      await this.options.files.withWriter(async () => {
        const { snapshot, index } = await this.load()
        item = this.material(snapshot.document, index, id)
      })
      this.active()
      if (!item) throw new VaultError('invalid')
      return item
    } catch (error) {
      if (item) eraseVaultMaterial(item.material)
      throw error
    }
  }
  async write(input: VaultItem): Promise<void> {
    // Own the input before the first await; the caller cannot change the approved item mid-write.
    const parsed = vaultItemSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    const plaintext = encodeVaultMaterial(parsed.data.material)
    try {
      await this.options.files.withWriter(async () => {
        const { snapshot, index } = await this.load()
        const { metadata } = parsed.data
        const remaining = index.items.filter((item) => item.metadata.id !== metadata.id)
        if (
          remaining.some((item) => item.metadata.name === metadata.name) ||
          remaining.length >= VAULT_LIMITS.items
        )
          throw new VaultError('invalid')
        const next = snapshot.document.generation + 1
        const block = sealVaultBlock(
          this.active(),
          { vaultId: this.vaultId, id: metadata.id, kind: metadata.kind, generation: next },
          plaintext,
        )
        await this.publish(
          { items: [...remaining, { metadata, generation: next }] },
          [
            ...snapshot.document.items.filter((entry) => entry.id !== metadata.id),
            { id: metadata.id, block },
          ],
          snapshot.slots,
        )
      })
    } finally {
      plaintext.fill(0)
    }
  }
  async remove(id: string): Promise<void> {
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      if (index.items.every((item) => item.metadata.id !== id)) throw new VaultError('invalid')
      await this.publish(
        { items: index.items.filter((item) => item.metadata.id !== id) },
        snapshot.document.items.filter((item) => item.id !== id),
        snapshot.slots,
      )
    })
  }
  async setSlots(records: readonly VaultSlotRecord[]): Promise<void> {
    const parsed = z.array(vaultSlotRecordSchema).safeParse(records)
    if (!parsed.success) throw new VaultError('invalid')
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      await this.publish(index, snapshot.document.items, {
        ...snapshot.slots,
        records: parsed.data,
      })
    })
  }
  async commitAudit(auditGeneration: number, auditHead: string): Promise<void> {
    if (!generation.safeParse(auditGeneration).success || !digest.safeParse(auditHead).success)
      throw new VaultError('invalid')
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      if (auditGeneration <= snapshot.slots.auditGeneration) throw new VaultError('rollback')
      await this.publish(index, snapshot.document.items, {
        ...snapshot.slots,
        auditGeneration,
        auditHead,
      })
    })
  }
  async exportSnapshot(): Promise<VaultSnapshot> {
    const result = await this.options.files.withWriter(async () => {
      const loaded = await this.load()
      for (const item of loaded.index.items)
        eraseVaultMaterial(
          this.material(loaded.snapshot.document, loaded.index, item.metadata.id).material,
        )
      return loaded.snapshot
    })
    this.active()
    return result
  }
}
