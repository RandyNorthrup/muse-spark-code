import { randomUUID } from 'node:crypto'
// Asking before each paid use (M58, PLAN.md D48). The owner (2026-09-27):
// "anything requiring extra payment should promt you with a popup that asks
// allow once allow always in this workspace or deny".
//
// Every use of a paid feature (a prompt that may search the web, an image,
// a Muse Voice recording, a scheduled run, a subagent task) asks in a popup
// with those three answers, in every permission mode, Bypass included. "Allow
// always in this workspace" is kept per workspace and only in a trusted one;
// it lapses in every workspace when the feature's price acceptance changes
// (the feature turned off, or a new price accepted), and Account & usage
// takes it back. A use that no longer asks is still loud: its row is marked
// paid, the badge names the feature, and the tally counts it.
//
// No `vscode` here: the host injects the popup and the stores. The popup's
// words are here, so VS Code's modal and the ACP agent's permission request
// (D62) say the same.

import {
  ACCOUNT_ID_PATTERN,
  PAID_FEATURES,
  type PaidFeature,
  UI_TEXT,
  DEFAULT_MODEL_ID,
} from '../../shared/constants'
import { fill, formatNumber, formatUsd, uiLocale } from '../../shared/l10n/text'
import {
  paidFeaturePrice,
  freezePaidQuote,
  type PaidQuote,
  type PaidUseDecision,
  paidFeatureName,
  autoReviewPrice,
  bestOfNPrice,
  modelApiPaidTier,
  hookModelPrice,
  type PaidUseRequest,
  scheduledRunPrice,
  subagentTaskPrice,
} from '../../shared/paid'
import { Usd, minUsd, nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
import type { CreateResponseBody, CreateImageBody } from '../backends/modelapi/schemas'
import type { SessionBudgetClaim } from '../backends/modelapi/sessionBudget'

import type { CoreLogger } from '../logging'
import { PaidAuthority, paidAuthorityKey, type PaidGrant } from './paidAuthority'
import {
  schedulePaidConsentSchema,
  type ScheduleV2,
  type ScheduleFireRecord,
} from '../../shared/scheduleV2'
import { unlessAborted } from '../timeouts'

async function paidTeamRuntime() {
  const entry = await import('../team/teamEntry')
  return entry.createTeamRuntime(UI_TEXT, uiLocale())
}

/** The popup's three answers. */
export type PaidUseAnswer = 'once' | 'always' | 'deny'

/** A verified selected-model tariff, not a provider-name assumption. No credential value. */
export interface SchedulePaidIdentity {
  readonly modelId: string
  readonly accountId: string
  readonly priceTier: string
  readonly price: string
  readonly sharedDailyBudgetUsd: UsdAmount
}

export type ScheduleConsent = NonNullable<ScheduleV2['paidConsent']>

export function isScheduleConsentCurrent(
  schedule: ScheduleV2,
  identity: SchedulePaidIdentity,
): boolean {
  const consent = schedule.paidConsent
  return (
    schedule.action.kind === 'prompt' &&
    consent !== undefined &&
    nonnegativeUsdSchema.safeParse(consent.dailyCapUsd).success &&
    consent.dailyCapUsd !== '0' &&
    nonnegativeUsdSchema.safeParse(consent.sharedDailyBudgetUsd).success &&
    consent.sharedDailyBudgetUsd !== '0' &&
    consent.modelId === identity.modelId &&
    consent.accountId === identity.accountId &&
    consent.priceTier === identity.priceTier &&
    consent.sharedDailyBudgetUsd === identity.sharedDailyBudgetUsd &&
    Usd.from(consent.dailyCapUsd).compare(Usd.from(schedule.paidCapUsd)) <= 0 &&
    Usd.from(consent.dailyCapUsd).compare(Usd.from(schedule.grant.paidCapUsd)) <= 0
  )
}

/** Creation/renewal only. No workspace-wide grant can silently authorize a schedule. */
export async function askSchedulePaidConsent(deps: {
  readonly schedule: ScheduleV2
  readonly identity: SchedulePaidIdentity
  readonly cadence: string
  readonly extras: ScheduleConsent['extras']
  readonly now: () => number
  readonly isOn: () => boolean
  readonly isCurrent: () => boolean
  readonly ask: (question: { title: string; detail: string }) => Promise<PaidUseAnswer>
  /** S/W binds revisioned CAS; false refuses rather than restoring stale consent. */
  readonly remember: (consent: ScheduleConsent) => Promise<boolean>
}): Promise<ScheduleConsent | undefined> {
  const { schedule, identity } = deps
  if (
    schedule.action.kind !== 'prompt' ||
    !deps.isOn() ||
    !deps.isCurrent() ||
    identity.price.trim() === '' ||
    !nonnegativeUsdSchema.safeParse(identity.sharedDailyBudgetUsd).success ||
    minUsd(schedule.paidCapUsd, schedule.grant.paidCapUsd, identity.sharedDailyBudgetUsd) === '0'
  )
    return undefined
  if (
    isScheduleConsentCurrent(schedule, identity) &&
    deps.extras.length === schedule.paidConsent?.extras.length &&
    deps.extras.every((feature) => schedule.paidConsent?.extras.includes(feature) === true)
  )
    return schedule.paidConsent
  const consent = schedulePaidConsentSchema.parse({
    modelId: identity.modelId,
    accountId: identity.accountId,
    priceTier: identity.priceTier,
    sharedDailyBudgetUsd: identity.sharedDailyBudgetUsd,
    grantedAtMs: deps.now(),
    dailyCapUsd: minUsd(schedule.paidCapUsd, schedule.grant.paidCapUsd),
    extras: deps.extras,
  })
  const answer = await deps.ask({
    title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.paidScheduledName }),
    detail:
      fill(UI_TEXT.scheduleV2.messages.paidConsent, {
        prompt: schedule.action.prompt,
        model: identity.modelId,
        price: identity.price,
        cadence: deps.cadence,
        cap: formatUsd(consent.dailyCapUsd, 2),
        budget: formatUsd(identity.sharedDailyBudgetUsd, 2),
      }) +
      (deps.extras.length === 0
        ? ''
        : `\n${deps.extras.map((feature) => `${paidFeatureName(feature)}: ${paidFeaturePrice(feature)}`).join(', ')}`),
  })
  if (answer === 'deny' || !deps.isOn() || !deps.isCurrent()) return undefined
  if (answer === 'always' && !(await deps.remember(consent))) return undefined
  return deps.isOn() && deps.isCurrent() ? consent : undefined
}

/** The run's paid port: live identity/gates plus a hard, noninteractive reservation. */
export function createSchedulePaidScope(deps: {
  readonly backend: 'modelApi' | 'museCode'
  readonly schedule: ScheduleV2
  readonly identity: SchedulePaidIdentity
  readonly currentIdentity: () => SchedulePaidIdentity
  readonly isCurrent: () => boolean
  readonly isOn: (feature: PaidFeature) => boolean
  readonly estimate: (
    body: CreateResponseBody | CreateImageBody,
    inputTokens: number | undefined,
  ) => UsdAmount
  readonly reserve: (
    schedule: ScheduleV2,
    costUsd: UsdAmount,
    signal: AbortSignal,
  ) => Promise<SessionBudgetClaim>
}) {
  const isValid = () =>
    deps.isCurrent() && isScheduleConsentCurrent(deps.schedule, deps.currentIdentity())
  const canUse = (feature: PaidFeature) =>
    isValid() &&
    (deps.backend === 'museCode' || deps.isOn('scheduledPrompts')) &&
    deps.isOn(feature) &&
    (feature === 'scheduledPrompts'
      ? deps.backend === 'modelApi'
      : deps.schedule.paidConsent?.extras.includes(feature) === true)
  const claims = new Map<string, { usd: UsdAmount; settled: boolean }>()
  let settledUsd = Usd.from(0)
  let hasUnknown = false
  return {
    modelId: deps.identity.modelId,
    accountId: deps.identity.accountId,
    allows: canUse,
    cost: (): ScheduleFireRecord['cost'] => {
      let retainedLiabilityUsd = Usd.from(0)
      for (const claim of claims.values()) {
        if (!claim.settled) retainedLiabilityUsd = retainedLiabilityUsd.add(Usd.from(claim.usd))
      }
      // Fire records persist exact settled and retained amounts.
      return {
        usd: settledUsd.toAmount(),
        certainty:
          hasUnknown || retainedLiabilityUsd.compare(Usd.from(0)) > 0 ? 'unknown' : 'exact',
        retainedLiabilityUsd: retainedLiabilityUsd.toAmount(),
      }
    },
    reserve: async (
      body: CreateResponseBody | CreateImageBody,
      inputTokens: number | undefined,
      signal: AbortSignal,
      reservationUsd?: UsdAmount,
    ): Promise<SessionBudgetClaim> => {
      signal.throwIfAborted()
      if (
        !canUse('input' in body ? 'scheduledPrompts' : 'imageGeneration') ||
        ('input' in body && body.model !== deps.identity.modelId)
      )
        throw new Error(UI_TEXT.scheduleV2.messages.changedConsent)
      const feature = 'input' in body ? 'scheduledPrompts' : 'imageGeneration'
      const costUsd = reservationUsd ?? deps.estimate(body, inputTokens)
      if (Usd.from(costUsd).compare(Usd.from(0)) <= 0)
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const claim = await deps.reserve(deps.schedule, costUsd, signal)
      claims.set(claim.claimId, { usd: claim.reservedUsd, settled: false })
      const check = () => {
        signal.throwIfAborted()
        if (!canUse(feature)) throw new Error(UI_TEXT.scheduleV2.messages.changedConsent)
        return claim.check(Usd.from(0).toAmount())
      }
      const settle = async (actualCostUsd: UsdAmount, hasUnknownCost = false) => {
        // D95.3: a hard cap never accepts spend beyond the admitted claim.
        if (Usd.from(actualCostUsd).compare(Usd.from(claim.reservedUsd)) > 0)
          throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        const total = await claim.settle(actualCostUsd, hasUnknownCost)
        const own = claims.get(claim.claimId)
        if (own !== undefined && !own.settled) {
          own.settled = !hasUnknownCost
          own.usd = actualCostUsd
          if (!hasUnknownCost) settledUsd = settledUsd.add(Usd.from(actualCostUsd))
          hasUnknown ||= hasUnknownCost
        }
        return total
      }
      try {
        check()
      } catch (error: unknown) {
        await settle(Usd.from(0).toAmount())
        throw error
      }
      return { ...claim, check, settle }
    },
  }
}

/** The popup's question and what it says about the use, in the display language. */
export async function paidUseQuestion(request: PaidUseRequest): Promise<{
  readonly title: string
  readonly detail: string
}> {
  switch (request.feature) {
    case 'judge': {
      const price = autoReviewPrice(request.modelId)
      if (price === undefined || Usd.from(request.dailyBudgetUsd).compare(Usd.from(0)) < 0)
        throw new Error('Judge use needs a verified tariff and daily budget')
      return {
        title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.paidJudgeName }),
        detail: fill(UI_TEXT.paidConfirmJudge, {
          price,
          budget: formatUsd(request.dailyBudgetUsd, 2),
        }),
      }
    }
    case 'webSearch': {
      return {
        title: UI_TEXT.paidUseWebSearchTitle,
        detail: [
          fill(UI_TEXT.paidUseWebSearchDetail, {
            price: paidFeaturePrice('webSearch', request.quote?.tariffUsd ?? request.priceUsd),
          }),
          ...(request.quote === undefined
            ? []
            : [
                fill(UI_TEXT.paidSearchQuote, {
                  provider: request.quote.provider,
                  model: request.quote.model,
                }),
              ]),
        ].join('\n'),
      }
    }
    case 'voice': {
      return {
        title: UI_TEXT.paidUseVoiceTitle,
        detail: fill(UI_TEXT.paidUseVoiceDetail, { price: paidFeaturePrice('voice') }),
      }
    }
    case 'imageGeneration': {
      // Every image, whatever the backend or permission mode: what is made,
      // from what, and that the key pays for it (M34, M44).
      const sources = request.sources.join(', ')
      return {
        title: fill(request.kind === 'edit' ? UI_TEXT.imageBuyEditTitle : UI_TEXT.imageBuyTitle, {
          path: request.path,
        }),
        detail: [
          fill(UI_TEXT.imageBuyPrompt, { prompt: request.prompt }),
          ...(sources === '' ? [] : [fill(UI_TEXT.imageBuySources, { paths: sources })]),
          fill(UI_TEXT.imageBuyBilling, { price: paidFeaturePrice('imageGeneration') }),
        ].join('\n\n'),
      }
    }
    case 'scheduledPrompts': {
      return {
        title: fill(UI_TEXT.scheduleRunConfirmTitle, { model: request.modelId }),
        detail: [
          fill(UI_TEXT.scheduleRunConfirmPrompt, { prompt: request.prompt }),
          fill(UI_TEXT.scheduleRunConfirmPrice, { price: scheduledRunPrice(request.modelId) }),
          UI_TEXT.scheduleRunConfirmExtras,
        ].join('\n\n'),
      }
    }
    case 'subagents': {
      const { task } = request
      return {
        title: fill(UI_TEXT.paidSubagentTaskTitle, { role: task.role }),
        detail: fill(UI_TEXT.paidSubagentTaskDetail, {
          objective: task.objective,
          price: subagentTaskPrice(task.modelId, task.attemptLimit),
        }),
      }
    }
    case 'autoReviewer': {
      const price = autoReviewPrice(request.modelId, request.pricing)
      if (price === undefined) throw new Error(UI_TEXT.autoReviewerFailed)
      return {
        title: fill(UI_TEXT.paidUseAutoReviewerTitle, { tool: request.tool }),
        detail: fill(UI_TEXT.paidUseAutoReviewerDetail, {
          action: request.action,
          model: request.modelId,
          price,
        }),
      }
    }
    case 'legalExplanation': {
      const price = autoReviewPrice(request.modelId)
      if (price === undefined) throw new Error(UI_TEXT.subagentTariffUnknown)
      return {
        title: UI_TEXT.legalExplainPaid,
        detail: fill(UI_TEXT.legalExplainConsent, { price, model: request.modelId }),
      }
    }
    case 'bestOfN': {
      return {
        title: fill(UI_TEXT.paidBestOfNTitle, { attempts: formatNumber(request.attempts) }),
        detail: fill(UI_TEXT.paidBestOfNDetail, {
          prompt: request.prompt,
          price: bestOfNPrice(request.modelId, request.attempts, request.requestCeilingPerAttempt),
        }),
      }
    }
    case 'teamWorkers': {
      const runtime = await paidTeamRuntime()
      return runtime.teamWorkerQuestion(request)
    }
    case 'hookModels': {
      return {
        title: fill(UI_TEXT.paidHookModelTitle, { event: request.event }),
        detail: fill(UI_TEXT.paidHookModelDetail, {
          kind: request.kind,
          model: request.modelId,
          price:
            request.dailyBudgetUsd === undefined
              ? hookModelPrice(request.modelId)
              : `${hookModelPrice(request.modelId)} ${fill(UI_TEXT.paidHookModelDailyBudget, { budget: formatUsd(request.dailyBudgetUsd, 2) })}`,
        }),
      }
    }
    case 'tab': {
      // Tab bills the request's model per token (M94, PLAN.md D73): the
      // popup names its rates, today's budget and the training note. An
      // unpriced model has no rate to quote, so it never reaches a popup.
      const tier = modelApiPaidTier(request.modelId)
      if (tier === undefined) {
        throw new Error(UI_TEXT.subagentTariffUnknown)
      }
      return {
        title: UI_TEXT.paidUseTabTitle,
        detail: fill(UI_TEXT.paidUseTabDetail, {
          model: request.modelId,
          price: scheduledRunPrice(request.modelId),
          budget: formatUsd(request.budgetUsd, 2),
          training: tier === 'contributor' ? UI_TEXT.tabTrainingContributor : '',
        }),
      }
    }
  }
}

export interface PaidUseConsentDeps {
  /** Whether the feature may be used at all: its setting on and its price accepted. */
  readonly isOn: (feature: PaidFeature) => boolean
  /**
   * Features whose "Allow once" covers this window until it closes (Tab and
   * hosted search, D48): kept in memory only, never stored, so nothing persists
   * past the window. "Allow always" stays workspace-scoped for every
   * feature, window-once ones included.
   */
  readonly windowOnceFeatures?: ReadonlySet<PaidFeature>
  /**
   * The feature's shared price-acceptance generation, as workspace grants
   * are checked against (M58). A window-once grant holds only while the
   * generation it was given under is current, so a price withdrawn and
   * accepted again in another window makes this window ask again.
   */
  readonly windowOnceGeneration?: (feature: PaidFeature) => number
  /** Judge defaults on; its first actual paid use accepts price in this same popup. */
  readonly isJudgeEnabled?: (() => boolean) | undefined
  readonly acceptJudgePrice?: (() => Promise<boolean>) | undefined
  /** A trusted workspace with a folder open: the only place "always" is offered and kept. */
  readonly canRemember: () => boolean
  /** The features allowed always in this workspace, still valid (the host drops lapsed ones). */
  readonly readGrants: () => ReadonlySet<PaidFeature>
  readonly writeGrants: (grants: ReadonlySet<PaidFeature>) => Promise<void>
  /** Valid workspace scopes, invalidated with price acceptance/setting changes like ordinary grants.
   * Both stores are required to offer team Always; a feature-only legacy grant never authorizes it.
   */
  readonly readTeamGrants?: () => ReadonlySet<string>
  readonly writeTeamGrants?: (grants: ReadonlySet<string>) => Promise<void>
  /** Account owner performs the read/merge/write inside its serialized mutation. */
  readonly rememberGrant?: (feature: PaidFeature) => Promise<void>
  /** The popup; "always" is offered only when `canRemember` is true. */
  readonly ask: (request: PaidUseRequest, canRemember: boolean) => Promise<PaidUseAnswer>
  readonly authority?: PaidAuthority
  readonly nextQuoteOrder?: () => number | Promise<number>
  readonly prepareQuoteGeneration?: () => Promise<string>
  readonly quoteGeneration?: () => string
  readonly readQuoteGrant?: (quote: PaidQuote) => PaidGrant | undefined
  readonly writeQuoteGrant?: (grant: PaidGrant) => Promise<void>
  readonly revokeQuoteGrants?: () => Promise<void>
  readonly log: CoreLogger
}

export class PaidUseConsent {
  private revocation = 0
  private readonly listeners = new Set<() => void>()
  /**
   * Window-once grants this instance gave, each with the price-acceptance
   * generation it was given under: memory only, never stored.
   */
  private readonly windowOnce = new Map<PaidFeature, number | undefined>()
  /**
   * A window-once feature's first question while it is open: ordinary uses
   * that arrive meanwhile share it and its answer instead of asking again.
   */
  private readonly pendingWindowOnce = new Map<PaidFeature, Promise<boolean>>()
  private readonly searchWindowOnce = new Set<string>()
  private readonly pendingSearchWindowOnce = new Map<string, Promise<PaidUseAnswer>>()

  public readonly authority: PaidAuthority

  public constructor(private readonly deps: PaidUseConsentDeps) {
    this.authority = deps.authority ?? new PaidAuthority()
  }

  private quoteGeneration(): string {
    return JSON.stringify([this.revocation, this.deps.quoteGeneration?.() ?? 'initial'])
  }

  /** Whether the feature's "Allow once" covers the window (D48). */
  private isWindowOnceFeature(feature: PaidFeature): boolean {
    return this.deps.windowOnceFeatures?.has(feature) ?? false
  }

  /**
   * Whether an "Allow once" for the feature covers this window: given here,
   * under the price acceptance that is still current in every window.
   */
  private isWindowOnce(feature: PaidFeature): boolean {
    return (
      this.isWindowOnceFeature(feature) &&
      this.windowOnce.has(feature) &&
      this.windowOnce.get(feature) === this.deps.windowOnceGeneration?.(feature)
    )
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * Keeps "always" for the feature. A store that cannot be written is
   * logged and leaves this use allowed once, so the next one asks again
   * instead of this one failing.
   */
  private async remember(feature: PaidFeature): Promise<boolean> {
    try {
      if (this.deps.rememberGrant === undefined)
        await this.deps.writeGrants(new Set([...this.deps.readGrants(), feature]))
      else await this.deps.rememberGrant(feature)
      return true
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid use of ${feature}: "always" could not be kept, so it is allowed once: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  /** A search "always" that cannot be kept: logged, and this use goes ahead once. */
  private warnQuoteNotKept(error: unknown): void {
    this.deps.log.warn(
      `Paid search quote could not be kept: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  /**
   * The approval order a search "always" is kept under. A store that cannot
   * hand one out (read-only or corrupt) is treated like one that cannot save
   * the grant: none is returned, so the approved use goes ahead once and the
   * next one asks again.
   */
  private async searchApprovalOrder(
    quote: PaidQuote,
    prior: PaidGrant | undefined,
  ): Promise<number | undefined> {
    try {
      return await (this.deps.nextQuoteOrder?.() ?? this.authority.nextOrder(quote, prior))
    } catch (error: unknown) {
      this.warnQuoteNotKept(error)
      return undefined
    }
  }

  private isEnabled(feature: PaidFeature): boolean {
    return feature === 'judge'
      ? (this.deps.isJudgeEnabled?.() ?? this.deps.isOn(feature))
      : this.deps.isOn(feature)
  }

  /** Asks in the popup now and keeps what the answer grants. */
  private async decide(request: PaidUseRequest, ask: PaidUseConsentDeps['ask']): Promise<boolean> {
    const { feature } = request
    const canRemember = this.deps.canRemember()
    const answer = await ask(request, canRemember)
    if (answer === 'deny') {
      this.deps.log.info(`Paid use of ${feature}: denied`)
      return false
    }
    if (!this.isEnabled(feature)) {
      this.deps.log.info(`Paid use of ${feature}: turned off while the popup was open`)
      return false
    }
    if (
      feature === 'judge' &&
      this.deps.acceptJudgePrice !== undefined &&
      (!(await this.deps.acceptJudgePrice()) || !this.isEnabled(feature))
    )
      return false
    if (
      answer === 'always' &&
      canRemember &&
      this.deps.canRemember() &&
      (await this.remember(feature))
    ) {
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      this.notify()
    } else if (answer === 'once' && this.isWindowOnceFeature(feature)) {
      this.windowOnce.set(feature, this.deps.windowOnceGeneration?.(feature))
      this.deps.log.info(`Paid use of ${feature}: allowed once in this window`)
    } else {
      this.deps.log.info(`Paid use of ${feature}: allowed once`)
    }
    return true
  }

  private async allowSearch(
    request: Extract<PaidUseRequest, { feature: 'webSearch' }>,
    requiresAsking: boolean,
    ask: PaidUseConsentDeps['ask'],
  ): Promise<PaidQuote | undefined> {
    if (!this.isEnabled('webSearch')) return undefined
    const localGeneration = this.revocation
    const storedGeneration =
      this.deps.prepareQuoteGeneration === undefined
        ? (this.deps.quoteGeneration?.() ?? 'initial')
        : await this.deps.prepareQuoteGeneration()
    if (
      localGeneration !== this.revocation ||
      storedGeneration !== (this.deps.quoteGeneration?.() ?? 'initial')
    )
      return undefined
    const quote = freezePaidQuote(
      request.quote ?? {
        id: randomUUID(),
        feature: 'webSearch',
        provider: 'meta',
        model: DEFAULT_MODEL_ID,
        modelRevision: 0,
        tariffUsd: Usd.from(request.priceUsd).toAmount(),
        unit: 'search',
        capturedAt: Date.now(),
      },
    )
    const generation = JSON.stringify([localGeneration, storedGeneration])
    const priceGeneration = this.deps.windowOnceGeneration?.('webSearch')
    const windowKey = JSON.stringify([
      paidAuthorityKey(quote),
      quote.modelRevision,
      quote.tariffUsd,
      generation,
      priceGeneration,
    ])
    const stored = this.deps.readQuoteGrant?.(quote)
    let remembered: PaidGrant | undefined
    if (this.deps.readQuoteGrant === undefined) remembered = this.authority.grant(quote)
    else if (stored !== undefined)
      remembered = { ...stored, generation: JSON.stringify([this.revocation, stored.generation]) }
    const prior = remembered?.generation === generation ? remembered : undefined
    let tag: PaidGrant = { quote, generation, order: this.authority.nextOrder(quote, prior) }
    const effects = this.authority.dispatch({
      type: 'quote',
      ...tag,
      ...(prior !== undefined && { grant: prior }),
      ask: requiresAsking || !this.deps.canRemember(),
    })
    const isCurrent = () => {
      const observed = this.deps.readQuoteGrant?.(quote)
      if (observed !== undefined)
        this.authority.dispatch({
          type: 'observedGrant',
          grant: {
            ...observed,
            generation: JSON.stringify([this.revocation, observed.generation]),
          },
        })
      if (generation !== this.quoteGeneration()) {
        this.authority.dispatch({
          type: 'revoke',
          key: paidAuthorityKey(quote),
          generation: this.quoteGeneration(),
          previousGeneration: generation,
        })
        return false
      }
      const isLive =
        this.isEnabled('webSearch') &&
        priceGeneration === this.deps.windowOnceGeneration?.('webSearch') &&
        request.isCurrent?.() !== false &&
        this.authority.isCurrent(tag)
      if (!isLive) this.authority.dispatch({ type: 'invalidate', grant: tag })
      return isLive
    }
    if (!isCurrent()) return undefined
    this.authority.bind(quote, isCurrent)
    if (effects.length === 0) return quote
    const isWindowUse = !requiresAsking && this.isWindowOnceFeature('webSearch')
    let answer: PaidUseAnswer
    if (isWindowUse && this.searchWindowOnce.has(windowKey)) answer = 'once'
    else {
      const pending = isWindowUse ? this.pendingSearchWindowOnce.get(windowKey) : undefined
      const question = pending ?? ask({ ...request, quote }, this.deps.canRemember())
      if (isWindowUse) this.pendingSearchWindowOnce.set(windowKey, question)
      try {
        answer = await question
      } finally {
        if (this.pendingSearchWindowOnce.get(windowKey) === question)
          this.pendingSearchWindowOnce.delete(windowKey)
      }
    }
    if (!isCurrent()) return undefined
    if (answer === 'once' && isWindowUse) this.searchWindowOnce.add(windowKey)
    const approvalOrder =
      answer === 'always' && this.deps.canRemember()
        ? await this.searchApprovalOrder(quote, prior)
        : undefined
    if (!isCurrent()) return undefined
    const isKept = approvalOrder !== undefined && this.deps.canRemember()
    const saving = this.authority.dispatch({
      type: 'answer',
      grant: tag,
      ...(isKept && { approvalOrder }),
      answer: answer === 'always' && !isKept ? 'once' : answer,
    })
    for (const effect of saving) {
      if (effect.type !== 'save') continue
      tag = effect.grant
      let isOk = false
      try {
        if (this.deps.writeQuoteGrant === undefined) isOk = await this.remember('webSearch')
        else {
          await this.deps.writeQuoteGrant({ ...effect.grant, generation: storedGeneration })
          isOk = true
        }
      } catch (error: unknown) {
        this.warnQuoteNotKept(error)
      }
      if (!isCurrent()) return undefined
      this.authority.dispatch({ type: 'saved', grant: effect.grant, ok: isOk })
      if (isOk) this.notify()
    }
    this.deps.log.info('Paid use of webSearch: allowed once')
    return isCurrent() && this.authority.isApproved(tag) ? quote : undefined
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Whether the feature is on and allowed always here, so its next use asks nothing. */
  public isRemembered(feature: PaidFeature): boolean {
    return (
      feature !== 'teamWorkers' &&
      this.deps.isOn(feature) &&
      this.deps.canRemember() &&
      ((this.deps.readQuoteGrant === undefined &&
        this.authority.hasGrant() &&
        feature === 'webSearch') ||
        this.deps.readGrants().has(feature))
    )
  }

  /** The features that no longer ask in this workspace, in their fixed order. */
  public remembered(): readonly PaidFeature[] {
    return PAID_FEATURES.filter((feature) => this.isRemembered(feature))
  }

  /**
   * Whether this use may be billed: allowed always here, or allowed in the
   * popup now. `requiresAsking` (a hook that demands a question) asks even when the
   * use is allowed always. A feature turned off while the popup was open is
   * refused whatever the answer. A window-once feature asks once per window:
   * ordinary uses that arrive while its question is open wait for that
   * answer; a use that requires asking still gets its own question.
   */
  public allows(
    request: Exclude<PaidUseRequest, { feature: 'webSearch' }>,
    requiresAsking?: boolean,
    ask?: PaidUseConsentDeps['ask'],
    signal?: AbortSignal,
  ): Promise<boolean>
  public allows(
    request: PaidUseRequest,
    requiresAsking?: boolean,
    ask?: PaidUseConsentDeps['ask'],
    signal?: AbortSignal,
  ): Promise<PaidUseDecision>
  public async allows(
    request: PaidUseRequest,
    requiresAsking = false,
    ask = this.deps.ask,
    signal?: AbortSignal,
  ): Promise<PaidUseDecision> {
    if (signal !== undefined) {
      // Stop ends this caller's wait; the shared popup still owns its answer.
      signal.throwIfAborted()
      const decision = await unlessAborted(this.allows(request, requiresAsking, ask), signal)
      signal.throwIfAborted()
      return decision
    }
    if (request.feature === 'webSearch') return await this.allowSearch(request, requiresAsking, ask)
    const { feature } = request
    if (!this.isEnabled(feature)) {
      return false
    }
    if (request.feature === 'teamWorkers') {
      const runtime = await paidTeamRuntime()
      return await runtime.canUseTeam(this.deps, request, requiresAsking, () => {
        this.notify()
      })
    }
    const isRemembered = this.isRemembered(feature)
    if (!requiresAsking && isRemembered) {
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      return true
    }
    if (!requiresAsking && this.isWindowOnce(feature)) {
      this.deps.log.info(`Paid use of ${feature}: allowed once in this window`)
      return true
    }
    if (requiresAsking || !this.isWindowOnceFeature(feature)) {
      return await this.decide(request, ask)
    }
    const pending = this.pendingWindowOnce.get(feature)
    if (pending !== undefined) {
      this.deps.log.info(`Paid use of ${feature}: waits for the question open in this window`)
      return await pending
    }
    const decision = this.decide(request, ask)
    this.pendingWindowOnce.set(feature, decision)
    try {
      return await decision
    } finally {
      this.pendingWindowOnce.delete(feature)
    }
  }

  /**
   * A price acceptance changed in this window (the host calls this from
   * `writeAccepted`): this window's once was given under the old price, so
   * it asks again. A change in another window shows through
   * `windowOnceGeneration`.
   */
  public revokeWindowOnce(feature: PaidFeature): void {
    if (feature === 'webSearch') this.searchWindowOnce.clear()
    if (this.windowOnce.delete(feature)) {
      this.deps.log.info(`Paid use of ${feature} asks again in this window`)
    }
  }

  /** Account & usage's "Ask again": every feature asks again here. */
  public async forget(): Promise<void> {
    const hasWindowOnce =
      this.windowOnce.size > 0 || this.searchWindowOnce.size > 0 || this.authority.hasGrant()
    this.searchWindowOnce.clear()
    this.windowOnce.clear()
    this.revocation += 1
    this.authority.revokeAll(this.quoteGeneration())
    await this.deps.revokeQuoteGrants?.()
    if (this.deps.readGrants().size === 0 && (this.deps.readTeamGrants?.().size ?? 0) === 0) {
      if (hasWindowOnce) {
        this.deps.log.info('Paid uses ask again in this window')
        this.notify()
      }
      return
    }
    await this.deps.writeGrants(new Set())
    await this.deps.writeTeamGrants?.(new Set())
    this.deps.log.info('Paid uses ask again in this workspace')
    this.notify()
  }
}

/** D88.7: verified local tariff and opaque billing identity; never a credential. */
export interface PaidAccountBinding {
  readonly provider: string
  readonly account: string
  readonly price: string
  readonly dailyBudgetUsd: UsdAmount
}
export interface AccountPaidUseConsentDeps extends Omit<
  PaidUseConsentDeps,
  | 'readGrants'
  | 'writeGrants'
  | 'rememberGrant'
  | 'ask'
  | 'windowOnceFeatures'
  | 'windowOnceGeneration'
> {
  readonly readGrants: (bindingKey: string) => ReadonlySet<PaidFeature>
  readonly writeGrants: (bindingKey: string, grants: ReadonlySet<PaidFeature>) => Promise<void>
  readonly ask: (
    request: PaidUseRequest,
    binding: PaidAccountBinding,
    canRemember: boolean,
  ) => Promise<PaidUseAnswer>
  /** Registry checks account membership/credential generation and the accepted tariff. */
  readonly isCurrent: (binding: PaidAccountBinding) => boolean
}

export function paidAccountQuestion(binding: PaidAccountBinding): string {
  return fill(UI_TEXT.accounts.paidConsent, {
    provider: binding.provider,
    account: binding.account,
    price: binding.price,
    budget: formatUsd(binding.dailyBudgetUsd, 2),
  })
}

/** One instance per account/tariff. Legacy single-account consent stays unchanged. */
export class AccountPaidUseConsent {
  private readonly binding: PaidAccountBinding
  private readonly key: string
  private generation = 0
  private isRevoking = false
  private revocations = 0
  private shouldIgnoreStored = false
  private writes: Promise<void> = Promise.resolve()
  private consent: PaidUseConsent

  public constructor(
    private readonly deps: AccountPaidUseConsentDeps,
    binding: PaidAccountBinding,
  ) {
    if (
      !ACCOUNT_ID_PATTERN.test(binding.provider) ||
      !ACCOUNT_ID_PATTERN.test(binding.account) ||
      binding.price.trim() === '' ||
      Usd.from(binding.dailyBudgetUsd).compare(Usd.from(0)) < 0
    )
      throw new Error(UI_TEXT.accounts.invalidAccount)
    this.binding = Object.freeze({ ...binding })
    this.key = JSON.stringify([binding.provider, binding.account, binding.price])
    this.consent = this.createConsent()
  }

  private async write(use: () => Promise<void>): Promise<void> {
    const previous = this.writes
    const operation = (async () => {
      try {
        await previous
      } catch {
        // A failed prior owner must not block this mutation; its caller received the error.
      }
      await use()
    })()
    this.writes = operation
    await operation
  }

  /** The binding's kept features: empty while revoked, stale or ignored. */
  private bindingGrants(generation: number): ReadonlySet<PaidFeature> {
    return this.isCurrent(generation) && !this.shouldIgnoreStored
      ? this.deps.readGrants(this.key)
      : new Set()
  }

  /** Merges one feature into the binding's kept set inside the owner queue. */
  private async keepBindingFeature(feature: PaidFeature, generation: number): Promise<void> {
    await this.write(async () => {
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
      const grants = this.shouldIgnoreStored
        ? new Set<PaidFeature>()
        : this.deps.readGrants(this.key)
      await this.deps.writeGrants(this.key, new Set([...grants, feature]))
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
      this.shouldIgnoreStored = false
    })
  }

  private createConsent(): PaidUseConsent {
    const generation = this.generation
    const isCurrent = () =>
      !this.isRevoking && generation === this.generation && this.deps.isCurrent(this.binding)
    // Without a host quote store there is no ceiling or generation to track,
    // so the binding-kept feature grant is bridged into the quote lookup: a
    // new instance reads back Always for the same workspace, provider,
    // account and price. A host that tracks generations without a quote store
    // keeps asking: an unversioned grant cannot prove its vintage.
    const shouldBridgeQuotes =
      this.deps.readQuoteGrant === undefined &&
      this.deps.writeQuoteGrant === undefined &&
      this.deps.prepareQuoteGeneration === undefined &&
      this.deps.quoteGeneration === undefined
    return new PaidUseConsent({
      ...this.deps,
      isOn: (feature) => isCurrent() && this.deps.isOn(feature),
      ...(this.deps.isJudgeEnabled !== undefined && {
        isJudgeEnabled: () => isCurrent() && this.deps.isJudgeEnabled?.() === true,
      }),
      // Owner ruling: ask once before the first charge; Always remains workspace-scoped.
      windowOnceFeatures: new Set(PAID_FEATURES),
      windowOnceGeneration: () => this.generation,
      readGrants: () => this.bindingGrants(generation),
      writeGrants: async (grants) => {
        if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
        await this.write(async () => {
          if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
          await this.deps.writeGrants(this.key, grants)
          if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
          this.shouldIgnoreStored = false
        })
      },
      rememberGrant: async (feature) => {
        await this.keepBindingFeature(feature, generation)
      },
      ...(shouldBridgeQuotes && {
        readQuoteGrant: (quote: PaidQuote): PaidGrant | undefined =>
          this.bindingGrants(generation).has('webSearch')
            ? { quote, generation: 'initial' }
            : undefined,
        writeQuoteGrant: (_grant: PaidGrant): Promise<void> =>
          this.keepBindingFeature('webSearch', generation),
      }),
      ask: async (request, canRemember) => await this.deps.ask(request, this.binding, canRemember),
    })
  }

  private isCurrent(generation: number): boolean {
    return !this.isRevoking && generation === this.generation && this.deps.isCurrent(this.binding)
  }

  public async allows(request: PaidUseRequest, requiresAsking = false): Promise<boolean> {
    if (this.isRevoking || !this.deps.isCurrent(this.binding)) return false
    const generation = this.generation
    const decision = await this.consent.allows(request, requiresAsking)
    // A search decision is its frozen quote; any non-refusal counts as allowed here.
    return decision !== undefined && decision !== false && this.isCurrent(generation)
  }

  /** Invalidates pending questions now and removes the account/tariff's workspace grant. */
  public async revoke(): Promise<void> {
    this.generation++
    this.revocations++
    this.isRevoking = true
    this.shouldIgnoreStored = true
    try {
      await this.write(async () => {
        await this.deps.writeGrants(this.key, new Set())
      })
    } finally {
      this.revocations--
      this.isRevoking = this.revocations > 0
      this.consent = this.createConsent()
    }
  }
}
