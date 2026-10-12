// Provider-reported spend (PROVSPEND, 2026-10-12): what the provider
// itself says was spent, shown NEXT TO our own estimate, never blended
// with it and never feeding a cap. Pure data, request specs, strict
// parsers, exact money, the pagination bound, the once-a-minute floor and
// the reconciliation text. No fetch, no clock and no secret store here:
// the caller supplies a page fetcher over its pinned, proxy-aware
// transport, so unit tests fake the wire and no test needs loopback.
//
// UNVERIFIED (lane brief 2026-10-12): every wire shape below comes from
// the lead's documentation research, not a live capture (AGENTS.md rule
// 13 needs a capture before a shape is trusted). A live capture by the
// lead must confirm each request line and each field name; the
// certification (`docs/certification/provider-spend.md`) lists exactly
// what to check per provider.

import * as z from 'zod/mini'
import { HTTP_STATUS, UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime, formatNumber } from '../../shared/l10n/text'
import { formatUsd, parseUsd } from '../../shared/accountUsd'
import { Usd } from '../../shared/usd'
import type { ProviderSpendCapability } from './presets'
import {
  isSpendFailure,
  openRouterSpendReport,
  unreadable,
  type SpendFailure,
} from './providerSpendKeyUsage'

/** Which key a capability's report request must ride. */
export type SpendKeyKind = 'inference' | 'admin'

/** An admin key reads a whole organisation: it must never ride a model request. */
export function spendKeyKindFor(capability: ProviderSpendCapability): SpendKeyKind {
  return capability === 'admin-report' ? 'admin' : 'inference'
}

/** The most pages one report fetch follows; stated, bounded, never looped. */
export const SPEND_PAGE_BOUND = 20

/** Read-only report requests never outrun the provider's polling limit. */
export const SPEND_POLL_FLOOR_MS = 60_000

/**
 * One read-only GET the caller sends over its pinned transport. The key
 * rides the transport's auth source (`auth`), never a caller header: the
 * transport strips credential headers from caller input and only the pin
 * decides the origin, so the key goes nowhere else.
 */
export interface SpendHttpRequest {
  readonly url: string
  readonly method: 'GET'
  /** Non-credential headers only (the provider's version header). */
  readonly headers: Readonly<Record<string, string>>
  readonly auth: { readonly scheme: 'bearer' | 'x-api-key'; readonly key: string }
  /** The origin the caller's pin must allow; the key goes nowhere else. */
  readonly origin: string
}

/** Fixed sentences: a failure never leaks status bodies or key material. */
export function spendFailureText(failure: SpendFailure, provider: string): string {
  switch (failure.kind) {
    case 'wrong-key-kind': {
      return fill(UI_TEXT.accounts.spendAdminMissing, { provider })
    }
    case 'plan-unavailable': {
      return UI_TEXT.accounts.spendPlanUnavailable
    }
    case 'refused': {
      return UI_TEXT.accounts.spendRefused
    }
    case 'unreadable': {
      return fill(UI_TEXT.accounts.spendUnreadable, { kind: failure.kind })
    }
    case 'unreachable': {
      return UI_TEXT.providerProbeUnreachable
    }
  }
}

/**
 * The documented request lines (UNVERIFIED shapes, see the header).
 * Anthropic: `GET {origin}/v1/organizations/usage_report/messages` and
 * `GET {origin}/v1/organizations/cost_report` with
 * `anthropic-version: 2023-06-01`; the key rides the `x-api-key` auth
 * source (the transport strips credential headers from caller input).
 */
export function anthropicSpendRequests(input: {
  readonly origin: string
  readonly key: string
  readonly startingAt: string
  readonly endingAt: string
  readonly page?: string | undefined
}): readonly [SpendHttpRequest, SpendHttpRequest] {
  const headers = { 'anthropic-version': '2023-06-01' }
  const auth = { scheme: 'x-api-key' as const, key: input.key }
  const query = new URLSearchParams({
    starting_at: input.startingAt,
    ending_at: input.endingAt,
    bucket_width: '1d',
  })
  if (input.page !== undefined) query.set('page', input.page)
  const usage = `${input.origin}/v1/organizations/usage_report/messages?${query.toString()}`
  return [
    { url: usage, method: 'GET', headers, auth, origin: input.origin },
    {
      url: `${input.origin}/v1/organizations/cost_report?${query.toString()}`,
      method: 'GET',
      headers,
      auth,
      origin: input.origin,
    },
  ]
}

/**
 * OpenAI: `GET {origin}/v1/organization/usage/completions` and
 * `GET {origin}/v1/organization/costs` with a bearer auth source.
 * Costs bucket by day only; both pages carry a page cursor (UNVERIFIED).
 */
export function openAiSpendRequests(input: {
  readonly origin: string
  readonly key: string
  readonly startTime: string
  readonly endTime: string
  readonly page?: string | undefined
}): readonly [SpendHttpRequest, SpendHttpRequest] {
  const headers: Readonly<Record<string, string>> = {}
  const auth = { scheme: 'bearer' as const, key: input.key }
  const usageQuery = new URLSearchParams({ start_time: input.startTime, end_time: input.endTime })
  const costQuery = new URLSearchParams({
    start_time: input.startTime,
    end_time: input.endTime,
    bucket_width: '1d',
  })
  if (input.page !== undefined) {
    usageQuery.set('page', input.page)
    costQuery.set('page', input.page)
  }
  return [
    {
      url: `${input.origin}/v1/organization/usage/completions?${usageQuery.toString()}`,
      method: 'GET',
      headers,
      auth,
      origin: input.origin,
    },
    {
      url: `${input.origin}/v1/organization/costs?${costQuery.toString()}`,
      method: 'GET',
      headers,
      auth,
      origin: input.origin,
    },
  ]
}

/** OpenRouter: `GET {origin}/api/v1/key` with the inference key (captured D74). */
export function openRouterSpendRequest(input: {
  readonly origin: string
  readonly key: string
}): SpendHttpRequest {
  return {
    url: `${input.origin}/api/v1/key`,
    method: 'GET',
    headers: {},
    auth: { scheme: 'bearer', key: input.key },
    origin: input.origin,
  }
}

/** DeepSeek: `GET {origin}/user/balance` with the inference key (UNVERIFIED). */
export function deepSeekSpendRequest(input: {
  readonly origin: string
  readonly key: string
}): SpendHttpRequest {
  return {
    url: `${input.origin}/user/balance`,
    method: 'GET',
    headers: {},
    auth: { scheme: 'bearer', key: input.key },
    origin: input.origin,
  }
}

// --- Strict parsers (unknown fields ignored; a missing required field is
// unreadable, never a zero). Money stays exact: Anthropic cents strings and
// DeepSeek decimal strings never pass through a float.

const safeCount = z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0))
const isoDate = z.string().check(z.minLength(1))
const centsText = z.string().check(z.refine((value) => /^-?\d+$/.test(value)))
const decimalText = z.string().check(z.minLength(1))

function isFiniteDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/** One provider-reported model row: tokens the provider counted. */
export interface SpendModelRow {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
}

/** One provider-reported day: dollars the provider counted. */
export interface SpendDayRow {
  readonly day: string
  readonly usd: string
}

/**
 * The shared shape every capability renders through (display and
 * reconciliation only: it carries no threshold, cap or budget field, so no
 * budget decision can read it).
 */
export type ProviderSpendReport =
  | {
      readonly capability: 'key-usage'
      readonly provider: string
      readonly asOf: string
      readonly usedTodayUsd: string
      readonly usedThisWeekUsd: string
      readonly usedThisMonthUsd: string
      readonly limitUsd?: string | undefined
      readonly remainingUsd?: string | undefined
    }
  | {
      readonly capability: 'balance'
      readonly provider: string
      readonly asOf: string
      readonly balances: readonly {
        readonly currency: string
        readonly total: string
        readonly granted: string
        readonly toppedUp: string
      }[]
    }
  | {
      readonly capability: 'admin-report'
      readonly provider: string
      readonly asOf: string
      readonly tokensByModel: readonly SpendModelRow[]
      readonly dollarsByDay: readonly SpendDayRow[]
      readonly totalUsd: string
    }

// Anthropic usage buckets (UNVERIFIED field names): token counts with an
// optional model attribution; pagination via `has_more` + `next_page`.
const anthropicUsageBucket = z.object({
  model: z.optional(z.string()),
  description: z.optional(z.string()),
  starting_at: isoDate,
  ending_at: isoDate,
  uncached_input_tokens: safeCount,
  cache_read_input_tokens: z.optional(safeCount),
  cache_creation_input_tokens: z.optional(safeCount),
  output_tokens: safeCount,
})
const anthropicUsagePage = z.object({
  data: z.array(anthropicUsageBucket),
  has_more: z.optional(z.boolean()),
  next_page: z.optional(z.string()),
})

// Anthropic cost buckets (UNVERIFIED field names): daily USD as decimal
// strings in cents; Priority Tier cost is not in this endpoint.
const anthropicCostBucket = z.object({
  starting_at: isoDate,
  ending_at: z.optional(isoDate),
  workspace_id: z.optional(z.string()),
  description: z.optional(z.string()),
  amount: centsText,
  currency: z.optional(z.string()),
})
const anthropicCostPage = z.object({
  data: z.array(anthropicCostBucket),
  has_more: z.optional(z.boolean()),
  next_page: z.optional(z.string()),
})

// OpenAI usage buckets (UNVERIFIED field names): token and request counts.
const openAiUsageBucket = z.object({
  model: z.optional(z.string()),
  project_id: z.optional(z.string()),
  start_time: z.optional(isoDate),
  end_time: z.optional(isoDate),
  input_tokens: safeCount,
  output_tokens: safeCount,
  num_model_requests: z.optional(safeCount),
})
const openAiUsagePage = z.object({
  data: z.array(openAiUsageBucket),
  has_more: z.optional(z.boolean()),
  next_page: z.optional(z.string()),
})

// OpenAI costs (UNVERIFIED field names): `results[].amount.value` with
// `currency: "usd"`, a line item and a project id; daily buckets only.
const openAiCostLine = z.object({
  line_item: z.optional(z.string()),
  project_id: z.optional(z.string()),
  amount: z.object({ value: z.union([decimalText, z.number()]), currency: z.string() }),
})
const openAiCostPage = z.object({
  results: z.array(openAiCostLine),
  has_more: z.optional(z.boolean()),
  next_page: z.optional(z.string()),
})

// OpenRouter key body (field names from the D74 capture,
// `docs/certification/m95-captures.md`: `limit`, `limit_remaining` and
// `usage` with its daily, weekly and monthly parts). Amounts are dollars as
// counted by the existing key-usage read; a `null` limit is no limit.
// UNVERIFIED: the capture does not say whether the month reads `usage` or
// `usage_monthly`, so the read takes `usage_monthly`; the lead's live
// capture must confirm it.
const openRouterKeyBody = z.object({
  data: z.object({
    limit: z.union([z.number(), z.null()]),
    limit_remaining: z.union([z.number(), z.null()]),
    usage: z.number(),
    usage_daily: z.number(),
    usage_weekly: z.number(),
    usage_monthly: z.number(),
  }),
})

/**
 * Parse an OpenRouter key body into the validated key-usage snapshot the
 * existing read produces. Unknown fields are ignored; a missing or
 * non-numeric amount is unreadable.
 */
export function parseOpenRouterKeyBody(body: unknown):
  | SpendFailure
  | {
      readonly usedToday: number
      readonly usedThisWeek: number
      readonly usedThisMonth: number
      readonly limit?: number | undefined
      readonly remaining?: number | undefined
    } {
  const parsed = z.safeParse(openRouterKeyBody, body)
  if (!parsed.success) return unreadable()
  const numbers = [
    parsed.data.data.usage_daily,
    parsed.data.data.usage_weekly,
    parsed.data.data.usage_monthly,
  ]
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return unreadable()
  const limit = parsed.data.data.limit
  const remaining = parsed.data.data.limit_remaining
  if (
    (limit !== null && (!Number.isFinite(limit) || limit < 0)) ||
    (remaining !== null && (!Number.isFinite(remaining) || remaining < 0))
  )
    return unreadable()
  return {
    usedToday: parsed.data.data.usage_daily,
    usedThisWeek: parsed.data.data.usage_weekly,
    usedThisMonth: parsed.data.data.usage_monthly,
    ...(limit !== null && { limit }),
    ...(remaining !== null && { remaining }),
  }
}

// DeepSeek balance (UNVERIFIED field names): availability plus per-currency
// balances as decimal strings.
const deepSeekBalanceBody = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(
    z.object({
      currency: z.string().check(z.minLength(1)),
      total_balance: decimalText,
      granted_balance: decimalText,
      topped_up_balance: decimalText,
    }),
  ),
})

function centsToUsd(cents: string): string {
  return Usd.fromUnits(BigInt(cents), 2).toString()
}

function valueToUsd(value: string | number, currency: string): string | SpendFailure {
  if (currency.toLowerCase() !== 'usd') return unreadable()
  // Exact decimal text only: a malformed amount is unreadable, and no value
  // passes through a binary float.
  try {
    return Usd.from(value).toString()
  } catch {
    return unreadable()
  }
}

function decimalToUsd(value: string): string | SpendFailure {
  try {
    return Usd.from(value).toString()
  } catch {
    return unreadable()
  }
}

/** Parse one Anthropic usage page; a missing field is `unreadable`, never a zero. */
export function parseAnthropicUsagePage(
  body: unknown,
):
  | SpendFailure
  | { readonly rows: readonly SpendModelRow[]; readonly nextPage: string | undefined } {
  const parsed = z.safeParse(anthropicUsagePage, body)
  if (!parsed.success) return unreadable()
  const rows: SpendModelRow[] = []
  for (const bucket of parsed.data.data) {
    if (!isFiniteDate(bucket.starting_at) || !isFiniteDate(bucket.ending_at)) return unreadable()
    const cached = (bucket.cache_read_input_tokens ?? 0) + (bucket.cache_creation_input_tokens ?? 0)
    rows.push({
      model: bucket.model ?? bucket.description ?? 'unknown',
      inputTokens: bucket.uncached_input_tokens + cached,
      outputTokens: bucket.output_tokens,
    })
  }
  return {
    rows,
    nextPage: parsed.data.has_more === true ? (parsed.data.next_page ?? undefined) : undefined,
  }
}

/** Parse one Anthropic cost page (cents strings to exact dollars). */
export function parseAnthropicCostPage(body: unknown):
  | SpendFailure
  | {
      readonly days: readonly SpendDayRow[]
      readonly totalUsd: string
      readonly nextPage: string | undefined
    } {
  const parsed = z.safeParse(anthropicCostPage, body)
  if (!parsed.success) return unreadable()
  const days: SpendDayRow[] = []
  let total = Usd.from(0)
  for (const bucket of parsed.data.data) {
    if (!isFiniteDate(bucket.starting_at)) return unreadable()
    if (bucket.currency !== undefined && bucket.currency.toLowerCase() !== 'usd')
      return unreadable()
    const usd = centsToUsd(bucket.amount)
    total = total.add(Usd.from(usd))
    days.push({ day: bucket.starting_at, usd })
  }
  return {
    days,
    totalUsd: total.toString(),
    nextPage: parsed.data.has_more === true ? (parsed.data.next_page ?? undefined) : undefined,
  }
}

/** Parse one OpenAI usage page. */
export function parseOpenAiUsagePage(
  body: unknown,
):
  | SpendFailure
  | { readonly rows: readonly SpendModelRow[]; readonly nextPage: string | undefined } {
  const parsed = z.safeParse(openAiUsagePage, body)
  if (!parsed.success) return unreadable()
  return {
    rows: parsed.data.data.map((bucket) => ({
      model: bucket.model ?? bucket.project_id ?? 'unknown',
      inputTokens: bucket.input_tokens,
      outputTokens: bucket.output_tokens,
    })),
    nextPage: parsed.data.has_more === true ? (parsed.data.next_page ?? undefined) : undefined,
  }
}

/** Parse one OpenAI cost page (`value` + `currency`, no float math). */
export function parseOpenAiCostPage(body: unknown):
  | SpendFailure
  | {
      readonly days: readonly SpendDayRow[]
      readonly totalUsd: string
      readonly nextPage: string | undefined
    } {
  const parsed = z.safeParse(openAiCostPage, body)
  if (!parsed.success) return unreadable()
  let total = Usd.from(0)
  const days: SpendDayRow[] = []
  for (const line of parsed.data.results) {
    const usd = valueToUsd(line.amount.value, line.amount.currency)
    if (isSpendFailure(usd)) return usd
    total = total.add(Usd.from(usd))
    days.push({ day: line.line_item ?? line.project_id ?? 'unknown', usd })
  }
  return {
    days,
    totalUsd: total.toString(),
    nextPage: parsed.data.has_more === true ? (parsed.data.next_page ?? undefined) : undefined,
  }
}

/** Parse a DeepSeek balance body. */
export function parseDeepSeekBalance(body: unknown):
  | SpendFailure
  | {
      readonly isAvailable: boolean
      readonly balances: readonly {
        readonly currency: string
        readonly total: string
        readonly granted: string
        readonly toppedUp: string
      }[]
    } {
  const parsed = z.safeParse(deepSeekBalanceBody, body)
  if (!parsed.success) return unreadable()
  const balances: {
    readonly currency: string
    readonly total: string
    readonly granted: string
    readonly toppedUp: string
  }[] = []
  for (const entry of parsed.data.balance_infos) {
    // Decimal strings stay exact end to end; a malformed amount is
    // unreadable instead of a float-rounded figure.
    const total = decimalToUsd(entry.total_balance)
    if (isSpendFailure(total)) return total
    const granted = decimalToUsd(entry.granted_balance)
    if (isSpendFailure(granted)) return granted
    const toppedUp = decimalToUsd(entry.topped_up_balance)
    if (isSpendFailure(toppedUp)) return toppedUp
    balances.push({ currency: entry.currency, total, granted, toppedUp })
  }
  return { isAvailable: parsed.data.is_available, balances }
}

// --- Fetch orchestration (the caller owns transport, pinning and deadline)

export interface SpendPage {
  readonly status: number
  readonly body: unknown
}

/** One page over the caller's pinned transport; never retried in a loop. */
export type SpendFetcher = (request: SpendHttpRequest) => Promise<SpendPage>

/**
 * Map an HTTP answer to a failure. A 403 names the plan only when the body
 * says the account cannot offer the report API (UNVERIFIED signal: the
 * documented "Admin API is unavailable for individual accounts"); any other
 * refusal stays "refused". Nothing here guesses beyond the response.
 */
export function spendHttpFailure(status: number, body: unknown): SpendFailure {
  return {
    kind:
      status === HTTP_STATUS.forbidden && hasIndividualAccountSignal(body)
        ? 'plan-unavailable'
        : 'refused',
  }
}

function hasIndividualAccountSignal(body: unknown): boolean {
  if (typeof body === 'string') return /individual account/i.test(body)
  if (typeof body === 'object' && body !== null) {
    const seen = JSON.stringify(body)
    return /individual account/i.test(seen)
  }
  return false
}

function sumRows(rows: readonly SpendModelRow[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const row of rows) {
    input += row.inputTokens
    output += row.outputTokens
    if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output))
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  }
  return { input, output }
}

/**
 * Fetch a full admin report: usage pages then cost pages, each to
 * `SPEND_PAGE_BOUND`. Returns the report or the first failure. The key-kind
 * gate runs before any request: an inference key never reaches an admin
 * endpoint and an admin key never rides a key-usage or balance request.
 */
export async function fetchAdminSpendReport(input: {
  readonly fetch: SpendFetcher
  readonly provider: 'anthropic' | 'openai'
  readonly origin: string
  readonly key: string
  readonly keyKind: SpendKeyKind
  readonly startingAt: string
  readonly endingAt: string
  readonly asOf: string
}): Promise<ProviderSpendReport | SpendFailure> {
  if (input.keyKind !== 'admin') return { kind: 'wrong-key-kind' }
  const rows: SpendModelRow[] = []
  const days: SpendDayRow[] = []
  let total = Usd.from(0)
  let page: string | undefined
  for (let seen = 0; seen < SPEND_PAGE_BOUND; seen += 1) {
    const [usageRequest] =
      input.provider === 'anthropic'
        ? anthropicSpendRequests({
            origin: input.origin,
            key: input.key,
            startingAt: input.startingAt,
            endingAt: input.endingAt,
            ...(page !== undefined && { page }),
          })
        : openAiSpendRequests({
            origin: input.origin,
            key: input.key,
            startTime: input.startingAt,
            endTime: input.endingAt,
            ...(page !== undefined && { page }),
          })
    let answer: SpendPage
    try {
      answer = await input.fetch(usageRequest)
    } catch {
      return { kind: 'unreachable' }
    }
    if (answer.status !== HTTP_STATUS.ok) return spendHttpFailure(answer.status, answer.body)
    const parsed =
      input.provider === 'anthropic'
        ? parseAnthropicUsagePage(answer.body)
        : parseOpenAiUsagePage(answer.body)
    if (isSpendFailure(parsed)) return parsed
    rows.push(...parsed.rows)
    page = parsed.nextPage
    if (page === undefined) break
  }
  let costPage: string | undefined
  for (let seen = 0; seen < SPEND_PAGE_BOUND; seen += 1) {
    const [, costRequest] =
      input.provider === 'anthropic'
        ? anthropicSpendRequests({
            origin: input.origin,
            key: input.key,
            startingAt: input.startingAt,
            endingAt: input.endingAt,
            ...(costPage !== undefined && { page: costPage }),
          })
        : openAiSpendRequests({
            origin: input.origin,
            key: input.key,
            startTime: input.startingAt,
            endTime: input.endingAt,
            ...(costPage !== undefined && { page: costPage }),
          })
    let answer: SpendPage
    try {
      answer = await input.fetch(costRequest)
    } catch {
      return { kind: 'unreachable' }
    }
    if (answer.status !== HTTP_STATUS.ok) return spendHttpFailure(answer.status, answer.body)
    const parsed =
      input.provider === 'anthropic'
        ? parseAnthropicCostPage(answer.body)
        : parseOpenAiCostPage(answer.body)
    if (isSpendFailure(parsed)) return parsed
    days.push(...parsed.days)
    total = total.add(Usd.from(parsed.totalUsd))
    costPage = parsed.nextPage
    if (costPage === undefined) break
  }
  return {
    capability: 'admin-report',
    provider: input.provider,
    asOf: input.asOf,
    tokensByModel: rows,
    dollarsByDay: days,
    totalUsd: total.toString(),
  }
}

/**
 * Fetch an OpenRouter key-usage report through the existing validated read:
 * the inference key reads its own usage, and an admin key is refused before
 * any request. The validated snapshot becomes the first shared-shape report.
 */
export async function fetchKeyUsageSpendReport(input: {
  readonly read: (key: string) => Promise<{
    readonly usedToday: number
    readonly usedThisWeek: number
    readonly usedThisMonth: number
    readonly limit?: number | undefined
    readonly remaining?: number | undefined
  }>
  readonly key: string
  readonly keyKind: SpendKeyKind
  readonly asOf: string
}): Promise<ProviderSpendReport | SpendFailure> {
  if (input.keyKind !== 'inference') return { kind: 'wrong-key-kind' }
  let snapshot: Awaited<ReturnType<typeof input.read>>
  try {
    snapshot = await input.read(input.key)
  } catch {
    return { kind: 'unreachable' }
  }
  return openRouterSpendReport(snapshot, input.asOf)
}

/** Fetch a DeepSeek balance report; the inference key reads its own balance. */
export async function fetchBalanceSpendReport(input: {
  readonly fetch: SpendFetcher
  readonly origin: string
  readonly key: string
  readonly keyKind: SpendKeyKind
  readonly asOf: string
}): Promise<ProviderSpendReport | SpendFailure> {
  if (input.keyKind !== 'inference') return { kind: 'wrong-key-kind' }
  let answer: SpendPage
  try {
    answer = await input.fetch(deepSeekSpendRequest({ origin: input.origin, key: input.key }))
  } catch {
    return { kind: 'unreachable' }
  }
  if (answer.status !== HTTP_STATUS.ok) return spendHttpFailure(answer.status, answer.body)
  const parsed = parseDeepSeekBalance(answer.body)
  if (isSpendFailure(parsed)) return parsed
  return {
    capability: 'balance',
    provider: 'deepseek',
    asOf: input.asOf,
    balances: parsed.balances,
  }
}

/**
 * The once-a-minute floor: at most one report fetch per account per floor,
 * across every surface (a manual refresh obeys the same floor). The clock is
 * injected so tests own time.
 */
export class SpendThrottle {
  private readonly lastFetch = new Map<string, number>()
  public constructor(private readonly now: () => number = Date.now) {}
  /** True when a fetch may start; records the start. False serves the cache. */
  public take(account: string): boolean {
    const at = this.now()
    const last = this.lastFetch.get(account)
    if (last !== undefined && at - last < SPEND_POLL_FLOOR_MS) return false
    this.lastFetch.set(account, at)
    return true
  }
}

// --- Reconciliation text (display only; the two figures are never blended)

/**
 * Our own estimate for the same period the provider reported on. Token
 * counts stay absent when the journal did not record them: the comparison
 * then covers dollars only, never a zero.
 */
export interface SpendEstimate {
  readonly usd: string
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
}

/** A difference at or below rounding needs no sentence. */
export const SPEND_ROUNDING_USD = '0.01'

function money(value: string): string {
  return formatUsd(parseUsd(value))
}

/**
 * The provider's own figures for the period, labelled with the reporter and
 * the time, next to our estimate and the difference. Balance providers show
 * the balance with no comparison (there is no period to compare). A
 * `key-usage` report shows cumulative spend with no per-day dollars.
 */
export function spendReportLines(
  report: ProviderSpendReport,
  estimate: SpendEstimate | undefined,
  input: { readonly providerLabel: string; readonly catalogueDate: string },
): readonly string[] {
  const header = fill(UI_TEXT.accounts.spendReported, {
    provider: input.providerLabel,
    date: formatDateTime(Date.parse(report.asOf)),
  })
  if (report.capability === 'balance') {
    return [
      header,
      ...report.balances.map((entry) =>
        fill(UI_TEXT.accounts.spendBalance, {
          balance: `${entry.total} ${entry.currency}`,
        }),
      ),
    ]
  }
  if (report.capability === 'key-usage') {
    return [
      header,
      fill(UI_TEXT.accounts.spendKeyUsage, {
        today: money(report.usedTodayUsd),
        week: money(report.usedThisWeekUsd),
        month: money(report.usedThisMonthUsd),
      }),
      ...(report.limitUsd === undefined && report.remainingUsd === undefined
        ? []
        : [
            fill(UI_TEXT.accounts.spendKeyLimit, {
              limit:
                report.limitUsd === undefined
                  ? UI_TEXT.accounts.usageUnavailable
                  : money(report.limitUsd),
              remaining:
                report.remainingUsd === undefined
                  ? UI_TEXT.accounts.usageUnavailable
                  : money(report.remainingUsd),
            }),
          ]),
    ]
  }
  const lines = [
    header,
    ...report.tokensByModel.map((row) =>
      fill(UI_TEXT.accounts.spendTokensByModel, {
        model: row.model,
        input: formatNumber(row.inputTokens),
        output: formatNumber(row.outputTokens),
      }),
    ),
    ...report.dollarsByDay.map((row) =>
      fill(UI_TEXT.accounts.spendDollarsByDay, { day: row.day, cost: money(row.usd) }),
    ),
  ]
  if (estimate === undefined) return lines
  const totals = sumRows(report.tokensByModel)
  lines.push(fill(UI_TEXT.accounts.spendEstimate, { cost: money(estimate.usd) }))
  if (estimate.inputTokens !== undefined && estimate.outputTokens !== undefined) {
    lines.push(
      fill(UI_TEXT.accounts.spendEstimateTokens, {
        input: formatNumber(estimate.inputTokens),
        output: formatNumber(estimate.outputTokens),
      }),
    )
  }
  const signed = Usd.from(report.totalUsd).subtract(Usd.from(estimate.usd))
  const magnitude = signed.compare(Usd.from(0)) < 0 ? Usd.from(0).subtract(signed) : signed
  const hasUsdDifference =
    signed.compare(Usd.from(0)) !== 0 && magnitude.compare(Usd.from(SPEND_ROUNDING_USD)) >= 0
  const hasTokenDifference =
    (estimate.inputTokens !== undefined && totals.input !== estimate.inputTokens) ||
    (estimate.outputTokens !== undefined && totals.output !== estimate.outputTokens)
  if (!hasUsdDifference && !hasTokenDifference) {
    lines.push(UI_TEXT.accounts.spendMatches)
    return lines
  }
  const reasons = [
    UI_TEXT.accounts.spendReasonShared,
    fill(UI_TEXT.accounts.spendReasonCatalogue, { date: input.catalogueDate }),
    ...(report.provider === 'anthropic' ? [UI_TEXT.accounts.spendReasonPriority] : []),
  ]
  lines.push(
    fill(UI_TEXT.accounts.spendDiffers, {
      reported: money(report.totalUsd),
      estimated: money(estimate.usd),
      difference: money(magnitude.toString()),
      reasons: reasons.join(' '),
    }),
  )
  return lines
}
