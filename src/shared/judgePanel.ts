// The Models panel's Judge section (M98 phase 2, lane FP). The host projects
// a source lane's facts into this snapshot and both sides validate it before
// it crosses postMessage. Technique and calibration follow the selected
// model's capability record, never the provider's name. Money is copied
// only when it is a finite amount; an absent figure stays absent.
//
// No `vscode`, Node or DOM import: the chat protocol and the panel share it.

import { judgePanelFactsSchema, judgePanelSnapshotSchema } from './judgePanelSchema'
import type {
  JudgePanelCapability,
  JudgePanelFacts,
  JudgePanelLabel,
  JudgePanelReason,
  JudgePanelSnapshot,
  JudgePanelSource,
  JudgePanelTechnique,
} from './judgePanelSchema'
export * from './judgePanelSchema'

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

function omitEmpty(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  return Object.fromEntries(entries)
}

/**
Project one source report into the snapshot the panel and the usage
dialog show. A subscription-only report never asks for a paid charge.
A paid identity that does not match the stored grant asks again.
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
