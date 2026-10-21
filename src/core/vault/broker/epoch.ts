import { watchFile, unwatchFile } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../../shared/constants'
import { type VaultEpochPort } from './ports'
import { UnixVaultPrivateFiles, isVaultFileMissing, type VaultPrivateFilesPort } from './files'

const epochSchema = z.strictObject({
  v: z.literal(1),
  epoch: z.number().check(z.int(), z.nonnegative()),
})
const writerSchema = z.strictObject({
  v: z.literal(1),
  processId: z.number().check(z.int(), z.positive()),
  startedAt: z.number().check(z.int(), z.positive(), z.refine(Number.isSafeInteger)),
})
/** The broker that owns an in-flight epoch publication, proven at startup. */
export interface VaultEpochWriterOwner {
  readonly processId: number
  readonly startedAt: number
}
/** The exclusive-writer record beside the epoch file; parsed by the lock lane. */
export const vaultEpochWriterSchema = writerSchema
/** Shared with the lock lane so contender and holder name the same file. */
export function vaultEpochWriterPath(runDirectory: string): string {
  return path.join(runDirectory, 'lock-epoch.writer')
}
export class VaultLockEpoch implements VaultEpochPort {
  private readonly path: string
  private readonly writer: string
  constructor(
    private readonly runDirectory: string,
    private readonly files: VaultPrivateFilesPort = new UnixVaultPrivateFiles(),
    private readonly owner?: VaultEpochWriterOwner,
  ) {
    this.path = path.join(runDirectory, 'lock-epoch.v1')
    this.writer = vaultEpochWriterPath(runDirectory)
  }
  async current(): Promise<number> {
    try {
      const bytes = await this.files.read(this.path)
      return epochSchema.parse(JSON.parse(bytes.toString('utf8'))).epoch
    } catch (error: unknown) {
      if (isVaultFileMissing(error)) return 0
      throw error
    }
  }
  async bump(authorize?: () => void): Promise<number> {
    await this.files.directory(this.runDirectory)
    // An occupied writer fails closed; no pid-based stale-file deletion or lost increment.
    // The lock lane decides a contended writer by rule from this record (RVCM109JD P2-1);
    // without an owner the record stays empty and the claim still fails closed.
    const record =
      this.owner === undefined
        ? Buffer.alloc(0)
        : Buffer.from(JSON.stringify({ v: 1, ...this.owner }))
    const release = await this.files.claim(this.writer, record)
    try {
      const epoch = (await this.current()) + 1
      if (!Number.isSafeInteger(epoch)) throw new TypeError(UI_TEXT.vault.noAccess)
      await this.files.replace(this.path, Buffer.from(JSON.stringify({ v: 1, epoch })), authorize)
      return epoch
    } finally {
      await release()
    }
  }
  subscribe(listener: (epoch: number) => void): () => void {
    let isClosed = false
    const changed = (): void => {
      void this.current()
        .then((epoch) => {
          if (!isClosed) listener(epoch)
        })
        .catch(() => {
          // An unreadable epoch reads as the far future so the vault locks;
          // the read failure keeps no cause.
          if (!isClosed) listener(Number.MAX_SAFE_INTEGER)
        })
    }
    watchFile(this.path, { persistent: false, interval: MILLISECONDS_PER_SECOND }, changed)
    return () => {
      isClosed = true
      unwatchFile(this.path, changed)
    }
  }
}
