// The root is supplied by the machine owner, outside any workspace/synced
// settings. Windows hosts supply an owner-only ACL on that root (D61/M109).
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { accountIdSchema } from '../../shared/accounts'
import {
  DEVELOPER_AUDIT_MAX_BYTES,
  DEVELOPER_DIRECTORY_MODE,
  DEVELOPER_FILE_MODE,
  DEVELOPER_FILES,
  DEVELOPER_STATE_MAX_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import {
  developerAuditSchema,
  developerStateSchema,
  type DeveloperAudit,
  type DeveloperState,
} from '../../shared/developerOptions'
import type { DeveloperStore } from '../../core/developer/developerOptions'
import type { LocalProfilePorts } from '../../core/developer/localProfiles'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function normalized(value: string): string {
  const result = path.resolve(value).replaceAll('\\', '/')
  return process.platform === 'win32' ? result.toLowerCase() : result
}

/** Filesystem operations are serialized by DeveloperOptions' machine owner.
 * No independent per-window service may share this root (X-W-OWNER). */
type ProfileFolders = LocalProfilePorts['folders']
export class DeveloperLocalFiles implements DeveloperStore, ProfileFolders {
  private readonly root: string
  public constructor(root: string) {
    this.root = path.resolve(root)
  }

  private async directory(target: string): Promise<void> {
    await mkdir(target, { recursive: true, mode: DEVELOPER_DIRECTORY_MODE })
    const info = await lstat(target)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      normalized(await realpath(target)) !== normalized(target)
    )
      throw new Error(UI_TEXT.developer.unavailable)
    await chmod(target, DEVELOPER_DIRECTORY_MODE)
  }

  private async initialize(): Promise<void> {
    await this.directory(this.root)
  }

  private async discard(temporary: string): Promise<void> {
    try {
      await unlink(temporary)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
  }

  private async regularFile(target: string): Promise<boolean> {
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new Error(UI_TEXT.developer.unavailable)
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  public async read(): Promise<unknown> {
    await this.initialize()
    const target = path.join(this.root, DEVELOPER_FILES.state)
    if (!(await this.regularFile(target))) return undefined
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > DEVELOPER_STATE_MAX_BYTES)
        throw new Error(UI_TEXT.developer.unavailable)
      const buffer = Buffer.alloc(DEVELOPER_STATE_MAX_BYTES + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > DEVELOPER_STATE_MAX_BYTES) throw new Error(UI_TEXT.developer.unavailable)
      return JSON.parse(buffer.toString('utf8', 0, bytesRead))
    } finally {
      await file.close()
    }
  }

  public async commit(value: DeveloperState, event: DeveloperAudit): Promise<void> {
    const state = developerStateSchema.parse(value)
    const audit = developerAuditSchema.parse(event)
    await this.initialize()
    const statePath = path.join(this.root, DEVELOPER_FILES.state)
    await this.regularFile(statePath)
    const auditPath = path.join(this.root, DEVELOPER_FILES.audit)
    const row = `${JSON.stringify(audit)}\n`
    if (await this.regularFile(auditPath)) {
      const info = await stat(auditPath)
      if (info.size + Buffer.byteLength(row) > DEVELOPER_AUDIT_MAX_BYTES) {
        const previous = `${auditPath}.previous`
        await this.regularFile(previous)
        await rename(auditPath, previous)
      }
    }
    const journal = await open(
      auditPath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      DEVELOPER_FILE_MODE,
    )
    try {
      const info = await journal.stat()
      if (!info.isFile() || info.nlink !== 1) throw new Error(UI_TEXT.developer.unavailable)
      await journal.chmod(DEVELOPER_FILE_MODE)
      await journal.writeFile(row)
      await journal.sync()
    } finally {
      await journal.close()
    }
    // Authorization precedes state publication. A failed audit append can
    // never enable developer access, and failed state writes remain errors.
    const temporary = path.join(this.root, `${DEVELOPER_FILES.state}.${randomUUID()}`)
    try {
      const file = await open(temporary, 'wx', DEVELOPER_FILE_MODE)
      try {
        await file.writeFile(JSON.stringify(state))
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, statePath)
    } finally {
      await this.discard(temporary)
    }
  }

  public async prepare(id: string): Promise<string> {
    accountIdSchema.parse(id)
    await this.initialize()
    const parent = path.join(this.root, 'profiles')
    await this.directory(parent)
    const target = path.join(parent, id)
    await this.directory(target)
    return target
  }

  /** Only a profile in the owner's persisted ledger may reach this method.
   * Links/junctions are unlinked; never recursively followed. */
  public async remove(id: string): Promise<void> {
    accountIdSchema.parse(id)
    await this.initialize()
    const parent = path.join(this.root, 'profiles')
    try {
      const parentInfo = await lstat(parent)
      if (
        !parentInfo.isDirectory() ||
        parentInfo.isSymbolicLink() ||
        normalized(await realpath(parent)) !== normalized(parent)
      )
        throw new Error(UI_TEXT.developer.unavailable)
      const target = path.join(parent, id)
      const info = await lstat(target)
      if (info.isSymbolicLink()) await unlink(target)
      else await rm(target, { recursive: info.isDirectory(), force: false })
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}
