import type {
  ReportOptions,
  ReportSection,
  ReportSourceRecord,
  ReportValue,
} from '../../../shared/reportSchema'
import type { SourceSnapshot, UsageFacts } from '../sources/types'
import { compare, count, derivedSourceId, label, row, sourcedSection, text } from './common'

function limitCells(limit: UsageFacts['limits'][number]): Record<string, ReportValue> {
  return {
    count: { type: 'number', value: limit.used },
    totals: { type: 'number', value: limit.limit },
    date: limit.resetsAt === null ? label('unknown') : { type: 'timestamp', value: limit.resetsAt },
  }
}

export function usageSections(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  sourceKind: 'usage' | 'session',
  prefix = '',
): ReportSection[] {
  const source = snapshot.sources[sourceKind]
  const usage: UsageFacts | undefined =
    sourceKind === 'session'
      ? snapshot.sources.session.data?.usage
      : (snapshot.sources.usage.data ?? undefined)
  const sourceId = source.record.id
  const columns = ['scope', 'inputTokens', 'outputTokens', 'cost', 'certainty'] as const
  const totalColumns =
    usage?.cachedTokens == null ? columns : ([...columns, 'cachedTokens'] as const)
  const values = (
    entry: Pick<UsageFacts, 'inputTokens' | 'outputTokens' | 'costUsd' | 'certainty'>,
  ) => ({
    inputTokens: count(entry.inputTokens),
    outputTokens: count(entry.outputTokens),
    cost: { type: 'usd', value: entry.costUsd, certainty: entry.certainty } as const,
    certainty: label(entry.certainty),
  })
  return [
    sourcedSection(
      snapshot,
      options,
      `${prefix}totals`,
      'totals',
      totalColumns,
      usage === undefined
        ? []
        : [
            row(
              'totals',
              [usage.period],
              {
                scope: text(usage.period),
                ...values(usage),
                ...(usage.cachedTokens !== null && { cachedTokens: count(usage.cachedTokens) }),
              },
              [sourceId],
            ),
          ],
      [sourceKind],
    ),
    sourcedSection(
      snapshot,
      options,
      `${prefix}breakdown`,
      'breakdown',
      ['name', ...columns],
      usage?.breakdown.map((entry) =>
        row(
          'usage',
          [entry.key],
          { name: text(entry.key), scope: text(options.by ?? 'model'), ...values(entry) },
          [sourceId],
        ),
      ) ?? [],
      [sourceKind],
    ),
    sourcedSection(
      snapshot,
      options,
      `${prefix}limits`,
      'limits',
      ['name', 'count', 'totals', 'date'],
      usage?.limits.map((limit) =>
        row(
          'limit',
          [limit.key],
          {
            name: text(limit.key),
            ...limitCells(limit),
          },
          [sourceId],
        ),
      ) ?? [],
      [sourceKind],
    ),
  ]
}

export function otherAgentUsage(snapshot: SourceSnapshot, options: ReportOptions): ReportSection {
  const source = snapshot.sources.agentUsage
  return sourcedSection(
    snapshot,
    options,
    'agentUsage',
    'usage',
    ['name', 'files', 'scope', 'inputTokens', 'outputTokens', 'cost', 'certainty', 'limits'],
    source.data?.map((entry) =>
      row(
        'agent',
        [entry.agent, entry.file.replaceAll('\\', '/')],
        {
          name: text(entry.agent),
          files: text(entry.file.replaceAll('\\', '/')),
          scope: text(entry.usage.period),
          inputTokens: count(entry.usage.inputTokens),
          outputTokens: count(entry.usage.outputTokens),
          cost: { type: 'usd', value: entry.usage.costUsd, certainty: entry.usage.certainty },
          certainty: label(entry.usage.certainty),
          limits: {
            type: 'textList',
            value: entry.usage.limits.map((limit) => limit.key).toSorted(compare),
          },
        },
        [source.record.id],
      ),
    ) ?? [],
    ['agentUsage'],
  )
}

export function otherAgentLimits(snapshot: SourceSnapshot, options: ReportOptions): ReportSection {
  const source = snapshot.sources.agentUsage
  return sourcedSection(
    snapshot,
    options,
    'agentLimits',
    'limits',
    ['name', 'files', 'kind', 'count', 'totals', 'date'],
    source.data?.flatMap((entry) =>
      entry.usage.limits.map((limit) =>
        row(
          'agent-limit',
          [entry.agent, entry.file.replaceAll('\\', '/'), limit.key],
          {
            name: text(entry.agent),
            files: text(entry.file.replaceAll('\\', '/')),
            kind: text(limit.key),
            ...limitCells(limit),
          },
          [source.record.id],
        ),
      ),
    ) ?? [],
    ['agentUsage'],
  )
}

// Cache capability cannot be inferred from zero; null explicitly means absent.
export function cacheSource(
  snapshot: SourceSnapshot,
  sourceKind: 'usage' | 'session',
): ReportSourceRecord | undefined {
  const source = snapshot.sources[sourceKind]
  const usage =
    sourceKind === 'usage' ? snapshot.sources.usage.data : snapshot.sources.session.data?.usage
  if (usage?.cachedTokens !== null) return undefined
  return {
    ...source.record,
    id: derivedSourceId(source.record.id, 'cachedTokens'),
    status: 'notApplicable',
    reason: 'cachedTokens=null',
  }
}
