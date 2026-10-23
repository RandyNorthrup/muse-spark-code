// Surface adapters preserve CLI's hard per-process cap while each source owns
// its own durable per-attempt admission in the shared runtime. One plan per
// request: the run cap, paid admission and dispatch all read it, and the
// binding is read exactly once, when the plan is built.
import { createJudgeRuntime, type JudgeRuntimeDeps } from '../../core/judge/runtime'
import { isJudgePlan } from '../../core/judge/plan'
import type { JudgeRequest } from '../../core/judge/schema'
import { compareUsdAmounts } from '../../shared/usd'
import type { UsdAmount } from '../../shared/usdSchema'
import type { JudgeCliDeps } from './commands'

export function createJudgeCommandDeps(
  deps: JudgeRuntimeDeps & {
    readonly billing: 'free' | 'paid'
    readonly worstCaseUsd: (request: JudgeRequest) => UsdAmount | undefined
  },
): JudgeCliDeps {
  const runtime = createJudgeRuntime({ ...deps, paidGrants: new Set<string>() })
  return {
    resolveSource: (options, _signal, request) => {
      const plan = runtime.plan(request, {
        engine: options.engine,
        hasFreeSides: deps.billing === 'free',
      })
      if (!isJudgePlan(plan)) return Promise.resolve(undefined)
      // A configured source that cannot be built refuses at resolution,
      // before any claim, with the code the window's status line shows.
      if (plan.resolution.mode === 'off')
        return Promise.resolve(
          plan.separateGap === undefined
            ? undefined
            : { outcome: 'no-answer', reason: 'source-unavailable', gap: plan.separateGap },
        )
      const mode = plan.resolution.mode
      // A run with any priced leg is paid, including a free judge with paid
      // embeddings: it goes through the budget path, so `--budget-usd 0`
      // refuses before anything is sent.
      const billing = deps.billing === 'paid' || plan.isPaid ? 'paid' : 'free'
      const isPlanned = (candidate: JudgeRequest) =>
        JSON.stringify(candidate) === JSON.stringify(plan.request)
      return Promise.resolve({
        source: mode,
        model:
          mode === 'separate'
            ? (plan.separate?.model ?? plan.context.modelId)
            : plan.context.modelId,
        // Dispatch runs exactly this plan; another request is never served by it.
        runtime: {
          judge: (candidate, signal) => {
            if (!isPlanned(candidate))
              return Promise.resolve({ outcome: 'no-answer', reason: 'engine-failure' })
            return plan.dispatch === 'phase2'
              ? runtime.run(plan, signal)
              : Promise.resolve({ outcome: 'no-answer', reason: 'source-unavailable' })
          },
        },
        billing,
        // A free run carries no priced legs, so the surface fallback stands.
        // A paid run is priced from the plan alone, never from a re-read.
        worstCaseUsd: (candidate) => {
          if (billing === 'free') return deps.worstCaseUsd(candidate)
          return isPlanned(candidate) ? plan.worstCaseUsd : undefined
        },
        // A separate route may report its captured aliases for its request id.
        ...(mode === 'separate' &&
          plan.separate?.side.servedModels !== undefined && {
            servedModels: plan.separate.side.servedModels,
          }),
        // An embedding answer names this model instead of the conversation
        // model; the CLI accepts exactly it for embedding verdicts.
        ...(plan.embedding !== undefined && { embeddingModel: plan.embedding.source.model }),
      })
    },
    admitPaid: (source, request, reservedUsd, signal) => {
      // The reservation must cover the plan's whole ceiling; the plan is
      // the one that dispatches, so the cap cannot be widened afterwards.
      const ceiling = source.worstCaseUsd(request)
      return ceiling === undefined || compareUsdAmounts(ceiling, reservedUsd) > 0
        ? Promise.resolve({ outcome: 'no-answer', reason: 'over-budget' })
        : source.runtime.judge(request, signal)
    },
  }
}
