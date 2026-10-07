// The Models panel's Judge section (M98 phase 2, lane FP). The host projects
// a source lane's facts into this snapshot and both sides validate it before
// it crosses postMessage. Technique and calibration follow the selected
// model's capability record, never the provider's name. Money is copied
// only when it is a finite amount; an absent figure stays absent.
//
// No `vscode`, Node or DOM import: the chat protocol and the panel share it.

import * as z from 'zod/mini'
import { MODEL_API_PRICE_DECIMALS, PROVIDER_PRICE_MAX_DECIMALS, UI_TEXT } from './constants'
import { fill, formatUsd } from './l10n/text'

export const JUDGE_PANEL_ENGINES = ['auto', 'same', 'separate', 'both', 'off'] as const
export type JudgePanelEngine = (typeof JUDGE_PANEL_ENGINES)[number]

export const JUDGE_PANEL_SOURCES = ['same', 'separate', 'both', 'none'] as const
export type JudgePanelSource = (typeof JUDGE_PANEL_SOURCES)[number]

/** Kept aligned with `JUDGE_TECHNIQUES` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_TECHNIQUES = [
  'logprob',
  'top1',
  'stated',
  'systemone',
  'sampling',
  'contrastive',
  'cascade',
  'embedding',
] as const
export type JudgePanelTechnique = (typeof JUDGE_PANEL_TECHNIQUES)[number]

/** Kept aligned with `JUDGE_LABELS` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_LABELS = [
  'calibrated (logprob)',
  'calibrated (stated)',
  'uncalibrated',
  'approximate (top-1)',
] as const
export type JudgePanelLabel = (typeof JUDGE_PANEL_LABELS)[number]

/** Kept aligned with `JUDGE_NO_ANSWER_REASONS` in src/core/judge/schema.ts. */
export const JUDGE_PANEL_REASONS = [
  'explicit-off',
  'unknown-setting',
  'consent-needed',
  'consent-declined',
  'source-unavailable',
  'ready-rate-low',
  'profile-missing',
  'profile-mismatch',
  'source-untested',
  'local-unverified',
  'confidential-refused',
  'capability-unavailable',
  'over-context',
  'over-budget',
  'unpriced',
  'cancelled',
  'timeout',
  'engine-failure',
] as const
export type JudgePanelReason = (typeof JUDGE_PANEL_REASONS)[number]

/** A reported amount. Negative and non-finite values are omitted, never shown as zero. */
const reportedUsd = z.number()

const usdSchema = z.number().check(
  z.nonnegative(),
  z.refine((value) => Number.isFinite(value)),
)

export const judgePanelLogprobSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('topk'), topK: z.int().check(z.positive()) }),
  z.strictObject({ kind: z.enum(['top1', 'refused', 'dropped', 'unknown']) }),
])

/** One model's captured judge capability. Provider id is identity, not a technique. */
export const judgePanelCapabilitySchema = z.strictObject({
  providerId: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  logprobs: judgePanelLogprobSchema,
  stated: z.boolean(),
  systemone: z.boolean(),
  reasoningForced: z.boolean(),
  cache: z.boolean(),
  embedding: z.optional(z.boolean()),
})
export type JudgePanelCapability = z.infer<typeof judgePanelCapabilitySchema>

const panelIdentityFields = {
  engine: z.enum(JUDGE_PANEL_ENGINES),
  effectiveSource: z.enum(JUDGE_PANEL_SOURCES),
  providerId: z.optional(z.string().check(z.minLength(1))),
  modelId: z.optional(z.string().check(z.minLength(1))),
  technique: z.optional(z.enum(JUDGE_PANEL_TECHNIQUES)),
  label: z.optional(z.enum(JUDGE_PANEL_LABELS)),
  partial: z.optional(z.boolean()),
  reason: z.optional(z.enum(JUDGE_PANEL_REASONS)),
}

export const judgePanelFactsSchema = z.strictObject({
  ...panelIdentityFields,
  capability: z.optional(judgePanelCapabilitySchema),
  locality: z.enum(['not-local', 'verified', 'unverified']),
  experimental: z.boolean(),
  confidential: z.boolean(),
  billing: z.enum(['subscription', 'modelApi', 'free', 'none']),
  paidSourceSelected: z.boolean(),
  consent: z.enum(['not-required', 'needed', 'granted', 'declined']),
  consentBoundTo: z.optional(z.string().check(z.minLength(1))),
  paidIdentity: z.optional(z.string().check(z.minLength(1))),
  inputPerMillion: z.optional(reportedUsd),
  cachedPerMillion: z.optional(reportedUsd),
  outputPerMillion: z.optional(reportedUsd),
  reservedUsd: z.optional(reportedUsd),
  settledUsd: z.optional(reportedUsd),
  uncertainUsd: z.optional(reportedUsd),
  dailyBudgetUsd: z.optional(reportedUsd),
  dailySpentUsd: z.optional(reportedUsd),
})
export type JudgePanelFacts = z.infer<typeof judgePanelFactsSchema>

export const judgePanelSnapshotSchema = z.strictObject({
  ...panelIdentityFields,
  unverifiedLocal: z.boolean(),
  untested: z.boolean(),
  billing: z.enum(['subscription', 'modelApi', 'free', 'none']),
  paidSourceSelected: z.boolean(),
  consent: z.enum(['not-required', 'needed', 'granted', 'declined']),
  askFirstCharge: z.boolean(),
  showSubscriptionNote: z.boolean(),
  inputPerMillion: z.optional(usdSchema),
  cachedPerMillion: z.optional(usdSchema),
  outputPerMillion: z.optional(usdSchema),
  reservedUsd: z.optional(usdSchema),
  settledUsd: z.optional(usdSchema),
  uncertainUsd: z.optional(usdSchema),
  dailyBudgetUsd: z.optional(usdSchema),
  dailySpentUsd: z.optional(usdSchema),
})
export type JudgePanelSnapshot = z.infer<typeof judgePanelSnapshotSchema>

/** The Models host calls this only after the snapshot says a first charge is due. */
export interface JudgePanelPort {
  readonly read: () => JudgePanelFacts
  readonly requestFirstCharge: () => Promise<void>
}

const ASK_BLOCKS: ReadonlySet<JudgePanelReason> = new Set([
  'explicit-off',
  'unknown-setting',
  'consent-declined',
  'source-unavailable',
  'ready-rate-low',
  'profile-missing',
  'profile-mismatch',
  'confidential-refused',
  'capability-unavailable',
  'over-context',
  'over-budget',
  'unpriced',
  'cancelled',
  'timeout',
  'engine-failure',
])

function finiteUsd(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

function capabilityFor(facts: JudgePanelFacts): JudgePanelCapability | undefined {
  const capability = facts.capability
  if (capability === undefined) {
    return undefined
  }
  if (facts.modelId !== undefined && capability.model !== facts.modelId) {
    return undefined
  }
  return facts.providerId !== undefined && capability.providerId !== facts.providerId
    ? undefined
    : capability
}

/** The claimed technique stands only when this model's record can honour it. */
function canUseTechnique(
  technique: JudgePanelTechnique,
  capability: JudgePanelCapability | undefined,
  source: JudgePanelSource,
): boolean {
  if (technique === 'cascade') {
    return source === 'both'
  }
  if (capability === undefined) {
    return false
  }
  switch (technique) {
    case 'logprob': {
      return capability.logprobs.kind === 'topk'
    }
    case 'top1': {
      return capability.logprobs.kind === 'top1'
    }
    case 'stated': {
      return capability.stated
    }
    case 'systemone': {
      return capability.systemone
    }
    case 'sampling': {
      return capability.cache && !capability.reasoningForced
    }
    case 'contrastive': {
      return capability.stated || capability.logprobs.kind === 'topk'
    }
    case 'embedding': {
      return capability.embedding === true
    }
  }
}

function consistentLabel(
  technique: JudgePanelTechnique | undefined,
  label: JudgePanelLabel | undefined,
): JudgePanelLabel | undefined {
  if (technique === undefined || label === undefined) {
    return undefined
  }
  if (technique === 'top1') {
    return 'approximate (top-1)'
  }
  if (label === 'calibrated (logprob)' && technique !== 'logprob') {
    return 'uncalibrated'
  }
  if (label === 'calibrated (stated)' && technique !== 'stated') {
    return 'uncalibrated'
  }
  return label === 'approximate (top-1)' ? 'uncalibrated' : label
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  return Object.fromEntries(entries) as T
}

/**
 * Project one source report into the snapshot the panel and the usage
 * dialog show. A subscription-only report never asks for a paid charge.
 * A paid identity that does not match the stored grant asks again.
 */
export function projectJudgePanel(facts: JudgePanelFacts): JudgePanelSnapshot {
  const parsed = judgePanelFactsSchema.safeParse(facts)
  if (!parsed.success) {
    throw new TypeError('judge panel facts are not valid')
  }
  const input = parsed.data
  const capability = capabilityFor(input)
  let source = input.effectiveSource
  let technique = input.technique
  let reason = input.reason
  let isUntested = input.experimental
  let isUnverifiedLocal = input.locality === 'unverified'
  if (technique !== undefined && !canUseTechnique(technique, capability, source)) {
    technique = undefined
    reason ??= 'capability-unavailable'
  }
  if (capability === undefined && input.capability !== undefined && input.technique !== undefined) {
    technique = undefined
    reason = 'capability-unavailable'
  }
  if (input.experimental && input.engine === 'auto') {
    source = 'none'
    technique = undefined
    reason ??= 'source-untested'
    isUntested = true
  }
  if (input.locality === 'unverified' && input.engine === 'auto') {
    source = 'none'
    technique = undefined
    reason = 'local-unverified'
    isUnverifiedLocal = true
  }
  if (input.confidential && input.locality === 'unverified') {
    source = 'none'
    technique = undefined
    reason = 'confidential-refused'
    isUnverifiedLocal = true
  }
  // A confidential workspace refuses a System One source everywhere except
  // where the text already lives: the same model, or verified local
  // inference. Locality decides; remote and unverified endpoints stay refused.
  if (
    input.confidential &&
    input.technique === 'systemone' &&
    input.effectiveSource !== 'same' &&
    input.locality !== 'verified'
  ) {
    source = 'none'
    technique = undefined
    reason = 'confidential-refused'
  }
  if (input.engine === 'off') {
    source = 'none'
    technique = undefined
    reason =
      reason === 'confidential-refused' || reason === 'source-unavailable' ? reason : 'explicit-off'
  }
  const isSubscriptionOnly = input.billing === 'subscription' && !input.paidSourceSelected
  // Bare subscription is excluded only by subscriptionOnly. Listing it here
  // keeps that flag the single switch for a subscription-only first charge.
  const isPaid =
    !isSubscriptionOnly &&
    (input.billing === 'modelApi' || input.paidSourceSelected || input.billing === 'subscription')
  if (isSubscriptionOnly && (reason === 'consent-needed' || reason === 'consent-declined')) {
    reason = undefined
  }
  let consent =
    isPaid &&
    input.paidIdentity !== undefined &&
    input.consentBoundTo !== undefined &&
    input.consentBoundTo !== input.paidIdentity
      ? 'needed'
      : input.consent
  if (isSubscriptionOnly || (input.billing === 'free' && !input.paidSourceSelected)) {
    consent = 'not-required'
  }
  const inputPerMillion = finiteUsd(input.inputPerMillion)
  const cachedPerMillion = finiteUsd(input.cachedPerMillion)
  const outputPerMillion = finiteUsd(input.outputPerMillion)
  const hasPrice =
    inputPerMillion !== undefined ||
    cachedPerMillion !== undefined ||
    outputPerMillion !== undefined
  if (isPaid && !hasPrice && (reason === undefined || reason === 'consent-needed')) {
    reason = 'unpriced'
  }
  const dailyBudgetUsd = finiteUsd(input.dailyBudgetUsd)
  const isAskFirstCharge =
    isPaid &&
    consent === 'needed' &&
    input.engine !== 'off' &&
    source !== 'none' &&
    hasPrice &&
    dailyBudgetUsd !== undefined &&
    (reason === undefined || reason === 'consent-needed' || !ASK_BLOCKS.has(reason))
  const snapshot = omitEmpty({
    engine: input.engine,
    effectiveSource: source,
    providerId: input.providerId,
    modelId: input.modelId,
    technique,
    label: consistentLabel(technique, input.label),
    partial: technique !== undefined && input.partial === true,
    reason,
    unverifiedLocal: isUnverifiedLocal,
    untested: isUntested,
    billing: input.billing,
    paidSourceSelected: input.paidSourceSelected,
    consent,
    askFirstCharge: isAskFirstCharge,
    showSubscriptionNote: isSubscriptionOnly && input.engine !== 'off' && source !== 'none',
    inputPerMillion,
    cachedPerMillion,
    outputPerMillion,
    reservedUsd: finiteUsd(input.reservedUsd),
    settledUsd: finiteUsd(input.settledUsd),
    uncertainUsd: finiteUsd(input.uncertainUsd),
    dailyBudgetUsd,
    dailySpentUsd: finiteUsd(input.dailySpentUsd),
  })
  const checked = judgePanelSnapshotSchema.safeParse(snapshot)
  if (!checked.success) {
    throw new TypeError('judge panel snapshot is not valid')
  }
  return checked.data
}

/** Shown when no source lane has reported yet. Nothing is asked or charged. */
export function unavailableJudgePanel(): JudgePanelSnapshot {
  return projectJudgePanel({
    engine: 'off',
    effectiveSource: 'none',
    locality: 'not-local',
    experimental: false,
    confidential: false,
    billing: 'none',
    paidSourceSelected: false,
    consent: 'not-required',
    reason: 'source-unavailable',
  })
}

/**
 * Exact dollars. The paid view quotes provider prices at the same scale
 * (three decimals out to twenty significant digits), so a positive price or
 * liability is never rounded to zero and no significant digit is dropped:
 * $0.042 per million shows as $0.042.
 */
export function judgePanelMoney(amount: number): string {
  return formatUsd(amount, MODEL_API_PRICE_DECIMALS, PROVIDER_PRICE_MAX_DECIMALS)
}

export interface JudgePanelRow {
  readonly term: string
  readonly detail: string
}

function sourceDetail(snapshot: JudgePanelSnapshot): string {
  switch (snapshot.effectiveSource) {
    case 'same': {
      return UI_TEXT.judgeSourceSame
    }
    case 'separate': {
      return UI_TEXT.judgeSourceSeparate
    }
    case 'both': {
      return UI_TEXT.judgeSourceBoth
    }
    case 'none': {
      return snapshot.engine === 'off' ? UI_TEXT.judgeStatusOff : UI_TEXT.judgeStatusUnavailable
    }
  }
}

function techniqueDetail(technique: JudgePanelTechnique): string {
  switch (technique) {
    case 'logprob': {
      return UI_TEXT.judgePanel.techniques.logprob
    }
    case 'top1': {
      return UI_TEXT.judgePanel.techniques.top1
    }
    case 'stated': {
      return UI_TEXT.judgePanel.techniques.stated
    }
    case 'systemone': {
      return UI_TEXT.judgePanel.techniques.systemone
    }
    case 'sampling': {
      return UI_TEXT.judgePanel.techniques.sampling
    }
    case 'contrastive': {
      return UI_TEXT.judgePanel.techniques.contrastive
    }
    case 'cascade': {
      return UI_TEXT.judgePanel.techniques.cascade
    }
    case 'embedding': {
      return UI_TEXT.judgePanel.techniques.embedding
    }
  }
}

function labelDetail(label: JudgePanelLabel): string {
  switch (label) {
    case 'calibrated (logprob)': {
      return UI_TEXT.judgePanel.labels.logprob
    }
    case 'calibrated (stated)': {
      return UI_TEXT.judgePanel.labels.stated
    }
    case 'uncalibrated': {
      return UI_TEXT.judgePanel.labels.uncalibrated
    }
    case 'approximate (top-1)': {
      return UI_TEXT.judgePanel.labels.top1
    }
  }
}

/** The status line. Read when the section renders, never at module load. */
export function judgePanelStatusText(snapshot: JudgePanelSnapshot): string {
  if (snapshot.reason === 'confidential-refused') {
    return fill(UI_TEXT.judgeNoAnswer, { reason: snapshot.reason })
  }
  if (snapshot.unverifiedLocal) {
    return UI_TEXT.judgeLocalUnverified
  }
  if (
    snapshot.untested &&
    (snapshot.reason === undefined || snapshot.reason === 'source-untested')
  ) {
    return UI_TEXT.judgeSourceUntested
  }
  switch (snapshot.reason) {
    case 'explicit-off': {
      return UI_TEXT.judgeStatusOff
    }
    case 'consent-needed': {
      return UI_TEXT.judgeStatusConsent
    }
    case 'consent-declined': {
      return UI_TEXT.judgeStatusDeclined
    }
    case 'source-unavailable':
    case 'unknown-setting': {
      return UI_TEXT.judgeStatusUnavailable
    }
    case 'ready-rate-low': {
      return UI_TEXT.judgeStatusSlow
    }
    case 'local-unverified': {
      return UI_TEXT.judgeLocalUnverified
    }
    case 'source-untested': {
      return UI_TEXT.judgeSourceUntested
    }
    case undefined: {
      // A paid source selected on a subscription backend is billed, not
      // covered: it reads Paid, with its price in the rows below.
      if (snapshot.billing === 'subscription' && !snapshot.paidSourceSelected) {
        return UI_TEXT.judgeStatusSubscription
      }
      if (snapshot.billing === 'modelApi' || snapshot.paidSourceSelected) {
        return UI_TEXT.judgeStatusPaid
      }
      return snapshot.billing === 'free' ? UI_TEXT.judgePanel.freeLocal : UI_TEXT.paidJudgeName
    }
    default: {
      return fill(UI_TEXT.judgeNoAnswer, { reason: snapshot.reason })
    }
  }
}

function priceDetail(snapshot: JudgePanelSnapshot): string | undefined {
  const parts: string[] = []
  if (snapshot.inputPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceInput, { input: judgePanelMoney(snapshot.inputPerMillion) }),
    )
  }
  if (snapshot.cachedPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceCached, { cached: judgePanelMoney(snapshot.cachedPerMillion) }),
    )
  }
  if (snapshot.outputPerMillion !== undefined) {
    parts.push(
      fill(UI_TEXT.judgePanel.priceOutput, {
        output: judgePanelMoney(snapshot.outputPerMillion),
      }),
    )
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function moneyRow(
  term: string,
  amount: number | undefined,
  isPaid: boolean,
): JudgePanelRow | undefined {
  if (amount !== undefined) {
    return { term, detail: judgePanelMoney(amount) }
  }
  return isPaid ? { term, detail: UI_TEXT.judgePanel.notKnown } : undefined
}

/**
 * The definition list the panel and the usage dialog share. A subscription
 * with no paid source shows the subscription status, not a zero price.
 * An unknown paid amount says it is not known.
 */
export function judgePanelRows(snapshot: JudgePanelSnapshot): readonly JudgePanelRow[] {
  const isPaid = snapshot.billing === 'modelApi' || snapshot.paidSourceSelected
  const rows: JudgePanelRow[] = [
    { term: UI_TEXT.judgePanel.source, detail: sourceDetail(snapshot) },
  ]
  if (snapshot.modelId !== undefined) {
    const provider = snapshot.providerId === undefined ? '' : `${snapshot.providerId}/`
    rows.push({
      term: UI_TEXT.judgePanel.model,
      detail: `${provider}${snapshot.modelId}`,
    })
  }
  if (snapshot.technique !== undefined) {
    rows.push({
      term: UI_TEXT.judgePanel.technique,
      detail: techniqueDetail(snapshot.technique),
    })
  }
  if (snapshot.label !== undefined) {
    rows.push({ term: UI_TEXT.judgePanel.calibration, detail: labelDetail(snapshot.label) })
  }
  if (snapshot.partial === true) {
    rows.push({ term: UI_TEXT.judgePanel.partial, detail: UI_TEXT.judgePanel.partialYes })
  }
  const price = priceDetail(snapshot)
  if (price !== undefined) {
    rows.push({ term: UI_TEXT.judgePanel.price, detail: price })
  } else if (isPaid && snapshot.reason === 'unpriced') {
    rows.push({ term: UI_TEXT.judgePanel.price, detail: UI_TEXT.judgePanel.unpriced })
  }
  const reserved = moneyRow(UI_TEXT.judgePanel.reserved, snapshot.reservedUsd, isPaid)
  const settled = moneyRow(UI_TEXT.judgePanel.settled, snapshot.settledUsd, isPaid)
  const uncertain = moneyRow(UI_TEXT.judgePanel.uncertain, snapshot.uncertainUsd, isPaid)
  if (reserved !== undefined) {
    rows.push(reserved)
  }
  if (settled !== undefined) {
    rows.push(settled)
  }
  if (uncertain !== undefined) {
    rows.push(uncertain)
  }
  if (isPaid) {
    rows.push({
      term: UI_TEXT.judgePanel.dailyBudget,
      detail:
        snapshot.dailyBudgetUsd === undefined
          ? UI_TEXT.judgePanel.notKnown
          : judgePanelMoney(snapshot.dailyBudgetUsd),
    })
  }
  if (snapshot.dailySpentUsd !== undefined) {
    rows.push({
      term: UI_TEXT.judgePanel.spentToday,
      detail: judgePanelMoney(snapshot.dailySpentUsd),
    })
  }
  return rows
}
