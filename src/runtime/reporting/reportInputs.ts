// Bound session and usage report inputs (M113 lane C-M113-2, PLAN.md D93.4).
// Every engine construction (VS Code, ACP, CLI) builds these from the same
// durable sources: M84's session history and M102's usage journal through
// aggregate.ts. Ships in dist/reportInputs.js; the hosts pass only identifiers
// and directories, so activation carries no new import.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import type { BackendKind } from '../../shared/protocol'
import { itemSnapshotSchema, type ItemSnapshot } from '../../shared/agentEvents'
import { LocalSourceError } from '../../core/reporting/sources/local'
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

/** A session id names a file; only the UUID alphabet is allowed into a path. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u

export interface SessionHistoryInput {
  readonly sessionId: string
  readonly backend: BackendKind
  readonly modelId: string
  readonly name?: string | undefined
  readonly items: readonly ItemSnapshot[]
  readonly turnIds: readonly string[]
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
  return { records: journal.records, rollups, limits: journal.limits }
}

/** M102's journal as the reporting `usage` source: the same numbers as its page. */
export function createUsageReportReader(input: {
  readonly dataFolder: string
  readonly now?: () => number
}): NonNullable<LocalReportSourceDeps['usage']> {
  return async (context: SourceReadContext) => {
    const journal = await readUsageReportJournal(input.dataFolder)
    const facts = usageReportFacts({
      journal,
      scope: context.options.scope,
      by: context.options.by,
      now: input.now?.() ?? Date.parse(context.asOf),
      asOf: context.asOf,
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
  sessionId: z.string(),
  modelId: z.string(),
  name: z.optional(z.string()),
  turnIds: z.array(z.string()),
  transcript: z.array(z.object({ turnId: z.string(), item: itemSnapshotSchema })),
})

/** One workspace's stored Model API session, or null when it is not there. */
export async function readStoredReportSession(
  directory: string,
  sessionId: string,
): Promise<SessionHistoryInput | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null
  let raw: unknown
  try {
    const text = await readFile(path.join(directory, `${sessionId}.json`), 'utf8')
    raw = JSON.parse(text) as unknown
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw new LocalSourceError('failed')
  }
  const parsed = storedReportSessionSchema.safeParse(raw)
  if (!parsed.success) return null
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
  readonly readJournal: () => Promise<UsageReportJournal>
}): ReportSessionReader {
  return {
    read: async (context: SourceReadContext) => {
      const history = await input.resolveSession(context.options.sessionId)
      if (history === null) throw new LocalSourceError('history')
      const journal = await input.readJournal()
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
      }
    },
  }
}
