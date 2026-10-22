// Shared production-binding test helpers (M98 P2B): the lane-runtime
// adapter, so the binding suites share it instead of repeating each other.
import type { JudgeCascadeSide } from '../../../src/core/judge/cascade'
import type { JudgeRuntime } from '../../../src/core/judge/engine'

/** Adapts a fixture side's run into the lane-runtime shape the factory takes. */
export function toRuntime(side: JudgeCascadeSide): Pick<JudgeRuntime, 'judge'> {
  return {
    judge: async (request, signal) => {
      const receipt = await side.run(request, signal)
      return receipt.outcome
    },
  }
}
