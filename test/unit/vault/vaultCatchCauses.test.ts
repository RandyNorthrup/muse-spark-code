import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { discoverAmbientFiles } from '../../../src/core/vault/migrate/ambient'
import { VaultMigrationFault } from '../../../src/core/vault/migrate/ports'
import { importSshKey, isSshSignatureValid } from '../../../src/core/vault/ssh/keys'
import { decodeCookies } from '../../../src/core/vault/web/cookies'
import { decodeTotpSeed } from '../../../src/core/vault/web/totp'
import { UI_TEXT, VAULT_KEY_BYTES, VAULT_NONCE_BYTES } from '../../../src/shared/constants'

function sealedUnder(key: Buffer) {
  const nonce = randomVaultBytes(VAULT_NONCE_BYTES)
  const aad = Buffer.from('context')
  const { ciphertext, tag } = aesGcmSeal(key, nonce, Buffer.from('plaintext'), aad)
  return { nonce, ciphertext, tag, aad }
}

/** Runs the work and returns what it threw; the test fails when nothing throws. */
async function caughtFailure(work: () => unknown): Promise<unknown> {
  try {
    await work()
  } catch (error: unknown) {
    return error
  }
  throw new Error('the tested call did not throw')
}

/** The caught failure reads as an invalid migration fault with the given cause. */
function expectInvalidMigrationCause(
  failure: unknown,
  cause: new (...arguments_: string[]) => Error,
): void {
  expect(failure).toBeInstanceOf(VaultMigrationFault)
  expect((failure as VaultMigrationFault).code).toBe('invalid')
  expect((failure as Error).cause).toBeInstanceOf(cause)
}

describe('vault catch causes', () => {
  it('a seal opened under another key fails authentication with the cipher failure', async () => {
    const { nonce, ciphertext, tag, aad } = sealedUnder(randomVaultBytes(VAULT_KEY_BYTES))
    const failure = await caughtFailure(() => {
      aesGcmOpen(randomVaultBytes(VAULT_KEY_BYTES), nonce, ciphertext, tag, aad)
    })
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('authentication')
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('a torn material split reads invalid with the parsing failure', async () => {
    const width = Buffer.alloc(4)
    const descriptor = Buffer.from('{torn', 'utf8')
    width.writeUInt32BE(descriptor.length)
    const failure = await caughtFailure(() => {
      decodeVaultMaterial(Buffer.concat([width, descriptor]))
    })
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('invalid')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed backup reads invalid with the parsing failure', async () => {
    const failure = await caughtFailure(() => {
      encryptedBackupSlot(Buffer.from('{torn', 'utf8'), 1024)
    })
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe('invalid')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed move config denies with the parsing failure before any port call', async () => {
    const failure = await caughtFailure(async () => {
      await moveMcpSecretToVault(
        '{torn',
        { server: 's', field: 'env', key: 'K', name: 'n', use: { kind: 'mcp' } as never },
        null as unknown as McpMovePort,
      )
    })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a malformed exec envelope denies with the parsing failure', async () => {
    const pipe = Readable.from([Buffer.from('{torn', 'utf8')])
    const failure = await caughtFailure(async () => {
      await readVaultExecEnvelope(pipe)
    })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeDefined()
  })

  it('a malformed account record is invalid with the parsing failure', async () => {
    const credential = accountSecretMigrationCredential('github', 'work', Date.now)
    const failure = await caughtFailure(() => {
      credential.decode(Buffer.from('{torn', 'utf8'))
    })
    expectInvalidMigrationCause(failure, SyntaxError)
  })

  it('undecodable account bytes are invalid with the decoding failure', async () => {
    const credential = accountSecretMigrationCredential('github', 'work', Date.now)
    const failure = await caughtFailure(() => {
      credential.decode(Buffer.from([0xff, 0xfe]))
    })
    expectInvalidMigrationCause(failure, TypeError)
  })

  it('an unparsable provider id is invalid with the parse failure', async () => {
    const failure = await caughtFailure(() => {
      accountSecretMigrationCredential('!!!', 'work', Date.now)
    })
    expect(failure).toBeInstanceOf(VaultMigrationFault)
    expect((failure as VaultMigrationFault).code).toBe('invalid')
    expect((failure as Error).cause).toBeDefined()
  })

  it('a malformed provider record is invalid with the parsing failure', async () => {
    const credential = providerCredentialMigrationCredential('github', Date.now)
    const failure = await caughtFailure(() => {
      credential.decode(Buffer.from('{torn', 'utf8'))
    })
    expectInvalidMigrationCause(failure, SyntaxError)
  })

  it('an undiscoverable home fails storage with the filesystem failure', async () => {
    // A real file as home: listing inside it fails ENOTDIR for real, never
    // a missing entry, so discovery reports storage with the failure.
    const directory = mkdtempSync(path.join(tmpdir(), 'vault-catch-'))
    const home = path.join(directory, 'notdir')
    writeFileSync(home, '')
    try {
      let failure: unknown
      try {
        await discoverAmbientFiles(home)
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(VaultMigrationFault)
      expect((failure as VaultMigrationFault).code).toBe('storage')
      expect((failure as Error).cause).toBeDefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('an unreadable key file denies with the parse failure', async () => {
    const failure = await caughtFailure(() => {
      importSshKey(Buffer.from('not a key', 'utf8'))
    })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeDefined()
  })

  it('a garbage signature reads invalid instead of throwing', () => {
    // Fail-closed boolean by design: a crypto failure rejects the signature,
    // whatever broke it.
    expect(
      isSshSignatureValid(Buffer.from('garbage'), Buffer.from('data'), Buffer.from('garbage')),
    ).toBe(false)
  })

  it('malformed cookie bytes deny with the parsing failure', async () => {
    const failure = await caughtFailure(() => {
      decodeCookies(Buffer.from('{torn', 'utf8'), 'https://example.com', Date.now())
    })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('useChanged')
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError)
  })

  it('a truncated seed denies with the decoding failure', async () => {
    const failure = await caughtFailure(() => {
      decodeTotpSeed('A')
    })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('invalidTotp')
    expect((failure as Error).cause).toBeDefined()
  })
})
