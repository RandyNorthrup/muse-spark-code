import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SANCTIONED_ESTIMATOR,
  SANCTIONED_RATE,
  SANCTIONED_SETTING,
  SANCTIONED_WIRE,
} from './helpers/moneyPlanCitations'
import { analyzeFixtures, analyzeSource, MAX_TYPE_DEPTH, MONEY_KEY } from './helpers/moneyTypeGuard'
import { planCitationChecker, type PlanCitation } from './helpers/planCitation'

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
//   entry cites the clause of that paragraph that sanctions it, by M121's
//   heading and the clause's own words (`./helpers/planCitation`), never by
//   line number: the clause must be in PLAN.md exactly once, under M121.
//
// M121 converted every former `trackedDebt` entry (the 0.17 inventory of
// current numeric money) to `UsdAmount`; that category no longer exists.
//
// Every other money leaf fails, and a listed entry that no longer matches is
// stale and fails too.

type AllowEntry =
  | { readonly category: 'nonMoney'; readonly reason: string }
  | { readonly category: 'sanctioned'; readonly reason: string; readonly plan: PlanCitation }

const RATE: AllowEntry = {
  category: 'sanctioned',
  reason: 'Per-unit price-card or catalog rate, display and comparison only.',
  plan: SANCTIONED_RATE,
}
const WIRE: AllowEntry = {
  category: 'sanctioned',
  reason: 'Vendor wire unit captured as sent, converted exactly at the boundary.',
  plan: SANCTIONED_WIRE,
}
const SETTING: AllowEntry = {
  category: 'sanctioned',
  reason: 'VS Code number setting or its declared default/limit, read with Usd.from.',
  plan: SANCTIONED_SETTING,
}
const TOKENS = 'Token count, not money.'

const ALLOW_LIST: Readonly<Record<string, AllowEntry>> = {
  // --- nonMoney: token counts, durations, character limits, worker counts.
  'shared/paid.ts:dailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/capValidation.ts:teamDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/intensity.ts:dailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/teamMeter.ts:teamDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/teamMeter.ts:workspaceDailyBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/modelSettings.ts:thinkingBudgetTokens': { category: 'nonMoney', reason: TOKENS },
  'core/team/modelSettings.ts:contextCapTokens': { category: 'nonMoney', reason: TOKENS },
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
  'core/team/intensity.ts:runningCap': { category: 'nonMoney', reason: 'Worker count, not money.' },
  'core/team/intensity.ts:configuredCap': {
    category: 'nonMoney',
    reason: 'Worker count, not money.',
  },
  // --- sanctioned: per-unit rates.
  'core/agent/agentBackend.ts:inputUsdPerMTokens': RATE,
  'core/agent/agentBackend.ts:outputUsdPerMTokens': RATE,
  'core/backends/musecode/MuseCodeHost.ts:inputUsdPerMTokens': RATE,
  'core/backends/musecode/MuseCodeHost.ts:outputUsdPerMTokens': RATE,
  'shared/protocol.ts:inputUsdPerMTokens': RATE,
  'shared/protocol.ts:outputUsdPerMTokens': RATE,
  'core/providers/providerRegistry.ts:inputUsdPerMTokens': RATE,
  'core/providers/providerRegistry.ts:outputUsdPerMTokens': RATE,
  'host/conversation/conversationController.ts:inputUsdPerMTokens': RATE,
  'host/conversation/conversationController.ts:outputUsdPerMTokens': RATE,
  'core/team/intensity.ts:cachedUsdPerMTok': RATE,
  'core/team/intensity.ts:usdPerMTok': RATE,
  'core/team/intensity.ts:usdPerHourLow': RATE,
  'core/team/intensity.ts:usdPerHourHigh': RATE,
  'core/team/autofill.ts:usdPerMTokInput': RATE,
  'core/team/capValidation.ts:usdPerMTok': RATE,
  'core/team/preview.ts:usdPerMTokInput': RATE,
  'core/team/preview.ts:usdPerMTokOutput': RATE,
  'core/team/preview.ts:usdPerMTokCachedInput': RATE,
  'shared/estimate.ts:hourlyUsd': RATE,
  'shared/estimate.ts:CatalogPrice': {
    category: 'sanctioned',
    reason: 'Hourly catalog rate, display and comparison only.',
    plan: SANCTIONED_RATE,
  },
  'shared/estimate.ts:catalogPriceSchema': {
    category: 'sanctioned',
    reason: 'Hourly catalog rate, display and comparison only.',
    plan: SANCTIONED_RATE,
  },
  'shared/estimate.ts:accountUsdPerHour': {
    category: 'sanctioned',
    reason: 'Estimator USD/hour demand forecast, scheduling math.',
    plan: SANCTIONED_ESTIMATOR,
  },
  'core/estimator/schedule.ts:accountUsdPerHour': {
    category: 'sanctioned',
    reason: 'The same estimator USD/hour demand forecast, seen through Reservation.',
    plan: SANCTIONED_ESTIMATOR,
  },
  'core/estimator/schedule.ts:usd': {
    category: 'sanctioned',
    reason: 'Estimator USD/hour demand forecast, scheduling math.',
    plan: SANCTIONED_ESTIMATOR,
  },
  'core/estimator/planSnapshot.ts:accountUsdPerHour': {
    category: 'sanctioned',
    reason: 'The same estimator USD/hour demand forecast, constructed in the plan snapshot.',
    plan: SANCTIONED_ESTIMATOR,
  },
  'core/providers/providersFile.ts:UserPriceCard': {
    category: 'sanctioned',
    reason: 'User-entered USD-per-token price card.',
    plan: SANCTIONED_RATE,
  },
  'core/providers/providersFile.ts:userPriceCardSchema': {
    category: 'sanctioned',
    reason: 'User-entered USD-per-token price card.',
    plan: SANCTIONED_RATE,
  },
  'core/backends/modelapi/codecs/responses.ts:settledCostSchema': WIRE,
  // --- sanctioned: vendor wire units (xAI ticks of 1e-10 USD).
  'core/backends/modelapi/codecs/responses.ts:cost_in_usd_ticks': WIRE,
  'core/usage/journalRecord.ts:costInUsdTicks': WIRE,
  'core/backends/modelapi/modelPolicy.ts:costInUsdTicks': WIRE,
  'core/providers/priceCard.ts:costInUsdTicks': WIRE,
  // --- sanctioned: VS Code number settings and their declared defaults/limits.
  'shared/constants.ts:paidDailyBudgetUsd': SETTING,
  'shared/constants.ts:tabDailyBudgetUsd': SETTING,
  'shared/constants.ts:modelApiSessionBudgetUsd': SETTING,
  'shared/constants.ts:minimumUsd': SETTING,
  'shared/constants.ts:maximumUsd': SETTING,
  'runtime/runtimeAccountingEntry.ts:paidDailyBudgetUsd': SETTING,
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const planProblem = planCitationChecker(readFileSync(path.join(ROOT, 'PLAN.md'), 'utf8'))

// Collection time, like the walk it replaces: one checker over all of `src`
// is a ten-second build, which the per-test deadline is not for.
const SOURCE = analyzeSource(
  ROOT,
  readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .map(String)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
    .map((name) => path.join(ROOT, 'src', name)),
)

/** `Box<Box<…<inner>…>>`, `count` boxes deep. */
function boxed(count: number, inner: string): string {
  return `${'Box<'.repeat(count)}${inner}${'>'.repeat(count)}`
}

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
  'finiteRecord.ts': `export interface Totals {
  fooUsd: Record<'openai' | 'meta', number>
}`,
  'mappedMoney.ts': `export type Totals = { [K in 'fooUsd']: number }`,
  'unionMapped.ts': `export type Totals = { [K in 'fooUsd']: number } | { kind: 'none' }`,
  'intersectionMapped.ts': `export type Totals = { [K in 'fooUsd']: number } & { kind: 'money' }`,
  'inheritedMapped.ts': `export interface Totals extends Record<'fooUsd', number> {}`,
  'inheritedBase.ts': `export interface Base extends Record<'fooUsd', number> {}
export interface Totals extends Base {}`,
  'apparentMapped.ts': `export type Totals<T extends Record<'fooUsd', number>> = T`,
  'apparentValue.ts': `export interface Totals<T extends Record<'provider', number>> {
  fooUsd: T
}`,
  'apparentNumber.ts': `export interface Totals<T extends number> {
  fooUsd: T
}`,
  'nestedUnion.ts': `export interface Totals {
  fooUsd: { value: number } | { kind: 'none' }
}`,
  'nestedMapped.ts': `export type Totals = {
  data: { [K in 'fooUsd']: number } | { kind: 'none' }
}`,
  'arrayMapped.ts': `export type Totals = {
  data: ReadonlyArray<{ [K in 'fooUsd']: number }>
}`,
  'promiseMapped.ts': `export type Totals = {
  data: Promise<{ [K in 'fooUsd']: number }>
}`,
  'genericMapped.ts': `export type Wrap<K extends 'fooUsd'> = { [P in K]: number }`,
  'genericUnionMapped.ts': `export type Wrap<K extends 'fooUsd' | 'barUsd'> = {
  [P in K]: number
}`,
  'recursiveMapped.ts': `export type Totals = {
  next?: Totals
  data: { [K in 'fooUsd']: number }
}`,
  'remapGeneric.ts': "export type Wrap<K extends 'foo'> = { [P in K as `${P}Usd`]: number }",
  'remapWrapper.ts': `export type Wrap<K extends 'foo'> = { [P in K as \`\${P}Usd\`]: number }
export type Holding = { data: Wrap<'foo'> }`,
  'recordWrapper.ts': `export type Totals = { data: Record<'fooUsd', number> }`,
  'remapInline.ts': `export type Totals = { data: { [P in 'foo' as \`\${P}Usd\`]: number } }`,
  'plainWrapper.ts': `export type Totals = { data: { fooUsd: number } }`,
  'nonMoneyWrapper.ts': `export type Totals = { data: Record<'count', number> }`,
  'recursiveWrapper.ts': `export interface Chain {
  next?: Chain
  data: Record<'fooUsd', number>
}`,
  'recursiveGeneric.ts': `export type Chain<T> = {
  next?: Chain<T[]>
  data: Record<'fooUsd', number>
}`,
  'mutualGeneric.ts': `export type A<T> = { b?: B<T[]> }
export type B<T> = { a?: A<T>; costUsd: number }`,
  'recursiveGenericInterface.ts': `export interface Chain<T> {
  next?: Chain<T[]>
  data: Record<'fooUsd', number>
}`,
  // M121F round 3 (RVM121F2): finite nesting of one generic, sibling order,
  // the depth bound itself, branching recursion and recursive holdings.
  'nestedFinite.ts': `export type Box<T> = { data: T }
export type Holding = { nested: Box<Box<Record<'fooUsd', number>>> }`,
  'siblingDeepFirst.ts': `export type Box<T> = { data: T }
export type Holding = {
  deep: Box<Box<Record<'fooUsd', number>>>
  shallow: Box<Record<'fooUsd', number>>
}`,
  'siblingShallowFirst.ts': `export type Box<T> = { data: T }
export type Holding = {
  shallow: Box<Record<'fooUsd', number>>
  deep: Box<Box<Record<'fooUsd', number>>>
}`,
  'siblingInterfaceFirst.ts': `export interface Box<T> {
  next?: Box<number>
  data: Record<'fooUsd', T>
}
export type Holding = { first: Box<string>; second: Box<number> }`,
  'siblingInterfaceSecond.ts': `export interface Box<T> {
  next?: Box<number>
  data: Record<'fooUsd', T>
}
export type Holding = { second: Box<number>; first: Box<string> }`,
  // `Money` sits exactly at the bound through `far` and one level down
  // through `near`: a walk that let the first path it met decide would lose
  // `fooUsd` when `far` comes first.
  'boundShared.ts': `export type Box<T> = { data: T }
export type Money = { inner: { fooUsd: number } }`,
  'boundFarFirst.ts': `import type { Box, Money } from './boundShared'
export type Holding = { far: ${boxed(MAX_TYPE_DEPTH - 1, 'Money')}; near: Money }`,
  'boundNearFirst.ts': `import type { Box, Money } from './boundShared'
export type Holding = { near: Money; far: ${boxed(MAX_TYPE_DEPTH - 1, 'Money')} }`,
  'depthAtBound.ts': `export type Box<T> = { data: T }
export type Holding = { nested: ${boxed(MAX_TYPE_DEPTH - 1, "Record<'fooUsd', number>")} }`,
  'depthPastBound.ts': `export type Box<T> = { data: T }
export type Holding = { nested: ${boxed(MAX_TYPE_DEPTH, "Record<'fooUsd', number>")} }`,
  'branchingGeneric.ts': `export type Tree<T> = {
  left?: Tree<T[]>
  right?: Tree<[T]>
  data: Record<'fooUsd', number>
}`,
  'recursiveHolding.ts': `export type Chain<T> = { next?: Chain<T[]>; label: string }
export type Tally<T> = { next?: Tally<T[]>; count: number }
export interface Totals {
  fooUsd: Chain<string>
  barUsd: Tally<string>
}`,
  'exactNestedMapped.ts': `import type { UsdAmount } from '../../../src/shared/usdSchema'
export type Totals = {
  data: ReadonlyArray<{ [K in 'fooUsd']: UsdAmount }> | Promise<{ [K in 'barUsd']: UsdAmount }>
}
export type Wrap<K extends 'fooUsd'> = { [P in K]: UsdAmount }`,
  'exactMapped.ts': `import type { UsdAmount } from '../../../src/shared/usdSchema'
export type Totals = Record<'fooUsd', UsdAmount> | { kind: 'none' }
export type Both = Record<'barUsd', UsdAmount> & { kind: 'money' }
export interface Base extends Record<'bazUsd', UsdAmount> {}
export interface Inherited extends Base {}
export interface Generic<T extends UsdAmount> { readonly exactUsd: T }`,
  'pipeAlias.ts': `import * as z from 'zod/mini'
const amount = z.pipe(z.number(), z.number())
export const schema = z.object({ nested: z.object({ fooUsd: amount }) })`,
  'numericBase.ts': `import * as z from 'zod/mini'
export const externalNumeric = z.number().check(z.nonnegative())`,
  'numericReexport.ts': `export { externalNumeric as reexportedNumeric } from './numericBase'`,
  'importedOptional.ts': `import * as z from 'zod/mini'
import { reexportedNumeric } from './numericReexport'
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
      const unresolved = planProblem(entry.plan)
      if (unresolved !== undefined)
        problems.push(`${id}: sanctioned entry without a PLAN citation (${unresolved})`)
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

  it('flags a finite-key record and a mapped money property (RVM121A P3-3)', () => {
    expect(probe('finiteRecord.ts')).toEqual(['finiteRecord.ts:fooUsd'])
    expect(probe('mappedMoney.ts')).toEqual(['mappedMoney.ts:fooUsd'])
  })

  it.each([
    'unionMapped.ts',
    'intersectionMapped.ts',
    'inheritedMapped.ts',
    'inheritedBase.ts',
    'apparentMapped.ts',
    'apparentValue.ts',
    'apparentNumber.ts',
    'nestedUnion.ts',
  ])('flags resolved money in %s (RVM121B)', (file) => {
    expect(probe(file)).toEqual([`${file}:fooUsd`])
  })

  it('leaves exact mapped unions, intersections and inherited interfaces alone', () => {
    expect(probe('exactMapped.ts')).toEqual([])
  })

  it.each([
    'nestedMapped.ts',
    'arrayMapped.ts',
    'promiseMapped.ts',
    'genericMapped.ts',
    'recursiveMapped.ts',
  ])('flags money mapped beneath ordinary names or generic keys in %s (RVM121CG)', (file) => {
    expect(probe(file)).toEqual([`${file}:fooUsd`])
  })

  it('flags each possible generic mapped money key', () => {
    expect(probe('genericUnionMapped.ts')).toEqual([
      'genericUnionMapped.ts:barUsd',
      'genericUnionMapped.ts:fooUsd',
    ])
  })

  it.each(['remapGeneric.ts', 'remapWrapper.ts', 'remapInline.ts'])(
    'flags a remapped money key in %s (RVM121DC P3)',
    (file) => {
      expect(probe(file)).toEqual([`${file}:fooUsd`])
    },
  )

  it('flags lib-declared mapped money beneath an ordinary wrapper (RVM121DC P3)', () => {
    expect(probe('recordWrapper.ts')).toEqual(['recordWrapper.ts:fooUsd'])
    expect(probe('plainWrapper.ts')).toEqual(['plainWrapper.ts:fooUsd'])
    expect(probe('nonMoneyWrapper.ts')).toEqual([])
  })

  it('terminates on a recursive wrapper and still flags its money', () => {
    expect(probe('recursiveWrapper.ts')).toEqual(['recursiveWrapper.ts:fooUsd'])
  })

  it('terminates on a recursive generic and still flags its money (RVM121F)', () => {
    expect(probe('recursiveGeneric.ts')).toEqual(['recursiveGeneric.ts:fooUsd'])
  })

  it('terminates on mutually recursive generics and still flags their money (RVM121F)', () => {
    expect(probe('mutualGeneric.ts')).toEqual(['mutualGeneric.ts:costUsd'])
  })

  it('terminates on a recursive generic interface and still flags its money (RVM121F)', () => {
    expect(probe('recursiveGenericInterface.ts')).toEqual(['recursiveGenericInterface.ts:fooUsd'])
  })

  it('judges finite nesting of one generic (RVM121F2)', () => {
    expect(probe('nestedFinite.ts')).toEqual(['nestedFinite.ts:fooUsd'])
  })

  it.each([
    'siblingDeepFirst.ts',
    'siblingShallowFirst.ts',
    'siblingInterfaceFirst.ts',
    'siblingInterfaceSecond.ts',
    'boundFarFirst.ts',
    'boundNearFirst.ts',
  ])('flags money whichever sibling comes first in %s (RVM121F2)', (file) => {
    expect(probe(file)).toEqual([`${file}:fooUsd`])
  })

  it('judges money at MAX_TYPE_DEPTH and stops past it (the documented limit)', () => {
    expect(probe('depthAtBound.ts')).toEqual(['depthAtBound.ts:fooUsd'])
    expect(probe('depthPastBound.ts')).toEqual([])
  })

  it('terminates on a branching recursive generic and still flags its money', () => {
    expect(probe('branchingGeneric.ts')).toEqual(['branchingGeneric.ts:fooUsd'])
  })

  it('terminates when a money key holds a recursive generic, judging its numbers', () => {
    expect(probe('recursiveHolding.ts')).toEqual(['recursiveHolding.ts:barUsd'])
  })

  it('leaves nested and generic mapped exact money alone', () => {
    expect(probe('exactNestedMapped.ts')).toEqual([])
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
