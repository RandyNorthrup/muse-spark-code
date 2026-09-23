// The Model API session store on disk (PLAN.md D14): one JSON file per
// session under the workspace storage directory VS Code gives the
// extension (`context.storageUri`: per user, per workspace, outside the
// repository). Writes go to a temporary file and are renamed into place,
// so a crash mid-write leaves the previous version. A file that does not
// parse or validate is skipped with a log line and never stops the host.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseStoredSession,
  type SessionStore,
  type StoredSession,
} from '../../core/backends/modelapi/sessionStore'
import type { Logger } from '../logger'

export interface FileSessionStoreDeps {
  readonly directory: string
  readonly log: Logger
}

const FILE_EXTENSION = '.json'
const TEMPORARY_SUFFIX = '.tmp'
const ENOENT = 'ENOENT'
// A session id names a file; only the UUID alphabet is allowed into a path.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ENOENT
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
      deps.log.warn(`Session file ${name} skipped: ${describe(error)}`)
      return undefined
    }
    const parsed = parseStoredSession(raw)
    if (!parsed.ok) {
      deps.log.warn(`Session file ${name} skipped: ${parsed.reason}`)
      return undefined
    }
    return parsed.session
  }

  return {
    async list() {
      let names: string[]
      try {
        names = await readdir(deps.directory)
      } catch (error: unknown) {
        if (isMissing(error)) {
          return []
        }
        throw error
      }
      const sessions: StoredSession[] = []
      const files = names
        .filter((entry) => entry.endsWith(FILE_EXTENSION))
        .toSorted((a, b) => a.localeCompare(b, 'en'))
      for (const name of files) {
        const session = await readOne(name)
        if (session !== undefined) {
          sessions.push(session)
        }
      }
      return sessions
    },
    async save(session) {
      assertSessionId(session.sessionId)
      await mkdir(deps.directory, { recursive: true })
      const file = fileFor(session.sessionId)
      const temporary = `${file}${TEMPORARY_SUFFIX}`
      await writeFile(temporary, JSON.stringify(session), 'utf8')
      await rename(temporary, file)
    },
    async remove(sessionId) {
      assertSessionId(sessionId)
      await rm(fileFor(sessionId), { force: true })
    },
  }
}
