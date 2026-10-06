import type { RecordedCall, UsageRecording } from '../usage/recording'
import type { UsageRecord } from '../../shared/usageJournal'
// The paid Model API features (M33–M35, PLAN.md D30), "opt in and loud":
// which are on, and what this window has used of them.
//
// A feature is on only when its setting is on AND the user accepted its
// price in the confirmation; each use then asks again (paidConsent.ts, M58). Turning the setting on anywhere (the palette,
// the Settings editor, settings.json) asks once, naming the price; a
// declined confirmation turns the setting back off, and turning the setting
// off forgets the acceptance, so the next time asks again. The confirmation
// is asked by the focused window only; another window asks when it is
// focused, if the answer has not reached it by then.
//
// No `vscode` here: the host injects the settings, the store, the modal and
// the window focus.

import {
  MODEL_API_IMAGE_MODEL,
  MUSE_VOICE_MODEL,
  PAID_FEATURES,
  type PaidFeature,
} from '../../shared/constants'
import {
  EMPTY_PAID_TALLY,
  modelApiPaidTier,
  type PaidState,
  type PaidTally,
  type SubagentUsage,
} from '../../shared/paid'
import type { CoreLogger } from '../logging'
import { estimateCostUsd } from '../usage/insights'

export interface PaidFeatureGateDeps {
  /** Whether the feature's `museSpark.*` setting is on. */
  readonly isSettingOn: (feature: PaidFeature) => boolean
  /** Writes the feature's setting in the user's settings. */
  readonly setSetting: (feature: PaidFeature, isOn: boolean) => Promise<void>
  /** The features whose price the user accepted (the extension's own global state). */
  readonly readAccepted: () => ReadonlySet<PaidFeature>
  readonly writeAccepted: (accepted: ReadonlySet<PaidFeature>) => Promise<void>
  /** The modal naming the price; true when the user turned the feature on. */
  readonly confirm: (feature: PaidFeature) => Promise<boolean>
  readonly isWindowFocused: () => boolean
  readonly log: CoreLogger
}

export class PaidFeatureGate {
  /** Features whose confirmation is on screen now: never asked twice at once. */
  private readonly asking = new Set<PaidFeature>()
  private readonly listeners = new Set<() => void>()

  public constructor(private readonly deps: PaidFeatureGateDeps) {}

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private async setAccepted(feature: PaidFeature, isAccepted: boolean): Promise<void> {
    const accepted = new Set(this.deps.readAccepted())
    if (accepted.has(feature) === isAccepted) {
      return
    }
    if (isAccepted) {
      accepted.add(feature)
    } else {
      accepted.delete(feature)
    }
    await this.deps.writeAccepted(accepted)
  }

  /** The confirmation for a setting found on without an accepted price. */
  private async askFor(feature: PaidFeature): Promise<void> {
    this.asking.add(feature)
    let isConfirmed: boolean
    try {
      isConfirmed = await this.deps.confirm(feature)
    } finally {
      this.asking.delete(feature)
    }
    // The setting may have been turned off while the modal was open.
    if (isConfirmed && this.deps.isSettingOn(feature)) {
      await this.setAccepted(feature, true)
      this.deps.log.info(`Paid feature ${feature} turned on; the user accepted its price`)
    } else {
      this.deps.log.info(`Paid feature ${feature} left off; its price was not accepted`)
      await this.deps.setSetting(feature, false)
    }
    this.notify()
  }

  /** Whether the feature may be used: setting on and price accepted. */
  public isOn(feature: PaidFeature): boolean {
    return this.deps.isSettingOn(feature) && this.deps.readAccepted().has(feature)
  }

  /** The features that are on, in their fixed order. */
  public features(): readonly PaidFeature[] {
    return PAID_FEATURES.filter((feature) => this.isOn(feature))
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Brings the acceptances in line with the settings: a setting turned off
   * forgets its acceptance, and one found on without an acceptance asks
   * (in the focused window). Run at activation, on every settings change and
   * when the window gains focus.
   */
  public async review(): Promise<void> {
    const pending: PaidFeature[] = []
    for (const feature of PAID_FEATURES) {
      const isSettingOn = this.deps.isSettingOn(feature)
      const isAccepted = this.deps.readAccepted().has(feature)
      if (!isSettingOn && isAccepted) {
        await this.setAccepted(feature, false)
        this.deps.log.info(`Paid feature ${feature} turned off`)
      } else if (isSettingOn && !isAccepted && !this.asking.has(feature)) {
        pending.push(feature)
      }
    }
    this.notify()
    if (!this.deps.isWindowFocused()) {
      return
    }
    // One modal at a time, in the features' order.
    for (const feature of pending) {
      await this.askFor(feature)
    }
  }

  /** The palette's toggle turning a feature on: the confirmation first, then the setting. */
  public async turnOn(feature: PaidFeature): Promise<boolean> {
    if (this.isOn(feature)) {
      return true
    }
    if (this.asking.has(feature)) {
      return false
    }
    this.asking.add(feature)
    let isConfirmed: boolean
    try {
      isConfirmed = await this.deps.confirm(feature)
    } finally {
      this.asking.delete(feature)
    }
    if (!isConfirmed) {
      this.deps.log.info(`Paid feature ${feature} left off; its price was not accepted`)
      return false
    }
    // Accepted before the setting changes, so the change asks nothing more.
    await this.setAccepted(feature, true)
    await this.deps.setSetting(feature, true)
    this.deps.log.info(`Paid feature ${feature} turned on; the user accepted its price`)
    this.notify()
    return true
  }

  public async turnOff(feature: PaidFeature): Promise<void> {
    await this.deps.setSetting(feature, false)
    await this.setAccepted(feature, false)
    this.deps.log.info(`Paid feature ${feature} turned off`)
    this.notify()
  }
}

/** Shared paid-unit producer for VS Code, ACP and sent calls with lost responses. */
export function recordPaidUse(
  recording: UsageRecording | undefined,
  feature: PaidFeature,
  units: number,
  context: Partial<
    Pick<
      RecordedCall,
      'session' | 'startedAt' | 'durationMs' | 'outcome' | 'uncertain' | 'retainedLiabilityUsd'
    >
  > = {},
): void {
  if (units <= 0 || !['webSearch', 'imageGeneration', 'voice'].includes(feature)) return
  const otherModel = feature === 'voice' ? MUSE_VOICE_MODEL : 'web_search'
  const otherKind = feature === 'imageGeneration' ? 'image' : 'voice'
  const otherUnits = feature === 'imageGeneration' ? { images: units } : { audioSeconds: units }
  recording?.note(undefined, {
    backend: 'modelApi',
    provider: 'meta',
    model: feature === 'imageGeneration' ? MODEL_API_IMAGE_MODEL : otherModel,
    kind: feature === 'webSearch' ? 'search' : otherKind,
    startedAt: Date.now(),
    outcome: 'completed',
    units: feature === 'webSearch' ? { searches: units } : otherUnits,
    ...context,
  })
}

/** What this window used of each paid feature since it opened (the usage dialog's tally). */
export class PaidUsage {
  private tally: PaidTally = EMPTY_PAID_TALLY
  private hasRestored = false
  private readonly listeners = new Set<() => void>()

  public constructor(
    private readonly log: CoreLogger,
    private readonly recording?: UsageRecording,
  ) {}

  /** Rebuild settled history once; live additions made during the read are retained. */
  public restore(records: readonly UsageRecord[]): void {
    if (this.hasRestored) return
    this.hasRestored = true
    const restored: PaidTally = { ...EMPTY_PAID_TALLY }
    const attempts = new Set<string>()
    for (const record of records) {
      restored.webSearches += record.units?.searches ?? 0
      if (record.cost.certainty !== 'uncertain') restored.images += record.units?.images ?? 0
      restored.voiceSeconds += record.units?.audioSeconds ?? 0
      if (record.kind === 'schedule') restored.scheduledRuns += 1
      const tokens = (record.tokens.input ?? 0) + (record.tokens.output ?? 0)
      const usd = record.cost.usd
      const isUnknown = usd === undefined || record.cost.certainty === 'uncertain'
      switch (record.kind) {
        case 'subagent': {
          restored.subagentRequests = (restored.subagentRequests ?? 0) + 1
          restored.subagentUnknownRequests =
            (restored.subagentUnknownRequests ?? 0) + (isUnknown ? 1 : 0)
          restored.subagentTokens = (restored.subagentTokens ?? 0) + tokens
          restored.subagentCostUsd = (restored.subagentCostUsd ?? 0) + (usd ?? 0)

          continue
        }
        case 'reviewer': {
          restored.autoReviews = (restored.autoReviews ?? 0) + 1
          restored.autoReviewUnknownRequests =
            (restored.autoReviewUnknownRequests ?? 0) + (isUnknown ? 1 : 0)
          restored.autoReviewTokens = (restored.autoReviewTokens ?? 0) + tokens
          restored.autoReviewCostUsd = (restored.autoReviewCostUsd ?? 0) + (usd ?? 0)

          continue
        }
        case 'bestOfN': {
          attempts.add(record.session ?? record.id)
          restored.bestOfNRequests = (restored.bestOfNRequests ?? 0) + 1
          restored.bestOfNUnknownRequests =
            (restored.bestOfNUnknownRequests ?? 0) + (isUnknown ? 1 : 0)
          restored.bestOfNTokens = (restored.bestOfNTokens ?? 0) + tokens
          restored.bestOfNCostUsd = (restored.bestOfNCostUsd ?? 0) + (usd ?? 0)

          continue
        }
        // No default
      }
    }
    restored.bestOfNAttempts = attempts.size
    const live = this.tally
    this.tally = {
      ...restored,
      webSearches: restored.webSearches + live.webSearches,
      images: restored.images + live.images,
      voiceSeconds: restored.voiceSeconds + live.voiceSeconds,
      scheduledRuns: restored.scheduledRuns + live.scheduledRuns,
      subagentRequests: (restored.subagentRequests ?? 0) + (live.subagentRequests ?? 0),
      subagentUnknownRequests:
        (restored.subagentUnknownRequests ?? 0) + (live.subagentUnknownRequests ?? 0),
      subagentTokens: (restored.subagentTokens ?? 0) + (live.subagentTokens ?? 0),
      subagentCostUsd: (restored.subagentCostUsd ?? 0) + (live.subagentCostUsd ?? 0),
      autoReviews: (restored.autoReviews ?? 0) + (live.autoReviews ?? 0),
      autoReviewUnknownRequests:
        (restored.autoReviewUnknownRequests ?? 0) + (live.autoReviewUnknownRequests ?? 0),
      autoReviewTokens: (restored.autoReviewTokens ?? 0) + (live.autoReviewTokens ?? 0),
      autoReviewCostUsd: (restored.autoReviewCostUsd ?? 0) + (live.autoReviewCostUsd ?? 0),
      bestOfNAttempts: (restored.bestOfNAttempts ?? 0) + (live.bestOfNAttempts ?? 0),
      bestOfNRequests: (restored.bestOfNRequests ?? 0) + (live.bestOfNRequests ?? 0),
      bestOfNUnknownRequests:
        (restored.bestOfNUnknownRequests ?? 0) + (live.bestOfNUnknownRequests ?? 0),
      bestOfNTokens: (restored.bestOfNTokens ?? 0) + (live.bestOfNTokens ?? 0),
      bestOfNCostUsd: (restored.bestOfNCostUsd ?? 0) + (live.bestOfNCostUsd ?? 0),
    }
    for (const listener of this.listeners) listener()
  }

  public get current(): PaidTally {
    return this.tally
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Counts `units` uses: searches, images, or whole seconds of audio. */
  public add(feature: PaidFeature, units: number): void {
    if (units <= 0) {
      return
    }
    recordPaidUse(this.recording, feature, units)

    const { tally } = this
    switch (feature) {
      case 'webSearch': {
        this.tally = { ...tally, webSearches: tally.webSearches + units }
        break
      }
      case 'imageGeneration': {
        this.tally = { ...tally, images: tally.images + units }
        break
      }
      case 'voice': {
        this.tally = { ...tally, voiceSeconds: tally.voiceSeconds + units }
        break
      }
      case 'scheduledPrompts': {
        this.tally = { ...tally, scheduledRuns: tally.scheduledRuns + units }
        break
      }
      case 'subagents': {
        this.tally = {
          ...tally,
          subagentRequests: (tally.subagentRequests ?? 0) + units,
          subagentUnknownRequests: (tally.subagentUnknownRequests ?? 0) + units,
        }
        break
      }
      case 'autoReviewer': {
        this.tally = {
          ...tally,
          autoReviews: (tally.autoReviews ?? 0) + units,
          autoReviewUnknownRequests: (tally.autoReviewUnknownRequests ?? 0) + units,
        }
        break
      }
      case 'bestOfN': {
        this.tally = { ...tally, bestOfNAttempts: (tally.bestOfNAttempts ?? 0) + units }
        break
      }
    }
    this.log.info(`Paid use: ${feature} +${String(units)}`)
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** One Auto review's tokens and cost (M78), billed apart from the conversation. */
  public addReviewerUsage(modelId: string, usage: SubagentUsage): void {
    const cost = reviewerCost(modelId, usage)
    const { tally } = this
    const unknown = tally.autoReviewUnknownRequests ?? 0
    if (unknown === 0) return
    this.tally = {
      ...tally,
      autoReviewUnknownRequests: unknown - 1,
      autoReviewTokens: (tally.autoReviewTokens ?? 0) + usage.inputTokens + usage.outputTokens,
      autoReviewCostUsd: (tally.autoReviewCostUsd ?? 0) + cost,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** One admitted child attempt reported billable usage; never replayed from storage. */
  public addSubagentUsage(modelId: string, usage: SubagentUsage): void {
    if (modelApiPaidTier(modelId) === undefined) {
      throw new Error('Cannot estimate subagent use for an unpriced model')
    }
    if (Object.values(usage).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Subagent usage must be finite and nonnegative')
    }
    const { tally } = this
    if ((tally.subagentUnknownRequests ?? 0) === 0) {
      return
    }
    this.tally = {
      ...tally,
      subagentUnknownRequests: (tally.subagentUnknownRequests ?? 0) - 1,
      subagentTokens: (tally.subagentTokens ?? 0) + usage.inputTokens + usage.outputTokens,
      subagentCostUsd: (tally.subagentCostUsd ?? 0) + estimateCostUsd(usage, modelId),
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  public addBestOfNRequest(): void {
    this.tally = {
      ...this.tally,
      bestOfNRequests: (this.tally.bestOfNRequests ?? 0) + 1,
      bestOfNUnknownRequests: (this.tally.bestOfNUnknownRequests ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }

  /** One owned host's per-response delta, never a cumulative/replayed frame. */
  public addBestOfNUsage(modelId: string, usage: SubagentUsage): void {
    if (modelApiPaidTier(modelId) === undefined) {
      throw new Error('Cannot estimate best-of-N use for an unpriced model')
    }
    if (
      Object.values(usage).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      usage.cachedTokens > usage.inputTokens
    ) {
      throw new Error('Best-of-N usage must be valid nonnegative token counts')
    }
    const unknown = this.tally.bestOfNUnknownRequests ?? 0
    if (unknown === 0) return
    this.tally = {
      ...this.tally,
      bestOfNUnknownRequests: unknown - 1,
      bestOfNTokens: (this.tally.bestOfNTokens ?? 0) + usage.inputTokens + usage.outputTokens,
      bestOfNCostUsd: (this.tally.bestOfNCostUsd ?? 0) + estimateCostUsd(usage, modelId),
    }
    for (const listener of this.listeners) listener()
  }
}

/** One Auto review's tokens (M78): its cost, at the model's published rates. */
function reviewerCost(modelId: string, usage: SubagentUsage): number {
  if (modelApiPaidTier(modelId) === undefined) {
    throw new Error('Cannot estimate an Auto review on an unpriced model')
  }
  if (
    Object.values(usage).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    usage.cachedTokens > usage.inputTokens
  ) {
    throw new Error('Auto review usage must be valid nonnegative token counts')
  }
  return estimateCostUsd(usage, modelId)
}

/** The message the panels render the badge, the microphone and the tally from. */
export function paidStateOf(
  gate: PaidFeatureGate,
  usage: PaidUsage,
  isKeyStored: boolean,
  alwaysAllowed: readonly PaidFeature[],
): PaidState {
  return {
    features: [...gate.features()],
    tally: usage.current,
    isKeyStored,
    alwaysAllowed: [...alwaysAllowed],
  }
}
