import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UI_TEXT } from '../../../src/shared/constants'
import { generateEd25519Key, importSshKey } from '../../../src/core/vault/ssh/keys'

// The encrypted-key case needs the system tool; its absence skips that case
// with this reason instead of failing the product.
const probe = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' })
const hasSshKeygen = probe.error === undefined

// The key module's contract the dialogs rely on: every unusable key fails
// with the one fixed refusal, so the passphrase prompt answers exactly the
// key module's own failure and nothing else.
describe('ssh key refusal shape', () => {
  it.skipIf(!hasSshKeygen)(
    'rejects garbage, oversize and passphrase-less encrypted keys with the fixed refusal',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'vs-ssh-refusal-'))
      try {
        // Real encrypted keys from the system tool, read back as real bytes.
        execFileSync('ssh-keygen', [
          '-m',
          'PEM',
          '-t',
          'rsa',
          '-b',
          '2048',
          '-N',
          'test-passphrase',
          '-f',
          path.join(root, 'id_rsa'),
          '-q',
        ])
        execFileSync('ssh-keygen', [
          '-t',
          'ed25519',
          '-N',
          'test-passphrase',
          '-f',
          path.join(root, 'id_ed25519'),
          '-q',
        ])
        const pemEncrypted = await readFile(path.join(root, 'id_rsa'))
        const opensshEncrypted = await readFile(path.join(root, 'id_ed25519'))
        for (const bytes of [
          Buffer.from('not a key at all'),
          Buffer.alloc(0),
          Buffer.alloc(70_000, 0x61),
          pemEncrypted,
          opensshEncrypted,
        ]) {
          let failure: unknown
          try {
            importSshKey(Buffer.from(bytes))
          } catch (error: unknown) {
            failure = error
          }
          expect(failure).toBeInstanceOf(Error)
          expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
        }
        // The passphrase the tool set opens the PEM bytes.
        const opened = importSshKey(
          Buffer.from(pemEncrypted),
          Buffer.from('test-passphrase', 'utf8'),
        )
        expect(opened.algorithm).toBe('rsa')
        opened.privateKey.fill(0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('round-trips a generated key without touching the refusal path', () => {
    const key = generateEd25519Key()
    expect(key.algorithm).toBe('ed25519')
    expect(key.publicKey.length).toBeGreaterThan(0)
    key.privateKey.fill(0)
  })
})
