// M124 (D106): the connector's owner-only files in the agent's data folder,
// outside every repository: one grant per connection, the kill switch, the
// audit journal and its key. A missing grant grants nothing; an unreadable
// kill switch counts as switched off (fail closed).
import { randomBytes } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as z from 'zod/mini'
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
import type { LimitState, LimitsPort } from '../../core/connector/policy'

const AUDIT_KEY_BYTES = 32
/** A lock older than this belongs to a process that died holding it. */
const LOCK_STALE_MS = 5000
const LOCK_RETRY_MS = 10
const LOCK_TRIES = 200

const limitStateSchema = z.strictObject({
  tokens: z.number(),
  last: z.number(),
  leases: z.array(
    z.strictObject({ id: z.string(), kind: z.enum(['read', 'pending']), until: z.number() }),
  ),
})

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** An exclusive lock file; one left by a dead process is taken over once it is stale. */
async function acquire(lock: string): Promise<void> {
  for (let attempt = 0; attempt < LOCK_TRIES; attempt += 1) {
    try {
      const handle = await open(lock, 'wx', CONNECTOR_FILE_MODE)
      await handle.close()
      return
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    let age = 0
    try {
      const held = await stat(lock)
      age = Date.now() - held.mtimeMs
    } catch {
      /* Released meanwhile: try again. */
    }
    if (age > LOCK_STALE_MS) await rm(lock, { force: true })
    else await sleep(LOCK_RETRY_MS)
  }
  throw new Error('ELOCKED')
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

  /**
   * The connection's limit state, shared by every server process of that
   * connection and kept across restarts: read, changed and replaced whole
   * under an exclusive lock file. Any failure throws, and the caller refuses.
   */
  public limits(connectionId: string): LimitsPort {
    return {
      update: async (change) => {
        const file = path.join(await this.folder('limits'), `${connectionId}.json`)
        const lock = `${file}.lock`
        const temp = `${file}.${randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex')}.tmp`
        await acquire(lock)
        try {
          let saved: LimitState | undefined
          try {
            saved = limitStateSchema.parse(JSON.parse(await readFile(file, 'utf8')))
          } catch (error: unknown) {
            if (!isMissing(error)) throw error
          }
          const [next, value] = change(saved)
          await writeFile(temp, JSON.stringify(next), { mode: CONNECTOR_FILE_MODE, flag: 'wx' })
          await rename(temp, file)
          return value
        } finally {
          await rm(temp, { force: true })
          await rm(lock, { force: true })
        }
      },
    }
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
