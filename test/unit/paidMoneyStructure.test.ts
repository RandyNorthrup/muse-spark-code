import * as z from 'zod/mini'
import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// Structural exact-money guard (PORTS017D redesign of PORTS017C).
//
// Two halves flag numeric money, and both report `file:key` findings:
//
// 1. A runtime walk of the actual zod schemas. Every module under
//    `src/shared` and `src/core` is loaded with vitest's normal module
//    loading (`import.meta.glob`, eager), every exported schema object is
//    visited once, and object shapes are descended recursively (strict
//    objects, records, arrays, tuples, unions, optional/nullable/default/
//    catch wrappers, quoted keys, lazy schemas and cross-file imports, which
//    resolve to the same schema object). Pipes are judged by their OUTPUT
//    schema; a bare transform is judged by probing what it actually parses
//    to, and an undeclared transform output on a money-named key is a
//    finding. A money-named key whose leaf parses to a JavaScript number is
//    flagged, including numbers behind aliases (`coldCacheUsd: amount`),
//    `z._default(amount, 0)`, numeric pipes and `Record<string, number>`.
// 2. The kept text scan for plain TypeScript declarations (`key: number`
//    interface fields, `type X = number` aliases, numeric `const`s and
//    non-exported local zod aliases), which the runtime walk cannot see.
//
// A money-named key matches `Usd`, `usd`, `Cost`, `Price`, `^spend`,
// `*Budget*Usd` or `*Cap*Usd` (case-sensitive: `dailyBudgetTokens`,
// `thinkingBudget`, `timeBudgetMs` and other token counts, durations and
// worker caps do not match). `legacyUsdSchema`/`usdInputSchema` boundary
// money parses to a canonical string, so exact `UsdAmount` leaves stay
// clean in both halves.
//
// The allow-list is honest about what is still numeric (M121): each entry
// has a typed category the guard checks.
//
// - `nonMoney`: genuine counts, durations, character limits and token
//   quantities. The entry must still exist as a numeric declaration and
//   must NOT match the money pattern (a match means it is miscategorized).
// - `sanctioned`: numeric money PLAN explicitly keeps: per-token/per-hour
//   price-card rates (the M95 pricing compatibility port) and vendor wire
//   fields captured exactly as the vendor sends them. Each entry needs a
//   PLAN citation (`PLAN.md:<line>`) and, for wire fields, the file:line
//   where it is converted to exact money at the boundary.
// - `trackedDebt`: every remaining current numeric money field. Each entry
//   names milestone M121, which converts it to `UsdAmount`.
//
// The guard fails on any money leaf not in the list, any stale entry, a
// `trackedDebt` entry without M121, and a `sanctioned` entry without a
// citation. It does not claim "no numeric money anywhere": the
// `trackedDebt` category below is the current numeric money inventory.

// `usd` is lowercase on purpose: the legacy journal row names its total
// `usd`, and a new lowercase money field must fail this guard too.
const MONEY_KEY = /Usd|usd|Cost|Price|^spend|Budget\w*Usd|Cap\w*Usd/
const MONEY_HINT = /Usd|usd|Cost|Price|spend|Budget|Cap/

type MoneyCategory = 'nonMoney' | 'sanctioned' | 'trackedDebt'
interface AllowEntry {
  readonly category: MoneyCategory
  readonly reason: string
}

const ALLOW_LIST: Readonly<Record<string, AllowEntry>> = {
  // --- nonMoney: token counts, durations, character limits, worker counts.
  'shared/paid.ts:dailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/teamPaid.ts:dailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/capValidation.ts:teamDailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/intensity.ts:dailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/teamMeter.ts:teamDailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/teamMeter.ts:workspaceDailyBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/modelSettings.ts:thinkingBudgetTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/modelSettings.ts:contextCapTokens': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/team/teamPool.ts:tokensCap': { category: 'nonMoney', reason: 'Token count, not money.' },
  'core/backends/modelapi/goals.ts:tokenBudget': {
    category: 'nonMoney',
    reason: 'Token count, not money.',
  },
  'core/backends/modelapi/codecs/anthropic.ts:thinkingBudget': {
    category: 'nonMoney',
    reason: 'Model thinking budget in tokens, not money.',
  },
  'core/backends/modelapi/codecs/gemini.ts:explicitBudget': {
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
  'core/reporting/history.ts:probeBudgetMs': {
    category: 'nonMoney',
    reason: 'Duration in milliseconds, not money.',
  },
  'shared/retryPolicy.ts:retryAfterCapMs': {
    category: 'nonMoney',
    reason: 'Duration in milliseconds, not money.',
  },
  'core/team/intensity.ts:runningCap': {
    category: 'nonMoney',
    reason: 'Worker count, not money.',
  },
  'core/team/intensity.ts:configuredCap': {
    category: 'nonMoney',
    reason: 'Worker count, not money.',
  },
  // --- sanctioned: price-card and per-token/per-hour rates (the M95 pricing
  // compatibility port) and vendor wire fields captured as sent.
  'core/agent/agentBackend.ts:inputUsdPerMTokens': {
    category: 'sanctioned',
    reason:
      'M95 provider capability record: catalog per-unit price, display and comparison only (PLAN.md:27519).',
  },
  'core/agent/agentBackend.ts:outputUsdPerMTokens': {
    category: 'sanctioned',
    reason:
      'M95 provider capability record: catalog per-unit price, display and comparison only (PLAN.md:27519).',
  },
  'shared/protocol.ts:inputUsdPerMTokens': {
    category: 'sanctioned',
    reason:
      'M95 provider capability record: catalog per-unit price, display and comparison only (PLAN.md:27519).',
  },
  'shared/protocol.ts:outputUsdPerMTokens': {
    category: 'sanctioned',
    reason:
      'M95 provider capability record: catalog per-unit price, display and comparison only (PLAN.md:27519).',
  },
  'core/team/intensity.ts:cachedUsdPerMTok': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/intensity.ts:usdPerMTok': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/intensity.ts:usdPerHourLow': {
    category: 'sanctioned',
    reason: 'Price-card per-hour rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/intensity.ts:usdPerHourHigh': {
    category: 'sanctioned',
    reason: 'Price-card per-hour rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/autofill.ts:usdPerMTokInput': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/capValidation.ts:usdPerMTok': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/preview.ts:usdPerMTokInput': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/preview.ts:usdPerMTokOutput': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'core/team/preview.ts:usdPerMTokCachedInput': {
    category: 'sanctioned',
    reason: 'Price-card per-unit rate: catalog price, display and comparison only (PLAN.md:17272).',
  },
  'shared/estimate.ts:hourlyUsd': {
    category: 'sanctioned',
    reason: 'Catalog price shape: per-hour rate, display and comparison only (PLAN.md:17272).',
  },
  'shared/estimate.ts:accountUsdPerHour': {
    category: 'sanctioned',
    reason:
      'Estimator per-hour demand rate in USD/hour, display and comparison only (PLAN.md:17272).',
  },
  'core/backends/modelapi/codecs/responses.ts:cost_in_usd_ticks': {
    category: 'sanctioned',
    reason:
      'Vendor wire field captured exactly as sent (PLAN.md:4230); converted to exact money at src/core/backends/modelapi/codecs/responses.ts:361 (settledCostOf).',
  },
  'core/usage/journalRecord.ts:costInUsdTicks': {
    category: 'sanctioned',
    reason:
      'Vendor wire unit carried as sent (xAI integer ticks of 1e-10 USD per token, PLAN.md:4230); converted at src/core/usage/journalRecord.ts:164.',
  },
  'core/backends/modelapi/modelPolicy.ts:costInUsdTicks': {
    category: 'sanctioned',
    reason:
      'Vendor-reported tick input carried as sent (PLAN.md:4230); converted exactly at src/core/providers/priceCard.ts:254.',
  },
  'core/providers/priceCard.ts:costInUsdTicks': {
    category: 'sanctioned',
    reason:
      'Vendor-reported tick input carried as sent (PLAN.md:4230); converted exactly at src/core/providers/priceCard.ts:254.',
  },
  // --- trackedDebt: current numeric money M121 converts to UsdAmount.
  'core/usage/accountUsage.ts:settledUsd': {
    category: 'trackedDebt',
    reason: 'Versioned read of pre-exact journal rows; M121 converts to UsdAmount.',
  },
  'core/usage/accountUsage.ts:reservedUsd': {
    category: 'trackedDebt',
    reason: 'Versioned read of pre-exact journal rows; M121 converts to UsdAmount.',
  },
  'core/usage/accountUsage.ts:uncertainUsd': {
    category: 'trackedDebt',
    reason: 'Versioned read of pre-exact journal rows; M121 converts to UsdAmount.',
  },
  'shared/usage.ts:costUsd': {
    category: 'trackedDebt',
    reason: 'OpenRouter /key wire row rendered as money; M121 converts to UsdAmount.',
  },
  'shared/usage.ts:todayUsd': {
    category: 'trackedDebt',
    reason: 'OpenRouter /key wire row rendered as money; M121 converts to UsdAmount.',
  },
  'shared/usage.ts:monthUsd': {
    category: 'trackedDebt',
    reason: 'OpenRouter /key wire row rendered as money; M121 converts to UsdAmount.',
  },
  'shared/usage.ts:limitUsd': {
    category: 'trackedDebt',
    reason: 'OpenRouter /key wire row rendered as money; M121 converts to UsdAmount.',
  },
  'shared/usage.ts:remainingUsd': {
    category: 'trackedDebt',
    reason: 'OpenRouter /key wire row rendered as money; M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:dayUsd': {
    category: 'trackedDebt',
    reason: 'Key-usage wire shape rendered as money; M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:monthUsd': {
    category: 'trackedDebt',
    reason: 'Key-usage wire shape rendered as money; M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:limitUsd': {
    category: 'trackedDebt',
    reason: 'Key-usage wire shape rendered as money; M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:remainingUsd': {
    category: 'trackedDebt',
    reason: 'Key-usage wire shape rendered as money; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:usd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:apiEquivalentUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:spentUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:capUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:uncertainUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:projectedUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usagePage.ts:cacheUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usageJournal.ts:usd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usageJournal.ts:apiEquivalentUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usageJournal.ts:usedUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usageJournal.ts:limitUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'shared/usageJournal.ts:remainingUsd': {
    category: 'trackedDebt',
    reason: 'Persisted usage-journal numeric row; M121 converts to UsdAmount.',
  },
  'core/usage/aggregate.ts:usd': {
    category: 'trackedDebt',
    reason: 'Usage accumulator numeric dollars; M121 converts to UsdAmount.',
  },
  'shared/team.ts:costUsd': {
    category: 'trackedDebt',
    reason: 'Numeric team attempt and usage cost; M121 converts to UsdAmount.',
  },
  'shared/team.ts:reportedCostUsd': {
    category: 'trackedDebt',
    reason: 'Numeric team attempt and usage cost; M121 converts to UsdAmount.',
  },
  'shared/team.ts:estimatedCostUsd': {
    category: 'trackedDebt',
    reason: 'Numeric team attempt and usage cost; M121 converts to UsdAmount.',
  },
  'shared/teamView.ts:costUsd': {
    category: 'trackedDebt',
    reason: 'Team view display-state cost; M121 converts to UsdAmount.',
  },
  'shared/teamView.ts:spentUsdToday': {
    category: 'trackedDebt',
    reason: 'Team view display-state cost; M121 converts to UsdAmount.',
  },
  'shared/teamView.ts:budgetUsdToday': {
    category: 'trackedDebt',
    reason: 'Team view display-state budget; M121 converts to UsdAmount.',
  },
  'core/team/preview.ts:usdLow': {
    category: 'trackedDebt',
    reason: 'Team price-preview total in USD; M121 converts to UsdAmount.',
  },
  'core/team/preview.ts:usdHigh': {
    category: 'trackedDebt',
    reason: 'Team price-preview total in USD; M121 converts to UsdAmount.',
  },
  'core/team/preview.ts:usd': {
    category: 'trackedDebt',
    reason: 'Team price-preview total in USD; M121 converts to UsdAmount.',
  },
  'shared/scheduleV2.ts:paidCapUsd': {
    category: 'trackedDebt',
    reason:
      'Schedule cap in v2 numeric files and JSON drafts (versioned z.codec boundary); M121 converts to UsdAmount.',
  },
  'shared/scheduleV2.ts:usd': {
    category: 'trackedDebt',
    reason:
      'Schedule amount in v2 numeric files and JSON drafts (versioned z.codec boundary); M121 converts to UsdAmount.',
  },
  'shared/scheduleV2.ts:retainedLiabilityUsd': {
    category: 'trackedDebt',
    reason:
      'Schedule liability in v2 numeric files and JSON drafts (versioned z.codec boundary); M121 converts to UsdAmount.',
  },
  'core/backends/modelapi/schemas.ts:provider_cost_usd': {
    category: 'trackedDebt',
    reason:
      "Codec-normalized captured provider cost in dollars (the old text guard's pre-filter missed snake_case); M121 converts to UsdAmount.",
  },
  // Spread-copies of team's numeric traffic shape (`...teamTrafficMetricsSchema.shape`
  // at modelsPanel.ts:671), not the exact `costUsd: legacyUsdSchema` field at line 92.
  // They convert together with the team shape under M121.
  'shared/modelsPanel.ts:costUsd': {
    category: 'trackedDebt',
    reason:
      'Spread-copy of the numeric team traffic costs (modelsPanel.ts:671); M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:reportedCostUsd': {
    category: 'trackedDebt',
    reason:
      'Spread-copy of the numeric team traffic costs (modelsPanel.ts:671); M121 converts to UsdAmount.',
  },
  'shared/modelsPanel.ts:estimatedCostUsd': {
    category: 'trackedDebt',
    reason:
      'Spread-copy of the numeric team traffic costs (modelsPanel.ts:671); M121 converts to UsdAmount.',
  },
}

// ---------- Part 1: runtime walk of the actual exported zod schemas ----------

interface ZodSchemaLike {
  readonly _zod: { readonly def: { readonly type: string } & Record<string, unknown> }
  readonly safeParse: (value: unknown) => { readonly success: boolean; readonly data?: unknown }
}

function asSchema(value: unknown): ZodSchemaLike | null {
  if (typeof value !== 'object' || value === null || !('_zod' in value)) return null
  const zod = (value as { _zod?: unknown })._zod
  if (typeof zod !== 'object' || zod === null || !('def' in zod)) return null
  const def = (zod as { def?: unknown }).def
  return typeof def !== 'object' ||
    def === null ||
    typeof (def as { type?: unknown }).type !== 'string' ||
    typeof (value as { safeParse?: unknown }).safeParse !== 'function'
    ? null
    : (value as ZodSchemaLike)
}

function shapeOf(def: ZodSchemaLike['_zod']['def']): Record<string, unknown> {
  const shape = def['shape']
  if (typeof shape === 'function') {
    const resolved: unknown = (shape as () => unknown)()
    return typeof resolved === 'object' && resolved !== null
      ? (resolved as Record<string, unknown>)
      : {}
  }
  return typeof shape === 'object' && shape !== null ? (shape as Record<string, unknown>) : {}
}

// Structural children, ignoring key names. Pipes contribute only their
// OUTPUT schema: a numeric input that parses to a canonical string (the
// `legacyUsdSchema` boundary shape) is exact money, not a finding.
function childSchemas(def: ZodSchemaLike['_zod']['def']): ZodSchemaLike[] {
  const child = (value: unknown): ZodSchemaLike[] => {
    const schema = asSchema(value)
    return schema === null ? [] : [schema]
  }
  const children = (value: unknown): ZodSchemaLike[] =>
    Array.isArray(value) ? value.flatMap((entry) => child(entry)) : child(value)
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'default':
    case 'prefault':
    case 'catch': {
      return child(def['innerType'])
    }
    case 'pipe': {
      return child(def['out'])
    }
    case 'union': {
      return children(def['options'])
    }
    case 'object': {
      return Object.values(shapeOf(def)).flatMap((entry) => child(entry))
    }
    case 'array': {
      return child(def['element'])
    }
    case 'tuple': {
      return [...children(def['items']), ...child(def['rest'])]
    }
    case 'record': {
      return child(def['valueType'])
    }
    case 'lazy': {
      try {
        const getter = def['getter']
        return typeof getter === 'function' ? child((getter as () => unknown)()) : []
      } catch {
        return []
      }
    }
    default: {
      return []
    }
  }
}

const MONEY_PROBES: readonly unknown[] = [0, '0', 'probe-marker', null, undefined, true, [], {}]

// What one probe round proves about a leaf: some probe parsed to a number,
// some probe parsed to a non-number, or nothing parsed at all. A probe must
// never throw: some production transforms raise instead of failing cleanly
// (a throwing probe proves nothing, so it is skipped like a failed one).
function probeLeaf(schema: ZodSchemaLike): 'number' | 'other' | 'silent' {
  for (const probe of MONEY_PROBES) {
    try {
      const result = schema.safeParse(probe)
      if (result.success) return typeof result.data === 'number' ? 'number' : 'other'
    } catch {
      continue
    }
  }
  return 'silent'
}

// Does this leaf schema parse to a JavaScript number? Wrappers unwrap, pipes
// judge their output, unions/arrays/tuples/records judge their members, and a
// bare transform is judged by probing what it actually parses to: a numeric
// output is a finding, a proven non-number output is exact money, and a
// transform no probe can satisfy has an undeclared output, which on a
// money-named key is a finding too.
function isNumericLeaf(schema: ZodSchemaLike, seen: Set<ZodSchemaLike>): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  const def = schema._zod.def
  switch (def.type) {
    case 'number': {
      return true
    }
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'default':
    case 'prefault':
    case 'catch': {
      const inner = asSchema(def['innerType'])
      return inner !== null && isNumericLeaf(inner, seen)
    }
    case 'pipe': {
      const out = asSchema(def['out'])
      return out !== null && isNumericLeaf(out, seen)
    }
    case 'union': {
      const options = def['options']
      return (
        Array.isArray(options) &&
        options.some((option) => {
          const inner = asSchema(option)
          return inner !== null && isNumericLeaf(inner, seen)
        })
      )
    }
    case 'array': {
      const element = asSchema(def['element'])
      return element !== null && isNumericLeaf(element, seen)
    }
    case 'tuple': {
      const items = [def['items'], def['rest']].flat()
      return items.some((item) => {
        const inner = asSchema(item)
        return inner !== null && isNumericLeaf(inner, seen)
      })
    }
    case 'record': {
      const value = asSchema(def['valueType'])
      return value !== null && isNumericLeaf(value, seen)
    }
    case 'lazy': {
      try {
        const getter = def['getter']
        if (typeof getter !== 'function') return false
        const inner = asSchema((getter as () => unknown)())
        return inner !== null && isNumericLeaf(inner, seen)
      } catch {
        return false
      }
    }
    case 'transform': {
      // No declared output is visible at runtime, so probe the behavior.
      return probeLeaf(schema) !== 'other'
    }
    case 'string':
    case 'boolean':
    case 'bigint':
    case 'literal':
    case 'enum':
    case 'never': {
      return false
    }
    default: {
      // Dates, URLs, templates, custom schemas and any future leaf kind:
      // probe the behavior; only a proven numeric output is a finding.
      const inner = childSchemas(def)
      return inner.length > 0
        ? inner.some((entry) => isNumericLeaf(entry, seen))
        : probeLeaf(schema) === 'number'
    }
  }
}

const KNOWN_DEF_TYPES: ReadonlySet<string> = new Set([
  'array',
  'bigint',
  'boolean',
  'catch',
  'coerce',
  'custom',
  'date',
  'datetime',
  'default',
  'discriminatedUnion',
  'enum',
  'file',
  'float32',
  'float64',
  'int',
  'int32',
  'int64',
  'ipv4',
  'ipv6',
  'lazy',
  'literal',
  'map',
  'nan',
  'never',
  'neverReadonly',
  'nonoptional',
  'nullable',
  'null',
  'number',
  'object',
  'optional',
  'pipe',
  'prefault',
  'promise',
  'readonly',
  'record',
  'set',
  'string',
  'stringbool',
  'success',
  'template_literal',
  'transform',
  'tuple',
  'uint32',
  'uint64',
  'undefined',
  'union',
  'unknown',
  'url',
  'uuid',
  'void',
])

interface RuntimeVerdict {
  readonly flagged: ReadonlySet<string>
  readonly numeric: ReadonlySet<string>
}

// A finding is attributed to the module that declares the key, not merely
// the first module that re-exports its schema object: `teamView`'s budget
// shape reaches the walk through `team` too, and `usagePage` rows through
// `usageCompanion`. Every reaching file is recorded; the key is attributed
// to the first one (sorted) whose source declares it, falling back to the
// first reacher for computed keys no source text names.
interface ShapeRecord {
  readonly files: Set<string>
  readonly keys: { readonly key: string; readonly inner: ZodSchemaLike }[]
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function walkSchema(
  file: string,
  schema: ZodSchemaLike,
  descended: Set<ZodSchemaLike>,
  seenDefTypes: Set<string>,
  records: Map<ZodSchemaLike, ShapeRecord>,
): void {
  const record = records.get(schema)
  if (record !== undefined) {
    record.files.add(file)
    return
  }
  const fresh: ShapeRecord = { files: new Set([file]), keys: [] }
  records.set(schema, fresh)
  if (descended.has(schema)) return
  descended.add(schema)
  const def = schema._zod.def
  seenDefTypes.add(def.type)
  if (def.type === 'object') {
    const shape = shapeOf(def)
    for (const [key, value] of Object.entries(shape)) {
      const inner = asSchema(value)
      if (inner !== null) fresh.keys.push({ key, inner })
    }
  }
  for (const entry of childSchemas(def)) walkSchema(file, entry, descended, seenDefTypes, records)
}

function walkModuleExports(
  file: string,
  namespace: Record<string, unknown>,
  descended: Set<ZodSchemaLike>,
  seenDefTypes: Set<string>,
  records: Map<ZodSchemaLike, ShapeRecord>,
): void {
  for (const value of Object.values(namespace)) {
    const schema = asSchema(value)
    if (schema !== null) walkSchema(file, schema, descended, seenDefTypes, records)
  }
}

// Every module under src/shared and src/core, loaded with vitest's normal
// module loading. Collection-time eager loading keeps the 5 s test timeout
// for the walk itself; the earlier sequential dynamic import did not fit.
const RUNTIME_MODULES: Record<string, Record<string, unknown>> = {
  ...import.meta.glob('../../src/shared/**/*.ts', { eager: true }),
  ...import.meta.glob('../../src/core/**/*.ts', { eager: true }),
}

function analyzeRuntime(
  hasKeyDecl: (file: string, key: string) => boolean,
): RuntimeVerdict & { readonly defTypes: ReadonlySet<string> } {
  const descended = new Set<ZodSchemaLike>()
  const seenDefTypes = new Set<string>()
  const records = new Map<ZodSchemaLike, ShapeRecord>()
  const modulePaths = Object.keys(RUNTIME_MODULES).toSorted((left, right) =>
    left.localeCompare(right),
  )
  for (const path of modulePaths) {
    const file = path.replaceAll('\\', '/').replace(/^\.\.\/\.\.\/src\//, '')
    walkModuleExports(file, RUNTIME_MODULES[path] ?? {}, descended, seenDefTypes, records)
  }
  // The structural walk descends each schema once, so a repeat visit records
  // its file only on the object itself. Propagate every file to every
  // descendant to a fixpoint: a schema nested under two modules belongs to
  // both reachers, and attribution then picks the one that declares the key.
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const [schema, record] of records) {
      for (const child of childSchemas(schema._zod.def)) {
        const target = records.get(child)
        if (target === undefined) continue
        for (const file of record.files) {
          if (target.files.has(file)) {
            continue
          }

          target.files.add(file)
          isChanged = true
        }
      }
    }
  }
  const flagged = new Set<string>()
  const numeric = new Set<string>()
  for (const record of records.values()) {
    const reachers = [...record.files].toSorted((left, right) => left.localeCompare(right))
    for (const { key, inner } of record.keys) {
      if (!isNumericLeaf(inner, new Set())) continue
      const owner = reachers.find((file) => hasKeyDecl(file, key)) ?? reachers[0] ?? '<fixture>'
      const id = `${owner}:${key}`
      numeric.add(id)
      if (MONEY_KEY.test(key)) flagged.add(id)
    }
  }
  return { flagged, numeric, defTypes: seenDefTypes }
}

// Judge one exported-looking schema map the way the tree walk judges real
// modules: used by the bypass drills below on fixture schemas.
function judgeSchemas(schemas: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const descended = new Set<ZodSchemaLike>()
  const seenDefTypes = new Set<string>()
  const records = new Map<ZodSchemaLike, ShapeRecord>()
  walkModuleExports('<fixture>', schemas, descended, seenDefTypes, records)
  const flagged = new Set<string>()
  for (const record of records.values()) {
    for (const { key, inner } of record.keys) {
      if (MONEY_KEY.test(key) && isNumericLeaf(inner, new Set())) flagged.add(`<fixture>:${key}`)
    }
  }
  return flagged
}

// ---------- Part 2: kept text scan for plain TypeScript declarations ----------

interface TextFinding {
  readonly file: string
  readonly key: string
}

const QUOTE_CHARS = new Set(['"', "'", '`'])
const OPENERS = ['(', '[', '{']
const CLOSERS = [')', ']', '}']

function closerFor(opener: string): string {
  return CLOSERS[OPENERS.indexOf(opener)] ?? ''
}

function isQuote(char: string): boolean {
  return QUOTE_CHARS.has(char)
}

// Shared quote tracking for the single-line scanners below: feed every
// character in order; `quoted` reports whether it sits inside a string (the
// quote characters themselves count as quoted) and advances the tracker.
function makeQuoteTracker(): { quoted(char: string): boolean } {
  let quote: string | null = null
  let isEscaped = false
  return {
    quoted(char: string): boolean {
      if (quote !== null) {
        if (isEscaped) isEscaped = false
        else if (char === '\\') isEscaped = true
        else if (char === quote) quote = null
        return true
      }
      if (isQuote(char)) {
        quote = char
        return true
      }
      return false
    },
  }
}

// Cut a `//` comment; strings may contain slashes, and backslashes escape.
// Source lines are ASCII, so UTF-16 indexing is exact here.
function stripLineComment(line: string): string {
  const tracker = makeQuoteTracker()
  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? ''
    if (tracker.quoted(char)) continue
    if (char === '/' && line[index + 1] === '/') return line.slice(0, index)
  }
  return line
}

function stripStrings(value: string): string {
  let out = ''
  const tracker = makeQuoteTracker()
  for (const char of value) {
    if (!tracker.quoted(char)) out += char
  }
  return out
}

function bracketDepth(value: string): number {
  const text = stripStrings(value)
  let depth = 0
  for (const char of text) {
    if (OPENERS.includes(char)) depth += 1
    if (CLOSERS.includes(char)) depth -= 1
  }
  return depth
}

// Index of the closer matching the opener at `open`, or -1. Quote-aware and
// linear: no regex backtracking on large schema expressions.
function findCloser(text: string, open: number): number {
  const opener = text[open] ?? ''
  const closer = closerFor(opener)
  if (closer === '') return -1
  let depth = 0
  const tracker = makeQuoteTracker()
  for (let index = open; index < text.length; index++) {
    const char = text[index] ?? ''
    if (tracker.quoted(char)) continue
    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

// ASI-aware initializer: stops at a newline at depth 0 unless the next line
// continues a method chain. The repo omits semicolons, so scanning to `;`
// would swallow following declarations.
function readInitializer(
  lines: readonly string[],
  index: number,
): { readonly name: string; readonly init: string; readonly last: number } | null {
  const match = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(lines[index] ?? '')
  if (match?.[1] === undefined) return null
  let text = match[2] ?? ''
  let last = index
  while (bracketDepth(text) > 0 && last + 1 < lines.length && last - index < 40) {
    last += 1
    text += `\n${lines[last] ?? ''}`
  }
  while (last + 1 < lines.length && /^\s*\./.test(lines[last + 1] ?? '')) {
    last += 1
    text += `\n${lines[last] ?? ''}`
  }
  return { name: match[1], init: text, last }
}

// Local numeric aliases only: `type X = number` and `const X = <zod number
// expression>`, transitively. Imported schemas are judged by the runtime
// walk instead, which resolves the real objects.
function localNumerics(lines: readonly string[]): Set<string> {
  const numeric = new Set<string>()
  const inits = new Map<string, string>()
  for (let index = 0; index < lines.length; index++) {
    const read = readInitializer(lines, index)
    if (read === null) continue
    inits.set(read.name, read.init)
    index = read.last
  }
  for (const match of lines.join('\n').matchAll(/type\s+([A-Za-z_$][\w$]*)\s*=\s*number\b/g)) {
    if (match[1] !== undefined) numeric.add(match[1])
  }
  for (const [name, init] of inits) {
    if (/z\s*\.\s*(coerce\s*\.\s*)?number\b/.test(stripStrings(init))) numeric.add(name)
  }
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const [name, init] of inits) {
      if (numeric.has(name)) continue
      const ids = stripStrings(init).match(/[A-Za-z_$][\w$]*/g) ?? []
      if (ids.every((id) => !numeric.has(id))) continue
      numeric.add(name)
      isChanged = true
    }
  }
  return numeric
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  const tracker = makeQuoteTracker()
  let current = ''
  for (const char of text) {
    const isQuoted = tracker.quoted(char)
    current += char
    if (isQuoted) continue
    if (OPENERS.includes(char)) depth += 1
    if (CLOSERS.includes(char)) depth -= 1
    // Commas and semicolons both separate members (`a: number; b: number`
    // on one interface line); neither appears at depth 0 inside a type.
    if (depth !== 0 || (char !== ',' && char !== ';')) continue
    parts.push(current.slice(0, -1))
    current = ''
  }
  parts.push(current)
  return parts
}

function isBareAlias(clean: string, numerics: ReadonlySet<string>): boolean {
  // Bare aliases only: `scheduleShape.paidCapUsd` and `four.toolCalling` are
  // member reads whose leaf type is unknown here, not numeric aliases.
  // Union members are tested individually (`amount | undefined` still fails).
  return clean.split('|').some((member) => {
    const bare = /^(?:typeof\s+)?([A-Za-z_$][\w$]*)\s*[?!]?\s*(\[\s*\]\s*)*$/.exec(
      member.trim().replace(/^Array<([\s\S]*)>$/, '$1'),
    )?.[1]
    return bare !== undefined && numerics.has(bare)
  })
}

// The first top-level segment of a `key: value` declaration is numeric when
// it is (or aliases) a number. Test only the first segment: later siblings
// belong to other keys (`coldCacheUsd: amount, })` tests `amount`, not the blob).
// Transparent wrappers (`z.optional`, `z.union`, `z.record`, ...) descend into
// the args that carry the value. Anything else (`z.pipe`, `z.codec`,
// `z.transform`, `z.object`, ...) has an output the text cannot judge, so the
// text leaves it alone and the runtime walk judges the real output schema.
function isNumericValue(value: string, numerics: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 8) return false
  const first = splitTopLevel(value)[0] ?? ''
  const clean = stripStrings(first.trim().replace(/[,;}\]]+\s*$/, ''))
  if (/^number\b/.test(clean)) return true
  const call = /^z\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(clean)
  if (call?.[1] !== undefined) {
    const start = clean.indexOf('(')
    const end = findCloser(clean, start)
    if (end > start) {
      const args = splitTopLevel(clean.slice(start + 1, end))
      if (
        ['optional', 'nullable', 'readonly', 'default', 'prefault', 'catch', 'array'].includes(
          call[1],
        )
      )
        return args[0] !== undefined && isNumericValue(args[0], numerics, depth + 1)
      if (call[1] === 'union') {
        const head = (args[0] ?? '').trim()
        const members = head.startsWith('[')
          ? splitTopLevel(head.slice(1).replace(/\]\s*$/, ''))
          : args
        return members.some((member) => isNumericValue(member, numerics, depth + 1))
      }
      if (call[1] === 'record')
        return args[1] !== undefined && isNumericValue(args[1], numerics, depth + 1)
    }
  }
  return /z\s*\.\s*(coerce\s*\.\s*)?number\b/.test(clean) || isBareAlias(clean, numerics)
}

// The top-level bracket groups of `text`, so nested object literals are
// scanned without recursion.
function innerGroups(text: string): string[] {
  const groups: string[] = []
  const tracker = makeQuoteTracker()
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if (tracker.quoted(char) || !OPENERS.includes(char)) continue
    const end = findCloser(text, index)
    if (end <= index) continue
    groups.push(text.slice(index + 1, end))
    index = end
  }
  return groups
}

// Iterative descent: a stack replaces recursion over nested literals. Every
// numeric declaration feeds `numericIds`; money-named ones also feed `hits`.
function scanText(
  text: string,
  file: string,
  numerics: ReadonlySet<string>,
  hits: TextFinding[],
  numericIds: Set<string>,
): void {
  const pending = [text]
  const head = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*([\s\S]*)$/
  let current = pending.pop()
  while (current !== undefined) {
    if (MONEY_HINT.test(current)) {
      for (const part of splitTopLevel(current)) {
        if (!MONEY_HINT.test(part)) continue
        const match = head.exec(part)
        if (match?.[1] === undefined) {
          pending.push(...innerGroups(part))
          continue
        }
        const key = match[1]
        const rest = match[2] ?? ''
        if (isNumericValue(rest, numerics)) {
          numericIds.add(`${file}:${key}`)
          if (MONEY_KEY.test(key)) hits.push({ file, key })
        }
        pending.push(rest)
      }
    }
    current = pending.pop()
  }
}

function analyzeText(
  files: readonly string[],
  linesOf: (file: string) => string[],
): { readonly flagged: TextFinding[]; readonly numericIds: ReadonlySet<string> } {
  const hits: TextFinding[] = []
  const numericIds = new Set<string>()
  for (const file of files) {
    const lines = linesOf(file)
    const numeric = localNumerics(lines)
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue
      let text = line
      const keyed = /([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*(.*)$/.exec(line)
      // Join only a money-keyed value with unbalanced brackets (capped), so a
      // new multiline numeric money field still fails while huge objects stay
      // cheap. Other lines are scanned as-is; their nested literals recurse.
      if (keyed?.[1] !== undefined && MONEY_KEY.test(keyed[1])) {
        let last = index
        while (bracketDepth(text) > 0 && last + 1 < lines.length && last - index < 25) {
          last += 1
          text += ` ${lines[last] ?? ''}`
        }
      }
      scanText(text, file, numeric, hits, numericIds)
    }
    for (const line of lines) {
      const constant = /(?:^|[;{\s])const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d[\d_]*(?:\.\d+)?)\b/.exec(
        line,
      )
      if (constant?.[1] === undefined || !MONEY_KEY.test(constant[1])) {
        continue
      }

      numericIds.add(`${file}:${constant[1]}`)
      hits.push({ file, key: constant[1] })
    }
  }
  return { flagged: hits, numericIds }
}

describe('structural exact-money guard', () => {
  it('flags every money-named numeric leaf under src/shared and src/core', async () => {
    const root = new URL('../../src/', import.meta.url)
    const names = await readdir(root, { recursive: true })
    const files = names
      .map((name) => name.replaceAll('\\', '/'))
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) => name.startsWith('shared/') || name.startsWith('core/'))
      .toSorted((left, right) => left.localeCompare(right))
    const raw = new Map<string, string>()
    for (const file of files) raw.set(file, await readFile(new URL(file, root), 'utf8'))
    const sources = new Map<string, string[]>()
    const linesOf = (file: string): string[] => {
      const cached = sources.get(file)
      if (cached !== undefined) return cached
      const lines = (raw.get(file) ?? '').split('\n').map((line) => stripLineComment(line))
      sources.set(file, lines)
      return lines
    }
    // Cheap pre-filter: only files mentioning a money hint pay for parsing.
    const candidates = files.filter((file) => MONEY_HINT.test(raw.get(file) ?? ''))
    const text = analyzeText(candidates, linesOf)
    const stripped = new Map<string, string>()
    const hasKeyDecl = (file: string, key: string): boolean => {
      let entry = stripped.get(file)
      if (entry === undefined) {
        entry = linesOf(file).join('\n')
        stripped.set(file, entry)
      }
      return new RegExp(String.raw`\b${escapeRegExp(key)}\b\s*[?!]?\s*:`).test(entry)
    }
    const runtime = analyzeRuntime(hasKeyDecl)
    // The glob must see the same tree the text scan reads: a silent empty
    // glob would pass vacuously.
    expect(Object.keys(RUNTIME_MODULES).length).toBeGreaterThan(0)
    expect(RUNTIME_MODULES['../../src/shared/usdSchema.ts']).toBeDefined()
    // A zod definition kind the walker does not know is a coverage hole, not
    // a pass: name it here before the walk can silently skip it.
    expect([...runtime.defTypes].filter((type) => !KNOWN_DEF_TYPES.has(type))).toEqual([])
    const flagged = new Set<string>([
      ...text.flagged.map((hit) => `${hit.file}:${hit.key}`),
      ...runtime.flagged,
    ])
    const numericIds = new Set<string>([...text.numericIds, ...runtime.numeric])
    const unexpected = [...flagged]
      .filter((id) => !Object.hasOwn(ALLOW_LIST, id))
      .toSorted((left, right) => left.localeCompare(right))
    const problems: string[] = []
    for (const [id, entry] of Object.entries(ALLOW_LIST)) {
      if (entry.category === 'nonMoney') {
        if (flagged.has(id))
          problems.push(
            `${id}: listed as nonMoney but matches the money pattern; move it to sanctioned or trackedDebt`,
          )
        else if (!numericIds.has(id)) problems.push(`${id}: stale nonMoney entry`)
      } else {
        if (!flagged.has(id)) problems.push(`${id}: stale ${entry.category} entry`)
        if (entry.category === 'trackedDebt' && !entry.reason.includes('M121'))
          problems.push(`${id}: trackedDebt entry without M121`)
        if (entry.category === 'sanctioned' && !/PLAN\.md:\d+/.test(entry.reason))
          problems.push(`${id}: sanctioned entry without a PLAN citation`)
      }
    }
    problems.sort((left, right) => left.localeCompare(right))
    expect({ unexpected, problems }).toEqual({ unexpected: [], problems: [] })
  })

  // Each bypass form the review caught must fail the guard when injected.
  // Fixture schemas live in this test, never as edits to `src`.
  it('flags a numeric pipe alias on a money key', () => {
    const amount = z.pipe(z.number(), z.number())
    const schema = z.strictObject({ nested: z.strictObject({ fooUsd: amount }) })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:fooUsd'])
  })

  it('flags a numeric transform alias on a money key', () => {
    const amount = z.pipe(
      z.number(),
      z.transform((value) => value),
    )
    const schema = z.strictObject({ fooUsd: amount })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:fooUsd'])
  })

  it('flags z._default over a numeric amount on a money key', () => {
    const amount = z.number()
    const schema = z.strictObject({ fooUsd: z._default(amount, 0) })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:fooUsd'])
  })

  it('flags an imported numeric schema wrapped in a local optional', async () => {
    const { reexportedNumeric } = await import('./helpers/moneyGuardReexport')
    const schema = z.strictObject({ fooUsd: z.optional(reexportedNumeric) })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:fooUsd'])
  })

  it('flags a quoted money key', () => {
    // Spelled with a computed key, as a quoted `'quotedUsd':` source
    // spelling would be: the runtime walk reads the shape, not the text.
    const key = 'quotedUsd'
    const schema = z.strictObject({ [key]: z.number() })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:quotedUsd'])
  })

  it('flags Record<string, number> under a money key', () => {
    const schema = z.strictObject({ recordUsd: z.record(z.string(), z.number()) })
    expect([...judgeSchemas({ schema })]).toEqual(['<fixture>:recordUsd'])
  })

  it('leaves exact boundary money alone', async () => {
    const { legacyUsdSchema, usdInputSchema } = await import('../../src/shared/usdSchema')
    const schema = z.strictObject({
      boundaryUsd: legacyUsdSchema,
      inputUsd: z.optional(usdInputSchema),
      labelUsd: z.string(),
    })
    expect([...judgeSchemas({ schema })]).toEqual([])
  })
})
