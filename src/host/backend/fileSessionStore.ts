// The Model API session store on disk (PLAN.md D14): one JSON file per
// session under the workspace storage directory VS Code gives the
// extension (`context.storageUri`: per user, per workspace, outside the
// repository). Writes go to a temporary file and are renamed into place,
// so a crash mid-write leaves the previous version. A file that does not
// parse or validate is skipped with a log line and never stops the host.
//
// PLAN.md D26: listing keeps only each session's header, a session is read
// whole when it is opened, a session idle past the retention period
// (`museSpark.cleanupPeriodDays`, Claude Code's `cleanupPeriodDays`) is
// deleted when the list is read, a temporary file a crash left behind is
// removed, and a rename Windows refuses while another program holds the
// file is tried again.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  headerOf,
  parseStoredSession,
  type SessionStore,
  type StoredSession,
  type StoredSessionHeader,
} from '../../core/backends/modelapi/sessionStore'
import {
  MILLISECONDS_PER_DAY,
  SESSION_FILE_RENAME_ATTEMPTS,
  SESSION_FILE_RENAME_DELAY_MS,
  SESSION_FILE_STALE_TEMPORARY_MS,
} from '../../shared/constants'
import type { Logger } from '../logger'

export interface FileSessionStoreDeps {
  readonly directory: string
  readonly log: Logger
  /** Days a session may sit idle before it is deleted; 0 keeps it for ever. */
  readonly retentionDays: () => number
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  /** `fs.rename`; tests stand in a scanner holding the file. */
  readonly rename?: (from: string, to: string) => Promise<void>
}

const FILE_EXTENSION = '.json'
const TEMPORARY_SUFFIX = '.tmp'
const ENOENT = 'ENOENT'
// What Windows answers while an indexer or a virus scanner holds the target.
const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])
// A session id names a file; only the UUID alphabet is allowed into a path.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`session id ${sessionId} cannot name a file`)
  }
}

export function createFileSessionStore(deps: FileSessionStoreDeps): SessionStore {
  const fileFor = (sessionId: string) => path.join(deps.directory, `${sessionId}${FILE_EXTENSION}`)

  const readOne = async (name: string): Promise<StoredSession | undefined> => {
    const file = path.join(deps.directory, name)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch (error: unknown) {
      if (errorCode(error) !== ENOENT) {
        deps.log.warn(`Session file ${name} skipped: ${describe(error)}`)
      }
      return undefined
    }
    const parsed = parseStoredSession(raw)
    if (!parsed.ok) {
      deps.log.warn(`Session file ${name} skipped: ${parsed.reason}`)
      return undefined
    }
    return parsed.session
  }

  /** A temporary file older than any save in flight is a crash's leftover. */
  const removeIfStale = async (name: string): Promise<void> => {
    const file = path.join(deps.directory, name)
    try {
      const { mtimeMs } = await stat(file)
      if (deps.now() - mtimeMs >= SESSION_FILE_STALE_TEMPORARY_MS) {
        await rm(file, { force: true })
      }
    } catch (error: unknown) {
      deps.log.warn(`Leftover ${name} could not be removed: ${describe(error)}`)
    }
  }

  /** True when the session has sat idle past the retention period (and was deleted). */
  const isExpired = async (session: StoredSession): Promise<boolean> => {
    const days = deps.retentionDays()
    const idleMs = deps.now() - Date.parse(session.lastActivityAt)
    // An unreadable date is kept: only a known age deletes anything.
    if (days <= 0 || Number.isNaN(idleMs) || idleMs <= days * MILLISECONDS_PER_DAY) {
      return false
    }
    try {
      await rm(fileFor(session.sessionId), { force: true })
      deps.log.info(`Session ${session.sessionId} idle for more than ${String(days)} days deleted`)
    } catch (error: unknown) {
      deps.log.warn(`Expired session ${session.sessionId} not deleted: ${describe(error)}`)
    }
    return true
  }

  const renameFile = deps.rename ?? rename
  const renameIntoPlace = async (from: string, to: string): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await renameFile(from, to)
        return
      } catch (error: unknown) {
        const code = errorCode(error)
        if (
          code === undefined ||
          !RENAME_RETRY_CODES.has(code) ||
          attempt >= SESSION_FILE_RENAME_ATTEMPTS
        ) {
          throw error
        }
        await deps.sleep(SESSION_FILE_RENAME_DELAY_MS * 2 ** (attempt - 1))
      }
    }
  }

  return {
    async list() {
      let names: string[]
      try {
        names = await readdir(deps.directory)
      } catch (error: unknown) {
        if (errorCode(error) === ENOENT) {
          return []
        }
        throw error
      }
      const headers: StoredSessionHeader[] = []
      const sorted = names.toSorted((a, b) => a.localeCompare(b, 'en'))
      for (const name of sorted) {
        if (name.endsWith(TEMPORARY_SUFFIX)) {
          await removeIfStale(name)
          continue
        }
        if (!name.endsWith(FILE_EXTENSION)) {
          continue
        }
        const session = await readOne(name)
        if (session !== undefined && !(await isExpired(session))) {
          headers.push(headerOf(session))
        }
      }
      return headers
    },
    async load(sessionId) {
      assertSessionId(sessionId)
      return await readOne(`${sessionId}${FILE_EXTENSION}`)
    },
    async save(session) {
      assertSessionId(session.sessionId)
      await mkdir(deps.directory, { recursive: true })
      const file = fileFor(session.sessionId)
      const temporary = `${file}${TEMPORARY_SUFFIX}`
      await writeFile(temporary, JSON.stringify(session), 'utf8')
      await renameIntoPlace(temporary, file)
    },
    async remove(sessionId) {
      assertSessionId(sessionId)
      await rm(fileFor(sessionId), { force: true })
    },
  }
}
