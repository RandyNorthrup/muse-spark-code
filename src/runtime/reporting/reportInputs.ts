// Bound session and usage report inputs (M113 lane C-M113-2, PLAN.md D93.4).
// Every engine construction (VS Code, ACP, CLI) builds these from the same
// durable sources: M84's session history and M102's usage journal through
// aggregate.ts. Ships in dist/reportInputs.js; the hosts pass only identifiers
// and directories, so activation carries no new import.
import { open, realpath } from 'node:fs/promises'
import { constants as fsConstants, readFileSync } from 'node:fs'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  SESSION_EXPORT_MAX_BYTES,
  STORED_SESSION_VERSION,
  REPORT_STORAGE_LINK_COUNT,
} from '../../shared/constants'
import type { BackendKind } from '../../shared/protocol'
import type { AgentHost } from '../../core/agent/agentBackend'
import { itemSnapshotSchema, type ItemSnapshot } from '../../shared/agentEvents'
import { LocalSourceError, pushPartialReason } from '../../core/reporting/sources/local'
import type { ReportSessionReader } from '../../core/reporting/sources/session'
import type { LocalReportSourceDeps } from '../../core/reporting/sources'
import type { SourceReadContext } from '../../core/reporting/sources/types'
import {
  sessionTurnCount,
  sessionUsageFacts,
  usageReportFacts,
  type UsageReportJournal,
} from '../../core/usage/reportUsage'
import { UsageJournalStore, toAggregateRow } from '../../core/usage/journalStore'
import { NodeUsageFs } from '../usage/nodeUsageFs'
import type { UsageAggregateRow } from '../../core/usage/aggregate'
import type { UsageBudgetRead } from '../../core/usage/usageService'

/**
 * The installed manifest for the keybindings report (M113 C-M113-5, D93.4):
 * each host passes its own install's package.json path, so VS Code, ACP and
 * the CLI report the same installed bindings. Read at generation time, never
 * at import, and parsed by the source's schema; a missing or broken file is
 * an unavailable source with its reason, never an empty report.
 */
export function keybindingsManifestReader(packageJsonPath: string): () => unknown {
  return () => {
    let raw: string
    try {
      raw = readFileSync(packageJsonPath, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new LocalSourceError('missing')
      throw new LocalSourceError('failed')
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed
    } catch {
      throw new LocalSourceError('invalid')
    }
  }
}

/** A session id names a file; only the UUID alphabet is allowed into a path. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u

export interface SessionHistoryInput {
  readonly sessionId: string
  readonly backend: BackendKind
  readonly modelId: string
  readonly name?: string | undefined
  readonly items: readonly ItemSnapshot[]
  readonly turnIds: readonly string[]
  /** Why the session source is partial although its transcript was read. */
  readonly partial?: string | undefined
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/** The durable usage journal, tolerating a fresh install with no history yet. */
export async function readUsageReportJournal(dataFolder: string): Promise<UsageReportJournal> {
  const store = new UsageJournalStore(new NodeUsageFs(dataFolder), {
    writerId: randomUUID(),
    now: Date.now,
    isEnabled: () => false,
    onWriteError: () => {
      // Reads never write; a missing journal reads empty, never an error.
    },
  })
  let journal: Awaited<ReturnType<typeof store.read>>
  try {
    journal = await store.read()
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { records: [], rollups: [], limits: [] }
    throw new LocalSourceError('failed')
  }
  const rollups: UsageAggregateRow[] = journal.rollups.map((row) => toAggregateRow(row))
  const isDamaged =
    journal.invalidLines +
      journal.tornLines +
      journal.newerVersionRecords +
      journal.newerVersionFiles >
    0
  return {
    records: journal.records,
    rollups,
    limits: journal.limits,
    ...(isDamaged && { partial: UI_TEXT.reportDetailReasons.journalIncomplete }),
  }
}

const reportOffsetByRun = new WeakMap<object, number>()

/**
 * One machine-local offset per report run, shared by the budget day and the
 * period day: a DST change or midnight between the two samples must not
 * stamp them on different days (RVCM1132C finding 3). Runs are fresh objects
 * per generation, so entries never outlive their report.
 */
export function reportTimezoneOffset(context: SourceReadContext): number {
  const key = context.run ?? context.options
  let offset = reportOffsetByRun.get(key)
  if (offset === undefined) {
    offset = new Date().getTimezoneOffset()
    reportOffsetByRun.set(key, offset)
  }
  return offset
}

function resolveTimezoneOffset(
  value: number | ((context: SourceReadContext) => number) | undefined,
  context: SourceReadContext,
): number | undefined {
  return typeof value === 'function' ? value(context) : value
}

/** One snapshot per generation, shared by concurrent session and usage sources. */
export function createReportJournalReader(input: {
  readonly dataFolder: string
  readonly beforeRead?: () => Promise<void>
  readonly readBudgets?: () => Promise<readonly UsageBudgetRead[]>
  readonly now?: () => number
  /**
   * Machine-local day, like M102's page. Callers pass reportTimezoneOffset
   * so the budget stamp shares the report's single sample (RVCM1132C
   * finding 3); a plain number keeps a fixed day for tests.
   */
  readonly timezoneOffsetMins?: number | ((context: SourceReadContext) => number)
}): (context: SourceReadContext) => Promise<UsageReportJournal> {
  const runs = new WeakMap<object, Promise<UsageReportJournal>>()
  return (context) => {
    let pending = runs.get(context.run ?? context.options)
    if (pending === undefined) {
      pending = (async () => {
        await input.beforeRead?.()
        const journal = await readUsageReportJournal(input.dataFolder)
        // Only the usage kinds render a Limits section; a session report
        // never touches budget machinery or its failure partial.
        if (
          input.readBudgets === undefined ||
          (context.options.kind !== 'usage' && context.options.kind !== 'project')
        )
          return journal
        try {
          const budgets = await input.readBudgets()
          // The same calendar as the report period (usageReportQuery): the
          // machine-local day, never the UTC stamp (RVCM1132B finding 2).
          const offset = resolveTimezoneOffset(input.timezoneOffsetMins, context) ?? 0
          const budgetDay =
            new Date(
              (input.now?.() ?? Date.now()) - offset * MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE,
            )
              .toISOString()
              .split('T', 1)[0] ?? ''
          return { ...journal, budgets, budgetDay }
        } catch {
          // Partial reasons are a set of sentences: a reason already present
          // is never appended again (RVCM1132C finding 5, RVCM1132D
          // finding 2).
          const reasons: string[] = []
          if (journal.partial !== undefined) pushPartialReason(reasons, journal.partial)
          pushPartialReason(reasons, UI_TEXT.reportDetailReasons.budgetsUnavailable)
          return { ...journal, partial: reasons.join(' ') }
        }
      })()
      runs.set(context.run ?? context.options, pending)
    }
    return pending
  }
}

/** M102's journal as the reporting `usage` source: the same numbers as its page. */
export function createUsageReportReader(input: {
  readonly dataFolder: string
  readonly readJournal?: (context: SourceReadContext) => Promise<UsageReportJournal>
  /**
   * Machine-local day, like M102's page. Callers pass reportTimezoneOffset
   * so the period shares the budget stamp's single sample (RVCM1132C
   * finding 3); a plain number keeps a fixed day for tests.
   */
  readonly timezoneOffsetMins: number | ((context: SourceReadContext) => number)
  readonly now?: () => number
}): NonNullable<LocalReportSourceDeps['usage']> {
  return async (context: SourceReadContext) => {
    const journal = await (input.readJournal?.(context) ?? readUsageReportJournal(input.dataFolder))
    const facts = usageReportFacts({
      journal,
      scope: context.options.kind === 'usage' ? context.options.scope : '7d',
      by: context.options.by,
      now: input.now?.() ?? Date.parse(context.asOf),
      asOf: context.asOf,
      timezoneOffsetMins: resolveTimezoneOffset(input.timezoneOffsetMins, context) ?? 0,
    })
    return {
      usage: facts.usage,
      observedAt: facts.observedAt,
      ...(facts.partial !== undefined && { partial: facts.partial }),
    }
  }
}

/**
 * The stored session envelope the report reads: the same field names and item
 * shape as M84's storedSessionFields, with items validated by the owned
 * itemSnapshotSchema (the report source validates the export again). Anything
 * else the store keeps never enters a report.
 */
const storedReportSessionSchema = z.object({
  version: z.literal(STORED_SESSION_VERSION),
  sessionId: z.string(),
  modelId: z.string(),
  name: z.optional(z.string()),
  turnIds: z.array(z.string()),
  transcript: z.array(z.object({ turnId: z.string(), item: itemSnapshotSchema })),
})

/** Read-only primary-backend history through the active host's existing ports. */
export async function readHostReportSession(
  host: Pick<AgentHost, 'info' | 'readSession' | 'listModels'>,
  sessionId: string,
): Promise<SessionHistoryInput | null> {
  const history = await host.readSession(sessionId, { recoverGoal: false })
  if (history.mode === 'none') return null
  const models = await host.listModels(sessionId)
  // The transcript above is already read: with no active catalogue row the
  // model is unknown, never a guess at the first entry, and the session
  // source carries the reason as partial (RVCM1132C finding 1). The
  // catalogue flag is optional on the wire, so a row without it is inactive.
  // Only an empty catalogue is a failure (RVCM1132B finding 4).
  const model = models.find((entry) => entry.isActive)
  if (model === undefined) {
    if (models.length === 0) throw new LocalSourceError('failed')
    return {
      sessionId,
      backend: host.info.kind,
      modelId: 'unknown',
      partial: UI_TEXT.reportDetailReasons.sessionModelUnavailable,
      ...(history.name !== undefined && { name: history.name }),
      items: history.items,
      turnIds: [],
    }
  }
  return {
    sessionId,
    backend: host.info.kind,
    modelId: model.modelId,
    ...(history.name !== undefined && { name: history.name }),
    items: history.items,
    turnIds: [],
  }
}

/** One workspace's stored Model API session, or null when it is not there. */
export async function readStoredReportSession(
  directory: string,
  sessionId: string,
): Promise<SessionHistoryInput | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null
  let raw: unknown
  try {
    // Only the session file itself may not be a link: ancestors of the real
    // directory (a symlinked data folder, home, or /var and /tmp on macOS)
    // resolve through realpath, whose before/after identity re-checks below
    // defeat a swap, so they never refuse an ordinary file (RVCM1132B
    // finding 6). The file's own lstat and the no-follow open still refuse
    // a linked file before a byte is parsed.
    const root = await realpath(directory)
    const file = path.join(root, `${sessionId}.json`)
    const before = await lstatIdentity(file)
    if (!before.isFile() || before.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT))
      throw new LocalSourceError('refused')
    if (before.size > BigInt(SESSION_EXPORT_MAX_BYTES)) throw new LocalSourceError('limit')
    const handle = await open(
      file,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    )
    try {
      const held = await handleIdentity(handle)
      if (
        !sameFile(before, held) ||
        !sameFile(before, await lstatIdentity(file)) ||
        (await realpath(directory)) !== root
      )
        throw new LocalSourceError('refused')
      const buffer = Buffer.alloc(SESSION_EXPORT_MAX_BYTES + 1)
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null)
        if (read.bytesRead === 0) break
        bytesRead += read.bytesRead
      }
      if (!sameFile(held, await lstatIdentity(file)) || (await realpath(directory)) !== root)
        throw new LocalSourceError('refused')
      if (bytesRead > SESSION_EXPORT_MAX_BYTES) throw new LocalSourceError('limit')
      raw = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)),
      )
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    if (error instanceof LocalSourceError) throw error
    throw new LocalSourceError('failed')
  }
  const parsed = storedReportSessionSchema.safeParse(raw)
  if (!parsed.success || parsed.data.sessionId !== sessionId) throw new LocalSourceError('invalid')
  const session = parsed.data
  return {
    sessionId: session.sessionId,
    backend: 'modelApi',
    modelId: session.modelId,
    ...(session.name !== undefined && { name: session.name }),
    items: session.transcript.map((entry) => entry.item),
    turnIds: session.turnIds,
  }
}

/**
 * The reporting `session` source from M84's history: the transcript as the
 * export source, turns retained before the portable projection drops their
 * ids, and the session's own journal usage. Checks run arrive through the
 * workspace check-run source, which the collector prefers; the payload keeps
 * an empty list so a second journal read never diverges from it. History
 * items carry no approval decisions, so approvals stay explicitly unavailable
 * instead of inferred.
 */
export function createSessionReportReader(input: {
  readonly resolveSession: (sessionId: string | undefined) => Promise<SessionHistoryInput | null>
  readonly readJournal: (context: SourceReadContext) => Promise<UsageReportJournal>
}): ReportSessionReader {
  return {
    read: async (context: SourceReadContext) => {
      const history = await input.resolveSession(context.options.sessionId)
      if (history === null) throw new LocalSourceError('history')
      const journal = await input.readJournal(context)
      // The transcript reader's own reason (an unknown catalogue model)
      // travels with the session source, beside the journal's (RVCM1132C
      // finding 1).
      const partials: string[] = [
        ...(journal.partial === undefined ? [] : [journal.partial]),
        ...(history.partial === undefined ? [] : [history.partial]),
      ]
      // The session totals below sum only the records still attributable to
      // this session; rolled-up days can never be attributed back to it, so
      // the disclosure says excluded, never included (RVCM1132B finding 1).
      // Partial reasons are a set of sentences: no sentence appears twice
      // (RVCM1132C finding 5, RVCM1132D finding 2).
      const pushPartial = (reason: string): void => {
        pushPartialReason(partials, reason)
      }
      if (journal.rollups.length > 0)
        pushPartial(UI_TEXT.reportDetailReasons.rolledUpSessionExcluded)
      if (
        history.items.length > 0 &&
        journal.records.every((record) => record.session !== history.sessionId)
      )
        pushPartial(UI_TEXT.reportDetailReasons.sessionUsageUnavailable)
      const turns =
        history.turnIds.length > 0 ? history.turnIds.length : sessionTurnCount(history.items)
      return {
        source: {
          backend: history.backend,
          modelId: history.modelId,
          ...(history.name !== undefined && { name: history.name }),
          exportedAt: context.asOf,
          items: history.items,
        },
        activity: {
          turns:
            turns === null
              ? {
                  status: 'unavailable',
                  reason: UI_TEXT.reportDetailReasons.sessionTurnsUnavailable,
                }
              : { status: 'available', count: turns },
          approvals: {
            status: 'unavailable',
            reason: UI_TEXT.reportDetailReasons.sessionApprovalsUnavailable,
          },
        },
        usage: sessionUsageFacts(journal.records, history.sessionId),
        checkRuns: [],
        observedAt: context.asOf,
        ...(partials.length > 0 && { partial: partials.join(' ') }),
      }
    },
  }
}
