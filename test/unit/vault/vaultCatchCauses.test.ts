import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  aesGcmOpen,
  aesGcmSeal,
  decodeVaultMaterial,
  randomVaultBytes,
  VaultError,
} from '../../../src/core/vault/crypto'
import { encryptedBackupSlot } from '../../../src/core/vault/backup'
import { moveMcpSecretToVault, type McpMovePort } from '../../../src/core/vault/mcpSecrets'
import { readVaultExecEnvelope } from '../../../src/core/vault/exec/entry'
import { UI_TEXT, VAULT_KEY_BYTES, VAULT_NONCE_BYTES } from '../../../src/shared/constants'

function sealedUnder(key: Buffer) {
  const nonce = randomVaultBytes(VAULT_NONCE_BYTES)
  const aad = Buffer.from('context')
  const { ciphertext, tag } = aesGcmSeal(key, nonce, Buffer.from('plaintext'), aad)
  return { nonce, ciphertext, tag, aad }
}

describe('vault catch causes', () => {
  it('a seal opened under another key fails authentication with the cipher failure', () => {
    const { nonce, ciphertext, tag, aad } = sealedUnder(randomVaultBytes(VAULT_KEY_BYTES))
    let failure: unknown
    try {
      aesGcmOpen(randomVaultBytes(VAULT_KEY_BYTES), nonce, ciphertext, tag, aad)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('authentication')
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('a torn material split reads invalid with the parsing failure', () => {
    const width = Buffer.alloc(4)
    const descriptor = Buffer.from('{torn', 'utf8')
    width.writeUInt32BE(descriptor.length)
    let failure: unknown
    try {
      decodeVaultMaterial(Buffer.concat([width, descriptor]))
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('invalid')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed backup reads invalid with the parsing failure', () => {
    let failure: unknown
    try {
      encryptedBackupSlot(Buffer.from('{torn', 'utf8'), 1024)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('invalid')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed move config denies with the parsing failure before any port call', async () => {
    let failure: unknown
    try {
      await moveMcpSecretToVault(
        '{torn',
        { server: 's', field: 'env', key: 'K', name: 'n', use: { kind: 'mcp' } as never },
        null as unknown as McpMovePort,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed exec envelope denies with the parsing failure', async () => {
    const pipe = Readable.from([Buffer.from('{torn', 'utf8')])
    let failure: unknown
    try {
      await readVaultExecEnvelope(pipe)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeDefined()
  })
})
