// One immutable judge-run plan (M98 phase 2 redesign, RVM98P2BF finding 1).
//
// A plan is built exactly once per judge run, from exactly one binding read,
// at resolution. It holds the resolved mode, the dispatched sides (endpoint,
// model, technique, profile identity and tariff each), the embedding route
// and its tariff, the adoption receipt that decided `auto`, and the
// worst-case USD of the whole run. Pricing, the CLI's hard run cap, paid
// admission and the runtime's dispatch all read this one object; nothing
// re-reads the binding or re-resolves the mode once it exists. A binding that
// changes mid-run (a new receipt, a refreshed tariff) cannot widen the run:
// the next run builds a new plan.
import { hasJudgeAdoptionEvidence } from './adoption'
import type { JudgeCascadeOptions, JudgeCascadeSide } from './cascade'
import { parseCalibrationProfile } from './calibration/schema'
import type { JudgeEmbeddingBinding } from './embedding/availability'
import type { EmbeddingSource } from './embedding/route'
import {
  resolveJudgeMode2a,
  type JudgeModeContext,
  type JudgeModeResolution2a,
  type JudgeModeTriggers,
} from './resolve'
import type { JudgeRuntimeBinding } from './runtime'
import { judgeRequestSchema, type JudgeOutcome, type JudgeRequest } from './schema'

/** One dispatched side, frozen at resolution. */
export interface JudgePlanSide {
  readonly side: JudgeCascadeSide
  readonly endpoint: string
  readonly model: string
  /** The side's own selector's technique; absent means none it supports. */
  readonly technique: JudgeCascadeSide['technique']
  /** The fitted profile identity the side was resolved with, if recorded. */
  readonly profileIdentity: unknown
  /** This side's priced attempt for this request; undefined is unpriced. */
  readonly tariffUsd: number | undefined
}

/** The embedding route frozen at resolution, with the tariff it was priced at. */
export interface JudgePlanEmbedding {
  readonly binding: JudgeEmbeddingBinding
  readonly source: EmbeddingSource
  /** Paid same-provider tariff; zero for a free verified-local source. */
  readonly tariffUsd: number
  /** The consent epoch seen at resolution; a later epoch refuses, never widens. */
  readonly consentEpoch: string
}

export interface JudgePlan {
  readonly request: JudgeRequest
  /** The resolution context: the trigger identity this run was planned under. */
  readonly context: JudgeModeContext
  readonly resolution: JudgeModeResolution2a
  readonly options: JudgeCascadeOptions
  readonly billing: JudgeRuntimeBinding['billing']
  /** Any priced leg (a priced side or a paid embedding) makes the run paid. */
  readonly isPaid: boolean
  readonly same?: JudgePlanSide | undefined
  readonly separate?: JudgePlanSide | undefined
  readonly embedding?: JudgePlanEmbedding | undefined
  /** The adoption receipt that `auto` was resolved against, if one was recorded. */
  readonly evidence?: { readonly record: unknown; readonly qualified: boolean } | undefined
  /** The whole run's ceiling; undefined when any planned leg is unpriced. */
  readonly worstCaseUsd: number | undefined
  /**
  `phase2` dispatches the planned sides. `phase1` means the plan resolved
  to `same` with no request-level same side and no embedding: the
  surface's working phase-1 same-model judge answers, never a side-less
  runtime that sends nothing.
  */
  readonly dispatch: 'phase2' | 'phase1'
  /** The surface's trigger identity at resolution; only ever narrows the run. */
  readonly triggerKey: string | undefined
  /** Why the configured separate source has no side here, when it has none. */
  readonly separateGap?: JudgeRuntimeBinding['separateGap']
}

export interface JudgePlanOptions {
  /** Overrides the binding's engine (the CLI's `--engine`). */
  readonly engine?: unknown
  /** Judge sides carry no priced attempt (a free surface); otherwise unpriced is undefined. */
  readonly hasFreeSides: boolean
  /** The surface's live trigger identity, read once here and compared later. */
  readonly triggers?: (() => JudgeModeTriggers | undefined) | undefined
}

/** Profile techniques B can fit; top-1 is never calibrated. */
function isMatchingProfile(
  side: JudgeCascadeSide | undefined,
  options: JudgeCascadeOptions,
): boolean {
  if (side?.technique === undefined) return false
  const profile = parseCalibrationProfile(side.profile, side.limits)
  if (profile?.evidence !== 'independent' || profile.evaluation === undefined) return false
  // The side's own selector decides its technique (BYO: chooseByoTechnique);
  // evidence for any other technique never qualifies the path that runs.
  const expected = {
    ...options,
    ...side.capability,
    technique: side.technique,
    fitVersion: side.fitVersion,
  }
  return Object.entries(profile.identity).every(
    ([key, value]) => Reflect.get(expected, key) === value,
  )
}

/** The current source proof and pinned profiles qualify readiness; recorded evidence qualifies auto. */
export function judgeRuntimeContext(binding: JudgeRuntimeBinding): JudgeModeContext {
  const { context, same, separate, options } = binding
  // Without sides nothing dispatches through phase 2, so a configured but
  // clientless binding keeps the precise gap the factory reported. A
  // binding with no separate block at all keeps the old phase-1 mapping.
  if (separate === undefined) return context
  const isAllowedSeparate = !context.confidential || binding.separateLocality === 'verified-local'
  return {
    ...context,
    separate: {
      available: isAllowedSeparate,
      verified: binding.separateVerified,
      profilesReady: isMatchingProfile(same, options) && isMatchingProfile(separate, options),
      adoption:
        same === undefined || context.separate?.adoption === undefined
          ? undefined
          : {
              record: context.separate.adoption.record,
              check: hasJudgeAdoptionEvidence,
              context: {
                providerId: context.providerId,
                modelId: context.modelId,
                limits: same.limits,
                sameProfile: same.profile,
                separateProfile: separate.profile,
              },
            },
    },
  }
}

function tariffOf(
  binding: JudgeRuntimeBinding,
  request: JudgeRequest,
  source: 'same' | 'separate',
  hasFreeSides: boolean,
): number | undefined {
  const cost = binding.attemptCostUsd?.(request, source) ?? (hasFreeSides ? 0 : undefined)
  return cost === undefined || !Number.isFinite(cost) || cost < 0 ? undefined : cost
}

function planSide(
  binding: JudgeRuntimeBinding,
  request: JudgeRequest,
  source: 'same' | 'separate',
  hasFreeSides: boolean,
): JudgePlanSide | undefined {
  const side = binding[source]
  if (side === undefined) return undefined
  const profile = parseCalibrationProfile(side.profile, side.limits)
  return Object.freeze({
    side: Object.freeze({ ...side }),
    endpoint: side.capability.endpoint,
    model: side.capability.model,
    technique: side.technique,
    profileIdentity: profile?.identity,
    tariffUsd: tariffOf(binding, request, source, hasFreeSides),
  })
}

function planEmbedding(
  embedding: JudgeEmbeddingBinding | undefined,
): JudgePlanEmbedding | undefined {
  if (embedding === undefined) return undefined
  // The source is copied, so a refreshed tariff on the live binding can
  // never reach this run's admission or its embedding dispatch.
  const source = Object.freeze({ ...embedding.source })
  return Object.freeze({
    binding: Object.freeze({ ...embedding, source }),
    source,
    tariffUsd: source.locality === 'same-provider' ? source.uncachedCostUsd : 0,
    consentEpoch: embedding.consentEpoch(),
  })
}

/** The dispatched sides for a mode: off and phase-1 dispatch none here. */
function dispatchedSides(mode: JudgeModeResolution2a['mode']): readonly ('same' | 'separate')[] {
  if (mode === 'both') return ['same', 'separate']
  return mode === 'off' ? [] : [mode]
}

/**
Build this run's plan from one binding read. A refusal before planning
(no binding, a malformed request) returns the outcome instead.
*/
export function planJudgeRun(
  binding: JudgeRuntimeBinding | undefined,
  input: unknown,
  planOptions: JudgePlanOptions,
): JudgePlan | JudgeOutcome {
  if (binding === undefined) return { outcome: 'no-answer', reason: 'source-unavailable' }
  const parsed = judgeRequestSchema.safeParse(input)
  if (!parsed.success) return { outcome: 'no-answer', reason: 'engine-failure' }
  const request = parsed.data
  const engine = 'engine' in planOptions ? planOptions.engine : binding.context.engine
  const context = { ...judgeRuntimeContext(binding), engine }
  const resolution = resolveJudgeMode2a(context)
  const mode = resolution.mode
  const same = planSide(binding, request, 'same', planOptions.hasFreeSides)
  const separate = planSide(binding, request, 'separate', planOptions.hasFreeSides)
  const embedding = mode === 'off' ? undefined : planEmbedding(binding.embedding)
  const sides = dispatchedSides(mode).map((source) => (source === 'same' ? same : separate))
  // Every dispatched side's tariff, then the embedding's; one unpriced leg
  // leaves the whole plan unpriced.
  const legs = [
    ...sides.map((side) => side?.tariffUsd),
    ...(embedding === undefined ? [] : [embedding.tariffUsd]),
  ]
  const worstCaseUsd = legs.every(
    (leg): leg is number => leg !== undefined && Number.isFinite(leg) && leg >= 0,
  )
    ? legs.reduce((total, leg) => total + leg, 0)
    : undefined
  const isPricedSide = sides.some((side) => side !== undefined && (side.tariffUsd ?? 1) > 0)
  const adoption = context.separate?.adoption
  const evidence =
    adoption === undefined
      ? undefined
      : { record: adoption.record, qualified: resolution.reason === 'auto-both' }
  const triggers = planOptions.triggers?.()
  return Object.freeze({
    request,
    context,
    resolution,
    options: Object.freeze({ ...binding.options }),
    billing: binding.billing,
    isPaid: isPricedSide || embedding?.source.locality === 'same-provider',
    ...((mode === 'same' || mode === 'both') && { same }),
    ...((mode === 'separate' || mode === 'both') && { separate }),
    ...(embedding !== undefined && { embedding }),
    ...(evidence !== undefined && { evidence }),
    worstCaseUsd,
    dispatch:
      mode === 'same' && same === undefined && embedding === undefined ? 'phase1' : 'phase2',
    triggerKey: triggers === undefined ? undefined : JSON.stringify(triggers),
    ...(binding.separateGap !== undefined && { separateGap: binding.separateGap }),
  })
}

/** Whether a value is a plan rather than a pre-planning refusal. */
export function isJudgePlan(value: JudgePlan | JudgeOutcome): value is JudgePlan {
  return 'resolution' in value
}
