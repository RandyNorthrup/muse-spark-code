// M102 / D82: the host supplies journal, live sources and user actions. No
// editor API, filesystem path from a page, model call or fetch belongs here.
import {
  USAGE_DETAIL_DAYS,
  USAGE_HISTORY_DAYS_DEFAULT,
  USAGE_JOURNAL_VERSION,
} from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { USAGE_TEXT, type UsageTable } from '../../shared/l10n/usageTable'
import type { UsageLimitSnapshot, UsageRecord } from '../../shared/usageJournal'
import {
  parseUsagePageToServiceMessage,
  usagePageStateSchema,
  usageServiceToPageMessageSchema,
  type UsagePageState,
  type UsageQuery,
  type UsageServiceToPageMessage,
  type UsagePageToServiceMessage,
} from '../../shared/usagePage'
import {
  aggregateUsage,
  shiftUsageDay,
  usageBurnProjection,
  usageLocalDay,
  type UsageAggregateRow,
} from './aggregate'

/** Records and rollups have already passed lane J's on-disk zod readers. */
export interface UsageJournalRead {
  readonly records: readonly UsageRecord[]
  readonly rollups: readonly UsageAggregateRow[]
  readonly limits: readonly UsageLimitSnapshot[]
  readonly recordCount: number
  readonly newerVersionRecords: number
  readonly tornLines: number
  readonly since?: string
}
export interface UsageJournalPort {
  readonly read: () => Promise<UsageJournalRead>
  /** Only the usage journal; the port never takes a path. */
  readonly deleteHistory: () => Promise<void>
}
export interface UsageBudgetRead {
  readonly budget: UsagePageState['budgets'][number]
  readonly firstSpendAt?: number
}
/** Read-only admission snapshots; adapters compose paid, Tab and other caps. */
export interface UsageBudgetReadPort {
  readonly readToday: () => Promise<readonly UsageBudgetRead[]>
}
export interface UsageExportFile {
  readonly name: string
  readonly mimeType: string
  readonly content: string
}
export interface UsageServiceDeps {
  readonly now: () => number
  readonly host: string
  readonly table: UsageTable
  readonly capabilities?: UsagePageState['capabilities']
  readonly journal: UsageJournalPort
  readonly history: () => { readonly enabled: boolean; readonly historyDays?: number }
  readonly setHistory: (isEnabled: boolean) => Promise<void>
  readonly readBudgets: UsageBudgetReadPort['readToday']
  /** Host provides subscription/account snapshots; never requests a model. */
  readonly readLiveLimits: () => Promise<readonly UsageLimitSnapshot[]>
  readonly readAttempts: () => Promise<UsagePageState['attempts']>
  readonly providerConsoles: () => readonly UsagePageState['unreportedLimits'][number][]
  readonly exportFile: (
    format: Extract<UsagePageToServiceMessage, { type: 'usage/export' }>['format'],
    journal: UsageJournalRead,
    state: UsagePageState,
  ) => Promise<UsageExportFile>
  readonly saveFile: (file: UsageExportFile) => Promise<boolean>
  readonly confirmDelete: (prompt: {
    readonly title: string
    readonly detail: string
    readonly action: string
    readonly cancel: string
    readonly count: number
  }) => Promise<boolean>
  readonly openSettings?: () => Promise<void>
  readonly revealFolder?: () => Promise<void>
  readonly openModels?: (provider: string, model?: string) => Promise<void>
  readonly openExternal?: (url: string) => Promise<void>
  readonly priceUnpriced?: (
    journal: UsageJournalRead,
    provider: string,
    model: string,
    query: UsageQuery,
    price: NonNullable<NonNullable<UsagePageState['modelDetail']>['price']>,
  ) => Promise<Pick<NonNullable<UsagePageState['modelDetail']>, 'totals' | 'trend'> | undefined>
  readonly readModelPrice?: (
    provider: string,
    model: string,
  ) => Promise<NonNullable<UsagePageState['modelDetail']>['price']>
}
export interface UsageService {
  readonly snapshot: (query?: UsageQuery) => Promise<UsagePageState>
  /** Native postMessage, stdio and HTTP all use this checked boundary. */
  readonly handle: (input: unknown) => Promise<UsageServiceToPageMessage[]>
}
const DEFAULT_QUERY: UsageQuery = { range: 'today', groupBy: 'provider', metric: 'cost' }
function limitHistory(limits: readonly UsageLimitSnapshot[]): UsageLimitSnapshot[] {
  const history = new Map<string, UsageLimitSnapshot>()
  for (const limit of limits) {
    const key = JSON.stringify([limit.provider, limit.source, limit.observedAt])
    history.set(key, limit)
  }
  return Array.from(history, (entry) => entry[1]).toSorted((a, b) => a.observedAt - b.observedAt)
}
export function createUsageService(deps: UsageServiceDeps): UsageService {
  let query = DEFAULT_QUERY
  let selection: { provider: string; model: string } | undefined
  let pending = Promise.resolve<UsageServiceToPageMessage[]>([])
  async function read(
    selected: UsageQuery,
  ): Promise<{ journal: UsageJournalRead; state: UsagePageState }> {
    const now = deps.now()
    const [journal, budgets, live, attempts] = await Promise.all([
      deps.journal.read(),
      deps.readBudgets(),
      deps.readLiveLimits(),
      deps.readAttempts(),
    ])
    const aggregated = aggregateUsage(journal.records, journal.rollups, selected, now)
    const limits = limitHistory([
      ...journal.limits.filter(
        (limit) => limit.day >= aggregated.from && limit.day <= aggregated.to,
      ),
      ...live,
    ])
    const settings = deps.history()
    const state: UsagePageState = {
      v: USAGE_JOURNAL_VERSION,
      query: selected,
      generatedAt: now,
      capabilities: deps.capabilities ?? {
        settings: deps.openSettings !== undefined,
        folder: deps.revealFolder !== undefined,
        models: deps.openModels !== undefined,
        external: deps.openExternal !== undefined,
        export: true,
        deleteHistory: true,
        setHistory: true,
      },
      history: {
        enabled: settings.enabled,
        host: deps.host,
        detailDays: USAGE_DETAIL_DAYS,
        historyDays: settings.historyDays ?? USAGE_HISTORY_DAYS_DEFAULT,
        recordCount: journal.recordCount,
        newerVersionRecords: journal.newerVersionRecords,
        tornLines: journal.tornLines,
        ...(journal.since !== undefined && { since: journal.since }),
      },
      totals: aggregated.totals,
      previousTotals: aggregated.previousTotals,
      buckets: aggregated.buckets,
      breakdown: aggregated.breakdown,
      features: aggregated.features,
      limits,
      budgets: budgets.map(({ budget, firstSpendAt }) => {
        const projection =
          budget.resetsAt === undefined
            ? undefined
            : usageBurnProjection(budget.spentUsd, firstSpendAt, now, budget.resetsAt)
        return { ...budget, ...(projection !== undefined && { projectedUsd: projection }) }
      }),
      unreportedLimits: deps
        .providerConsoles()
        .filter((provider) => limits.every((limit) => limit.provider !== provider.provider)),
      attempts: attempts.filter(
        (attempt) => attempt.day >= aggregated.from && attempt.day <= aggregated.to,
      ),
      savings: {
        ...(aggregated.totals.tokens.cached !== undefined && {
          cachedTokens: aggregated.totals.tokens.cached,
        }),
        ...(aggregated.totals.packedAvoided !== undefined && {
          packedAvoided: aggregated.totals.packedAvoided,
        }),
      },
    }
    if (selection !== undefined) {
      const { provider, model } = selection
      const details = aggregateUsage(
        journal.records.filter((record) => record.provider === provider && record.model === model),
        journal.rollups.filter((row) => row.provider === provider && row.model === model),
        selected,
        now,
      )
      const price = await deps.readModelPrice?.(provider, model)
      const unpricedRows = details.breakdown.filter((row) =>
        row.totals.costs.some((cost) => cost.certainty === 'unpriced'),
      )
      const later =
        price === undefined || deps.priceUnpriced === undefined || unpricedRows.length === 0
          ? undefined
          : await deps.priceUnpriced(journal, provider, model, selected, price)
      state.modelDetail = {
        provider,
        model,
        totals: later?.totals ?? details.totals,
        trend: later?.trend ?? details.buckets,
        pricedLater: later !== undefined,
        ...(price !== undefined && { price }),
      }
    }
    return { journal, state: usagePageStateSchema.parse(state) }
  }
  async function stateReply(): Promise<UsageServiceToPageMessage> {
    const { state } = await read(query)
    return { type: 'usage/state', state }
  }
  async function dispatch(
    message: UsagePageToServiceMessage,
  ): Promise<UsageServiceToPageMessage[]> {
    switch (message.type) {
      case 'usage/ready': {
        return [{ type: 'usage/table', ...deps.table }, await stateReply()]
      }
      case 'usage/query': {
        query = message.query
        selection = undefined
        return [await stateReply()]
      }
      case 'usage/refresh': {
        return [await stateReply()]
      }
      case 'usage/modelDetail': {
        selection = { provider: message.provider, model: message.model }
        return [await stateReply()]
      }
      case 'usage/setHistory': {
        await deps.setHistory(message.enabled)
        return [await stateReply()]
      }
      case 'usage/deleteHistory': {
        const journal = await deps.journal.read()
        const isApproved = await deps.confirmDelete({
          title: USAGE_TEXT.deleteTitle,
          detail: plural(USAGE_TEXT.deleteConfirm, journal.recordCount),
          action: USAGE_TEXT.deleteAction,
          cancel: USAGE_TEXT.cancel,
          count: journal.recordCount,
        })
        if (!isApproved)
          return [
            {
              type: 'usage/result',
              requestId: message.requestId,
              action: 'deleteHistory',
              outcome: 'cancelled',
            },
          ]
        await deps.journal.deleteHistory()
        return [
          {
            type: 'usage/result',
            requestId: message.requestId,
            action: 'deleteHistory',
            outcome: 'completed',
          },
          await stateReply(),
        ]
      }
      case 'usage/export': {
        const { journal, state } = await read(message.query)
        const { from, to } = aggregateUsage([], [], message.query, deps.now())
        if (
          message.format === 'callsCsv' &&
          (from < shiftUsageDay(usageLocalDay(deps.now()), 1 - USAGE_DETAIL_DAYS) ||
            to > usageLocalDay(deps.now()))
        )
          return [{ type: 'usage/error', requestId: message.requestId, code: 'exportRange' }]
        const file = await deps.exportFile(message.format, journal, state)
        const maximum = deps.capabilities?.exportMaxBytes
        if (
          maximum !== undefined &&
          new TextEncoder().encode(JSON.stringify(file)).byteLength > maximum
        )
          return [{ type: 'usage/error', requestId: message.requestId, code: 'exportTooLarge' }]
        const isSaved = await deps.saveFile(file)
        return [
          {
            type: 'usage/result',
            requestId: message.requestId,
            action: 'export',
            outcome: isSaved ? 'completed' : 'cancelled',
          },
        ]
      }
      case 'usage/openSettings': {
        if (deps.openSettings === undefined) return [{ type: 'usage/error', code: 'unsupported' }]
        await deps.openSettings()
        return []
      }
      case 'usage/revealFolder': {
        if (deps.revealFolder === undefined) return [{ type: 'usage/error', code: 'unsupported' }]
        await deps.revealFolder()
        return []
      }
      case 'usage/openModels': {
        if (deps.openModels === undefined) return [{ type: 'usage/error', code: 'unsupported' }]
        await deps.openModels(message.provider, message.model)
        return []
      }
      case 'usage/openExternal': {
        const url = new URL(message.url)
        if (deps.openExternal === undefined || !['https:', 'http:'].includes(url.protocol))
          return [{ type: 'usage/error', code: 'unsupported' }]
        await deps.openExternal(message.url)
        return []
      }
    }
  }
  return {
    snapshot: async (selected = query) => {
      const { state } = await read(selected)
      return state
    },
    async handle(input) {
      const parsed = parseUsagePageToServiceMessage(input)
      if (!parsed.ok) return [{ type: 'usage/error', code: 'invalidMessage' }]
      const message = parsed.message
      const previous = pending
      const result = (async (): Promise<UsageServiceToPageMessage[]> => {
        await previous
        try {
          const replies = await dispatch(message)
          return replies.map((reply) => usageServiceToPageMessageSchema.parse(reply))
        } catch {
          return [
            {
              type: 'usage/error',
              ...('requestId' in message && { requestId: message.requestId }),
              code: ['usage/export', 'usage/deleteHistory', 'usage/setHistory'].includes(
                message.type,
              )
                ? 'writeFailed'
                : 'readFailed',
            },
          ]
        }
      })()
      pending = result
      return await result
    },
  }
}
