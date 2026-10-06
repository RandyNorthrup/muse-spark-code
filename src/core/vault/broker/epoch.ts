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
export class VaultLockEpoch implements VaultEpochPort {
  private readonly path: string
  private readonly writer: string
  constructor(
    private readonly runDirectory: string,
    private readonly files: VaultPrivateFilesPort = new UnixVaultPrivateFiles(),
  ) {
    this.path = path.join(runDirectory, 'lock-epoch.v1')
    this.writer = path.join(runDirectory, 'lock-epoch.writer')
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
    const release = await this.files.claim(this.writer, Buffer.alloc(0))
    try {
      const epoch = (await this.current()) + 1
      if (!Number.isSafeInteger(epoch)) throw new Error(UI_TEXT.vault.noAccess)
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
