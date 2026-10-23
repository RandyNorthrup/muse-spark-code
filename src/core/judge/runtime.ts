// One request-only pipeline shared by the window, CLI, MCP and serve surfaces.
// Every run dispatches exactly one immutable plan (`./plan`): the binding is
// read once, at resolution, and never again.
import type { JudgeRuntime } from './engine'
import { compareUsdAmounts, Usd } from '../../shared/usd'
import { cascadeJudge, type JudgeCascadeSide, type JudgeCascadeOptions } from './cascade'
import { isJudgePlan, planJudgeRun, type JudgePlan, type JudgePlanOptions } from './plan'
import type { JudgeModeContext, JudgeModeResolution2a, JudgeModeTriggers } from './resolve'
import { judgeOutcomeSchema, type JudgeOutcome, type JudgeRequest } from './schema'
import type { runEmbeddingJudge, EmbeddingSource } from './embedding/route'
import type { embeddingAvailability, JudgeEmbeddingBinding } from './embedding/availability'
import type { JUDGE_SEPARATE_GAPS } from '../../shared/constants'

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
  /**
  A configured embedding transport has no recorded head for this
  family's labels yet (L98P2-EMBED). The full judge runs instead and
  the window names the gap in the status line. Unset while no
  embedding source is configured.
  */
  readonly embeddingNote?: 'labels-missing' | undefined
  /** A configured separate id whose side cannot be built here, and why (window status). */
  readonly separateGap?: (typeof JUDGE_SEPARATE_GAPS)[number] | undefined
}

export interface JudgeRuntimeDeps {
  readonly paidGrants?: Set<string> | undefined
  readonly loadEmbedding?:
    | (() => Promise<{
        readonly run: typeof runEmbeddingJudge
        readonly availability: typeof embeddingAvailability
      }>)
    | undefined
  /** Read exactly once per run, to build that run's plan. */
  readonly binding: () => JudgeRuntimeBinding | undefined
  /**
  The surface's live trigger identity (turn, owner, model, endpoint,
  profile, consent, confidential). Read once into the plan and compared
  afterwards: a change only ever cancels the run, never re-plans it.
  */
  readonly triggers?: (() => JudgeModeTriggers | undefined) | undefined
  readonly status?: ((resolution: JudgeModeResolution2a) => void) | undefined
  readonly embeddingAttempt?:
    ((phase: 'started' | 'completed' | 'failed', source: EmbeddingSource) => void) | undefined
  readonly embeddingStatus?:
    ((status: ReturnType<typeof embeddingAvailability>) => void) | undefined
}

/** A runtime whose runs are planned once and dispatched exactly as planned. */
export interface JudgePlanRuntime extends JudgeRuntime {
  /** The single binding read: this run's immutable plan, or a refusal. */
  plan(input: unknown, options?: Partial<JudgePlanOptions>): JudgePlan | JudgeOutcome
  /** Dispatch exactly the plan; nothing is re-read or re-resolved. */
  run(plan: JudgePlan, signal: AbortSignal): Promise<JudgeOutcome>
}

/**
One pending paid-consent decision per price identity: concurrent first
uses ask once, and the grant lands before any of them dispatches. Each
entry is deleted when its decision settles, so a declined answer is
asked again while a granted one is never re-asked.
*/
const pendingPaidConsent = new Map<string, Promise<boolean>>()

function refusal(reason: JudgeModeResolution2a['reason']): JudgeOutcome {
  const parsed = judgeOutcomeSchema.safeParse({ outcome: 'no-answer', reason })
  return parsed.success ? parsed.data : { outcome: 'no-answer', reason: 'source-unavailable' }
}

/** Each side's run retains its own C/E/J admission; no shared claim or hidden retry. */
export function createJudgeRuntime(deps: JudgeRuntimeDeps): JudgePlanRuntime {
  const grants = deps.paidGrants ?? new Set<string>()
  const plan = (input: unknown, options?: Partial<JudgePlanOptions>) =>
    planJudgeRun(deps.binding(), input, {
      hasFreeSides: true,
      triggers: deps.triggers,
      ...options,
    })
  const run = async (planned: JudgePlan, signal: AbortSignal): Promise<JudgeOutcome> => {
    const { context, resolution, request } = planned
    deps.status?.(resolution)
    if (resolution.mode === 'off') return refusal(resolution.reason)
    // Narrowing only: an abort or a changed trigger identity cancels; no
    // binding, receipt or tariff is read again, so nothing can widen.
    const isCurrent = () =>
      !signal.aborted &&
      (planned.triggerKey === undefined || JSON.stringify(deps.triggers?.()) === planned.triggerKey)
    const runSide = async (side: JudgeCascadeSide | undefined): Promise<JudgeOutcome> => {
      if (side === undefined || !isCurrent())
        return { outcome: 'no-answer', reason: 'source-unavailable' }
      const receipt = await side.run({ ...request, model: side.capability.model }, signal)
      return judgeOutcomeSchema.parse(receipt.outcome)
    }
    const same = planned.same?.side
    const separate = planned.separate?.side
    const full = async (): Promise<JudgeOutcome> => {
      if (!isCurrent()) return { outcome: 'no-answer', reason: 'cancelled' }
      if (resolution.mode !== 'both')
        return await runSide(resolution.mode === 'separate' ? separate : same)
      if (same === undefined || separate === undefined)
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
        planned.options,
        { same: guard(same), separate: guard(separate) },
        signal,
      )
    }
    const planEmbedding = planned.embedding
    const embedding = planEmbedding?.binding
    const embeddingFeatures = embedding === undefined ? undefined : await deps.loadEmbedding?.()
    if (!isCurrent()) return { outcome: 'no-answer', reason: 'cancelled' }
    const fullBinding = { context, options: planned.options, same, separate }
    const available = embeddingFeatures?.availability(embedding, fullBinding, resolution.mode) ?? {
      available: false as const,
      reason: 'capability-unavailable' as const,
    }
    deps.embeddingStatus?.(available)
    let outcome: JudgeOutcome
    if (
      planEmbedding === undefined ||
      embedding === undefined ||
      embeddingFeatures === undefined ||
      !available.available
    )
      outcome = await full()
    else {
      const source = planEmbedding.source
      // The consent epoch and the paid gate may only narrow this run.
      const isEmbeddingCurrent = () =>
        isCurrent() &&
        embedding.consentEpoch() === planEmbedding.consentEpoch &&
        (source.locality !== 'same-provider' || embedding.gate.isOn('judge'))
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
        tariff: planEmbedding.tariffUsd,
        epoch: planEmbedding.consentEpoch,
      })
      if (source.locality === 'same-provider' && !grants.has(priceIdentity)) {
        if (!embedding.isEnabled()) return { outcome: 'no-answer', reason: 'consent-declined' }
        const decision =
          pendingPaidConsent.get(priceIdentity) ??
          embedding.allowsPaidUse({
            feature: 'judge',
            modelId: source.model,
            dailyBudgetUsd: Usd.from(embedding.dailyBudgetUsd()).toAmount(),
            embedding: { worstCaseUsd: Usd.from(planEmbedding.tariffUsd).toAmount() },
          })
        pendingPaidConsent.set(priceIdentity, decision)
        let isAllowed: boolean
        try {
          isAllowed = await decision
        } catch (error: unknown) {
          pendingPaidConsent.delete(priceIdentity)
          throw error
        }
        pendingPaidConsent.delete(priceIdentity)
        if (!isAllowed || !isEmbeddingCurrent())
          return { outcome: 'no-answer', reason: 'consent-declined' }
        // The grant lands before any waiter dispatches: no wait sits
        // between this write and the dispatches below, so a later use
        // either sees the grant or joins a fresh decision.
        grants.add(priceIdentity)
      }
      const guardedSource: EmbeddingSource = {
        ...source,
        embed: async (inputs, stop) => {
          if (!isEmbeddingCurrent()) throw new Error('judge-binding-changed')
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
          family: planned.options.family,
          promptVersion: planned.options.promptVersion,
          criteriaVersion: planned.options.criteriaVersion,
          fitVersion: embedding.fitVersion,
          head: embedding.head,
          fallback: { run: full },
          admission: {
            run: async (cost, stop) => {
              stop.throwIfAborted()
              if (!isEmbeddingCurrent()) throw new Error('judge-binding-changed')
              if (source.locality === 'verified-local')
                return {
                  reservedCostUsd: Usd.from(0).toAmount(),
                  settledCostUsd: Usd.from(0).toAmount(),
                  uncertainCostUsd: Usd.from(0).toAmount(),
                }
              const ledger = embedding.ledger
              if (ledger === undefined) throw new Error('judge-admission-refused')
              // The planned tariff is the admitted ceiling: the route's
              // claim can never exceed what the plan priced.
              const tariff = planEmbedding.tariffUsd
              if (!Number.isFinite(tariff) || tariff < 0) throw new Error('judge-admission-refused')
              if (compareUsdAmounts(cost.uncachedCostUsd, Usd.from(tariff).toAmount()) > 0)
                throw new Error('judge-admission-refused')
              const remaining = await ledger.remainingUsd()
              if (remaining !== undefined && compareUsdAmounts(cost.uncachedCostUsd, remaining) > 0)
                throw new Error('judge-admission-refused')
              const claim = await ledger.reserve(cost.uncachedCostUsd)
              if (!isEmbeddingCurrent()) {
                await claim?.settle(Usd.from(0).toAmount())
                throw new Error('judge-binding-changed')
              }
              claim?.check()
              // No daily limit set: the ledger records nothing, so the leg
              // carries no reservation. The captured vector seam otherwise
              // has no usage receipt: retain full liability.
              const reserved = claim?.reservedUsd ?? Usd.from(0).toAmount()
              return {
                reservedCostUsd: reserved,
                settledCostUsd: Usd.from(0).toAmount(),
                uncertainCostUsd: reserved,
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
  }
  return {
    plan,
    run,
    async judge(input: JudgeRequest, signal: AbortSignal): Promise<JudgeOutcome> {
      const planned = plan(input)
      if (!isJudgePlan(planned)) return planned
      if (planned.dispatch === 'phase2') return await run(planned, signal)
      // A phase-1 plan has no request-level side here; the surface's own
      // phase-1 judge answers it (the window), or nothing does (the CLI).
      deps.status?.(planned.resolution)
      return { outcome: 'no-answer', reason: 'source-unavailable' }
    },
  }
}
