import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
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
  /** Retain any displaced document durably without reading it or removing its current path. */
  quarantine(name: 'vault.v1'): Promise<void>
  remove(name: VaultFileName): Promise<void>
  withWriter<T>(operation: () => Promise<T>): Promise<T>
}
export interface VaultGenerationState {
  generation: number
  auditGeneration: number
  auditHead: string
  stateDigest: string
}
/** P/B must bind this to durable monotonic state outside the replaceable vault file. */
export interface VaultGenerationPort {
  minimum(vaultId: string): Promise<VaultGenerationState | null>
  /** Atomically compare the complete prior state, then advance; refuse a changed prior or regression. */
  advance(
    vaultId: string,
    state: VaultGenerationState,
    prior: VaultGenerationState | null,
  ): Promise<void>
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
  async quarantine(name: 'vault.v1'): Promise<void> {
    await this.directory()
    const file = path.join(this.root, name)
    let identity
    try {
      await this.verify(file, 'file')
      identity = await lstatIdentity(file)
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return
      throw new VaultError('io')
    }
    const retained = path.join(
      this.root,
      `${name}.${randomVaultBytes(VAULT_LIMITS.idBytes).toString('hex')}.quarantine`,
    )
    try {
      // Hard links preserve unreadable bytes and the old path until atomic publication replaces it.
      await link(file, retained)
      if (
        !sameFile(identity, await lstatIdentity(retained)) ||
        !sameFile(identity, await lstatIdentity(file))
      )
        throw new VaultError('io')
      await this.verify(retained, 'file')
      await this.syncDirectory()
    } catch {
      throw new VaultError('io')
    }
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
  previousDigest: digest,
  documentDigest: digest,
  records: z.array(vaultSlotRecordSchema).check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
  mac: z.string(),
})
const indexSchema = z.strictObject({
  items: z
    .array(z.strictObject({ metadata: vaultItemMetadataSchema, generation }))
    .check(z.maxLength(VAULT_LIMITS.items)),
})
const snapshotSchema = z.strictObject({ document: documentSchema, slots: slotsSchema })
const anchorSchema = z.strictObject({
  generation,
  auditGeneration: generation,
  auditHead: digest,
  stateDigest: digest,
})
const intentSchema = z.strictObject({
  prior: z.nullable(anchorSchema),
  restoreDigest: z.nullable(digest),
  snapshot: snapshotSchema,
  mac: z.string(),
})
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
function stateMac(key: Uint8Array, vaultId: string, domain: string, body: object): Buffer {
  const derived = hkdfSha256(key, Buffer.from(vaultId), Buffer.from(domain))
  try {
    return vaultHmacSha256(derived, encodeVaultJson(body))
  } finally {
    derived.fill(0)
  }
}
function slotMac(key: Uint8Array, slots: Omit<Slots, 'mac'>): Buffer {
  return stateMac(key, slots.vaultId, 'vault-slots-v1', slots)
}
function documentDigest(document: Document): string {
  return createHash('sha256').update(encodeVaultJson(document)).digest('hex')
}
function stateOf(slots: Slots): VaultGenerationState {
  return {
    generation: slots.generation,
    auditGeneration: slots.auditGeneration,
    auditHead: slots.auditHead,
    stateDigest: Buffer.from(slots.mac, 'base64').toString('hex'),
  }
}
function isSameState(
  left: VaultGenerationState | null,
  right: VaultGenerationState | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.generation === right.generation &&
        left.auditGeneration === right.auditGeneration &&
        left.auditHead === right.auditHead &&
        left.stateDigest === right.stateDigest
}
function authenticateSlots(key: Uint8Array, input: unknown): Slots {
  const parsed = slotsSchema.safeParse(input)
  if (!parsed.success) throw new VaultError('invalid')
  const { mac, ...body } = parsed.data
  const expected = slotMac(key, body)
  let actual: Buffer | undefined
  try {
    actual = decodeVaultBytes(mac, VAULT_KEY_BYTES)
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
    actual?.fill(0)
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
  if (documentDigest(parsed.data) !== slots.documentDigest) throw new VaultError('authentication')
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
          const parsed = intentSchema.safeParse(parseJson(pending))
          if (
            !parsed.success ||
            parsed.data.snapshot.document.vaultId !== vaultId ||
            parsed.data.snapshot.slots.vaultId !== vaultId ||
            parsed.data.snapshot.slots.records.some((slot) => slot.vaultId !== vaultId)
          )
            throw new VaultError('invalid')
          return parsed.data.snapshot.slots.records
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
          previousDigest: '0'.repeat(VAULT_LIMITS.sha256Hex),
          documentDigest: '0'.repeat(VAULT_LIMITS.sha256Hex),
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
  /** The trusted caller passes true only after the user confirms this exact restore. */
  static async restore(
    options: VaultStoreOptions,
    input: unknown,
    records?: readonly VaultSlotRecord[],
    isConfirmed = false,
  ): Promise<VaultStore> {
    if (!isConfirmed) throw new VaultError('invalid')
    const shape = snapshotSchema.safeParse(input)
    if (!shape.success) throw new VaultError('invalid')
    const validated = validateSnapshot(options.key, shape.data)
    const store = new VaultStore(options, validated.snapshot.document.vaultId)
    try {
      await options.files.withWriter(async () => {
        const recovered = await store.recoverPending()
        const source = stateOf(validated.snapshot.slots)
        if (recovered === source.stateDigest) return
        const minimum = await options.anchor.minimum(store.vaultId)
        // Never import a different history over revocations, including a newer fork.
        if (minimum && !isSameState(minimum, source)) throw new VaultError('rollback')
        const currentSlots = await options.files.read('slots.v1')
        try {
          if (currentSlots) {
            const previous = authenticateSlots(store.active(), parseJson(currentSlots))
            if (previous.vaultId !== store.vaultId || !isSameState(minimum, stateOf(previous)))
              throw new VaultError('rollback')
          }
          if (!minimum) {
            // Without an independent anchor, only a completely empty destination proves identity.
            const current = await options.files.read('vault.v1')
            try {
              if (current) throw new VaultError('invalid')
            } finally {
              current?.fill(0)
            }
          }
          for (const item of validated.index.items)
            eraseVaultMaterial(
              store.material(validated.snapshot.document, validated.index, item.metadata.id)
                .material,
            )
          await options.files.quarantine('vault.v1')
          await store.publish(
            validated.index,
            validated.snapshot.document.items,
            {
              ...validated.snapshot.slots,
              records: records ? [...records] : validated.snapshot.slots.records,
            },
            source.stateDigest,
          )
        } finally {
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
        result.snapshot.document.vaultId !== this.vaultId ||
        !isSameState(minimum, stateOf(result.snapshot.slots))
      )
        throw new VaultError('rollback')
      return result
    } finally {
      documentBytes.fill(0)
      slotsBytes.fill(0)
    }
  }
  private async recoverPending(): Promise<string | null> {
    const bytes = await this.options.files.read('pending.v1')
    if (!bytes) return null
    let expected: Buffer | undefined
    let actual: Buffer | undefined
    try {
      const parsed = intentSchema.safeParse(parseJson(bytes))
      if (!parsed.success || parsed.data.snapshot.document.vaultId !== this.vaultId)
        throw new VaultError('invalid')
      const { mac, ...intent } = parsed.data
      expected = stateMac(this.active(), this.vaultId, 'vault-intent-v1', intent)
      actual = decodeVaultBytes(mac, VAULT_KEY_BYTES)
      if (!areVaultBytesEqual(expected, actual)) throw new VaultError('authentication')
      const { snapshot, index } = validateSnapshot(this.active(), intent.snapshot)
      const next = stateOf(snapshot.slots)
      const minimum = await this.options.anchor.minimum(this.vaultId)
      this.active()
      const priorGeneration = intent.prior?.generation ?? 0
      if (
        snapshot.slots.previousDigest !==
          (intent.prior?.stateDigest ?? '0'.repeat(VAULT_LIMITS.sha256Hex)) ||
        next.generation <= priorGeneration ||
        (intent.restoreDigest === null && next.generation !== priorGeneration + 1) ||
        (intent.prior &&
          (next.auditGeneration < intent.prior.auditGeneration ||
            (next.auditGeneration === intent.prior.auditGeneration &&
              next.auditHead !== intent.prior.auditHead))) ||
        (!isSameState(minimum, intent.prior) && !isSameState(minimum, next))
      )
        throw new VaultError('rollback')
      for (const item of index.items)
        eraseVaultMaterial(this.material(snapshot.document, index, item.metadata.id).material)
      if (!isSameState(minimum, next))
        await this.options.anchor.advance(this.vaultId, next, intent.prior)
      this.active()
      await this.options.files.writeAtomic('slots.v1', encodeVaultJson(snapshot.slots))
      this.active()
      await this.options.files.writeAtomic('vault.v1', encodeVaultJson(snapshot.document))
      this.active()
      await this.options.files.remove('pending.v1')
      return intent.restoreDigest
    } finally {
      bytes.fill(0)
      expected?.fill(0)
      actual?.fill(0)
    }
  }
  private async publish(
    index: Index,
    items: Document['items'],
    prior: Slots,
    restoreDigest: string | null = null,
  ): Promise<void> {
    const next = prior.generation + 1
    if (!Number.isSafeInteger(next)) throw new VaultError('invalid')
    const records = z
      .array(vaultSlotRecordSchema)
      .check(z.minLength(1), z.maxLength(VAULT_LIMITS.names))
      .safeParse(prior.records)
    if (
      !records.success ||
      records.data.some((slot) => slot.vaultId !== this.vaultId) ||
      new Set(records.data.map((slot) => slot.id)).size !== records.data.length
    )
      throw new VaultError('invalid')
    const plaintext = encodeVaultJson(index)
    let mac: Buffer | undefined
    let intentMac: Buffer | undefined
    let documentBytes: Buffer | undefined
    let slotBytes: Buffer | undefined
    let pendingBytes: Buffer | undefined
    try {
      const previous = await this.options.anchor.minimum(this.vaultId)
      this.active()
      const documentInput: Document = {
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
      const parsedDocument = documentSchema.safeParse(documentInput)
      if (!parsedDocument.success) throw new VaultError('invalid')
      const document = parsedDocument.data
      openIndex(this.active(), document)
      const parsedBody = slotsSchema.safeParse({
        v: VAULT_FORMAT_VERSION,
        vaultId: this.vaultId,
        generation: next,
        auditGeneration: prior.auditGeneration,
        auditHead: prior.auditHead,
        previousDigest: previous?.stateDigest ?? '0'.repeat(VAULT_LIMITS.sha256Hex),
        documentDigest: documentDigest(document),
        records: records.data.map((record) => ({
          ...record,
          lastGeneration: next,
          auditGeneration: prior.auditGeneration,
          auditHead: prior.auditHead,
        })),
        mac: '',
      })
      if (!parsedBody.success) throw new VaultError('invalid')
      const { mac: _mac, ...body } = parsedBody.data
      mac = slotMac(this.active(), body)
      const slots: Slots = { ...body, mac: mac.toString('base64') }
      const intent = { prior: previous, restoreDigest, snapshot: { document, slots } }
      intentMac = stateMac(this.active(), this.vaultId, 'vault-intent-v1', intent)
      documentBytes = encodeVaultJson(document)
      slotBytes = encodeVaultJson(slots)
      pendingBytes = encodeVaultJson({ ...intent, mac: intentMac.toString('base64') })
      if (
        documentBytes.length > this.options.files.maxBytes ||
        slotBytes.length > this.options.files.maxBytes ||
        pendingBytes.length > this.options.files.maxBytes
      )
        throw new VaultError('invalid')
      await this.options.files.writeAtomic('pending.v1', pendingBytes)
      this.active()
      await this.options.anchor.advance(this.vaultId, stateOf(slots), previous)
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
      mac?.fill(0)
      intentMac?.fill(0)
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
