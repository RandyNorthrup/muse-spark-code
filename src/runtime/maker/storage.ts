import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { isWithinWorkspace } from '../../core/maker/deviceLog'
import type { MakerStorage } from '../../core/maker/ports'
import { isErrno } from '../../core/fs/errno'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  RUNTIME_MAKER_MAX_BYTES,
  REPORT_STORAGE_LINK_COUNT,
  CHECKPOINT_JOURNAL_FILE_MODE,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'

/**
Whether the spelled path crosses a link at any level (a junction is one).
Comparing it with its canonical form cannot say: an 8.3 alias or another
letter case spells the same folder with no link anywhere (a hosted Windows
runner's TEMP is under `RUNNER~1`).
*/
async function hasLinkOnPath(directory: string): Promise<boolean> {
  let current = path.resolve(directory)
  for (;;) {
    const info = await lstat(current)
    if (info.isSymbolicLink()) return true
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/** One atomic file per key; no repository file can enable hardware. */
export class RuntimeMakerStorage implements MakerStorage {
  static async create(directory: string, workspace: string): Promise<RuntimeMakerStorage> {
    await mkdir(directory, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const canonical = await realpath(directory)
    const root = await realpath(workspace)
    if (isWithinWorkspace(canonical, root)) throw new Error('maker-storage-in-workspace')
    if (await hasLinkOnPath(directory)) throw new Error('maker-storage-symlink')
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
    const file = this.file(key)
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    try {
      const info = await handleIdentity(handle)
      const entry = await lstatIdentity(file)
      const isSameFile =
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        (await realpath(file)) === file &&
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
