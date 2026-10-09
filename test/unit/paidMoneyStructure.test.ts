import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeFixtures, analyzeSource, MONEY_KEY } from './helpers/moneyTypeGuard'

// Exact-money guard (M121, replacing the PORTS017D runtime walk and text scan).
//
// The TypeScript checker reads every `.ts`/`.tsx` under `src` (host, core,
// shared, runtime, ACP and webview) and judges every property (interfaces,
// classes, object literals, schema shapes, getters, quoted and computed keys)
// and every schema-valued or numeric-literal variable. A zod schema is judged
// by its declared output type, so pipes, transforms (including a sometimes-
// numeric one), `_default`, literals, numeric enums, maps, sets, records and
// module-local schemas behind exported parsers resolve to what callers get.
// A money-named key (`MONEY_KEY`) whose value type holds a number anywhere
// is a finding, reported as `file:key` where the key is declared.
//
// The allow-list has two categories:
//
// - `nonMoney`: numeric declarations whose names carry a money hint but are
//   token counts, durations or worker counts. Each must still exist as a
//   numeric declaration and must NOT match the money pattern.
// - `sanctioned`: numeric money PLAN keeps (PLAN.md M121 "Sanctioned numeric
//   money"): per-unit price-card and catalog rates, vendor wire units captured
//   as sent, and VS Code number settings with their declared defaults. Each
//   entry cites a PLAN line.
//
// - `trackedDebt`: current numeric money M121 converts to `UsdAmount`. Each
//   conversion removes its entries; the category ends empty.
//
// Every other money leaf fails, and a listed entry that no longer matches is
// stale and fails too.

type MoneyCategory = 'nonMoney' | 'sanctioned' | 'trackedDebt'
interface AllowEntry {
  readonly category: MoneyCategory
  readonly reason: string
}

const RATE = 'Per-unit price-card or catalog rate, display and comparison only (PLAN.md:20254).'
const WIRE = 'Vendor wire unit captured as sent, converted exactly at the boundary (PLAN.md:20254).'
const SETTING =
  'VS Code number setting or its declared default/limit, read with Usd.from (PLAN.md:20254).'
const TOKENS = 'Token count, not money.'
const DEBT = 'Numeric money; M121 converts it to UsdAmount.'

const ALLOW_LIST: Readonly<Record<string, AllowEntry>> = {
  // --- nonMoney: token counts, durations, character limits, worker counts.
  'shared/paid.ts:dailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/capValidation.ts:teamDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/intensity.ts:dailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/teamMeter.ts:teamDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/teamMeter.ts:workspaceDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/modelSettings.ts:thinkingBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/modelSettings.ts:contextCapTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/teamPool.ts:tokensCap': { category: 'nonMoney', reason: TOKENS },
  'core/backends/modelapi/codecs/anthropic.ts:thinkingBudget': {
    category: 'nonMoney',
    reason: 'Model thinking budget in tokens, not money.',
  },
  'core/backends/modelapi/ModelApiHost.ts:mediaBudgetMaxEncodedChars': {
    category: 'nonMoney',
    reason: 'Character count, not money.',
  },
  'core/codeIntel/repoMap.ts:timeBudgetMs': {
    category: 'nonMoney',
    reason: 'Duration in milliseconds, not money.',
  },
  'shared/retryPolicy.ts:retryAfterCapMs': {
    category: 'nonMoney',
    reason: 'Duration in milliseconds, not money.',
  },
  'core/team/intensity.ts:runningCap': { category: 'nonMoney', reason: 'Worker count, not money.' },
  'core/team/intensity.ts:configuredCap': {
    category: 'nonMoney',
    reason: 'Worker count, not money.',
  },
  // --- sanctioned: per-unit rates.
  'core/agent/agentBackend.ts:inputUsdPerMTokens': { category: 'sanctioned', reason: RATE },
  'core/agent/agentBackend.ts:outputUsdPerMTokens': { category: 'sanctioned', reason: RATE },
  'shared/protocol.ts:inputUsdPerMTokens': { category: 'sanctioned', reason: RATE },
  'shared/protocol.ts:outputUsdPerMTokens': { category: 'sanctioned', reason: RATE },
  'core/providers/providerRegistry.ts:inputUsdPerMTokens': { category: 'sanctioned', reason: RATE },
  'core/providers/providerRegistry.ts:outputUsdPerMTokens': {
    category: 'sanctioned',
    reason: RATE,
  },
  'host/conversation/conversationController.ts:inputUsdPerMTokens': {
    category: 'sanctioned',
    reason: RATE,
  },
  'host/conversation/conversationController.ts:outputUsdPerMTokens': {
    category: 'sanctioned',
    reason: RATE,
  },
  'core/team/intensity.ts:cachedUsdPerMTok': { category: 'sanctioned', reason: RATE },
  'core/team/intensity.ts:usdPerMTok': { category: 'sanctioned', reason: RATE },
  'core/team/intensity.ts:usdPerHourLow': { category: 'sanctioned', reason: RATE },
  'core/team/intensity.ts:usdPerHourHigh': { category: 'sanctioned', reason: RATE },
  'core/team/autofill.ts:usdPerMTokInput': { category: 'sanctioned', reason: RATE },
  'core/team/capValidation.ts:usdPerMTok': { category: 'sanctioned', reason: RATE },
  'core/team/preview.ts:usdPerMTokInput': { category: 'sanctioned', reason: RATE },
  'core/team/preview.ts:usdPerMTokOutput': { category: 'sanctioned', reason: RATE },
  'core/team/preview.ts:usdPerMTokCachedInput': { category: 'sanctioned', reason: RATE },
  'shared/estimate.ts:hourlyUsd': { category: 'sanctioned', reason: RATE },
  // --- sanctioned: vendor wire units (xAI ticks of 1e-10 USD).
  'core/backends/modelapi/codecs/responses.ts:cost_in_usd_ticks': {
    category: 'sanctioned',
    reason: WIRE,
  },
  'core/usage/journalRecord.ts:costInUsdTicks': { category: 'sanctioned', reason: WIRE },
  'core/backends/modelapi/modelPolicy.ts:costInUsdTicks': { category: 'sanctioned', reason: WIRE },
  'core/providers/priceCard.ts:costInUsdTicks': { category: 'sanctioned', reason: WIRE },
  // --- sanctioned: VS Code number settings and their declared defaults/limits.
  'shared/constants.ts:paidDailyBudgetUsd': { category: 'sanctioned', reason: SETTING },
  'shared/constants.ts:tabDailyBudgetUsd': { category: 'sanctioned', reason: SETTING },
  'shared/constants.ts:modelApiSessionBudgetUsd': { category: 'sanctioned', reason: SETTING },
  'shared/constants.ts:minimumUsd': { category: 'sanctioned', reason: SETTING },
  'shared/constants.ts:maximumUsd': { category: 'sanctioned', reason: SETTING },
  'runtime/runtimeAccountingEntry.ts:paidDailyBudgetUsd': {
    category: 'sanctioned',
    reason: SETTING,
  },
  // --- trackedDebt: numeric money M121 converts to UsdAmount.
  'acp/translate.ts:usd': { category: 'trackedDebt', reason: DEBT },
  'core/backends/modelapi/ModelApiHost.ts:capUsd': { category: 'trackedDebt', reason: DEBT },
  'core/backends/modelapi/ModelApiHost.ts:spentUsd': { category: 'trackedDebt', reason: DEBT },
  'core/backends/modelapi/ModelApiHost.ts:uncertainUsd': { category: 'trackedDebt', reason: DEBT },
  'core/team/teamPool.ts:costUsd': { category: 'trackedDebt', reason: DEBT },
  'core/team/trafficMetrics.ts:estimatedCostUsd': { category: 'trackedDebt', reason: DEBT },
  'core/team/trafficMetrics.ts:reportedCostUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/accountUsage.ts:reservedUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/accountUsage.ts:settledUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/accountUsage.ts:uncertainUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/aggregate.ts:apiEquivalentUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/aggregate.ts:usd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/journalRecord.ts:apiEquivalentUsd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/journalRecord.ts:usd': { category: 'trackedDebt', reason: DEBT },
  'core/usage/usageService.ts:projectedUsd': { category: 'trackedDebt', reason: DEBT },
  'extension.ts:limitUsd': { category: 'trackedDebt', reason: DEBT },
  'extension.ts:remainingUsd': { category: 'trackedDebt', reason: DEBT },
  'extension.ts:usedUsd': { category: 'trackedDebt', reason: DEBT },
  'host/backend/sessionBudgetJournal.ts:reservedUsd': { category: 'trackedDebt', reason: DEBT },
  'host/backend/sessionBudgetJournal.ts:retainedUsd': { category: 'trackedDebt', reason: DEBT },
  'host/backend/sessionBudgetJournal.ts:settledUsd': { category: 'trackedDebt', reason: DEBT },
  'host/backend/sessionBudgetJournal.ts:spentUsd': { category: 'trackedDebt', reason: DEBT },
  'host/paid/paidDailyBudget.ts:capUsd': { category: 'trackedDebt', reason: DEBT },
  'host/paid/paidDailyBudget.ts:spentUsd': { category: 'trackedDebt', reason: DEBT },
  'host/paid/paidDailyBudget.ts:uncertainUsd': { category: 'trackedDebt', reason: DEBT },
  'host/usage/usagePanelEntry.ts:capUsd': { category: 'trackedDebt', reason: DEBT },
  'host/usage/usagePanelEntry.ts:spentUsd': { category: 'trackedDebt', reason: DEBT },
  'host/usage/usagePanelEntry.ts:uncertainUsd': { category: 'trackedDebt', reason: DEBT },
  'runtime/usage/usageServiceEntry.ts:apiEquivalentUsd': { category: 'trackedDebt', reason: DEBT },
  'runtime/usage/usageServiceEntry.ts:usd': { category: 'trackedDebt', reason: DEBT },
  'shared/constants.ts:dailyUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/scheduleV2.ts:paidCapUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/team.ts:costUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/team.ts:estimatedCostUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/team.ts:reportedCostUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/teamView.ts:budgetUsdToday': { category: 'trackedDebt', reason: DEBT },
  'shared/teamView.ts:costUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/teamView.ts:spentUsdToday': { category: 'trackedDebt', reason: DEBT },
  'shared/usageJournal.ts:apiEquivalentUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usageJournal.ts:limitUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usageJournal.ts:remainingUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usageJournal.ts:usd': { category: 'trackedDebt', reason: DEBT },
  'shared/usageJournal.ts:usedUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:apiEquivalentUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:cacheUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:capUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:projectedUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:spentUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:uncertainUsd': { category: 'trackedDebt', reason: DEBT },
  'shared/usagePage.ts:usd': { category: 'trackedDebt', reason: DEBT },
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PLAN_LINES = readFileSync(path.join(ROOT, 'PLAN.md'), 'utf8').split('\n')

// Collection time, like the walk it replaces: one checker over all of `src`
// is a ten-second build, which the per-test deadline is not for.
const SOURCE = analyzeSource(
  ROOT,
  readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .map(String)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
    .map((name) => path.join(ROOT, 'src', name)),
)

// The reviewer's probes (RVPORTS017D) and the 0.17 bypass forms, each its own
// module so a finding names the probe that caused it.
const FIXTURES: Readonly<Record<string, string>> = {
  'sometimesNumeric.ts': `import * as z from 'zod/mini'
export const schema = z.object({
  fooUsd: z.pipe(z.string(), z.transform((text) => (text === '' ? 0 : text))),
})`,
  'literal.ts': `import * as z from 'zod/mini'
export const schema = z.object({ fooUsd: z.literal(2) })`,
  'numericEnum.ts': `import * as z from 'zod/mini'
enum Tier { Low = 1, High = 2 }
export const schema = z.object({ fooUsd: z.enum(Tier) })`,
  'map.ts': `import * as z from 'zod/mini'
export const schema = z.object({ fooUsd: z.map(z.string(), z.number()) })`,
  'set.ts': `import * as z from 'zod/mini'
export const schema = z.object({ fooUsd: z.set(z.number()) })`,
  'privateSchema.ts': `import * as z from 'zod/mini'
const hidden = z.object({ fooUsd: z.number() })
export function parse(input: unknown): unknown {
  return hidden.parse(input)
}`,
  'miniDefault.ts': `import * as z from 'zod/mini'
const amount = z.number()
export const schema = z.object({ fooUsd: z._default(amount, 0) })`,
  'quotedKey.ts': `import * as z from 'zod/mini'
export const schema = z.object({ 'fooUsd': z.number() })
const key = 'barUsd'
export const computed = z.object({ [key]: z.number() })`,
  'interfaceRecord.ts': `export interface Totals {
  fooUsd: Record<string, number>
}`,
  'pipeAlias.ts': `import * as z from 'zod/mini'
const amount = z.pipe(z.number(), z.number())
export const schema = z.object({ nested: z.object({ fooUsd: amount }) })`,
  'importedOptional.ts': `import * as z from 'zod/mini'
import { reexportedNumeric } from '../helpers/moneyGuardReexport'
export const schema = z.object({ fooUsd: z.optional(reexportedNumeric) })`,
  'numericConst.ts': `export const feeUsd = 0.5`,
  'exactMoney.ts': `import * as z from 'zod/mini'
import { legacyUsdSchema, usdAmountSchema, usdInputSchema, type UsdAmount } from '../../../src/shared/usdSchema'
export const schema = z.object({
  boundaryUsd: legacyUsdSchema,
  inputUsd: z.optional(usdInputSchema),
  amountUsd: usdAmountSchema,
  labelUsd: z.string(),
})
export interface Row {
  readonly totalUsd: UsdAmount
  readonly perModelUsd: ReadonlyMap<number, UsdAmount>
}`,
}
const PROBES = analyzeFixtures(ROOT, FIXTURES)

function probe(file: string): string[] {
  return [...PROBES.flagged]
    .filter((id) => id.startsWith(`${file}:`))
    .toSorted((left, right) => left.localeCompare(right))
}

describe('exact-money type guard', () => {
  it('judges the whole source tree', () => {
    // A vacuous program (no files, or none under src) would pass silently.
    expect(SOURCE.files).toBeGreaterThan(1000)
    expect(SOURCE.numeric.size).toBeGreaterThan(0)
  })

  it('finds no numeric money outside the allow-list, and no stale entry', () => {
    const unexpected = [...SOURCE.flagged]
      .filter((id) => !Object.hasOwn(ALLOW_LIST, id))
      .toSorted((left, right) => left.localeCompare(right))
    const problems: string[] = []
    for (const [id, entry] of Object.entries(ALLOW_LIST)) {
      const key = id.slice(id.lastIndexOf(':') + 1)
      if (entry.category === 'nonMoney') {
        if (MONEY_KEY.test(key))
          problems.push(`${id}: listed as nonMoney but matches the money pattern`)
        else if (!SOURCE.numeric.has(id)) problems.push(`${id}: stale nonMoney entry`)
        continue
      }
      if (!SOURCE.flagged.has(id)) problems.push(`${id}: stale ${entry.category} entry`)
      if (entry.category === 'trackedDebt') continue
      const line = /PLAN\.md:(\d+)/.exec(entry.reason)?.[1]
      if (line === undefined || (PLAN_LINES[Number(line) - 1] ?? '').trim() === '')
        problems.push(`${id}: sanctioned entry without a PLAN citation`)
    }
    problems.sort((left, right) => left.localeCompare(right))
    expect({ unexpected, problems }).toEqual({ unexpected: [], problems: [] })
  })

  it('flags a sometimes-numeric transform', () => {
    expect(probe('sometimesNumeric.ts')).toEqual(['sometimesNumeric.ts:fooUsd'])
  })

  it('flags z.literal(2) and a numeric z.enum', () => {
    expect([...probe('literal.ts'), ...probe('numericEnum.ts')]).toEqual([
      'literal.ts:fooUsd',
      'numericEnum.ts:fooUsd',
    ])
  })

  it('flags z.map and z.set with numeric members', () => {
    expect([...probe('map.ts'), ...probe('set.ts')]).toEqual(['map.ts:fooUsd', 'set.ts:fooUsd'])
  })

  it('flags a private schema behind an exported parser', () => {
    expect(probe('privateSchema.ts')).toEqual(['privateSchema.ts:fooUsd'])
  })

  it('flags Mini _default over a numeric amount', () => {
    expect(probe('miniDefault.ts')).toEqual(['miniDefault.ts:fooUsd'])
  })

  it('flags quoted and computed keys', () => {
    expect(probe('quotedKey.ts')).toEqual(['quotedKey.ts:barUsd', 'quotedKey.ts:fooUsd'])
  })

  it('flags a plain interface Record<string, number>', () => {
    expect(probe('interfaceRecord.ts')).toEqual(['interfaceRecord.ts:fooUsd'])
  })

  it('flags numeric pipe aliases, imported schemas and numeric constants', () => {
    expect([
      ...probe('pipeAlias.ts'),
      ...probe('importedOptional.ts'),
      ...probe('numericConst.ts'),
    ]).toEqual(['pipeAlias.ts:fooUsd', 'importedOptional.ts:fooUsd', 'numericConst.ts:feeUsd'])
  })

  it('leaves exact money alone, including a map keyed by number', () => {
    expect(probe('exactMoney.ts')).toEqual([])
  })
})
