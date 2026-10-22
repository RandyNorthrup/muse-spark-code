import {
  createTabEngine,
  type TabEngineDeps,
  type TabEngineRequest,
} from '../../core/tab/tabEngine'
import type { ResponseAttemptGuard, RetryBudget } from '../../core/backends/modelapi/client'
import type { CreateResponseBody, StreamEvent } from '../../core/backends/modelapi/schemas'
import { redactSecrets } from '../../core/redact'
import type { BillableUsage } from '../../core/usage/insights'
import type { createRuntimePaidBudget } from './paidBudget'
import {
  runtimePaidRequestAdmission,
  type RuntimePaidRequestDeps,
  type RuntimePaidRequestPrice,
} from './paidRequest'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'
import { Usd, type UsdAmount } from '../../shared/usd'

export interface RuntimeTabDeps {
  readonly stream: (
    body: CreateResponseBody,
    signal: AbortSignal,
    retries: RetryBudget,
    guard: ResponseAttemptGuard,
  ) => AsyncIterable<StreamEvent>
  readonly budget: ReturnType<typeof createRuntimePaidBudget>
  readonly price: RuntimePaidRequestDeps['price']
  readonly isOn: () => boolean
  /** Selected captured request support, including this engine's minimal reasoning/cache fields. */
  readonly canComplete: (model: string) => boolean
  readonly allows: (
    model: string,
    budgetUsd: UsdAmount,
    price: RuntimePaidRequestPrice,
    signal: AbortSignal,
  ) => Promise<boolean>
  readonly assertCurrent: () => void
  readonly cancelPrompts: () => void
  readonly onSent: TabEngineDeps['onSent']
  /**
  Original immutable verified dispatch cost; never a new selection's price reader. A number,
  like PaidUsage.addTabUsage's verified cost.
  */
  readonly onUsage: (model: string, usage: BillableUsage, costUsd: number) => void
}

/** The pure completion engine with consent, one priced attempt, and awaited sent-request settlement. */
export function createRuntimeTab(deps: RuntimeTabDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, () => {
    engine.cancelPending()
    deps.cancelPrompts()
  })
  const draining = new Set<Promise<unknown>>()
  const check = (model: string) => {
    lifetime.check()
    if (!deps.isOn() || !deps.canComplete(model))
      throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
  }
  const engine = createTabEngine({
    onSent: (model) => {
      check(model)
    },
    onUsage: () => {
      // The stream below records usage with its settled immutable tariff.
    },
    stream: async function* (body, signal, retries, admit) {
      check(body.model)
      const price = deps.price(body, 'tab', undefined, lifetime.signal)
      if (!price?.isCurrent()) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      if (!(await deps.allows(body.model, deps.budget.capUsd(), price, lifetime.signal)))
        throw new Error(UI_TEXT.paidDailyStopped)
      check(body.model)
      const admission = runtimePaidRequestAdmission({
        budget: deps.budget,
        price: () => price,
        isOn: deps.isOn,
      })
      const claim = await admission(body, 'tab', undefined, lifetime.signal)
      if (claim === undefined) throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const dispatch = { isSent: false }
      let usage: BillableUsage | undefined
      const beforeSend = () => {
        if (dispatch.isSent) throw new Error(UI_TEXT.paidDailyStopped)
        // The engine's final gate: a cancelled trigger sends nothing.
        admit.check?.()
        check(body.model)
        claim.check()
      }
      const beforeRun: ResponseAttemptGuard = Object.assign(beforeSend, {
        onRequestStarted: () => {
          beforeSend()
          dispatch.isSent = true
          deps.onSent(body.model)
        },
      })
      try {
        for await (const frame of deps.stream(body, signal, retries, beforeRun)) {
          if (
            'response' in frame &&
            frame.response.usage !== undefined &&
            frame.response.usage !== null
          ) {
            usage = {
              inputTokens: frame.response.usage.input_tokens,
              outputTokens: frame.response.usage.output_tokens,
              cachedTokens: frame.response.usage.input_tokens_details?.cached_tokens ?? 0,
            }
          }
          yield frame
        }
      } finally {
        const cost = usage === undefined ? undefined : admission.responseCost(body, 'tab', usage)
        if (!dispatch.isSent) await claim.settle(Usd.from(0).toAmount())
        else if (cost === undefined || !Number.isFinite(cost) || cost < 0)
          await claim.settle(undefined)
        else {
          await claim.settle(Usd.from(cost).toAmount())
          if (usage !== undefined) deps.onUsage(body.model, usage, cost)
        }
      }
    },
  })
  let closing: Promise<void> | undefined
  return {
    complete: (request: TabEngineRequest) =>
      lifetime.track(async () => {
        check(request.model)
        const answer = await engine.complete({
          ...request,
          prefix: redactSecrets(request.prefix),
          suffix: redactSecrets(request.suffix),
          snippets: redactSecrets(request.snippets),
          isCancelled: () => lifetime.signal.aborted || request.isCancelled(),
        })
        const work = (async () => {
          await Promise.allSettled([answer.usage])
        })()
        draining.add(work)
        void (async () => {
          try {
            await work
          } finally {
            draining.delete(work)
          }
        })()
        return answer
      }),
    dispose: () => {
      closing ??= (async () => {
        await lifetime.dispose()
        while (draining.size > 0) await Promise.allSettled(draining)
      })()
      return closing
    },
  }
}
