// Durable daily admission for the standalone runtime; no VS Code imports.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { createSessionBudgetJournal } from '../host/backend/sessionBudgetJournal'
import type { ProviderClient, ResponseAttemptGuard } from '../core/backends/modelapi/client'
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
  EXEC_USD_UNITS,
  PAID_DAILY_BUDGET,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../shared/constants'
import { storeErrorCode } from '../host/backend/storeErrors'
import type { RunLedger, ResponseTicket } from './exec/runLedger'
import type { LastResponse, Refusal } from './exec/execProtocol'

const settingsSchema = z.strictObject({
  paidDailyBudgetUsd: z.optional(
    z
      .number()
      .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  ),
})
const ceilUsd = (cost: number) => Math.ceil(cost * EXEC_USD_UNITS) / EXEC_USD_UNITS

export function createRuntimeDailyBudget(deps: {
  readonly dataFolder: string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}) {
  const journal = createSessionBudgetJournal({
    directory: path.join(deps.dataFolder, PAID_DAILY_BUDGET.directory),
    sleep: deps.sleep,
    initialBudget: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
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
    async reserve(costUsd: number, signal: AbortSignal): Promise<SessionBudgetClaim> {
      signal.throwIfAborted()
      const scope = day()
      const claim = await journal.reserveAdmitted(
        scope,
        PAID_DAILY_BUDGET.accountId,
        ceilUsd(costUsd),
        capUsd(),
      )
      try {
        signal.throwIfAborted()
        if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
      } catch (error: unknown) {
        await claim.settle(0)
        throw error
      }
      return {
        ...claim,
        check: () => {
          signal.throwIfAborted()
          if (scope !== day()) throw new Error(UI_TEXT.paidDailyStopped)
          return claim.check(capUsd())
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
        const reserveUsd = model.price.reserve({
          inputTokens: contextTokens - body.max_output_tokens,
          outputTokens: body.max_output_tokens,
          images: requestImageCount(body),
        })
        if (reserveUsd === undefined || !Number.isFinite(reserveUsd) || reserveUsd < 0)
          throw new Error(UI_TEXT.execModelUnpriced)
        let claim: SessionBudgetClaim | undefined
        let ticket: ResponseTicket | undefined
        let wasSent = false
        let response: ResponseObject | undefined
        let hasEof = false
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
          const cost = actual === undefined ? undefined : ceilUsd(actual)
          // A sent request without a verified price keeps its original durable reservation.
          if (!wasSent || cost !== undefined)
            await owned.settle(wasSent ? (cost ?? owned.reservedUsd) : 0)
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
        }
        const attempt: ResponseAttemptGuard = Object.assign(
          (digest: string | undefined) => {
            if (!model.isCurrent()) throw new Error(UI_TEXT.scheduleConfirmationExpired)
            claim?.check(0)
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
                      input: pricing.card.input * TOKENS_PER_MILLION,
                      cachedInput:
                        (pricing.card.cachedInput ?? pricing.card.input) * TOKENS_PER_MILLION,
                      output: pricing.card.output * TOKENS_PER_MILLION,
                    }
                  : { input: 0, cachedInput: 0, output: 0 }
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
