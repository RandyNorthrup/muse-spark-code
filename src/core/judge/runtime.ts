// One request-only pipeline shared by the window, CLI, MCP and serve surfaces.
import { hasJudgeAdoptionEvidence } from './adoption'
import type { JudgeRuntime } from './engine'
import { cascadeJudge, type JudgeCascadeSide, type JudgeCascadeOptions } from './cascade'
import {
  resolveJudgeMode2a,
  shouldReResolve,
  type JudgeModeContext,
  type JudgeModeResolution2a,
} from './resolve'
import { parseCalibrationProfile } from './calibration/schema'
import {
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeOutcome,
  type JudgeRequest,
} from './schema'
import type { runEmbeddingJudge, EmbeddingSource } from './embedding/route'
import type { embeddingAvailability, JudgeEmbeddingBinding } from './embedding/availability'

export interface JudgeRuntimeBinding {
  readonly attemptCostUsd?:
    ((request: JudgeRequest, side: 'same' | 'separate') => number | undefined) | undefined
  readonly billing?: 'free' | 'modelApi' | 'subscription' | undefined
  readonly context: JudgeModeContext
  readonly options: JudgeCascadeOptions
  readonly same?: JudgeCascadeSide | undefined
  readonly separate?: JudgeCascadeSide | undefined
  readonly separateVerified: boolean
  readonly separateLocality: 'remote' | 'verified-local' | 'unverified-local'
  readonly embedding?: JudgeEmbeddingBinding | undefined
}

export interface JudgeRuntimeDeps {
  readonly paidGrants?: Set<string> | undefined
  readonly loadEmbedding?:
    | (() => Promise<{
        readonly run: typeof runEmbeddingJudge
        readonly availability: typeof embeddingAvailability
      }>)
    | undefined
  readonly binding: () => JudgeRuntimeBinding | undefined
  readonly status?: ((resolution: JudgeModeResolution2a) => void) | undefined
  readonly embeddingAttempt?:
    ((phase: 'started' | 'completed' | 'failed', source: EmbeddingSource) => void) | undefined
  readonly embeddingStatus?:
    ((status: ReturnType<typeof embeddingAvailability>) => void) | undefined
}

function isMatchingProfile(
  side: JudgeCascadeSide | undefined,
  options: JudgeCascadeOptions,
): boolean {
  if (side === undefined) return false
  const profile = parseCalibrationProfile(side.profile, side.limits)
  if (profile?.evidence !== 'independent' || profile.evaluation === undefined) return false
  const expected = { ...options, ...side.capability, fitVersion: side.fitVersion }
  return Object.entries(profile.identity).every(
    ([key, value]) => Reflect.get(expected, key) === value || key === 'technique',
  )
}

/** The current source proof and pinned profiles qualify readiness; recorded evidence qualifies auto. */
export function judgeRuntimeContext(binding: JudgeRuntimeBinding): JudgeModeContext {
  const { context, same, separate, options } = binding
  const isAllowedSeparate = !context.confidential || binding.separateLocality === 'verified-local'
  return {
    ...context,
    sourceAvailable: context.sourceAvailable && same !== undefined,
    separate:
      separate === undefined
        ? undefined
        : {
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

/** Each side's run retains its own C/E/J admission; no shared claim or hidden retry. */
export function createJudgeRuntime(deps: JudgeRuntimeDeps): JudgeRuntime {
  const grants = deps.paidGrants ?? new Set<string>()
  return {
    async judge(input: JudgeRequest, signal: AbortSignal): Promise<JudgeOutcome> {
      const binding = deps.binding()
      if (binding === undefined) return { outcome: 'no-answer', reason: 'source-unavailable' }
      const context = judgeRuntimeContext(binding)
      const resolution = resolveJudgeMode2a(context)
      deps.status?.(resolution)
      if (resolution.mode === 'off') {
        const refusal = judgeOutcomeSchema.safeParse({
          outcome: 'no-answer',
          reason: resolution.reason,
        })
        return refusal.success
          ? refusal.data
          : { outcome: 'no-answer', reason: 'source-unavailable' }
      }
      const request = judgeRequestSchema.parse(input)
      const identityOf = (current: JudgeRuntimeBinding) =>
        JSON.stringify({
          context: judgeRuntimeContext(current),
          options: current.options,
          same: current.same?.capability,
          sameFit: current.same?.fitVersion,
          separate: current.separate?.capability,
          separateFit: current.separate?.fitVersion,
          embedding:
            current.embedding === undefined
              ? undefined
              : {
                  source: { ...current.embedding.source, embed: undefined },
                  head: current.embedding.head,
                  manifest: current.embedding.manifest,
                  fitVersion: current.embedding.fitVersion,
                  optedIn: current.embedding.localOptedIn,
                  capable: current.embedding.capable,
                  price: current.embedding.priceFingerprint,
                  epoch: current.embedding.consentEpoch(),
                },
        })
      const identity = identityOf(binding)
      const isCurrent = () => {
        const current = deps.binding()
        return (
          !signal.aborted &&
          current !== undefined &&
          !shouldReResolve(context, judgeRuntimeContext(current)) &&
          identityOf(current) === identity
        )
      }
      const runSide = async (side: JudgeCascadeSide | undefined): Promise<JudgeOutcome> => {
        if (side === undefined || !isCurrent())
          return { outcome: 'no-answer', reason: 'source-unavailable' }
        const receipt = await side.run({ ...request, model: side.capability.model }, signal)
        return judgeOutcomeSchema.parse(receipt.outcome)
      }
      const full = async (): Promise<JudgeOutcome> => {
        if (!isCurrent()) return { outcome: 'no-answer', reason: 'cancelled' }
        if (resolution.mode !== 'both')
          return await runSide(resolution.mode === 'separate' ? binding.separate : binding.same)
        if (binding.same === undefined || binding.separate === undefined)
          return { outcome: 'no-answer', reason: 'source-unavailable' }
        const guard = (side: JudgeCascadeSide): JudgeCascadeSide => ({
          ...side,
          run: async (body, stop) => {
            if (!isCurrent()) throw new Error('judge-binding-changed')
            return await side.run({ ...body, model: side.capability.model }, stop)
          },
        })
        return await cascadeJudge(
          { ...request, model: undefined },
          binding.options,
          { same: guard(binding.same), separate: guard(binding.separate) },
          signal,
        )
      }
      const embedding = binding.embedding
      const embeddingFeatures = embedding === undefined ? undefined : await deps.loadEmbedding?.()
      if (!isCurrent()) return { outcome: 'no-answer', reason: 'cancelled' }
      const available = embeddingFeatures?.availability(embedding, binding, resolution.mode) ?? {
        available: false as const,
        reason: 'capability-unavailable' as const,
      }
      deps.embeddingStatus?.(available)
      let outcome: JudgeOutcome
      if (embedding === undefined || embeddingFeatures === undefined || !available.available)
        outcome = await full()
      else {
        const source = embedding.source
        const priceIdentity = JSON.stringify({
          ownerId: context.ownerId,
          providerId: context.providerId,
          confidential: context.confidential,
          source: {
            providerId: source.providerId,
            model: source.model,
            modelVersion: source.modelVersion,
            endpoint: source.endpoint,
            source: source.source,
            locality: source.locality,
          },
          price: embedding.priceFingerprint,
          epoch: embedding.consentEpoch(),
        })
        if (source.locality === 'same-provider' && !grants.has(priceIdentity)) {
          if (
            !embedding.isEnabled() ||
            !(await embedding.allowsPaidUse({
              feature: 'judge',
              modelId: source.model,
              dailyBudgetUsd: embedding.dailyBudgetUsd(),
              embedding: { worstCaseUsd: source.uncachedCostUsd },
            })) ||
            !isCurrent()
          )
            return { outcome: 'no-answer', reason: 'consent-declined' }
          grants.add(priceIdentity)
        }
        const guardedSource: EmbeddingSource = {
          ...source,
          embed: async (inputs, stop) => {
            if (
              !isCurrent() ||
              (source.locality === 'same-provider' && !embedding.gate.isOn('judge'))
            )
              throw new Error('judge-binding-changed')
            deps.embeddingAttempt?.('started', source)
            try {
              const vectors = await source.embed(inputs, stop)
              deps.embeddingAttempt?.('completed', source)
              return vectors
            } catch (error: unknown) {
              deps.embeddingAttempt?.('failed', source)
              throw error
            }
          },
        }
        outcome = await embeddingFeatures.run(
          request,
          { optedIn: true, confidential: context.confidential },
          {
            source: guardedSource,
            family: binding.options.family,
            promptVersion: binding.options.promptVersion,
            criteriaVersion: binding.options.criteriaVersion,
            fitVersion: embedding.fitVersion,
            head: embedding.head,
            fallback: { run: full },
            admission: {
              run: async (cost, stop) => {
                stop.throwIfAborted()
                if (!isCurrent()) throw new Error('judge-binding-changed')
                if (source.locality === 'verified-local')
                  return { reservedCostUsd: 0, settledCostUsd: 0, uncertainCostUsd: 0 }
                const ledger = embedding.ledger
                if (
                  ledger === undefined ||
                  !embedding.gate.isOn('judge') ||
                  cost.uncachedCostUsd > (await ledger.remainingUsd())
                )
                  throw new Error('judge-admission-refused')
                const claim = await ledger.reserve(cost.uncachedCostUsd)
                if (!isCurrent() || !embedding.gate.isOn('judge')) {
                  await claim.settle(0)
                  throw new Error('judge-binding-changed')
                }
                claim.check()
                // The captured vector seam has no usage receipt. Retain full liability.
                return {
                  reservedCostUsd: claim.reservedUsd,
                  settledCostUsd: 0,
                  uncertainCostUsd: claim.reservedUsd,
                }
              },
            },
          },
          signal,
        )
      }
      if (embedding !== undefined && outcome.outcome === 'answered')
        outcome = { ...outcome, result: { ...outcome.result, embeddingAvailability: available } }
      return isCurrent()
        ? judgeOutcomeSchema.parse(outcome)
        : { outcome: 'no-answer', reason: 'cancelled' }
    },
  }
}
