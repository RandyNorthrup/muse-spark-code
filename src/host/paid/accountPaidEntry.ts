// dist/accountPaid.js (M108 lane P, PLAN.md D88.7 and D6): paid consent for
// uses billed to another account than the provider's default. The extension
// and the ACP agent load it on the first such use, never at activation; a
// single-account user never loads it. Both editors get the same service, the
// same store and the same words: the use's own question with the account's
// line under it (provider · account, the tariff and the shared daily budget).

import { setTimeout as delay } from 'node:timers/promises'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  GLOBAL_STATE_KEYS,
  MODEL_API_PRICES_PER_MILLION,
  PAID_PRICES_USD,
  type PaidFeature,
} from '../../shared/constants'
import {
  autoReviewPrice,
  modelApiPaidTier,
  paidFeaturePrice,
  scheduledRunPrice,
  type PaidUseRequest,
} from '../../shared/paid'
import { Usd, type UsdAmount } from '../../shared/usd'
import type { PaidUseAnswer, PaidUseConsentDeps } from '../../core/paid/paidConsent'
import {
  AccountPaidUseConsent,
  accountBindingKey,
  paidAccountQuestion,
  type PaidAccountBinding,
} from '../../core/paid/accountPaidConsent'
import type {
  AccountPaidHostAsk,
  AccountPaidService,
  PaidBilling,
} from '../../core/paid/accountPaidRoute'
import { accountPaidFiles } from './accountPaidFiles'

/**
 * The workspace consent's own ports, shared unchanged: the feature gate,
 * where Always may be kept, the judge's price, the window's paid authority
 * (which transport admission checks a search quote against), the approval
 * order, the price-acceptance generation and the host's quote generation (a
 * search Always lapses with it).
 */
export type AccountPaidBase = Pick<
  PaidUseConsentDeps,
  | 'isOn'
  | 'canRemember'
  | 'isJudgeEnabled'
  | 'acceptJudgePrice'
  | 'authority'
  | 'nextQuoteOrder'
  | 'prepareQuoteGeneration'
  | 'quoteGeneration'
  | 'windowOnceGeneration'
  | 'log'
>

export interface AccountPaidServiceDeps {
  readonly base: AccountPaidBase
  /** The account each use bills now: a consent refuses once it no longer does. */
  readonly billing: () => PaidBilling | undefined
  /** This workspace's folder of account consent (owner-only once written). */
  readonly folder: string
  /** The feature's price-acceptance generation: an account's Always lapses with it. */
  readonly featureGeneration: (feature: PaidFeature) => string
  /** The shared daily budget the question names (museSpark.paidDailyBudgetUsd). */
  readonly dailyBudgetUsd: (feature: PaidFeature) => UsdAmount
  readonly ask: AccountPaidHostAsk
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
}

/** A model's tariff as data: its id, its tier and the tier's rates, if priced. */
function modelTariff(modelId: string): readonly unknown[] {
  const tier = modelApiPaidTier(modelId)
  return [modelId, tier ?? null, tier === undefined ? null : MODEL_API_PRICES_PER_MILLION[tier]]
}

/** A model-billed feature's price for the account line: the model's rates when known. */
function modelPrice(feature: PaidFeature, modelId: string): string {
  return modelApiPaidTier(modelId) === undefined
    ? paidFeaturePrice(feature)
    : scheduledRunPrice(modelId)
}

/**
 * The tariff one use is billed at: language-neutral data for the grant's
 * key, and the display-language price the account line states.
 */
export function paidUseTariff(request: PaidUseRequest): {
  readonly tariff: string
  readonly price: string
} {
  const of = (data: readonly unknown[], price: string) => ({
    tariff: JSON.stringify([request.feature, ...data]),
    price,
  })
  switch (request.feature) {
    case 'webSearch': {
      const usd = request.quote?.tariffUsd ?? request.priceUsd
      return of([usd], paidFeaturePrice('webSearch', usd))
    }
    case 'imageGeneration': {
      return of([PAID_PRICES_USD.imageGeneration], paidFeaturePrice('imageGeneration'))
    }
    case 'voice': {
      return of([PAID_PRICES_USD.voicePerHour], paidFeaturePrice('voice'))
    }
    case 'subagents': {
      return of(modelTariff(request.task.modelId), modelPrice('subagents', request.task.modelId))
    }
    case 'teamWorkers': {
      return of(
        request.tasks.map((task) => [
          task.provider ?? 'meta',
          task.priceTier ?? null,
          ...modelTariff(task.modelId),
        ]),
        paidFeaturePrice('teamWorkers'),
      )
    }
    case 'autoReviewer': {
      return of(
        [...modelTariff(request.modelId), request.pricing ?? null],
        autoReviewPrice(request.modelId, request.pricing) ?? paidFeaturePrice('autoReviewer'),
      )
    }
    case 'judge':
    case 'legalExplanation':
    case 'scheduledPrompts':
    case 'bestOfN':
    case 'hookModels':
    case 'tab': {
      return of(modelTariff(request.modelId), modelPrice(request.feature, request.modelId))
    }
  }
}

export function createAccountPaidService(
  table: UiText,
  locale: string,
  deps: AccountPaidServiceDeps,
): AccountPaidService {
  setUiText(table, locale)
  const consents = new Map<string, AccountPaidUseConsent>()
  const bindingFor = (billing: PaidBilling, request: PaidUseRequest): PaidAccountBinding => {
    const { tariff, price } = paidUseTariff(request)
    return {
      provider: billing.provider,
      account: billing.account,
      price,
      tariff,
      dailyBudgetUsd: deps.dailyBudgetUsd(request.feature),
    }
  }
  /** One consent per account, tariff and quoted budget: a new budget quotes anew. */
  const consentFor = (billing: PaidBilling, request: PaidUseRequest) => {
    const binding = bindingFor(billing, request)
    const key = JSON.stringify([accountBindingKey(binding), binding.dailyBudgetUsd])
    const held = consents.get(key)
    if (held !== undefined) return held
    const { feature } = request
    const { base } = deps
    const store = accountPaidFiles(
      {
        folder: deps.folder,
        featureGeneration: deps.featureGeneration,
        sleep: deps.sleep ?? delay,
        log: base.log,
      },
      accountBindingKey(binding),
    )
    const consent = new AccountPaidUseConsent(
      {
        ...store,
        isOn: base.isOn,
        canRemember: base.canRemember,
        ...(base.isJudgeEnabled !== undefined && { isJudgeEnabled: base.isJudgeEnabled }),
        ...(base.acceptJudgePrice !== undefined && { acceptJudgePrice: base.acceptJudgePrice }),
        ...(base.authority !== undefined && { authority: base.authority }),
        ...(base.nextQuoteOrder !== undefined && { nextQuoteOrder: base.nextQuoteOrder }),
        ...(base.prepareQuoteGeneration !== undefined && {
          prepareQuoteGeneration: base.prepareQuoteGeneration,
        }),
        quoteGeneration: () => base.quoteGeneration?.() ?? 'initial',
        // The account, its tariff and the budget the question named are all
        // still the ones that bill; anything else refuses and asks anew.
        isCurrent: (current) => {
          const now = deps.billing()
          return (
            now?.provider === billing.provider &&
            now.account === billing.account &&
            Usd.from(current.dailyBudgetUsd).compare(Usd.from(deps.dailyBudgetUsd(feature))) === 0
          )
        },
        ask: (asked, current, canRemember) =>
          deps.ask(asked, canRemember, paidAccountQuestion(current)),
        log: base.log,
      },
      binding,
    )
    consents.set(key, consent)
    return consent
  }
  return {
    decide: async (billing, request, requiresAsking, ask) =>
      await consentFor(billing, request).decision(
        request,
        requiresAsking,
        ask === undefined
          ? undefined
          : (asked, current, canRemember) => ask(asked, canRemember, paidAccountQuestion(current)),
      ),
    revokeAll: async () => {
      const revoking = Array.from(consents.values(), (consent) => consent.revoke())
      consents.clear()
      await Promise.all(revoking)
    },
  }
}

/** VS Code's composition: its consent's ports, its global state and its modal popup. */
export interface VsCodeAccountPaidDeps extends Pick<
  AccountPaidServiceDeps,
  'base' | 'billing' | 'folder' | 'dailyBudgetUsd'
> {
  /** The extension's global state, where the subagent price acceptance version lives. */
  readonly globalState: { get(key: string): unknown }
  /** askPaidUse: the use's modal, with the account's line and no separate budget line. */
  readonly ask: (
    request: PaidUseRequest,
    canRemember: boolean,
    dailyBudgetUsd: undefined,
    accountLine: string,
  ) => Promise<PaidUseAnswer>
}

/**
 * The extension's account service. An account's Always lapses with what the
 * workspace's does: the feature's price-acceptance generation, the search and
 * Ask again generation, and the subagent price acceptance version.
 */
export function vsCodeAccountPaid(
  table: UiText,
  locale: string,
  deps: VsCodeAccountPaidDeps,
): AccountPaidService {
  const { base } = deps
  return createAccountPaidService(table, locale, {
    base,
    billing: deps.billing,
    folder: deps.folder,
    dailyBudgetUsd: deps.dailyBudgetUsd,
    featureGeneration: (feature) =>
      JSON.stringify([
        base.windowOnceGeneration?.(feature) ?? 0,
        base.quoteGeneration?.() ?? 'initial',
        feature === 'subagents'
          ? (deps.globalState.get(GLOBAL_STATE_KEYS.subagentPriceAcceptance) ?? null)
          : null,
      ]),
    ask: (request, canRemember, line) => deps.ask(request, canRemember, undefined, line),
  })
}
