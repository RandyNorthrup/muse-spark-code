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

import { PAID_FEATURES, type PaidFeature, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, formatUsd } from '../../shared/l10n/text'
import {
  paidFeaturePrice,
  autoReviewPrice,
  bestOfNPrice,
  modelApiPaidTier,
  hookModelPrice,
  type PaidUseRequest,
  scheduledRunPrice,
  subagentTaskPrice,
} from '../../shared/paid'
import type { CoreLogger } from '../logging'
import { unlessAborted } from '../timeouts'

/** The popup's three answers. */
export type PaidUseAnswer = 'once' | 'always' | 'deny'

/** The popup's question and what it says about the use, in the display language. */
export function paidUseQuestion(request: PaidUseRequest): {
  readonly title: string
  readonly detail: string
} {
  switch (request.feature) {
    case 'judge': {
      const price = autoReviewPrice(request.modelId)
      if (
        price === undefined ||
        !Number.isFinite(request.dailyBudgetUsd) ||
        request.dailyBudgetUsd < 0
      )
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
        detail: fill(UI_TEXT.paidUseWebSearchDetail, { price: paidFeaturePrice('webSearch') }),
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
      const price = autoReviewPrice(request.modelId)
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
    case 'bestOfN': {
      return {
        title: fill(UI_TEXT.paidBestOfNTitle, { attempts: formatNumber(request.attempts) }),
        detail: fill(UI_TEXT.paidBestOfNDetail, {
          prompt: request.prompt,
          price: bestOfNPrice(request.modelId, request.attempts, request.requestCeilingPerAttempt),
        }),
      }
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
   * Features whose "Allow once" covers this window until it closes (Tab,
   * M94 Q-M94a): kept in memory only, never stored, so nothing persists
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
  /** The popup; "always" is offered only when `canRemember` is true. */
  readonly ask: (request: PaidUseRequest, canRemember: boolean) => Promise<PaidUseAnswer>
  readonly log: CoreLogger
}

export class PaidUseConsent {
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

  public constructor(private readonly deps: PaidUseConsentDeps) {}

  /** Whether the feature's "Allow once" covers the window (Tab, M94 Q-M94a). */
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
      await this.deps.writeGrants(new Set([...this.deps.readGrants(), feature]))
      return true
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid use of ${feature}: "always" could not be kept, so it is allowed once: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  private isEnabled(feature: PaidFeature): boolean {
    return feature === 'judge'
      ? (this.deps.isJudgeEnabled?.() ?? this.deps.isOn(feature))
      : this.deps.isOn(feature)
  }

  /** Asks in the popup now and keeps what the answer grants. */
  private async decide(request: PaidUseRequest): Promise<boolean> {
    const { feature } = request
    const canRemember = this.deps.canRemember()
    const answer = await this.deps.ask(request, canRemember)
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

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Whether the feature is on and allowed always here, so its next use asks nothing. */
  public isRemembered(feature: PaidFeature): boolean {
    return this.deps.isOn(feature) && this.deps.canRemember() && this.deps.readGrants().has(feature)
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
  public async allows(
    request: PaidUseRequest,
    requiresAsking = false,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal !== undefined) {
      // Stop ends this caller's wait; the shared popup still owns its answer.
      signal.throwIfAborted()
      const allowed = await unlessAborted(this.allows(request, requiresAsking), signal)
      signal.throwIfAborted()
      return allowed ?? false
    }
    const { feature } = request
    if (!this.isEnabled(feature)) {
      return false
    }
    if (!requiresAsking && this.isRemembered(feature)) {
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      return true
    }
    if (!requiresAsking && this.isWindowOnce(feature)) {
      this.deps.log.info(`Paid use of ${feature}: allowed once in this window`)
      return true
    }
    if (requiresAsking || !this.isWindowOnceFeature(feature)) {
      return await this.decide(request)
    }
    const pending = this.pendingWindowOnce.get(feature)
    if (pending !== undefined) {
      this.deps.log.info(`Paid use of ${feature}: waits for the question open in this window`)
      return await pending
    }
    const decision = this.decide(request)
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
    if (this.windowOnce.delete(feature)) {
      this.deps.log.info(`Paid use of ${feature} asks again in this window`)
    }
  }

  /** Account & usage's "Ask again": every feature asks again here. */
  public async forget(): Promise<void> {
    const hasWindowOnce = this.windowOnce.size > 0
    this.windowOnce.clear()
    if (this.deps.readGrants().size === 0) {
      if (hasWindowOnce) {
        this.deps.log.info('Paid uses ask again in this window')
        this.notify()
      }
      return
    }
    await this.deps.writeGrants(new Set())
    this.deps.log.info('Paid uses ask again in this workspace')
    this.notify()
  }
}
