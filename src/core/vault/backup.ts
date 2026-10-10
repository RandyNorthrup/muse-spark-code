import * as z from 'zod/mini'
import {
  BASE64_INPUT_BLOCK_BYTES,
  VAULT_BASE64_GROUP_CHARS,
  VAULT_FORMAT_VERSION,
  VAULT_LIMITS,
} from '../../shared/constants'
import { vaultSlotRecordSchema, type VaultSlotRecord } from '../../shared/vault'
import {
  encodeVaultJson,
  openVaultBlock,
  ownedBytes,
  sealVaultBlock,
  VaultError,
  vaultBlockSchema,
} from './crypto'
import { VaultStore, type VaultStoreOptions } from './store'

const backupSchema = z.strictObject({
  v: z.literal(VAULT_FORMAT_VERSION),
  vaultId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  generation: z.number().check(z.int(), z.nonnegative(), z.refine(Number.isSafeInteger)),
  slot: vaultSlotRecordSchema,
  length: z.number().check(z.int(), z.positive(), z.refine(Number.isSafeInteger)),
  blocks: z.array(vaultBlockSchema).check(z.minLength(1), z.maxLength(VAULT_LIMITS.items)),
})

function backupContext(
  backup: { vaultId: string; generation: number; slot: VaultSlotRecord; length: number },
  index: number,
  count: number,
) {
  return {
    vaultId: backup.vaultId,
    id: `backup:${index.toString()}`,
    kind: JSON.stringify({ kind: 'backup', slot: backup.slot, length: backup.length, count }),
    generation: backup.generation,
  }
}

function portableSlot(input: unknown, vaultId: string): VaultSlotRecord {
  const parsed = vaultSlotRecordSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.vaultId !== vaultId ||
    !['passphrase', 'recovery'].includes(parsed.data.tier)
  )
    throw new VaultError('invalid')
  return parsed.data
}

/** The caller wraps the same vault key in a portable slot first; only ciphertext leaves this function. */
export async function createEncryptedBackup(
  store: VaultStore,
  key: Uint8Array,
  slot: VaultSlotRecord,
): Promise<Buffer> {
  const parsedSlot = portableSlot(slot, store.vaultId)
  const backupKey = ownedBytes(key)
  let plaintext: Buffer | undefined
  try {
    const snapshot = await store.exportSnapshot()
    // Prove the supplied encryption key is this vault's key before making a backup.
    const probe = openVaultBlock(
      backupKey,
      {
        vaultId: store.vaultId,
        id: 'index',
        kind: 'index',
        generation: snapshot.document.generation,
      },
      snapshot.document.index,
    )
    probe.fill(0)
    const payload = encodeVaultJson(snapshot)
    plaintext = payload
    const header = {
      v: VAULT_FORMAT_VERSION,
      vaultId: store.vaultId,
      generation: snapshot.document.generation,
      slot: parsedSlot,
      length: payload.length,
    }
    const chunkBytes =
      (VAULT_LIMITS.frameBytes / VAULT_BASE64_GROUP_CHARS) * BASE64_INPUT_BLOCK_BYTES
    const count = Math.ceil(payload.length / chunkBytes)
    const blocks = Array.from({ length: count }, (_, index) =>
      sealVaultBlock(
        backupKey,
        backupContext(header, index, count),
        payload.subarray(index * chunkBytes, (index + 1) * chunkBytes),
      ),
    )
    const parsed = backupSchema.safeParse({ ...header, blocks })
    if (!parsed.success) throw new VaultError('invalid')
    return encodeVaultJson(parsed.data)
  } finally {
    plaintext?.fill(0)
    backupKey.fill(0)
  }
}

/** Returns an untrusted unlock hint only. Its slot and complete payload are authenticated after unwrap. */
export function encryptedBackupSlot(bytes: Uint8Array, maxBytes: number): VaultSlotRecord {
  return parseBackup(bytes, maxBytes).slot
}

function parseBackup(bytes: Uint8Array, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.byteLength > maxBytes)
    throw new VaultError('invalid')
  try {
    const input: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
    const parsed = backupSchema.safeParse(input)
    if (!parsed.success) throw new VaultError('invalid')
    return { ...parsed.data, slot: portableSlot(parsed.data.slot, parsed.data.vaultId) }
  } catch {
    throw new VaultError('invalid')
  }
}

export async function restoreEncryptedBackup(
  options: VaultStoreOptions,
  bytes: Uint8Array,
  maxBytes: number,
  isConfirmed = false,
): Promise<VaultStore> {
  if (!isConfirmed) throw new VaultError('invalid')
  const backup = parseBackup(bytes, maxBytes)
  if (backup.length > maxBytes) throw new VaultError('invalid')
  const plaintext = Buffer.alloc(backup.length)
  try {
    let offset = 0
    for (const [index, block] of backup.blocks.entries()) {
      const chunk = openVaultBlock(
        options.key,
        backupContext(backup, index, backup.blocks.length),
        block,
      )
      try {
        if (chunk.length > plaintext.length - offset) throw new VaultError('invalid')
        plaintext.set(chunk, offset)
        offset += chunk.length
      } finally {
        chunk.fill(0)
      }
    }
    if (offset !== plaintext.length) throw new VaultError('invalid')
    const input: unknown = JSON.parse(plaintext.toString('utf8'))
    // This is only a structural bridge; VaultStore.restore validates both full documents and every item.
    const shape = z.strictObject({ document: z.unknown(), slots: z.unknown() }).safeParse(input)
    if (!shape.success) throw new VaultError('invalid')
    const document = z
      .object({ vaultId: z.string(), generation: z.number() })
      .safeParse(shape.data.document)
    if (
      !document.success ||
      document.data.vaultId !== backup.vaultId ||
      document.data.generation !== backup.generation
    )
      throw new VaultError('invalid')
    return await VaultStore.restore(options, shape.data, [backup.slot], isConfirmed)
  } catch (error) {
    if (error instanceof VaultError) throw error
    throw new VaultError('invalid')
  } finally {
    plaintext.fill(0)
  }
}
