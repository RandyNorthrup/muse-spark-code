// Bound session and usage report inputs (M113 lane C-M113-2, PLAN.md D93.4).
// Every engine construction (VS Code, ACP, CLI) builds these from the same
// durable sources: M84's session history and M102's usage journal through
// aggregate.ts. Ships in dist/reportInputs.js; the hosts pass only identifiers
// and directories, so activation carries no new import.
import { open, realpath } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
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
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  DEVELOPER_AUDIT_MAX_BYTES,
  DEVELOPER_FILES,
  REPORT_MAX_ROWS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { BackendKind } from '../../shared/protocol'
import type { AgentHost } from '../../core/agent/agentBackend'
import { itemSnapshotSchema, type ItemSnapshot } from '../../shared/agentEvents'
import { LocalSourceError, localFailureOf, sourceReason } from '../../core/reporting/sources/local'
import {
  accountsConfirmationRowSchema,
  accountsEventRowSchema,
  accountsUsageRowSchema,
  accountsAccountRowSchema,
  accountsProviderRowSchema,
  accountsThresholdsSchema,
} from '../../core/reporting/sources/accounts'
import {
  securityAuditRowSchema,
  securityDeveloperAuditRowSchema,
} from '../../core/reporting/sources/security'
import type { ReportSessionReader } from '../../core/reporting/sources/session'
import type { ReportAccountsReader } from '../../core/reporting/sources/accounts'
import type { ReportSecurityReader } from '../../core/reporting/sources/security'
import type { LocalReportSourceDeps } from '../../core/reporting/sources'
import type {
  AccountsFacts,
  SecurityFacts,
  SourceReadContext,
} from '../../core/reporting/sources/types'
import { accountIdSchema, accountSchema, accountThresholdsSchema } from '../../shared/accounts'
import { developerAuditSchema } from '../../shared/developerOptions'
import {
  vaultAuditRecordSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
} from '../../shared/vault'
import { vaultStatusSchema, type VaultStatus } from '../../shared/vaultStatus'
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

/**
 * Name one true failure reason on a reader's partial list (RVCM1133): a
 * partly unreadable source keeps its good rows and carries the same
 * sentence a whole-read failure would show, instead of collapsing the
 * good rows into a generic failure or reporting success with silently
 * dropped rows.
 */
function keepReason(partials: string[], reason: string): void {
  if (!partials.includes(reason)) partials.push(reason)
}

/**
 * The true sentence for a sub-source that threw: its own failure code when
 * it names one, otherwise the generic read failure. Only fixed sentences
 * ever enter a partial; a record's own text never does, so no secret, key
 * material or vault item value can reach a reason (RVCM1133B).
 */
function failureReason(error: unknown): string {
  const code = localFailureOf(error)
  return code === undefined ? UI_TEXT.reportSourceReasons.failed : sourceReason(code)
}

/** A row schema any record stream below can be validated against one by one. */
interface RowSchema<T> {
  safeParse(row: unknown): { readonly success: boolean; readonly data?: T }
}

/** Admission owns the bound; final validation never drops accepted sibling facets. */
function admitRow<T>(row: T, into: T[], partials: string[]): void {
  if (into.length >= REPORT_MAX_ROWS) keepReason(partials, UI_TEXT.reportSourceReasons.limit)
  else into.push(row)
}

/**
 * One record stream that never discards its good rows for one bad record:
 * each row parses on its own, a bad row is skipped, and any skip keeps the
 * invalid reason beside the rows (RVCM1133B P2). A value that is not a row
 * list at all is the same failure, never a throw.
 */
function collectValidRows<T>(
  rows: unknown,
  schema: RowSchema<T>,
  into: T[],
  partials: string[],
): void {
  if (!Array.isArray(rows)) {
    keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
    return
  }
  let skipped = 0
  for (const row of rows) {
    let parsed: ReturnType<RowSchema<T>['safeParse']>
    try {
      parsed = schema.safeParse(row)
    } catch (error) {
      keepReason(partials, failureReason(error))
      continue
    }
    if (!parsed.success || parsed.data === undefined) {
      skipped += 1
      continue
    }
    admitRow(parsed.data, into, partials)
  }
  if (skipped > 0) keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
}

/**
 * Every sub-source createAccountsReportReader consumes. The resilience
 * table in reportSourceReasons.test.ts covers each one in every way it can
 * fail; a new sub-source is added here first, which fails that test until
 * its cases exist (RVCM1133B).
 */
export const ACCOUNTS_REPORT_SUB_SOURCES = ['registry', 'usage', 'events'] as const

/**
 * Every sub-source createSecurityReportReader consumes: the vault view and
 * its audit from the injected snapshot, and each developer audit rotation
 * file. Same coverage rule as the accounts inventory (RVCM1133B).
 */
export const SECURITY_REPORT_SUB_SOURCES = [
  'vault',
  'vaultAudit',
  'developerAudit',
  'developerAuditPrevious',
] as const

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

/** One snapshot per generation, shared by concurrent session and usage sources. */
export function createReportJournalReader(input: {
  readonly dataFolder: string
  readonly beforeRead?: () => Promise<void>
  readonly readBudgets?: () => Promise<readonly UsageBudgetRead[]>
  readonly now?: () => number
  /** Machine-local day, like M102's page; callers pass getTimezoneOffset(). */
  readonly timezoneOffsetMins?: number
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
          const offset = input.timezoneOffsetMins ?? 0
          const budgetDay =
            new Date(
              (input.now?.() ?? Date.now()) - offset * MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE,
            )
              .toISOString()
              .split('T', 1)[0] ?? ''
          return { ...journal, budgets, budgetDay }
        } catch {
          return {
            ...journal,
            partial: [journal.partial, UI_TEXT.reportDetailReasons.budgetsUnavailable]
              .filter((reason) => reason !== undefined)
              .join(' '),
          }
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
  readonly timezoneOffsetMins: number
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
      timezoneOffsetMins: input.timezoneOffsetMins,
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
  // The transcript above is already read: a catalogue that omits the optional
  // isActive flag must not discard it. Prefer the active row, then the first
  // row; only an empty catalogue is a failure (RVCM1132B finding 4).
  const model = models.find((entry) => entry.isActive) ?? models[0]
  if (model === undefined) throw new LocalSourceError('failed')
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
      const partials: string[] = journal.partial === undefined ? [] : [journal.partial]
      // The session totals below sum only the records still attributable to
      // this session; rolled-up days can never be attributed back to it, so
      // the disclosure says excluded, never included (RVCM1132B finding 1).
      if (journal.rollups.length > 0)
        partials.push(UI_TEXT.reportDetailReasons.rolledUpSessionExcluded)
      if (
        history.items.length > 0 &&
        journal.records.every((record) => record.session !== history.sessionId)
      )
        partials.push(UI_TEXT.reportDetailReasons.sessionUsageUnavailable)
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

/**
 * M108's account registry file: metadata only, never a credential (the
 * runtime's providers file keeps secrets and vendor responses on separate
 * injected ports). A missing file is a fresh install, never an error; a
 * corrupt one is invalid, never an empty registry.
 */
const registryEntrySchema = z.object({
  id: accountIdSchema,
  product: accountIdSchema,
  auth: z.enum(['apiKey', 'oauth', 'subscription', 'none']),
  accounts: z.optional(z.unknown()),
})

async function readDataFile(directory: string, file: string, maxBytes: number) {
  const target = path.join(directory, file)
  let handle
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    // A linked final component is a private path, never an incomplete
    // read: the sibling session reader refuses it the same way (RVCM1133).
    if (errorCode(error) === 'ELOOP') throw new LocalSourceError('refused')
    throw new LocalSourceError('failed')
  }
  try {
    // Where O_NOFOLLOW is a no-op the open above follows a linked final
    // component instead of failing it: refuse the link before a byte is
    // parsed. Ancestor links are ordinary directories and stay readable.
    const link = await lstatIdentity(target)
    if (link.isSymbolicLink()) throw new LocalSourceError('refused')
    const held = await handleIdentity(handle)
    // The open handle must still name this path: a swap between open and
    // lstat is a private path, refused the same way (RVCM1133B P3).
    if (!sameFile(link, held)) throw new LocalSourceError('refused')
    if (!held.isFile() || held.size > BigInt(maxBytes)) throw new LocalSourceError('limit')
    // A hard-linked final component is a private path, never an incomplete
    // read: refuse it like the sibling session reader (RVCM1133B P3).
    if (held.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT)) throw new LocalSourceError('refused')
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead <= maxBytes) {
      const { bytesRead: chunkBytes } = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      )
      if (chunkBytes === 0) break
      bytesRead += chunkBytes
    }
    if (bytesRead > maxBytes) throw new LocalSourceError('limit')
    if (!sameFile(held, await lstatIdentity(target))) throw new LocalSourceError('refused')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    } catch {
      throw new LocalSourceError('invalid')
    }
  } catch (error) {
    if (error instanceof LocalSourceError) throw error
    throw new LocalSourceError('failed')
  } finally {
    await handle.close()
  }
}

const registryAccountMetadataSchema = z.object({
  id: accountSchema.shape.id,
  label: accountSchema.shape.label,
  order: accountSchema.shape.order,
  limitGroup: accountSchema.shape.limitGroup,
  thresholds: z.optional(z.unknown()),
})
const recordFieldsSchema = z.record(z.string(), z.unknown())

function projectThresholds(
  raw: unknown,
  partials: string[],
): AccountsFacts['providers'][number]['accounts'][number]['thresholds'] {
  // Whole-shape validation discloses unknown fields without vetoing valid limits.
  if (!accountThresholdsSchema.safeParse(raw).success)
    keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
  const result: z.infer<typeof accountsThresholdsSchema> = {
    spendUsd: [],
    counts: [],
    percents: [],
  }
  const fields = (value: unknown): Record<string, unknown> => {
    if (value === undefined) return {}
    const parsed = recordFieldsSchema.safeParse(value)
    if (parsed.success) return parsed.data
    keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
    return {}
  }
  const thresholds = fields(raw)
  for (const metric of ['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const) {
    const amounts = fields(thresholds[metric])
    for (const period of ['day', 'week', 'month'] as const) {
      const value = amounts[period]
      if (value === undefined) continue
      if (metric === 'spendUsd')
        collectValidRows(
          [{ period, value }],
          accountsThresholdsSchema.shape.spendUsd.def.element,
          result.spendUsd,
          partials,
        )
      else
        collectValidRows(
          [{ metric, period, value }],
          accountsThresholdsSchema.shape.counts.def.element,
          result.counts,
          partials,
        )
    }
  }
  const planWindows = Object.entries(fields(thresholds['planWindowPercent']))
  for (const [name, value] of planWindows) {
    if (!accountIdSchema.safeParse(name).success) {
      keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
      continue
    }
    collectValidRows(
      [{ name, value }],
      accountsThresholdsSchema.shape.percents.def.element,
      result.percents,
      partials,
    )
  }
  const headroom = fields(thresholds['rateLimitHeadroomPercent'])
  for (const metric of ['requests', 'tokens'] as const) {
    const value = headroom[metric]
    if (value !== undefined)
      collectValidRows(
        [{ name: `rateLimitHeadroom/${metric}`, value }],
        accountsThresholdsSchema.shape.percents.def.element,
        result.percents,
        partials,
      )
  }
  return result
}

/**
 * The reporting `accounts` source from M108's registry on disk, with use,
 * swaps and confirmations from injected adapters. Facets no adapter supplies
 * stay empty and are named in the partial, never invented. No sub-source
 * discards another's rows: a registry entry that fails validation is
 * skipped with the invalid reason while the good entries still report, and
 * a registry or adapter that fails outright keeps its own reason beside
 * the rows the other sub-sources still return (RVCM1133B P2). Only a
 * missing registry file is a fresh install that reads as null.
 */
export function createAccountsReportReader(input: {
  readonly dataDir: string
  readonly readUsage?: (
    context: SourceReadContext,
  ) => Promise<AccountsFacts['usage'] | null | undefined>
  readonly readEvents?: (
    context: SourceReadContext,
  ) => Promise<Pick<AccountsFacts, 'events' | 'confirmations'> | null | undefined>
}): ReportAccountsReader {
  return {
    read: async (context: SourceReadContext) => {
      const partials: string[] = []
      const providers: AccountsFacts['providers'][number][] = []
      try {
        const text = await readDataFile(
          input.dataDir,
          'providers.json',
          EXEC_UNTRUSTED_FILE_MAX_BYTES,
        )
        if (text === null && input.readUsage === undefined && input.readEvents === undefined)
          return null
        if (text === null) keepReason(partials, UI_TEXT.reportSourceReasons.missing)
        let raw: unknown
        try {
          raw = text === null ? undefined : JSON.parse(text)
        } catch {
          raw = undefined
          keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
        }
        if (raw !== undefined) {
          const envelope = z.object({ providers: z.record(z.string(), z.unknown()) }).safeParse(raw)
          if (envelope.success) {
            let invalidEntries = 0
            for (const entry of Object.values(envelope.data.providers)) {
              const parsed = registryEntrySchema.safeParse(entry)
              if (!parsed.success) {
                invalidEntries += 1
                continue
              }
              const accounts: AccountsFacts['providers'][number]['accounts'][number][] = []
              if (parsed.data.accounts !== undefined) {
                if (Array.isArray(parsed.data.accounts)) {
                  for (const rawAccount of parsed.data.accounts) {
                    // Preserve the strict stored contract's disclosure while
                    // accepting independently valid metadata and limits below.
                    if (!accountSchema.safeParse(rawAccount).success)
                      keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
                    const metadata = registryAccountMetadataSchema.safeParse(rawAccount)
                    if (!metadata.success) {
                      keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
                      continue
                    }
                    collectValidRows(
                      [
                        {
                          id: metadata.data.id,
                          label: metadata.data.label,
                          order: metadata.data.order,
                          limitGroup: metadata.data.limitGroup ?? null,
                          thresholds: projectThresholds(metadata.data.thresholds, partials),
                        },
                      ],
                      accountsAccountRowSchema,
                      accounts,
                      partials,
                    )
                  }
                } else {
                  keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
                }
              }
              collectValidRows(
                [
                  {
                    provider: parsed.data.id,
                    product: parsed.data.product,
                    auth: parsed.data.auth,
                    accounts,
                  },
                ],
                accountsProviderRowSchema,
                providers,
                partials,
              )
            }
            if (invalidEntries > 0) keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
          } else keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
        }
      } catch (error) {
        // An unreadable registry is one failed sub-source, never a failed
        // read: the injected facets below still report (RVCM1133B P2).
        if (context.signal.aborted) throw error
        keepReason(partials, failureReason(error))
      }
      const missing: string[] = []
      const usage: AccountsFacts['usage'][number][] = []
      if (input.readUsage === undefined) missing.push('usage')
      else {
        try {
          const read = await input.readUsage(context)
          if (read === null || read === undefined) missing.push('usage')
          else collectValidRows(read, accountsUsageRowSchema, usage, partials)
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error))
        }
      }
      const events: AccountsFacts['events'][number][] = []
      const confirmations: AccountsFacts['confirmations'][number][] = []
      if (input.readEvents === undefined) missing.push('swaps', 'confirmations')
      else {
        try {
          const read = await input.readEvents(context)
          if (read === null || read === undefined) missing.push('swaps', 'confirmations')
          else {
            if (typeof read !== 'object' || Array.isArray(read))
              keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
            else {
              collectValidRows(
                readSnapshotFacet(read, 'events', partials),
                accountsEventRowSchema,
                events,
                partials,
              )
              collectValidRows(
                readSnapshotFacet(read, 'confirmations', partials),
                accountsConfirmationRowSchema,
                confirmations,
                partials,
              )
            }
          }
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error))
        }
      }
      if (missing.length > 0)
        partials.push(
          fill(UI_TEXT.reportDetailReasons.accountsFacetsUnavailable, {
            facets: missing.join(', '),
          }),
        )
      return {
        facts: { providers, usage, events, confirmations },
        observedAt: context.asOf,
        ...(partials.length > 0 && { partial: partials.join(' ') }),
      }
    },
  }
}

/** An unlock-capable vault view. Raw records never leave the report bundle:
 * the reader projects them to counts and kinds before returning. */
export interface SecurityVaultSnapshot {
  readonly state: VaultStatus['state']
  readonly tier: VaultStatus['tier']
  readonly items: readonly unknown[]
  readonly grants: readonly unknown[]
  readonly audit: readonly unknown[]
}

/** An adapter may expose a throwing getter: isolate every result facet. */
function readSnapshotFacet(snapshot: unknown, key: string, partials: string[]): unknown {
  try {
    const field = z.object({ [key]: z.unknown() })
    const parsed = field.safeParse(snapshot)
    if (parsed.success) return parsed.data[key]
    keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
  } catch (error) {
    keepReason(partials, failureReason(error))
  }
  return undefined
}

/**
 * The reporting `security` source from the developer audit on disk and an
 * injected unlock-capable vault view. Without values throughout: the vault
 * contributes its tier, item counts by kind, grant scopes and audit
 * aggregates; the developer audit contributes action counts. A locked or
 * unbound vault leaves the vault facets empty with its reason; without the
 * developer audit either, both reasons travel in the partial instead of a
 * generic missing file (RVCM1133). No record or sub-source discards what
 * the read already accepted: each vault record and each audit line parses
 * on its own, a bad one is skipped with the invalid reason, and a vault
 * view or audit file that fails outright keeps its own reason beside the
 * rows the other sub-sources still return (RVCM1133B P2).
 */
export function createSecurityReportReader(input: {
  readonly dataDir: string
  readonly readVault?: (context: SourceReadContext) => Promise<SecurityVaultSnapshot | null>
}): ReportSecurityReader {
  return {
    read: async (context: SourceReadContext) => {
      const partials: string[] = []
      let vault: SecurityFacts['vault'] = null
      const vaultAudit: SecurityFacts['audit'][number][] = []
      let snapshot: unknown = null
      if (input.readVault !== undefined) {
        try {
          snapshot = await input.readVault(context)
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error))
        }
      }
      if (snapshot === null || snapshot === undefined)
        keepReason(partials, UI_TEXT.reportDetailReasons.securityVaultUnavailable)
      else {
        const envelope = z.object({}).safeParse(snapshot)
        if (envelope.success) {
          // Audit evidence is independent of view state/tier and item/grant validity.
          const records: z.infer<typeof vaultAuditRecordSchema>[] = []
          collectValidRows(
            readSnapshotFacet(snapshot, 'audit', partials),
            vaultAuditRecordSchema,
            records,
            partials,
          )
          for (const record of records)
            collectValidRows(
              [
                {
                  kind: record.kind,
                  decision: record.decision,
                  authority: record.authority,
                  outcome: record.outcome,
                },
              ],
              securityAuditRowSchema,
              vaultAudit,
              partials,
            )
          const view = z
            .strictObject({
              state: vaultStatusSchema.shape.state,
              tier: vaultStatusSchema.shape.tier,
            })
            .safeParse({
              state: readSnapshotFacet(snapshot, 'state', partials),
              tier: readSnapshotFacet(snapshot, 'tier', partials),
            })
          if (view.success) {
            const items: z.infer<typeof vaultItemMetadataSchema>[] = []
            collectValidRows(
              readSnapshotFacet(snapshot, 'items', partials),
              vaultItemMetadataSchema,
              items,
              partials,
            )
            const grants: z.infer<typeof vaultGrantSchema>[] = []
            collectValidRows(
              readSnapshotFacet(snapshot, 'grants', partials),
              vaultGrantSchema,
              grants,
              partials,
            )
            const itemsByKind = new Map<string, number>()
            for (const item of items)
              itemsByKind.set(item.kind, (itemsByKind.get(item.kind) ?? 0) + 1)
            const grantsByScope = new Map<string, number>()
            for (const grant of grants) {
              const scope = `${grant.roles === 'any' ? 'any' : 'named'}/${grant.workspaces === 'any' ? 'any' : 'named'}`
              grantsByScope.set(scope, (grantsByScope.get(scope) ?? 0) + 1)
            }
            vault = {
              state: view.data.state,
              tier: view.data.tier,
              itemCount: items.length,
              itemsByKind: Array.from(itemsByKind, ([kind, count]) => ({ kind, count })),
              grants: Array.from(grantsByScope, ([scope, count]) => ({ scope, count })),
            }
          } else {
            keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
          }
        } else {
          keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
        }
      }
      const directory = path.join(input.dataDir, 'developer')
      let developerAudit: SecurityFacts['developerAudit'][number][] | null = null
      const auditFiles = [DEVELOPER_FILES.audit, `${DEVELOPER_FILES.audit}.previous`]
      for (const file of auditFiles) {
        let text: string | null
        try {
          text = await readDataFile(directory, file, DEVELOPER_AUDIT_MAX_BYTES)
        } catch (error) {
          // An unreadable rotation is one failed sub-source: the vault
          // rows above and the other rotation still report (RVCM1133B P2).
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error))
          continue
        }
        if (text === null) continue
        let skipped = 0
        developerAudit ??= []
        for (const line of text.trim().split('\n')) {
          if (line === '') continue
          let entry: unknown
          try {
            entry = JSON.parse(line)
          } catch {
            skipped += 1
            continue
          }
          const parsed = developerAuditSchema.safeParse(entry)
          if (!parsed.success) {
            skipped += 1
            continue
          }
          // The profile id parses here and is dropped: only the action
          // and source travel into the facts.
          collectValidRows(
            [{ action: parsed.data.action, source: parsed.data.source }],
            securityDeveloperAuditRowSchema,
            developerAudit,
            partials,
          )
        }
        if (skipped > 0) keepReason(partials, UI_TEXT.reportSourceReasons.invalid)
      }
      if (developerAudit === null)
        partials.push(UI_TEXT.reportDetailReasons.securityDeveloperAuditUnavailable)
      // Both sources absent is a partial naming both true reasons, never a
      // bare null that the source would report as a generic missing file.
      return {
        facts: { vault, audit: vaultAudit, developerAudit: developerAudit ?? [] },
        observedAt: context.asOf,
        ...(partials.length > 0 && { partial: partials.join(' ') }),
      }
    },
  }
}
