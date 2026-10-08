// Surface adapters preserve CLI's hard per-process cap while each source owns
// its own durable per-attempt admission in the shared runtime.
import {
  createJudgeRuntime,
  judgeRuntimeContext,
  type JudgeRuntimeDeps,
} from '../../core/judge/runtime'
import { shouldReResolve, resolveJudgeMode2a } from '../../core/judge/resolve'
import type { JudgeRequest } from '../../core/judge/schema'
import type { JudgeCliDeps } from './commands'

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
      const runtime = createJudgeRuntime({
        ...deps,
        paidGrants,
        binding: () => {
          const current = deps.binding()
          return current === undefined || shouldReResolve(binding.context, current.context)
            ? undefined
            : { ...current, context: { ...current.context, engine: options.engine } }
        },
      })
      return Promise.resolve({
        source: mode,
        model:
          mode === 'separate'
            ? (binding.separate?.capability.model ?? context.modelId)
            : context.modelId,
        runtime,
        billing: deps.billing,
        worstCaseUsd: (request) => {
          if (deps.billing === 'free') return deps.worstCaseUsd(request)
          const sides = mode === 'both' ? (['same', 'separate'] as const) : ([mode] as const)
          let total = 0
          for (const side of sides) {
            const cost = binding.attemptCostUsd?.(request, side)
            if (cost === undefined || !Number.isFinite(cost) || cost < 0) return
            total += cost
          }
          if (binding.embedding?.source.locality === 'same-provider')
            total += binding.embedding.source.uncachedCostUsd
          return Number.isFinite(total) ? total : undefined
        },
      })
    },
    admitPaid: (source, request, reservedUsd, signal) => {
      const ceiling = source.worstCaseUsd(request)
      return ceiling === undefined || ceiling > reservedUsd
        ? Promise.resolve({ outcome: 'no-answer', reason: 'over-budget' })
        : source.runtime.judge(request, signal)
    },
  }
}
