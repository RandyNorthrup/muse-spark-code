// Production phase-2 binding construction (M98 P2B).
//
// The window, CLI and MCP factories accept a `JudgeRuntimeBinding`; before
// this module nothing in the product built one, so every surface kept
// phase-1 behaviour. This module builds that binding from real parts:
//
// - the real C/E/J separate sides, adapted from the merged lanes' runtime
//   constructors (`createSystemOneJudge`, `createByoJudge`,
//   `createLocalJudgeSource`) through `cascadeSideFromRuntime`;
// - recorded adoption receipts and fitted profiles, read through the
//   injected `Phase2EvidenceStore` (PLAN 2b/2i: fitted weights live in
//   owner storage — the extension host's global storage, the CLI/MCP data
//   directory — never in the VSIX).
//
// Nothing is invented here: a profile the store does not hold stays
// missing, an unverified source stays unverified, and the resolver turns
// each gap into the translated status that names it (`source-unavailable`,
// `source-untested`, `profile-missing`, `evidence-missing`) instead of a
// silent phase-1 fallback. The binding exists whenever a phase-2 engine
// mode with a configured separate source is selected; it is `undefined`
// only for true single-model setups (`same`, `off`, or no separate source
// configured), which keep phase-1 behaviour by design.
//
// Two-stage validation is deliberate. The binding reports what is
// *recorded* (a profile file exists, a receipt file exists); the runtime
// inside `dist/judgeP2.js` then *validates* (identity match, independent
// evidence, grouped held-out lineage, cascade metrics) before dispatch.
// A recorded-but-unsuitable artifact still refuses, with the same named
// reason.
//
// Value imports stay clear of the lazy judge bundles on purpose: only
// `schema.ts` (the shared contract) is read at run time. Calibration
// parsing, adoption checking, cascade combination and source dispatch stay
// inside `dist/judgeP2.js` and its children, so the bundle-split guard
// keeps passing. Everything here is pure and synchronous; file access
// belongs to the surface-supplied store reader.
import type { JudgeRuntime } from './engine'
import { Usd, type UsdAmount } from '../../shared/usd'
import type { JudgeCascadeSide, JudgeCascadeOptions } from './cascade'
import type { JudgeAdoptionContext } from './adoption'
import type { CalibrationLimits } from './calibration/schema'
import type { JudgeRuntimeBinding } from './runtime'
import type { JudgeModeContext } from './resolve'
import {
  judgeCapabilitySchema,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeProfileIdentity,
} from './schema'
import type {
  Phase2AdoptionQuery,
  Phase2BindingContext,
  Phase2EvidenceStore,
} from './evidencePaths'
import { createClientlessBinding } from './evidencePaths'

// Evidence paths and the file store live beside the factory so the
// CLI/ACP entry can read them without loading judge schemas (the
// dispatch gate keeps schemas lazy). Re-exported here for the surfaces
// that already build full bindings.
export {
  cliEvidenceRoot,
  createClientlessBinding,
  emptyPhase2EvidenceStore,
  filePhase2EvidenceStore,
  phase2AdoptionSlug,
  phase2EmbeddingSlug,
  phase2EvidenceFile,
  phase2EvidenceSlug,
  phase2ProfileSlug,
} from './evidencePaths'
export type {
  Phase2BindingContext,
  Phase2EmbeddingQuery,
  Phase2EvidenceStore,
} from './evidencePaths'

/** One real separate judge source (C, E or J) with its verification proof. */
export interface Phase2SeparateSource {
  /** The lane's runtime, built by the surface from live clients. */
  readonly runtime: JudgeRuntime
  /** Exact source identity; malformed capabilities fail closed. */
  readonly capability: JudgeCapability
  /**
  The profile version this selection approved. The store is read for
  exactly this version; a rotated fit never inherits an old approval.
  */
  readonly fitVersion: string
  /** The source passed its verification gates (a C, E or J source). */
  readonly verified: boolean
  /** Remote, verified-local or unverified-local; gates confidential use. */
  readonly locality: 'remote' | 'verified-local' | 'unverified-local'
  /**
  The technique the one selector (`judgeSideTechnique`, beside the side
  factories in the sources bundle) chose for this source. Absent means
  the source supports none: its profiles are never read.
  */
  readonly technique?: JudgeProfileIdentity['technique'] | undefined
  /** Response model ids the source may report (its captured aliases). */
  readonly servedModels?: readonly string[] | undefined
  /**
  Ledger-backed costs for an answered outcome. Defaults to zero (free
  local sources); a paid side supplies its reservation reader. Usage
  accounting itself stays with the side's own ledger settlement.
  */
  readonly costsOf?:
    ((outcome: Extract<JudgeOutcome, { outcome: 'answered' }>) => Phase2SideCosts) | undefined
}

/** A separate source that is configured but has no live client yet. */
export function unavailablePhase2SeparateSource(): Pick<Phase2SeparateSource, 'runtime'> {
  return {
    runtime: {
      judge: () => Promise.resolve({ outcome: 'no-answer', reason: 'source-unavailable' }),
    },
  }
}

export interface Phase2SideCosts {
  readonly reservedCostUsd: UsdAmount
  readonly settledCostUsd: UsdAmount
  readonly uncertainCostUsd: UsdAmount
}

function zeroCosts(): Phase2SideCosts {
  const zero = Usd.from(0).toAmount()
  return { reservedCostUsd: zero, settledCostUsd: zero, uncertainCostUsd: zero }
}

/**
Adapt one merged-lane runtime (C, E or J) into a cascade side. The
runtime owns dispatch; `costsOf` is the surface's cost reader for an
answered outcome. A refused outcome passes through as the cascade's
failed side; a malformed capability or empty fit version refuses the
side before dispatch.
*/
export function cascadeSideFromRuntime(deps: {
  readonly runtime: JudgeRuntime
  readonly capability: JudgeCapability
  readonly profile: unknown
  readonly fitVersion: string
  readonly limits: CalibrationLimits
  readonly costsOf?:
    ((outcome: Extract<JudgeOutcome, { outcome: 'answered' }>) => Phase2SideCosts) | undefined
  readonly servedModels?: readonly string[] | undefined
}): JudgeCascadeSide | undefined {
  if (!judgeCapabilitySchema.safeParse(deps.capability).success) return undefined
  if (typeof deps.fitVersion !== 'string' || deps.fitVersion.length === 0) return undefined
  const costsOf = deps.costsOf ?? (() => zeroCosts())
  return {
    capability: deps.capability,
    profile: deps.profile,
    fitVersion: deps.fitVersion,
    limits: deps.limits,
    ...(deps.servedModels !== undefined && { servedModels: deps.servedModels }),
    run: async (request, signal) => {
      const outcome = await deps.runtime.judge(request, signal)
      return outcome.outcome === 'answered'
        ? { ...costsOf(outcome), outcome }
        : { ...zeroCosts(), outcome }
    },
  }
}

export interface Phase2BindingRequest {
  /** Raw `museSpark.judge.engine` (CLI `--engine`); parsed by the resolver. */
  readonly engine: unknown
  /** Raw `museSpark.judge.separate` (CLI `--separate`); empty means single-model. */
  readonly separateId: string | undefined
  /** The real same-model side, when the surface has one at request level. */
  readonly same?: JudgeCascadeSide | undefined
  /** The real separate source with its verification proof. */
  readonly separate?: Phase2SeparateSource | undefined
  /**
  A separate source id is configured but resolves to no live source yet
  (its C/E/J client lane has not landed). The binding still exists so
  the status names the gap instead of silently staying phase-1.
  */
  readonly separateConfigured?: boolean
  readonly store: Phase2EvidenceStore
  readonly options: JudgeCascadeOptions
  readonly limits: CalibrationLimits
  readonly context: Phase2BindingContext
  readonly billing?: JudgeRuntimeBinding['billing']
  readonly attemptCostUsd?: JudgeRuntimeBinding['attemptCostUsd']
  /**
  Adoption check. The production runtime (`dist/judgeP2.js`) and the CLI
  supply `hasJudgeAdoptionEvidence`; tests pass it directly. Injectable
  so this module never pulls calibration code into the host/CLI bundles.
  Without it, `auto` cannot reach `both`: recorded evidence stays
  unverified and the status says so.
  */
  readonly adoptionCheck?: ((record: unknown, context: JudgeAdoptionContext) => boolean) | undefined
  /**
  An embedding transport is configured (capable or opted-in) but no head
  is recorded for this family. Reported in the status line in plain
  words; the full judge runs instead. Unset while no embedding source
  is configured, in which case nothing is missing for the chosen mode.
  */
  readonly embeddingAwaitingLabels?: boolean
  /** A configured id whose side the port could not build, and why. */
  readonly separateGap?: JudgeRuntimeBinding['separateGap']
}

/**
Build the production binding, or `undefined` for a true single-model
setup. With a binding present, every evidence gap (unverified source,
missing profiles, missing adoption receipt, missing embedding labels)
reaches the translated status line through the 2a resolver; without one
the surfaces keep exact phase-1 behaviour.
*/
export function createPhase2Binding(
  request: Phase2BindingRequest,
): JudgeRuntimeBinding | undefined {
  const engine = request.engine
  if (engine === 'off' || engine === 'same') return undefined
  const separateId = request.separateId?.trim() ?? ''
  const isConfigured = request.separate !== undefined || request.separateConfigured === true
  if (separateId === '' || !isConfigured) return undefined
  const { store, options, limits } = request
  // A malformed separate spec is a surface bug, not missing evidence: it
  // reports the same gap as a clientless source instead of vanishing.
  const separate =
    request.separate !== undefined &&
    judgeCapabilitySchema.safeParse(request.separate.capability).success &&
    request.separate.fitVersion.length > 0
      ? request.separate
      : undefined

  // Profiles are read under the technique the side's own selector chose;
  // a side that supports no technique has none read and qualifies nothing.
  const withProfile = (
    side: JudgeCascadeSide | undefined,
    source: 'same' | 'separate',
    technique: JudgeProfileIdentity['technique'] | undefined,
  ): JudgeCascadeSide | undefined => {
    if (side === undefined) return undefined
    const parsed = judgeCapabilitySchema.safeParse(side.capability)
    if (!parsed.success) return undefined
    const recorded =
      technique === undefined
        ? undefined
        : store.readProfile({
            providerId: parsed.data.providerId,
            model: parsed.data.model,
            modelVersion: parsed.data.modelVersion,
            endpoint: parsed.data.endpoint,
            source,
            technique,
            family: options.family,
            promptVersion: options.promptVersion,
            criteriaVersion: options.criteriaVersion,
            fitVersion: side.fitVersion,
          })
    return { ...side, profile: recorded, technique }
  }

  const same = withProfile(request.same, 'same', request.same?.technique)
  const adaptedSeparate =
    separate === undefined
      ? undefined
      : cascadeSideFromRuntime({
          runtime: separate.runtime,
          capability: separate.capability,
          profile: undefined,
          fitVersion: separate.fitVersion,
          limits,
          ...(separate.costsOf !== undefined && { costsOf: separate.costsOf }),
          ...(separate.servedModels !== undefined && { servedModels: separate.servedModels }),
        })
  const separateSide = withProfile(adaptedSeparate, 'separate', separate?.technique)

  const adoptionQuery: Phase2AdoptionQuery = {
    providerId: request.context.providerId,
    modelId: request.context.modelId,
    family: options.family,
    promptVersion: options.promptVersion,
    criteriaVersion: options.criteriaVersion,
  }
  const record = store.readAdoptionRecord(adoptionQuery)

  // Configured-but-clientless (or a malformed spec): the shared
  // constructor reports the gap; the sided path below adds live sides
  // around the same record. Nothing dispatches without sides, so the
  // resolver names the gap instead of silently staying phase-1.
  if (separate === undefined) {
    const base = request.context
    const embeddingNote = request.embeddingAwaitingLabels === true ? 'labels-missing' : undefined
    return createClientlessBinding({
      engine,
      separateId: request.separateId,
      // Past the pre-gate `isConfigured` is always true: a malformed
      // spec stays a reported gap, never a silent fallback.
      separateConfigured: isConfigured,
      sourceAvailable: base.sourceAvailable,
      providerId: base.providerId,
      modelId: base.modelId,
      ...(base.endpoint !== undefined && { endpoint: base.endpoint }),
      ...(base.profileId !== undefined && { profileId: base.profileId }),
      ...(base.ownerId !== undefined && { ownerId: base.ownerId }),
      ...(base.turn !== undefined && { turn: base.turn }),
      confidential: base.confidential,
      paidConsent: base.paidConsent,
      readyRate: base.readyRate,
      minReadyRate: base.minReadyRate,
      options,
      limits,
      ...(same !== undefined && { same }),
      adoptionRecord: record,
      ...(request.adoptionCheck !== undefined && { adoptionCheck: request.adoptionCheck }),
      ...(request.billing !== undefined && { billing: request.billing }),
      ...(request.attemptCostUsd !== undefined && { attemptCostUsd: request.attemptCostUsd }),
      ...(embeddingNote !== undefined && { embeddingNote }),
      ...(request.separateGap !== undefined && { separateGap: request.separateGap }),
    })
  }

  const adoption =
    record === undefined
      ? undefined
      : {
          record,
          ...(request.adoptionCheck !== undefined && { check: request.adoptionCheck }),
          context: {
            providerId: request.context.providerId,
            modelId: request.context.modelId,
            limits,
            ...(same?.profile !== undefined && { sameProfile: same.profile }),
            ...(separateSide?.profile !== undefined && {
              separateProfile: separateSide.profile,
            }),
          },
        }

  // Recorded, not yet validated: the runtime re-checks identity,
  // independent evidence and grouped lineage before any dispatch. A
  // configured-but-clientless source has no sides, so nothing dispatches
  // and the resolver names the gap instead of silently staying phase-1.
  const hasRecordedProfiles = same?.profile !== undefined && separateSide?.profile !== undefined

  const context: JudgeModeContext = {
    engine,
    paidConsent: request.context.paidConsent,
    readyRate: request.context.readyRate,
    minReadyRate: request.context.minReadyRate,
    sourceAvailable: request.context.sourceAvailable,
    providerId: request.context.providerId,
    modelId: request.context.modelId,
    confidential: request.context.confidential,
    ...(request.context.endpoint !== undefined && { endpoint: request.context.endpoint }),
    ...(request.context.profileId !== undefined && { profileId: request.context.profileId }),
    ...(request.context.ownerId !== undefined && { ownerId: request.context.ownerId }),
    ...(request.context.turn !== undefined && { turn: request.context.turn }),
    separate: {
      available: true,
      verified: separate.verified,
      profilesReady: hasRecordedProfiles,
      adoption,
    },
  }

  return {
    ...(request.attemptCostUsd !== undefined && { attemptCostUsd: request.attemptCostUsd }),
    ...(request.billing !== undefined && { billing: request.billing }),
    context,
    options,
    ...(same !== undefined && { same }),
    ...(separateSide !== undefined && { separate: separateSide }),
    separateVerified: separate.verified,
    separateLocality: separate.locality,
    ...(request.embeddingAwaitingLabels === true && { embeddingNote: 'labels-missing' }),
  }
}
