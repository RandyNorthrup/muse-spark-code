import { randomUUID } from 'node:crypto'

export {
  AutoCompactionNotAuthorizedError,
  isAutoCompactionNotAuthorizedError,
} from './autoCompactionError'

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

import { PAID_FEATURES, type PaidFeature, UI_TEXT, DEFAULT_MODEL_ID } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import {
  freezePaidQuote,
  paidStoreFailureKind,
  type PaidQuote,
  type PaidQuoteNotice,
  type PaidStoreFailureKind,
  type PaidUseDecision,
  type PaidUseRequest,
  scheduledRunPrice,
} from '../../shared/paid'
import { Usd, minUsd, nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
import type { CreateResponseBody, CreateImageBody } from '../backends/modelapi/schemas'
import type { SpendClaim } from './spendClaim'

import { type CoreLogger, wireWordForLog } from '../logging'
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

/**
An "always" that was applied this time but could not be kept: the host
tells the person when it happens, so being asked again never surprises.
*/
export interface PaidNotKeptNotice {
  readonly feature: PaidFeature
  /** The store failure's closed kind, never its message or an errno. */
  readonly kind: PaidStoreFailureKind
  /**
  The session that asked, bound when the question was asked: the pending
  write carries it, so a later question in another session cannot steal
  the notice (P2-3). Hosts without sessions leave it unset.
  */
  readonly sessionId?: string
}

/**
What an allowing answer granted: `always` kept in this workspace, `window`
a window-once feature's once, `once` this use only (an "always" that could
not be kept, or a feature without a window once).
*/
export type PaidUseScope = 'once' | 'window' | 'always'

/** A verified selected-model tariff, not a provider-name assumption. No credential value. */
export interface SchedulePaidIdentity {
  readonly modelId: string
  readonly accountId: string
  readonly providerId?: string | undefined
  readonly origin?: string | undefined
  readonly priceTier: string
  readonly payerKind: 'paidKey' | 'plan'
  readonly price: string
  readonly sharedDailyBudgetUsd: UsdAmount
}

export type ScheduleConsent = NonNullable<ScheduleV2['paidConsent']>

export function isScheduleConsentCurrent(
  schedule: ScheduleV2,
  identity: SchedulePaidIdentity,
): boolean {
  return scheduleConsentFailure(schedule, identity) === undefined
}

/** Every false consent branch has a translated refusal, shared by all hosts. */
export function scheduleConsentFailure(
  schedule: ScheduleV2,
  identity: SchedulePaidIdentity,
): keyof typeof UI_TEXT.scheduleV2.messages | undefined {
  if (schedule.action.kind !== 'prompt') return 'paidUnavailable'
  const consent = schedule.paidConsent
  if (consent === undefined) return 'changedConsent'
  if (identity.payerKind !== 'paidKey' || consent.payerKind !== identity.payerKind)
    return 'changedPayer'
  if (consent.modelId !== identity.modelId) return 'changedModel'
  if (consent.accountId !== identity.accountId) return 'changedKey'
  if (consent.priceTier !== identity.priceTier) return 'changedTariff'
  if (
    !nonnegativeUsdSchema.safeParse(consent.dailyCapUsd).success ||
    consent.dailyCapUsd === '0' ||
    !nonnegativeUsdSchema.safeParse(consent.sharedDailyBudgetUsd).success ||
    consent.sharedDailyBudgetUsd === '0' ||
    Usd.from(consent.dailyCapUsd).compare(Usd.from(schedule.paidCapUsd)) > 0
  )
    return 'capReached'
  if (consent.sharedDailyBudgetUsd !== identity.sharedDailyBudgetUsd) return 'changedSharedCap'
  return Usd.from(consent.dailyCapUsd).compare(Usd.from(schedule.grant.paidCapUsd)) > 0
    ? 'changedGrant'
    : undefined
}

/** Creation/renewal only. No workspace-wide grant can silently authorize a schedule.
Called from the host schedule paid binding's consent step.
*/
export async function askSchedulePaidConsent(deps: {
  readonly schedule: ScheduleV2
  readonly identity: SchedulePaidIdentity
  readonly cadence: string
  readonly extras: ScheduleConsent['extras']
  readonly now: () => number
  readonly isOn: () => boolean
  readonly isCurrent: () => boolean
  readonly ask: (question: {
    title: string
    detail: string
    request: Extract<PaidUseRequest, { feature: 'scheduledPrompts' }>
  }) => Promise<PaidUseAnswer>
  /** Optional standalone CAS; control callers publish the returned consent with the draft. */
  readonly remember?: (consent: ScheduleConsent) => Promise<boolean>
}): Promise<ScheduleConsent | undefined> {
  const { schedule, identity } = deps
  if (
    schedule.action.kind !== 'prompt' ||
    !deps.isOn() ||
    !deps.isCurrent() ||
    identity.payerKind !== 'paidKey' ||
    identity.price.trim() === '' ||
    !nonnegativeUsdSchema.safeParse(identity.sharedDailyBudgetUsd).success ||
    minUsd(schedule.paidCapUsd, schedule.grant.paidCapUsd, identity.sharedDailyBudgetUsd) === '0'
  )
    return undefined
  if (
    isScheduleConsentCurrent(schedule, identity) &&
    (schedule.paidConsent?.scope !== 'once' || schedule.paidConsent.runId === undefined) &&
    deps.extras.length === schedule.paidConsent?.extras.length &&
    deps.extras.every((feature) => schedule.paidConsent?.extras.includes(feature) === true)
  )
    return schedule.paidConsent
  const consent = schedulePaidConsentSchema.parse({
    modelId: identity.modelId,
    accountId: identity.accountId,
    priceTier: identity.priceTier,
    payerKind: identity.payerKind,
    sharedDailyBudgetUsd: identity.sharedDailyBudgetUsd,
    grantedAtMs: deps.now(),
    dailyCapUsd: minUsd(schedule.paidCapUsd, schedule.grant.paidCapUsd),
    extras: deps.extras,
  })
  const request: Extract<PaidUseRequest, { feature: 'scheduledPrompts' }> = {
    feature: 'scheduledPrompts',
    prompt: schedule.action.prompt,
    modelId: identity.modelId,
    schedule: {
      id: schedule.id,
      price: identity.price,
      cadence: deps.cadence,
      dailyCapUsd: consent.dailyCapUsd,
      sharedDailyBudgetUsd: identity.sharedDailyBudgetUsd,
      extras: deps.extras,
      payerKind: identity.payerKind,
    },
  }
  const answer = await deps.ask({ ...(await paidUseQuestion(request)), request })
  if (answer === 'deny' || !deps.isOn() || !deps.isCurrent()) return undefined
  const approved = schedulePaidConsentSchema.parse({
    ...consent,
    scope: answer === 'once' ? 'once' : 'schedule',
  })
  if (answer === 'always' && deps.remember !== undefined && !(await deps.remember(approved)))
    return undefined
  return deps.isOn() && deps.isCurrent() ? approved : undefined
}

/** The run's paid port: live identity/gates plus its noninteractive limit check (D208).
Called from the host schedule paid binding's run step.
@unwired M58 schedule paid scope
*/
export function createSchedulePaidScope(deps: {
  readonly runId?: string
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
  ) => Promise<SpendClaim>
}) {
  const refusal = (feature: PaidFeature): keyof typeof UI_TEXT.scheduleV2.messages | undefined => {
    if (!deps.isCurrent()) return 'changedRevision'
    const failure = scheduleConsentFailure(deps.schedule, deps.currentIdentity())
    if (failure !== undefined) return failure
    if (
      deps.schedule.paidConsent?.scope === 'once' &&
      (deps.runId === undefined || deps.schedule.paidConsent.runId !== deps.runId)
    )
      return 'lostOnceClaim'
    if (
      (deps.backend !== 'museCode' && !deps.isOn('scheduledPrompts')) ||
      !deps.isOn(feature) ||
      (feature === 'scheduledPrompts'
        ? deps.backend !== 'modelApi'
        : deps.schedule.paidConsent?.extras.includes(feature) !== true)
    )
      return 'paidUnavailable'
    return undefined
  }
  const canUse = (feature: PaidFeature) => refusal(feature) === undefined
  const open = new Set<SpendClaim>()
  let settledUsd = Usd.from(0)
  let hasUnknown = false
  return {
    modelId: deps.identity.modelId,
    accountId: deps.identity.accountId,
    providerId: deps.identity.providerId,
    origin: deps.identity.origin,
    allows: canUse,
    cost: (): ScheduleFireRecord['cost'] => ({
      // Fire records keep what the calls reported; nothing is held (D208), so
      // a call still open or one that reported no usage makes the cost unknown.
      usd: settledUsd.toAmount(),
      certainty: hasUnknown || open.size > 0 ? 'unknown' : 'exact',
      retainedLiabilityUsd: Usd.from(0).toAmount(),
    }),
    reserve: async (
      body: CreateResponseBody | CreateImageBody,
      inputTokens: number | undefined,
      signal: AbortSignal,
      reservationUsd?: UsdAmount,
    ): Promise<SpendClaim> => {
      signal.throwIfAborted()
      const feature = 'input' in body ? 'scheduledPrompts' : 'imageGeneration'
      const failure = refusal(feature)
      if (failure !== undefined) throw new Error(UI_TEXT.scheduleV2.messages[failure])
      if ('input' in body && body.model !== deps.identity.modelId)
        throw new Error(UI_TEXT.scheduleV2.messages.changedModel)
      const costUsd = reservationUsd ?? deps.estimate(body, inputTokens)
      if (Usd.from(costUsd).compare(Usd.from(0)) <= 0)
        throw new Error(UI_TEXT.paidDailyLedgerUnavailable)
      const claim = await deps.reserve(deps.schedule, costUsd, signal)
      open.add(claim)
      const check = () => {
        signal.throwIfAborted()
        const failure = refusal(feature)
        if (failure !== undefined) throw new Error(UI_TEXT.scheduleV2.messages[failure])
        claim.check()
      }
      const settle = async (actualCostUsd: UsdAmount | undefined) => {
        await claim.settle(actualCostUsd)
        if (!open.delete(claim)) return
        if (actualCostUsd === undefined) hasUnknown = true
        else settledUsd = settledUsd.add(Usd.from(actualCostUsd))
      }
      try {
        check()
      } catch (error: unknown) {
        await settle(Usd.from(0).toAmount())
        throw error
      }
      return { estimateUsd: claim.estimateUsd, check, settle }
    },
  }
}

/** The popup's question, formatted only when its existing runtime first loads. */
export async function paidUseQuestion(request: PaidUseRequest): Promise<{
  readonly title: string
  readonly detail: string
}> {
  const runtime = await import('../backends/modelapi/foreignHooksEntry')
  runtime.setUiText(UI_TEXT, uiLocale())
  return await runtime.paidUseQuestion(request)
}

export interface PaidUseConsentDeps {
  /** Whether the feature may be used at all: its setting on and its price accepted. */
  readonly isOn: (feature: PaidFeature) => boolean
  /**
  Features whose "Allow Once" covers this window until it closes (Tab and
  hosted search, D48): kept in memory only, never stored, so nothing persists
  past the window. "Allow always" stays workspace-scoped for every
  feature, window-once ones included.
  */
  readonly windowOnceFeatures?: ReadonlySet<PaidFeature>
  /**
  The feature's shared price-acceptance generation, as workspace grants
  are checked against (M58). A window-once grant holds only while the
  generation it was given under is current, so a price withdrawn and
  accepted again in another window makes this window ask again.
  */
  readonly windowOnceGeneration?: (feature: PaidFeature) => number | string
  /** Judge defaults on; its first actual paid use accepts price in this same popup. */
  readonly isJudgeEnabled?: (() => boolean) | undefined
  readonly acceptJudgePrice?: (() => Promise<boolean>) | undefined
  /** A trusted workspace with a folder open: the only place "always" is offered and kept. */
  readonly canRemember: () => boolean
  /** The features allowed always in this workspace, still valid (the host drops lapsed ones). */
  readonly readGrants: () => ReadonlySet<PaidFeature>
  readonly writeGrants: (grants: ReadonlySet<PaidFeature>) => Promise<void>
  /** Valid workspace scopes, invalidated with price acceptance/setting changes like ordinary grants.
  Both stores are required to offer team Always; a feature-only legacy grant never authorizes it.
  */
  readonly readTeamGrants?: () => ReadonlySet<string>
  readonly writeTeamGrants?: (grants: ReadonlySet<string>) => Promise<void>
  /**
  Account owner performs the read/merge/write inside its serialized
  mutation. `question` is the very request object the answer's popup was
  asked with, so the owner keeps it under that question's own capture.
  */
  readonly rememberGrant?: (feature: PaidFeature, question: PaidUseRequest) => Promise<void>
  /**
  Account consent only (M108 lane P): whether the answer to `question` may
  still be honoured. It is read after the answer and before anything is
  cached or kept, and again before the use is allowed; false refuses the
  use and every use sharing its question. Workspace consent leaves it
  unset, so its answers are honoured exactly as before.
  */
  readonly isAnswerCurrent?: (question: PaidUseRequest) => boolean
  /** The popup; "always" is offered only when `canRemember` is true. */
  readonly ask: (request: PaidUseRequest, canRemember: boolean) => Promise<PaidUseAnswer>
  /**
  Tells the person that "always" applied once but could not be kept.
  Every host provides it (editor, ACP, terminal); without it only the log knows.
  */
  readonly onNotKept?: (notice: PaidNotKeptNotice) => void
  readonly authority?: PaidAuthority
  readonly nextQuoteOrder?: () => number | Promise<number>
  readonly prepareQuoteGeneration?: () => Promise<string>
  readonly quoteGeneration?: () => string
  /** Saved Always quotes the store could not list: shown with the question it then asks. */
  readonly readQuoteNotice?: () => PaidQuoteNotice | undefined
  readonly readQuoteGrant?: (quote: PaidQuote) => PaidGrant | undefined
  readonly writeQuoteGrant?: (grant: PaidGrant) => Promise<void>
  readonly revokeQuoteGrants?: () => Promise<void>
  /**
  M108 lane P (D88.7): a use billed to another account than the provider's
  default goes to that account's own consent. `route` returns undefined for
  the default account, so this workspace consent answers exactly as before;
  `forget` takes every account's grants back with Ask again.
  */
  readonly accounts?: {
    readonly route: (
      request: PaidUseRequest,
      requiresAsking: boolean,
    ) => Promise<PaidUseDecision> | undefined
    readonly forget: () => Promise<void>
  }
  readonly log: CoreLogger
}

export class PaidUseConsent {
  private revocation = 0
  private readonly listeners = new Set<() => void>()
  /**
  Window-once grants this instance gave, each with the price-acceptance
  generation it was given under: memory only, never stored.
  */
  private readonly windowOnce = new Map<PaidFeature, number | string | undefined>()
  /** Each feature's local revocations; Ask again also moves the shared `revocation`. */
  private readonly windowOnceRevocations = new Map<PaidFeature, number>()
  /**
  A window-once feature's first question while it is open: ordinary uses
  that arrive meanwhile share it and its answer instead of asking again.
  */
  private readonly pendingWindowOnce = new Map<PaidFeature, Promise<boolean>>()
  private readonly searchWindowOnce = new Set<string>()
  private readonly pendingSearchWindowOnce = new Map<string, Promise<PaidUseAnswer>>()
  /**
  A stale-epoch save failure waits here instead of notifying at once
  (account scope only: `saveGrantIf` refused a grant approved under a
  revoked epoch). The outer account fence settles it — dropped when the
  fence refuses, told only after the fence passes — so a revoked use is
  never described as applied. A plain store failure still notifies at
  once in `remember()` below. Entries carry their feature and a fence
  settles only its own call's entries: one ask per feature is in flight
  at a time (the inner consent shares a concurrent same-feature
  question), so same-feature entries belong to the same decision while
  another feature's overlapping fence can neither announce nor discard
  them.
  */
  private pendingStaleNotKept: {
    readonly feature: PaidFeature
    readonly kind: PaidStoreFailureKind
    readonly notifySession: string | undefined
  }[] = []

  public readonly authority: PaidAuthority

  public constructor(private readonly deps: PaidUseConsentDeps) {
    this.authority = deps.authority ?? new PaidAuthority(UI_TEXT, uiLocale())
  }

  private quoteGeneration(): string {
    return JSON.stringify([this.revocation, this.deps.quoteGeneration?.() ?? 'initial'])
  }

  /** Whether the feature's "Allow Once" covers the window (D48). */
  private isWindowOnceFeature(feature: PaidFeature): boolean {
    return this.deps.windowOnceFeatures?.has(feature) ?? false
  }

  /**
  Whether an "Allow Once" for the feature covers this window: given here,
  under the price acceptance that is still current in every window.
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
  Keeps "always" for the feature. A store that cannot be written is
  logged and leaves this use allowed once, so the next one asks again
  instead of this one failing.
  */
  /** The not-kept notice for a failed write, carrying the asking session (P2-3). */
  private notKeptNotice(
    feature: PaidFeature,
    kind: PaidStoreFailureKind,
    notifySession: string | undefined,
  ): PaidNotKeptNotice {
    return {
      feature,
      kind,
      ...(notifySession !== undefined && { sessionId: notifySession }),
    }
  }

  private async remember(
    feature: PaidFeature,
    question: PaidUseRequest,
    notifySession?: string,
  ): Promise<boolean> {
    try {
      if (this.deps.rememberGrant === undefined)
        await this.deps.writeGrants(new Set([...this.deps.readGrants(), feature]))
      else await this.deps.rememberGrant(feature, question)
      return true
    } catch (error: unknown) {
      // A stale account-grant epoch, read by the error's brand, never
      // `instanceof`: the class lives in `accountPaidConsent.ts`, which
      // already imports this module, so importing it back would cycle.
      if (error instanceof Error && error.name === 'StaleEpochError') {
        // Carried past the outer account fence
        // (`AccountPaidUseConsent.allows`): a revocation that landed while
        // the popup was open refuses there, and must not be described as
        // applied first. The fence settles this through
        // `settleStaleNotKept`; only a fence that still passes tells the
        // person. Classified like every other rejection.
        this.pendingStaleNotKept.push({
          feature,
          kind: paidStoreFailureKind(error),
          notifySession,
        })
        this.deps.log.warn(
          `Paid use of ${feature}: "always" save raced a revocation, so the account fence settles it (${wireWordForLog(error.name)})`,
        )
        return false
      }
      // A store that cannot be written leaves this use allowed once. The
      // log names only the failure's kind, never the store's message, and
      // the person is told at once; every rejection is classified,
      // including a non-Error one (which reads `unknown`).
      // read-state: cert TBL-07. `false` here is "not kept, allowed once,
      // person told" (onNotKept fired above the return), never "not allowed".
      this.deps.log.warn(
        `Paid use of ${feature}: "always" could not be kept, so it is allowed once (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
      )
      this.deps.onNotKept?.(this.notKeptNotice(feature, paidStoreFailureKind(error), notifySession))
      return false
    }
  }

  /** Failure kinds travel back to the caller; only a current use gets the notice. */
  private async searchApprovalOrder(
    quote: PaidQuote,
    prior: PaidGrant | undefined,
  ): Promise<number | PaidStoreFailureKind> {
    try {
      return await (this.deps.nextQuoteOrder?.() ?? this.authority.nextOrder(quote, prior))
    } catch (error: unknown) {
      // An order failure may downgrade a still-current use to once. A
      // revoked use is refused without claiming the choice applied.
      // read-state: cert TBL-08. Return the failure kind; only the caller's
      // currentness fence can say whether an approved use still proceeds.
      // Every rejection is classified, including a non-Error one.
      this.deps.log.warn(
        `Paid search quote could not be kept (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
      )
      return paidStoreFailureKind(error)
    }
  }

  private isEnabled(feature: PaidFeature): boolean {
    return feature === 'judge'
      ? (this.deps.isJudgeEnabled?.() ?? this.deps.isOn(feature))
      : this.deps.isOn(feature)
  }

  /** Whether the answer to `question` may still be honoured (account consent's fence). */
  private isAnswerCurrent(question: PaidUseRequest): boolean {
    return this.deps.isAnswerCurrent?.(question) ?? true
  }

  /** Asks in the popup now and keeps what the answer grants. */
  private async decide(
    request: PaidUseRequest,
    ask: PaidUseConsentDeps['ask'],
    notifySession?: string,
  ): Promise<boolean> {
    return (await this.decideScope(request, ask, notifySession)) !== undefined
  }

  /** Asks in the popup now, keeps what the answer grants and names it; undefined refuses. */
  private async decideScope(
    request: PaidUseRequest,
    ask: PaidUseConsentDeps['ask'],
    notifySession?: string,
  ): Promise<PaidUseScope | undefined> {
    const { feature } = request
    const canRemember = this.deps.canRemember()
    const answer = await ask(request, canRemember)
    if (answer === 'deny') {
      this.deps.log.info(`Paid use of ${feature}: denied`)
      return undefined
    }
    if (!this.isEnabled(feature)) {
      this.deps.log.info(`Paid use of ${feature}: turned off while the popup was open`)
      return undefined
    }
    if (
      feature === 'judge' &&
      this.deps.acceptJudgePrice !== undefined &&
      (!(await this.deps.acceptJudgePrice()) || !this.isEnabled(feature))
    )
      return undefined
    // An answer whose question was revoked is never cached or kept, and every
    // use sharing that question is refused with it.
    if (!this.isAnswerCurrent(request)) {
      this.deps.log.info(`Paid use of ${feature}: revoked while the popup was open`)
      return undefined
    }
    if (
      answer === 'always' &&
      canRemember &&
      this.deps.canRemember() &&
      (await this.remember(feature, request, notifySession))
    ) {
      // Keeping "always" awaited the store: a revocation meanwhile refuses.
      if (!this.isAnswerCurrent(request)) return undefined
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      this.notify()
      return 'always'
    }
    if (answer === 'once' && this.isWindowOnceFeature(feature)) {
      this.windowOnce.set(feature, this.deps.windowOnceGeneration?.(feature))
      // A revocation that landed while asking refuses the downgraded once.
      if (!this.isAnswerCurrent(request)) return undefined
      this.deps.log.info(`Paid use of ${feature}: allowed once in this window`)
      return 'window'
    }
    // Keeping "once" awaited nothing, but a revoked question still refuses.
    if (!this.isAnswerCurrent(request)) return undefined
    this.deps.log.info(`Paid use of ${feature}: allowed once`)
    return 'once'
  }

  private async allowSearch(
    request: Extract<PaidUseRequest, { feature: 'webSearch' }>,
    requiresAsking: boolean,
    ask: PaidUseConsentDeps['ask'],
    notifySession?: string,
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
    const quote = freezePaidQuote({
      ...(request.quote ?? {
        id: randomUUID(),
        feature: 'webSearch',
        provider: 'meta',
        model: DEFAULT_MODEL_ID,
        modelRevision: 0,
        tariffUsd: Usd.from(request.priceUsd).toAmount(),
        unit: 'search',
        capturedAt: Date.now(),
      }),
      ...(request.payerKind !== undefined && { payerKind: request.payerKind }),
      ...(request.paidModelId !== undefined && {
        modelTokenBilling: scheduledRunPrice(request.paidModelId),
      }),
    })
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
      // No stored grant and an unreadable quote store: the question says why it asks again.
      const quoteNotice = stored === undefined ? this.deps.readQuoteNotice?.() : undefined
      const question =
        pending ??
        ask(
          {
            ...request,
            quote,
            ...(quoteNotice !== undefined && { quoteNotice }),
          },
          this.deps.canRemember(),
        )
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
    const approval =
      answer === 'always' && this.deps.canRemember()
        ? await this.searchApprovalOrder(quote, prior)
        : undefined
    if (!isCurrent()) return undefined
    if (typeof approval === 'string')
      this.deps.onNotKept?.(this.notKeptNotice('webSearch', approval, notifySession))
    const approvalOrder = typeof approval === 'number' ? approval : undefined
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
      let saveFailure: PaidStoreFailureKind | undefined
      try {
        if (this.deps.writeQuoteGrant !== undefined)
          await this.deps.writeQuoteGrant({ ...effect.grant, generation: storedGeneration })
        else if (this.deps.rememberGrant === undefined) {
          await this.deps.writeGrants(new Set([...this.deps.readGrants(), 'webSearch']))
        } else {
          await this.deps.rememberGrant('webSearch', request)
        }
        isOk = true
      } catch (error: unknown) {
        // Keep only the closed kind until currentness has been rechecked;
        // a revoked use must not be described as allowed once. Every
        // rejection is classified, including a non-Error one.
        saveFailure = paidStoreFailureKind(error)
        this.deps.log.warn(
          `Paid search quote could not be kept (${wireWordForLog(error instanceof Error ? error.name : typeof error)})`,
        )
      }
      if (!isCurrent()) return undefined
      if (saveFailure !== undefined)
        this.deps.onNotKept?.(this.notKeptNotice('webSearch', saveFailure, notifySession))
      this.authority.dispatch({ type: 'saved', grant: effect.grant, ok: isOk })
      if (isOk) this.notify()
    }
    this.deps.log.info('Paid use of webSearch: allowed once')
    return isCurrent() && this.authority.isApproved(tag) ? quote : undefined
  }

  /**
  Settles carried stale-epoch failures after the outer account fence: a
  refused fence drops them silently, a passed fence tells the person now
  that the decision stands. Only entries of the fencing call's feature
  are settled; another call's entries wait for their own fence. Only
  the account consent calls this.
  */
  public settleStaleNotKept(shouldNotify: boolean, feature: PaidFeature): void {
    const kept: typeof this.pendingStaleNotKept = []
    for (const entry of this.pendingStaleNotKept) {
      if (entry.feature !== feature) {
        kept.push(entry)
        continue
      }
      if (shouldNotify) {
        this.deps.onNotKept?.(this.notKeptNotice(entry.feature, entry.kind, entry.notifySession))
      }
    }
    this.pendingStaleNotKept = kept
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

  /** A live fence for an admitted use, including Once and revoked Always grants. */
  public fence(feature: PaidFeature): () => boolean {
    const revocation = this.revocation
    const generation = this.deps.windowOnceGeneration?.(feature)
    const wasRemembered = this.isRemembered(feature)
    const wasOnce = this.isWindowOnce(feature)
    const wasTrusted = this.deps.canRemember()
    return () =>
      revocation === this.revocation &&
      generation === this.deps.windowOnceGeneration?.(feature) &&
      wasTrusted === this.deps.canRemember() &&
      this.isEnabled(feature) &&
      (!wasRemembered || this.isRemembered(feature)) &&
      (!wasOnce || this.isWindowOnce(feature))
  }

  /**
  Whether this use may be billed: allowed always here, or allowed in the
  popup now. `requiresAsking` (a hook that demands a question) asks even when the
  use is allowed always. A feature turned off while the popup was open is
  refused whatever the answer. A window-once feature asks once per window:
  ordinary uses that arrive while its question is open wait for that
  answer; a use that requires asking still gets its own question.
  */
  public allows(
    request: Exclude<PaidUseRequest, { feature: 'webSearch' }>,
    requiresAsking?: boolean,
    ask?: PaidUseConsentDeps['ask'],
    signal?: AbortSignal,
    notifySession?: string,
  ): Promise<boolean>
  public allows(
    request: PaidUseRequest,
    requiresAsking?: boolean,
    ask?: PaidUseConsentDeps['ask'],
    signal?: AbortSignal,
    notifySession?: string,
  ): Promise<PaidUseDecision>
  public async allows(
    request: PaidUseRequest,
    requiresAsking = false,
    ask = this.deps.ask,
    signal?: AbortSignal,
    notifySession?: string,
  ): Promise<PaidUseDecision> {
    if (signal !== undefined) {
      // Stop ends this caller's wait; the shared popup still owns its answer.
      signal.throwIfAborted()
      const decision = await unlessAborted(
        this.allows(request, requiresAsking, ask, undefined, notifySession),
        signal,
      )
      signal.throwIfAborted()
      return decision
    }
    // Another account's use asks that account's own consent (D88.7).
    const routed = this.deps.accounts?.route(request, requiresAsking)
    if (routed !== undefined) return await routed
    if (request.feature === 'webSearch')
      return await this.allowSearch(request, requiresAsking, ask, notifySession)
    const { feature } = request
    if (!this.isEnabled(feature)) {
      return false
    }
    if (request.feature === 'scheduledPrompts' && request.schedule !== undefined) {
      const generation = this.revocation
      const canRemember = this.deps.canRemember()
      const answer = await ask(request, canRemember)
      return (
        answer !== 'deny' &&
        this.isEnabled(feature) &&
        generation === this.revocation &&
        (answer !== 'always' || (canRemember && this.deps.canRemember()))
      )
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
      return await this.decide(request, ask, notifySession)
    }
    const pending = this.pendingWindowOnce.get(feature)
    if (pending !== undefined) {
      this.deps.log.info(`Paid use of ${feature}: waits for the question open in this window`)
      return await pending
    }
    const decision = this.decide(request, ask, notifySession)
    this.pendingWindowOnce.set(feature, decision)
    try {
      return await decision
    } finally {
      this.pendingWindowOnce.delete(feature)
    }
  }

  /**
  Asks now, whatever is kept, and names what the answer granted (Tab's
  keyed consent, RVM94KR2): the caller binds the scope to its own key, so
  no grant kept for the feature alone answers for it.
  */
  public async askScope(
    request: Exclude<PaidUseRequest, { feature: 'webSearch' | 'teamWorkers' }>,
  ): Promise<PaidUseScope | undefined> {
    return this.isEnabled(request.feature)
      ? await this.decideScope(request, this.deps.ask)
      : undefined
  }

  /** Moves on this feature's price changes and the shared "Ask again". */
  public revocations(feature: PaidFeature): number {
    return this.revocation + (this.windowOnceRevocations.get(feature) ?? 0)
  }

  /**
  The feature's window once as a token, undefined while none holds. It
  changes whenever that once is revoked, so a grant taken under an older
  once never counts under a newer one.
  */
  public windowOnceToken(feature: PaidFeature): string | undefined {
    return this.isWindowOnce(feature)
      ? JSON.stringify([this.revocations(feature), this.windowOnce.get(feature)])
      : undefined
  }

  /**
  A price acceptance changed in this window (the host calls this from
  `writeAccepted`): this window's once was given under the old price, so
  it asks again. A change in another window shows through
  `windowOnceGeneration`.
  */
  public revokeWindowOnce(feature: PaidFeature): void {
    if (feature === 'webSearch') this.searchWindowOnce.clear()
    this.windowOnceRevocations.set(feature, (this.windowOnceRevocations.get(feature) ?? 0) + 1)
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
    await this.deps.accounts?.forget()
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
