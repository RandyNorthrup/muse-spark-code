// M124 (D106): the connector's owner-only files in the agent's data folder,
// outside every repository: one grant per connection, the kill switch, and
// the audit journal and its key. A missing grant grants nothing; an
// unreadable kill switch counts as switched off (fail closed). No fixed
// call budget stands beside the grant (Codex on PR #227): the limits file
// and its lock are gone with the caps they served.
import { randomBytes } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import {
  CONNECTOR_FILE_MODE,
  CONNECTOR_FOLDER,
  CONNECTOR_FOLDER_MODE,
  CONNECTOR_LIMITS,
} from '../../shared/constants'
import {
  connectorGrantSchema,
  connectorKillSwitchSchema,
  type ConnectorGrant,
} from '../../shared/connector'
import type { AuditPort } from '../../core/connector/audit'
import type { AuthorityPort, AuthorityState } from '../../core/connector/registry'

const AUDIT_KEY_BYTES = 32

function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function isMissing(error: unknown): boolean {
  return codeOf(error) === 'ENOENT'
}

export class ConnectorStore {
  private readonly root: string

  public constructor(dataFolder: string) {
    this.root = path.join(dataFolder, CONNECTOR_FOLDER)
  }

  private async folder(...segments: string[]): Promise<string> {
    const folder = path.join(this.root, ...segments)
    await mkdir(folder, { recursive: true, mode: CONNECTOR_FOLDER_MODE })
    return folder
  }

  private grantFile(connectionId: string): string {
    return path.join(this.root, 'grants', `${connectionId}.json`)
  }

  /** The current grant, or undefined: missing, malformed or unreadable grants grant nothing. */
  public async grant(connectionId: string): Promise<ConnectorGrant | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.grantFile(connectionId), 'utf8'))
      const parsed = connectorGrantSchema.safeParse(value)
      return parsed.success && parsed.data.connectionId === connectionId ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  public async grants(): Promise<readonly ConnectorGrant[]> {
    let names: string[]
    try {
      names = await readdir(path.join(this.root, 'grants'))
    } catch (error: unknown) {
      if (isMissing(error)) return []
      throw error
    }
    const found = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => this.grant(name.slice(0, -'.json'.length))),
    )
    return found.filter((grant) => grant !== undefined)
  }

  /** Written whole (temporary file, then rename), owner-only. */
  public async saveGrant(grant: ConnectorGrant): Promise<void> {
    const parsed = connectorGrantSchema.parse(grant)
    await this.folder('grants')
    const target = this.grantFile(parsed.connectionId)
    const temp = `${target}.${randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex')}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(parsed, undefined, 2)}\n`, {
        mode: CONNECTOR_FILE_MODE,
        flag: 'wx',
      })
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true })
    }
  }

  /**
   * The connection's live authority (design §3a): its grant and the kill
   * switch as last read. A change to either file is read at once (a watch
   * on this folder, while it exists) and `refresh` reads them again; a
   * reading that finishes after a newer one is dropped. Until the first
   * reading it is switched off (fail closed).
   */
  public authority(connectionId: string): AuthorityPort {
    let state: AuthorityState = { grant: undefined, killed: true }
    let started = 0
    let applied = 0
    const listeners = new Set<() => void>()
    const refresh = async () => {
      const reading = ++started
      const [grant, killed] = await Promise.all([this.grant(connectionId), this.isKilled()])
      if (reading < applied) return
      applied = reading
      const isChanged = JSON.stringify(state) !== JSON.stringify({ grant, killed })
      state = { grant, killed }
      if (isChanged) for (const changed of listeners) changed()
    }
    const watched = new Set(['kill-switch.json', path.join('grants', `${connectionId}.json`)])
    return {
      current: () => state,
      refresh,
      watch: (changed) => {
        listeners.add(changed)
        let watcher: FSWatcher | undefined
        try {
          watcher = watch(this.root, { recursive: true }, (_event, name) => {
            if (name !== null && watched.has(name)) void refresh()
          })
          watcher.on('error', () => {
            watcher?.close()
          })
        } catch {
          // No folder yet: the refresh before every gate keeps it current.
        }
        return () => {
          listeners.delete(changed)
          watcher?.close()
        }
      },
    }
  }

  /** Switched off when the file says so, or when it cannot be read or parsed. */
  public async isKilled(): Promise<boolean> {
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(this.root, 'kill-switch.json'), 'utf8'),
      )
      return connectorKillSwitchSchema.parse(value).on
    } catch (error: unknown) {
      return !isMissing(error)
    }
  }

  public async setKilled(isOn: boolean, nowIso: string): Promise<void> {
    await this.folder()
    await writeFile(
      path.join(this.root, 'kill-switch.json'),
      `${JSON.stringify({ on: isOn, at: nowIso })}\n`,
      { mode: CONNECTOR_FILE_MODE },
    )
  }

  /** Bounded JSONL: one live segment and one older one, pruned after the retention. */
  public audit(connectionId: string, now: () => number): AuditPort {
    return {
      key: async () => {
        const file = path.join(await this.folder(), 'audit.key')
        try {
          const handle = await open(file, 'wx', CONNECTOR_FILE_MODE)
          try {
            await handle.writeFile(randomBytes(AUDIT_KEY_BYTES))
          } finally {
            await handle.close()
          }
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
        const key = await readFile(file)
        if (key.length !== AUDIT_KEY_BYTES) throw new Error('EAUDIT_KEY')
        return key
      },
      append: async (line) => {
        const folder = await this.folder('audit')
        const live = path.join(folder, `${connectionId}.jsonl`)
        const older = path.join(folder, `${connectionId}.1.jsonl`)
        let size = 0
        try {
          const info = await stat(live)
          size = info.size
        } catch (error: unknown) {
          if (!isMissing(error)) throw error
        }
        if (size + Buffer.byteLength(line) > CONNECTOR_LIMITS.auditSegmentBytes) {
          // Windows `rename` does not replace an existing destination: clear
          // the previous segment first so the rollover lands there (Codex on
          // PR #227). `force` keeps the first rollover a single rename.
          await rm(older, { force: true })
          await rename(live, older)
        }
        try {
          const info = await stat(older)
          if (now() - info.mtimeMs > CONNECTOR_LIMITS.auditRetentionMs)
            await rm(older, { force: true })
        } catch (error: unknown) {
          if (!isMissing(error)) throw error
        }
        const handle = await open(live, 'a', CONNECTOR_FILE_MODE)
        try {
          await handle.appendFile(line, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
      },
    }
  }
}
