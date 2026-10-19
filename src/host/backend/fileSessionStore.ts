import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import { Usd, type UsdAmount } from '../../shared/usd'
import {
  legacyClaimIdentityError,
  legacyClaimSpendUsd,
  legacyClaimSchema,
  legacySeedSchema,
} from './legacyJournal'
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
  isSpillFile,
  parseStoredSession,
  spillPrefix,
  isSpillStale,
  storedSessionSchema,
  type SessionStore,
  type StoredSession,
  type StoredSessionHeader,
} from '../../core/backends/modelapi/sessionStore'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  MILLISECONDS_PER_DAY,
  SESSION_FILE_STALE_TEMPORARY_MS,
  TOOL_RESULT_SPILL_DIR,
  MEDIA_SHA256_PATTERN,
} from '../../shared/constants'
import type { QuestionStore } from '../../shared/questions'
import { writeFileAtomically } from '../fsAtomic'
import type { Logger } from '../logger'
import {
  describeStoreError,
  isStoreErrorCode,
  storeErrorCode,
  storeErrorForLog,
} from './storeErrors'
import { failureForLog } from '../../core/backends/musecode/logText'
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
// The pre-D121 session journal (removed by the spend-simple lane): settled
// charges lived in `budget-journal/<account>/<sessionId>/seed.json` plus
// `claims/<id>/claim.json` beside the session files, in this same
// directory. A file saved while a request reservation was open holds that
// reservation in its total; the rebuild counts settled charges only.
const LEGACY_JOURNAL_DIRECTORY = 'budget-journal'
const LEGACY_CLAIMS_DIRECTORY = 'claims'
const LEGACY_SEED_FILE = 'seed.json'
const LEGACY_CLAIM_FILE = 'claim.json'
const LEGACY_ACCOUNT_PATTERN = /^[a-f0-9]{64}$/
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
      () => new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' }),
    )
  } finally {
    writer.pending -= 1
    if (writer.pending === 0) sessionWriters.delete(key)
  }
}

/**
The header fields a listing validates (M101 BYO 16): the scalars the
history row needs, with the full schema's own field schemas (one source
for the constraints), plus the turn ids, whose items are never validated
here — only their count becomes the turn count. The replay and transcript
items themselves are never read.
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

/** A session file the store could not read, as the ledger's typed refusal, keeping the cause. */
function unreadableLedger(error: unknown): SpendLedgerError {
  return new SpendLedgerError(
    'unreadable',
    {
      scope: 'session',
      file: 'fileSessionStore',
      errno:
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined,
    },
    error,
  )
}

async function hasSessionFile(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error: unknown) {
    if (isStoreErrorCode(error, ENOENT)) {
      return false
    }
    throw unreadableLedger(error)
  }
}

const storedSessionOwnershipShape = z.object({
  fileRefs: z.optional(z.array(z.unknown())),
  children: z.optional(z.array(z.unknown())),
})

export function createFileSessionStore(deps: FileSessionStoreDeps): SessionStore {
  const fileFor = (sessionId: string) => path.join(deps.directory, `${sessionId}${FILE_EXTENSION}`)
  // Each window's own base for the running spend total (D121): what this
  // store instance last loaded or saved for the session. A save adds only
  // what its snapshot spent past that base onto the file's total, so two
  // windows saving from the same total keep both increments instead of the
  // larger snapshot dropping the other's. The unknown-charge count merges
  // the same way, with a base of its own.
  const spendBases = new Map<string, UsdAmount>()
  const unknownBases = new Map<string, number>()

  /** A session file's parsed JSON, or undefined with a log line when it does not read. */
  const readRaw = async (name: string): Promise<unknown> => {
    const file = path.join(deps.directory, name)
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error: unknown) {
      if (!isStoreErrorCode(error, ENOENT)) {
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
  A file saved before the D121 legacy migration may hold an open
  reservation in its total (the old snapshot added it); rebuild the
  settled-only total from the legacy journal's seed plus settled claims
  (D121: a reservation is never spend). A claim the writer left open
  with a retained liability still counts that liability: fees its run
  incurred past the reservation, known before final token settlement.
  Runs once per file: new snapshots carry `spendSettledOnly`, so later
  loads skip the journal, and the save below lands the rebuild instead
  of merging onto the old total. Anything unreadable — including a
  claim row detached from its journal entry — keeps the stored total
  with a log line: a resume never fails for a best-effort migration,
  and a session without a journal keeps what its file holds.
  */
  const migrateLegacySpend = async (session: StoredSession): Promise<StoredSession> => {
    if (session.budgetSpentUsd === undefined || session.spendSettledOnly === true) return session
    try {
      const journalRoot = path.join(deps.directory, LEGACY_JOURNAL_DIRECTORY)
      let accounts: string[]
      try {
        accounts = await readdir(journalRoot)
      } catch (error: unknown) {
        if (isStoreErrorCode(error, ENOENT)) return session
        throw error
      }
      const wanted =
        session.accountId !== undefined && LEGACY_ACCOUNT_PATTERN.test(session.accountId)
          ? [session.accountId]
          : accounts.filter((name) => LEGACY_ACCOUNT_PATTERN.test(name))
      const seeds: { accountId: string; scopeId: string; spentUsd: UsdAmount }[] = []
      for (const accountId of wanted) {
        let text: string
        try {
          text = await readFile(
            path.join(journalRoot, accountId, session.sessionId, LEGACY_SEED_FILE),
            'utf8',
          )
        } catch (error: unknown) {
          if (isStoreErrorCode(error, ENOENT)) continue
          throw error
        }
        const seed = legacySeedSchema.parse(JSON.parse(text))
        if (seed.sessionId !== session.sessionId || seed.accountId !== accountId) continue
        seeds.push({ accountId, scopeId: seed.scopeId, spentUsd: seed.spentUsd })
      }
      // One conversation bills one account; two journals for it is evidence
      // this migration cannot read, so the stored total stands.
      if (seeds.length !== 1 || seeds[0] === undefined) return session
      const { accountId, scopeId } = seeds[0]
      let spent = Usd.from(seeds[0].spentUsd)
      const claimsDir = path.join(
        journalRoot,
        accountId,
        session.sessionId,
        LEGACY_CLAIMS_DIRECTORY,
      )
      const names = await readdir(claimsDir)
      for (const name of names) {
        if (path.basename(name) !== name) continue
        let text: string
        try {
          text = await readFile(path.join(claimsDir, name, LEGACY_CLAIM_FILE), 'utf8')
        } catch (error: unknown) {
          // An unsettled claim (a dead process's, for example) holds its
          // reservation but never spent it, so it stays out (D121).
          if (isStoreErrorCode(error, ENOENT)) continue
          throw error
        }
        const claim = legacyClaimSchema.parse(JSON.parse(text))
        const identityError = legacyClaimIdentityError(claim, {
          name,
          scopeId,
          sessionId: session.sessionId,
          accountId,
        })
        if (identityError !== undefined)
          throw new Error(`legacy claim ${name} is not its journal entry: ${identityError}`)
        // An unsettled claim without retained liability holds its
        // reservation but never spent it, so it stays out (D121).
        const claimSpend = legacyClaimSpendUsd(claim)
        if (claimSpend === undefined) continue
        spent = spent.add(Usd.from(claimSpend))
      }
      return { ...session, budgetSpentUsd: spent.toAmount(), spendSettledOnly: true }
    } catch (error: unknown) {
      deps.log.warn(
        `Session ${session.sessionId} keeps its saved spend total: the legacy journal does not read (${failureForLog(error)})`,
      )
      return session
    }
  }

  /**
  A session's header without its conversation (M101 BYO 16): listing
  parses the file's JSON once but validates only the header fields, so
  a history of large sessions lists without paying for every replay and
  transcript. A file whose header does not read is skipped with a log
  line, as before; the session itself is read whole when it is opened.
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
      throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
    if ((ownership.children?.length ?? 0) > 0) {
      const parsed = parseStoredSession(raw)
      if (!parsed.ok || fileRefsOf(parsed.session).length > 0)
        throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
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
      if (isStoreErrorCode(error, ENOENT)) return undefined
      throw unreadableLedger(error)
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
        throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
      const lifecycle = accountId === undefined ? undefined : await deps.uploads?.(accountId)
      const run = async (uploads?: SessionUploadOwnership) => {
        const fresh =
          lifecycle === undefined ? previous : await readOne(`${sessionId}${FILE_EXTENSION}`)
        const currentIntent = lifecycle === undefined ? intent : await readIntent(sessionId)
        if (
          (fresh !== undefined && fresh.accountId !== accountId) ||
          (currentIntent !== undefined && currentIntent.accountId !== accountId)
        )
          throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
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

  /**
  TOOLCAP: the spill directory's entries, or undefined when there is
  nothing to sweep. A missing directory means no spills; any other failure
  is said, and never stops the store.
  */
  const listSpillDir = async (dir: string, blurb: string): Promise<string[] | undefined> => {
    try {
      return await readdir(dir)
    } catch (error: unknown) {
      if (storeErrorCode(error) === ENOENT) return undefined
      deps.log.warn(`${blurb}: ${describeStoreError(error)}`)
      return undefined
    }
  }

  /**
  TOOLCAP: a session's spill files die with it. Failures are said (log),
  never swallowed; a missing spill directory means there is nothing to do.
  */
  const removeSpillsForSession = async (
    workspaceRoot: string | undefined,
    sessionId: string,
  ): Promise<void> => {
    if (workspaceRoot === undefined) {
      deps.log.warn(
        `Session ${sessionId} deleted; its spill files are kept: the workspace is unknown`,
      )
      return
    }
    const dir = path.join(workspaceRoot, TOOL_RESULT_SPILL_DIR)
    const names = await listSpillDir(
      dir,
      `Session ${sessionId} deleted; its spill files could not be listed`,
    )
    if (names === undefined) return
    const prefix = spillPrefix(sessionId)
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.txt')) continue
      try {
        await rm(path.join(dir, name))
      } catch (error: unknown) {
        deps.log.warn(
          `Session ${sessionId} deleted; spill file ${name} could not be removed: ${describeStoreError(error)}`,
        )
      }
    }
  }

  /**
  TOOLCAP: the spill age rule. Only spill-shaped files are ever removed;
  anything else in the directory is left alone. Failures are said, and a
  sweep that cannot list never stops the store.
  */
  const pruneStaleSpills = async (workspaceRoot: string): Promise<void> => {
    const dir = path.join(workspaceRoot, TOOL_RESULT_SPILL_DIR)
    const names = await listSpillDir(dir, 'Spill files could not be listed')
    if (names === undefined) return
    for (const name of names) {
      if (!isSpillFile(name)) continue
      const file = path.join(dir, name)
      try {
        const { mtimeMs } = await stat(file)
        if (isSpillStale(mtimeMs, deps.now())) await rm(file, { force: true })
      } catch (error: unknown) {
        deps.log.warn(`Spill file ${name} could not be pruned: ${describeStoreError(error)}`)
      }
    }
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
        throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
      await uploads?.syncSession(
        sessionId,
        session === undefined ? [] : fileRefsOf(session),
        isCurrent,
      )
      if (isCurrent()) await rm(intentFor(sessionId), { force: true })
    }
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
      deps.log.warn(`Leftover ${name} could not be removed: ${describeStoreError(error)}`)
    }
  }

  /** True when the session has sat idle past the retention period (and was deleted). */
  const isExpired = async (
    session: Pick<StoredSessionHeader, 'sessionId' | 'accountId' | 'lastActivityAt'> &
      Partial<Pick<StoredSessionHeader, 'workspaceRoot'>>,
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
      // TOOLCAP: the expired session's spills die with it, said when not.
      await removeSpillsForSession(session.workspaceRoot, session.sessionId)
      isRemoved = true
      deps.log.info(`Session ${session.sessionId} idle for more than ${String(days)} days deleted`)
    } catch (error: unknown) {
      // Fixed words only: a provider delete error can name the file id
      // and the file name it failed on. The caller keeps the reason.
      deps.log.warn(`Expired session ${session.sessionId} not deleted: ${storeErrorForLog(error)}`)
    }
    return isRemoved
  }

  return {
    async list() {
      let names: string[]
      try {
        names = await readdir(deps.directory)
      } catch (error: unknown) {
        if (isStoreErrorCode(error, ENOENT)) {
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
        } catch {
          // Fixed words only: recovery replays the session's upload
          // ownership, whose refusal names the attachment (RVM105 4). The
          // next sweep retries; only its outcome is recorded here.
          deps.log.warn('Upload cleanup deferred: cleanup_failed')
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
            throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
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
      // TOOLCAP: the spill age rule runs where sessions are listed, once per
      // workspace. A sweep that fails is said and never stops the listing.
      const workspaces = new Set(headers.map((header) => header.workspaceRoot))
      for (const workspaceRoot of workspaces) {
        try {
          await pruneStaleSpills(workspaceRoot)
        } catch (error: unknown) {
          deps.log.warn(`Spill files could not be pruned: ${describeStoreError(error)}`)
        }
      }
      return headers
    },
    async load(sessionId) {
      assertSessionId(sessionId)
      const session = await readOne(`${sessionId}${FILE_EXTENSION}`)
      // A file saved before the legacy migration may hold an open
      // reservation in its total; the rebuilt settled total is this
      // window's base, so its next save merges from settled spend.
      const current = session === undefined ? undefined : await migrateLegacySpend(session)
      // This snapshot is the window's base for its next save's delta.
      if (current?.budgetSpentUsd === undefined) spendBases.delete(sessionId)
      else spendBases.set(sessionId, current.budgetSpentUsd)
      if (current?.unknownChargeCalls === undefined) unknownBases.delete(sessionId)
      else unknownBases.set(sessionId, current.unknownChargeCalls)
      return current
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
            throw new SpendLedgerError('integrity', { scope: 'session', file: 'fileSessionStore' })
          }
          if (!isCurrent()) return
          // The running total only grows (D121): a snapshot older than the
          // file, from another window, never lowers what a newer save wrote.
          // And both increments survive: past this window's own base, what
          // its snapshot spent is added onto the file's total instead of
          // the larger of two snapshots from the same total winning.
          const previousSpend = previous?.budgetSpentUsd
          const incomingSpend = session.budgetSpentUsd
          const base = spendBases.get(session.sessionId)
          // A one-time D121 rebuild replaces its legacy file: the file's
          // total was written while an open reservation counted as spend,
          // so merging the window's delta onto it would keep the phantom.
          // Later saves merge as before.
          const shouldReplaceLegacyTotal =
            previous?.spendSettledOnly !== true &&
            session.spendSettledOnly === true &&
            incomingSpend !== undefined
          let projected = session
          if (!shouldReplaceLegacyTotal && previousSpend !== undefined) {
            if (
              incomingSpend !== undefined &&
              base !== undefined &&
              Usd.from(incomingSpend).compare(Usd.from(base)) >= 0
            )
              projected = {
                ...session,
                budgetSpentUsd: Usd.from(previousSpend)
                  .add(Usd.from(incomingSpend).subtract(Usd.from(base)))
                  .toAmount(),
              }
            else if (
              incomingSpend === undefined ||
              Usd.from(incomingSpend).compare(Usd.from(previousSpend)) < 0
            )
              projected = { ...session, budgetSpentUsd: previousSpend }
          }
          // Calls without usage merge the same way: past this window's own
          // count base, what its snapshot recorded is added onto the
          // file's count, so the later save keeps both windows' unknown
          // calls instead of overwriting the other's increment.
          const previousUnknown = previous?.unknownChargeCalls
          const incomingUnknown = session.unknownChargeCalls
          const unknownBase = unknownBases.get(session.sessionId)
          if (previousUnknown !== undefined) {
            if (
              incomingUnknown !== undefined &&
              unknownBase !== undefined &&
              incomingUnknown >= unknownBase
            )
              projected = {
                ...projected,
                unknownChargeCalls: previousUnknown + (incomingUnknown - unknownBase),
              }
            else if (incomingUnknown === undefined || incomingUnknown < previousUnknown)
              projected = { ...projected, unknownChargeCalls: previousUnknown }
          }
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
          // This window's base is its own unmerged total, stored only after
          // the write lands. Storing the merged file total instead drops the
          // window's next increment: with the same session open in two
          // windows, both load 1 and save 3 and 5, and the second window's
          // next save of 6 would read as older than its stored base of 7.
          if (incomingSpend === undefined) spendBases.delete(session.sessionId)
          else spendBases.set(session.sessionId, incomingSpend)
          if (incomingUnknown === undefined) unknownBases.delete(session.sessionId)
          else unknownBases.set(session.sessionId, incomingUnknown)
          await uploads?.syncSession(session.sessionId, fileRefsOf(projected), isCurrent)
          if (isCurrent()) await rm(intentFor(session.sessionId), { force: true })
        },
      )
    },
    async remove(sessionId) {
      assertSessionId(sessionId)
      await deps.questions?.remove(sessionId)
      await withSession(sessionId, undefined, true, async (session, uploads, intent) => {
        await removeSession(sessionId, intent?.accountId ?? session?.accountId, uploads)
        // TOOLCAP: the deleted session's spills die with it, said when not.
        // A session that never existed has no spills: nothing to say.
        if (session !== undefined) await removeSpillsForSession(session.workspaceRoot, sessionId)
      })
    },
  }
}
