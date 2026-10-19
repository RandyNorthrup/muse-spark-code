import { UserRefusalError } from '../../core/refusal'
import { Usd, type UsdAmount } from '../../shared/usd'
import * as z from 'zod/mini'
import { modelPolicyFor, type ModelPolicy } from '../../core/backends/modelapi/modelPolicy'
import {
  EXEC_MAX_REQUESTS,
  EXEC_MIN_OUTPUT_TOKENS,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_MAX_OUTPUT_TOKENS,
  PAID_PRICES_USD,
  NON_BILLABLE_HTTP_REJECTIONS,
  UI_TEXT,
} from '../../shared/constants'
import type { LastResponse, LedgerTotals, Refusal, TokenTotals } from './execProtocol'

export interface TierPrice {
  readonly input: UsdAmount
  readonly cachedInput: UsdAmount
  readonly output: UsdAmount
}
/**
 * EXECPROV round 6: which input bound a ticket's reservation used. `exact`
 * is the provider's same-body count; `bytes-after-failure` is the byte bound
 * after an exact count was tried and failed. Absent is the legacy path, which
 * never tried an exact count.
 */
export type ResponseInputBound = 'exact' | 'estimate' | 'bytes-after-failure'
export interface ResponseTicket {
  readonly contextTokens?: number | undefined
  readonly n: number
  readonly kind: 'responses'
  readonly model: string
  readonly maxOutputTokens: number
  readonly reserveUsd: UsdAmount
  readonly price: TierPrice
  readonly inputBound?: ResponseInputBound | undefined
}
export interface ImageTicket {
  readonly n: number
  readonly kind: 'image'
  readonly endpoint: 'images.generations' | 'images.edits'
  readonly units: 1
  readonly reserveUsd: UsdAmount
}
export type ResponseSettlement =
  | {
      kind: 'eof'
      terminal: string | null
      incompleteReason: string | null
      usage: unknown
      parseInvalid: boolean
    }
  | { kind: 'http'; status: number }
  | {
      kind: 'transport'
      why: 'error' | 'aborted' | 'tooLarge' | 'malformed'
      terminal: string | null
      incompleteReason: string | null
      usage: unknown
    }
export type ImageSettlement =
  | { kind: 'returned'; count: unknown }
  | { kind: 'http'; status: number }
  | { kind: 'transport'; why: 'error' | 'aborted' | 'tooLarge' }
  | { kind: 'unparsable' }
export interface SettlementResult {
  outcome: 'priced' | 'full-reservation'
  chargedUsd: UsdAmount
  latch?: 'accounting_invalid' | 'breach'
}
/**
 * The run's one resolved output cap: the policy cap by default, lowered by an
 * explicit `--max-output-tokens` that never exceeds it. A resolved provider
 * policy always replaces the cached value: the first no-arg call runs before
 * model resolution, when `modelPolicyFor` has no provider evidence and can
 * only see the global Model API cap, while the model bind (`wrap`, through
 * `modelOutputMaxTokens`) and every request body carry the resolved policy.
 * Caching that first global would pin an oversized cap — and its reservation
 * — onto a model whose provider maximum is lower.
 */
export function createExecOutputCap(input: {
  readonly model: () => string | null
  readonly maxOutputTokens: number | undefined
}): (policy?: ModelPolicy) => number {
  let resolved: number | undefined
  return (policy?: ModelPolicy): number => {
    if (policy === undefined) {
      resolved ??= resolveExecOutputCap(modelPolicyFor(input.model() ?? ''))
    } else {
      resolved = resolveExecOutputCap(policy)
    }
    const flag = input.maxOutputTokens
    return flag === undefined ? resolved : Math.min(flag, resolved)
  }
}

/** Exec reserves the worst case before sending; its ceiling is a money policy. */
export function resolveExecOutputCap(policy?: Pick<ModelPolicy, 'output'>): number {
  const maximum = policy?.output.maxTokens
  const cap = Math.min(MODEL_API_MAX_OUTPUT_TOKENS, maximum ?? MODEL_API_MAX_OUTPUT_TOKENS)
  if (!Number.isSafeInteger(maximum ?? cap) || cap < EXEC_MIN_OUTPUT_TOKENS)
    throw new RangeError(UI_TEXT.execRequestShape)
  return cap
}

export interface RunLedger {
  readonly outputCap: number
  admitResponse(input: {
    model: string
    maxOutputTokens: number
    price: TierPrice
    readonly contextTokens?: number | undefined
    readonly reserveUsd?: UsdAmount | undefined
    readonly inputBound?: ResponseInputBound | undefined
  }): ResponseTicket | { refused: Refusal }
  admitImage(endpoint: 'images.generations' | 'images.edits'): ImageTicket | { refused: Refusal }
  /** A preflight refusal has no attempt to settle but remains typed in the record. */
  reject(reason: Refusal): void
  /** Withdraw a ticket that never reached dispatch, including its request count. */
  releaseResponse(ticket: ResponseTicket): void
  settleResponse(
    ticket: ResponseTicket,
    outcome: ResponseSettlement,
    pricing?: { readonly costUsd: UsdAmount | undefined },
  ): SettlementResult
  settleImage(ticket: ImageTicket, outcome: ImageSettlement): SettlementResult
  close(): void
  readonly lastResponse: LastResponse | null
  totals(): LedgerTotals
}

type ReservationQuote = { readonly amount: bigint } | { readonly refused: Refusal }

/** The worst-case reservation for one response, before any cap admission. */
function quoteReservation(input: {
  readonly model: string
  readonly maxOutputTokens: number
  readonly price: TierPrice
  readonly contextTokens?: number | undefined
  readonly reserveUsd?: UsdAmount | undefined
  readonly outputCap: number
}): ReservationQuote {
  const { maxOutputTokens: m, price } = input
  // A configured-provider id names no static floor (the record governs its
  // shape); every other model keeps the readable minimum.
  if (
    !Number.isSafeInteger(m) ||
    m < (input.model.includes('/') ? 1 : EXEC_MIN_OUTPUT_TOKENS) ||
    m > input.outputCap
  )
    return { refused: 'request_shape' }
  try {
    if (
      input.reserveUsd === undefined &&
      Usd.from(price.cachedInput).compare(Usd.from(price.input)) > 0
    )
      return { refused: 'unpriced' }
    return {
      amount:
        input.reserveUsd === undefined
          ? charge(price, MODEL_API_CONTEXT_WINDOW - m, m)
          : units(Usd.from(input.reserveUsd).toAmount()),
    }
  } catch {
    return { refused: 'unpriced' }
  }
}

function freezeResponseTicket(
  request: {
    readonly model: string
    readonly maxOutputTokens: number
    readonly price: TierPrice
    readonly contextTokens?: number | undefined
    readonly reserveUsd?: UsdAmount | undefined
  },
  amount: bigint,
  n: number,
): ResponseTicket {
  return Object.freeze({
    ...request,
    price: Object.freeze({ ...request.price }),
    kind: 'responses',
    n,
    reserveUsd: usd(amount),
  })
}

/**
 * Quote the start reservation without spending, consuming this run's request
 * count, or admitting it against the run cap: a valid low budget stays
 * quotable so the caller reports its own minimum, never an unpriced model.
 */
export function previewResponseReservation(
  ledger: RunLedger,
  model: string,
  price: TierPrice,
): ResponseTicket {
  const quoted = quoteReservation({
    model,
    maxOutputTokens: ledger.outputCap,
    price,
    outputCap: ledger.outputCap,
  })
  if ('refused' in quoted) throw new Error(UI_TEXT.execModelUnpriced)
  return freezeResponseTicket({ model, maxOutputTokens: ledger.outputCap, price }, quoted.amount, 1)
}
const ZERO = 0n
const ONE = 1n
const UNIT = BigInt(EXEC_USD_UNITS)
const counter = z.number().check(z.int(), z.gte(0), z.lte(Number.MAX_SAFE_INTEGER))
const usageSchema = z.object({
  input_tokens: counter,
  output_tokens: counter,
  total_tokens: z.optional(counter),
  input_tokens_details: z.optional(z.nullable(z.object({ cached_tokens: z.optional(counter) }))),
  output_tokens_details: z.optional(
    z.nullable(z.object({ reasoning_tokens: z.optional(counter) })),
  ),
})

function units(amount: UsdAmount): bigint {
  // A person's amount is honored as given: exact BigInt micro-USD with no
  // upper bound (only the provider's own tariff bounds a run). Negative input
  // is invalid, never a cap.
  const value = Usd.from(amount).units(EXEC_USD_DECIMALS)
  // Amounts ride as exact micro-USD BigInt; only a negative amount or one
  // past integer-precise range refuses (never a spending ceiling of ours).
  if (value < ZERO || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new UserRefusalError(UI_TEXT.execNumberInvalid, 'accounting_invalid')
  return value
}
function usd(value: bigint): UsdAmount {
  return Usd.fromUnits(value, EXEC_USD_DECIMALS).toAmount()
}
function ceiling(value: bigint): bigint {
  return (value + UNIT - ONE) / UNIT
}
function charge(price: TierPrice, input: number, output: number, cached = 0): bigint {
  return ceiling(
    BigInt(input - cached) * units(price.input) +
      BigInt(cached) * units(price.cachedInput) +
      BigInt(output) * units(price.output),
  )
}

export function createRunLedger(input: {
  capUsd: UsdAmount
  /** No request cap when the person set none. */
  maxRequests: number | undefined
  outputCap?: () => number
}): RunLedger {
  const outputCap = input.outputCap ?? (() => resolveExecOutputCap())
  const cap = units(input.capUsd)
  if (
    cap <= ZERO ||
    (input.maxRequests !== undefined &&
      (!Number.isSafeInteger(input.maxRequests) ||
        input.maxRequests < 1 ||
        input.maxRequests > EXEC_MAX_REQUESTS))
  )
    throw new UserRefusalError(UI_TEXT.execNumberInvalid, 'accounting_invalid')
  let requests = 0
  let settled = ZERO
  let uncertain = ZERO
  let active: ResponseTicket | ImageTicket | undefined
  let reserve = ZERO
  let isClosed = false
  let isBreach = false
  let refusal: Refusal | null = null
  let lastResponse: LastResponse | null = null
  const tokens: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
  }
  let imageAttempts = 0
  let imagesReturned = 0
  let imagesRefunded = 0
  let imagesUncertain = 0
  let paidSettled = ZERO
  let paidUncertain = ZERO
  const refuse = (reason: Refusal) => {
    refusal = reason
    return { refused: reason }
  }
  const admit = (amount: bigint): { refused: Refusal } | undefined => {
    if (isClosed) return refuse('closed')
    if (active !== undefined) throw new UserRefusalError(UI_TEXT.execRequestShape, 'request_shape')
    // No cap when the person set none: `requests >= undefined` is never true.
    if (input.maxRequests !== undefined && requests >= input.maxRequests) return refuse('requests')
    if (settled + uncertain + amount > cap) return refuse('budget')
    reserve = amount
    requests += 1
    return undefined
  }
  const take = (ticket: ResponseTicket | ImageTicket): bigint => {
    if (active !== ticket) throw new UserRefusalError(UI_TEXT.execRequestShape, 'request_shape')
    const amount = reserve
    active = undefined
    reserve = ZERO
    return amount
  }
  const finish = (
    amount: bigint,
    priced: bigint | undefined,
    latch?: SettlementResult['latch'],
  ): SettlementResult => {
    if (latch !== undefined) {
      isClosed = true
      isBreach ||= latch === 'breach'
    }
    if (priced === undefined) uncertain += amount
    else settled += priced
    return {
      outcome: priced === undefined ? 'full-reservation' : 'priced',
      chargedUsd: usd(priced ?? amount),
      ...(latch !== undefined && { latch }),
    }
  }
  return {
    get outputCap() {
      return outputCap()
    },
    admitResponse(request) {
      const quoted = quoteReservation({ ...request, outputCap: outputCap() })
      if ('refused' in quoted) return refuse(quoted.refused)
      const rejected = admit(quoted.amount)
      if (rejected !== undefined) return rejected
      active = freezeResponseTicket(request, quoted.amount, requests)
      lastResponse = null
      return active
    },
    admitImage(endpoint) {
      const amount = units(Usd.from(PAID_PRICES_USD.imageGeneration).toAmount())
      const rejected = admit(amount)
      if (rejected !== undefined) return rejected
      imageAttempts += 1
      active = Object.freeze({
        kind: 'image',
        endpoint,
        n: requests,
        units: 1,
        reserveUsd: usd(amount),
      })
      return active
    },
    reject(reason) {
      refuse(reason)
    },
    releaseResponse(ticket) {
      take(ticket)
      requests -= 1
    },
    settleResponse(ticket, outcome, pricing) {
      const amount = take(ticket)
      const terminal = outcome.kind === 'http' ? null : outcome.terminal
      const sample = outcome.kind === 'http' ? undefined : outcome.usage
      const parsed = usageSchema.safeParse(sample)
      let validity: LastResponse['usage'] = sample == null ? 'missing' : 'invalid'
      let priced: bigint | undefined
      let latch: SettlementResult['latch']
      if (parsed.success) {
        const u = parsed.data
        const cached = u.input_tokens_details?.cached_tokens ?? 0
        const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0
        const isConsistent =
          cached <= u.input_tokens &&
          reasoning <= u.output_tokens &&
          (u.total_tokens === undefined ||
            BigInt(u.total_tokens) === BigInt(u.input_tokens) + BigInt(u.output_tokens))
        if (isConsistent) {
          validity = 'valid'
          let cost =
            pricing === undefined
              ? charge(ticket.price, u.input_tokens, u.output_tokens, cached)
              : undefined
          if (pricing?.costUsd !== undefined) cost = units(pricing.costUsd)
          const contextTokens = ticket.contextTokens ?? MODEL_API_CONTEXT_WINDOW
          if (
            // A context no larger than the output limit leaves no input room
            // under context-minus-output; hold such a model to its context.
            u.input_tokens >
              (contextTokens > ticket.maxOutputTokens
                ? contextTokens - ticket.maxOutputTokens
                : contextTokens) ||
            u.output_tokens > ticket.maxOutputTokens ||
            (cost !== undefined && cost > amount)
          ) {
            latch = 'breach'
            if (cost !== undefined) priced = cost
          } else if (
            terminal !== null &&
            terminal !== 'in_progress' &&
            terminal !== 'queued' &&
            (outcome.kind !== 'eof' || !outcome.parseInvalid)
          )
            priced = cost
        }
      }
      if (outcome.kind === 'http' && NON_BILLABLE_HTTP_REJECTIONS.has(outcome.status))
        priced = pricing?.costUsd === undefined ? ZERO : units(pricing.costUsd)
      if (outcome.kind === 'eof' && outcome.parseInvalid) validity = 'invalid'
      if (validity === 'invalid' && latch === undefined) latch = 'accounting_invalid'
      if (validity === 'valid' && latch === undefined) {
        const u = parsed.success ? parsed.data : undefined
        if (u !== undefined) {
          tokens.inputTokens += u.input_tokens
          tokens.outputTokens += u.output_tokens
          tokens.cachedTokens += u.input_tokens_details?.cached_tokens ?? 0
          tokens.reasoningTokens += u.output_tokens_details?.reasoning_tokens ?? 0
        }
      }
      const result = finish(amount, priced, latch)
      lastResponse = {
        n: ticket.n,
        terminal,
        incompleteReason: outcome.kind === 'http' ? null : outcome.incompleteReason,
        endedWithoutTerminal: outcome.kind === 'eof' && terminal === null,
        httpStatus: outcome.kind === 'http' ? outcome.status : null,
        transportError: outcome.kind === 'transport' ? outcome.why : null,
        usage: validity,
        settlement: result.outcome,
      }
      return result
    },
    settleImage(ticket, outcome) {
      const amount = take(ticket)
      let priced: bigint | undefined
      let latch: SettlementResult['latch']
      if (
        outcome.kind === 'returned' &&
        Number.isSafeInteger(outcome.count) &&
        typeof outcome.count === 'number' &&
        outcome.count >= 0
      ) {
        if (outcome.count > ticket.units) latch = 'breach'
        imagesReturned += outcome.count
        imagesRefunded += Math.max(0, ticket.units - outcome.count)
        priced = amount * BigInt(outcome.count)
      }
      if (outcome.kind === 'http' && NON_BILLABLE_HTTP_REJECTIONS.has(outcome.status)) {
        priced = ZERO
        imagesRefunded += ticket.units
      }
      if (priced === undefined) {
        imagesUncertain += ticket.units
        paidUncertain += amount
      } else paidSettled += priced
      return finish(amount, priced, latch)
    },
    close() {
      isClosed = true
    },
    get lastResponse() {
      return lastResponse === null ? null : { ...lastResponse }
    },
    totals() {
      return {
        capUsd: usd(cap),
        settledUsd: usd(settled),
        uncertainUsd: usd(uncertain),
        reservedUsd: usd(reserve),
        remainingUsd: usd(
          cap > settled + uncertain + reserve ? cap - settled - uncertain - reserve : ZERO,
        ),
        requests,
        tokens: { ...tokens },
        paid: {
          imageAttempts,
          imagesReturned,
          imagesRefunded,
          imagesUncertain,
          settledUsd: usd(paidSettled),
          uncertainUsd: usd(paidUncertain),
        },
        breach: isBreach,
        refusal,
        lastResponse: lastResponse === null ? null : { ...lastResponse },
      }
    },
  }
}
