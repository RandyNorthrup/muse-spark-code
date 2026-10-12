import { Usd, type UsdAmount } from '../shared/usd'
// Durable daily admission for the standalone runtime; no VS Code imports.
import path from 'node:path'
import { createSessionBudgetJournal } from '../host/backend/sessionBudgetJournal'
import {
  isModelApiError,
  type ProviderClient,
  type ResponseAttemptGuard,
} from '../core/backends/modelapi/client'
import {
  metaResolvedModel,
  modelPricedUsage,
  requestImageCount,
  type ModelClient,
  type ResolvedModel,
} from '../core/backends/modelapi/modelPolicy'
import type { SessionBudgetClaim } from '../core/backends/modelapi/sessionBudget'
import type { ResponseObject } from '../core/backends/modelapi/schemas'
import {
  EXEC_USD_DECIMALS,
  HTTP_TOO_MANY_REQUESTS,
  PAID_DAILY_BUDGET,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../shared/constants'
import { scheduleBudget } from '../core/paid/scheduleBudget'
import { readSharedDailyCapUsd } from '../core/paid/sharedDailyCap'
import type { RunLedger, ResponseTicket } from './exec/runLedger'
import type { LastResponse, Refusal } from './exec/execProtocol'

const ceilUsd = (cost: UsdAmount) => Usd.from(cost).ceiling(EXEC_USD_DECIMALS).toAmount()

export function createRuntimeDailyBudget(deps: {
  readonly dataFolder: string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}) {
  const journal = createSessionBudgetJournal({
    directory: path.join(deps.dataFolder, PAID_DAILY_BUDGET.directory),
    sleep: deps.sleep,
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  })
  const day = () => {
    const date = new Date(deps.now())
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
  }
  // The shared daily cap reads the one source both families share: the
  // data-folder settings file with the journal's stop/override. Never the
  // window's VS Code setting, which can name a different number.
  const dailyCapUsd = (scope: string) => readSharedDailyCapUsd(deps.dataFolder, scope)
  return {
    capUsd: () => dailyCapUsd(day()),
    reserveSchedule: scheduleBudget({
      day,
      capUsd: () => dailyCapUsd(day()),
      reserveShared: (scope, amount, cap) =>
        journal.reserveAdmitted(scope, PAID_DAILY_BUDGET.accountId, amount, cap),
      reserveOwn: (scope, amount, cap) =>
        journal.reserveAdmitted(scope, PAID_DAILY_BUDGET.accountId, amount, cap),
    }),
    async reserve(costUsd: UsdAmount, signal: AbortSignal): Promise<SessionBudgetClaim> {
      signal.throwIfAborted()
      const scope = day()
      const claim = await journal.reserveAdmitted(
        scope,
        PAID_DAILY_BUDGET.accountId,
        ceilUsd(costUsd),
        dailyCapUsd(scope),
      )
      try {
        signal.throwIfAborted()
        if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      } catch (error: unknown) {
        await claim.settle(Usd.from(0).toAmount())
        throw error
      }
      return {
        ...claim,
        check: () => {
          signal.throwIfAborted()
          if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
          return claim.check(dailyCapUsd(scope))
        },
      }
    },
  }
}

export interface RuntimeResponseAccounting {
  readonly ledger: RunLedger
  readonly refuse: (reason: Refusal | 'breach' | 'accounting_invalid') => void
  readonly started: (n: number) => void
  readonly settled: (outcome: LastResponse) => void
}

/** Preserve all native clients and codecs; attach admission to their shared transport guard. */
export function withRuntimeAccounting(
  client: ProviderClient,
  daily: ReturnType<typeof createRuntimeDailyBudget>,
  accounting?: RuntimeResponseAccounting,
  outputCap?: (policy: ResolvedModel['policy']) => number,
): ProviderClient {
  const wrap = (model: ResolvedModel): ResolvedModel => {
    outputCap?.(model.policy)
    const original = model.client
    const bounded: ModelClient = {
      currentKeyDigest: original.currentKeyDigest.bind(original),
      countInputTokens: original.countInputTokens.bind(original),
      // Scheduled transport uses its own shared+schedule admission, never a
      // second full-context daily reservation from the interactive wrapper.
      ...(original.withScheduleAuthority !== undefined && {
        withScheduleAuthority: original.withScheduleAuthority.bind(original),
      }),
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
        const reserveUsd = model.price.reserve({
          inputTokens: contextTokens - body.max_output_tokens,
          outputTokens: body.max_output_tokens,
          images: requestImageCount(body),
        })
        if (reserveUsd === undefined || Usd.from(reserveUsd).compare(Usd.from(0)) < 0)
          throw new Error(UI_TEXT.execModelUnpriced)
        let claim: SessionBudgetClaim | undefined
        let ticket: ResponseTicket | undefined
        let wasSent = false
        let response: ResponseObject | undefined
        let hasEof = false
        let isRateLimited = false
        const settle = async () => {
          if (claim === undefined) return
          const owned = claim
          claim = undefined
          const actual =
            hasEof && response?.status === 'completed' && response.usage != null
              ? model.price.settle(modelPricedUsage(response.usage), {
                  cost: response.usage.provider_cost_usd,
                })
              : undefined
          let cost = actual === undefined ? undefined : ceilUsd(actual)
          if (isRateLimited) cost = Usd.from(0).toAmount()
          // A sent request without a verified price keeps its original durable reservation.
          if (!wasSent || cost !== undefined) {
            try {
              await owned.settle(wasSent ? (cost ?? owned.reservedUsd) : Usd.from(0).toAmount())
            } catch (error: unknown) {
              throw new Error(UI_TEXT.sessionBudgetStoreUnavailable, { cause: error })
            }
          }
          if (ticket !== undefined && accounting !== undefined) {
            const result = accounting.ledger.settleResponse(
              ticket,
              {
                ...(hasEof
                  ? ({ kind: 'eof', parseInvalid: false } as const)
                  : ({ kind: 'transport', why: 'error' } as const)),
                terminal: response?.status ?? null,
                incompleteReason: response?.incomplete_details?.reason ?? null,
                usage: response?.usage,
              },
              { costUsd: cost },
            )
            ticket = undefined
            const last = accounting.ledger.lastResponse
            if (last !== null) accounting.settled(last)
            if (result.latch !== undefined) accounting.refuse(result.latch)
          }
          wasSent = false
          response = undefined
          hasEof = false
          isRateLimited = false
        }
        const attempt: ResponseAttemptGuard = Object.assign(
          (digest: string | undefined) => {
            if (!model.isCurrent()) throw new Error(UI_TEXT.requestStaleRun)
            claim?.check(Usd.from(0).toAmount())
            guard?.(digest)
          },
          {
            ...guard,
            prepare: async () => {
              await settle()
              await guard?.prepare?.()
              claim = await daily.reserve(reserveUsd, signal)
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
              const admission = accounting.ledger.admitResponse({
                model: body.model,
                maxOutputTokens: body.max_output_tokens,
                contextTokens,
                reserveUsd: ceilUsd(reserveUsd),
                price,
              })
              if ('refused' in admission) {
                accounting.refuse(admission.refused)
                throw new Error(UI_TEXT.execBudgetRefused)
              }
              ticket = admission
            },
            onRequestStarted: () => {
              wasSent = true
              if (ticket !== undefined) accounting?.started(ticket.n)
              guard?.onRequestStarted?.()
            },
          },
        )
        const responseStream = original.streamResponse(
          body,
          signal,
          (notice) => {
            if (notice.phase !== 'pacing')
              isRateLimited = notice.reason.startsWith(`HTTP ${String(HTTP_TOO_MANY_REQUESTS)}:`)
            onRetry?.(notice)
          },
          retryBudget,
          attempt,
          confirmed,
        )
        try {
          for await (const event of responseStream) {
            if ('response' in event) response = event.response
            yield event
          }
          hasEof = true
        } catch (error: unknown) {
          isRateLimited ||= isModelApiError(error) && error.status === HTTP_TOO_MANY_REQUESTS
          throw error
        } finally {
          await settle()
        }
      },
    }
    return { ...model, client: bounded }
  }
  const resolve = async (ref: string) =>
    wrap(
      client.models === undefined
        ? metaResolvedModel(ref, client)
        : await client.models.resolve(ref),
    )
  return {
    currentKeyDigest: client.currentKeyDigest.bind(client),
    ...(client.withScheduleAuthority !== undefined && {
      withScheduleAuthority: client.withScheduleAuthority.bind(client),
    }),
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
    models: { ...(client.models?.list !== undefined && { list: client.models.list }), resolve },
    async *streamResponse(body, ...args) {
      const model = await resolve(body.model)
      yield* model.client.streamResponse(body, ...args)
    },
  }
}
export { setUiText } from '../shared/l10n/text'
