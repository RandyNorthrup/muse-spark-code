// The same private data folder is injected by VSIX, ACP, native runtimes and CLI.
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHECKPOINT_STORAGE_MODE,
  CHECKPOINT_JOURNAL_FILE_MODE,
  USAGE_FOLDER,
} from '../../shared/constants'
import type { UsageFs, UsageFileStat, UsageLock } from '../../core/usage/journalStore'
import { writeFileAtomically } from '../../host/fsAtomic'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
export class NodeUsageFs implements UsageFs {
  private readonly root: string
  public constructor(
    dataFolder: string,
    private readonly now: () => number = Date.now,
  ) {
    this.root = path.resolve(dataFolder)
  }
  private resolve(relative: string): string {
    const parts = relative.split('/')
    if (
      parts[0] !== USAGE_FOLDER ||
      parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
    ) {
      throw new Error('invalidUsagePath')
    }
    return path.join(this.root, ...parts)
  }
  /** Refuse linked ancestors, including on reads, so another folder is never consulted. */
  private async checkPath(file: string): Promise<void> {
    let current = this.root
    for (const part of ['', ...path.relative(this.root, file).split(path.sep)]) {
      current = path.join(current, part)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink()) throw new Error('linkedUsagePath')
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    }
  }
  private async prepare(file: string): Promise<void> {
    await this.checkPath(file)
    await mkdir(path.dirname(file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    await this.checkPath(file)
  }
  public async list(folder: string): Promise<readonly string[]> {
    const file = this.resolve(folder)
    await this.checkPath(file)
    try {
      const entries = await readdir(file, { withFileTypes: true })
      return entries
        .filter((entry) => !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .toSorted((a, b) => a.localeCompare(b))
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
  }
  public async stat(relative: string): Promise<UsageFileStat | undefined> {
    const file = this.resolve(relative)
    await this.checkPath(file)
    try {
      const stat = await lstat(file)
      if (!stat.isFile()) throw new Error('invalidUsageFile')
      return { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    }
  }
  public async read(relative: string, offset: number, length: number): Promise<Uint8Array> {
    const file = this.resolve(relative)
    await this.checkPath(file)
    const handle = await open(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      const bytes = new Uint8Array(length)
      let count = 0
      while (count < length) {
        const result = await handle.read(bytes, count, length - count, offset + count)
        if (result.bytesRead === 0) break
        count += result.bytesRead
      }
      return bytes.subarray(0, count)
    } finally {
      await handle.close()
    }
  }
  public async append(relative: string, line: string): Promise<void> {
    const file = this.resolve(relative)
    await this.prepare(file)
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      CHECKPOINT_JOURNAL_FILE_MODE,
    )
    try {
      await handle.writeFile(line, 'utf8')
    } finally {
      await handle.close()
    }
  }
  public async writeFileAtomically(relative: string, text: string): Promise<void> {
    const file = this.resolve(relative)
    await this.prepare(file)
    await writeFileAtomically(file, text, { sleep: delay, expectedCanonicalPath: file })
  }
  public async remove(relative: string): Promise<void> {
    const file = this.resolve(relative)
    await this.checkPath(file)
    await rm(file, { recursive: true, force: true })
  }
  public async acquireLock(relative: string, staleMs: number): Promise<UsageLock | undefined> {
    const file = this.resolve(relative)
    await this.prepare(file)
    const token = randomUUID()
    try {
      const handle = await open(file, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      try {
        await handle.writeFile(token, 'utf8')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const stat = await this.stat(relative)
      if (stat === undefined || this.now() - stat.mtimeMs <= staleMs) return undefined
      // Rename/removal cannot offer a conditional unlink in Node. Serialize
      // reclamation with a token-specific exclusive marker. An abandoned
      // marker expires too, so a crash during recovery cannot block it forever.
      const oldContent = await readFile(file, 'utf8')
      const oldToken = oldContent.trim()
      if (oldToken !== '' && !/^[\w-]+$/.test(oldToken))
        throw new Error('invalidUsageLock', { cause: error })
      const marker = `${relative}.${oldToken === '' ? 'empty' : oldToken}.reclaim`
      const markerFile = this.resolve(marker)
      let markerHandle
      try {
        markerHandle = await open(markerFile, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      } catch (markerError) {
        if (errorCode(markerError) !== 'EEXIST') throw markerError
        const abandoned = await this.stat(marker)
        if (abandoned === undefined || this.now() - abandoned.mtimeMs <= staleMs) return undefined
        await rm(markerFile, { force: true })
        try {
          markerHandle = await open(markerFile, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
        } catch (retryError) {
          if (errorCode(retryError) === 'EEXIST') return undefined
          throw retryError
        }
      }
      try {
        const currentToken = await readFile(file, 'utf8')
        if (currentToken.trim() !== oldToken) return undefined
        await rm(file, { force: true })
        return await this.acquireLock(relative, staleMs)
      } finally {
        await markerHandle.close()
        await rm(markerFile, { force: true })
      }
    }
    const isHeld = async (): Promise<boolean> => {
      try {
        return (await readFile(file, 'utf8')) === token
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return false
        throw error
      }
    }
    return {
      isHeld,
      release: async () => {
        if (await isHeld()) await rm(file, { force: true })
      },
    }
  }
}
