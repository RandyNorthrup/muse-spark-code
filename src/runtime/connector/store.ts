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
import {
  connectorOAuthStateSchema,
  connectorOwnerClientsSchema,
  type ConnectorOAuthState,
  type ConnectorOwnerClients,
} from '../../shared/connectorRemote'
import type { AuditPort } from '../../core/connector/audit'
import type { AuthorityPort, AuthorityState } from '../../core/connector/registry'
import type { ConnectorStorageGuard } from './storageGuardPort'

const AUDIT_KEY_BYTES = 32

function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function isMissing(error: unknown): boolean {
  return codeOf(error) === 'ENOENT'
}

/** The stored OAuth state exists but cannot be read (D217): serve nothing. */
export class OAuthStateUnreadable extends Error {
  public constructor(options?: { readonly cause?: unknown }) {
    super(
      'connector OAuth state unreadable',
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'OAuthStateUnreadable'
  }
}

export function isOAuthStateUnreadable(error: unknown): error is OAuthStateUnreadable {
  return error instanceof OAuthStateUnreadable
}

export class ConnectorStore {
  private readonly root: string

  /**
  The store, with its storage guard (RVM124 finding 15): every file and
  folder created below is made private to the current account when the
  guard is bound. Production always binds it (the entry requires it in
  its dependencies); unbound stores keep the legacy mode-flag behavior.
  */
  public constructor(
    dataFolder: string,
    private readonly guard?: ConnectorStorageGuard,
  ) {
    this.root = path.join(dataFolder, CONNECTOR_FOLDER)
  }

  private async folder(...segments: string[]): Promise<string> {
    const folder = path.join(this.root, ...segments)
    // Every level this call makes is secured, top down: a recursive mkdir
    // below an absent root would otherwise leave the root itself behind.
    let parent = this.root
    const chain = [parent]
    for (const segment of segments) {
      parent = path.join(parent, segment)
      chain.push(parent)
    }
    const missing = new Set<string>()
    for (const level of chain) {
      try {
        await stat(level)
      } catch (error: unknown) {
        if (!isMissing(error)) throw error
        missing.add(level)
      }
    }
    await mkdir(folder, { recursive: true, mode: CONNECTOR_FOLDER_MODE })
    for (const level of chain) if (missing.has(level)) await this.guard?.secure(level, 'directory')
    return folder
  }

  private grantFile(connectionId: string): string {
    return path.join(this.root, 'grants', `${connectionId}.json`)
  }

  /** Written whole (temporary file, then rename), owner-only. */
  private async saveJson(folder: string, target: string, value: unknown): Promise<void> {
    await this.folder(folder)
    const temp = `${target}.${randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex')}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(value, undefined, 2)}\n`, {
        mode: CONNECTOR_FILE_MODE,
        flag: 'wx',
      })
      await this.guard?.secure(temp, 'file')
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true })
    }
  }

  private oauthFile(connectionId: string): string {
    return path.join(this.root, 'oauth', `${connectionId}.json`)
  }

  /** A stored JSON file's value; undefined when there is none, `OAuthStateUnreadable` when it cannot be read. */
  private async readStored(file: string): Promise<unknown> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error: unknown) {
      if (isMissing(error)) return undefined
      throw new OAuthStateUnreadable({ cause: error })
    }
    try {
      return JSON.parse(text)
    } catch (error: unknown) {
      throw new OAuthStateUnreadable({ cause: error })
    }
  }

  private ownerClientsFile(connectionId: string): string {
    return path.join(this.root, 'oauth', `${connectionId}.clients.json`)
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
    await this.saveJson('grants', this.grantFile(parsed.connectionId), parsed)
  }

  /**
  The connection's OAuth state (D217), or undefined when none was ever
  saved. A file that exists but cannot be parsed throws
  `OAuthStateUnreadable`: silently minting a fresh signing key would
  drop every registered client without the owner being told.
  */
  public async oauthState(connectionId: string): Promise<ConnectorOAuthState | undefined> {
    const value = await this.readStored(this.oauthFile(connectionId))
    if (value === undefined) return undefined
    const parsed = connectorOAuthStateSchema.safeParse(value)
    if (!parsed.success || parsed.data.connectionId !== connectionId) {
      throw new OAuthStateUnreadable()
    }
    return parsed.data
  }

  public async saveOAuthState(state: ConnectorOAuthState): Promise<void> {
    const parsed = connectorOAuthStateSchema.parse(state)
    await this.saveJson('oauth', this.oauthFile(parsed.connectionId), parsed)
  }

  /**
  The owner's registered clients and revocations (D217), or undefined when
  the owner never registered or revoked one. A file that exists but cannot
  be read throws `OAuthStateUnreadable`: serving without it would let a
  client the owner ended sign in again.
  */
  public async ownerClients(connectionId: string): Promise<ConnectorOwnerClients | undefined> {
    const value = await this.readStored(this.ownerClientsFile(connectionId))
    if (value === undefined) return undefined
    const parsed = connectorOwnerClientsSchema.safeParse(value)
    if (!parsed.success || parsed.data.connectionId !== connectionId) {
      throw new OAuthStateUnreadable()
    }
    return parsed.data
  }

  public async saveOwnerClients(state: ConnectorOwnerClients): Promise<void> {
    const parsed = connectorOwnerClientsSchema.parse(state)
    await this.saveJson('oauth', this.ownerClientsFile(parsed.connectionId), parsed)
  }

  /**
  The connection's live authority (design §3a): its grant and the kill
  switch as last read. A change to either file is read at once (a watch
  on this folder, while it exists) and `refresh` reads them again; a
  reading that finishes after a newer one is dropped. Until the first
  reading it is switched off (fail closed).
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
    const target = path.join(this.root, 'kill-switch.json')
    await writeFile(target, `${JSON.stringify({ on: isOn, at: nowIso })}\n`, {
      mode: CONNECTOR_FILE_MODE,
    })
    await this.guard?.secure(target, 'file')
  }

  /**
  Creates and secures the connection's audit storage before serving: the
  folders, the audit key and the live journal. The storage guard's OS
  scripts then run at startup, never inside a call's receipt timeout (on
  Windows each is a PowerShell start).
  */
  public async prepareAudit(connectionId: string): Promise<void> {
    await this.audit(connectionId, Date.now).key()
    const live = path.join(await this.folder('audit'), `${connectionId}.jsonl`)
    try {
      const handle = await open(live, 'wx', CONNECTOR_FILE_MODE)
      await handle.close()
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return
      throw error
    }
    await this.guard?.secure(live, 'file')
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
          await this.guard?.secure(file, 'file')
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
        let didExist = true
        try {
          const info = await stat(live)
          size = info.size
        } catch (error: unknown) {
          if (!isMissing(error)) throw error
          didExist = false
        }
        if (size + Buffer.byteLength(line) > CONNECTOR_LIMITS.auditSegmentBytes) {
          // Windows `rename` does not replace an existing destination: clear
          // the previous segment first so the rollover lands there (Codex on
          // PR #227). `force` keeps the first rollover a single rename.
          await rm(older, { force: true })
          await rename(live, older)
          didExist = false
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
          if (!didExist) await this.guard?.secure(live, 'file')
        } finally {
          await handle.close()
        }
      },
    }
  }
}
