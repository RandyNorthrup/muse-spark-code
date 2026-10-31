// M108 D: the sender-local durable owner of remote vendor-limit blocks. One
// record per RemoteAccountPool owner key (provider, kind, owner); the pool
// writes before routing and restores on first use after restart. Records
// are per owner, not per request, so no prune sweep runs here: direct
// lookup by name never reads the directory, and each file is one block.
// RLF-DEVICES binds this beside the journal when it binds the live pool.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { isErrno } from '../../core/fs/errno'
import { accountLimitBlockSchema } from '../../core/accounts/limitBlock'
import { ACCOUNT_REQUEST_STORE, UI_TEXT } from '../../shared/constants'

const recordSchema = z.strictObject({ owner: z.string(), block: accountLimitBlockSchema })

/** File-backed RemoteAccountPoolDeps['limitStore']; write resolves only after persistence. */
export class FileRemoteLimitStore {
  public constructor(private readonly directory: string) {}

  private async ensure(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
    const stat = await lstat(this.directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  }

  private file(owner: string): string {
    return path.join(
      this.directory,
      `remote-limit-${createHash('sha256').update(owner).digest('hex')}.json`,
    )
  }

  public async read(owner: string): Promise<unknown> {
    await this.ensure()
    let text: string
    try {
      text = await readFile(this.file(owner), 'utf8')
    } catch (error: unknown) {
      // A missing record is no block; anything else keeps its kind.
      if (isErrno(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    const record = recordSchema.parse(JSON.parse(text))
    // A record filed under another owner is never adopted.
    if (record.owner !== owner) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    return record.block
  }

  public async write(owner: string, block: unknown): Promise<void> {
    const parsed = accountLimitBlockSchema.parse(block)
    await this.ensure()
    const temporary = path.join(this.directory, `${randomUUID()}.pending`)
    try {
      await writeFile(temporary, JSON.stringify(recordSchema.parse({ owner, block: parsed })), {
        flag: 'wx',
        mode: ACCOUNT_REQUEST_STORE.fileMode,
      })
      await rename(temporary, this.file(owner))
      return
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
    }
    try {
      await unlink(temporary)
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      if (error.code !== 'ENOENT')
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable, { cause: error })
    }
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  }
}
