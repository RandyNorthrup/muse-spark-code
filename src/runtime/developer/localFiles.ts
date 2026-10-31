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
import {
  LocalDeveloperProfiles,
  profileCredentialSlot,
  type DeveloperProfileResources,
  type LocalProfilePorts,
} from '../../core/developer/localProfiles'
import type { DeveloperProfile } from '../../shared/developerOptions'
import * as z from 'zod/mini'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function normalized(value: string): string {
  const result = path.resolve(value).replaceAll('\\', '/')
  return process.platform === 'win32' ? result.toLowerCase() : result
}

// A corrupt file refuses in fixed words, carrying the parse failure as its
// cause; anything else keeps its kind.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw new Error(UI_TEXT.developer.unavailable, { cause: error })
    throw error
  }
}

/** Filesystem operations are serialized by DeveloperOptions' machine owner.
No independent per-window service may share this root (X-W-OWNER). */
type ProfileFolders = LocalProfilePorts['folders']

const slotsSchema = z.strictObject({ v: z.literal(1), slots: z.record(z.string(), z.string()) })
export class DeveloperLocalFiles implements DeveloperStore, ProfileFolders {
  private readonly root: string
  public constructor(root: string) {
    this.root = path.resolve(root)
  }

  /** Where `target` must resolve. The root may sit below links the OS or the
  user chose (macOS /var, a relocated or redirected profile, a Windows short
  name); only a link at or below the root is refused. */
  private async anchored(target: string): Promise<string> {
    return normalized(path.join(await realpath(this.root), path.relative(this.root, target)))
  }

  private async directory(target: string): Promise<void> {
    await mkdir(target, { recursive: true, mode: DEVELOPER_DIRECTORY_MODE })
    const info = await lstat(target)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      normalized(await realpath(target)) !== (await this.anchored(target))
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

  private async readText(target: string, maxBytes: number): Promise<string | undefined> {
    if (!(await this.regularFile(target))) return undefined
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes)
        throw new Error(UI_TEXT.developer.unavailable)
      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > maxBytes) throw new Error(UI_TEXT.developer.unavailable)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await file.close()
    }
  }

  private async publishState(state: DeveloperState): Promise<void> {
    const statePath = path.join(this.root, DEVELOPER_FILES.state)
    await this.regularFile(statePath)
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

  // The local credential-slot registry. Each profile's slot is reserved
  // here when its resources start and released on remove or failed start,
  // so a failed start never orphans a reservation and remove/reset always
  // complete. The broker binding (M109 lane M) adopts these reservations
  // when it binds each slot to the real credential store; until then no
  // credential is read, copied or stored here — only the reservation.
  private async readSlots(): Promise<Record<string, string>> {
    await this.initialize()
    const text = await this.readText(
      path.join(this.root, DEVELOPER_FILES.slots),
      DEVELOPER_STATE_MAX_BYTES,
    )
    return text === undefined ? {} : slotsSchema.parse(parseJson(text)).slots
  }

  private async writeSlots(slots: Record<string, string>): Promise<void> {
    const slotsPath = path.join(this.root, DEVELOPER_FILES.slots)
    await this.regularFile(slotsPath)
    const temporary = path.join(this.root, `${DEVELOPER_FILES.slots}.${randomUUID()}`)
    try {
      const file = await open(temporary, 'wx', DEVELOPER_FILE_MODE)
      try {
        await file.writeFile(JSON.stringify(slotsSchema.parse({ v: 1, slots })))
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, slotsPath)
    } finally {
      await this.discard(temporary)
    }
  }

  public async read(): Promise<unknown> {
    await this.initialize()
    const text = await this.readText(
      path.join(this.root, DEVELOPER_FILES.state),
      DEVELOPER_STATE_MAX_BYTES,
    )
    if (text === undefined) return undefined
    const state = developerStateSchema.parse(parseJson(text))
    if (!state.isMultipleAccountsOn) return state
    // A durable revocation wins even if replacing developer.json failed. Never
    // infer an enabled grant from missing/truncated audit history.
    const auditPath = path.join(this.root, DEVELOPER_FILES.audit)
    for (const target of [auditPath, `${auditPath}.previous`]) {
      const audit = await this.readText(target, DEVELOPER_AUDIT_MAX_BYTES)
      if (audit === undefined) continue
      const rows = audit
        .trim()
        .split('\n')
        .map((row) => developerAuditSchema.parse(parseJson(row)))
      // `migrate` re-binds the machine identity without granting authority,
      // so it never decides the restored switch (DEVID017B).
      const authority = rows.findLast(
        (row) => row.action !== 'create' && row.action !== 'remove' && row.action !== 'migrate',
      )
      if (authority !== undefined)
        return { ...state, isMultipleAccountsOn: authority.action === 'enable' }
    }
    return { ...state, isMultipleAccountsOn: false }
  }

  public async commit(value: DeveloperState, event: DeveloperAudit): Promise<void> {
    const state = developerStateSchema.parse(value)
    const audit = developerAuditSchema.parse(event)
    await this.initialize()
    await this.regularFile(path.join(this.root, DEVELOPER_FILES.state))
    try {
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
    } catch (error) {
      // Failure to append cannot grant authority. Revocation still attempts
      // state publication, and the caller receives the persistence failure —
      // except a foreign `resetForeign` clear, which is never published
      // without its audit row (DEVID017E): a failed foreign Reset leaves
      // the stored state unchanged instead of clearing it unaudited. Every
      // other revocation, own-machine Reset included, still publishes.
      if (audit.action !== 'resetForeign' && !state.isMultipleAccountsOn)
        await this.publishState(state)
      throw error
    }
    await this.publishState(state)
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

  public async prepareSlot(slot: string, profile: DeveloperProfile): Promise<void> {
    // The slot must be exactly the profile's derived name: anything else is
    // a confusion the registry refuses rather than records.
    if (slot !== profileCredentialSlot(profile)) throw new Error(UI_TEXT.developer.unavailable)
    const slots = await this.readSlots()
    const kept = slots[slot]
    if (kept !== undefined && kept !== profile.id) throw new Error(UI_TEXT.developer.unavailable)
    if (kept === profile.id) return
    await this.writeSlots({ ...slots, [slot]: profile.id })
  }

  public async removeSlot(slot: string): Promise<void> {
    const slots = await this.readSlots()
    if (slots[slot] === undefined) return
    const next: Record<string, string> = {}
    for (const [kept, profile] of Object.entries(slots)) {
      if (kept !== slot) next[kept] = profile
    }
    await this.writeSlots(next)
  }

  /** The production profile resources over these files: real credential-slot
  reservations and state folders; the child launch and pool registration
  refuse until their bindings land (M109 lane M, RLF-DEVICES). Shared by
  the runtime services and the drills so neither invents its own. */
  public resources(): DeveloperProfileResources {
    return new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => this.prepareSlot(slot, profile),
        remove: (slot) => this.removeSlot(slot),
      },
      folders: this,
      runtime: {
        start: () => Promise.reject(new Error(UI_TEXT.developer.unavailable)),
      },
      pool: {
        register: () => {
          throw new Error(UI_TEXT.developer.unavailable)
        },
      },
    })
  }

  /** Only a profile in the owner's persisted ledger may reach this method.
  Links/junctions are unlinked; never recursively followed. */
  public async remove(id: string): Promise<void> {
    accountIdSchema.parse(id)
    await this.initialize()
    const parent = path.join(this.root, 'profiles')
    try {
      const parentInfo = await lstat(parent)
      if (
        !parentInfo.isDirectory() ||
        parentInfo.isSymbolicLink() ||
        normalized(await realpath(parent)) !== (await this.anchored(parent))
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
