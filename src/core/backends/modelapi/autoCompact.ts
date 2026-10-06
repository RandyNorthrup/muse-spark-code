// M101 C2 / D81.4: pure economics and registered-todo history. Token counts
// describe the last dispatched body, including packed placeholders, never originals.
import {
  AUTO_COMPACTION_COOLDOWN_REQUESTS,
  AUTO_COMPACTION_MIN_OCCUPANCY,
  AUTO_COMPACTION_NEAR_WINDOW,
  HANDOFF_OPEN_TODO_STATUSES,
  MODEL_API_CONTEXT_BYTES_PER_TOKEN,
} from '../../../shared/constants'
import { Buffer } from 'node:buffer'
import type { TodoItem } from '../../../shared/agentEvents'
import type { ModelPricing } from '../../providers/priceCard'
import type { CreateResponseBody } from './schemas'
import { requestParts } from './sessionBudget'

function dispatchedTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text) / MODEL_API_CONTEXT_BYTES_PER_TOKEN)
}

/** A lower token estimate of dispatched bytes; placeholders stay at dispatched size. */
export function measureAutoCompactRequest(
  body: Pick<CreateResponseBody, 'instructions' | 'tools' | 'input'>,
  turnIds: readonly string[],
  keptTurns: ReadonlySet<string>,
): { readonly contextTokens: number; readonly removableTokens: number } | undefined {
  if (turnIds.length !== body.input.length) return undefined
  const contextTokens = requestParts(body).reduce((sum, part) => sum + dispatchedTokens(part), 0)
  let removableTokens = 0
  for (const [index, item] of body.input.entries()) {
    if (!keptTurns.has(turnIds[index] ?? ''))
      removableTokens += dispatchedTokens(JSON.stringify(item))
  }
  return { contextTokens, removableTokens }
}

export interface AutoCompactModel {
  readonly pricing: ModelPricing
  readonly cacheDuration?: '5m' | '1h'
  /** Measured local seconds per token; no invented performance tariff. */
  readonly localTime?: {
    readonly prefill: number
    readonly read: number
    readonly output: number
  }
}

export interface AutoCompactInput extends AutoCompactModel {
  readonly contextTokens: number
  readonly windowTokens: number
  readonly removableTokens: number
  readonly summaryTokens: number
  readonly summaryInputTokens: number
  readonly summaryOutputTokens: number
  readonly summaryRequests: number
  readonly cachedTokens: number
}

export interface AutoCompactDecision {
  readonly reason: 'cost' | 'near-window' | 'overflow'
  /** USD for priced models, seconds for measured local models. */
  readonly newDebt: number
  readonly saving: number
  readonly breakEvenRequests: number
  readonly writeReadRatio: number | undefined
}

function rates(input: AutoCompactInput, inputTokens: number) {
  if (input.pricing.kind === 'local') return input.localTime
  if (input.pricing.kind !== 'priced') return
  const { card } = input.pricing
  const tier = card.longContextTier
  const inputRate = tier !== undefined && inputTokens >= tier.fromTokens ? tier.input : card.input
  return {
    prefill:
      (input.cacheDuration === '1h' ? card.cacheWrite1h : undefined) ??
      card.cacheWrite ??
      inputRate,
    read: card.cachedInput ?? inputRate,
    output: tier !== undefined && inputTokens >= tier.fromTokens ? tier.output : card.output,
  }
}

/** Debt survives successful compactions and new tasks; failures clear it. */
export class AutoCompact {
  private debt = 0
  private saving = 0
  private requests = AUTO_COMPACTION_COOLDOWN_REQUESTS
  private taskRequests = 0
  private samples: number[] = []
  private todos: readonly TodoItem[] = []
  private pendingTransition = false
  private isRefused = false
  private previousSummary: number | undefined

  public get summaryTokens(): number | undefined {
    return this.previousSummary
  }

  public get carriedDebt(): number {
    return this.debt
  }

  public noteSummary(tokens: number): void {
    this.previousSummary = tokens
    this.requests = 0
  }

  /** Called adjacent to each ordinary POST, not at body construction. */
  public noteRequest(): void {
    this.requests += 1
    this.taskRequests += 1
    this.debt = Math.max(0, this.debt - this.saving)
  }

  public newUserTask(): void {
    this.isRefused = false
    if (this.todos.length === 0 || this.todos.some((todo) => todo.status !== 'completed')) return
    this.samples = []
    this.taskRequests = 0
  }

  public noteToolWork(): void {
    this.isRefused = false
  }

  /** Text plus occurrence matches duplicates; first-seen completed items never count. */
  public noteTodos(items: readonly TodoItem[]): void {
    const available = [...this.todos]
    let completed = 0
    for (const item of items) {
      const index = available.findIndex((previous) => previous.text === item.text)
      if (index === -1) continue
      const previous = available.splice(index, 1)[0]
      if (HANDOFF_OPEN_TODO_STATUSES.has(previous?.status ?? '') && item.status === 'completed')
        completed += 1
    }
    if (completed > 0) {
      this.pendingTransition = true
      this.samples.push(this.taskRequests / completed)
      this.taskRequests = 0
    }
    this.todos = items.map((item) => ({ ...item }))
  }

  /** One decision consumes the batch's transition even when economics say no. */
  public decide(input: AutoCompactInput, isOverflow = false): AutoCompactDecision | undefined {
    const hasTransition = this.pendingTransition
    this.pendingTransition = false
    if (
      this.isRefused ||
      [
        input.contextTokens,
        input.windowTokens,
        input.removableTokens,
        input.summaryTokens,
        input.summaryInputTokens,
        input.summaryOutputTokens,
        input.summaryRequests,
        input.cachedTokens,
      ].some((count) => !Number.isSafeInteger(count) || count < 0) ||
      input.windowTokens <= 0 ||
      input.removableTokens <= 0
    )
      return undefined
    const isNear = input.contextTokens >= input.windowTokens * AUTO_COMPACTION_NEAR_WINDOW
    const savingTokens = Math.max(0, input.removableTokens - input.summaryTokens)
    // The write premium applies to the context AFTER archive replacement.
    const writtenTokens = Math.max(0, input.contextTokens - savingTokens)
    const price = rates(input, writtenTokens)
    const summaryPrice = rates(input, input.summaryInputTokens)
    const flat = input.pricing.kind === 'priced' ? (input.pricing.card.request ?? 0) : 0
    const hasValidRates =
      price !== undefined &&
      summaryPrice !== undefined &&
      Number.isFinite(flat) &&
      flat >= 0 &&
      [...Object.values(price), ...Object.values(summaryPrice)].every(
        (rate) => Number.isFinite(rate) && rate >= 0,
      )
    const read = hasValidRates ? price.read : 0
    const write = hasValidRates ? price.prefill : 0
    const cached = Math.min(input.cachedTokens, input.summaryInputTokens)
    const summaryCost = hasValidRates
      ? ((input.summaryInputTokens - cached) * summaryPrice.prefill +
          cached * summaryPrice.read +
          input.summaryOutputTokens * summaryPrice.output +
          flat) *
        input.summaryRequests
      : 0
    const newDebt = writtenTokens * Math.max(0, write - read) + summaryCost
    const saving = savingTokens * read
    const breakEvenRequests =
      saving + this.saving > 0 ? (this.debt + newDebt) / (saving + this.saving) : Infinity
    const remaining = this.todos.filter((todo) =>
      HANDOFF_OPEN_TODO_STATUSES.has(todo.status),
    ).length
    const horizon =
      this.samples.length === 0
        ? 0
        : (this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length) * remaining
    if (
      !isOverflow &&
      !isNear &&
      (!hasTransition ||
        !hasValidRates ||
        this.requests < AUTO_COMPACTION_COOLDOWN_REQUESTS ||
        input.contextTokens < input.windowTokens * AUTO_COMPACTION_MIN_OCCUPANCY ||
        savingTokens <= 0 ||
        breakEvenRequests > horizon)
    )
      return undefined
    const reason = isNear ? 'near-window' : 'cost'
    return {
      reason: isOverflow ? 'overflow' : reason,
      newDebt,
      saving,
      breakEvenRequests,
      writeReadRatio: read > 0 ? write / read : undefined,
    }
  }

  public succeeded(decision: AutoCompactDecision, summaryTokens: number): void {
    this.debt += decision.newDebt
    this.saving += decision.saving
    this.previousSummary = summaryTokens
    this.requests = 0
  }

  public failed(): void {
    this.debt = 0
    this.saving = 0
    this.isRefused = true
  }
}
