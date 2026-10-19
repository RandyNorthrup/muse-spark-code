// Shared seams for the key-store migration tests (D89.14 lane M): a
// file-backed SecretStore with real async persistence, and a capturing
// logger. SecretStorage itself exists only inside VS Code (or the OS
// keychain outside it), so no unit test can hold the real one; this store
// keeps the honest part — real files shared across controller instances,
// real async reads and writes — and relies on no SecretStorage behaviour
// beyond get/store/delete. The vault side is always the real VaultStore,
// never a port double.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SecretStore } from '../../../../src/host/auth/credentialStore'
import type { Logger } from '../../../../src/host/logger'
import { recordLogger } from '../recordLogger'

function baseDir(): string {
  try {
    return realpathSync(tmpdir())
  } catch {
    return tmpdir()
  }
}

/** Real persisted files, one per key, under a fresh temporary directory. */
export async function fileSecrets(): Promise<{ store: SecretStore; dir: string }> {
  const dir = await mkdtemp(path.join(baseDir(), 'v-migrate-secrets-'))
  const file = (key: string): string => path.join(dir, `${encodeURIComponent(key)}.secret`)
  return {
    dir,
    store: {
      get: async (key) => {
        try {
          return await readFile(file(key), 'utf8')
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return undefined
          throw error
        }
      },
      store: async (key, value) => {
        await writeFile(file(key), value, { mode: 0o600 })
      },
      delete: async (key) => {
        await rm(file(key), { force: true })
      },
    },
  }
}

export async function closeSecrets(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/** The shared in-memory logger, recording level-prefixed messages, for assertions. */
export function capturingLog(): { log: Logger; logged: string[] } {
  return recordLogger()
}
