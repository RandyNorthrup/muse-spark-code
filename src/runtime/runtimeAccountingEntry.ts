import { Usd, isPositiveUsd, type UsdAmount } from '../shared/usd'
import { canonicalUsd } from '../shared/usdSchema'
// The standalone runtime's daily limit and per-run accounting; no VS Code imports.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { createDailySpend, paidDailyBudgetRow } from '../host/paid/dailySpend'
import {
  isModelApiError,
  type ProviderClient,
  type ResponseAttemptGuard,
  type ResponseObservation,
} from '../core/backends/modelapi/client'
import type { UsageBudgetRead } from '../core/usage/usageService'
import {
  metaResolvedModel,
  minOutputTokensForPolicy,
  modelPricedUsage,
  requestImageCount,
  type ModelClient,
  type ResolvedModel,
} from '../core/backends/modelapi/modelPolicy'
import { SessionBudgetExceededError } from '../core/backends/modelapi/sessionBudget'
import { assertConfirmedAllowed } from '../core/backends/modelapi/transport'
import type { SpendClaim } from '../core/paid/spendClaim'
import { SpendLedgerError, isSpendLedgerError } from '../core/paid/spendLedgerError'
import { UserRefusalError, isPaidStop, isRequestNotSent } from '../core/refusal'
import type { ResponseObject } from '../core/backends/modelapi/schemas'
import { isPlanModelRef } from '../shared/providerRouting'
import {
  EXEC_USD_DECIMALS,
  EXEC_MIN_OUTPUT_TOKENS,
  SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT,
  NON_BILLABLE_HTTP_REJECTIONS,
  MEDIA_CONVERTER_PATH_MAX_CHARS,
  HTTP_TOO_MANY_REQUESTS,
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../shared/constants'
import { storeErrorCode } from '../host/backend/storeErrors'
import {
  type RunLedger,
  type ResponseInputBound,
  type ResponseTicket,
  type SettlementResult,
} from './exec/runLedger'
import type { ExecBudgetRefusal, LastResponse, Refusal, LedgerTotals } from './exec/execProtocol'
import { fill, formatDateTime, plural } from '../shared/l10n/text'
import { formatUsd } from '../shared/l10n/exactUsd'

const settingsSchema = z.strictObject({
  // Zero is no limit (D121): a stored zero must parse, so the setting keeps
  // the nonnegative bound instead of the raised-cap range.
  paidDailyBudgetUsd: z.optional(z.number().check(z.nonnegative())),
  // M105 lane V: the converter path shares this machine file (runtimeConverterPath.ts).
  mediaConverterPath: z.optional(z.string().check(z.maxLength(MEDIA_CONVERTER_PATH_MAX_CHARS))),
})
const ceilUsd = (cost: UsdAmount) => Usd.from(cost).ceiling(EXEC_USD_DECIMALS).toAmount()

/**
 * EXECPROV round 6: one exact same-body input count for one request. The
 * call carries the request's own body, ends at the short Model API deadline
 * (or sooner when the attempt stops), and validates its answer: a lying or
 * stale count that is not a token count, or a billed cost that is not money,
 * throws and the caller falls back to the byte bound. Absent stays absent:
 * callers only invoke this where the client offers it.
 */
async function countExactInput(
  detailed: NonNullable<ModelClient['countInputTokensDetailed']>,
  body: Parameters<NonNullable<ModelClient['countInputTokensDetailed']>>[0],
  signal: AbortSignal,
): Promise<{ tokens: number; costUsd: UsdAmount | undefined; accuracy?: 'exact' | 'estimate' }> {
  signal.throwIfAborted()
  // No deadline of our own (owner 2026-10-16): the count ends at the
  // provider's answer, a network failure, or the attempt's stop.
  const counted = await detailed(body, signal)
  if (counted.costUsd !== undefined) Usd.from(counted.costUsd)
  if (!Number.isSafeInteger(counted.tokens) || counted.tokens < 0)
    throw new UserRefusalError(UI_TEXT.execRequestShape, 'request_shape')
  return {
    tokens: counted.tokens,
    ...(counted.accuracy !== undefined && { accuracy: counted.accuracy }),
    costUsd:
      counted.costUsd === undefined
        ? undefined
        : Usd.from(counted.costUsd).ceiling(EXEC_USD_DECIMALS).toAmount(),
  }
}

/** The machine-local day scope, the same calendar the usage page buckets by. */
function dailyScope(now: number): string {
  const date = new Date(now)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}

/**
 * The shared daily paid budget for report Limits sections, without starting
 * a backend (RVCM1132B finding 3): the same ledger the runtime reserves
 * against, read only. A missing ledger reads as zero spend under the
 * configured cap.
 */
export function readRuntimeDailyBudget(deps: {
  readonly dataFolder: string
  readonly now: () => number
}): Promise<readonly UsageBudgetRead[]> {
  return createRuntimeDailyBudget({
    dataFolder: deps.dataFolder,
    now: deps.now,
    sleep: () => Promise.resolve(),
  }).readToday()
}

/**
 * The agent's daily spending limit (PLAN.md D121): `paidDailyBudgetUsd` in
 * its settings file, set by the person; none by default. With no limit the
 * request path reads only that file: no spend record is read and nothing is
 * reserved, locked or written. With one, a request whose
 * estimate would pass what is left of today is not sent, and each request's
 * reported cost joins today's running total after it ends; nothing is held
 * for a request in flight, and a request that reported no usage is counted
 * as cost unknown, never as its estimate.
 */
export function createRuntimeDailyBudget(deps: {
  readonly dataFolder: string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}) {
  const spend = createDailySpend({
    directory: path.join(deps.dataFolder, PAID_DAILY_BUDGET.directory),
    sleep: deps.sleep,
  })
  const day = () => dailyScope(deps.now())
  const capUsd = (): UsdAmount => {
    let text: string
    try {
      text = readFileSync(path.join(deps.dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')
    } catch (error: unknown) {
      if (storeErrorCode(error) === 'ENOENT')
        return canonicalUsd(SETTING_DEFAULTS.paidDailyBudgetUsd)
      throw new SpendLedgerError(
        'unreadable',
        { scope: 'daily', file: 'settings', errno: storeErrorCode(error) },
        error,
      )
    }
    try {
      return canonicalUsd(
        settingsSchema.parse(JSON.parse(text)).paidDailyBudgetUsd ??
          SETTING_DEFAULTS.paidDailyBudgetUsd,
      )
    } catch (error: unknown) {
      throw new SpendLedgerError('damaged', { scope: 'daily', file: 'settings' }, error)
    }
  }
  const nextMidnight = (): number => {
    const date = new Date(deps.now())
    date.setDate(date.getDate() + 1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  /**
   * One exact cost that would pass what is left of today, in the stop
   * sentence the request admission says (D121). The standalone runtime
   * never raises a day, so there is no raise question, only the refusal.
   */
  const overDaily = (costUsd: UsdAmount, limitUsd: UsdAmount, spentUsd: UsdAmount) =>
    new SessionBudgetExceededError(
      fill(UI_TEXT.execPaidDailyStopped, {
        estimate: formatUsd(costUsd),
        cap: formatUsd(limitUsd),
        spent: formatUsd(spentUsd),
        reset: formatDateTime(nextMidnight()),
        setting: 'paidDailyBudgetUsd',
      }),
    )
  /**
   * The send-time limit recheck both admissions share: midnight rolls the
   * scope, a removed limit stops enforcing, and an amount past what is left
   * refuses with the stop sentence.
   */
  const limitCheck = (signal: AbortSignal, scope: string, amountUsd: UsdAmount): void => {
    signal.throwIfAborted()
    if (scope !== day()) throw new UserRefusalError(UI_TEXT.spendLedgerMidnight, 'midnight')
    const limitUsd = capUsd()
    if (!isPositiveUsd(limitUsd)) return
    const { spentUsd } = spend.read(scope)
    if (Usd.from(spentUsd).add(Usd.from(amountUsd)).compare(Usd.from(limitUsd)) > 0)
      throw overDaily(amountUsd, limitUsd, spentUsd)
  }
  return {
    capUsd,
    /**
     * One request about to be sent: `undefined` when the person set no daily
     * limit (only the settings file is read); otherwise its claim, refused with
     * the stop sentence when its estimate would pass what is left of today.
     */
    admit(estimateUsd: UsdAmount, signal: AbortSignal): SpendClaim | undefined {
      signal.throwIfAborted()
      if (!isPositiveUsd(capUsd())) return undefined
      const scope = day()
      const check = () => {
        limitCheck(signal, scope, estimateUsd)
      }
      check()
      let isSettled = false
      return {
        estimateUsd,
        check,
        settle: async (costUsd) => {
          if (isSettled) return
          isSettled = true
          await spend.add(scope, costUsd === undefined ? undefined : ceilUsd(costUsd))
        },
      }
    },

    /**
     * One exact cost about to be spent (Muse Voice batch transcription):
     * `undefined` when the person set no daily limit (only the settings
     * file is read); otherwise its claim, estimate-checked against what is
     * left of today like a request's and settled from the receipt after.
     */
    reserve(costUsd: UsdAmount, signal: AbortSignal): Promise<SpendClaim | undefined> {
      signal.throwIfAborted()
      if (!isPositiveUsd(capUsd())) return Promise.resolve(undefined)
      const scope = day()
      const check = () => {
        limitCheck(signal, scope, costUsd)
      }
      check()
      let isSettled = false
      return Promise.resolve({
        estimateUsd: costUsd,
        check,
        settle: async (actualCostUsd) => {
          if (isSettled) return
          isSettled = true
          await spend.add(scope, actualCostUsd === undefined ? undefined : ceilUsd(actualCostUsd))
        },
      })
    },

    /**
     * Today's shared budget for report Limits sections: the same row as
     * VS Code's dailyPaid.readToday, without the editor's stop/raise state
     * (the standalone runtime never raises a day or records a stop, so both
     * stay at their defaults).
     */
    readToday(): Promise<readonly UsageBudgetRead[]> {
      const scope = day()
      const cap = capUsd()
      if (!isPositiveUsd(cap)) return Promise.resolve([])
      const total = spend.read(scope)
      return Promise.resolve([
        paidDailyBudgetRow({
          scope,
          total,
          capUsd: cap,
          stopped: false,
          raisedToday: false,
          resetsAt: nextMidnight(),
        }),
      ])
    },
  }
}

export interface RuntimeResponseAccounting {
  readonly ledger: RunLedger
  readonly refuse: (
    reason: Refusal | 'breach' | 'accounting_invalid',
    message?: string,
    details?: ExecBudgetRefusal,
  ) => void
  readonly localRefusal?: (
    kind: string,
    message: string,
    facts?: {
      readonly scope: string
      readonly file?: string | undefined
      readonly errno?: string | undefined
    },
  ) => void
  readonly started: (n: number, ticket: ResponseTicket) => void
  readonly settled: (
    outcome: LastResponse,
    ticket: ResponseTicket,
    result: SettlementResult,
  ) => void
  /**
   * The runner's model was unknown when this attached (no `--model`): admit
   * plan requests only, so a resolved Meta model is not admitted twice —
   * the Meta transport admits its own traffic (Codex on PR #213).
   */
  readonly admitOnlyPlan?: boolean
}

/** Preserve all native clients and codecs; attach admission to their shared transport guard. */
export function withRuntimeAccounting(
  client: ProviderClient,
  daily: ReturnType<typeof createRuntimeDailyBudget>,
  accounting?: RuntimeResponseAccounting,
  dispatch?: { onRequestStarted?: () => void },
  outputCap?: (policy: ResolvedModel['policy']) => number,
): ProviderClient {
  const forwardRefusal = (caught: unknown) => {
    const error =
      isRequestNotSent(caught) &&
      caught.cause instanceof Error &&
      (isSpendLedgerError(caught.cause) ||
        isPaidStop(caught.cause) ||
        caught.cause.name === 'UserRefusalError')
        ? caught.cause
        : caught
    if (isSpendLedgerError(error))
      accounting?.localRefusal?.(`ledger_${error.kind}`, error.message, error.facts)
    else if (isPaidStop(error) && error instanceof Error) {
      accounting?.localRefusal?.('daily_budget', error.message)
      accounting?.refuse('budget', error.message)
    } else if (
      error instanceof Error &&
      error.name === 'UserRefusalError' &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      accounting?.localRefusal?.(error.code, error.message)
      switch (error.code) {
        case 'unpriced': {
          accounting?.refuse('unpriced', error.message)
          break
        }
        case 'context_limit': {
          accounting?.refuse('request_shape', error.message)
          break
        }
        case 'midnight': {
          {
            accounting?.refuse('budget', error.message)
            // No default
          }
          break
        }
      }
    }
  }
  const wrap = (model: ResolvedModel): ResolvedModel => {
    outputCap?.(model.policy)
    const original = model.client
    const bounded: ModelClient = {
      currentKeyDigest: original.currentKeyDigest.bind(original),
      countInputTokens: original.countInputTokens.bind(original),
      ...(original.countInputTokensDetailed !== undefined && {
        countInputTokensDetailed: original.countInputTokensDetailed.bind(original),
      }),
      listModels: original.listModels.bind(original),
      retryDelayMs: original.retryDelayMs.bind(original),
      waitBeforeRetry: original.waitBeforeRetry.bind(original),
      maxRetries: original.maxRetries.bind(original),
      personCap: original.personCap.bind(original),
      async *streamResponse(body, signal, onRetry, retryBudget, guard, confirmed) {
        const contextTokens = model.contextTokens
        const outputOnly = model.price.reserve({
          inputTokens: 0,
          outputTokens: body.max_output_tokens,
        })
        try {
          if (
            contextTokens === undefined ||
            !Number.isSafeInteger(contextTokens) ||
            contextTokens < 1
          )
            throw new UserRefusalError(UI_TEXT.execContextLimit, 'context_limit')
          signal.throwIfAborted()
          if (!model.isCurrent()) throw new UserRefusalError(UI_TEXT.requestStaleRun, 'stale_run')
          assertConfirmedAllowed(body.model, confirmed)
          await guard?.prepare?.()
          signal.throwIfAborted()
          if (!model.isCurrent()) throw new UserRefusalError(UI_TEXT.requestStaleRun, 'stale_run')
          // EXECPROV round 7: where the client documents an exact same-body
          // count, the input side reserves that count at the uncached price —
          // once per request, bounded, sending the request's own body. Only
          // run-ledger runs count: interactive runs keep exactly today's byte
          // bound and send no extra request. Media carries its own calibrated
          // bound, and any failure (or a count the client does not offer)
          // keeps exactly today's byte bound. A count larger than the byte
          // bound is a lying count and falls back the same way: a count can
          // only shrink the reservation, never grow it past the bytes.
        } catch (error: unknown) {
          forwardRefusal(error)
          throw error
        }
        const mediaTokens = guard?.mediaAccounting?.inputTokens
        const canCount =
          accounting === undefined ||
          outputOnly === undefined ||
          Usd.from(outputOnly).compare(Usd.from(accounting.ledger.totals().remainingUsd)) <= 0
        const detailed =
          accounting === undefined || mediaTokens !== undefined || !canCount
            ? undefined
            : original.countInputTokensDetailed
        let counted:
          | { tokens: number; costUsd: UsdAmount | undefined; accuracy?: 'exact' | 'estimate' }
          | undefined
        try {
          counted =
            detailed === undefined ? undefined : await countExactInput(detailed, body, signal)
        } catch {
          signal.throwIfAborted()
          counted = undefined
        }
        if (counted !== undefined) {
          const byteTokens = Buffer.byteLength(JSON.stringify(body))
          if (counted.tokens > byteTokens) counted = undefined
        }
        const isExactFailed = counted === undefined && detailed !== undefined
        const byteBound = Buffer.byteLength(JSON.stringify(body))
        const countedBound =
          counted?.accuracy === 'estimate'
            ? Math.min(
                byteBound,
                Math.ceil((counted.tokens * (100 + SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT)) / 100),
              )
            : counted?.tokens
        const inputTokens = mediaTokens ?? countedBound ?? byteBound
        const countCostUsd = counted?.costUsd
        const inputCost = model.price.reserve({
          inputTokens,
          outputTokens: 0,
          images: requestImageCount(body),
        })
        const requestedUsd = model.price.reserve({
          inputTokens,
          outputTokens: body.max_output_tokens,
          images: requestImageCount(body),
        })
        const reserveUsd =
          requestedUsd === undefined || countCostUsd === undefined
            ? requestedUsd
            : Usd.from(requestedUsd).add(Usd.from(countCostUsd)).toAmount()
        if (
          inputCost === undefined ||
          reserveUsd === undefined ||
          Usd.from(reserveUsd).compare(Usd.from(0)) < 0
        )
          throw new UserRefusalError(UI_TEXT.execModelUnpriced, 'unpriced')
        // A context no larger than the output limit leaves no input room
        // under context-minus-output; hold such a model to its context.
        const mediaInputBound =
          contextTokens > body.max_output_tokens
            ? contextTokens - body.max_output_tokens
            : contextTokens
        const dailyInputTokens = mediaTokens === undefined ? byteBound : mediaInputBound
        const dailyAmount = model.price.reserve({
          inputTokens: dailyInputTokens,
          outputTokens: body.max_output_tokens,
          images: requestImageCount(body),
        })
        if (dailyAmount === undefined)
          throw new UserRefusalError(UI_TEXT.execModelUnpriced, 'unpriced')
        const dailyReserveUsd =
          countCostUsd === undefined
            ? dailyAmount
            : Usd.from(dailyAmount).add(Usd.from(countCostUsd)).toAmount()
        let claim: SpendClaim | undefined
        let ticket: ResponseTicket | undefined
        let wasSent = false
        let response: ResponseObject | undefined
        let httpStatus: number | undefined
        let hasEof = false
        let hasTerminalUsage = false
        let hasResponseFrame = false
        // One attempt is open from its preparation until it settles; with no
        // daily limit it has no claim, and only the run's ledger settles.
        let isAttemptOpen = false
        const settle = async () => {
          if (!isAttemptOpen) return
          isAttemptOpen = false
          const owned = claim
          claim = undefined
          const actual =
            hasTerminalUsage && response?.usage != null
              ? model.price.settle(modelPricedUsage(response.usage), {
                  cost: response.usage.provider_cost_usd,
                })
              : undefined
          let cost = actual === undefined ? undefined : ceilUsd(actual)
          const isRefused =
            httpStatus !== undefined &&
            !hasResponseFrame &&
            NON_BILLABLE_HTTP_REJECTIONS.has(httpStatus)
          if (isRefused) cost = Usd.from(0).toAmount()
          // A billed count is a separate completed call: it stays settled
          // even when the response itself was not billed.
          if (cost !== undefined && countCostUsd !== undefined)
            cost = Usd.from(cost).add(Usd.from(countCostUsd)).toAmount()
          // A ticket that never reached the wire, or that the provider refused
          // before generating anything, is withdrawn with its request count:
          // it cost nothing (D121). A billed count keeps its settlement.
          if (ticket !== undefined && (!wasSent || (isRefused && countCostUsd === undefined))) {
            accounting?.ledger.releaseResponse(ticket)
            ticket = undefined
          }
          if (ticket !== undefined && accounting !== undefined) {
            const result = accounting.ledger.settleResponse(
              ticket,
              {
                ...(httpStatus === undefined || hasResponseFrame
                  ? {
                      ...(hasEof
                        ? ({ kind: 'eof', parseInvalid: false } as const)
                        : ({
                            kind: 'transport',
                            why: signal.aborted ? 'aborted' : 'error',
                          } as const)),
                      terminal: response?.status ?? null,
                      incompleteReason: response?.incomplete_details?.reason ?? null,
                      usage: response?.usage,
                    }
                  : { kind: 'http' as const, status: httpStatus }),
              },
              { costUsd: cost },
            )
            const last = accounting.ledger.lastResponse
            const settledTicket = ticket
            ticket = undefined
            if (last !== null) accounting.settled(last, settledTicket, result)
            if (result.latch !== undefined) accounting.refuse(result.latch)
          }
          const isUncertainEstimate =
            wasSent && cost === undefined && counted?.accuracy === 'estimate'
          // After the call: its reported cost, or cost unknown when it went out
          // and reported no usage; never its estimate (D121).
          await owned?.settle(wasSent ? cost : Usd.from(0).toAmount())
          wasSent = false
          response = undefined
          hasEof = false
          hasTerminalUsage = false
          hasResponseFrame = false
          httpStatus = undefined
          if (!isUncertainEstimate || signal.aborted) {
            return
          }

          accounting?.localRefusal?.('estimate_uncertain', UI_TEXT.execAccountingInvalid)
          accounting?.refuse('accounting_invalid', UI_TEXT.execAccountingInvalid)
          throw new UserRefusalError(UI_TEXT.execAccountingInvalid, 'estimate_uncertain')
        }
        const started = () => {
          claim?.check()
          if (ticket !== undefined) accounting?.started(ticket.n, ticket)
          wasSent = true
        }
        let isFirstPreparation = true
        const attempt: ResponseAttemptGuard = Object.assign(
          (digest: string | undefined) => {
            if (!model.isCurrent()) throw new UserRefusalError(UI_TEXT.requestStaleRun, 'stale_run')
            claim?.check()
            guard?.(digest)
          },
          {
            ...guard,
            observe: (observation: ResponseObservation) => {
              if (observation.rateLimited === true) httpStatus = HTTP_TOO_MANY_REQUESTS
              guard?.observe?.(observation)
            },
            // A refusal before any generation costs nothing, even when the
            // provider's adapter rethrows its error without the status (D121).
            onRefused: (status: number) => {
              httpStatus = status
              guard?.onRefused?.(status)
            },
            prepare: async () => {
              await settle()
              if (isFirstPreparation) isFirstPreparation = false
              else await guard?.prepare?.()
              // Whether this attempt may ride the Meta transport's own
              // admission (checked below for a model unknown at attach).
              const isPlan = isPlanModelRef(body.model)
              try {
                claim = daily.admit(dailyReserveUsd, signal)
              } catch (error: unknown) {
                forwardRefusal(error)
                throw error
              }
              isAttemptOpen = true
              if (accounting === undefined) return
              // A model unknown at attach time that resolved to Meta rides
              // the Meta transport's own admission: admitting here too would
              // count the request twice.
              if (!isPlan && accounting.admitOnlyPlan === true) return
              const pricing = model.policy.pricing
              const price =
                pricing.kind === 'priced'
                  ? {
                      input: Usd.from(pricing.card.input).times(TOKENS_PER_MILLION).toAmount(),
                      cachedInput: Usd.from(pricing.card.cachedInput ?? pricing.card.input)
                        .times(TOKENS_PER_MILLION)
                        .toAmount(),
                      output: Usd.from(pricing.card.output).times(TOKENS_PER_MILLION).toAmount(),
                    }
                  : {
                      input: Usd.from(0).toAmount(),
                      cachedInput: Usd.from(0).toAmount(),
                      output: Usd.from(0).toAmount(),
                    }
              let admission: ReturnType<RunLedger['admitResponse']>
              let inputBound: ResponseInputBound | undefined
              if (counted !== undefined)
                inputBound = counted.accuracy === 'estimate' ? 'estimate' : 'exact'
              else if (isExactFailed) inputBound = 'bytes-after-failure'
              try {
                signal.throwIfAborted()
                admission = accounting.ledger.admitResponse({
                  model: body.model,
                  maxOutputTokens: body.max_output_tokens,
                  contextTokens,
                  reserveUsd: ceilUsd(reserveUsd),
                  price,
                  inputBound,
                })
              } catch (error: unknown) {
                await settle()
                throw error
              }
              if ('refused' in admission) {
                await settle()
                const totals = accounting.ledger.totals()
                // P3-1: every ledger refusal carries its own sentence, never
                // the budget one. A request-cap refusal names the cap, which
                // the ledger has exactly reached at this point.
                const refused = admission.refused
                let message: string
                let refusalDetails: ExecBudgetRefusal | undefined
                switch (refused) {
                  case 'budget': {
                    const quote = {
                      inputTokens,
                      inputCost,
                      outputTokens: body.max_output_tokens,
                      reserveUsd,
                      totals,
                    }
                    const reserveForOutput = (outputTokens: number) =>
                      model.price.reserve({
                        inputTokens,
                        outputTokens,
                        images: requestImageCount(body),
                      })
                    message = responseReservationMessage(
                      quote,
                      'terminal',
                      reserveForOutput,
                      minOutputTokensForPolicy(model.policy),
                    )
                    refusalDetails = {
                      // The hold, as admitted: ceilinged to micro-dollars
                      // like the ledger and the quote total.
                      neededUsd: Usd.from(reserveUsd).ceiling(EXEC_USD_DECIMALS).toAmount(),
                      ...budgetRefusalDetails(
                        quote,
                        reserveForOutput,
                        minOutputTokensForPolicy(model.policy),
                      ),
                    }
                    break
                  }
                  case 'requests': {
                    message = plural(UI_TEXT.execRequestCapReached, totals.requests)
                    break
                  }
                  case 'unpriced': {
                    message = UI_TEXT.execModelUnpriced
                    break
                  }
                  case 'request_shape': {
                    message = UI_TEXT.execRequestShape
                    break
                  }
                  default: {
                    message = UI_TEXT.execAccountingInvalid
                    break
                  }
                }
                accounting.refuse(admission.refused, message, refusalDetails)
                throw new UserRefusalError(message)
              }
              ticket = admission
            },
            onRequestStarted: () => {
              guard?.onRequestStarted?.()
              if (dispatch === undefined) started()
              else dispatch.onRequestStarted = started
            },
          },
        )
        const responseStream = original.streamResponse(
          body,
          signal,
          onRetry,
          retryBudget,
          attempt,
          confirmed,
        )
        try {
          for await (const event of responseStream) {
            hasResponseFrame = true
            if ('response' in event) response = event.response
            if (
              ['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)
            )
              hasTerminalUsage = true
            yield event
          }
          hasEof = true
        } catch (error: unknown) {
          forwardRefusal(error)
          if (isModelApiError(error) && error.status > 0) httpStatus = error.status
          if (isRequestNotSent(error)) {
            wasSent = false
          }
          throw error
        } finally {
          if (dispatch?.onRequestStarted === started) delete dispatch.onRequestStarted
          // A failed settlement is the rejection the caller sees: the
          // attempt is already marked settled, so calling settle again
          // would return at once and swallow the write error, reporting
          // success without recording the spend.
          await settle()
        }
      },
    }
    return { ...model, client: bounded }
  }
  const resolve = async (ref: string) => {
    let model: ResolvedModel
    try {
      model =
        client.models === undefined
          ? metaResolvedModel(ref, client, await client.planModelFacts?.(ref))
          : await client.models.resolve(ref)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'model_not_catalogue') {
        accounting?.ledger.reject('unpriced')
        accounting?.refuse('unpriced', error.message)
      }
      throw error
    }
    if (model.policy.pricing.kind === 'unpriced') {
      accounting?.ledger.reject('unpriced')
      accounting?.refuse('unpriced')
      throw new UserRefusalError(UI_TEXT.execModelUnpriced)
    }
    return wrap(model)
  }
  return {
    currentKeyDigest: client.currentKeyDigest.bind(client),
    countInputTokens: client.countInputTokens.bind(client),
    listModels: client.listModels.bind(client),
    retryDelayMs: client.retryDelayMs.bind(client),
    waitBeforeRetry: client.waitBeforeRetry.bind(client),
    maxRetries: client.maxRetries.bind(client),
    personCap: client.personCap.bind(client),
    createImage: client.createImage.bind(client),
    editImage: client.editImage.bind(client),
    // Production media (D85.2): the Files transport rides through runtime
    // accounting untouched; a wrapped client without it keeps the refusal.
    ...(client.requestFile !== undefined && {
      requestFile: client.requestFile.bind(client),
    }),
    ...(client.requestTranscription !== undefined && {
      requestTranscription: client.requestTranscription.bind(client),
    }),
    hasPaidDailyBudget: client.hasPaidDailyBudget,
    ...(client.provider !== undefined && { provider: client.provider }),
    ...(client.modelContextLimit !== undefined && {
      modelContextLimit: client.modelContextLimit.bind(client),
    }),
    ...(client.planModelFacts !== undefined && {
      planModelFacts: client.planModelFacts.bind(client),
    }),
    ...(client.isPlanModel !== undefined && { isPlanModel: client.isPlanModel.bind(client) }),
    ...(client.listPlanModels !== undefined && {
      listPlanModels: client.listPlanModels.bind(client),
    }),
    ...(client.readPlanUsage !== undefined && { readPlanUsage: client.readPlanUsage.bind(client) }),
    models: { ...client.models, resolve },
    async *streamResponse(body, ...args) {
      const model = await resolve(body.model)
      yield* model.client.streamResponse(body, ...args)
    },
  }
}
export { setUiText } from '../shared/l10n/text'

/** Who reads the refusal: the terminal names both remedies with numbers. */
export type ReservationMessageScope = 'terminal' | 'shared'

/**
 * One localized arithmetic sentence for daily/provider and headless Meta
 * admission, plus what would make the request fit. The cap remedy is a
 * complete clause on its own: ACP and the editor read the shared scope,
 * which never prints the terminal-only flag half. Every number comes from
 * the same exact-decimal arithmetic as the refusal itself.
 */
/**
 * EXECPROV round 6: the remedy numbers inside a budget refusal, computed
 * once by the same arithmetic the sentence uses: the admitting cap, the
 * largest output limit that fits (null when no output limit alone makes it
 * fit), and whether the input alone already costs more than is left.
 */
export function budgetRefusalDetails(
  input: {
    readonly inputTokens: number
    readonly inputCost: UsdAmount
    readonly outputTokens: number
    readonly reserveUsd: UsdAmount
    readonly totals: LedgerTotals
  },
  reserveForOutput?: (outputTokens: number) => UsdAmount | undefined,
  minimumOutputTokens?: number,
): Pick<
  ExecBudgetRefusal,
  'remainingUsd' | 'admitCapUsd' | 'maxOutputTokens' | 'inputAloneExceeds' | 'inputCostUsd'
> {
  const cost = Usd.from(input.inputCost).ceiling(EXEC_USD_DECIMALS)
  const total = Usd.from(input.reserveUsd).ceiling(EXEC_USD_DECIMALS)
  const committed = Usd.from(input.totals.settledUsd).add(Usd.from(input.totals.uncertainUsd))
  const remaining = Usd.from(input.totals.capUsd).subtract(committed)
  const remainingUsd = remaining.toAmount()
  const admitCap = committed.add(total).ceiling(2)
  const canFit = (outputTokens: number): boolean => {
    if (reserveForOutput === undefined) return false
    const estimate = reserveForOutput(outputTokens)
    return (
      estimate !== undefined &&
      Usd.from(estimate).ceiling(EXEC_USD_DECIMALS).compare(remaining) <= 0
    )
  }
  const isInputAloneExceeds = cost.compare(remaining) > 0
  const floor = Math.max(EXEC_MIN_OUTPUT_TOKENS, minimumOutputTokens ?? 1)
  let maxOutputTokens: number | null = null
  if (
    !isInputAloneExceeds &&
    reserveForOutput !== undefined &&
    floor <= input.outputTokens &&
    canFit(floor)
  ) {
    let low = floor
    let high = input.outputTokens
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      if (canFit(mid)) low = mid
      else high = mid - 1
    }
    maxOutputTokens = low
  }
  return {
    remainingUsd,
    // D121: budgets have no ceiling of ours, so the admitting cap is always
    // settable; null stays in the shape for a cap no run could set.
    admitCapUsd: admitCap.toAmount(),
    maxOutputTokens,
    inputAloneExceeds: isInputAloneExceeds,
    inputCostUsd: cost.toAmount(),
  }
}
export function responseReservationMessage(
  input: {
    readonly inputTokens: number
    readonly inputCost: UsdAmount
    readonly outputTokens: number
    readonly reserveUsd: UsdAmount
    readonly totals: LedgerTotals
  },
  scope: ReservationMessageScope = 'terminal',
  reserveForOutput?: (outputTokens: number) => UsdAmount | undefined,
  minimumOutputTokens?: number,
): string {
  const cost = Usd.from(input.inputCost).ceiling(EXEC_USD_DECIMALS)
  const total = Usd.from(input.reserveUsd).ceiling(EXEC_USD_DECIMALS)
  const base = fill(UI_TEXT.execBudgetQuote, {
    inputTokens: plural(UI_TEXT.execTokenCount, input.inputTokens),
    inputCost: formatUsd(cost.toAmount(), EXEC_USD_DECIMALS),
    outputTokens: plural(UI_TEXT.execTokenCount, input.outputTokens),
    outputCost: formatUsd(total.subtract(cost).toAmount(), EXEC_USD_DECIMALS),
    estimate: formatUsd(total.toAmount(), EXEC_USD_DECIMALS),
    cap: formatUsd(input.totals.capUsd, EXEC_USD_DECIMALS),
    spent: formatUsd(
      Usd.from(input.totals.settledUsd).add(Usd.from(input.totals.uncertainUsd)).toAmount(),
      EXEC_USD_DECIMALS,
    ),
  })
  // The cap remedy is a complete clause on its own: ACP and the editor read
  // the shared scope, which never prints the terminal-only flag half. The
  // numbers come from the same helper the typed refusal carries.
  const details = budgetRefusalDetails(input, reserveForOutput, minimumOutputTokens)
  const capClause =
    details.admitCapUsd === null
      ? UI_TEXT.execBudgetImpossible
      : fill(UI_TEXT.execBudgetRemedyCap, {
          admitCap: formatUsd(details.admitCapUsd, 2),
        })
  if (scope === 'shared') return `${base} ${capClause}`
  // The largest output limit that fits the remaining cap, found with the
  // request's own reserve function and the admission's own ceiling, so
  // running again with exactly this value is admitted. Omitted when even
  // the input alone does not fit, which the note says instead.
  if (details.inputAloneExceeds)
    return `${base} ${capClause} ${fill(UI_TEXT.execBudgetRemedyInput, {
      inputCost: formatUsd(details.inputCostUsd, EXEC_USD_DECIMALS),
      remaining: formatUsd(details.remainingUsd, EXEC_USD_DECIMALS),
    })}`
  if (details.maxOutputTokens === null) return `${base} ${capClause}`
  return `${base} ${capClause} ${fill(UI_TEXT.execBudgetRemedyOutput, {
    maxTokens: String(details.maxOutputTokens),
  })}`
}
