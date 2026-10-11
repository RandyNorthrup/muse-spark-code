import { Usd } from '../../shared/usd'
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
import * as z from 'zod/mini'
import {
  headerOf,
  parseStoredSession,
  storedSessionSchema,
  type SessionStore,
  type StoredSession,
  type StoredSessionHeader,
} from '../../core/backends/modelapi/sessionStore'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  MILLISECONDS_PER_DAY,
  SESSION_FILE_STALE_TEMPORARY_MS,
  UI_TEXT,
  MEDIA_SHA256_PATTERN,
} from '../../shared/constants'
import type { QuestionStore } from '../../shared/questions'
import { writeFileAtomically } from '../fsAtomic'
import type { Logger } from '../logger'
import { describeStoreError, storeErrorCode } from './storeErrors'
import { createSessionBudgetJournal, type SessionBudgetJournalDeps } from './sessionBudgetJournal'
import type { SessionUploadLifecycle, SessionUploadOwnership } from '../../core/media/uploadLedger'
import type { UploadedMediaRef } from '../../shared/media'
import { FifoLimiter } from '../../core/fifoLimiter'

export interface FileSessionStoreDeps {
  readonly directory: string
  readonly log: Logger
  /** M112: the same holding-process store, bound by the host/runtime integration owner. */
  readonly questions?: Pick<QuestionStore, 'remove'>
  /** Days a session may sit idle before it is deleted; 0 keeps it for ever. */
  readonly retentionDays: () => number
  /** Epoch milliseconds. */
  readonly now: () => number
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  /** `fs.rename`; tests stand in a scanner holding the file. */
  readonly rename?: (from: string, to: string) => Promise<void>
  /** Lazy account-scoped ledger; required for upload refs or recovery intents. */
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
const UPLOAD_INTENT_SUFFIX = '.uploads'
const uploadIntentSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
  operation: z.enum(['save', 'remove']),
})
type UploadIntent = z.infer<typeof uploadIntentSchema>
// Store instances in one process share a writer. The ledger's storage lock
// extends the transaction across processes/windows for account-owned sessions.
const sessionWriters = new Map<
  string,
  { generation: number; pending: number; limiter: FifoLimiter }
>()

async function withSessionWriter<T>(
  file: string,
  shouldSupersede: boolean,
  operation: (isCurrent: () => boolean) => Promise<T>,
): Promise<T> {
  const key = process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
  const writer = sessionWriters.get(key) ?? {
    generation: 0,
    pending: 0,
    limiter: new FifoLimiter(1),
  }
  if (shouldSupersede) writer.generation += 1
  const generation = writer.generation
  writer.pending += 1
  sessionWriters.set(key, writer)
  try {
    return await writer.limiter.run(
      async () => await operation(() => writer.generation === generation),
      () => true,
      () => new Error(UI_TEXT.sessionBudgetStoreUnavailable),
    )
  } finally {
    writer.pending -= 1
    if (writer.pending === 0) sessionWriters.delete(key)
  }
}

/**
 * The header fields a listing validates (M101 BYO 16): the scalars the
 * history row needs, with the full schema's own field schemas (one source
 * for the constraints), plus the turn ids, whose items are never validated
 * here — only their count becomes the turn count. The replay and transcript
 * items themselves are never read.
 */
const {
  version,
  sessionId,
  accountId,
  sideChat,
  workspaceRoot,
  name,
  createdAt,
  lastActivityAt,
  forkedFrom,
  firstPrompt,
} = storedSessionSchema.shape
const storedSessionHeaderShape = z.object({
  version,
  sessionId,
  accountId,
  sideChat,
  workspaceRoot,
  name,
  createdAt,
  lastActivityAt,
  forkedFrom,
  firstPrompt,
  turnIds: z.array(z.unknown()),
})

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

const storedSessionOwnershipShape = z.object({
  fileRefs: z.optional(z.array(z.unknown())),
  children: z.optional(z.array(z.unknown())),
})

export function createFileSessionStore(deps: FileSessionStoreDeps): SessionStore {
  const fileFor = (sessionId: string) => path.join(deps.directory, `${sessionId}${FILE_EXTENSION}`)

  /** A session file's parsed JSON, or undefined with a log line when it does not read. */
  const readRaw = async (name: string): Promise<unknown> => {
    const file = path.join(deps.directory, name)
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error: unknown) {
      if (storeErrorCode(error) !== ENOENT) {
        deps.log.warn(`Session file ${name} skipped: ${describeStoreError(error)}`)
      }
      return undefined
    }
  }

  const readOne = async (name: string): Promise<StoredSession | undefined> => {
    const raw = await readRaw(name)
    if (raw === undefined) {
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

  /**
   * A session's header without its conversation (M101 BYO 16): listing
   * parses the file's JSON once but validates only the header fields, so
   * a history of large sessions lists without paying for every replay and
   * transcript. A file whose header does not read is skipped with a log
   * line, as before; the session itself is read whole when it is opened.
   */
  const readHeader = async (name: string): Promise<StoredSessionHeader | undefined> => {
    const raw = await readRaw(name)
    if (raw === undefined) {
      return undefined
    }
    const parsed = storedSessionHeaderShape.safeParse(raw)
    if (!parsed.success) {
      deps.log.warn(`Session file ${name} skipped: its header does not read`)
      return undefined
    }
    const header = parsed.data
    if (header.sessionId !== name.slice(0, -FILE_EXTENSION.length)) {
      deps.log.warn('Session file skipped: identity does not match its filename')
      return undefined
    }
    const ownership = storedSessionOwnershipShape.parse(raw)
    if ((ownership.fileRefs?.length ?? 0) > 0)
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    if ((ownership.children?.length ?? 0) > 0) {
      const parsed = parseStoredSession(raw)
      if (!parsed.ok || fileRefsOf(parsed.session).length > 0)
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    return {
      sessionId: header.sessionId,
      ...(header.accountId !== undefined && { accountId: header.accountId }),
      ...(header.sideChat === true && { sideChat: true }),
      workspaceRoot: header.workspaceRoot,
      ...(header.name !== undefined && { name: header.name }),
      createdAt: header.createdAt,
      lastActivityAt: header.lastActivityAt,
      ...(header.forkedFrom !== undefined && { forkedFrom: header.forkedFrom }),
      ...(header.firstPrompt !== undefined && { firstPrompt: header.firstPrompt }),
      turnCount: header.turnIds.length,
    }
  }

  const intentFor = (sessionId: string) =>
    path.join(deps.directory, `${sessionId}${UPLOAD_INTENT_SUFFIX}`)
  const readIntent = async (sessionId: string): Promise<UploadIntent | undefined> => {
    try {
      return uploadIntentSchema.parse(JSON.parse(await readFile(intentFor(sessionId), 'utf8')))
    } catch (error: unknown) {
      if (storeErrorCode(error) === ENOENT) return undefined
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable, { cause: error })
    }
  }
  const writeIntent = async (
    sessionId: string,
    accountId: string,
    operation: UploadIntent['operation'],
  ) => {
    await writeFileAtomically(
      intentFor(sessionId),
      JSON.stringify(uploadIntentSchema.parse({ version: 1, accountId, operation })),
      {
        sleep: deps.sleep,
        ...(deps.rename !== undefined && { rename: deps.rename }),
      },
    )
  }
  const withSession = async <T>(
    sessionId: string,
    incoming: StoredSession | undefined,
    shouldSupersede: boolean,
    operation: (
      session: StoredSession | undefined,
      uploads: SessionUploadOwnership | undefined,
      intent: UploadIntent | undefined,
      isCurrent: () => boolean,
    ) => Promise<T>,
  ): Promise<T> =>
    await withSessionWriter(fileFor(sessionId), shouldSupersede, async (isCurrent) => {
      const previous = await readOne(`${sessionId}${FILE_EXTENSION}`)
      const intent = await readIntent(sessionId)
      const accountId = intent?.accountId ?? previous?.accountId ?? incoming?.accountId
      const requiresUploads =
        intent !== undefined ||
        [previous, incoming].some(
          (session) => session !== undefined && fileRefsOf(session).length > 0,
        )
      if (requiresUploads && (accountId === undefined || deps.uploads === undefined))
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      const lifecycle = accountId === undefined ? undefined : await deps.uploads?.(accountId)
      const run = async (uploads?: SessionUploadOwnership) => {
        const fresh =
          lifecycle === undefined ? previous : await readOne(`${sessionId}${FILE_EXTENSION}`)
        const currentIntent = lifecycle === undefined ? intent : await readIntent(sessionId)
        if (
          (fresh !== undefined && fresh.accountId !== accountId) ||
          (currentIntent !== undefined && currentIntent.accountId !== accountId)
        )
          throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
        return await operation(fresh, uploads, currentIntent, isCurrent)
      }
      return lifecycle === undefined ? await run() : await lifecycle.withLock(run)
    })

  const removeSession = async (
    sessionId: string,
    accountId: string | undefined,
    uploads?: SessionUploadOwnership,
  ): Promise<void> => {
    if (uploads !== undefined && accountId !== undefined)
      await writeIntent(sessionId, accountId, 'remove')
    // Keep the session (and intent) recoverable until ownership is durable.
    await uploads?.releaseSession(sessionId)
    await rm(fileFor(sessionId), { force: true })
    await rm(intentFor(sessionId), { force: true })
  }
  const recover = async (
    sessionId: string,
    session: StoredSession | undefined,
    uploads: SessionUploadOwnership | undefined,
    intent: UploadIntent | undefined,
    isCurrent: () => boolean = () => true,
  ): Promise<void> => {
    if (intent === undefined || !isCurrent()) return
    if (intent.operation === 'remove') {
      await removeSession(sessionId, intent.accountId, uploads)
    } else {
      if (session === undefined && (await hasSessionFile(fileFor(sessionId))))
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      await uploads?.syncSession(
        sessionId,
        session === undefined ? [] : fileRefsOf(session),
        isCurrent,
      )
      if (isCurrent()) await rm(intentFor(sessionId), { force: true })
    }
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
  const isExpired = async (
    session: Pick<StoredSessionHeader, 'sessionId' | 'accountId' | 'lastActivityAt'>,
    uploads?: SessionUploadOwnership,
  ): Promise<boolean> => {
    const days = deps.retentionDays()
    const idleMs = deps.now() - Date.parse(session.lastActivityAt)
    // An unreadable date is kept: only a known age deletes anything.
    if (days <= 0 || Number.isNaN(idleMs) || idleMs <= days * MILLISECONDS_PER_DAY) {
      return false
    }
    let isRemoved = false
    try {
      await deps.questions?.remove(session.sessionId)
      await removeSession(session.sessionId, session.accountId, uploads)
      isRemoved = true
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
        if (!name.endsWith(UPLOAD_INTENT_SUFFIX)) continue
        const sessionId = name.slice(0, -UPLOAD_INTENT_SUFFIX.length)
        try {
          assertSessionId(sessionId)
          await withSession(
            sessionId,
            undefined,
            false,
            async (session, uploads, intent, isCurrent) => {
              await recover(sessionId, session, uploads, intent, isCurrent)
            },
          )
        } catch (error: unknown) {
          deps.log.warn(`Upload cleanup ${name} deferred: ${describeStoreError(error)}`)
        }
      }
      for (const name of sorted) {
        if (name.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
          await removeIfStale(name)
          continue
        }
        if (!name.endsWith(FILE_EXTENSION)) {
          continue
        }
        if (deps.uploads === undefined) {
          if ((await readIntent(name.slice(0, -FILE_EXTENSION.length))) !== undefined)
            throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
          const header = await readHeader(name)
          if (header !== undefined && !(await isExpired(header))) headers.push(header)
          continue
        }
        const sessionId = name.slice(0, -FILE_EXTENSION.length)
        if (!SESSION_ID_PATTERN.test(sessionId)) {
          deps.log.warn('Session file skipped: invalid filename')
          continue
        }
        await withSession(
          sessionId,
          undefined,
          false,
          async (session, uploads, intent, isCurrent) => {
            // A failed recovery is retried on the next sweep, not twice in one list.
            if (
              session !== undefined &&
              (intent !== undefined || !isCurrent() || !(await isExpired(session, uploads)))
            )
              headers.push(headerOf(session))
          },
        )
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
      await withSession(
        session.sessionId,
        session,
        true,
        async (previous, uploads, intent, isCurrent) => {
          if (!isCurrent()) return
          if (intent?.operation === 'remove') {
            await recover(session.sessionId, previous, uploads, intent)
            previous = await readOne(`${session.sessionId}${FILE_EXTENSION}`)
          }
          const hasFile = await hasSessionFile(fileFor(session.sessionId))
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
              : {
                  ...session,
                  budgetSpentUsd:
                    Usd.from(previousSpend ?? 0).compare(Usd.from(incomingSpend ?? 0)) > 0
                      ? Usd.from(previousSpend ?? 0).toAmount()
                      : Usd.from(incomingSpend ?? 0).toAmount(),
                }
          const projected = await budget.project(withLegacySpend)
          if (
            projected.budgetSpentUsd !== undefined &&
            Usd.from(projected.budgetSpentUsd).compare(Usd.from(0)) < 0
          ) {
            throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
          }
          if (!isCurrent()) return
          if (uploads !== undefined && projected.accountId !== undefined)
            await writeIntent(session.sessionId, projected.accountId, 'save')
          // Retain both snapshots until the durable rename; a failed save cannot
          // delete media that the previous on-disk conversation still references.
          await uploads?.syncSession(session.sessionId, [
            ...fileRefsOf(projected),
            ...(previous === undefined ? [] : fileRefsOf(previous)),
          ])
          if (!isCurrent()) return
          await writeFileAtomically(fileFor(session.sessionId), JSON.stringify(projected), {
            sleep: deps.sleep,
            ...(deps.rename !== undefined && { rename: deps.rename }),
          })
          await uploads?.syncSession(session.sessionId, fileRefsOf(projected), isCurrent)
          if (isCurrent()) await rm(intentFor(session.sessionId), { force: true })
          if (previous === undefined && projected.accountId !== undefined) {
            await budget.read(projected.sessionId, projected.accountId)
          }
        },
      )
    },
    async remove(sessionId) {
      assertSessionId(sessionId)
      await deps.questions?.remove(sessionId)
      await withSession(sessionId, undefined, true, async (session, uploads, intent) => {
        await removeSession(sessionId, intent?.accountId ?? session?.accountId, uploads)
      })
    },
  }
}
