import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import { VaultStoreUnavailableError } from '../../core/vault/broker/ports'
import { KeyringVaultAnchor } from './keyringAnchor'

/**
 * The anchor file beside the vault files it protects, owner-only like
 * them. Only used when the OS keyring binding is not installed (a staged
 * package carries no node_modules): the record and every rollback rule are
 * the keyring anchor's, inherited whole, so the two anchors never disagree
 * on what history is valid. The OS store stays preferred wherever its
 * binding is installed; a vault anchored in one place never silently adopts
 * the other's state, and switching places without carrying the record fails
 * closed as a rollback, never as fresh. Owner-only means modes on POSIX;
 * on Windows the bindings pass the pipe-helper guard, which sets the
 * owner-only DACL on the directory and the file after each write.
 */
export function vaultAnchorFile(dataDir: string): string {
  return path.join(dataDir, 'anchor', 'anchor.v1.json')
}

export class FileVaultAnchor extends KeyringVaultAnchor {
  constructor(
    private readonly file: string,
    private readonly protect?: (file: string, kind: 'directory' | 'file') => Promise<void>,
  ) {
    // Never called: every storage primitive below is overridden, so the OS
    // store is never consulted through this anchor.
    super(() => {
      throw new VaultStoreUnavailableError()
    })
  }

  protected override async readRaw(): Promise<string | null> {
    let raw: Buffer
    try {
      raw = await readFile(this.file)
    } catch (error: unknown) {
      // No anchor is "no history", never a failure; anything else keeps its
      // fixed repair instead of leaking a filesystem sentence.
      if (isVaultFileMissing(error)) return null
      throw new VaultStoreUnavailableError()
    }
    return raw.toString('utf8')
  }

  protected override async writeRaw(raw: string): Promise<void> {
    try {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
      // Modes are POSIX only: on Windows the caller supplies the
      // pipe-helper guard, which sets the owner-only DACL after the write.
      await this.protect?.(path.dirname(this.file), 'directory')
      // One writer at a time (the caller holds the exclusive writer lock);
      // the rename keeps a crashed write from leaving a half record.
      const pending = `${this.file}.tmp`
      await writeFile(pending, raw, { mode: 0o600 })
      await rename(pending, this.file)
      await this.protect?.(this.file, 'file')
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }

  protected override async deleteRaw(): Promise<void> {
    try {
      await unlink(this.file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw new VaultStoreUnavailableError()
    }
  }
}
