import { Usd, type UsdAmount } from '../shared/usd'
// Durable daily admission for the standalone runtime; no VS Code imports.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { createSessionBudgetJournal } from '../host/backend/sessionBudgetJournal'
import type {
  ProviderClient,
  ResponseAttemptGuard,
  ResponseObservation,
} from '../core/backends/modelapi/client'
import {
  metaResolvedModel,
  modelPricedUsage,
  requestImageCount,
  type ModelClient,
  type ResolvedModel,
} from '../core/backends/modelapi/modelPolicy'
import {
  estimateInput,
  requestParts,
  type SessionBudgetClaim,
} from '../core/backends/modelapi/sessionBudget'
import { UserRefusalError, isPaidStop } from '../core/refusal'
import type { ResponseObject } from '../core/backends/modelapi/schemas'
import {
  EXEC_USD_DECIMALS,
  HTTP_STATUS,
  HTTP_TOO_MANY_REQUESTS,
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../shared/constants'
import { storeErrorCode } from '../host/backend/storeErrors'
import { type RunLedger, type ResponseTicket, type SettlementResult } from './exec/runLedger'
import type { LastResponse, Refusal, LedgerTotals } from './exec/execProtocol'
import { fill, plural } from '../shared/l10n/text'
import { formatUsd } from '../shared/l10n/exactUsd'
import { isModelApiError } from '../core/backends/modelapi/transport'

const settingsSchema = z.strictObject({
  paidDailyBudgetUsd: z.optional(
    z
      .number()
      .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  ),
})
const ceilUsd = (cost: UsdAmount) => Usd.from(cost).ceiling(EXEC_USD_DECIMALS).toAmount()

export function createRuntimeDailyBudget(deps: {
  readonly dataFolder: string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}) {
  const journal = createSessionBudgetJournal({
    directory: path.join(deps.dataFolder, PAID_DAILY_BUDGET.directory),
    sleep: deps.sleep,
    recoverUnsent: true,
    // D1: the daily refusal carries its numbers, never a generic sentence.
    dailyStop: { setting: 'paidDailyBudgetUsd', nowMs: deps.now },
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  })
  const day = () => {
    const date = new Date(deps.now())
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
  }
  const capUsd = () => {
    try {
      return (
        settingsSchema.parse(
          JSON.parse(readFileSync(path.join(deps.dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')),
        ).paidDailyBudgetUsd ?? SETTING_DEFAULTS.paidDailyBudgetUsd
      )
    } catch (error: unknown) {
      if (storeErrorCode(error) === 'ENOENT') return SETTING_DEFAULTS.paidDailyBudgetUsd
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable, { cause: error })
    }
  }
  return {
    async reserve(costUsd: UsdAmount, signal: AbortSignal): Promise<SessionBudgetClaim> {
      signal.throwIfAborted()
      const scope = day()
      const claim = await journal.reserveAdmitted(
        scope,
        PAID_DAILY_BUDGET.accountId,
        ceilUsd(costUsd),
        Usd.from(capUsd()).toAmount(),
      )
      try {
        signal.throwIfAborted()
        if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      } catch (error: unknown) {
        await claim.settle(Usd.from(0).toAmount())
        // D1: a day rollover between reserve and check still names its
        // numbers; a dead process's hold never refuses (recovered above).
        if (error instanceof Error && error.message === UI_TEXT.paidDailyStopped) {
          try {
            throw await journal.describeStop(
              scope,
              PAID_DAILY_BUDGET.accountId,
              Usd.from(capUsd()).toAmount(),
            )
          } catch {
            throw error
          }
        }
        throw error
      }
      return {
        ...claim,
        check: () => {
          signal.throwIfAborted()
          if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
          return claim.check(Usd.from(capUsd()).toAmount())
        },
      }
    },
  }
}

export interface RuntimeResponseAccounting {
  readonly ledger: RunLedger
  readonly refuse: (reason: Refusal | 'breach' | 'accounting_invalid', message?: string) => void
  readonly started: (n: number, ticket: ResponseTicket) => void
  readonly settled: (
    outcome: LastResponse,
    ticket: ResponseTicket,
    result: SettlementResult,
  ) => void
}

/** Preserve all native clients and codecs; attach admission to their shared transport guard. */
export function withRuntimeAccounting(
  client: ProviderClient,
  daily: ReturnType<typeof createRuntimeDailyBudget>,
  accounting?: RuntimeResponseAccounting,
  dispatch?: { onRequestStarted?: () => void },
): ProviderClient {
  const wrap = (model: ResolvedModel): ResolvedModel => {
    const original = model.client
    const bounded: ModelClient = {
      currentKeyDigest: original.currentKeyDigest.bind(original),
      countInputTokens: original.countInputTokens.bind(original),
      listModels: original.listModels.bind(original),
      retryDelayMs: original.retryDelayMs.bind(original),
      waitBeforeRetry: original.waitBeforeRetry.bind(original),
      async *streamResponse(body, signal, onRetry, retryBudget, guard, confirmed) {
        const contextTokens = model.contextTokens
        if (
          contextTokens === undefined ||
          !Number.isSafeInteger(contextTokens) ||
          contextTokens < body.max_output_tokens
        )
          throw new Error(UI_TEXT.execModelUnpriced)
        const inputTokens =
          guard?.mediaAccounting?.inputTokens ??
          estimateInput(requestParts(body), undefined).inputTokens
        const inputCost = model.price.reserve({
          inputTokens,
          outputTokens: 0,
          images: requestImageCount(body),
        })
        const reserveUsd = model.price.reserve({
          inputTokens,
          outputTokens: body.max_output_tokens,
          images: requestImageCount(body),
        })
        if (
          inputCost === undefined ||
          reserveUsd === undefined ||
          Usd.from(reserveUsd).compare(Usd.from(0)) < 0
        )
          throw new Error(UI_TEXT.execModelUnpriced)
        let claim: SessionBudgetClaim | undefined
        let ticket: ResponseTicket | undefined
        let wasSent = false
        let response: ResponseObject | undefined
        let httpStatus: number | undefined
        let hasEof = false
        const settle = async () => {
          if (claim === undefined) return
          const owned = claim
          const actual =
            hasEof && response?.status === 'completed' && response.usage != null
              ? model.price.settle(modelPricedUsage(response.usage), {
                  cost: response.usage.provider_cost_usd,
                })
              : undefined
          const cost =
            httpStatus === HTTP_TOO_MANY_REQUESTS || httpStatus === HTTP_STATUS.badRequest
              ? Usd.from(0).toAmount()
              : actual === undefined
                ? undefined
                : ceilUsd(actual)
          // A sent request without a verified price keeps its original durable reservation.
          if (!wasSent && ticket !== undefined) {
            accounting?.ledger.releaseResponse(ticket)
            ticket = undefined
          }
          if (ticket !== undefined && accounting !== undefined) {
            const result = accounting.ledger.settleResponse(
              ticket,
              {
                ...(httpStatus === undefined
                  ? {
                      ...(hasEof
                        ? ({ kind: 'eof', parseInvalid: false } as const)
                        : ({ kind: 'transport', why: 'error' } as const)),
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
          await owned.settle(
            wasSent ? (cost ?? owned.reservedUsd) : Usd.from(0).toAmount(),
            wasSent && cost === undefined,
          )
          claim = undefined
          wasSent = false
          response = undefined
          hasEof = false
          httpStatus = undefined
        }
        const started = () => {
          claim?.check(Usd.from(0).toAmount())
          if (ticket !== undefined) accounting?.started(ticket.n, ticket)
          claim?.markSent?.()
          wasSent = true
        }
        const attempt: ResponseAttemptGuard = Object.assign(
          (digest: string | undefined) => {
            if (!model.isCurrent()) throw new Error(UI_TEXT.scheduleConfirmationExpired)
            claim?.check(Usd.from(0).toAmount())
            guard?.(digest)
          },
          {
            ...guard,
            observe: (observation: ResponseObservation) => {
              if (observation.rateLimited === true) httpStatus = HTTP_TOO_MANY_REQUESTS
              guard?.observe?.(observation)
            },
            prepare: async () => {
              await settle()
              await guard?.prepare?.()
              try {
                claim = await daily.reserve(reserveUsd, signal)
              } catch (error: unknown) {
                // D1: the refusal keeps its own numbers sentence into the result.
                if (isPaidStop(error) && error instanceof Error)
                  accounting?.refuse('budget', error.message)
                throw error
              }
              if (accounting === undefined) return
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
              try {
                signal.throwIfAborted()
                admission = accounting.ledger.admitResponse({
                  model: body.model,
                  maxOutputTokens: body.max_output_tokens,
                  contextTokens,
                  reserveUsd: ceilUsd(reserveUsd),
                  price,
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
                switch (refused) {
                  case 'budget': {
                    message = responseReservationMessage({
                      inputTokens,
                      inputCost,
                      outputTokens: body.max_output_tokens,
                      reserveUsd,
                      totals,
                    })
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
                accounting.refuse(admission.refused, message)
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
        try {
          for await (const event of original.streamResponse(
            body,
            signal,
            onRetry,
            retryBudget,
            attempt,
            confirmed,
          )) {
            if ('response' in event) response = event.response
            yield event
          }
          hasEof = true
        } catch (error: unknown) {
          if (isModelApiError(error) && error.status > 0) httpStatus = error.status
          if (
            error instanceof Error &&
            error.name === 'UserRefusalError' &&
            'code' in error &&
            error.code === 'not_sent'
          ) {
            wasSent = false
            claim?.markUnsent?.()
          }
          // D1: a dispatch-time paid stop latches the budget with its own
          // numbers sentence, so the turn ends as a budget stop (exit 5).
          if (isPaidStop(error) && error instanceof Error)
            accounting?.refuse('budget', error.message)
          throw error
        } finally {
          if (dispatch?.onRequestStarted === started) delete dispatch.onRequestStarted
          try {
            await settle()
          } catch {
            await settle()
          }
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
          ? metaResolvedModel(ref, client)
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
    createImage: client.createImage.bind(client),
    editImage: client.editImage.bind(client),
    hasPaidDailyBudget: client.hasPaidDailyBudget,
    ...(client.provider !== undefined && { provider: client.provider }),
    ...(client.modelContextLimit !== undefined && {
      modelContextLimit: client.modelContextLimit.bind(client),
    }),
    ...(client.isPlanModel !== undefined && { isPlanModel: client.isPlanModel.bind(client) }),
    ...(client.readPlanUsage !== undefined && { readPlanUsage: client.readPlanUsage.bind(client) }),
    models: { ...client.models, resolve },
    async *streamResponse(body, ...args) {
      const model = await resolve(body.model)
      yield* model.client.streamResponse(body, ...args)
    },
  }
}
export { setUiText } from '../shared/l10n/text'

/** One localized arithmetic sentence for daily/provider and headless Meta admission. */
export function responseReservationMessage(input: {
  readonly inputTokens: number
  readonly inputCost: UsdAmount
  readonly outputTokens: number
  readonly reserveUsd: UsdAmount
  readonly totals: LedgerTotals
}): string {
  const cost = Usd.from(input.inputCost).ceiling(EXEC_USD_DECIMALS)
  const total = Usd.from(input.reserveUsd).ceiling(EXEC_USD_DECIMALS)
  return fill(UI_TEXT.execBudgetQuote, {
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
}

export { assembleProviderRun } from './exec/providerExec'
export { providersFilePath, resolveEndpointHost } from './providersCommands'

export { createSessionBudgetJournal } from '../host/backend/sessionBudgetJournal'
