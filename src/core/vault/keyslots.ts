import {
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  VAULT_RECOVERY_BYTES,
} from '../../shared/constants'
import {
  type VaultClockPort,
  type VaultSlotPort,
  type VaultSlotRecord,
  vaultSlotRecordSchema,
} from '../../shared/vault'
import {
  hkdfSha256,
  openVaultBlock,
  ownedBytes,
  randomVaultBytes,
  sealVaultBlock,
  VaultError,
} from './crypto'
import { derivePassphraseKey, detectArgon2, newVaultKdf, type Argon2Port } from './kdf'

function slotContext(slot: VaultSlotRecord) {
  // Mutable high-water marks are authenticated by slots.v1; changing them never needs a passphrase.
  return {
    vaultId: slot.vaultId,
    id: slot.id,
    kind: JSON.stringify({
      tier: slot.tier,
      provider: slot.provider,
      createdAt: slot.createdAt,
      kdf: slot.kdf,
    }),
    generation: 0,
  }
}

function wrapSlot(
  key: Uint8Array,
  wrappingKey: Uint8Array,
  slot: VaultSlotRecord,
): VaultSlotRecord {
  if (key.byteLength !== VAULT_KEY_BYTES) throw new VaultError('invalid')
  const block = sealVaultBlock(wrappingKey, slotContext(slot), key)
  const parsed = vaultSlotRecordSchema.safeParse({
    ...slot,
    wrappedKey: block.ciphertext,
    nonce: block.nonce,
    tag: block.tag,
  })
  if (!parsed.success) throw new VaultError('invalid')
  return parsed.data
}

function unwrapSlot(slot: VaultSlotRecord, wrappingKey: Uint8Array): Buffer {
  const key = openVaultBlock(wrappingKey, slotContext(slot), {
    generation: 0,
    nonce: slot.nonce,
    tag: slot.tag,
    ciphertext: slot.wrappedKey,
  })
  if (key.length !== VAULT_KEY_BYTES) {
    key.fill(0)
    throw new VaultError('invalid')
  }
  return key
}

function emptySlot(
  vaultId: string,
  clock: VaultClockPort,
  tier: 'passphrase' | 'presence' | 'recovery',
  kdf: VaultSlotRecord['kdf'],
): VaultSlotRecord {
  return {
    v: VAULT_FORMAT_VERSION,
    id: randomVaultBytes(VAULT_LIMITS.idBytes).toString('hex'),
    vaultId,
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
    createdAt: clock.now(),
    tier,
    provider: tier === 'recovery' ? 'recovery' : 'passphrase',
    keyReference: null,
    wrappedKey: '',
    nonce: null,
    tag: null,
    kdf,
    backend: null,
  }
}

/** The secret port transfers ownership; the slot erases it even when derivation/unwrap fails. */
export class PassphraseVaultSlot implements VaultSlotPort {
  constructor(
    private readonly vaultId: string,
    private readonly clock: VaultClockPort,
    private readonly secret: (use: string) => Promise<Uint8Array>,
    readonly tier: 'passphrase' | 'presence' = 'passphrase',
    private readonly argon2: Argon2Port | null = detectArgon2() ?? null,
  ) {}
  private async withKey<T>(
    kdf: NonNullable<VaultSlotRecord['kdf']>,
    use: string,
    apply: (key: Buffer) => T,
  ): Promise<T> {
    const secret = await this.secret(use)
    let key: Buffer | undefined
    try {
      key = await derivePassphraseKey(secret, kdf, this.argon2)
      return apply(key)
    } finally {
      key?.fill(0)
      secret.fill(0)
    }
  }
  async wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    const ownedKey = ownedBytes(key)
    const kdf = newVaultKdf(this.argon2)
    try {
      return await this.withKey(kdf, '', (wrappingKey) =>
        wrapSlot(ownedKey, wrappingKey, emptySlot(this.vaultId, this.clock, this.tier, kdf)),
      )
    } finally {
      ownedKey.fill(0)
    }
  }
  async unwrap(input: VaultSlotRecord, use: string): Promise<Uint8Array> {
    const parsed = vaultSlotRecordSchema.safeParse(input)
    if (
      !parsed.success ||
      parsed.data.vaultId !== this.vaultId ||
      parsed.data.tier !== this.tier ||
      parsed.data.provider !== 'passphrase' ||
      !parsed.data.kdf
    )
      throw new VaultError('invalid')
    return await this.withKey(parsed.data.kdf, use, (wrappingKey) =>
      unwrapSlot(parsed.data, wrappingKey),
    )
  }
}

function recoveryKey(code: Uint8Array, vaultId: string): Buffer {
  // The setup surface displays these ASCII hex bytes once. There is no retained string copy here.
  if (code.byteLength !== VAULT_RECOVERY_BYTES * 2) throw new VaultError('invalid')
  const entropy = Buffer.alloc(VAULT_RECOVERY_BYTES)
  const alphabet = Buffer.from('0123456789abcdef')
  try {
    for (let i = 0; i < entropy.length; i++) {
      const pair = code.subarray(i * 2, (i + 1) * 2)
      let value = 0
      for (const character of pair) {
        const digit = alphabet.indexOf(character)
        if (digit === -1) throw new VaultError('invalid')
        value = value * alphabet.length + digit
      }
      entropy[i] = value
    }
    return hkdfSha256(entropy, Buffer.from(vaultId), Buffer.from('vault-recovery-v1'))
  } finally {
    entropy.fill(0)
  }
}

export function createRecoverySlot(
  key: Uint8Array,
  vaultId: string,
  clock: VaultClockPort,
): { code: Buffer; slot: VaultSlotRecord } {
  const entropy = randomVaultBytes(VAULT_RECOVERY_BYTES)
  const code = Buffer.alloc(VAULT_RECOVERY_BYTES * 2)
  const alphabet = Buffer.from('0123456789abcdef')
  let wrappingKey: Buffer | undefined
  try {
    for (const [i, value] of entropy.entries()) {
      code[i * 2] = alphabet[Math.floor(value / alphabet.length)] ?? 0
      code[i * 2 + 1] = alphabet[value % alphabet.length] ?? 0
    }
    wrappingKey = recoveryKey(code, vaultId)
    return { code, slot: wrapSlot(key, wrappingKey, emptySlot(vaultId, clock, 'recovery', null)) }
  } catch {
    code.fill(0)
    throw new VaultError('invalid')
  } finally {
    entropy.fill(0)
    wrappingKey?.fill(0)
  }
}

export function unlockRecoverySlot(input: VaultSlotRecord, code: Uint8Array): Buffer {
  const parsed = vaultSlotRecordSchema.safeParse(input)
  if (!parsed.success || parsed.data.tier !== 'recovery') throw new VaultError('invalid')
  const key = recoveryKey(code, parsed.data.vaultId)
  try {
    return unwrapSlot(parsed.data, key)
  } finally {
    key.fill(0)
  }
}
