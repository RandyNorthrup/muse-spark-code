import * as z from 'zod/mini'
import {
  EXEC_MAX_BUDGET_USD,
  EXEC_MAX_REQUESTS,
  EXEC_MIN_OUTPUT_TOKENS,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_MAX_OUTPUT_TOKENS,
  PAID_PRICES_USD,
  UI_TEXT,
} from '../../shared/constants'
import type { LastResponse, LedgerTotals, Refusal, TokenTotals } from './execProtocol'

export interface TierPrice {
  readonly input: number
  readonly cachedInput: number
  readonly output: number
}
export interface ResponseTicket {
  readonly contextTokens?: number | undefined
  readonly n: number
  readonly kind: 'responses'
  readonly model: string
  readonly maxOutputTokens: number
  readonly reserveUsd: number
  readonly price: TierPrice
}
export interface ImageTicket {
  readonly n: number
  readonly kind: 'image'
  readonly endpoint: 'images.generations' | 'images.edits'
  readonly units: 1
  readonly reserveUsd: number
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
  chargedUsd: number
  latch?: 'accounting_invalid' | 'breach'
}
export interface RunLedger {
  admitResponse(input: {
    model: string
    maxOutputTokens: number
    price: TierPrice
    readonly contextTokens?: number | undefined
    readonly reserveUsd?: number | undefined
  }): ResponseTicket | { refused: Refusal }
  admitImage(endpoint: 'images.generations' | 'images.edits'): ImageTicket | { refused: Refusal }
  settleResponse(
    ticket: ResponseTicket,
    outcome: ResponseSettlement,
    pricing?: { readonly costUsd: number | undefined },
  ): SettlementResult
  settleImage(ticket: ImageTicket, outcome: ImageSettlement): SettlementResult
  close(): void
  readonly lastResponse: LastResponse | null
  totals(): LedgerTotals
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

// The incoming budget string was parsed by A. Recover only an exact display
// conversion here; every admission, charge and identity below uses integers.
function units(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(UI_TEXT.execNumberInvalid)
  const decimal = usd.toFixed(EXEC_USD_DECIMALS)
  if (Number(decimal) !== usd) throw new Error(UI_TEXT.execNumberInvalid)
  const value = BigInt(decimal.replace('.', ''))
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(UI_TEXT.execNumberInvalid)
  return value
}
function usd(value: bigint): number {
  return Number(value) / EXEC_USD_UNITS
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

export function createRunLedger(input: { capUsd: number; maxRequests: number }): RunLedger {
  const cap = units(input.capUsd)
  if (
    cap <= ZERO ||
    cap > units(EXEC_MAX_BUDGET_USD) ||
    !Number.isSafeInteger(input.maxRequests) ||
    input.maxRequests < 1 ||
    input.maxRequests > EXEC_MAX_REQUESTS
  )
    throw new Error(UI_TEXT.execNumberInvalid)
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
    if (active !== undefined) throw new Error(UI_TEXT.execRequestShape)
    if (requests >= input.maxRequests) return refuse('requests')
    if (settled + uncertain + amount > cap) return refuse('budget')
    reserve = amount
    requests += 1
    return undefined
  }
  const take = (ticket: ResponseTicket | ImageTicket): bigint => {
    if (active !== ticket) throw new Error(UI_TEXT.execRequestShape)
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
    admitResponse(request) {
      const { maxOutputTokens: m, price } = request
      if (!Number.isSafeInteger(m) || m < EXEC_MIN_OUTPUT_TOKENS || m > MODEL_API_MAX_OUTPUT_TOKENS)
        return refuse('request_shape')
      let amount: bigint
      try {
        if (request.reserveUsd === undefined && price.cachedInput > price.input)
          return refuse('unpriced')
        amount =
          request.reserveUsd === undefined
            ? charge(price, MODEL_API_CONTEXT_WINDOW - m, m)
            : units(request.reserveUsd)
      } catch {
        return refuse('unpriced')
      }
      const rejected = admit(amount)
      if (rejected !== undefined) return rejected
      active = Object.freeze({
        ...request,
        price: Object.freeze({ ...price }),
        kind: 'responses',
        n: requests,
        reserveUsd: usd(amount),
      })
      lastResponse = null
      return active
    },
    admitImage(endpoint) {
      const amount = units(PAID_PRICES_USD.imageGeneration)
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
          if (
            u.input_tokens >
              (ticket.contextTokens ?? MODEL_API_CONTEXT_WINDOW) - ticket.maxOutputTokens ||
            u.output_tokens > ticket.maxOutputTokens ||
            (cost !== undefined && cost > amount)
          )
            latch = 'breach'
          else if (terminal === 'completed' && outcome.kind === 'eof' && !outcome.parseInvalid)
            priced = cost
        }
      }
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
        else {
          imagesReturned += outcome.count
          imagesRefunded += ticket.units - outcome.count
          priced = amount * BigInt(outcome.count)
        }
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
        remainingUsd: usd(cap - settled - uncertain - reserve),
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
