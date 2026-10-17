import * as crypto from 'node:crypto'
import { VAULT_KDF, VAULT_KEY_BYTES, VAULT_LIMITS } from '../../shared/constants'
import { type VaultSlotRecord } from '../../shared/vault'
import { decodeVaultBytes, ownedBytes, randomVaultBytes, VaultError } from './crypto'

type KdfRecord = NonNullable<VaultSlotRecord['kdf']>
export interface Argon2Parameters {
  message: Uint8Array
  nonce: Uint8Array
  memory: number
  passes: number
  parallelism: number
  tagLength: number
  secret?: Uint8Array
  associatedData?: Uint8Array
}
export type Argon2Port = (parameters: Argon2Parameters) => Promise<Buffer>

/** Node 20/22 declarations have no Argon2 symbol. Runtime narrowing avoids a cast or a new dependency. */
export function detectArgon2(source: object = crypto): Argon2Port | undefined {
  const implementation: unknown = Reflect.get(source, 'argon2')
  if (typeof implementation !== 'function') return undefined
  return (parameters) =>
    new Promise<Buffer>((resolve, reject) => {
      Reflect.apply(implementation, source, [
        'argon2id',
        parameters,
        (error: unknown, result: unknown) => {
          if (error !== null && error !== undefined) {
            reject(new VaultError('authentication'))
          } else if (!Buffer.isBuffer(result) || result.length !== parameters.tagLength) {
            if (result instanceof Uint8Array) result.fill(0)
            reject(new VaultError('invalid'))
          } else {
            const owned = ownedBytes(result)
            result.fill(0)
            resolve(owned)
          }
        },
      ])
    })
}

/** RFC 7914 primitive; production parameters are pinned by the validated slot record. */
export function scryptKey(
  password: Uint8Array,
  salt: Uint8Array,
  parameters: { N: number; r: number; p: number },
  length: number = VAULT_KEY_BYTES,
): Promise<Buffer> {
  // Salsa20/8's scrypt block is 128 bytes. This is an algorithm invariant, not a tunable.
  const blockBytes = 128
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      length,
      {
        ...parameters,
        maxmem:
          2 *
          blockBytes *
          Math.max(parameters.N, VAULT_KDF.scrypt.N) *
          Math.max(parameters.r, VAULT_KDF.scrypt.r),
      },
      (error, result) => {
        if (error) reject(new VaultError('authentication'))
        else {
          const owned = ownedBytes(result)
          result.fill(0)
          resolve(owned)
        }
      },
    )
  })
}

export function newVaultKdf(argon2: Argon2Port | null = detectArgon2() ?? null): KdfRecord {
  const salt = randomVaultBytes(VAULT_KDF.saltBytes)
  return argon2
    ? { kind: 'argon2id', salt: salt.toString('base64'), ...VAULT_KDF.argon2 }
    : { kind: 'scrypt', salt: salt.toString('base64'), ...VAULT_KDF.scrypt }
}

/** Caller retains password ownership. Returned key belongs to the caller. No silent algorithm downgrade. */
export async function derivePassphraseKey(
  password: Uint8Array,
  record: KdfRecord,
  argon2: Argon2Port | null = detectArgon2() ?? null,
): Promise<Buffer> {
  if (password.byteLength === 0 || password.byteLength > VAULT_LIMITS.text)
    throw new VaultError('invalid')
  const salt = decodeVaultBytes(record.salt, VAULT_KDF.saltBytes)
  const input = ownedBytes(password)
  try {
    if (record.kind === 'scrypt') {
      if (
        record.N !== VAULT_KDF.scrypt.N ||
        record.r !== VAULT_KDF.scrypt.r ||
        record.p !== VAULT_KDF.scrypt.p
      )
        throw new VaultError('invalid')
      return await scryptKey(input, salt, record)
    }
    if (
      !argon2 ||
      record.memoryKiB !== VAULT_KDF.argon2.memoryKiB ||
      record.iterations !== VAULT_KDF.argon2.iterations ||
      record.parallelism !== VAULT_KDF.argon2.parallelism
    )
      throw new VaultError('invalid')
    const result = await argon2({
      message: input,
      nonce: salt,
      memory: record.memoryKiB,
      passes: record.iterations,
      parallelism: record.parallelism,
      tagLength: VAULT_KEY_BYTES,
    })
    if (result.length !== VAULT_KEY_BYTES) {
      result.fill(0)
      throw new VaultError('invalid')
    }
    return result
  } finally {
    input.fill(0)
    salt.fill(0)
  }
}
