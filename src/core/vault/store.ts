import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { renameSync, unlinkSync } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { VAULT_KEY_BYTES, VAULT_LIMITS, VAULT_STORE_FORMAT_VERSION } from '../../shared/constants'
import {
  vaultGrantSchema,
  vaultItemMetadataSchema,
  vaultItemSchema,
  vaultSlotRecordSchema,
  type VaultGrant,
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

type VaultFileName = 'vault.v1' | 'slots.v1' | 'pending.v1' | 'reset.v1'
export interface VaultFilePort {
  readonly maxBytes: number
  read(name: VaultFileName): Promise<Buffer | null>
  /**
   * `commit` runs synchronously immediately before the rename that publishes
   * the file; if it throws, nothing is published and its error is rethrown.
   */
  writeAtomic(name: VaultFileName, data: Uint8Array, commit?: () => void): Promise<void>
  /** Retain any displaced document durably without reading it or removing its current path. */
  quarantine(name: 'vault.v1', authorize?: () => void): Promise<void>
  remove(name: VaultFileName, authorize?: () => void): Promise<void>
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
  async writeAtomic(name: VaultFileName, data: Uint8Array, commit?: () => void): Promise<void> {
    if (data.byteLength > this.maxBytes) throw new VaultError('invalid')
    let refusal: { error: unknown } | undefined
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
      if (commit) {
        // Synchronous from the check to the rename: no task can retire authority between them.
        try {
          commit()
        } catch (error: unknown) {
          refusal = { error }
          throw error
        }
        renameSync(stage, path.join(this.root, name))
      } else await rename(stage, path.join(this.root, name))
      await this.verify(path.join(this.root, name), 'file')
      await this.syncDirectory()
    } catch {
      if (refusal) throw refusal.error
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
  async remove(name: VaultFileName, authorize?: () => void): Promise<void> {
    await this.directory()
    const file = path.join(this.root, name)
    await this.verify(file, 'file')
    authorize?.()
    unlinkSync(file)
    await this.syncDirectory()
  }
  async quarantine(name: 'vault.v1', authorize?: () => void): Promise<void> {
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
    authorize?.()
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
  v: z.literal(VAULT_STORE_FORMAT_VERSION),
  vaultId: id,
  generation,
  index: vaultBlockSchema,
  items: z
    .array(z.strictObject({ id, block: vaultBlockSchema }))
    .check(z.maxLength(VAULT_LIMITS.items)),
})
const slotsSchema = z.strictObject({
  v: z.literal(VAULT_STORE_FORMAT_VERSION),
  vaultId: id,
  generation,
  auditGeneration: generation,
  auditHead: digest,
  previousDigest: digest,
  documentDigest: digest,
  records: z.array(vaultSlotRecordSchema).check(z.minLength(1), z.maxLength(VAULT_LIMITS.names)),
  mac: z.string(),
})
// Store format v2 (lead decision 2026-10-10): grants live in the encrypted
// index beside the items, so a grant, its use count and its item commit
// together under the cross-process writer lock and the rollback anchor.
const indexSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ metadata: vaultItemMetadataSchema, generation }))
      .check(z.maxLength(VAULT_LIMITS.items)),
    grants: z.array(vaultGrantSchema).check(z.maxLength(VAULT_LIMITS.grants)),
    // Import receipts (the user's Keep/Delete of an imported source): opaque
    // value-free records kept encrypted beside the items they name.
    receipts: z
      .array(
        z.strictObject({
          id: z.string().check(z.regex(/^[a-f0-9-]{36}$/u)),
          record: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.frameBytes)),
        }),
      )
      .check(z.maxLength(VAULT_LIMITS.items)),
  })
  .check(
    z.refine((index) => {
      const items = new Set(index.items.map((item) => item.metadata.id))
      const ids = new Set(index.grants.map((grant) => grant.id))
      return ids.size === index.grants.length && index.grants.every((g) => items.has(g.itemId))
    }),
  )
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
/** A complete document/slot pair or pending transaction, without opening secret material. */
async function isVaultOpenable(files: VaultFilePort, vaultId: string): Promise<boolean> {
  const buffers: Buffer[] = []
  try {
    const pending = await files.read('pending.v1')
    if (pending) {
      buffers.push(pending)
      const intent = intentSchema.safeParse(parseJson(pending))
      if (!intent.success) return false
      const { document, slots } = intent.data.snapshot
      return (
        document.vaultId === vaultId &&
        slots.vaultId === vaultId &&
        slots.records.every((record) => record.vaultId === vaultId) &&
        slots.documentDigest === documentDigest(document)
      )
    }
    const document = await files.read('vault.v1')
    if (document) buffers.push(document)
    const slots = await files.read('slots.v1')
    if (slots) buffers.push(slots)
    if (!document || !slots) return false
    const pair = snapshotSchema.safeParse({
      document: parseJson(document),
      slots: parseJson(slots),
    })
    return (
      pair.success &&
      pair.data.document.vaultId === vaultId &&
      pair.data.slots.vaultId === vaultId &&
      pair.data.slots.records.every((record) => record.vaultId === vaultId) &&
      pair.data.document.generation === pair.data.slots.generation &&
      pair.data.slots.documentDigest === documentDigest(pair.data.document)
    )
  } catch (error: unknown) {
    if (error instanceof VaultError && error.code === 'invalid') return false
    throw error
  } finally {
    for (const bytes of buffers) bytes.fill(0)
  }
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
    authorize?: () => void,
  ): Promise<VaultStore> {
    const store = new VaultStore(options, vaultId)
    try {
      await options.files.withWriter(async () => {
        const document = await options.files.read('vault.v1')
        const slots = await options.files.read('slots.v1')
        const pending = await options.files.read('pending.v1')
        document?.fill(0)
        slots?.fill(0)
        pending?.fill(0)
        if (document || slots || (await options.anchor.minimum(vaultId)))
          throw new VaultError('invalid')
        if (pending) {
          // This setup's own first intent, committed before a transient failure
          // (an anchor write): it authenticates only under this key and vault
          // id, and completing it is the retry (RVCM1091B 3).
          await store.recoverPending()
          return
        }
        await store.publish(
          { items: [], grants: [], receipts: [] },
          [],
          {
            v: VAULT_STORE_FORMAT_VERSION,
            vaultId,
            generation: 0,
            auditGeneration: 0,
            auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
            previousDigest: '0'.repeat(VAULT_LIMITS.sha256Hex),
            documentDigest: '0'.repeat(VAULT_LIMITS.sha256Hex),
            records: [...records],
            mac: '',
          },
          null,
          authorize,
        )
      })
      return store
    } catch (error) {
      store.lock()
      throw error
    }
  }
  /**
   * An initial intent nobody can complete: only `pending.v1`, no slots, no
   * document and no anchor, so no key can ever open it. Setup removes it so
   * a fresh setup can start; a vault with any other file is never touched.
   */
  static async discardAbandonedCreation(files: VaultFilePort): Promise<boolean> {
    return await files.withWriter(async () => {
      const document = await files.read('vault.v1')
      const slots = await files.read('slots.v1')
      const pending = await files.read('pending.v1')
      document?.fill(0)
      slots?.fill(0)
      pending?.fill(0)
      if (document || slots || !pending) return false
      await files.remove('pending.v1')
      return true
    })
  }
  /**
   * Reset Vault (lead decision, 2026-10-10): offered only when the anchored
   * vault cannot be opened by any slot or code, because its required files are
   * missing or damaged. Never true for a vault that merely is locked.
   */
  static async isLost(files: VaultFilePort, anchoredId: string): Promise<boolean> {
    return await files.withWriter(async () => !(await isVaultOpenable(files, anchoredId)))
  }
  /**
   * The reset's file side: appends a value-free audit line to `reset.v1`,
   * retains any displaced document (quarantine) and removes the vault files,
   * under the writer lock, refusing a vault that can be opened.
   */
  static async resetLost(
    files: VaultFilePort,
    anchoredId: string,
    auditLine: string,
    authorize: () => void,
    retireAnchor: () => Promise<void>,
    anchor: VaultGenerationPort,
    expected: VaultGenerationState | null,
  ): Promise<void> {
    await files.withWriter(async () => {
      const current = await anchor.minimum(anchoredId)
      authorize()
      if (!isSameState(current, expected)) throw new VaultError('rollback')
      // Rechecked under the writer: a vault that became openable is never reset.
      if (await isVaultOpenable(files, anchoredId)) throw new VaultError('invalid')
      authorize()
      const previous = await files.read('reset.v1')
      try {
        authorize()
        const line = Buffer.from(`${auditLine}\n`, 'utf8')
        // A Lock while staging must stop the reset before its audit or file removal.
        await files.writeAtomic(
          'reset.v1',
          Buffer.concat([previous ?? Buffer.alloc(0), line]),
          authorize,
        )
      } finally {
        previous?.fill(0)
      }
      authorize()
      const document = await files.read('vault.v1')
      authorize()
      if (document) {
        document.fill(0)
        await files.quarantine('vault.v1', authorize)
        authorize()
        await files.remove('vault.v1', authorize)
        authorize()
      }
      for (const name of ['slots.v1', 'pending.v1'] as const) {
        const bytes = await files.read(name)
        authorize()
        if (!bytes) continue
        bytes.fill(0)
        await files.remove(name, authorize)
        authorize()
      }
      await retireAnchor()
      authorize()
    })
  }
  /** Whether any vault document exists here: the setup flow's "uncreated" test. */
  static async exists(files: VaultFilePort): Promise<boolean> {
    return await files.withWriter(async () => {
      for (const name of ['slots.v1', 'vault.v1', 'pending.v1'] as const) {
        const bytes = await files.read(name)
        if (bytes) {
          bytes.fill(0)
          return true
        }
      }
      return false
    })
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
    authorize?: () => void,
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
    const commit = { isRefused: false }
    try {
      const previous = await this.options.anchor.minimum(this.vaultId)
      this.active()
      const documentInput: Document = {
        v: VAULT_STORE_FORMAT_VERSION,
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
        v: VAULT_STORE_FORMAT_VERSION,
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
      // The write-ahead intent is the commit: recovery installs it after a crash.
      // A locked store or a retired caller never reaches it.
      await this.options.files.writeAtomic('pending.v1', pendingBytes, () => {
        try {
          this.active()
          authorize?.()
        } catch (error: unknown) {
          commit.isRefused = true
          throw error
        }
      })
      // Committed: the rest only completes the durable intent with bytes
      // already sealed. A Lock arriving now must not report a failure for a
      // change that recovery would install anyway (RVCM1091B 1).
      await this.options.anchor.advance(this.vaultId, stateOf(slots), previous)
      await this.options.files.writeAtomic('slots.v1', slotBytes)
      await this.options.files.writeAtomic('vault.v1', documentBytes)
      await this.options.files.remove('pending.v1')
    } catch (error) {
      // A clean refusal at the commit wrote nothing: it never locks the vault
      // for everyone (a cancelled import or a retired grant). Every other
      // failure still locks, as before.
      if (!commit.isRefused) this.lock()
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
  /** Seals one item at the next generation and publishes it with the rest of the index. */
  private async replaceItem(
    snapshot: VaultSnapshot,
    index: Index,
    remaining: Index['items'],
    metadata: VaultItem['metadata'],
    plaintext: Uint8Array,
  ): Promise<void> {
    const next = snapshot.document.generation + 1
    const block = sealVaultBlock(
      this.active(),
      { vaultId: this.vaultId, id: metadata.id, kind: metadata.kind, generation: next },
      plaintext,
    )
    await this.publish(
      { ...index, items: [...remaining, { metadata, generation: next }] },
      [
        ...snapshot.document.items.filter((entry) => entry.id !== metadata.id),
        { id: metadata.id, block },
      ],
      snapshot.slots,
    )
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
  /**
   * `expect` is checked inside the same writer transaction as the commit, so an
   * add never replaces an item and an edit never resurrects a removed one
   * (RVCM1091A F6).
   */
  async write(input: VaultItem, expect: 'absent' | 'present' | 'any' = 'any'): Promise<void> {
    // Own the input before the first await; the caller cannot change the approved item mid-write.
    const parsed = vaultItemSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    const plaintext = encodeVaultMaterial(parsed.data.material)
    try {
      await this.options.files.withWriter(async () => {
        const { snapshot, index } = await this.load()
        const { metadata } = parsed.data
        const current = index.items.find((item) => item.metadata.id === metadata.id)
        const remaining = index.items.filter((item) => item.metadata.id !== metadata.id)
        if (
          (expect === 'absent' && current !== undefined) ||
          (expect === 'present' && current?.metadata.kind !== metadata.kind) ||
          remaining.some((item) => item.metadata.name === metadata.name) ||
          remaining.length >= VAULT_LIMITS.items
        )
          throw new VaultError('invalid')
        await this.replaceItem(snapshot, index, remaining, metadata, plaintext)
      })
    } finally {
      plaintext.fill(0)
    }
  }
  /** Metadata only, re-sealing the current material in the same transaction (F6). */
  async updateMetadata(input: unknown): Promise<void> {
    const parsed = vaultItemMetadataSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    const metadata = parsed.data
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      const current = index.items.find((item) => item.metadata.id === metadata.id)
      const remaining = index.items.filter((item) => item.metadata.id !== metadata.id)
      if (
        current?.metadata.kind !== metadata.kind ||
        remaining.some((item) => item.metadata.name === metadata.name)
      )
        throw new VaultError('invalid')
      const { material } = this.material(snapshot.document, index, metadata.id)
      const plaintext = encodeVaultMaterial(material)
      try {
        await this.replaceItem(snapshot, index, remaining, metadata, plaintext)
      } finally {
        plaintext.fill(0)
        eraseVaultMaterial(material)
      }
    })
  }
  async remove(id: string): Promise<void> {
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      if (index.items.every((item) => item.metadata.id !== id)) throw new VaultError('invalid')
      await this.publish(
        {
          ...index,
          items: index.items.filter((item) => item.metadata.id !== id),
          // A removed item takes its grants with it: nothing can name it again.
          grants: index.grants.filter((grant) => grant.itemId !== id),
        },
        snapshot.document.items.filter((item) => item.id !== id),
        snapshot.slots,
      )
    })
  }

  async grants(): Promise<readonly VaultGrant[]> {
    const result = await this.options.files.withWriter(async () => {
      const loaded = await this.load()
      return loaded.index.grants
    })
    this.active()
    return structuredClone(result)
  }
  /** Adds or replaces a grant for a present item; authorize runs at the commit. */
  async saveGrant(input: VaultGrant, authorize: () => void): Promise<void> {
    const parsed = vaultGrantSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    const grant = parsed.data
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      const others = index.grants.filter((entry) => entry.id !== grant.id)
      if (
        index.items.every((item) => item.metadata.id !== grant.itemId) ||
        others.length >= VAULT_LIMITS.grants
      )
        throw new VaultError('invalid')
      // Checked at the physical commit, after every await: a grant retired
      // while the write waited is never published, nor recovered (RVCM1091A F2).
      await this.publish(
        { ...index, grants: [...others, grant] },
        snapshot.document.items,
        snapshot.slots,
        null,
        authorize,
      )
    })
  }
  /** Idempotent: an absent grant is already revoked. */
  async removeGrant(id: string): Promise<void> {
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      if (index.grants.every((grant) => grant.id !== id)) return
      await this.publish(
        { ...index, grants: index.grants.filter((grant) => grant.id !== id) },
        snapshot.document.items,
        snapshot.slots,
      )
    })
  }
  /** Spends one use under the cross-process writer; false without spending when exhausted. */
  async consumeGrant(id: string, now: number): Promise<boolean> {
    const isSpent = await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      const grant = index.grants.find((entry) => entry.id === id)
      if (
        grant === undefined ||
        (grant.expiresAt !== null && now >= grant.expiresAt) ||
        (grant.maxUses !== null && grant.uses >= grant.maxUses)
      )
        return false
      await this.publish(
        {
          ...index,
          grants: index.grants.map((entry) =>
            entry.id === id ? { ...entry, uses: entry.uses + 1 } : entry,
          ),
        },
        snapshot.document.items,
        snapshot.slots,
      )
      return true
    })
    this.active()
    return isSpent
  }
  /** Throws `locked` once Lock erased the key: an import lease is current only while open. */
  assertOpen(): void {
    this.active()
  }
  /**
   * All items or none (lead decision, C-M109-1): every item is new by id and
   * name, sealed at one generation and published with its receipt in a
   * single transaction. `verify` reads the staged items back before the
   * commit; `authorize` runs at the physical commit, like every other write.
   */
  async writeBatch(
    input: readonly VaultItem[],
    receipt: { id: string; record: string },
    verify: (read: (id: string) => Promise<VaultItem>) => Promise<void>,
    authorize: () => void,
  ): Promise<void> {
    if (input.length === 0 || input.length > VAULT_LIMITS.items) throw new VaultError('invalid')
    const parsed = input.map((entry) => {
      const result = vaultItemSchema.safeParse(entry)
      if (!result.success) throw new VaultError('invalid')
      return result.data
    })
    const plaintexts = parsed.map((entry) => encodeVaultMaterial(entry.material))
    try {
      await this.options.files.withWriter(async () => {
        const { snapshot, index } = await this.load()
        const ids = new Set(parsed.map((entry) => entry.metadata.id))
        const names = new Set(parsed.map((entry) => entry.metadata.name))
        if (
          ids.size !== parsed.length ||
          names.size !== parsed.length ||
          index.items.some((item) => ids.has(item.metadata.id) || names.has(item.metadata.name)) ||
          index.items.length + parsed.length > VAULT_LIMITS.items ||
          index.receipts.some((entry) => entry.id === receipt.id)
        )
          throw new VaultError('invalid')
        const next = snapshot.document.generation + 1
        const sealed = parsed.map((entry, position) => ({
          id: entry.metadata.id,
          block: sealVaultBlock(
            this.active(),
            {
              vaultId: this.vaultId,
              id: entry.metadata.id,
              kind: entry.metadata.kind,
              generation: next,
            },
            plaintexts[position] ?? Buffer.alloc(0),
          ),
        }))
        const staged: Index = {
          ...index,
          items: [
            ...index.items,
            ...parsed.map((entry) => ({ metadata: entry.metadata, generation: next })),
          ],
          receipts: [...index.receipts, { id: receipt.id, record: receipt.record }],
        }
        const stagedDocument: Document = {
          ...snapshot.document,
          generation: next,
          items: [...snapshot.document.items, ...sealed],
        }
        // Decrypt-and-verify before publication: a mismatch publishes nothing.
        await verify((id) =>
          ids.has(id)
            ? Promise.resolve(this.material(stagedDocument, staged, id))
            : Promise.reject(new VaultError('invalid')),
        )
        await this.publish(staged, stagedDocument.items, snapshot.slots, null, authorize)
      })
    } finally {
      for (const plaintext of plaintexts) plaintext.fill(0)
    }
  }
  async readReceipt(id: string): Promise<string | null> {
    const result = await this.options.files.withWriter(async () => {
      const { index } = await this.load()
      return index.receipts.find((entry) => entry.id === id)?.record ?? null
    })
    this.active()
    return result
  }
  /** Idempotent; authorize runs at the commit. */
  async forgetReceipt(id: string, authorize: () => void): Promise<void> {
    await this.options.files.withWriter(async () => {
      const { snapshot, index } = await this.load()
      if (index.receipts.every((entry) => entry.id !== id)) return
      await this.publish(
        { ...index, receipts: index.receipts.filter((entry) => entry.id !== id) },
        snapshot.document.items,
        snapshot.slots,
        null,
        authorize,
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
