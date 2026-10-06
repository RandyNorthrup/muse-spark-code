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
// deleted when the list is read, and a temporary file a crash left behind
// is removed. The write itself is `writeFileAtomically` (host/fsAtomic.ts).

import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  headerOf,
  parseStoredSession,
  type SessionStore,
  type StoredSession,
  type StoredSessionHeader,
} from '../../core/backends/modelapi/sessionStore'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  MILLISECONDS_PER_DAY,
  SESSION_FILE_STALE_TEMPORARY_MS,
  UI_TEXT,
} from '../../shared/constants'
import { writeFileAtomically } from '../fsAtomic'
import type { Logger } from '../logger'
import { describeStoreError, storeErrorCode } from './storeErrors'
import { createSessionBudgetJournal, type SessionBudgetJournalDeps } from './sessionBudgetJournal'
import type { SessionUploadLifecycle } from '../../core/media/uploadLedger'
import type { UploadedMediaRef } from '../../shared/media'

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
  /** Lazy account-scoped ledger; required only for sessions carrying uploads. */
  readonly uploads?: (accountId: string) => Promise<SessionUploadLifecycle>
}

function fileRefsOf(session: StoredSession): readonly UploadedMediaRef[] {
  return [
    ...(session.fileRefs ?? []),
    ...(session.children ?? []).flatMap((child) => fileRefsOf(child.session)),
  ]
}

const FILE_EXTENSION = '.json'
const ENOENT = 'ENOENT'
// A session id names a file; only the UUID alphabet is allowed into a path.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`session id ${sessionId} cannot name a file`)
  }
}

async function hasSessionFile(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error: unknown) {
    if (storeErrorCode(error) === ENOENT) {
      return false
    }
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable, { cause: error })
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
      if (storeErrorCode(error) !== ENOENT) {
        deps.log.warn(`Session file ${name} skipped: ${describeStoreError(error)}`)
      }
      return undefined
    }
    const parsed = parseStoredSession(raw)
    if (!parsed.ok) {
      deps.log.warn(`Session file ${name} skipped: ${parsed.reason}`)
      return undefined
    }
    if (`${parsed.session.sessionId}${FILE_EXTENSION}` !== name) {
      deps.log.warn('Session file skipped: identity does not match its filename')
      return undefined
    }
    return parsed.session
  }

  const uploadLifecycle = async (
    session: StoredSession,
  ): Promise<SessionUploadLifecycle | undefined> => {
    if (fileRefsOf(session).length === 0) return undefined
    if (session.accountId === undefined || deps.uploads === undefined)
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    return await deps.uploads(session.accountId)
  }

  const journalDeps: SessionBudgetJournalDeps = {
    directory: deps.directory,
    loadSession: async (sessionId) => {
      assertSessionId(sessionId)
      return await readOne(`${sessionId}${FILE_EXTENSION}`)
    },
    sleep: deps.sleep,
    ...(deps.rename !== undefined && { rename: deps.rename }),
  }
  const budget = createSessionBudgetJournal(journalDeps)

  /** A temporary file older than any save in flight is a crash's leftover. */
  const removeIfStale = async (name: string): Promise<void> => {
    const file = path.join(deps.directory, name)
    try {
      const { mtimeMs } = await stat(file)
      if (deps.now() - mtimeMs >= SESSION_FILE_STALE_TEMPORARY_MS) {
        await rm(file, { force: true })
      }
    } catch (error: unknown) {
      deps.log.warn(`Leftover ${name} could not be removed: ${describeStoreError(error)}`)
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
    let isRemoved = false
    try {
      const uploads = await uploadLifecycle(session)
      await rm(fileFor(session.sessionId), { force: true })
      isRemoved = true
      await uploads?.releaseSession(session.sessionId)
      deps.log.info(`Session ${session.sessionId} idle for more than ${String(days)} days deleted`)
    } catch (error: unknown) {
      deps.log.warn(
        `Expired session ${session.sessionId} not deleted: ${describeStoreError(error)}`,
      )
    }
    return isRemoved
  }

  return {
    budget,
    async list() {
      let names: string[]
      try {
        names = await readdir(deps.directory)
      } catch (error: unknown) {
        if (storeErrorCode(error) === ENOENT) {
          return []
        }
        throw error
      }
      const headers: StoredSessionHeader[] = []
      const sorted = names.toSorted((a, b) => a.localeCompare(b, 'en'))
      for (const name of sorted) {
        if (name.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
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
      const session = await readOne(`${sessionId}${FILE_EXTENSION}`)
      if (session === undefined) {
        return
      }
      // Freeze existing account-owned legacy evidence before another
      // window's whole-session save can replace its transcript or spend.
      if (session.accountId !== undefined) {
        await budget.read(sessionId, session.accountId)
      }
      return await budget.project(session)
    },
    async save(session) {
      assertSessionId(session.sessionId)
      const hasFile = await hasSessionFile(fileFor(session.sessionId))
      const previous = await readOne(`${session.sessionId}${FILE_EXTENSION}`)
      if (
        (hasFile && previous === undefined) ||
        (previous !== undefined && previous.accountId !== session.accountId)
      ) {
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      }
      // Seed from the fresh file before a stale DTO can discard historical
      // paid rows or nested children. The raw loader avoids projection recursion.
      if (previous?.accountId !== undefined) {
        await budget.read(previous.sessionId, previous.accountId)
      }
      // Before journal activation, keep fresh legacy spend when an older
      // snapshot arrives. Once active, only the journal supplies this field.
      const previousSpend = previous?.budgetSpentUsd
      const incomingSpend = session.budgetSpentUsd
      const withLegacySpend =
        previousSpend === undefined && incomingSpend === undefined
          ? session
          : { ...session, budgetSpentUsd: Math.max(previousSpend ?? 0, incomingSpend ?? 0) }
      const projected = await budget.project(withLegacySpend)
      if (
        projected.budgetSpentUsd !== undefined &&
        (!Number.isFinite(projected.budgetSpentUsd) || projected.budgetSpentUsd < 0)
      ) {
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      }
      const uploads =
        (await uploadLifecycle(projected)) ??
        (previous === undefined ? undefined : await uploadLifecycle(previous))
      // Retain both snapshots until the durable rename; a failed save cannot
      // delete media that the previous on-disk conversation still references.
      await uploads?.syncSession(session.sessionId, [
        ...fileRefsOf(projected),
        ...(previous === undefined ? [] : fileRefsOf(previous)),
      ])
      await writeFileAtomically(fileFor(session.sessionId), JSON.stringify(projected), {
        sleep: deps.sleep,
        ...(deps.rename !== undefined && { rename: deps.rename }),
      })
      await uploads?.syncSession(session.sessionId, fileRefsOf(projected))
      if (previous === undefined && projected.accountId !== undefined) {
        await budget.read(projected.sessionId, projected.accountId)
      }
    },
    async remove(sessionId) {
      assertSessionId(sessionId)
      const session = await readOne(`${sessionId}${FILE_EXTENSION}`)
      const uploads = session === undefined ? undefined : await uploadLifecycle(session)
      await rm(fileFor(sessionId), { force: true })
      await uploads?.releaseSession(sessionId)
    },
  }
}
