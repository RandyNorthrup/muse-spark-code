import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { VaultError } from '../../../src/core/vault/crypto'
import { VaultStoreUnavailableError } from '../../../src/core/vault/broker/ports'
import { FileVaultAnchor, vaultAnchorFile } from '../../../src/runtime/vault/fileAnchor'

// The owner-only file anchor beside the vault files: the same record and
// the same rollback rules as the keyring anchor, over real files.
function state(generation: number) {
  return {
    generation,
    auditGeneration: generation,
    auditHead: '0'.repeat(64),
    stateDigest: '1'.repeat(64),
  }
}

async function fresh() {
  const root = await mkdtemp(path.join(tmpdir(), 'vs-anchor-'))
  const file = vaultAnchorFile(path.join(root, 'vault'))
  return { root, anchor: new FileVaultAnchor(file), file }
}

describe('file vault anchor', () => {
  it('starts empty and advances generations with compare-and-set', async () => {
    const { root, anchor, file } = await fresh()
    try {
      const vaultId = randomBytes(16).toString('hex')
      expect(await anchor.vaultId()).toBeNull()
      expect(await anchor.minimum(vaultId)).toBeNull()
      await anchor.advance(vaultId, state(1), null)
      expect(await anchor.vaultId()).toBe(vaultId)
      expect(await anchor.minimum(vaultId)).toEqual(state(1))
      // A second instance over the same file (a restarted broker) keeps going.
      const reopened = new FileVaultAnchor(file)
      await reopened.advance(vaultId, state(2), state(1))
      expect(await anchor.minimum(vaultId)).toEqual(state(2))
      // Modes are POSIX only: on Windows the pipe-helper guard owns the
      // DACL (Node reports 0o666 for a writable file there).
      if (process.platform !== 'win32') {
        const sample = await stat(file)
        expect(sample.mode & 0o777).toBe(0o600)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a stale prior, another vault and a damaged record as rollback', async () => {
    const { root, anchor, file } = await fresh()
    try {
      const vaultId = randomBytes(16).toString('hex')
      await anchor.advance(vaultId, state(1), null)
      await expect(anchor.advance(vaultId, state(2), state(0))).rejects.toThrow(VaultError)
      await expect(
        anchor.advance(randomBytes(16).toString('hex'), state(2), state(1)),
      ).rejects.toThrow(VaultError)
      await expect(anchor.minimum(randomBytes(16).toString('hex'))).rejects.toThrow(VaultError)
      // Reset Vault removes exactly this vault's record on a matching state.
      await expect(
        anchor.reset(randomBytes(16).toString('hex'), state(1), () => undefined),
      ).rejects.toThrow(VaultError)
      await anchor.reset(vaultId, state(1), () => undefined)
      expect(await anchor.vaultId()).toBeNull()
      // A damaged record proves nothing; it never reads as "no history".
      await anchor.advance(vaultId, state(1), null)
      await writeFile(file, '{damaged')
      await expect(anchor.vaultId()).rejects.toThrow(VaultError)
      await expect(anchor.minimum(vaultId)).rejects.toThrow(VaultError)
      const raw = await readFile(file, 'utf8')
      expect(raw.length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('protects the directory and the file through the Windows guard', async () => {
    // The Windows bindings pass the pipe-helper guard: each write protects
    // the anchor directory first, then the file after the atomic rename.
    const root = await mkdtemp(path.join(tmpdir(), 'vs-anchor-guard-'))
    try {
      const file = vaultAnchorFile(path.join(root, 'vault'))
      const guarded: [string, string][] = []
      const anchor = new FileVaultAnchor(file, (name, kind) => {
        guarded.push([name, kind])
        return Promise.resolve()
      })
      const vaultId = randomBytes(16).toString('hex')
      await anchor.advance(vaultId, state(1), null)
      expect(guarded).toEqual([
        [path.dirname(file), 'directory'],
        [file, 'file'],
      ])
      // A failed guard fails the write as storeUnavailable, never silently.
      const refused = new FileVaultAnchor(vaultAnchorFile(path.join(root, 'other')), () =>
        Promise.reject(new Error('guard refused')),
      )
      await expect(refused.advance(vaultId, state(1), null)).rejects.toThrow(
        VaultStoreUnavailableError,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports an uncreatable anchor location as storeUnavailable', async () => {
    // A regular file where the anchor directory belongs keeps the fixed
    // repair instead of leaking a filesystem sentence.
    const root = await mkdtemp(path.join(tmpdir(), 'vs-anchor-blocked-'))
    try {
      const blocker = path.join(root, 'blocker')
      await writeFile(blocker, 'x')
      const anchor = new FileVaultAnchor(path.join(blocker, 'anchor.v1.json'))
      await expect(anchor.vaultId()).rejects.toThrow(VaultStoreUnavailableError)
      await expect(anchor.advance(randomBytes(16).toString('hex'), state(1), null)).rejects.toThrow(
        VaultStoreUnavailableError,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
