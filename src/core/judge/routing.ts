// Explicit phase-2 assembly. Hosts supply M95 clients and D78 claims;
// selecting or invalidating a binding fences all work from the old generation.
import type { JudgeRuntime } from './engine'
import { createByoJudge, type ByoJudgeDeps } from './providers/run'
import {
  createSystemOneJudge,
  type SystemOneJudgeDependencies,
  type SystemOneSelection,
} from './systemone/source'
import { JUDGE_PROVIDER_MODEL_TEXT, JUDGE_STATED_OUTPUT_TOKENS } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export type JudgeSourceSelection =
  | {
      readonly kind: 'byo'
      readonly deps: Omit<ByoJudgeDeps, 'generation' | 'logprobWording' | 'statedOutputTokens'>
    }
  | {
      readonly kind: 'systemone'
      readonly selection: Omit<SystemOneSelection, 'generation'>
      readonly deps: Omit<SystemOneJudgeDependencies, 'configuration'>
    }

/** Constructed only by the lazy factory; no selection means no source or I/O. */
export function createJudgeSourceRouter() {
  let generation = 0
  let runtime: JudgeRuntime | undefined
  const invalidate = () => {
    generation += 1
    runtime = undefined
  }
  return {
    invalidate,
    select(selection: JudgeSourceSelection) {
      invalidate()
      const selectedGeneration = generation
      if (selection.kind === 'systemone') {
        const configuration = { ...selection.selection, generation }
        runtime = createSystemOneJudge({
          ...selection.deps,
          configuration: () => (generation === selectedGeneration ? configuration : undefined),
        })
      } else {
        const judge = createByoJudge({
          ...selection.deps,
          generation: () => generation,
          statedOutputTokens: JUDGE_STATED_OUTPUT_TOKENS,
          logprobWording: {
            systemInstruction: JUDGE_PROVIDER_MODEL_TEXT.singleTokenInstruction,
            stateLabel: JUDGE_PROVIDER_MODEL_TEXT.stateLabel,
            questionLabel: JUDGE_PROVIDER_MODEL_TEXT.questionLabel,
            formatAlternative: (letter, label) =>
              fill(JUDGE_PROVIDER_MODEL_TEXT.alternativeLine, { letter: letter ?? '', label }),
          },
        })
        runtime = { judge: (request, signal) => judge.run(request, signal) }
      }
    },
    async judge(...args: Parameters<JudgeRuntime['judge']>) {
      return runtime === undefined
        ? { outcome: 'no-answer' as const, reason: 'source-unavailable' as const }
        : await runtime.judge(...args)
    },
  }
}
