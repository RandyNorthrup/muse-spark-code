import type { ReportLabelKey } from '../../shared/reportSchema'
import {
  joinPartialReasons,
  readReportField,
  readReportRows,
} from '../../core/reporting/sources/boundary'
import type { UiText } from '../../shared/l10n/en'
// Bound session and usage report inputs (M113 lane C-M113-2, PLAN.md D93.4).
// Every engine construction (VS Code, ACP, CLI) builds these from the same
// durable sources: M84's session history and M102's usage journal through
// aggregate.ts. Ships in dist/reportInputs.js; the hosts pass only identifiers
// and directories, so activation carries no new import. The playbook and
// schedules inputs ride their own chunk (dist/playbookSchedulesInputs.js,
// M113 lane C-M113-4) beside this one.
import { open, realpath } from 'node:fs/promises'
import { constants as fsConstants, readFileSync } from 'node:fs'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
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
import {
  LocalSourceError,
  localFailureOf,
  sourceReason,
  pushPartialReason,
} from '../../core/reporting/sources/local'
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
import { stripJsonc } from '../../core/jsonc'
import type { ReportEstimateReader } from '../../core/reporting/sources/estimate'
import type { ReportSessionReader } from '../../core/reporting/sources/session'
import type { ReportAccountsReader } from '../../core/reporting/sources/accounts'
import type { ReportSecurityReader } from '../../core/reporting/sources/security'
import type { EstimateRequest } from '../../shared/estimate'
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

/**
The installed manifest for the keybindings report (M113 C-M113-5, D93.4):
each host passes its own install's package.json path, so VS Code, ACP and
the CLI report the same installed bindings. Read at generation time, never
at import, and parsed by the source's schema. An absent file reads as
undefined — the source reports no custom keybindings, never invalid data
(RLTESTDRIVE2 12). A commented manifest still reads; only a file that
really fails to parse is invalid.
*/
export function keybindingsManifestReader(packageJsonPath: string): () => unknown {
  return () => {
    let raw: string
    try {
      raw = readFileSync(packageJsonPath, 'utf8')
    } catch (error) {
      // An absent file is not invalid data: the source reports no custom
      // keybindings for the missing input (RLTESTDRIVE2 12).
      if (errorCode(error) === 'ENOENT') return
      throw new LocalSourceError('failed')
    }
    try {
      const parsed: unknown = JSON.parse(stripJsonc(raw))
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

/**
Name one true failure reason on a reader's partial list (RVCM1133): a
partly unreadable source keeps its good rows and carries the same
sentence a whole-read failure would show, instead of collapsing the
good rows into a generic failure or reporting success with silently
dropped rows.
*/
function keepReason(partials: string[], reason: string): void {
  if (!partials.includes(reason)) partials.push(reason)
}

/**
The true sentence for a sub-source that threw: its own failure code when
it names one, otherwise the generic read failure. Only fixed sentences
ever enter a partial; a record's own text never does, so no secret, key
material or vault item value can reach a reason (RVCM1133B).
*/
function failureReason(error: unknown, reportText: UiText): string {
  const code = localFailureOf(error)
  return code === undefined ? reportText.reportSourceReasons.failed : sourceReason(code, reportText)
}

/** A row schema any record stream below can be validated against one by one. */
interface RowSchema<T> {
  safeParse(row: unknown): { readonly success: boolean; readonly data?: T }
}

/** Admission owns the bound; final validation never drops accepted sibling facets. */

const rowFacets = new Map<RowSchema<unknown>, ReportLabelKey>([
  [accountsUsageRowSchema, 'usage'],
  [accountsEventRowSchema, 'swaps'],
  [accountsConfirmationRowSchema, 'confirmations'],
  [accountsAccountRowSchema, 'accounts'],
  [accountsProviderRowSchema, 'accounts'],
  [vaultGrantSchema, 'grants'],
  [vaultItemMetadataSchema, 'vault'],
  [vaultAuditRecordSchema, 'usage'],
  [securityAuditRowSchema, 'usage'],
  [securityDeveloperAuditRowSchema, 'developerAudit'],
  [developerAuditSchema, 'developerAudit'],
])

/** The engine helper owns each array access, decoder and admission boundary. */
function collectValidRows<T>(
  rows: unknown,
  schema: RowSchema<T>,
  into: T[],
  partials: string[],
  reportText: UiText,
): void {
  const result = readReportRows(
    reportText,
    rowFacets.get(schema) ?? 'limits',
    'records',
    rows,
    schema,
    Math.max(0, REPORT_MAX_ROWS - into.length),
  )
  into.push(...result.rows)
  for (const problem of result.problems) keepReason(partials, problem.reason)
}

/**
Every sub-source createAccountsReportReader consumes. The resilience
table in reportSourceReasons.test.ts covers each one in every way it can
fail; a new sub-source is added here first, which fails that test until
its cases exist (RVCM1133B).
*/
export const ACCOUNTS_REPORT_SUB_SOURCES = ['registry', 'usage', 'events'] as const

/**
Every sub-source createSecurityReportReader consumes: the vault view and
its audit from the injected snapshot, and each developer audit rotation
file. Same coverage rule as the accounts inventory (RVCM1133B).
*/
export const SECURITY_REPORT_SUB_SOURCES = [
  'vault',
  'vaultAudit',
  'developerAudit',
  'developerAuditPrevious',
] as const

/** The durable usage journal, tolerating a fresh install with no history yet. */
export async function readUsageReportJournal(
  dataFolder: string,
  reportText: UiText,
): Promise<UsageReportJournal> {
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
    // The store signals a live holder with the usageLocked message (see
    // UsageJournalStore.read): a journal another process really holds is
    // busy, never failed, so the source names the holder state
    // (RVREPORTJOIN P3-7).
    if (error instanceof Error && error.message === 'usageLocked')
      throw new LocalSourceError('busy')
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
    ...(isDamaged && { partial: reportText.reportDetailReasons.journalIncomplete }),
  }
}

const reportOffsetByRun = new WeakMap<object, number>()

/**
One machine-local offset per report run, shared by the budget day and the
period day: a DST change or midnight between the two samples must not
stamp them on different days (RVCM1132C finding 3). Runs are fresh objects
per generation, so entries never outlive their report.
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
  Machine-local day, like M102's page. Callers pass reportTimezoneOffset
  so the budget stamp shares the report's single sample (RVCM1132C
  finding 3); a plain number keeps a fixed day for tests.
  */
  readonly timezoneOffsetMins?: number | ((context: SourceReadContext) => number)
}): (context: SourceReadContext) => Promise<UsageReportJournal> {
  const runs = new WeakMap<object, Promise<UsageReportJournal>>()
  return (context) => {
    const reportText = context.reportText
    let pending = runs.get(context.run ?? context.options)
    if (pending === undefined) {
      pending = (async () => {
        // Every step checks the signal before the next read begins, so an
        // abort between steps starts nothing further (RVREPORTJOIN P2-3).
        context.signal.throwIfAborted()
        await input.beforeRead?.()
        context.signal.throwIfAborted()
        const journal = await readUsageReportJournal(input.dataFolder, reportText)
        // Only the usage kinds render a Limits section; a session report
        // never touches budget machinery or its failure partial.
        if (
          input.readBudgets === undefined ||
          (context.options.kind !== 'usage' && context.options.kind !== 'project')
        )
          return journal
        try {
          context.signal.throwIfAborted()
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
        } catch (error) {
          // An abort is cancellation, never an unavailable budget
          // (RVREPORTJOIN P2-3).
          if (context.signal.aborted) throw error
          // Partial reasons are a set of sentences: a reason already present
          // is never appended again (RVCM1132C finding 5, RVCM1132D
          // finding 2).
          const reasons: string[] = []
          if (journal.partial !== undefined) pushPartialReason(reasons, journal.partial)
          pushPartialReason(reasons, reportText.reportDetailReasons.budgetsUnavailable)
          const budgetsPartial = joinPartialReasons(reportText, reasons)
          return { ...journal, ...(budgetsPartial !== undefined && { partial: budgetsPartial }) }
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
  Machine-local day, like M102's page. Callers pass reportTimezoneOffset
  so the period shares the budget stamp's single sample (RVCM1132C
  finding 3); a plain number keeps a fixed day for tests.
  */
  readonly timezoneOffsetMins: number | ((context: SourceReadContext) => number)
  readonly now?: () => number
}): NonNullable<LocalReportSourceDeps['usage']> {
  return async (context: SourceReadContext) => {
    const reportText = context.reportText
    context.signal.throwIfAborted()
    const journal = await (input.readJournal?.(context) ??
      readUsageReportJournal(input.dataFolder, reportText))
    context.signal.throwIfAborted()
    const facts = usageReportFacts({
      reportText,
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
The stored session envelope the report reads: the same field names and item
shape as M84's storedSessionFields, with items validated by the owned
itemSnapshotSchema (the report source validates the export again). Anything
else the store keeps never enters a report.
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
  reportText: UiText,
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
      partial: reportText.reportDetailReasons.sessionModelUnavailable,
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
The reporting `estimate` source from M117's run: the host owns the engine
(VS Code's lazy estimator bundle, the headless one per workspace root), so
only the validated request crosses into this bundle and only the run's
result crosses back. The core source validates, scrubs and projects it.
*/
export function createEstimateReportReader(
  input: {
    readonly run: (request: EstimateRequest, signal: AbortSignal) => Promise<unknown>
  },
  table?: UiText,
  locale?: string,
): ReportEstimateReader {
  return {
    read: async (request, context) => {
      const section = await input.run(request, context.signal)
      // The observation is the request's own validated stamp, never the
      // wall clock: the same generation seals the same bytes, and the
      // source reads fresh at age zero instead of unknown.
      return { section, observedAt: request.asOf }
    },
    // The report's refusal language, captured once when the request starts
    // (RVCM1134G P2): the source renders refusals only from these strings,
    // so another generation's `setUiText` while the estimator runs cannot
    // move the language under this one.
    ...(table !== undefined &&
      locale !== undefined && {
        text: {
          failed: table.estimateFailed,
          noCapacity: table.estimateNoCapacity,
          notFound: table.estimateNotFound,
          missingMore: table.estimateMissingMore,
          locale,
        },
      }),
  }
}

/**
The reporting `session` source from M84's history: the transcript as the
export source, turns retained before the portable projection drops their
ids, and the session's own journal usage. Checks run arrive through the
workspace check-run source, which the collector prefers; the payload keeps
an empty list so a second journal read never diverges from it. History
items carry no approval decisions, so approvals stay explicitly unavailable
instead of inferred.
*/
export function createSessionReportReader(input: {
  readonly resolveSession: (
    sessionId: string | undefined,
    context: SourceReadContext,
  ) => Promise<SessionHistoryInput | null>
  readonly readJournal: (context: SourceReadContext) => Promise<UsageReportJournal>
}): ReportSessionReader {
  return {
    read: async (context: SourceReadContext) => {
      const reportText = context.reportText
      context.signal.throwIfAborted()
      const history = await input.resolveSession(context.options.sessionId, context)
      if (history === null) throw new LocalSourceError('history')
      // A deadline that fired while the session settled starts no further
      // work: the journal read below never begins after an abort
      // (RVREPORTJOIN P2-3).
      context.signal.throwIfAborted()
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
        pushPartial(reportText.reportDetailReasons.rolledUpSessionExcluded)
      if (
        history.items.length > 0 &&
        journal.records.every((record) => record.session !== history.sessionId)
      )
        pushPartial(reportText.reportDetailReasons.sessionUsageUnavailable)
      const turns =
        history.turnIds.length > 0 ? history.turnIds.length : sessionTurnCount(history.items)
      // Bounded by construction: problem text can never exceed the reason
      // bound and drop the session beside it (RVREPORTJOIN P2-2).
      const sessionPartial = joinPartialReasons(reportText, partials)
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
                  reason: reportText.reportDetailReasons.sessionTurnsUnavailable,
                }
              : { status: 'available', count: turns },
          approvals: {
            status: 'unavailable',
            reason: reportText.reportDetailReasons.sessionApprovalsUnavailable,
          },
        },
        usage: sessionUsageFacts(journal.records, history.sessionId),
        checkRuns: [],
        observedAt: context.asOf,
        ...(sessionPartial !== undefined && { partial: sessionPartial }),
      }
    },
  }
}

/**
M108's account registry file: metadata only, never a credential (the
runtime's providers file keeps secrets and vendor responses on separate
injected ports). A missing file is a fresh install, never an error; a
corrupt one is invalid, never an empty registry.
*/
const registryEntrySchema = z.object({
  id: accountIdSchema,
  product: accountIdSchema,
  auth: z.enum(['apiKey', 'oauth', 'subscription', 'none']),
  accounts: z.optional(z.unknown()),
})

async function readDataFile(
  directory: string,
  file: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  // The signal is checked before the open and before each next read, so an
  // abort between file operations starts nothing further (RVREPORTJOIN P2-3).
  signal?.throwIfAborted()
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
      signal?.throwIfAborted()
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
  reportText: UiText,
): AccountsFacts['providers'][number]['accounts'][number]['thresholds'] {
  // Whole-shape validation discloses unknown fields without vetoing valid limits.
  if (!accountThresholdsSchema.safeParse(raw).success)
    keepReason(partials, reportText.reportSourceReasons.invalid)
  const result: z.infer<typeof accountsThresholdsSchema> = {
    spendUsd: [],
    counts: [],
    percents: [],
  }
  const fields = (value: unknown): Record<string, unknown> => {
    if (value === undefined) return {}
    const parsed = recordFieldsSchema.safeParse(value)
    if (parsed.success) return parsed.data
    keepReason(partials, reportText.reportSourceReasons.invalid)
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
          reportText,
        )
      else
        collectValidRows(
          [{ metric, period, value }],
          accountsThresholdsSchema.shape.counts.def.element,
          result.counts,
          partials,
          reportText,
        )
    }
  }
  const planWindows = Object.entries(fields(thresholds['planWindowPercent']))
  for (const [name, value] of planWindows) {
    if (!accountIdSchema.safeParse(name).success) {
      keepReason(partials, reportText.reportSourceReasons.invalid)
      continue
    }
    collectValidRows(
      [{ name, value }],
      accountsThresholdsSchema.shape.percents.def.element,
      result.percents,
      partials,
      reportText,
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
        reportText,
      )
  }
  return result
}

/**
The reporting `accounts` source from M108's registry on disk, with use,
swaps and confirmations from injected adapters. Facets no adapter supplies
stay empty and are named in the partial, never invented. No sub-source
discards another's rows: a registry entry that fails validation is
skipped with the invalid reason while the good entries still report, and
a registry or adapter that fails outright keeps its own reason beside
the rows the other sub-sources still return (RVCM1133B P2). Only a
missing registry file is a fresh install that reads as null.
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
      const reportText = context.reportText
      const partials: string[] = []
      const providers: AccountsFacts['providers'][number][] = []
      context.signal.throwIfAborted()
      try {
        const text = await readDataFile(
          input.dataDir,
          'providers.json',
          EXEC_UNTRUSTED_FILE_MAX_BYTES,
          context.signal,
        )
        if (text === null && input.readUsage === undefined && input.readEvents === undefined)
          return null
        if (text === null) keepReason(partials, reportText.reportSourceReasons.missing)
        let raw: unknown
        try {
          raw = text === null ? undefined : JSON.parse(text)
        } catch {
          raw = undefined
          keepReason(partials, reportText.reportSourceReasons.invalid)
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
                      keepReason(partials, reportText.reportSourceReasons.invalid)
                    const metadata = registryAccountMetadataSchema.safeParse(rawAccount)
                    if (!metadata.success) {
                      keepReason(partials, reportText.reportSourceReasons.invalid)
                      continue
                    }
                    collectValidRows(
                      [
                        {
                          id: metadata.data.id,
                          label: metadata.data.label,
                          order: metadata.data.order,
                          limitGroup: metadata.data.limitGroup ?? null,
                          thresholds: projectThresholds(
                            metadata.data.thresholds,
                            partials,
                            reportText,
                          ),
                        },
                      ],
                      accountsAccountRowSchema,
                      accounts,
                      partials,
                      reportText,
                    )
                  }
                } else {
                  keepReason(partials, reportText.reportSourceReasons.invalid)
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
                reportText,
              )
            }
            if (invalidEntries > 0) keepReason(partials, reportText.reportSourceReasons.invalid)
          } else keepReason(partials, reportText.reportSourceReasons.invalid)
        }
      } catch (error) {
        // An unreadable registry is one failed sub-source, never a failed
        // read: the injected facets below still report (RVCM1133B P2).
        if (context.signal.aborted) throw error
        keepReason(partials, failureReason(error, reportText))
      }
      const missing: string[] = []
      const facetLabels: Record<string, string> = {
        usage: reportText.reportLabels.usage,
        swaps: reportText.reportLabels.swaps,
        confirmations: reportText.reportLabels.confirmations,
      }
      const usage: AccountsFacts['usage'][number][] = []
      if (input.readUsage === undefined) missing.push('usage')
      else {
        // A deadline that fired while the registry settled starts no
        // further work: the usage read below never begins after an abort
        // (RVREPORTJOIN P2-3).
        context.signal.throwIfAborted()
        try {
          const read = await input.readUsage(context)
          if (read === null || read === undefined) missing.push('usage')
          else collectValidRows(read, accountsUsageRowSchema, usage, partials, reportText)
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error, reportText))
        }
      }
      const events: AccountsFacts['events'][number][] = []
      const confirmations: AccountsFacts['confirmations'][number][] = []
      if (input.readEvents === undefined) missing.push('swaps', 'confirmations')
      else {
        // A deadline that fired while usage settled starts no further work:
        // the events read below never begins after an abort (RVREPORTJOIN
        // P2-3).
        context.signal.throwIfAborted()
        try {
          const read = await input.readEvents(context)
          if (read === null || read === undefined) missing.push('swaps', 'confirmations')
          else {
            if (typeof read !== 'object' || Array.isArray(read))
              keepReason(partials, reportText.reportSourceReasons.invalid)
            else {
              collectValidRows(
                readSnapshotFacet(read, 'events', 'swaps', partials, reportText),
                accountsEventRowSchema,
                events,
                partials,
                reportText,
              )
              collectValidRows(
                readSnapshotFacet(read, 'confirmations', 'confirmations', partials, reportText),
                accountsConfirmationRowSchema,
                confirmations,
                partials,
                reportText,
              )
            }
          }
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error, reportText))
        }
      }
      if (missing.length > 0)
        partials.push(
          fill(reportText.reportDetailReasons.accountsFacetsUnavailable, {
            facets: missing.map((facet) => facetLabels[facet]).join(', '),
          }),
        )
      const accountsPartial = joinPartialReasons(reportText, partials)
      return {
        facts: { providers, usage, events, confirmations },
        observedAt: context.asOf,
        ...(accountsPartial !== undefined && { partial: accountsPartial }),
      }
    },
  }
}

/** An unlock-capable vault view. Raw records never leave the report bundle:
the reader projects them to counts and kinds before returning. */
export interface SecurityVaultSnapshot {
  readonly state: VaultStatus['state']
  readonly tier: VaultStatus['tier']
  readonly items: readonly unknown[]
  readonly grants: readonly unknown[]
  readonly audit: readonly unknown[]
}

/** An adapter may expose a throwing getter: isolate every result facet. */
function readSnapshotFacet(
  snapshot: unknown,
  key: string,
  facet: ReportLabelKey,
  partials: string[],
  reportText: UiText,
): unknown {
  const result = readReportField(
    reportText,
    facet,
    `snapshot/${key}`,
    () => {
      if (typeof snapshot !== 'object' || snapshot === null) throw new LocalSourceError('invalid')
      return Reflect.get(snapshot, key)
    },
    z.unknown(),
  )
  if (result.status === 'available') return result.value
  keepReason(partials, result.problem.reason)
  return undefined
}

/**
The reporting `security` source from the developer audit on disk and an
injected unlock-capable vault view. Without values throughout: the vault
contributes its tier, item counts by kind, grant scopes and audit
aggregates; the developer audit contributes action counts. A locked or
unbound vault leaves the vault facets empty with its reason; without the
developer audit either, both reasons travel in the partial instead of a
generic missing file (RVCM1133). No record or sub-source discards what
the read already accepted: each vault record and each audit line parses
on its own, a bad one is skipped with the invalid reason, and a vault
view or audit file that fails outright keeps its own reason beside the
rows the other sub-sources still return (RVCM1133B P2).
*/
export function createSecurityReportReader(input: {
  readonly dataDir: string
  readonly readVault?: (context: SourceReadContext) => Promise<SecurityVaultSnapshot | null>
}): ReportSecurityReader {
  return {
    read: async (context: SourceReadContext) => {
      const reportText = context.reportText
      const partials: string[] = []
      let vault: SecurityFacts['vault'] = null
      const vaultAudit: SecurityFacts['audit'][number][] = []
      let snapshot: unknown = null
      context.signal.throwIfAborted()
      if (input.readVault !== undefined) {
        try {
          snapshot = await input.readVault(context)
        } catch (error) {
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error, reportText))
        }
      }
      if (snapshot === null || snapshot === undefined)
        keepReason(partials, reportText.reportDetailReasons.securityVaultUnavailable)
      else {
        const envelope = z.object({}).safeParse(snapshot)
        if (envelope.success) {
          // Audit evidence is independent of view state/tier and item/grant validity.
          const records: z.infer<typeof vaultAuditRecordSchema>[] = []
          collectValidRows(
            readSnapshotFacet(snapshot, 'audit', 'vault', partials, reportText),
            vaultAuditRecordSchema,
            records,
            partials,
            reportText,
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
              reportText,
            )
          const view = z
            .strictObject({
              state: vaultStatusSchema.shape.state,
              tier: vaultStatusSchema.shape.tier,
            })
            .safeParse({
              state: readSnapshotFacet(snapshot, 'state', 'vault', partials, reportText),
              tier: readSnapshotFacet(snapshot, 'tier', 'vault', partials, reportText),
            })
          if (view.success) {
            const items: z.infer<typeof vaultItemMetadataSchema>[] = []
            collectValidRows(
              readSnapshotFacet(snapshot, 'items', 'vault', partials, reportText),
              vaultItemMetadataSchema,
              items,
              partials,
              reportText,
            )
            const grants: z.infer<typeof vaultGrantSchema>[] = []
            collectValidRows(
              readSnapshotFacet(snapshot, 'grants', 'vault', partials, reportText),
              vaultGrantSchema,
              grants,
              partials,
              reportText,
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
            keepReason(partials, reportText.reportSourceReasons.invalid)
          }
        } else {
          keepReason(partials, reportText.reportSourceReasons.invalid)
        }
      }
      const directory = path.join(input.dataDir, 'developer')
      let developerAudit: SecurityFacts['developerAudit'][number][] | null = null
      const auditFiles = [DEVELOPER_FILES.audit, `${DEVELOPER_FILES.audit}.previous`]
      for (const file of auditFiles) {
        // The next rotation never starts after an abort (RVREPORTJOIN P2-3).
        context.signal.throwIfAborted()
        let text: string | null
        try {
          text = await readDataFile(directory, file, DEVELOPER_AUDIT_MAX_BYTES, context.signal)
        } catch (error) {
          // An unreadable rotation is one failed sub-source: the vault
          // rows above and the other rotation still report (RVCM1133B P2).
          if (context.signal.aborted) throw error
          keepReason(partials, failureReason(error, reportText))
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
            reportText,
          )
        }
        if (skipped > 0) keepReason(partials, reportText.reportSourceReasons.invalid)
      }
      if (developerAudit === null)
        partials.push(reportText.reportDetailReasons.securityDeveloperAuditUnavailable)
      // Both sources absent is a partial naming both true reasons, never a
      // bare null that the source would report as a generic missing file.
      const securityPartial = joinPartialReasons(reportText, partials)
      return {
        facts: { vault, audit: vaultAudit, developerAudit: developerAudit ?? [] },
        observedAt: context.asOf,
        ...(securityPartial !== undefined && { partial: securityPartial }),
      }
    },
  }
}
