// ACP reads settled journal entries; no provider price is recomputed here.
import * as z from 'zod/mini'
import { Usd, type UsdAmount } from '../shared/usd'
import { nonnegativeUsdSchema } from '../shared/usdSchema'
import { usageRecordSchema, type UsageRecord } from '../shared/usageJournal'

const TOKEN_FIELDS = [
  'input',
  'cached',
  'cacheWrite',
  'cacheWrite5m',
  'cacheWrite1h',
  'output',
  'reasoning',
] as const
const count = z.int().check(z.gte(0))
const totalsSchema = z.strictObject({
  requests: count,
  tokens: z.strictObject({
    input: count,
    cached: count,
    cacheWrite: count,
    cacheWrite5m: count,
    cacheWrite1h: count,
    output: count,
    reasoning: count,
  }),
  missingTokenCounters: z.array(z.enum(TOKEN_FIELDS)),
  settledUsd: nonnegativeUsdSchema,
  retainedLiabilityUsd: nonnegativeUsdSchema,
  unknownRequests: count,
  planRequests: count,
})
export const acpBudgetSchema = z.strictObject({
  scope: z.enum(['daily', 'session', 'run']),
  capUsd: z.nullable(nonnegativeUsdSchema),
  spentUsd: nonnegativeUsdSchema,
  remainingUsd: z.nullable(nonnegativeUsdSchema),
  uncertainUsd: nonnegativeUsdSchema,
  hasUnknownCost: z.boolean(),
})
export type AcpBudget = z.infer<typeof acpBudgetSchema>
export interface AcpAccounting {
  readRecords(sessionId: string): Promise<readonly UsageRecord[]>
  readBudgets(sessionId: string): Promise<readonly AcpBudget[]>
}
export const acpUsageSnapshotSchema = z.strictObject({
  v: z.literal(1),
  available: z.literal(true),
  session: totalsSchema,
  budgets: z.array(acpBudgetSchema),
})
export type AcpUsageSnapshot = z.infer<typeof acpUsageSnapshotSchema>

function totals(records: readonly UsageRecord[]): z.infer<typeof totalsSchema> {
  const tokens = {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    output: 0,
    reasoning: 0,
  }
  const missing = new Set<(typeof TOKEN_FIELDS)[number]>()
  let settled = Usd.from(0)
  let retained = Usd.from(0)
  let unknownRequests = 0
  let planRequests = 0
  for (const record of records) {
    for (const field of TOKEN_FIELDS) {
      const value = record.tokens[field]
      if (value === undefined) missing.add(field)
      else tokens[field] += value
    }
    const cost = record.cost
    if (cost.certainty === 'plan') {
      planRequests++
      continue
    }
    const amount = cost.usd
    if (
      amount === undefined ||
      cost.certainty === 'uncertain' ||
      cost.certainty === 'unpriced' ||
      cost.certainty === 'estimated'
    ) {
      unknownRequests++
      if (amount !== undefined) retained = retained.add(Usd.from(amount))
    } else settled = settled.add(Usd.from(amount))
  }
  return totalsSchema.parse({
    requests: records.length,
    tokens,
    missingTokenCounters: TOKEN_FIELDS.filter((field) => missing.has(field)),
    settledUsd: settled.toAmount(),
    retainedLiabilityUsd: retained.toAmount(),
    unknownRequests,
    planRequests,
  })
}

export async function readAcpUsage(
  accounting: AcpAccounting,
  sessionId: string,
): Promise<AcpUsageSnapshot> {
  const read = await accounting.readRecords(sessionId)
  // The journal carries no turn linkage: the snapshot covers the session's
  // retained records, and per-request settled dollars ride each answer on
  // the `tokenUsage` event instead.
  const records = read
    .map((record) => usageRecordSchema.parse(record))
    .filter((record) => record.session === sessionId)
  return acpUsageSnapshotSchema.parse({
    v: 1,
    available: true,
    session: totals(records),
    budgets: await accounting.readBudgets(sessionId),
  })
}

export function acpBudget(
  scope: AcpBudget['scope'],
  cap: UsdAmount | undefined,
  spent: UsdAmount,
  uncertain: UsdAmount,
  hasUnknownCost: boolean,
): AcpBudget {
  const remaining = cap === undefined ? undefined : Usd.from(cap).subtract(Usd.from(spent))
  return acpBudgetSchema.parse({
    scope,
    capUsd: cap ?? null,
    spentUsd: spent,
    remainingUsd:
      remaining === undefined
        ? null
        : (remaining.compare(Usd.from(0)) < 0 ? Usd.from(0) : remaining).toAmount(),
    uncertainUsd: uncertain,
    hasUnknownCost,
  })
}
