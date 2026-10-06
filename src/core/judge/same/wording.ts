// The same-model judge's wording (M98 lane S, PLAN.md D77): lane J's prompt
// builder takes its wording injected, and this module builds it from
// JUDGE_MODEL_TEXT when the code runs. Text the model reads lives in
// constants, never here. No `vscode` import.

import { JUDGE_MODEL_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { JudgePromptWording } from '../prompt'

/**
 * The production wording for one judge batch: the stated-confidence system
 * instruction (techniques.ts parses exactly its contract), the state-first
 * labels, and one line per alternative (an option letter for a choice, a
 * level digit for a score, nothing to add for a noul).
 */
export function judgePromptWording(): JudgePromptWording {
  return {
    systemInstruction: JUDGE_MODEL_TEXT.judgeSystemInstruction,
    stateLabel: JUDGE_MODEL_TEXT.judgeStateLabel,
    questionLabel: JUDGE_MODEL_TEXT.judgeQuestionLabel,
    formatAlternative: (letter, label) =>
      fill(JUDGE_MODEL_TEXT.judgeAlternativeLine, {
        letter: letter ?? '',
        label,
      }),
  }
}

/**
 * The standalone turn for a Muse Code judge batch: the instructions with the
 * judged request fenced as data, on its own (an earlier turn was another
 * batch and does not bear on it), using no tools.
 */
export function judgeStandaloneTurn(request: string): string {
  return fill(JUDGE_MODEL_TEXT.judgeStandaloneTurn, {
    instructions: JUDGE_MODEL_TEXT.judgeSystemInstruction,
    request,
  })
}
