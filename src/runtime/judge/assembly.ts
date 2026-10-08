// Surface adapters preserve CLI's hard per-process cap while each source owns
// its own durable per-attempt admission in the shared runtime.
import {
  createJudgeRuntime,
  judgeRuntimeContext,
  type JudgeRuntimeBinding,
  type JudgeRuntimeDeps,
} from '../../core/judge/runtime'
import { shouldReResolve, resolveJudgeMode2a } from '../../core/judge/resolve'
import type { JudgeRequest } from '../../core/judge/schema'
import type { JudgeCliDeps, JudgeCliSource } from './commands'

export function createJudgeCommandDeps(
  deps: JudgeRuntimeDeps & {
    readonly billing: 'free' | 'paid'
    readonly worstCaseUsd: (request: JudgeRequest) => number | undefined
  },
): JudgeCliDeps {
  const paidGrants = new Set<string>()
  return {
    resolveSource: (options) => {
      const binding = deps.binding()
      if (binding === undefined) return Promise.resolve(undefined)
      const context = { ...judgeRuntimeContext(binding), engine: options.engine }
      const resolution = resolveJudgeMode2a(context)
      const mode = resolution.mode
      if (mode === 'off') return Promise.resolve(undefined)
      // A run that mixes a free judge with paid embeddings is paid: it
      // goes through the budget path, so `--budget-usd 0` refuses before
      // anything is sent.
      const isEmbeddingPaidAtResolve = binding.embedding?.source.locality === 'same-provider'
      const billing = isEmbeddingPaidAtResolve || deps.billing === 'paid' ? 'paid' : 'free'
      // The binding the run dispatches, read anew for admission and
      // dispatch alike. A changed trigger set, or a paid embedding
      // appearing or vanishing after resolution, refuses instead of
      // pricing or sending under the resolution's assumptions.
      const snapshot = (): JudgeRuntimeBinding | undefined => {
        const current = deps.binding()
        if (current === undefined) return undefined
        const isStale = shouldReResolve(binding.context, current.context)
        const isRepriced =
          (current.embedding?.source.locality === 'same-provider') !== isEmbeddingPaidAtResolve
        return isStale || isRepriced ? undefined : current
      }
      const ceilingOf = (
        target: JudgeRuntimeBinding,
        request: JudgeRequest,
      ): number | undefined => {
        const sides = mode === 'both' ? (['same', 'separate'] as const) : ([mode] as const)
        let total = 0
        for (const side of sides) {
          // Free judge sides carry no priced attempt. A priced judge
          // without a price is unpriced, never zero.
          const cost =
            target.attemptCostUsd?.(request, side) ?? (deps.billing === 'free' ? 0 : undefined)
          if (cost === undefined || !Number.isFinite(cost) || cost < 0) return undefined
          total += cost
        }
        if (target.embedding?.source.locality === 'same-provider') {
          const tariff = target.embedding.source.uncachedCostUsd
          if (!Number.isFinite(tariff) || tariff < 0) return undefined
          total += tariff
        }
        return Number.isFinite(total) ? total : undefined
      }
      const runtime = createJudgeRuntime({
        ...deps,
        paidGrants,
        binding: () => {
          const current = snapshot()
          return current === undefined
            ? undefined
            : { ...current, context: { ...current.context, engine: options.engine } }
        },
      })
      const source: JudgeCliSource = {
        source: mode,
        model:
          mode === 'separate'
            ? (binding.separate?.capability.model ?? context.modelId)
            : context.modelId,
        runtime,
        billing,
        worstCaseUsd: (request) => {
          // A free run carries no priced legs, so the surface fallback
          // stands. A paid run prices the binding it will dispatch, never
          // the one seen at resolution: a tariff or binding change before
          // dispatch is re-priced here and re-checked in `admitPaid`.
          if (billing === 'free') return deps.worstCaseUsd(request)
          const current = snapshot()
          return current === undefined ? undefined : ceilingOf(current, request)
        },
      }
      const embeddingModel = binding.embedding?.source.model
      return Promise.resolve(embeddingModel === undefined ? source : { ...source, embeddingModel })
    },
    admitPaid: (source, request, reservedUsd, signal) => {
      // Re-check the cap against the dispatch-time binding: a tariff or
      // binding change after the caller's reservation refuses here, before
      // anything is sent.
      const ceiling = source.worstCaseUsd(request)
      return ceiling === undefined || ceiling > reservedUsd
        ? Promise.resolve({ outcome: 'no-answer', reason: 'over-budget' })
        : source.runtime.judge(request, signal)
    },
  }
}
