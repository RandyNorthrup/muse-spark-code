import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { MakerStorage } from '../../core/maker/ports'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  RUNTIME_MAKER_MAX_BYTES,
  REPORT_STORAGE_LINK_COUNT,
  CHECKPOINT_JOURNAL_FILE_MODE,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'

/** One atomic file per key; no repository file can enable hardware. */
export class RuntimeMakerStorage implements MakerStorage {
  static async create(directory: string, workspace: string): Promise<RuntimeMakerStorage> {
    await mkdir(directory, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const canonical = await realpath(directory)
    const root = await realpath(workspace)
    const relative = path.relative(root, canonical)
    if (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    )
      throw new Error('maker-storage-in-workspace')
    if (canonical !== path.resolve(directory)) throw new Error('maker-storage-symlink')
    return new RuntimeMakerStorage(canonical)
  }
  private constructor(readonly directory: string) {}
  private async checkDirectory(): Promise<void> {
    const info = await lstat(this.directory)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error('maker-storage-symlink')
  }
  private file(key: string): string {
    return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`)
  }
  async get(key: string): Promise<unknown> {
    await this.checkDirectory()
    let handle
    try {
      handle = await open(this.file(key), constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    try {
      const info = await handleIdentity(handle)
      const entry = await lstatIdentity(this.file(key))
      const isSameFile =
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        (await realpath(this.file(key))) === this.file(key) &&
        sameFile(entry, info)
      if (
        !isSameFile ||
        !info.isFile() ||
        info.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT) ||
        info.size > RUNTIME_MAKER_MAX_BYTES
      )
        throw new Error('maker-storage-invalid')
      const bytes = Buffer.alloc(RUNTIME_MAKER_MAX_BYTES + 1)
      let size = 0
      for (;;) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null)
        size += bytesRead
        if (size > RUNTIME_MAKER_MAX_BYTES) throw new Error('maker-storage-size')
        if (bytesRead === 0) break
      }
      const raw: unknown = JSON.parse(bytes.subarray(0, size).toString('utf8'))
      return z.unknown().parse(raw)
    } finally {
      await handle.close()
    }
  }
  async update(key: string, value: unknown): Promise<void> {
    await this.checkDirectory()
    const text = JSON.stringify(value)
    if (Buffer.byteLength(text) > RUNTIME_MAKER_MAX_BYTES) throw new Error('maker-storage-size')
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
    try {
      await handle.writeFile(text)
      await handle.sync()
      await handle.close()
      await this.checkDirectory()
      await rename(temporary, this.file(key))
    } finally {
      await handle.close()
      await rm(temporary, { force: true })
    }
  }
  async delete(key: string): Promise<void> {
    await this.checkDirectory()
    await rm(this.file(key), { force: true })
  }
}
