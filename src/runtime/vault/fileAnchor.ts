import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import { VaultStoreUnavailableError } from '../../core/vault/broker/ports'
import type { KeyringEntryFactory } from '../keyStore'
import { KeyringVaultAnchor } from './keyringAnchor'

/**
The anchor file beside the vault files it protects, owner-only like
them. Only used when the OS keyring binding is not installed (a staged
package carries no node_modules): the record and every rollback rule are
the keyring anchor's, inherited whole, so the two anchors never disagree
on what history is valid. The OS store stays preferred wherever its
binding is installed; a vault anchored in one place never silently adopts
the other's state, and switching places without carrying the record fails
closed as a rollback, never as fresh. Owner-only means modes on POSIX;
on Windows the bindings pass the pipe-helper guard, which sets the
owner-only DACL on the directory and the file after each write.
*/
export function vaultAnchorFile(dataDir: string): string {
  return path.join(dataDir, 'anchor', 'anchor.v1.json')
}

/** The anchor directory is a directory, or nothing is there yet. */
async function isParentVacant(file: string): Promise<boolean> {
  try {
    const sample = await stat(path.dirname(file))
    return sample.isDirectory()
  } catch (error: unknown) {
    return isVaultFileMissing(error)
  }
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
      // fixed repair instead of leaking a filesystem sentence. Windows
      // reports a path through a regular file as ENOENT rather than
      // ENOTDIR, so a missing file alone cannot tell "no history" from an
      // unusable location: only a directory (or no parent yet) reads as
      // empty.
      if (isVaultFileMissing(error) && (await isParentVacant(this.file))) return null
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

/**
The owner-only file of one protected record the OS store would otherwise
hold (the audit checkpoint and its pending intent), beside the anchor
file. The account names the vault, so the file name is the digest of the
service and account: an account may carry characters no file name allows.
*/
function vaultRecordFile(dataDir: string, service: string, account: string): string {
  const name = createHash('sha256').update(`${service}\n${account}`).digest('hex')
  return path.join(dataDir, 'anchor', `${name}.json`)
}

/** One such record, stored exactly as the file anchor stores its own. */
class FileVaultRecord extends FileVaultAnchor {
  async load(): Promise<string | null> {
    return await this.readRaw()
  }
  async save(raw: string): Promise<void> {
    await this.writeRaw(raw)
  }
  /** True when a record was there to delete; a missing one is already gone. */
  async erase(): Promise<boolean> {
    const isPresent = (await this.readRaw()) !== null
    await this.deleteRaw()
    return isPresent
  }
}

/**
The protected records the OS store holds where its binding is installed
(the audit log's checkpoint and pending intent), kept as owner-only files
beside the file anchor where it is not, with the anchor's own rules. The
anchor alone falling back left every audited operation (setup's first
unlock, every unlock) refused with storeUnavailable in a staged package.
*/
export function fileRecordEntries(
  dataDir: string,
  protect?: (file: string, kind: 'directory' | 'file') => Promise<void>,
): KeyringEntryFactory {
  return (service, account) => {
    const record = new FileVaultRecord(vaultRecordFile(dataDir, service, account), protect)
    return {
      getPassword: () => record.load(),
      setPassword: (value) => record.save(value),
      deletePassword: () => record.erase(),
    }
  }
}
